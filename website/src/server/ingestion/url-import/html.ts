/**
 * A minimal, dependency-free HTML scanner: it collects only what metadata extraction needs
 * (`<meta>`, `<link>`, `<title>` and `application/ld+json` blocks) and nothing else.
 *
 * It is NOT a browser and NOT a full HTML parser:
 *  - no script is ever executed. `<script>` bodies are skipped, except JSON-LD blocks, whose text
 *    is only handed on as a string to be `JSON.parse`d (data, never code).
 *  - it walks the markup once, in order, so text inside comments, `<script>`, `<style>` and
 *    `<textarea>` is never mistaken for a tag.
 *  - `<meta>` and `<link>` are only collected from the head part of the page (before `<body>`),
 *    so page content further down cannot pose as page metadata. JSON-LD is collected anywhere,
 *    because sites commonly place it at the end of the body.
 *  - the response is already size-limited by the fetcher; the scan itself is a single linear pass.
 */

export interface ScannedDocument {
  title?: string;
  /** `<meta property|name=... content=...>`, keys lower-cased. Repeats are kept in page order. */
  metas: { key: string; content: string }[];
  /** `<link rel=... href=...>`, `rel` lower-cased. */
  links: { rel: string; href: string }[];
  /** Raw text of each JSON-LD block, unparsed. */
  jsonLd: string[];
}

/** Sanity bounds so a hostile page cannot make the result unreasonably large. */
const MAX_TAG_LENGTH = 16_384;
const MAX_JSON_LD_BLOCKS = 40;
const MAX_JSON_LD_LENGTH = 1_000_000;
const MAX_METAS = 400;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', deg: '°', times: '×',
};

/** Decodes the common HTML entities (named and numeric). Unknown entities are left exactly as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

interface OpenTag {
  name: string;
  attributes: Map<string, string>;
  /** Index just after the closing `>`. */
  end: number;
}

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';

/** Reads a start tag beginning at `html[start] === '<'`. Attribute values are entity-decoded; the first repeat wins. */
function readOpenTag(html: string, start: number): OpenTag | undefined {
  let i = start + 1;
  let name = '';
  while (i < html.length && !isSpace(html[i]) && html[i] !== '>' && html[i] !== '/') {
    name += html[i];
    i += 1;
  }
  if (name === '') return undefined;

  const attributes = new Map<string, string>();
  const limit = Math.min(html.length, start + MAX_TAG_LENGTH);
  while (i < limit) {
    while (i < limit && (isSpace(html[i]) || html[i] === '/')) i += 1;
    if (html[i] === '>') return { name: name.toLowerCase(), attributes, end: i + 1 };
    if (i >= limit) break;

    let attribute = '';
    while (i < limit && !isSpace(html[i]) && html[i] !== '=' && html[i] !== '>' && html[i] !== '/') {
      attribute += html[i];
      i += 1;
    }
    while (i < limit && isSpace(html[i])) i += 1;

    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < limit && isSpace(html[i])) i += 1;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close === -1 || close >= limit) return undefined; // unterminated: not a usable tag
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        while (i < limit && !isSpace(html[i]) && html[i] !== '>') {
          value += html[i];
          i += 1;
        }
      }
    }
    const key = attribute.toLowerCase();
    if (key !== '' && !attributes.has(key)) attributes.set(key, decodeEntities(value));
  }
  return undefined;
}

/**
 * The text between `from` and the end tag `</name>`, and the index just after that tag; undefined if the
 * element is never closed. `lowerHtml` is the same text lower-cased, so the search ignores case.
 */
function readRawText(html: string, lowerHtml: string, from: number, name: string): { text: string; end: number } | undefined {
  const close = lowerHtml.indexOf(`</${name}`, from);
  if (close === -1) return undefined;
  const gt = html.indexOf('>', close);
  return { text: html.slice(from, close), end: gt === -1 ? html.length : gt + 1 };
}

export function scanHtml(html: string): ScannedDocument {
  const document: ScannedDocument = { metas: [], links: [], jsonLd: [] };
  // Lower-casing once lets raw-text searches (`</script`) be case-insensitive without a regex per tag.
  // ASCII only: `toLowerCase()` can change a string's length (e.g. "İ"), which would misalign the indexes.
  const lowerHtml = html.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
  let inHead = true;
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    const next = html[lt + 1];

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    if (next === '!' || next === '?') {
      const close = html.indexOf('>', lt);
      i = close === -1 ? html.length : close + 1;
      continue;
    }
    if (next === '/') {
      const close = html.indexOf('>', lt);
      i = close === -1 ? html.length : close + 1;
      continue;
    }
    if (next === undefined || !/[a-zA-Z]/.test(next)) {
      i = lt + 1; // a stray "<" in text
      continue;
    }

    const tag = readOpenTag(html, lt);
    if (!tag) {
      i = lt + 1;
      continue;
    }
    i = tag.end;

    switch (tag.name) {
      case 'script': {
        const closeAt = lowerHtml.indexOf('</script', tag.end);
        const end = closeAt === -1 ? html.length : closeAt;
        const type = (tag.attributes.get('type') ?? '').toLowerCase().split(';')[0]?.trim();
        if (type === 'application/ld+json' && document.jsonLd.length < MAX_JSON_LD_BLOCKS && end - tag.end <= MAX_JSON_LD_LENGTH) {
          document.jsonLd.push(html.slice(tag.end, end));
        }
        const gt = closeAt === -1 ? -1 : html.indexOf('>', closeAt);
        i = closeAt === -1 || gt === -1 ? html.length : gt + 1;
        break;
      }
      case 'style':
      case 'textarea': {
        const raw = readRawText(html, lowerHtml, tag.end, tag.name);
        i = raw ? raw.end : html.length;
        break;
      }
      case 'title': {
        const raw = readRawText(html, lowerHtml, tag.end, 'title');
        if (raw && document.title === undefined && inHead) document.title = decodeEntities(raw.text);
        i = raw ? raw.end : html.length;
        break;
      }
      case 'meta': {
        const content = tag.attributes.get('content');
        const key = tag.attributes.get('property') ?? tag.attributes.get('name');
        if (inHead && content !== undefined && key !== undefined && document.metas.length < MAX_METAS) {
          document.metas.push({ key: key.trim().toLowerCase(), content });
        }
        break;
      }
      case 'link': {
        const rel = tag.attributes.get('rel');
        const href = tag.attributes.get('href');
        if (inHead && rel !== undefined && href !== undefined) document.links.push({ rel: rel.trim().toLowerCase(), href });
        break;
      }
      case 'body':
        inHead = false;
        break;
      default:
        break;
    }
  }
  return document;
}

/** The first meta value for any of `keys`, in the order the keys are given. Blank values are skipped. */
export function metaValue(document: ScannedDocument, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const found = document.metas.find((meta) => meta.key === key && meta.content.trim() !== '');
    if (found) return found.content.trim();
  }
  return undefined;
}

/** The href of the first `<link rel=...>` whose rel list contains `rel`. */
export function linkHref(document: ScannedDocument, rel: string): string | undefined {
  const found = document.links.find((link) => link.rel.split(/\s+/).includes(rel) && link.href.trim() !== '');
  return found?.href.trim();
}

// ---- decoding the response bytes ------------------------------------------------------------

function charsetFromContentType(contentType: string | undefined): string | undefined {
  return contentType && /charset\s*=\s*"?([^\s;"]+)/i.exec(contentType)?.[1];
}

/** `<meta charset=...>` / `<meta http-equiv content="...charset=...">` from the first bytes, read as Latin-1. */
function sniffCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  return /<meta[^>]*charset\s*=\s*["']?\s*([a-z0-9_.:-]+)/i.exec(head)?.[1];
}

/** Decodes an HTML response body using its declared charset, else a sniffed one, else UTF-8. Never throws. */
export function decodeHtmlBytes(bytes: Uint8Array, contentType: string | undefined): string {
  for (const label of [charsetFromContentType(contentType), sniffCharset(bytes), 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // an unknown encoding label: try the next candidate
    }
  }
  return '';
}
