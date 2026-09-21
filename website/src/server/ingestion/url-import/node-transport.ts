/**
 * The real network transport for the URL importer. NODE ONLY, on purpose.
 *
 * Why not `fetch`: the SSRF rules need to (a) resolve a host name and vet every address, and
 * (b) connect to exactly the address that was vetted. Neither is possible with `fetch`, and the
 * Workers runtime has no DNS API at all. `node:https` lets us pass a `lookup` that always answers
 * with the vetted address, so the connection cannot go anywhere else (TLS still verifies the
 * certificate against the host NAME).
 *
 * This is acceptable here because the importer is part of the LOCAL-ONLY admin: it runs in the
 * dev server (Node) and is refused in every production build. The Node modules are loaded lazily
 * by name at call time (see `loadBuiltin`), so nothing in the public bundle depends on them, and if they are
 * unavailable (for example in a Worker) `createNodeTransport` throws and every URL is reported
 * as "could not be retrieved": it fails closed, never open.
 *
 * The project has no `@types/node` (and does not need one for anything else), so the few Node
 * APIs used are described by the small structural types below instead of adding a dependency.
 *
 * Redirects are NOT followed here (Node does not follow them); safe-fetch.ts follows them itself
 * so that every hop is validated.
 */
import type { PageTransport, TransportRequest, TransportResponse } from './safe-fetch';

// ---- the slice of Node this file uses ------------------------------------------------------

type Listener = (...args: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Emitter {
  on(event: string, listener: Listener): unknown;
  destroy(): unknown;
}
interface Incoming extends Emitter {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  /** True once the whole response arrived. */
  complete: boolean;
  pipe(destination: Emitter): Emitter;
}
interface Outgoing extends Emitter {
  end(): void;
}
interface HttpModule {
  request(options: Record<string, unknown>, onResponse: (response: Incoming) => void): Outgoing;
}
interface NodeModules {
  dns: { lookup(hostname: string, options: { all: true }): Promise<{ address: string; family: number }[]> };
  http: HttpModule;
  https: HttpModule;
  zlib: { createUnzip(): Emitter; createBrotliDecompress(): Emitter };
}

/**
 * A Node built-in by name. `process.getBuiltinModule` (Node 20.16+/22.3+) hands the module over
 * directly, with no bundler or module-runner involved, so it behaves the same in the dev server,
 * in scripts and in tests. Older Node falls back to a dynamic import by name. Where neither works
 * (a Worker without these modules) the caller gets an error and fails closed.
 */
async function loadBuiltin(name: string): Promise<unknown> {
  const node = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const builtin = node?.getBuiltinModule?.call(node, name);
  if (builtin !== undefined && builtin !== null) return builtin;
  return import(/* @vite-ignore */ name);
}

async function loadNodeModules(): Promise<NodeModules> {
  const [dns, http, https, zlib] = await Promise.all([
    loadBuiltin('node:dns/promises'),
    loadBuiltin('node:http'),
    loadBuiltin('node:https'),
    loadBuiltin('node:zlib'),
  ]);
  return { dns, http, https, zlib } as NodeModules;
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

// ---- the transport -------------------------------------------------------------------------

export async function createNodeTransport(): Promise<PageTransport> {
  const node = await loadNodeModules();

  return {
    async resolve(hostname) {
      const results = await node.dns.lookup(hostname, { all: true });
      // IPv4 first: a machine without IPv6 connectivity should not pick an address it cannot reach.
      return results.sort((a, b) => a.family - b.family).map((result) => result.address);
    },

    get(request: TransportRequest): Promise<TransportResponse> {
      const { url, address } = request;
      const secure = url.protocol === 'https:';
      const family = address.includes(':') ? 6 : 4;

      return new Promise((resolve, reject) => {
        const outgoing = (secure ? node.https : node.http).request(
          {
            hostname: url.hostname.replace(/^\[|\]$/g, ''),
            port: url.port === '' ? (secure ? 443 : 80) : Number(url.port),
            path: `${url.pathname}${url.search}`,
            method: 'GET',
            headers: { ...request.headers, 'Accept-Encoding': 'gzip, deflate, br' },
            agent: false, // one connection per request: nothing pooled, nothing kept alive
            signal: request.signal,
            // Always answer with the address that was already checked, whatever the name resolves to now.
            lookup: (_name: string, options: { all?: boolean }, callback: Listener) => {
              if (options?.all) callback(null, [{ address, family }]);
              else callback(null, address, family);
            },
          },
          (incoming) => {
            const headers: Record<string, string | undefined> = {};
            for (const [name, value] of Object.entries(incoming.headers)) {
              headers[name] = Array.isArray(value) ? value.join(', ') : value;
            }

            resolve({
              status: incoming.statusCode ?? 0,
              headers,
              dispose: () => {
                incoming.destroy();
                outgoing.destroy();
              },
              readBody: (maxBytes) =>
                new Promise((resolveBody, rejectBody) => {
                  const encoding = (headers['content-encoding'] ?? '').trim().toLowerCase();
                  let decoder: Emitter | undefined;
                  if (encoding === 'gzip' || encoding === 'x-gzip' || encoding === 'deflate') decoder = node.zlib.createUnzip();
                  else if (encoding === 'br') decoder = node.zlib.createBrotliDecompress();
                  else if (encoding !== '' && encoding !== 'identity') {
                    incoming.destroy();
                    rejectBody(new Error('unsupported content encoding'));
                    return;
                  }

                  const chunks: Uint8Array[] = [];
                  let total = 0;
                  let settled = false;
                  const stop = (): void => {
                    settled = true;
                    incoming.destroy();
                    decoder?.destroy();
                  };
                  const finish = (truncated: boolean): void => {
                    if (settled) return;
                    stop();
                    resolveBody({ bytes: concat(chunks, total), truncated });
                  };
                  const failWith = (error: Error): void => {
                    if (settled) return;
                    stop();
                    rejectBody(error);
                  };

                  // The limit applies to the DECOMPRESSED bytes, so a compression bomb cannot exceed it.
                  const source: Emitter = decoder ? incoming.pipe(decoder) : incoming;
                  source.on('data', (chunk: Uint8Array) => {
                    const room = maxBytes - total;
                    if (chunk.length > room) {
                      chunks.push(chunk.subarray(0, room));
                      total += room;
                      finish(true);
                    } else {
                      chunks.push(chunk);
                      total += chunk.length;
                    }
                  });
                  source.on('end', () => finish(false));
                  source.on('error', failWith);
                  incoming.on('error', failWith);
                  incoming.on('close', () => {
                    if (!incoming.complete) failWith(new Error('connection closed early'));
                  });
                }),
            });
          },
        );
        outgoing.on('error', reject);
        outgoing.end();
      });
    },
  };
}
