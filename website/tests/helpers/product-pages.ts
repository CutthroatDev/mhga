/**
 * Fixture HTML and fake page fetchers for the URL importer tests. Nothing here touches a network:
 * pages are strings, and a "fetcher" is a lookup table.
 */
import type { FetchResult } from '../../src/server/ingestion/url-import/safe-fetch';
import type { PageFetcher } from '../../src/server/ingestion/url-import/page-fetcher';

export interface PageSpec {
  name?: string;
  /** The page's canonical URL (`<link rel=canonical>`). */
  canonical?: string;
  price?: string | number;
  currency?: string;
  /** schema.org availability, e.g. `InStock`. */
  availability?: string;
  image?: string;
  description?: string;
  siteName?: string;
  /** `product:retailer_item_id`. */
  retailerItemId?: string;
}

/** A page that publishes a schema.org Product as JSON-LD, plus a little Open Graph. */
export function productPage(spec: PageSpec = {}): string {
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: spec.name ?? 'Glow Skeleton 5ft',
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    ...(spec.image !== undefined ? { image: spec.image } : {}),
  };
  if (spec.price !== undefined || spec.availability !== undefined) {
    product['offers'] = {
      '@type': 'Offer',
      ...(spec.price !== undefined ? { price: spec.price } : {}),
      ...(spec.currency !== undefined ? { priceCurrency: spec.currency } : spec.price !== undefined ? { priceCurrency: 'USD' } : {}),
      ...(spec.availability !== undefined ? { availability: `https://schema.org/${spec.availability}` } : {}),
    };
  }
  return page(
    [
      spec.canonical ? `<link rel="canonical" href="${spec.canonical}">` : '',
      spec.siteName ? `<meta property="og:site_name" content="${spec.siteName}">` : '',
      spec.retailerItemId ? `<meta property="product:retailer_item_id" content="${spec.retailerItemId}">` : '',
    ].join('\n'),
    `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
  );
}

/** A complete HTML document around some head markup and body markup. */
export function page(head = '', body = '<h1>Shop</h1>'): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Some Shop</title>${head}</head><body>${body}</body></html>`;
}

export const ok = (finalUrl: string, html: string): FetchResult => ({ ok: true, finalUrl, html, truncated: false });
export const failure = (code: 'blocked' | 'redirect' | 'timeout' | 'http' | 'not_html' | 'network', message: string): FetchResult => ({ ok: false, code, message });

type Reply = FetchResult | Error | ((url: string) => FetchResult | Promise<FetchResult>);

/** A fetcher backed by a table of replies keyed by the exact URL requested; it records every call. */
export function fakeFetcher(replies: Record<string, Reply>): { fetchPage: PageFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetchPage: PageFetcher = async (url) => {
    calls.push(url);
    const reply = replies[url];
    if (reply === undefined) return failure('network', 'The page could not be retrieved.');
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(url) : reply;
  };
  return { fetchPage, calls };
}
