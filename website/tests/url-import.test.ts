/**
 * The URL import pipeline end to end, on the REAL ingestion engine and repositories (an isolated
 * in-memory D1 built from the real migrations). Only the network is replaced, by a table of fixture
 * pages, so no test depends on a retailer or the internet.
 *
 * What these prove: the importer adds no second way to create products. Everything goes through
 * the engine, so the engine's guarantees hold for imported URLs too: products are created pending,
 * review status and curated fields are never overwritten, the affiliate link is never touched, one
 * bad URL never stops the batch, and identity stays strong (listing id / exact URL, per retailer).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_IMPORT_URLS } from '../src/server/ingestion/url-import/input';
import { runUrlImport, type ImportRowResult, type UrlImportReport } from '../src/server/ingestion/url-import/run-import';
import { CatalogWorld } from './helpers/catalog-world';
import { fakeFetcher, failure, ok, page, productPage } from './helpers/product-pages';

let world: CatalogWorld;

beforeAll(async () => {
  world = await CatalogWorld.create();
});
afterAll(async () => {
  await world.dispose();
});
beforeEach(async () => {
  await world.reset();
});

const daysBeforeNow = (days: number) => new Date(CatalogWorld.NOW.getTime() - days * 86_400_000);

type Replies = Parameters<typeof fakeFetcher>[0];

/** Runs an import of `urls` against fixture pages, at a chosen moment (default: the world's fixed NOW). */
async function importUrls(urls: string[], replies: Replies, options: { category?: 'outdoor' | 'indoor' | 'costumes'; at?: Date } = {}): Promise<UrlImportReport & { calls: string[] }> {
  const { fetchPage, calls } = fakeFetcher(replies);
  const report = await runUrlImport(world.d1, { urls, category: options.category ?? 'outdoor' }, { fetchPage, now: () => options.at ?? CatalogWorld.NOW });
  return { ...report, calls };
}

const statuses = (report: UrlImportReport): string[] => report.results.map((row) => row.status);
const only = (report: UrlImportReport): ImportRowResult => {
  expect(report.results).toHaveLength(1);
  return report.results[0]!;
};

const allProducts = async () => [
  ...(await world.repos.adminProducts.listByStatus('pending')),
  ...(await world.repos.adminProducts.listByStatus('approved')),
  ...(await world.repos.adminProducts.listByStatus('rejected')),
];

const SKELETON = 'https://shop.example/p/glow-skeleton';
const skeletonPage = (spec: Parameters<typeof productPage>[0] = {}) => ok(SKELETON, productPage({ name: 'Glow Skeleton 5ft', price: '29.99', availability: 'InStock', siteName: 'Shop Example', ...spec }));

// ---- new products -----------------------------------------------------------------------------

describe('importing a new product', () => {
  it('creates one PENDING product with its offer, in the chosen category, and it is not public', async () => {
    const report = await importUrls([SKELETON], { [SKELETON]: skeletonPage({ image: 'https://cdn.shop.example/skeleton.jpg', description: 'A fun skeleton.' }) }, { category: 'costumes' });

    const row = only(report);
    expect(row).toMatchObject({ status: 'imported', input: SKELETON });
    expect(report.summary).toMatchObject({ submitted: 1, imported: 1, skipped: 0, failed: 0 });

    const [created] = await allProducts();
    expect(created).toMatchObject({ id: row.productId, reviewStatus: 'pending', name: 'Glow Skeleton 5ft', summary: 'A fun skeleton.', imageUrl: 'https://cdn.shop.example/skeleton.jpg' });
    expect(created?.categoryId).toBe((await world.repos.categories.getBySlug('costumes'))?.id);
    expect(created?.reviewedAt).toBeUndefined();

    const offers = await world.repos.offers.getOffersForProduct(created!.id);
    expect(offers).toEqual([expect.objectContaining({ productUrl: SKELETON, priceCents: 2999, currency: 'USD', availability: 'in_stock', isPrimary: true, lastCheckedAt: '2026-06-15T12:00:00Z' })]);
    expect(offers[0]?.affiliateUrl).toBeUndefined(); // no affiliate link is required or generated

    expect(await world.publicSlugs()).toEqual([]);
    expect(await world.publicBySlug(created!.slug)).toBeUndefined();
  });

  it('goes through the ingestion engine: the run is recorded, and the offer remembers its source and the retailer title', async () => {
    await importUrls([SKELETON], { [SKELETON]: skeletonPage() });

    expect(await world.count('ingestion_runs')).toBe(1);
    const [created] = await allProducts();
    const detail = await world.repos.adminReview.getReviewDetail(created!.id);
    expect(detail?.offers[0]).toMatchObject({ sourceId: 'url-import', sourceTitle: 'Glow Skeleton 5ft' });
  });

  it('imports with missing optional data: no price, no image, no description', async () => {
    const bare = ok(SKELETON, page('', `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Bare Bones Ghost' })}</script>`));
    const report = await importUrls([SKELETON], { [SKELETON]: bare });

    expect(only(report).status).toBe('imported');
    const [created] = await allProducts();
    expect(created?.imageUrl).toBeUndefined();
    const offer = (await world.repos.offers.getOffersForProduct(created!.id))[0];
    expect(offer).toMatchObject({ availability: 'unknown', currency: 'USD' });
    expect(offer?.priceCents).toBeUndefined(); // unknown, never guessed
  });

  it('treats an ambiguous price as unknown but still imports the product', async () => {
    const report = await importUrls([SKELETON], { [SKELETON]: skeletonPage({ price: '19,99' }) });

    expect(only(report).status).toBe('imported');
    const [created] = await allProducts();
    expect((await world.repos.offers.getOffersForProduct(created!.id))[0]?.priceCents).toBeUndefined();
  });

  it('discards an unsafe image URL and still creates the product', async () => {
    const report = await importUrls([SKELETON], { [SKELETON]: skeletonPage({ image: 'javascript:alert(1)' }) });

    expect(only(report).status).toBe('imported');
    expect((await allProducts())[0]?.imageUrl).toBeUndefined();
  });

  it('records an out-of-stock listing as out of stock, and only an explicit Discontinued as discontinued', async () => {
    const OUT = 'https://shop.example/p/out';
    const GONE = 'https://shop.example/p/gone';
    await importUrls([OUT, GONE], {
      [OUT]: ok(OUT, productPage({ name: 'Out Of Stock Ghost', price: '5', availability: 'OutOfStock' })),
      [GONE]: ok(GONE, productPage({ name: 'Discontinued Ghost', price: '5', availability: 'Discontinued' })),
    });

    const byName = async (name: string) => {
      const product = (await allProducts()).find((candidate) => candidate.name === name)!;
      return (await world.repos.offers.getOffersForProduct(product.id))[0]!;
    };
    expect((await byName('Out Of Stock Ghost')).availability).toBe('out_of_stock');
    expect((await byName('Discontinued Ghost')).availability).toBe('discontinued');
  });

  it('stores the address the page declares as canonical, so tracking parameters do not create a new listing', async () => {
    const tracked = `${SKELETON}?utm_source=newsletter`;
    await importUrls([tracked], { [tracked]: ok(tracked, productPage({ name: 'Glow Skeleton 5ft', canonical: SKELETON })) });

    const [created] = await allProducts();
    expect((await world.repos.offers.getOffersForProduct(created!.id))[0]?.productUrl).toBe(SKELETON);
  });
});

// ---- retailers --------------------------------------------------------------------------------

describe('retailer identity', () => {
  it('creates one retailer for www and non-www of the same site, named from the page, and never duplicates it', async () => {
    const A = 'https://www.shop.example/p/a';
    const B = 'https://shop.example/p/b';
    await importUrls([A, B], { [A]: ok(A, productPage({ name: 'Ghost A', siteName: 'Shop Example' })), [B]: ok(B, productPage({ name: 'Ghost B' })) });

    const retailers = await world.repos.retailers.list();
    expect(retailers).toHaveLength(1);
    expect(retailers[0]).toMatchObject({ slug: 'shop-example', name: 'Shop Example', isActive: true });
    expect(await world.count('product_offers')).toBe(2);

    // A later import for the same site reuses it.
    const C = 'https://www.shop.example/p/c';
    await importUrls([C], { [C]: ok(C, productPage({ name: 'Ghost C' })) });
    expect(await world.count('retailers')).toBe(1);
  });

  it('reuses an existing retailer whose website has the same host, whatever its slug', async () => {
    const existing = await world.retailer('shop'); // website https://shop.example
    await importUrls([SKELETON], { [SKELETON]: skeletonPage() });

    expect((await world.repos.retailers.list()).map((retailer) => retailer.slug)).toEqual(['shop']);
    const [created] = await allProducts();
    expect((await world.repos.offers.getOffersForProduct(created!.id))[0]?.retailerId).toBe(existing.id);
  });

  it('does not merge a different subdomain into the same retailer', async () => {
    const STORE = 'https://store.shop.example/p/a';
    await importUrls([SKELETON, STORE], { [SKELETON]: skeletonPage(), [STORE]: ok(STORE, productPage({ name: 'Store Ghost' })) });

    expect((await world.repos.retailers.list()).map((retailer) => retailer.slug).sort()).toEqual(['shop-example', 'store-shop-example']);
  });

  it('does not import for a retailer a human deactivated (found by its website, whatever its slug), and does not reactivate it', async () => {
    await world.repos.retailers.create({ slug: 'the-shop', name: 'The Shop', websiteUrl: 'https://www.shop.example', isActive: false });

    const report = await importUrls([SKELETON], { [SKELETON]: skeletonPage() });

    expect(only(report)).toMatchObject({ status: 'failed' });
    expect(only(report).message).toMatch(/inactive/);
    expect(await world.count('products')).toBe(0);
    expect(await world.count('retailers')).toBe(1); // no second record was made for the same site
    expect((await world.repos.retailers.getBySlug('the-shop'))?.isActive).toBe(false);
  });

  it('does not mistake a retailer with the same slug but a different website for this one', async () => {
    await world.repos.retailers.create({ slug: 'shop-example', name: 'Another Business', websiteUrl: 'https://another-business.example', isActive: false });

    const report = await importUrls([SKELETON], { [SKELETON]: skeletonPage() });

    expect(only(report).status).toBe('imported'); // the inactive retailer is a different business
    const [created] = await allProducts();
    const offer = (await world.repos.offers.getOffersForProduct(created!.id))[0]!;
    const retailer = await world.repos.retailers.getById(offer.retailerId);
    expect(retailer).toMatchObject({ websiteUrl: 'https://shop.example', isActive: true });
    expect(retailer?.slug).toMatch(/^shop-example-/);
    expect((await world.repos.retailers.getBySlug('shop-example'))?.name).toBe('Another Business'); // untouched
  });

  it('keeps importing other retailers when one is deactivated', async () => {
    await world.repos.retailers.create({ slug: 'shop-example', name: 'Shop Example', websiteUrl: 'https://shop.example', isActive: false });
    const OTHER = 'https://other.example/p/a';

    const report = await importUrls([SKELETON, OTHER], { [SKELETON]: skeletonPage(), [OTHER]: ok(OTHER, productPage({ name: 'Other Ghost' })) });

    expect(statuses(report)).toEqual(['failed', 'imported']);
  });
});

// ---- batches ----------------------------------------------------------------------------------

describe('a batch with failures', () => {
  it('reports every URL, in order, and one failure never stops the rest', async () => {
    const GOOD1 = 'https://shop.example/p/one';
    const GOOD2 = 'https://other.example/p/two';
    const MISSING = 'https://shop.example/p/missing';
    const ARTICLE = 'https://shop.example/blog/post';
    const CRASH = 'https://shop.example/p/crash';

    const { results, summary, calls } = await importUrls(
      [GOOD1, MISSING, 'http://169.254.169.254/latest/meta-data/', ARTICLE, CRASH, 'not a url', GOOD1, GOOD2],
      {
        [GOOD1]: ok(GOOD1, productPage({ name: 'Ghost One' })),
        [MISSING]: failure('http', 'The site answered with HTTP 404.'),
        [ARTICLE]: ok(ARTICLE, page('<meta property="og:type" content="article"><meta property="og:title" content="A Blog Post">')),
        [CRASH]: new Error('the fetcher blew up: secret-internal-detail'),
        [GOOD2]: ok(GOOD2, productPage({ name: 'Ghost Two' })),
      },
    );

    expect(results.map((row) => row.status)).toEqual(['imported', 'failed', 'skipped', 'skipped', 'failed', 'skipped', 'skipped', 'imported']);
    expect(summary).toEqual({ submitted: 8, imported: 2, updated: 0, unchanged: 0, skipped: 4, conflicts: 0, failed: 2 });

    expect(results[1]?.message).toMatch(/could not be retrieved.*404/);
    expect(results[2]?.message).toMatch(/not a public web address/i);
    expect(results[3]?.message).toMatch(/product information/);
    expect(results[4]?.message).toBe('Page could not be retrieved.');
    expect(results[5]?.message).toMatch(/valid web address/);
    expect(results[6]?.message).toMatch(/Same URL/);
    expect(JSON.stringify(results)).not.toContain('secret-internal-detail');

    expect((await allProducts()).map((product) => product.name).sort()).toEqual(['Ghost One', 'Ghost Two']);
    // Only URLs that could be fetched were fetched, and the duplicate was fetched once.
    expect(calls.sort()).toEqual([ARTICLE, CRASH, GOOD1, GOOD2, MISSING].sort());
  });

  it('links each imported product to the review interface via its id', async () => {
    const A = 'https://shop.example/p/a';
    const B = 'https://shop.example/p/b';
    const { results } = await importUrls([A, B], { [A]: ok(A, productPage({ name: 'Ghost A' })), [B]: ok(B, productPage({ name: 'Ghost B' })) });

    const products = await allProducts();
    expect(results.map((row) => row.productId).sort()).toEqual(products.map((product) => product.id).sort());
  });

  it('fetches a repeated URL only once', async () => {
    const { calls, results } = await importUrls([`${SKELETON}#a`, SKELETON, ` ${SKELETON} `], { [SKELETON]: skeletonPage() });

    expect(calls).toEqual([SKELETON]);
    expect(statuses({ results, summary: {} as never })).toEqual(['imported', 'skipped', 'skipped']);
    expect(await world.count('products')).toBe(1);
  });

  it('refuses more URLs than the limit rather than quietly dropping some', async () => {
    const urls = Array.from({ length: MAX_IMPORT_URLS + 1 }, (_, i) => `https://shop.example/p/${i}`);
    await expect(importUrls(urls, {})).rejects.toThrow(RangeError);
  });
});

// ---- re-importing -----------------------------------------------------------------------------

describe('importing a URL that is already known', () => {
  it('refreshes the same offer instead of creating a duplicate, and reports unchanged when nothing changed', async () => {
    await importUrls([SKELETON], { [SKELETON]: skeletonPage() }, { at: daysBeforeNow(2) });

    const updated = await importUrls([SKELETON], { [SKELETON]: skeletonPage({ price: '24.99' }) }, { at: daysBeforeNow(1) });
    expect(only(updated)).toMatchObject({ status: 'updated' });

    const unchanged = await importUrls([SKELETON], { [SKELETON]: skeletonPage({ price: '24.99' }) });
    expect(only(unchanged)).toMatchObject({ status: 'unchanged' });

    expect(await world.count('products')).toBe(1);
    expect(await world.count('product_offers')).toBe(1);
    const [existing] = await allProducts();
    const offer = (await world.repos.offers.getOffersForProduct(existing!.id))[0]!;
    expect(offer.priceCents).toBe(2499);
    expect(offer.lastCheckedAt).toBe('2026-06-15T12:00:00Z'); // re-verified
    expect(only(updated).productId).toBe(existing!.id); // the row links to the existing product
  });

  it('never overwrites what the reviewer curated, and keeps an approved product approved and public', async () => {
    await importUrls([SKELETON], { [SKELETON]: skeletonPage({ description: 'Original retailer copy.', image: 'https://cdn.shop.example/original.jpg' }) }, { at: daysBeforeNow(2) });
    const { id, slug } = (await allProducts())[0]!;
    const indoor = await world.repos.categories.getBySlug('indoor');
    await world.repos.adminProducts.update(id, {
      name: 'Curated Name',
      summary: 'Curated summary.',
      description: 'Curated description.',
      categoryId: indoor!.id,
      qualityNotes: ['Curated note'],
      badges: ['Curated badge'],
      imageUrl: 'https://curated.example/image.jpg',
      reviewNotes: 'Curated internal note',
    });
    await world.repos.adminProducts.changeReviewStatus(id, 'approved');
    const curated = await world.repos.adminProducts.getById(id);
    expect(await world.publicSlugs()).toEqual([slug]);

    // The retailer retitles everything, changes the picture and the price, and the reviewer picks another category.
    const report = await importUrls(
      [SKELETON],
      { [SKELETON]: skeletonPage({ name: 'Totally Different Retailer Title', description: 'New copy.', image: 'https://cdn.shop.example/new.jpg', price: '19.99' }) },
      { category: 'costumes' },
    );

    expect(only(report)).toMatchObject({ status: 'updated', productId: id });
    expect(await world.repos.adminProducts.getById(id)).toEqual(curated); // every product column exactly as left, even updated_at
    expect((await world.repos.adminProducts.getById(id))?.reviewStatus).toBe('approved');
    expect(await world.publicSlugs()).toEqual([slug]); // still public
    const detail = await world.repos.adminReview.getReviewDetail(id);
    expect(detail?.offers[0]).toMatchObject({ priceCents: 1999, sourceTitle: 'Totally Different Retailer Title' });
  });

  it('leaves a rejected product rejected and hidden', async () => {
    await importUrls([SKELETON], { [SKELETON]: skeletonPage() }, { at: daysBeforeNow(2) });
    const { id } = (await allProducts())[0]!;
    await world.repos.adminProducts.changeReviewStatus(id, 'rejected');

    const report = await importUrls([SKELETON], { [SKELETON]: skeletonPage({ price: '10.00' }) });

    expect(only(report).status).toBe('updated');
    expect((await world.repos.adminProducts.getById(id))?.reviewStatus).toBe('rejected');
    expect(await world.publicSlugs()).toEqual([]);
    expect(await world.count('products')).toBe(1);
  });

  it('never touches an affiliate link or the primary flag', async () => {
    await importUrls([SKELETON], { [SKELETON]: skeletonPage() }, { at: daysBeforeNow(2) });
    const { id } = (await allProducts())[0]!;
    const before = (await world.repos.offers.getOffersForProduct(id))[0]!;
    await world.repos.offers.update(before.id, { affiliateUrl: 'https://affiliate.example/track?to=skeleton' });

    await importUrls([SKELETON], { [SKELETON]: skeletonPage({ price: '15.00' }) });

    const after = (await world.repos.offers.getOffersForProduct(id))[0]!;
    expect(after).toMatchObject({ id: before.id, affiliateUrl: 'https://affiliate.example/track?to=skeleton', isPrimary: true, priceCents: 1500 });
  });

  it('changes nothing about a listing when its page could not be fetched this time', async () => {
    await importUrls([SKELETON], { [SKELETON]: skeletonPage() }, { at: daysBeforeNow(3) });
    const { id } = (await allProducts())[0]!;
    const before = (await world.repos.offers.getOffersForProduct(id))[0];

    const report = await importUrls([SKELETON], { [SKELETON]: failure('timeout', 'The site did not respond in time.') });

    expect(only(report).status).toBe('failed');
    expect((await world.repos.offers.getOffersForProduct(id))[0]).toEqual(before); // price, availability, last_checked_at: all as before
  });

  it('records a price the page no longer states as unknown, rather than carrying the old one forward as if just verified', async () => {
    await importUrls([SKELETON], { [SKELETON]: skeletonPage({ price: '29.99' }) }, { at: daysBeforeNow(2) });
    const { id } = (await allProducts())[0]!;
    expect((await world.repos.offers.getOffersForProduct(id))[0]?.priceCents).toBe(2999);

    await importUrls([SKELETON], { [SKELETON]: skeletonPage({ price: '19,99' }) }); // now ambiguous

    const offer = (await world.repos.offers.getOffersForProduct(id))[0]!;
    expect(offer.priceCents).toBeUndefined();
    expect(offer.lastCheckedAt).toBe('2026-06-15T12:00:00Z'); // the observation itself is fresh; the price is honestly unknown
    expect(await world.count('products')).toBe(1);
  });

  it('does not mark a listing discontinued unless this page explicitly says so', async () => {
    await importUrls([SKELETON], { [SKELETON]: skeletonPage() }, { at: daysBeforeNow(2) });
    const { id } = (await allProducts())[0]!;

    await importUrls([SKELETON], { [SKELETON]: ok(SKELETON, page('<meta property="og:type" content="product"><meta property="og:title" content="Glow Skeleton 5ft">')) }, { at: daysBeforeNow(1) });
    expect((await world.repos.offers.getOffersForProduct(id))[0]?.availability).toBe('unknown'); // not discontinued

    await importUrls([SKELETON], { [SKELETON]: skeletonPage({ availability: 'Discontinued' }) });
    expect((await world.repos.offers.getOffersForProduct(id))[0]?.availability).toBe('discontinued');
  });
});

// ---- strong identity --------------------------------------------------------------------------

describe('identity', () => {
  it('reports two different submitted URLs that are the same listing once, creating one product', async () => {
    const A = `${SKELETON}?ref=a`;
    const B = `${SKELETON}?ref=b`;
    const report = await importUrls([A, B], { [A]: ok(A, productPage({ name: 'Glow Skeleton 5ft', canonical: SKELETON })), [B]: ok(B, productPage({ name: 'Glow Skeleton 5ft', canonical: SKELETON })) });

    expect(statuses(report)).toEqual(['imported', 'skipped']);
    expect(report.results[1]?.message).toMatch(/same listing/i);
    expect(await world.count('products')).toBe(1);
  });

  it('never merges by title: two listings with the same name are two products', async () => {
    const A = 'https://shop.example/p/a';
    const B = 'https://shop.example/p/b';
    await importUrls([A, B], { [A]: ok(A, productPage({ name: 'Same Name' })), [B]: ok(B, productPage({ name: 'Same Name' })) });

    const products = await allProducts();
    expect(products).toHaveLength(2);
    expect(new Set(products.map((product) => product.slug)).size).toBe(2);
  });

  it('never merges across retailers, even for an identical title and item id', async () => {
    const A = 'https://shop.example/p/a';
    const B = 'https://other.example/p/a';
    await importUrls([A, B], { [A]: ok(A, productPage({ name: 'Same', retailerItemId: 'X-1' })), [B]: ok(B, productPage({ name: 'Same', retailerItemId: 'X-1' })) });

    expect(await world.count('products')).toBe(2);
    expect(await world.count('retailers')).toBe(2);
  });

  it('recognises a listing by its retailer item id when the URL changes, keeping one product', async () => {
    const OLD = 'https://shop.example/p/old-name';
    const NEW = 'https://shop.example/p/new-name';
    await importUrls([OLD], { [OLD]: ok(OLD, productPage({ name: 'Ghost', retailerItemId: 'G-1' })) }, { at: daysBeforeNow(2) });

    const report = await importUrls([NEW], { [NEW]: ok(NEW, productPage({ name: 'Ghost', retailerItemId: 'G-1' })) });

    expect(only(report).status).toBe('updated');
    expect(await world.count('products')).toBe(1);
    const { id } = (await allProducts())[0]!;
    expect((await world.repos.offers.getOffersForProduct(id))[0]?.productUrl).toBe(NEW);
  });

  it('reports an identity conflict and changes nothing, instead of guessing', async () => {
    const FIRST = 'https://shop.example/p/first';
    const SECOND = 'https://shop.example/p/second';
    await importUrls([FIRST], { [FIRST]: ok(FIRST, productPage({ name: 'First', retailerItemId: 'A' })) }, { at: daysBeforeNow(2) });
    const before = (await world.repos.offers.getOffersForProduct((await allProducts())[0]!.id))[0];

    // A different page claims the first listing's address (canonical) but a different item id.
    const report = await importUrls([SECOND], { [SECOND]: ok(SECOND, productPage({ name: 'Second', canonical: FIRST, retailerItemId: 'B' })) });

    expect(only(report)).toMatchObject({ status: 'conflict' });
    expect(report.summary.conflicts).toBe(1);
    expect(await world.count('products')).toBe(1);
    expect((await world.repos.offers.getOffersForProduct((await allProducts())[0]!.id))[0]).toEqual(before);
  });

  it('protects imported offers with the same database uniqueness rules as any other offer', async () => {
    await importUrls([SKELETON], { [SKELETON]: skeletonPage() });
    const imported = (await world.repos.offers.getOffersForProduct((await allProducts())[0]!.id))[0]!;
    const retailer = (await world.repos.retailers.getById(imported.retailerId))!;
    const other = await world.product('some-other-product', { status: 'pending' });

    // The same retailer + URL cannot be recorded twice, whoever tries.
    await expect(world.offer(other, retailer, { url: SKELETON })).rejects.toThrow();
    expect(await world.count('product_offers')).toBe(1);
  });
});
