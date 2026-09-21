import { createNodeTransport } from './node-transport';
import { fetchPublicPage, type FetchResult, type PageTransport } from './safe-fetch';

export type PageFetcher = (url: string) => Promise<FetchResult>;

/**
 * The real page fetcher: the safe fetcher on the Node transport. The transport is created on first
 * use, once. If it cannot be created (not running on Node), every fetch reports a plain failure
 * instead of falling back to something less careful.
 */
export function createPageFetcher(): PageFetcher {
  let transport: Promise<PageTransport> | undefined;
  return async (url) => {
    try {
      transport ??= createNodeTransport();
      return await fetchPublicPage(url, await transport);
    } catch {
      return { ok: false, code: 'network', message: 'Fetching pages is not available in this environment.' };
    }
  };
}
