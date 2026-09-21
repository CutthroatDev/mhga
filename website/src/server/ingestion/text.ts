/** Small text helpers shared by candidate validation and product creation. Pure functions. */

// ASCII control characters (including tab/newline) and DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/g;

/**
 * Single-line text: control characters and runs of whitespace become one space, ends trimmed.
 * Returns undefined for non-strings and for text that is empty afterwards.
 */
export function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Shortens to at most `max` characters, preferring a word boundary, with an ellipsis when it cut. */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = max - 1; // leave one character for the ellipsis
  const cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/** URL-safe slug base: lowercase a-z, 0-9 and hyphens, at most 80 characters, never empty. */
export function slugBase(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'product';
}

/** A short, stable (non-cryptographic) fingerprint of a string, used only to disambiguate slugs. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5; // FNV-1a, 32 bit
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(6, '0');
}
