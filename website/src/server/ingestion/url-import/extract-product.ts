/**
 * Reads product facts out of a scanned page, using ONLY structured data the page publishes:
 *
 *   1. JSON-LD `Product` (schema.org)          name, description, image, offers (price, currency, availability)
 *   2. Open Graph / `product:*` metadata       og:title, og:description, og:image, product:price:*, ...
 *   3. standard HTML metadata                  <title>, <meta name=description>, <link rel=canonical>
 *
 * There are no CSS selectors and no retailer-specific rules, and nothing is inferred: a value the
 * page does not state clearly is left out, and the candidate carries "unknown". Anything ambiguous
 * (several different prices, a price range, "19,99" that could be dollars or cents in another
 * format, a price with no currency) is treated as unknown rather than guessed.
 *
 * A page must show EVIDENCE that it is a product page: a JSON-LD Product, or `og:type=product`.
 * A page with only a title (a home page, an article, a login wall a retailer redirected us to)
 * is not turned into a product.
 *
 * Pure: no network, no database. Output is the retailer-agnostic `ExtractedProduct`; turning it
 * into an ingestion candidate is the connector's job (sources/url-import.ts).
 */
import { parsePriceToCents } from '../price';
import { cleanText } from '../text';
import { normalizeRetailerUrl } from '../url';
import { decodeEntities, linkHref, metaValue, type ScannedDocument } from './html';
import { siteKey } from './retailer-identity';

export interface ExtractedProduct {
  name: string;
  /** The listing's address: the page's own canonical URL when it is trustworthy, else the final URL. */
  url: string;
  /** `og:site_name`, used only to name a NEW retailer. */
  siteName?: string;
  /** Only the retailer's explicit item id (`product:retailer_item_id`). Never sku/mpn/gtin (see below). */
  externalId?: string;
  description?: string;
  /** Absolute image URL. Its safety is validated later by the ingestion candidate, like every image URL. */
  imageUrl?: string;
  priceCents?: number;
  currency?: string;
  availability?: 'in_stock' | 'out_of_stock';
  /** Set ONLY when the page explicitly says the product is discontinued. */
  discontinued?: true;
}

export type ExtractionResult =
  | { ok: true; product: ExtractedProduct }
  | { ok: false; reason: 'no_product_data' | 'no_name' };

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

// ---- JSON-LD ------------------------------------------------------------------------------

const PRODUCT_TYPES = new Set(['Product', 'IndividualProduct', 'ProductGroup']);

/** Some sites wrap JSON in `<!-- -->` or `//<![CDATA[ ]]>`. Anything still unparsable is ignored. */
function parseJsonLd(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^(?:<!--|\/\/\s*<!\[CDATA\[|\/\*\s*<!\[CDATA\[\s*\*\/)/, '')
    .replace(/(?:-->|\/\/\s*\]\]>|\/\*\s*\]\]>\s*\*\/)$/, '')
    .trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `https://schema.org/Product`, `schema:Product` and `Product` all mean `Product`. */
function typesOf(node: Json): string[] {
  return asList(node['@type'])
    .filter((type): type is string => typeof type === 'string')
    .map((type) => type.split(/[/#:]/).pop() ?? type);
}

/**
 * Product nodes at the top of a JSON-LD document: the root, its `@graph`, and a `mainEntity`.
 * It deliberately does NOT descend into lists, `isRelatedTo`, `isSimilarTo` and the like, so
 * a "you may also like" carousel cannot be mistaken for the page's own product.
 */
function collectProducts(value: unknown, out: Json[], depth = 0): void {
  if (depth > 3) return;
  if (Array.isArray(value)) {
    for (const item of value) collectProducts(item, out, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  if (typesOf(value).some((type) => PRODUCT_TYPES.has(type))) {
    out.push(value);
    return;
  }
  collectProducts(value['@graph'], out, depth + 1);
  collectProducts(value['mainEntity'], out, depth + 1);
}

function resolveUrl(raw: string, base: string): string | undefined {
  try {
    return new URL(raw.trim(), base).href;
  } catch {
    return undefined;
  }
}

/** Which product the page is about, or undefined when that is not clear. */
function chooseProduct(nodes: readonly Json[], addresses: readonly string[], base: string): Json | undefined {
  const unique = [...new Map(nodes.map((node) => [JSON.stringify(node), node])).values()];
  if (unique.length <= 1) return unique[0];

  const here = new Set(addresses);
  const own = unique.filter((node) => {
    const resolved = typeof node['url'] === 'string' ? resolveUrl(node['url'], base) : undefined;
    const normalized = resolved === undefined ? undefined : normalizeRetailerUrl(resolved);
    return normalized !== undefined && here.has(normalized);
  });
  return own.length === 1 ? own[0] : undefined;
}

/** schema.org text is plain text, but sites often leave entities or a little markup in it. */
function plainText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return cleanText(decodeEntities(value).replace(/<[^>]*>/g, ' '));
}

function imageOf(value: unknown): string | undefined {
  for (const item of asList(value)) {
    if (typeof item === 'string' && item.trim() !== '') return item;
    if (isRecord(item)) {
      const url = item['url'] ?? item['contentUrl'];
      if (typeof url === 'string' && url.trim() !== '') return url;
    }
  }
  return undefined;
}

// ---- offers: price, currency, availability -------------------------------------------------

interface Money {
  cents: number;
  currency: string;
}

/**
 * One price, as `Money`; `undefined` when the offer states none; `'unusable'` when it states
 * something we will not trust (unparsable, zero, fractions of a cent, no currency).
 */
function readPrice(rawPrice: unknown, rawCurrency: unknown): Money | undefined | 'unusable' {
  if (rawPrice === undefined || rawPrice === null || rawPrice === '') return undefined;
  const cents = typeof rawPrice === 'number' || typeof rawPrice === 'string' ? parsePriceToCents(rawPrice) : undefined;
  const currency = typeof rawCurrency === 'string' && /^[A-Za-z]{3}$/.test(rawCurrency.trim()) ? rawCurrency.trim().toUpperCase() : undefined;
  // 0 is what many pages print before their own script fills in the real price, so it is not a price.
  if (cents === undefined || cents === 0 || currency === undefined) return 'unusable';
  return { cents, currency };
}

/** The Offer nodes that actually carry a price (an AggregateOffer is replaced by the offers inside it). */
function collectOffers(value: unknown, out: Json[], depth = 0): void {
  if (depth > 3) return;
  for (const item of asList(value)) {
    if (!isRecord(item)) continue;
    const nested = asList(item['offers']).filter(isRecord);
    if (nested.length > 0) collectOffers(nested, out, depth + 1);
    else out.push(item);
  }
}

function schemaAvailability(value: unknown): 'in_stock' | 'out_of_stock' | 'discontinued' | 'unknown' {
  if (typeof value !== 'string') return 'unknown';
  switch ((value.split(/[/#:]/).pop() ?? '').trim().toLowerCase()) {
    case 'instock':
    case 'limitedavailability':
    case 'onlineonly':
      return 'in_stock';
    case 'outofstock':
    case 'soldout':
      return 'out_of_stock';
    case 'discontinued':
      return 'discontinued';
    default:
      return 'unknown'; // PreOrder, BackOrder, InStoreOnly, ...: not the same as "you can buy it now"
  }
}

interface OfferFacts {
  money?: Money;
  availability: 'in_stock' | 'out_of_stock' | 'discontinued' | 'unknown';
}

function offerFactsFromJsonLd(product: Json): OfferFacts {
  const offers: Json[] = [];
  collectOffers(product['offers'], offers);
  if (offers.length === 0) return { availability: 'unknown' };

  const prices = offers.map((offer): Money | undefined | 'unusable' => {
    const spec = asList(offer['priceSpecification']).filter(isRecord);
    if (spec.length > 1) return 'unusable'; // several price specifications: which one applies?
    const lowPrice = offer['lowPrice'];
    const rangeIsOnePrice = lowPrice !== undefined && String(lowPrice) === String(offer['highPrice']);
    return readPrice(offer['price'] ?? spec[0]?.['price'] ?? (rangeIsOnePrice ? lowPrice : undefined), offer['priceCurrency'] ?? spec[0]?.['priceCurrency']);
  });
  // A range (lowPrice != highPrice with no price) states no single price.
  const isRange = offers.some((offer) => offer['price'] === undefined && offer['lowPrice'] !== undefined && String(offer['lowPrice']) !== String(offer['highPrice']));

  const known = prices.filter((price): price is Money => typeof price === 'object');
  const distinct = new Set(known.map((price) => `${price.cents} ${price.currency}`));
  const money = !isRange && !prices.includes('unusable') && distinct.size === 1 ? known[0] : undefined;

  const states = new Set(offers.map((offer) => schemaAvailability(offer['availability'])));
  const [only] = [...states];
  return { ...(money ? { money } : {}), availability: states.size === 1 && only !== undefined ? only : 'unknown' };
}

function offerFactsFromOpenGraph(document: ScannedDocument): OfferFacts {
  const amount = metaValue(document, 'product:price:amount', 'og:price:amount');
  const currency = metaValue(document, 'product:price:currency', 'og:price:currency');
  const price = readPrice(amount, currency);

  const stock = (metaValue(document, 'product:availability', 'og:availability') ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  const availability = stock === 'instock' ? 'in_stock' : stock === 'outofstock' || stock === 'oos' || stock === 'soldout' ? 'out_of_stock' : stock === 'discontinued' ? 'discontinued' : 'unknown';
  return { ...(typeof price === 'object' ? { money: price } : {}), availability };
}

// ---- the listing's address -----------------------------------------------------------------

/**
 * The address to record for the offer. A page's canonical URL is preferred because it is stable
 * across tracking parameters, which makes re-importing recognise the same listing. It is used only
 * when it stays on the SAME site (a page cannot claim to be a listing on another retailer) and does
 * not point at the site's home page (a common mistake that would collapse different products).
 */
function listingUrl(document: ScannedDocument, finalUrl: URL): string {
  for (const raw of [linkHref(document, 'canonical'), metaValue(document, 'og:url')]) {
    if (raw === undefined) continue;
    const resolved = resolveUrl(raw, finalUrl.href);
    const candidate = resolved === undefined ? undefined : normalizeRetailerUrl(resolved);
    if (candidate === undefined) continue;
    const url = new URL(candidate);
    if (siteKey(url.hostname) !== siteKey(finalUrl.hostname)) continue;
    if (url.pathname === '/' && url.search === '' && finalUrl.pathname !== '/') continue;
    return candidate;
  }
  return normalizeRetailerUrl(finalUrl.href) ?? finalUrl.href;
}

// ---- entry point ---------------------------------------------------------------------------

/** `pageUrl` is the final address of the page (after redirects); relative URLs in the page resolve against it. */
export function extractProduct(document: ScannedDocument, pageUrl: string): ExtractionResult {
  const finalUrl = new URL(pageUrl);
  const url = listingUrl(document, finalUrl);

  const nodes: Json[] = [];
  for (const raw of document.jsonLd) collectProducts(parseJsonLd(raw), nodes);
  const product = chooseProduct(nodes, [normalizeRetailerUrl(finalUrl.href) ?? finalUrl.href, url], finalUrl.href);

  const ogType = (metaValue(document, 'og:type') ?? '').toLowerCase();
  const isOgProduct = ogType === 'product' || ogType === 'og:product' || ogType.startsWith('product.');
  if (product === undefined && !isOgProduct) return { ok: false, reason: 'no_product_data' };

  const name =
    plainText(product?.['name']) ??
    cleanText(metaValue(document, 'og:title', 'twitter:title')) ??
    cleanText(document.title);
  if (name === undefined) return { ok: false, reason: 'no_name' };

  const description =
    plainText(product?.['description']) ??
    plainText(metaValue(document, 'og:description', 'description', 'twitter:description'));

  const rawImage =
    (product === undefined ? undefined : imageOf(product['image'])) ??
    metaValue(document, 'og:image:secure_url', 'og:image', 'twitter:image') ??
    linkHref(document, 'image_src');
  const imageUrl = rawImage === undefined ? undefined : resolveUrl(rawImage, finalUrl.href);

  // If the page's Product states offers at all, only those are used; Open Graph fills in otherwise.
  const facts = product !== undefined && product['offers'] !== undefined ? offerFactsFromJsonLd(product) : offerFactsFromOpenGraph(document);

  // sku, mpn and gtin are NOT used as a listing id: they often identify a model or a variant, and a
  // shared one would make two different listings look like one. Only an explicit retailer item id counts.
  const externalId = cleanText(metaValue(document, 'product:retailer_item_id'));
  const siteName = cleanText(metaValue(document, 'og:site_name'));

  return {
    ok: true,
    product: {
      name,
      url,
      ...(siteName !== undefined ? { siteName } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(facts.money ? { priceCents: facts.money.cents, currency: facts.money.currency } : {}),
      ...(facts.availability === 'in_stock' || facts.availability === 'out_of_stock' ? { availability: facts.availability } : {}),
      ...(facts.availability === 'discontinued' ? { discontinued: true as const } : {}),
    },
  };
}
