/**
 * The real Node transport, exercised against a throwaway server on the loopback interface (no
 * internet). The transport is called directly: the SSRF policy in safe-fetch.ts would (correctly)
 * refuse a loopback address, and that policy is tested separately with a scripted transport.
 *
 * What this proves is the part the scripted transport cannot: the connection really goes to the
 * address it was given (not to whatever the host name resolves to), compressed bodies are
 * decompressed, the byte limit applies to the decompressed size, redirects are handed back rather
 * than followed, and an abort really cancels the request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeTransport } from '../src/server/ingestion/url-import/node-transport';
import type { PageTransport } from '../src/server/ingestion/url-import/safe-fetch';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The project has no @types/node; the test loads the two built-ins it needs untyped.
const load = (specifier: string): Promise<any> => import(/* @vite-ignore */ specifier);

let server: any;
let port = 0;
let transport: PageTransport;
const seen: { host?: string; path?: string; userAgent?: string }[] = [];
const decoder = new TextDecoder();

beforeAll(async () => {
  const [http, zlib] = await Promise.all([load('node:http'), load('node:zlib')]);
  transport = await createNodeTransport();

  server = http.createServer((request: any, response: any) => {
    seen.push({ host: request.headers.host, path: request.url, userAgent: request.headers['user-agent'] });
    switch (request.url.split('?')[0]) {
      case '/plain':
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<title>plain</title>');
        break;
      case '/gzip':
        response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
        response.end(zlib.gzipSync('<title>gzipped</title>'));
        break;
      case '/bomb': // 5 MB of text that compresses to a few KB
        response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
        response.end(zlib.gzipSync('a'.repeat(5 * 1024 * 1024)));
        break;
      case '/weird-encoding':
        response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'compress' });
        response.end('whatever');
        break;
      case '/redirect':
        response.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        response.end();
        break;
      case '/hang':
        break; // never answers
      case '/stall': // sends the start of a page, then stops
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.write('<title>partial');
        break;
      default:
        response.writeHead(404);
        response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(async () => {
  server?.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = (path: string, host = '127.0.0.1', signal = new AbortController().signal) =>
  transport.get({ url: new URL(`http://${host}:${port}${path}`), address: '127.0.0.1', signal, headers: { 'User-Agent': 'test-agent' } });

describe('the Node transport', () => {
  it('connects to the address it was given, whatever the host name would resolve to', async () => {
    // "pinned.invalid" can never resolve. The response only arrives because the pinned address is used.
    const response = await get('/plain?x=1', 'pinned.invalid');
    const { bytes, truncated } = await response.readBody(10_000);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(decoder.decode(bytes)).toBe('<title>plain</title>');
    expect(truncated).toBe(false);
    // The server was told the site's name (for virtual hosting), the exact path and query, and our own identity.
    expect(seen.at(-1)).toEqual({ host: `pinned.invalid:${port}`, path: '/plain?x=1', userAgent: 'test-agent' });
  });

  it('decompresses gzip responses', async () => {
    const response = await get('/gzip');
    expect(decoder.decode((await response.readBody(10_000)).bytes)).toBe('<title>gzipped</title>');
  });

  it('applies the byte limit to the decompressed size, so a compression bomb cannot exceed it', async () => {
    const response = await get('/bomb');

    const { bytes, truncated } = await response.readBody(1000);

    expect(bytes.length).toBe(1000);
    expect(truncated).toBe(true);
  });

  it('refuses an encoding it cannot decode instead of reading garbage', async () => {
    const response = await get('/weird-encoding');
    await expect(response.readBody(1000)).rejects.toThrow();
  });

  it('hands a redirect back as a redirect and does not follow it', async () => {
    const response = await get('/redirect');

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('http://169.254.169.254/latest/meta-data/');
    response.dispose();
    expect(seen.filter((request) => request.path === '/redirect')).toHaveLength(1); // nothing else was requested
  });

  it('can be cancelled while waiting for a response', async () => {
    const controller = new AbortController();
    const pending = get('/hang', '127.0.0.1', controller.signal);

    setTimeout(() => controller.abort(), 30);

    await expect(pending).rejects.toThrow();
  });

  it('can be cancelled while a response body is stalled part-way through', async () => {
    const controller = new AbortController();
    const response = await get('/stall', '127.0.0.1', controller.signal);
    expect(response.status).toBe(200);

    const reading = response.readBody(10_000);
    setTimeout(() => controller.abort(), 30);

    await expect(reading).rejects.toThrow();
  });

  it('reports a refused connection as an error rather than hanging', async () => {
    const closed = new URL('http://127.0.0.1:1/'); // nothing listens on port 1
    await expect(transport.get({ url: closed, address: '127.0.0.1', signal: new AbortController().signal, headers: {} })).rejects.toThrow();
  });
});
