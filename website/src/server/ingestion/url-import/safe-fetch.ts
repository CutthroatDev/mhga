/**
 * Fetches ONE web page on behalf of a reviewer, defensively (SSRF protection is the point).
 *
 * The rules, applied to the submitted URL and again to EVERY redirect target:
 *
 *   1. the URL itself must be acceptable (`urlBlockReason`): http(s), no credentials, port 80/443,
 *      not localhost / a local-only name / a non-public IP literal
 *   2. a host NAME is resolved, and EVERY address it resolves to must be public. One private
 *      answer among public ones refuses the host (a mixed answer is how rebinding tricks look)
 *   3. the connection is then made to the address that was just checked (`get({ address })`), not to
 *      the name, so the check and the connection cannot disagree (no DNS rebinding window)
 *   4. redirects are followed by hand, at most `maxRedirects`, each hop going through 1-3 again,
 *      so a public URL cannot bounce the importer onto an internal address
 *
 * Also enforced: a total time limit for the whole page (including every redirect), a byte limit
 * on the body (the rest is discarded), and only HTML responses are read. No cookies, no
 * credentials, no scripts: only the bytes are read and decoded.
 *
 * All network access goes through `PageTransport`, so the policy above is testable without a
 * network. The real transport is in node-transport.ts.
 *
 * Failures are reported as a short code and a fixed, safe message. Nothing from the remote
 * response (body, headers, error text) is ever put in a message.
 */
import { decodeHtmlBytes } from './html';
import { isIpLiteral, isPublicIpAddress, urlBlockReason } from './public-address';

export const FETCH_LIMITS = {
  /** Time allowed for one page, redirects included. */
  timeoutMs: 10_000,
  /** Body bytes read from a page; anything beyond is discarded (metadata lives near the top). */
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
} as const;

export interface TransportRequest {
  url: URL;
  /** The already-verified public IP to connect to. The URL's host name is only used for TLS and the Host header. */
  address: string;
  signal: AbortSignal;
  headers: Record<string, string>;
}

export interface TransportResponse {
  status: number;
  /** Header names lower-cased. */
  headers: Record<string, string | undefined>;
  /** Reads (and, if compressed, decompresses) at most `maxBytes`; reports whether more was discarded. */
  readBody(maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }>;
  /** Abandon the response without reading it. */
  dispose(): void;
}

export interface PageTransport {
  /** Every address a host name resolves to. May throw when it does not resolve. */
  resolve(hostname: string): Promise<readonly string[]>;
  get(request: TransportRequest): Promise<TransportResponse>;
}

export type FetchFailureCode = 'blocked' | 'redirect' | 'timeout' | 'http' | 'not_html' | 'network';

export type FetchResult =
  | { ok: true; /** The address of the page actually read (after redirects). */ finalUrl: string; html: string; truncated: boolean }
  | { ok: false; code: FetchFailureCode; message: string };

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

/** Identifies the importer honestly. It does not pretend to be a browser. */
const REQUEST_HEADERS = {
  'User-Agent': 'MHGA-Product-Importer/1.0 (reviewer-initiated page fetch; reads product metadata only)',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  'Accept-Language': 'en-US,en;q=0.8',
} as const;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_TYPE = /^(text\/html|application\/xhtml\+xml)\b/i;

const fail = (code: FetchFailureCode, message: string): FetchResult => ({ ok: false, code, message });

export async function fetchPublicPage(startUrl: string, transport: PageTransport, options: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? FETCH_LIMITS.timeoutMs;
  const maxBytes = options.maxBytes ?? FETCH_LIMITS.maxBytes;
  const maxRedirects = options.maxRedirects ?? FETCH_LIMITS.maxRedirects;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let current: URL;
    try {
      current = new URL(startUrl);
    } catch {
      return fail('blocked', 'This is not a valid web address.');
    }

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const blockedMessage =
        hop === 0 ? 'This address is not a public web address, so it was not requested.' : 'A redirect pointed to an address that is not a public web address, so it was not followed.';

      if (urlBlockReason(current) !== undefined) return fail('blocked', blockedMessage);

      let addresses: readonly string[];
      if (isIpLiteral(current.hostname)) {
        addresses = [current.hostname.replace(/^\[|\]$/g, '')]; // already vetted as public by urlBlockReason
      } else {
        try {
          addresses = await transport.resolve(current.hostname);
        } catch {
          return fail(controller.signal.aborted ? 'timeout' : 'network', controller.signal.aborted ? 'The site did not respond in time.' : 'The site name could not be resolved.');
        }
        if (addresses.length === 0) return fail('network', 'The site name could not be resolved.');
        if (!addresses.every(isPublicIpAddress)) return fail('blocked', blockedMessage);
      }

      const response = await transport.get({
        url: current,
        address: addresses[0] as string,
        signal: controller.signal,
        headers: { ...REQUEST_HEADERS },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        response.dispose();
        const location = response.headers['location'];
        if (!location) return fail('redirect', 'The site redirected without saying where.');
        if (hop === maxRedirects) return fail('redirect', 'The site redirected too many times.');
        try {
          current = new URL(location, current);
        } catch {
          return fail('redirect', 'The site redirected to an address that is not valid.');
        }
        continue; // the next iteration re-validates the target from scratch
      }

      if (response.status < 200 || response.status >= 300) {
        response.dispose();
        return fail('http', `The site answered with HTTP ${response.status}.`);
      }

      const contentType = response.headers['content-type'];
      if (!contentType || !HTML_TYPE.test(contentType.trim())) {
        response.dispose();
        return fail('not_html', 'The address did not return a web page.');
      }

      const { bytes, truncated } = await response.readBody(maxBytes);
      return { ok: true, finalUrl: current.href, html: decodeHtmlBytes(bytes, contentType), truncated };
    }
    return fail('redirect', 'The site redirected too many times.');
  } catch {
    // Whatever the transport threw is deliberately not reported: it can contain remote or internal detail.
    return controller.signal.aborted
      ? fail('timeout', 'The site did not respond in time.')
      : fail('network', 'The connection failed or was interrupted.');
  } finally {
    clearTimeout(timer);
    controller.abort(); // release anything still open
  }
}
