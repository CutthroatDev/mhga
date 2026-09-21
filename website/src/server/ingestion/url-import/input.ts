/**
 * Turns what a reviewer submitted into the ONE internal list the importer works from.
 *
 *   textarea (one URL per line)  --splitUrlLines-->  raw strings  \
 *                                                                  >--prepareUrls-->  entries
 *   CSV upload (`url` column)    --parseCsvUrls---->  raw strings  /
 *
 * Both input methods end up as plain strings, and `prepareUrls` is the only place that decides
 * what happens to each one, so a URL is treated identically however it arrived.
 *
 * Everything here is pure: no network, no database. Rejecting an unusable URL happens BEFORE any
 * fetching, and identical URLs are collapsed so each is fetched at most once.
 */
import { normalizeRetailerUrl } from '../url';
import { urlBlockReason } from './public-address';

/** The most URLs one submission may contain (each one is a network request). */
export const MAX_IMPORT_URLS = 50;

/** Longer than this is not a product URL a retailer would serve. */
export const MAX_URL_LENGTH = 2048;

/** One URL per line: whitespace is trimmed, blank lines are ignored. */
export function splitUrlLines(text: string): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export type SkipReason = 'invalid_url' | 'unsafe_address' | 'duplicate';

/** What to do with one submitted line, in submission order. */
export type PreparedEntry =
  | { kind: 'fetch'; input: string; url: string }
  | { kind: 'skip'; input: string; reason: SkipReason };

/**
 * Normalizes and screens every submitted URL.
 *
 *  - malformed or non-http(s) URLs, credentials in the URL, whitespace: `invalid_url`
 *  - localhost, private/internal addresses, odd ports: `unsafe_address` (never fetched)
 *  - a URL that normalizes to one already accepted: `duplicate` (only the first is fetched)
 *
 * The normal form is the same one ingestion uses (`normalizeRetailerUrl`: trimmed, lower-case
 * host, no `#fragment`), so "the same URL" means the same thing here and in the engine.
 */
export function prepareUrls(inputs: readonly string[]): PreparedEntry[] {
  const seen = new Set<string>();
  return inputs.map((input): PreparedEntry => {
    const url = input.length <= MAX_URL_LENGTH ? normalizeRetailerUrl(input) : undefined;
    if (url === undefined) return { kind: 'skip', input, reason: 'invalid_url' };
    if (urlBlockReason(new URL(url)) !== undefined) return { kind: 'skip', input, reason: 'unsafe_address' };
    if (seen.has(url)) return { kind: 'skip', input, reason: 'duplicate' };
    seen.add(url);
    return { kind: 'fetch', input, url };
  });
}
