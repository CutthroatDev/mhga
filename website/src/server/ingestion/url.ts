/**
 * Retailer URL policy for ingestion: what may be stored as an offer's purchase URL, and the
 * ONE normal form used to recognise "the same listing".
 *
 * Safety comes from the shared http(s) rule (`toSafeHttpUrl`, the same one images use), plus:
 * URLs with embedded credentials are refused.
 *
 * Normalization is deliberately conservative. Two different listings must never collapse into
 * one, so only changes that cannot alter what the retailer serves are made:
 *   - surrounding whitespace is trimmed
 *   - scheme and host are lower-cased, a default port is dropped, an empty path becomes `/`
 *     (this is what the URL parser does)
 *   - the `#fragment` is dropped (browsers never send it to the server)
 * Everything else is left exactly as given: path case, query parameters and their order, and
 * tracking parameters. Stripping those needs retailer knowledge, so it belongs in a connector.
 */
import { toSafeHttpUrl } from '../domain/image-url';

export function normalizeRetailerUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const safe = toSafeHttpUrl(value.trim());
  if (!safe) return undefined;

  const url = new URL(safe);
  if (url.username !== '' || url.password !== '') return undefined;
  url.hash = '';
  return url.href;
}
