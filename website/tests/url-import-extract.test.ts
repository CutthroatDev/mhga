/**
 * Reading product facts from page markup: structured data first (JSON-LD, then Open Graph and
 * standard metadata), and NEVER guessing. Anything the page does not state clearly must come out
 * as "unknown". All inputs are inline HTML fixtures.
 */
import { describe, expect, it } from 'vitest';
import { validateCandidate } from '../src/server/ingestion/candidate';
import { extractProduct, type ExtractedProduct } from '../src/server/ingestion/url-import/extract-product';
import { scanHtml } from '../src/server/ingestion/url-import/html';
import { describeRetailer, retailerSlugForSite, siteKey } from '../src/server/ingestion/url-import/retailer-identity';
import { createUrlImportSource } from '../src/server/ingestion/sources/url-import';
import { page } from './helpers/product-pages';

const PAGE_URL = 'https://shop.example/p/glow-skeleton';

const extract = (html: string, url = PAGE_URL) => extractProduct(scanHtml(html), url);
const jsonLd = (data: unknown): string => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const product = (html: string, url = PAGE_URL): ExtractedProduct => {
  const result = extract(html, url);
  if (!result.ok) throw new Error(`expected a product, got ${result.reason}`);
  return result.product;
};
/** A page whose only structured data is a Product with this offer(s). */
const withOffers = (offers: unknown) => product(page('', jsonLd({ '@context': 'https://schema.org', '@type': 'Product', name: 'Thing', offers })));

describe('JSON-LD Product data', () => {
  it('extracts name, description, image, price, currency and availability', () => {
    const html = page(
      '<link rel="canonical" href="https://shop.example/p/glow-skeleton?utm_source=x">',
      jsonLd({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Glow Skeleton 5ft',
        description: 'A <b>glowing</b> skeleton &amp; more',
        image: ['/img/a.jpg', '/img/b.jpg'],
        offers: { '@type': 'Offer', price: '29.99', priceCurrency: 'usd', availability: 'https://schema.org/InStock' },
      }),
    );

    expect(extract(html)).toEqual({
      ok: true,
      product: {
        name: 'Glow Skeleton 5ft',
        url: 'https://shop.example/p/glow-skeleton?utm_source=x', // the page's own canonical address, on the same site
        description: 'A glowing skeleton & more',
        imageUrl: 'https://shop.example/img/a.jpg', // relative URLs resolve against the page
        priceCents: 2999,
        currency: 'USD',
        availability: 'in_stock',
      },
    });
  });

  it('finds a Product in an @graph, in a list of types, and as a mainEntity', () => {
    const graph = jsonLd({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', name: 'Shop' }, { '@type': ['Product', 'Thing'], name: 'In Graph' }] });
    const main = jsonLd({ '@type': 'WebPage', mainEntity: { '@type': 'https://schema.org/Product', name: 'Main Entity' } });
    const bare = jsonLd([{ '@type': 'BreadcrumbList' }, { '@type': 'schema:Product', name: 'In Array' }]);

    expect(product(page('', graph)).name).toBe('In Graph');
    expect(product(page('', main)).name).toBe('Main Entity');
    expect(product(page('', bare)).name).toBe('In Array');
  });

  it('accepts JSON-LD wrapped in comment or CDATA markers, and JSON-LD placed in the body', () => {
    const wrapped = `<script type="application/ld+json">//<![CDATA[\n${JSON.stringify({ '@type': 'Product', name: 'Wrapped' })}\n//]]></script>`;
    const commented = `<script type="application/ld+json"><!-- ${JSON.stringify({ '@type': 'Product', name: 'Commented' })} --></script>`;
    expect(product(page(wrapped)).name).toBe('Wrapped');
    expect(product(page(commented)).name).toBe('Commented');
    expect(product(page('', jsonLd({ '@type': 'Product', name: 'In Body' }))).name).toBe('In Body');
  });

  it('does not pick a product out of a list, a carousel, or several products it cannot tell apart', () => {
    const carousel = jsonLd({ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { '@type': 'Product', name: 'Other' } }] });
    expect(extract(page('', carousel))).toEqual({ ok: false, reason: 'no_product_data' });

    const two = [jsonLd({ '@type': 'Product', name: 'First' }), jsonLd({ '@type': 'Product', name: 'Second' })].join('');
    expect(extract(page('', two))).toEqual({ ok: false, reason: 'no_product_data' }); // ambiguous, and no other evidence

    // The one whose url is this page is the page's product.
    const identified = [jsonLd({ '@type': 'Product', name: 'Related', url: 'https://shop.example/p/other' }), jsonLd({ '@type': 'Product', name: 'This One', url: PAGE_URL })].join('');
    expect(product(page('', identified)).name).toBe('This One');

    // The same Product published twice is not ambiguous.
    const same = jsonLd({ '@type': 'Product', name: 'Twice' });
    expect(product(page('', same + same)).name).toBe('Twice');
  });

  it('never takes a listing id from sku, mpn or gtin (they identify models and variants, not listings)', () => {
    const result = product(page('', jsonLd({ '@type': 'Product', name: 'Thing', sku: 'SKU-1', mpn: 'M-1', gtin13: '0123456789012', productID: 'P-1' })));
    expect(result.externalId).toBeUndefined();
  });
});

describe('Open Graph and standard metadata', () => {
  it('falls back to Open Graph product metadata when there is no JSON-LD', () => {
    const html = page(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Witch&#39;s Hat &amp; Broom">
      <meta property="og:description" content="Pointy.">
      <meta property="og:image" content="//cdn.shop.example/hat.jpg">
      <meta property="og:site_name" content="Shop Example">
      <meta property="product:price:amount" content="19.99">
      <meta property="product:price:currency" content="USD">
      <meta property="product:availability" content="out of stock">
      <meta property="product:retailer_item_id" content="HAT-7">`);

    expect(extract(html)).toEqual({
      ok: true,
      product: {
        name: "Witch's Hat & Broom",
        url: PAGE_URL,
        siteName: 'Shop Example',
        externalId: 'HAT-7', // an explicit retailer item id is a reliable identity
        description: 'Pointy.',
        imageUrl: 'https://cdn.shop.example/hat.jpg',
        priceCents: 1999,
        currency: 'USD',
        availability: 'out_of_stock',
      },
    });
  });

  it('uses malformed JSON-LD as if it were not there, and falls back to what else is structured', () => {
    const broken = '<script type="application/ld+json">{"@type": "Product", "name": "Broken",}</script>';
    const og = '<meta property="og:type" content="og:product"><meta property="og:title" content="From OG">';

    expect(product(page(broken + og)).name).toBe('From OG');
    expect(extract(page(broken))).toEqual({ ok: false, reason: 'no_product_data' });
    expect(extract(page('<script type="application/ld+json"></script><script type="application/ld+json">[[[</script>'))).toEqual({ ok: false, reason: 'no_product_data' });
  });

  it('does not turn a page without product metadata into a product', () => {
    const article = page('<meta property="og:type" content="article"><meta property="og:title" content="A Blog Post"><meta name="description" content="Words.">');
    const home = page('<meta property="og:title" content="Sign in">');
    expect(extract(article)).toEqual({ ok: false, reason: 'no_product_data' });
    expect(extract(home)).toEqual({ ok: false, reason: 'no_product_data' });
    expect(extract('')).toEqual({ ok: false, reason: 'no_product_data' });
  });

  it('fills in a missing name from Open Graph, then the page title, and fails when there is none', () => {
    const noName = jsonLd({ '@type': 'Product' });
    expect(product(page(`<meta property="og:title" content="OG Name">${noName}`)).name).toBe('OG Name');
    expect(product(`<html><head><title>  Title   Name </title>${noName}</head></html>`).name).toBe('Title Name');
    expect(extract(`<html><head>${noName}</head></html>`)).toEqual({ ok: false, reason: 'no_name' });
  });
});

describe('missing optional fields', () => {
  it('imports a product that states only a name, leaving everything else unknown', () => {
    const result = product(`<html><head>${jsonLd({ '@type': 'Product', name: 'Just A Name' })}</head></html>`);
    expect(result).toEqual({ name: 'Just A Name', url: PAGE_URL });
  });
});

describe('prices become integer cents, or stay unknown', () => {
  const priceOf = (price: unknown, priceCurrency: unknown = 'USD') => withOffers({ '@type': 'Offer', price, priceCurrency });

  it('converts plain amounts exactly, including floating-point traps', () => {
    for (const [price, cents] of [['29.99', 2999], [29.99, 2999], [19.99, 1999], [0.07, 7], ['0.07', 7], [5, 500], ['5', 500], ['$1,299.00', 129900], ['1299', 129900], ['10.5', 1050]] as const) {
      expect(priceOf(price).priceCents, String(price)).toBe(cents);
    }
  });

  it('treats invalid, ambiguous or placeholder prices as unknown, but still imports the product', () => {
    const ambiguous = ['19,99', '1.299,00', '1 299,00', 'from $5', '5 - 10', '19.999', 19.999, '', 'free', 'N/A', '-5', -5, 0, '0', '0.00', '$', {}, [], null];
    for (const price of ambiguous) {
      const result = priceOf(price);
      expect(result.priceCents, JSON.stringify(price)).toBeUndefined();
      expect(result.currency, JSON.stringify(price)).toBeUndefined();
      expect(result.name).toBe('Thing');
    }
  });

  it('drops a price that has no usable currency instead of assuming dollars', () => {
    for (const currency of [undefined, '', 'US', 'DOLLARS', '$', 5]) {
      // Built directly: `priceOf`'s default parameter would turn `undefined` into 'USD'.
      const result = withOffers({ '@type': 'Offer', price: '9.99', priceCurrency: currency });
      expect(result.priceCents, String(currency)).toBeUndefined();
      expect(result.currency, String(currency)).toBeUndefined();
    }
  });

  it('reads a price from a price specification', () => {
    const result = withOffers({ '@type': 'Offer', priceSpecification: { '@type': 'PriceSpecification', price: '12.50', priceCurrency: 'EUR' } });
    expect(result).toMatchObject({ priceCents: 1250, currency: 'EUR' });
  });

  it('accepts several offers only when they agree, and never picks one of several prices', () => {
    const offer = (price: string, currency = 'USD') => ({ '@type': 'Offer', price, priceCurrency: currency });
    expect(withOffers([offer('10.00'), offer('10.00')])).toMatchObject({ priceCents: 1000 });
    expect(withOffers([offer('10.00'), offer('12.00')]).priceCents).toBeUndefined();
    expect(withOffers([offer('10.00'), offer('10.00', 'EUR')]).priceCents).toBeUndefined();
    expect(withOffers([offer('10.00'), offer('19,99')]).priceCents).toBeUndefined(); // one unreadable offer makes the whole thing unclear
  });

  it('treats an AggregateOffer range as no single price, but a range of one price as that price', () => {
    expect(withOffers({ '@type': 'AggregateOffer', lowPrice: '5.00', highPrice: '9.00', priceCurrency: 'USD' }).priceCents).toBeUndefined();
    expect(withOffers({ '@type': 'AggregateOffer', lowPrice: '5.00', priceCurrency: 'USD' }).priceCents).toBeUndefined(); // "from" price
    expect(withOffers({ '@type': 'AggregateOffer', lowPrice: '5.00', highPrice: '5.00', priceCurrency: 'USD' })).toMatchObject({ priceCents: 500 });
    expect(withOffers({ '@type': 'AggregateOffer', offers: [{ '@type': 'Offer', price: '7.00', priceCurrency: 'USD' }] })).toMatchObject({ priceCents: 700 });
  });

  it('reads the Open Graph price only when no JSON-LD offer is stated, and applies the same strict rules', () => {
    const og = (amount: string, currency = 'USD') => `<meta property="og:type" content="product"><meta property="og:title" content="T"><meta property="product:price:amount" content="${amount}"><meta property="product:price:currency" content="${currency}">`;
    expect(product(page(og('15.25'))).priceCents).toBe(1525);
    expect(product(page(og('15,25'))).priceCents).toBeUndefined();
    expect(product(page(og('15.25', ''))).priceCents).toBeUndefined();
    // JSON-LD offers win entirely: an unusable JSON-LD price is not "repaired" from Open Graph.
    const both = og('15.25') + jsonLd({ '@type': 'Product', name: 'T', offers: { '@type': 'Offer', price: 'call us' } });
    expect(product(page(both)).priceCents).toBeUndefined();
  });
});

describe('availability and discontinued', () => {
  const availability = (value: string) => withOffers({ '@type': 'Offer', availability: value });

  it('maps stock states, and leaves unclear ones unknown', () => {
    expect(availability('https://schema.org/InStock').availability).toBe('in_stock');
    expect(availability('http://schema.org/LimitedAvailability').availability).toBe('in_stock');
    expect(availability('InStock').availability).toBe('in_stock');
    expect(availability('https://schema.org/OutOfStock').availability).toBe('out_of_stock');
    expect(availability('https://schema.org/SoldOut').availability).toBe('out_of_stock');
    for (const unclear of ['https://schema.org/PreOrder', 'https://schema.org/BackOrder', 'https://schema.org/InStoreOnly', 'https://schema.org/MadeToOrder', 'in-ish', '']) {
      expect(availability(unclear).availability, unclear).toBeUndefined();
    }
  });

  it('marks a product discontinued only when the page explicitly says so', () => {
    expect(availability('https://schema.org/Discontinued')).toMatchObject({ discontinued: true });
    expect(availability('https://schema.org/Discontinued').availability).toBeUndefined();
    for (const notDiscontinued of ['https://schema.org/OutOfStock', 'https://schema.org/SoldOut', 'https://schema.org/InStock', 'gone', '']) {
      expect(availability(notDiscontinued).discontinued, notDiscontinued).toBeUndefined();
    }
    // No offer at all says nothing about availability.
    const bare = product(page('', jsonLd({ '@type': 'Product', name: 'Thing' })));
    expect(bare.discontinued).toBeUndefined();
    expect(bare.availability).toBeUndefined();
  });

  it('reads Open Graph availability the same way', () => {
    const og = (value: string) => product(page(`<meta property="og:type" content="product"><meta property="og:title" content="T"><meta property="product:availability" content="${value}">`));
    expect(og('in stock').availability).toBe('in_stock');
    expect(og('oos').availability).toBe('out_of_stock');
    expect(og('discontinued').discontinued).toBe(true);
    expect(og('available for order').availability).toBeUndefined();
  });

  it('does not decide from mixed offers', () => {
    const mixed = withOffers([{ '@type': 'Offer', availability: 'InStock' }, { '@type': 'Offer', availability: 'OutOfStock' }]);
    expect(mixed.availability).toBeUndefined();
    expect(mixed.discontinued).toBeUndefined();
  });
});

describe("the listing's address", () => {
  const withCanonical = (href: string, url = PAGE_URL) => product(page(`<link rel="canonical" href="${href}"><meta property="og:type" content="product"><meta property="og:title" content="T">`), url).url;

  it('prefers a canonical URL on the same site, including a relative one and www vs non-www', () => {
    expect(withCanonical('https://shop.example/p/glow-skeleton')).toBe('https://shop.example/p/glow-skeleton');
    expect(withCanonical('/p/glow-skeleton')).toBe('https://shop.example/p/glow-skeleton');
    expect(withCanonical('https://www.shop.example/p/x', 'https://shop.example/p/x?utm=1')).toBe('https://www.shop.example/p/x');
  });

  it('ignores a canonical on another site, on the home page, or one that is not a safe URL', () => {
    expect(withCanonical('https://evil.example/p/glow-skeleton')).toBe(PAGE_URL);
    expect(withCanonical('https://shop.example/')).toBe(PAGE_URL);
    expect(withCanonical('javascript:alert(1)')).toBe(PAGE_URL);
    expect(withCanonical('https://user:pw@shop.example/x')).toBe(PAGE_URL);
    expect(withCanonical('')).toBe(PAGE_URL);
  });

  it('falls back to og:url with the same rules', () => {
    const html = page('<meta property="og:type" content="product"><meta property="og:title" content="T"><meta property="og:url" content="https://shop.example/p/clean">');
    expect(product(html).url).toBe('https://shop.example/p/clean');
  });
});

describe('the scanner does not confuse markup with metadata', () => {
  it('ignores tags inside comments, scripts and styles, and metadata that appears in the page body', () => {
    const html = `<!doctype html><html><head>
      <!-- <meta property="og:title" content="Commented out"> -->
      <script>var s = '<meta property="og:title" content="In a script">';</script>
      <style>/* <meta property="og:title" content="In a style"> */</style>
      <textarea><meta property="og:title" content="In a textarea"></textarea>
      <meta property="og:type" content="product">
      <meta property="og:title" content="Real Title">
      </head><body>
      <meta property="og:title" content="Injected by page content">
      <meta property="product:price:amount" content="0.01"><meta property="product:price:currency" content="USD">
      </body></html>`;
    const result = product(html);
    expect(result.name).toBe('Real Title');
    expect(result.priceCents).toBeUndefined();
  });

  it('reads attribute styles and letter case the way browsers do', () => {
    const html = `<HTML><HEAD><META PROPERTY='og:type' CONTENT='product'><meta content=Unquoted property=og:title><meta property="og:title" content="Second one loses"></HEAD></HTML>`;
    expect(product(html).name).toBe('Unquoted');
  });

  it('survives broken and hostile markup without hanging or throwing', () => {
    const hostile = ['<meta property="og:title" content="never closed', '<<<<<<', '<script>', '<a href="x', `<div ${'a="1" '.repeat(20_000)}>`, '<!--', '<title>no end', '&#xFFFFFFFF; &#0; &bogus;', '<meta property=og:type content=product><meta property=og:title content=Survivor'];
    for (const html of hostile) {
      expect(() => extract(html), html.slice(0, 30)).not.toThrow();
    }
  });
});

describe('the retailer behind a page', () => {
  it('treats www and non-www as one site, and a different subdomain as a different one', () => {
    expect(siteKey('WWW.Shop.Example.')).toBe('shop.example');
    expect(siteKey('store.shop.example')).toBe('store.shop.example');
    expect(retailerSlugForSite('shop.example')).toBe('shop-example');
    expect(retailerSlugForSite('xn--bcher-kva.de')).toBe('xn-bcher-kva-de');

    const a = describeRetailer('https://www.shop.example/p', 'Shop', []);
    const b = describeRetailer('https://shop.example/q', undefined, []);
    expect(a.slug).toBe(b.slug);
    expect(describeRetailer('https://store.shop.example/p', undefined, []).slug).not.toBe(a.slug);
  });

  it('names a new retailer from the page or, failing that, its host, and reuses one that has the same website', () => {
    expect(describeRetailer('https://www.shop.example/p', '  Shop   Example  ', [])).toMatchObject({ slug: 'shop-example', name: 'Shop Example', websiteUrl: 'https://www.shop.example' });
    expect(describeRetailer('https://www.shop.example/p', undefined, [])).toMatchObject({ name: 'shop.example' });

    const known = [{ id: '1', slug: 'the-shop', name: 'The Shop', websiteUrl: 'https://shop.example', isActive: true, createdAt: '', updatedAt: '' }];
    expect(describeRetailer('https://www.shop.example/p', 'Whatever', known)).toEqual({ slug: 'the-shop', name: 'The Shop', websiteUrl: 'https://shop.example' });

    // A retailer someone named `shop-example` for a DIFFERENT website is never mistaken for this one.
    const clash = [{ ...known[0]!, slug: 'shop-example', websiteUrl: 'https://another-business.example' }];
    const distinct = describeRetailer('https://shop.example/p', undefined, clash);
    expect(distinct.slug).toMatch(/^shop-example-[a-z0-9]+$/);
    expect(distinct.websiteUrl).toBe('https://shop.example');
    // ...but a retailer with that slug AND the same website is simply the same retailer.
    expect(describeRetailer('https://shop.example/p', undefined, [{ ...known[0]!, slug: 'shop-example' }]).slug).toBe('shop-example');

    // Two existing retailers on one host: no guess, fall back to the derived identity.
    const twins = [...known, { ...known[0]!, id: '2', slug: 'the-shop-2' }];
    expect(describeRetailer('https://shop.example/p', undefined, twins).slug).toBe('shop-example');
  });
});

describe('what the connector hands to the ingestion engine', () => {
  const context = { sourceId: 'url-import', retailerSlug: 'shop-example', now: new Date('2026-06-15T12:00:00Z') };
  const candidateFor = (extracted: ExtractedProduct) => {
    const source = createUrlImportSource({ retailer: { slug: 'shop-example', name: 'Shop', websiteUrl: 'https://shop.example' }, category: 'indoor', products: [extracted] });
    return validateCandidate(source.toCandidate(extracted), context);
  };

  it('produces a valid candidate carrying the reviewer-chosen category and integer cents', () => {
    const result = candidateFor({ name: 'Thing', url: PAGE_URL, priceCents: 1999, currency: 'USD', availability: 'in_stock' });
    expect(result).toMatchObject({ ok: true, candidate: { name: 'Thing', url: PAGE_URL, category: 'indoor', priceCents: 1999, currency: 'USD', availability: 'in_stock' } });
  });

  it('leaves price and availability unknown when the page gave none', () => {
    const result = candidateFor({ name: 'Thing', url: PAGE_URL });
    expect(result.ok && result.candidate).not.toHaveProperty('priceCents');
    expect(result.ok && result.candidate.availability).toBe('unknown');
  });

  it('drops an unsafe image URL without rejecting the product', () => {
    for (const imageUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd', 'ftp://shop.example/a.jpg', 'https://shop.example/has space.jpg']) {
      const result = candidateFor({ name: 'Thing', url: PAGE_URL, imageUrl });
      expect(result.ok, imageUrl).toBe(true);
      expect(result.ok && result.candidate.imageUrl, imageUrl).toBeUndefined();
    }
    const safe = candidateFor({ name: 'Thing', url: PAGE_URL, imageUrl: 'https://cdn.shop.example/a.jpg' });
    expect(safe.ok && safe.candidate.imageUrl).toBe('https://cdn.shop.example/a.jpg');
  });

  it('only marks a candidate discontinued when the extraction said so explicitly', () => {
    const out = candidateFor({ name: 'Thing', url: PAGE_URL, availability: 'out_of_stock' });
    const gone = candidateFor({ name: 'Thing', url: PAGE_URL, discontinued: true });
    expect(out.ok && out.candidate.availability).toBe('out_of_stock');
    expect(gone.ok && gone.candidate.availability).toBe('discontinued');
  });
});
