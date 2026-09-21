/**
 * The safe page fetcher: SSRF protection, redirect handling, and the time/size/content limits.
 * The network and DNS are replaced by a scripted transport, so these tests never touch the
 * internet, and they can assert what the fetcher did NOT do (no lookup, no request).
 */
import { describe, expect, it } from 'vitest';
import { decodeHtmlBytes } from '../src/server/ingestion/url-import/html';
import { fetchPublicPage, type PageTransport, type TransportRequest, type TransportResponse } from '../src/server/ingestion/url-import/safe-fetch';

const PUBLIC_IP = '93.184.216.34';
const encoder = new TextEncoder();

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

/** A scripted transport. `dns` maps host names to addresses; `routes` maps exact URLs to responses. */
function scripted(routes: Record<string, Route | ((request: TransportRequest) => Promise<TransportResponse>)>, dns: Record<string, string[]> = {}) {
  const lookups: string[] = [];
  const requests: { url: string; address: string }[] = [];
  const state = { disposed: 0, bodiesRead: 0 };

  const transport: PageTransport = {
    async resolve(hostname) {
      lookups.push(hostname);
      const addresses = dns[hostname];
      if (!addresses) throw new Error('getaddrinfo ENOTFOUND internal-detail-that-must-not-leak');
      return addresses;
    },
    async get(request) {
      requests.push({ url: request.url.href, address: request.address });
      const route = routes[request.url.href];
      if (route === undefined) throw new Error('no route: internal-detail-that-must-not-leak');
      if (typeof route === 'function') return route(request);
      return {
        status: route.status ?? 200,
        headers: { 'content-type': 'text/html; charset=utf-8', ...route.headers },
        readBody: async (maxBytes) => {
          state.bodiesRead += 1;
          const bytes = typeof route.body === 'string' ? encoder.encode(route.body) : (route.body ?? new Uint8Array());
          return { bytes: bytes.subarray(0, maxBytes), truncated: bytes.length > maxBytes };
        },
        dispose: () => {
          state.disposed += 1;
        },
      };
    },
  };
  return { transport, lookups, requests, state };
}

const publicDns = { 'shop.example': [PUBLIC_IP], 'other.example': [PUBLIC_IP], 'www.shop.example': [PUBLIC_IP] };

describe('fetching a page', () => {
  it('returns the page, and connects to the very address it verified', async () => {
    const { transport, requests, lookups } = scripted({ 'https://shop.example/p': { body: '<title>Hi</title>' } }, publicDns);

    const result = await fetchPublicPage('https://shop.example/p', transport);

    expect(result).toEqual({ ok: true, finalUrl: 'https://shop.example/p', html: '<title>Hi</title>', truncated: false });
    expect(lookups).toEqual(['shop.example']);
    expect(requests).toEqual([{ url: 'https://shop.example/p', address: PUBLIC_IP }]);
  });

  it('follows redirects (relative ones too) and reports the final address', async () => {
    const { transport, requests } = scripted(
      {
        'https://shop.example/a': { status: 301, headers: { location: '/b' } },
        'https://shop.example/b': { status: 302, headers: { location: 'https://other.example/c?x=1' } },
        'https://other.example/c?x=1': { body: 'done' },
      },
      publicDns,
    );

    const result = await fetchPublicPage('https://shop.example/a', transport);

    expect(result).toMatchObject({ ok: true, finalUrl: 'https://other.example/c?x=1', html: 'done' });
    expect(requests.map((request) => request.url)).toEqual(['https://shop.example/a', 'https://shop.example/b', 'https://other.example/c?x=1']);
  });
});

describe('SSRF protection', () => {
  it('never looks up or requests a URL that is not a public web address', async () => {
    const { transport, lookups, requests } = scripted({}, publicDns);
    const blocked = [
      'http://localhost/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://10.0.0.5/admin',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/',
      'http://intranet/',
      'ftp://shop.example/x',
      'file:///etc/passwd',
      'https://user:pw@shop.example/',
      'https://shop.example:6379/',
    ];
    for (const url of blocked) {
      const result = await fetchPublicPage(url, transport);
      expect(result, url).toMatchObject({ ok: false, code: 'blocked' });
    }
    expect(lookups).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('refuses a host name that resolves to a private address, and one answer among public ones is enough to refuse', async () => {
    const { transport, requests } = scripted(
      {},
      {
        'internal.example': ['10.0.0.5'],
        'loopback.example': ['127.0.0.1'],
        'metadata.example': ['169.254.169.254'],
        'v6.example': ['::1'],
        'mapped.example': ['::ffff:127.0.0.1'],
        'mixed.example': [PUBLIC_IP, '10.0.0.5'],
      },
    );
    for (const host of ['internal', 'loopback', 'metadata', 'v6', 'mapped', 'mixed']) {
      expect(await fetchPublicPage(`https://${host}.example/`, transport), host).toMatchObject({ ok: false, code: 'blocked' });
    }
    expect(requests).toEqual([]);
  });

  it('does not follow a redirect from a public URL to a private literal address', async () => {
    const { transport, requests } = scripted({ 'https://shop.example/a': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } } }, publicDns);

    const result = await fetchPublicPage('https://shop.example/a', transport);

    expect(result).toMatchObject({ ok: false, code: 'blocked' });
    expect(result.ok === false && result.message).toMatch(/redirect/i);
    expect(requests.map((request) => request.url)).toEqual(['https://shop.example/a']); // the private address was never requested
  });

  it('does not follow a redirect to a host name that resolves to a private address', async () => {
    const { transport, requests } = scripted({ 'https://shop.example/a': { status: 307, headers: { location: 'https://internal.example/admin' } } }, { ...publicDns, 'internal.example': ['192.168.0.10'] });

    expect(await fetchPublicPage('https://shop.example/a', transport)).toMatchObject({ ok: false, code: 'blocked' });
    expect(requests).toHaveLength(1);
  });

  it('does not follow a redirect to another scheme, a bad port, or localhost, at any point in a chain', async () => {
    for (const location of ['file:///etc/passwd', 'ftp://shop.example/x', 'https://shop.example:8080/', 'http://localhost/', 'http://[::1]:80/']) {
      const { transport, requests } = scripted(
        {
          'https://shop.example/a': { status: 302, headers: { location: '/b' } },
          'https://shop.example/b': { status: 302, headers: { location } },
        },
        publicDns,
      );
      expect(await fetchPublicPage('https://shop.example/a', transport), location).toMatchObject({ ok: false, code: 'blocked' });
      expect(requests, location).toHaveLength(2);
    }
  });

  it('stops a redirect loop after a bounded number of hops', async () => {
    const { transport, requests } = scripted({ 'https://shop.example/a': { status: 302, headers: { location: '/a' } } }, publicDns);

    const result = await fetchPublicPage('https://shop.example/a', transport, { maxRedirects: 3 });

    expect(result).toMatchObject({ ok: false, code: 'redirect' });
    expect(requests).toHaveLength(4); // the first request plus three redirects, then it gives up
  });

  it('reports a redirect with no destination or an invalid one', async () => {
    const noLocation = scripted({ 'https://shop.example/a': { status: 302 } }, publicDns);
    expect(await fetchPublicPage('https://shop.example/a', noLocation.transport)).toMatchObject({ ok: false, code: 'redirect' });

    const invalid = scripted({ 'https://shop.example/a': { status: 302, headers: { location: 'http://' } } }, publicDns);
    expect(await fetchPublicPage('https://shop.example/a', invalid.transport)).toMatchObject({ ok: false, code: 'redirect' });
  });
});

describe('limits and content rules', () => {
  it('reads only HTML: anything else is refused without reading the body', async () => {
    for (const headers of [{ 'content-type': 'application/pdf' }, { 'content-type': 'image/png' }, { 'content-type': 'application/json' }, { 'content-type': '' }]) {
      const { transport, state } = scripted({ 'https://shop.example/p': { headers, body: 'x'.repeat(100) } }, publicDns);
      expect(await fetchPublicPage('https://shop.example/p', transport), JSON.stringify(headers)).toMatchObject({ ok: false, code: 'not_html' });
      expect(state.bodiesRead).toBe(0);
      expect(state.disposed).toBe(1);
    }
    const xhtml = scripted({ 'https://shop.example/p': { headers: { 'content-type': 'application/xhtml+xml' }, body: '<html/>' } }, publicDns);
    expect(await fetchPublicPage('https://shop.example/p', xhtml.transport)).toMatchObject({ ok: true });
  });

  it('keeps only the first maxBytes of a huge page and says so', async () => {
    const { transport } = scripted({ 'https://shop.example/p': { body: 'a'.repeat(5000) } }, publicDns);

    const result = await fetchPublicPage('https://shop.example/p', transport, { maxBytes: 1000 });

    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(result.ok && result.html.length).toBe(1000);
  });

  it('gives up on a page that never answers, after the time limit', async () => {
    const hangs = (request: TransportRequest): Promise<TransportResponse> =>
      new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const { transport } = scripted({ 'https://shop.example/slow': hangs }, publicDns);

    const result = await fetchPublicPage('https://shop.example/slow', transport, { timeoutMs: 25 });

    expect(result).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('turns an HTTP error status into a plain failure', async () => {
    const { transport } = scripted({ 'https://shop.example/gone': { status: 404 }, 'https://shop.example/blocked': { status: 403 }, 'https://shop.example/down': { status: 503 } }, publicDns);
    for (const [path, status] of [['gone', 404], ['blocked', 403], ['down', 503]] as const) {
      const result = await fetchPublicPage(`https://shop.example/${path}`, transport);
      expect(result).toMatchObject({ ok: false, code: 'http' });
      expect(result.ok === false && result.message).toContain(String(status));
    }
  });

  it('never repeats what the network or the remote side said in a failure message', async () => {
    const { transport } = scripted({ 'https://shop.example/p': async () => { throw new Error('ECONNRESET internal-detail-that-must-not-leak'); } }, { ...publicDns, 'nowhere.example': [] });

    const failed = await fetchPublicPage('https://shop.example/p', transport);
    const unresolved = await fetchPublicPage('https://unknown.example/p', transport); // the resolver throws
    const noAddresses = await fetchPublicPage('https://nowhere.example/p', transport);

    for (const result of [failed, unresolved, noAddresses]) {
      expect(result).toMatchObject({ ok: false, code: 'network' });
      expect(JSON.stringify(result)).not.toContain('internal-detail');
    }
  });
});

describe('decoding a response', () => {
  it('uses the declared charset, then a charset named in the page, and never fails on an unknown one', () => {
    const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1
    expect(decodeHtmlBytes(latin1, 'text/html; charset=iso-8859-1')).toBe('café');
    expect(decodeHtmlBytes(Uint8Array.from([...encoder.encode('<meta charset="iso-8859-1">'), 0xe9]), 'text/html')).toBe('<meta charset="iso-8859-1">é');
    expect(decodeHtmlBytes(encoder.encode('café'), 'text/html; charset=utf-8')).toBe('café');
    expect(decodeHtmlBytes(encoder.encode('café'), 'text/html; charset=not-a-real-charset')).toBe('café');
  });
});
