/**
 * The one place that decides whether an externally referenced image URL is safe to put in a
 * public model. Same defensive philosophy as purchase URLs: only http(s) is public-safe.
 *
 * Allowed:  https://example.com/image.jpg   http://example.com/image.png
 * Rejected: javascript:, data:, file:, ftp:, anything not http(s), malformed URLs, empty or
 *           whitespace-only strings, and URLs containing whitespace or control characters.
 *
 * It NEVER rewrites: a safe URL is returned exactly as stored, and anything else becomes
 * `undefined`. Rejecting whitespace (rather than trimming) matters: URL parsers silently strip
 * leading/trailing spaces and embedded tabs/newlines, which would otherwise let a mangled
 * value through in a "fixed" form nobody stored.
 *
 * An invalid image must not hide an otherwise eligible product: callers treat `undefined` as
 * "no image", and the existing image placeholder renders. Nothing is fetched or proxied.
 *
 * Do not repeat this check in pages or components; call this from the public mappers.
 *
 * The rule itself is `toSafeHttpUrl`. It is exported because the same "only http(s), never
 * repaired" policy applies to retailer purchase URLs (ingestion uses it for those), and there
 * must be exactly one definition of it. `toPublicImageUrl` is the image-flavoured name.
 */

// Explicit `http(s)://` followed by a host character. Rejects `https:example.com`,
// `https:\\host`, `https:///x` and the like, which lenient URL parsers would "repair".
const HTTP_URL_START = /^https?:\/\/[^/\s]/i;

// Space, ASCII control characters, DEL, and C1 controls.
const WHITESPACE_OR_CONTROL = /[\u0000- \u007f-\u009f]/;

export function toSafeHttpUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (WHITESPACE_OR_CONTROL.test(value)) return undefined;
  if (!HTTP_URL_START.test(value)) return undefined;

  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

export const toPublicImageUrl = toSafeHttpUrl;
