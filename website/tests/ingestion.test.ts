/**
 * The ingestion engine's business rules: what may be created, what may be refreshed, and what
 * must never be touched. They run the REAL engine and repositories against an isolated in-memory
 * D1 built from the real migrations, with a tiny in-test connector. Nothing is mocked.
 *
 * The rules that matter most:
 *  - ingestion never approves anything and never changes an existing product's review state
 *    or curated fields; it only refreshes the retailer's OFFER facts
 *  - identity is strong (retailer + listing id, else exact URL): re-running never duplicates
 *  - a listing that is merely missing from a run is never treated as discontinued
 *
 * Intentionally not covered: UI, the CLI launcher, scraping, or any real retailer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runIngestion, type IngestionResult, type ItemReport } from '../src/server/ingestion/engine';
import type { CandidateInput } from '../src/server/ingestion/candidate';
import type { ProductIngestionSource } from '../src/server/ingestion/source';
import { createFixtureSource } from '../src/server/ingestion/sources/fixture';
import { createIngestionRepositories } from '../src/server/repositories';
import { CatalogWorld } from './helpers/catalog-world';

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

// ---- helpers ------------------------------------------------------------------------------

const RETAILER = { slug: 'test-shop', name: 'Test Shop', websiteUrl: 'https://test-shop.example' };

/** A connector whose raw items already are candidates. `id` lets a test play a second retailer. */
function source(items: readonly unknown[], retailer = RETAILER): ProductIngestionSource<unknown> {
  return { id: 'test', retailer, fetchItems: async () => items, toCandidate: (item) => item as CandidateInput };
}

/** A well-formed listing. Override fields per test. */
function listing(overrides: CandidateInput = {}): CandidateInput {
  return {
    externalId: 'T-1',
    name: 'Test Porch Ghost',
    url: 'https://test-shop.example/porch-ghost',
    category: 'outdoor',
    priceCents: 1999,
    currency: 'USD',
    availability: 'in_stock',
    ...overrides,
  };
}

const daysBeforeNow = (days: number) => new Date(CatalogWorld.NOW.getTime() - days * 86_400_000);
const iso = (moment: Date) => moment.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Runs one ingestion at a chosen moment (default: the world's fixed NOW). */
function ingest(items: readonly unknown[], at: Date = CatalogWorld.NOW, retailer = RETAILER): Promise<IngestionResult> {
  return runIngestion(world.d1, source(items, retailer), { now: () => at });
}

async function onlyProduct() {
  const all = [
    ...(await world.repos.adminProducts.listByStatus('pending')),
    ...(await world.repos.adminProducts.listByStatus('approved')),
    ...(await world.repos.adminProducts.listByStatus('rejected')),
  ];
  expect(all).toHaveLength(1);
  return all[0]!;
}

async function offerOf(productId: string) {
  const offers = await world.repos.offers.getOffersForProduct(productId);
  expect(offers).toHaveLength(1);
  return offers[0]!;
}

async function sourceTitleOf(productId: string): Promise<string | undefined> {
  return (await world.repos.adminReview.getReviewDetail(productId))?.offers[0]?.sourceTitle;
}

// ---- new listings -------------------------------------------------------------------------

describe('a new listing', () => {
  it('creates one PENDING product with one offer, stamped with the observation time, and it is not public', async () => {
    const result = await ingest([listing()]);

    expect(result).toMatchObject({ status: 'succeeded', discovered: 1, productsCreated: 1, offersCreated: 1, skipped: 0, failed: 0 });

    const product = await onlyProduct();
    expect(product.reviewStatus).toBe('pending');
    expect(product.reviewedAt).toBeUndefined();
    expect(product.categoryId).toBe((await world.repos.categories.getBySlug('outdoor'))?.id);
    expect(product.name).toBe('Test Porch Ghost');
    expect(product.slug).toBe('test-porch-ghost');

    const offer = await offerOf(product.id);
    expect(offer).toMatchObject({
      retailerProductId: 'T-1',
      productUrl: 'https://test-shop.example/porch-ghost',
      priceCents: 1999,
      currency: 'USD',
      availability: 'in_stock',
      isPrimary: true,
      lastCheckedAt: iso(CatalogWorld.NOW),
    });

    // Absent from the public catalog until a human approves it.
    expect(await world.publicSlugs()).toEqual([]);
    expect(await world.publicBySlug('test-porch-ghost')).toBeUndefined();
    expect(await world.repos.adminProducts.getPendingProducts()).toHaveLength(1);
  });

  it('gives two different listings with the same title different slugs, never one merged product', async () => {
    await ingest([listing({ externalId: 'A' , url: 'https://test-shop.example/a' }), listing({ externalId: 'B', url: 'https://test-shop.example/b' })]);

    const slugs = (await world.repos.adminProducts.getPendingProducts()).map((product) => product.slug).sort();
    expect(slugs).toHaveLength(2);
    expect(new Set(slugs).size).toBe(2);
  });
});

// ---- identity & idempotency ---------------------------------------------------------------

describe('identity and idempotency', () => {
  it('creates no duplicates when the same source is ingested again, and reports it as unchanged', async () => {
    await ingest([listing()], daysBeforeNow(1));
    const second = await ingest([listing()]);

    expect(second).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 0, offersUnchanged: 1 });
    expect(await world.count('products')).toBe(1);
    expect(await world.count('product_offers')).toBe(1);
    expect((await onlyProduct()).reviewStatus).toBe('pending'); // re-ingesting never promotes or resets anything
  });

  it('updates the same offer when the price changes', async () => {
    await ingest([listing({ priceCents: 1999 })], daysBeforeNow(1));
    const before = await onlyProduct();
    const offerBefore = await offerOf(before.id);

    const second = await ingest([listing({ priceCents: 1499 })]);

    expect(second).toMatchObject({ offersUpdated: 1, productsCreated: 0 });
    const offerAfter = await offerOf(before.id);
    expect(offerAfter.id).toBe(offerBefore.id);
    expect(offerAfter.priceCents).toBe(1499);
    expect(await world.count('products')).toBe(1);
  });

  it('refreshes last_checked_at on every successful observation, and never moves it backwards', async () => {
    await ingest([listing()], daysBeforeNow(20));
    const product = await onlyProduct();
    expect((await offerOf(product.id)).lastCheckedAt).toBe(iso(daysBeforeNow(20)));

    await ingest([listing()], CatalogWorld.NOW);
    expect((await offerOf(product.id)).lastCheckedAt).toBe(iso(CatalogWorld.NOW));

    // ...but an older (replayed) observation never overwrites a newer one.
    await ingest([listing({ priceCents: 1 })], daysBeforeNow(5));
    expect(await offerOf(product.id)).toMatchObject({ lastCheckedAt: iso(CatalogWorld.NOW), priceCents: 1999 });
  });

  it('keeps one listing attached to its product when the retailer changes the URL', async () => {
    await ingest([listing({ url: 'https://test-shop.example/old-path' })], daysBeforeNow(1));
    const product = await onlyProduct();

    await ingest([listing({ url: 'https://test-shop.example/new-path' })]);

    expect(await world.count('products')).toBe(1);
    expect((await offerOf(product.id)).productUrl).toBe('https://test-shop.example/new-path');
  });

  it('falls back to the exact normalized URL when there is no listing id', async () => {
    const noId = { externalId: undefined, url: 'https://Test-Shop.example/porch-ghost#reviews' };
    await ingest([listing(noId)], daysBeforeNow(1));
    const second = await ingest([listing({ ...noId, url: 'https://test-shop.example/porch-ghost', priceCents: 1799 })]);

    expect(second).toMatchObject({ offersUpdated: 1, productsCreated: 0 });
    expect(await world.count('products')).toBe(1);
    expect(await world.count('product_offers')).toBe(1);
  });

  it('adopts a listing id onto an existing offer with the same URL, but refuses to merge a different id', async () => {
    const retailer = await world.retailer('test-shop');
    const product = await world.product('hand-made', { status: 'approved' });
    const manual = await world.offer(product, retailer, { url: 'https://test-shop.example/porch-ghost', priceCents: 100 });

    const adopted = await ingest([listing({ externalId: 'T-1' })]);
    expect(adopted).toMatchObject({ offersUpdated: 1, productsCreated: 0 });
    expect((await world.repos.offers.getById(manual.id))).toMatchObject({ retailerProductId: 'T-1', priceCents: 1999 });

    // Same URL, but the retailer now says it is a different listing: never guess.
    const conflicting = await ingest([listing({ externalId: 'T-2' })]);
    expect(conflicting).toMatchObject({ conflicts: 1, offersUpdated: 0, productsCreated: 0 });
    expect((await world.repos.offers.getById(manual.id))?.retailerProductId).toBe('T-1');
    expect(await world.count('products')).toBe(1);
  });

  it('never merges the same-looking product across retailers', async () => {
    const other = { slug: 'other-shop', name: 'Other Shop', websiteUrl: 'https://other-shop.example' };
    await ingest([listing()]);
    await ingest([listing({ url: 'https://other-shop.example/porch-ghost' })], CatalogWorld.NOW, other);

    expect(await world.count('products')).toBe(2);
    expect(await world.count('product_offers')).toBe(2);
    expect(await world.count('retailers')).toBe(2);
  });

  it('handles a listing repeated within one run without duplicating anything; the first wins', async () => {
    const result = await ingest([listing({ priceCents: 1999 }), listing({ priceCents: 1 })]);

    expect(result).toMatchObject({ discovered: 2, productsCreated: 1, duplicates: 1, skipped: 1, status: 'succeeded' });
    expect(result.issues).toMatchObject([{ index: 1, code: 'duplicate', ref: 'T-1' }]);
    expect(await world.count('products')).toBe(1);
    expect((await offerOf((await onlyProduct()).id)).priceCents).toBe(1999);
  });
});

// ---- human review is never overridden -----------------------------------------------------

describe('existing reviewed products', () => {
  it('stay approved AND public after their offer is refreshed', async () => {
    await ingest([listing({ priceCents: 1999 })], daysBeforeNow(10));
    const { id, slug } = await onlyProduct();
    await world.repos.adminProducts.changeReviewStatus(id, 'approved');
    expect(await world.publicSlugs()).toEqual([slug]);

    await ingest([listing({ priceCents: 1599 })]);

    expect((await world.repos.adminProducts.getById(id))?.reviewStatus).toBe('approved');
    expect(await world.publicSlugs()).toEqual([slug]);
    expect((await world.publicBySlug(slug))?.product.price?.amount).toBe(15.99);
  });

  it('stay rejected (and hidden) after their offer is refreshed', async () => {
    await ingest([listing()], daysBeforeNow(2));
    const { id, slug } = await onlyProduct();
    await world.repos.adminProducts.changeReviewStatus(id, 'rejected', { notes: 'not our style' });

    await ingest([listing({ priceCents: 500 })]);

    const after = await world.repos.adminProducts.getById(id);
    expect(after).toMatchObject({ reviewStatus: 'rejected', reviewNotes: 'not our style' });
    expect(await world.publicBySlug(slug)).toBeUndefined();
    expect(await world.publicSlugs()).toEqual([]);
  });

  it('keep every reviewer-owned field when the retailer retitles and changes the listing', async () => {
    await ingest([listing({ description: 'Original retailer copy.' })], daysBeforeNow(2));
    const { id } = await onlyProduct();
    const indoor = await world.repos.categories.getBySlug('indoor');
    await world.repos.adminProducts.update(id, {
      name: 'Curated Name',
      summary: 'Curated summary.',
      description: 'Curated description.',
      categoryId: indoor!.id,
      qualityNotes: ['Curated note'],
      badges: ['Curated badge'],
      details: [{ label: 'Size', value: 'Curated' }],
      imageUrl: 'https://curated.example/image.jpg',
      reviewNotes: 'Curated internal note',
    });
    const curated = await world.repos.adminProducts.getById(id);

    await ingest([
      listing({
        name: 'Retailer Renamed This Completely',
        description: 'New retailer copy.',
        category: 'costumes',
        imageUrl: 'https://retailer.example/new-image.jpg',
        priceCents: 2499,
      }),
    ]);

    // Every product column is exactly as the reviewer left it (updated_at included: not even touched).
    expect(await world.repos.adminProducts.getById(id)).toEqual(curated);
    // The retailer's new title is kept as a source observation on the offer, not on the product.
    expect(await sourceTitleOf(id)).toBe('Retailer Renamed This Completely');
    expect((await offerOf(id)).priceCents).toBe(2499);
  });
});

// ---- bad and unmappable candidates --------------------------------------------------------

describe('candidates that cannot be used', () => {
  it('skips invalid candidates, reports them, and still ingests the valid one', async () => {
    const invalid: unknown[] = [
      listing({ externalId: 'B1', url: 'javascript:alert(1)' }), // unsafe URL
      listing({ externalId: 'B2', url: undefined }), // no URL
      listing({ externalId: 'B3', url: 'https://test-shop.example/b3', name: '   ' }), // no name
      listing({ externalId: 'B4', url: 'https://test-shop.example/b4', priceCents: 24.99 }), // dollars, not cents
      listing({ externalId: 'B5', url: 'https://test-shop.example/b5', priceCents: 500, currency: undefined }), // price without currency
      listing({ externalId: 'B6', url: 'https://test-shop.example/b6', availability: 'maybe' }),
      'not even an object',
    ];

    const result = await ingest([...invalid, listing({ externalId: 'OK', url: 'https://test-shop.example/ok' })]);

    expect(result).toMatchObject({ status: 'partial', discovered: 8, invalid: 7, productsCreated: 1, failed: 0 });
    expect(await world.count('products')).toBe(1);
    expect(await world.count('product_offers')).toBe(1);
    expect(result.issues.every((issue) => issue.code === 'invalid')).toBe(true);
  });

  it('drops an unsafe image URL without failing the product, and keeps a safe one', async () => {
    await ingest([
      listing({ externalId: 'I1', url: 'https://test-shop.example/i1', name: 'Bad Image', imageUrl: 'javascript:alert(1)' }),
      listing({ externalId: 'I2', url: 'https://test-shop.example/i2', name: 'Good Image', imageUrl: 'https://cdn.test-shop.example/i2.jpg' }),
    ]);

    const byName = new Map((await world.repos.adminProducts.getPendingProducts()).map((product) => [product.name, product]));
    expect(byName.get('Bad Image')).toBeDefined();
    expect(byName.get('Bad Image')?.imageUrl).toBeUndefined();
    expect(byName.get('Good Image')?.imageUrl).toBe('https://cdn.test-shop.example/i2.jpg');
  });

  it('does not create a product or a category for a listing it cannot map, and reports it', async () => {
    const categoriesBefore = await world.count('categories');

    const result = await ingest([
      listing({ externalId: 'U1', url: 'https://test-shop.example/u1', category: undefined, externalCategory: 'Party Supplies' }),
      listing({ externalId: 'U2', url: 'https://test-shop.example/u2', category: 'party-supplies' }), // not a supported slug
      listing({ externalId: 'OK', url: 'https://test-shop.example/ok' }),
    ]);

    expect(result).toMatchObject({ status: 'partial', unmapped: 2, productsCreated: 1 });
    expect(result.issues.map((issue) => issue.code)).toEqual(['unmapped_category', 'unmapped_category']);
    expect(result.issues[0]?.message).toContain('Party Supplies');
    expect(await world.count('products')).toBe(1);
    expect(await world.count('categories')).toBe(categoriesBefore);
  });

  it('still refreshes a known listing whose category is missing, since category is curator-owned', async () => {
    await ingest([listing({ priceCents: 1999 })], daysBeforeNow(1));

    const result = await ingest([listing({ priceCents: 1299, category: undefined })]);

    expect(result).toMatchObject({ unmapped: 0, offersUpdated: 1 });
    expect((await offerOf((await onlyProduct()).id)).priceCents).toBe(1299);
  });
});

// ---- disappearing listings ----------------------------------------------------------------

describe('listings that are missing or discontinued', () => {
  it('does not touch a listing that is simply absent from a later run', async () => {
    const stay = listing({ externalId: 'STAY', url: 'https://test-shop.example/stay', name: 'Stays' });
    const gone = listing({ externalId: 'GONE', url: 'https://test-shop.example/gone', name: 'Gone Quiet' });
    await ingest([stay, gone], daysBeforeNow(3));
    const goneProduct = (await world.repos.adminProducts.getPendingProducts()).find((product) => product.name === 'Gone Quiet')!;
    await world.repos.adminProducts.changeReviewStatus(goneProduct.id, 'approved');
    const before = await offerOf(goneProduct.id);

    await ingest([stay]);

    expect(await offerOf(goneProduct.id)).toEqual(before); // same availability, same last_checked_at
    expect(before.availability).toBe('in_stock');
    expect(await world.publicSlugs()).toContain(goneProduct.slug);
  });

  it('fails the run, and assumes nothing about any listing, when the source cannot be read', async () => {
    await ingest([listing()], daysBeforeNow(3));
    const product = await onlyProduct();
    const before = await offerOf(product.id);
    const broken: ProductIngestionSource<unknown> = {
      ...source([]),
      fetchItems: async () => {
        throw new Error('503 from upstream, secret details');
      },
    };

    const result = await runIngestion(world.d1, broken, { now: () => CatalogWorld.NOW });

    expect(result.status).toBe('failed');
    expect(result.issues).toMatchObject([{ code: 'run_failed' }]);
    expect(JSON.stringify(result)).not.toContain('secret details'); // the raw cause is never returned
    expect(await offerOf(product.id)).toEqual(before);
  });

  it('marks a listing discontinued only when the source explicitly says so', async () => {
    await ingest([listing()], daysBeforeNow(2));
    const { id, slug } = await onlyProduct();
    await world.repos.adminProducts.changeReviewStatus(id, 'approved');
    expect(await world.publicSlugs()).toEqual([slug]);

    await ingest([listing({ discontinued: true })]);

    expect((await offerOf(id)).availability).toBe('discontinued');
    expect(await world.publicSlugs()).toEqual([]); // no eligible offer left
    expect((await world.repos.adminProducts.getById(id))?.reviewStatus).toBe('approved'); // the review decision itself is untouched
  });
});

// ---- atomicity and run tracking -----------------------------------------------------------

describe('writes and tracking', () => {
  it('creates a product and its offer together or not at all', async () => {
    const { ingestion } = createIngestionRepositories(world.d1);
    const retailer = await ingestion.ensureRetailer(RETAILER);
    const outdoor = await world.repos.categories.getBySlug('outdoor');
    const facts = {
      productUrl: 'https://test-shop.example/x',
      priceCents: 100,
      currency: 'USD',
      availability: 'not-a-real-state' as never, // the offer insert violates a CHECK constraint
      lastCheckedAt: iso(CatalogWorld.NOW),
      sourceId: 'test',
      sourceTitle: 'X',
    };

    await expect(
      ingestion.createProductWithOffer({ productId: crypto.randomUUID(), offerId: crypto.randomUUID(), slug: 'x', name: 'X', summary: 'X', categoryId: outdoor!.id, retailerId: retailer.id, offer: facts }),
    ).rejects.toThrow();

    expect(await world.count('products')).toBe(0); // the product insert was rolled back with it
    expect(await world.count('product_offers')).toBe(0);
  });

  it('records each run with its counts and outcome', async () => {
    const { runs } = createIngestionRepositories(world.d1);

    const partial = await ingest([listing(), listing({ externalId: 'BAD', url: 'ftp://nope' })]);
    const clean = await ingest([listing()]);

    expect(await runs.getById(partial.runId)).toMatchObject({
      sourceId: 'test',
      status: 'partial',
      startedAt: iso(CatalogWorld.NOW),
      finishedAt: iso(CatalogWorld.NOW),
      discovered: 2,
      productsCreated: 1,
      offersCreated: 1,
      skipped: 1,
      failed: 0,
      errorCount: 1,
      issues: [{ index: 1, code: 'invalid' }],
    });
    expect(await runs.getById(clean.runId)).toMatchObject({ status: 'succeeded', discovered: 1, offersUnchanged: 1, errorCount: 0, issues: [] });
    expect(await world.count('ingestion_runs')).toBe(2);
  });

  it('refuses to ingest for a retailer a human deactivated, and does not reactivate it', async () => {
    const retailer = await world.retailer('test-shop', { active: false });

    const result = await ingest([listing()]);

    expect(result.status).toBe('failed');
    expect(await world.count('products')).toBe(0);
    expect((await world.repos.retailers.getById(retailer.id))?.isActive).toBe(false);
  });
});

// ---- observing each item ------------------------------------------------------------------

describe('per-item reports', () => {
  it('tells an observer what became of each item and which product it belongs to, without changing the run', async () => {
    await ingest([listing({ externalId: 'KNOWN', url: 'https://test-shop.example/known' })], daysBeforeNow(1));
    const known = await onlyProduct();

    const reports: ItemReport[] = [];
    const result = await runIngestion(
      world.d1,
      source([
        listing({ externalId: 'KNOWN', url: 'https://test-shop.example/known', priceCents: 1 }), // updated
        listing({ externalId: 'NEW', url: 'https://test-shop.example/new' }), //                    created
        listing({ externalId: 'NEW', url: 'https://test-shop.example/new' }), //                    duplicate
        listing({ externalId: 'BAD', url: 'javascript:alert(1)' }), //                              invalid
        listing({ externalId: 'NOCAT', url: 'https://test-shop.example/nocat', category: undefined }), // unmapped
      ]),
      { now: () => CatalogWorld.NOW, onItem: (report) => reports.push(report) },
    );

    expect(reports.map((report) => [report.index, report.outcome, report.code])).toEqual([
      [0, 'updated', undefined],
      [1, 'created', undefined],
      [2, 'skipped', 'duplicate'],
      [3, 'skipped', 'invalid'],
      [4, 'skipped', 'unmapped_category'],
    ]);
    expect(reports[0]?.productId).toBe(known.id); // an existing listing reports its existing product
    expect(reports[1]?.productId).toBeDefined();
    expect(reports[1]?.productId).not.toBe(known.id);
    expect(reports[2]?.productId).toBeUndefined();
    // The observer changed nothing about the run.
    expect(result).toMatchObject({ productsCreated: 1, offersUpdated: 1, duplicates: 1, invalid: 1, unmapped: 1, status: 'partial' });
  });

  it('is not affected by an observer that throws', async () => {
    const result = await runIngestion(world.d1, source([listing({ externalId: 'A', url: 'https://test-shop.example/a' }), listing({ externalId: 'B', url: 'https://test-shop.example/b' })]), {
      now: () => CatalogWorld.NOW,
      onItem: () => {
        throw new Error('observer bug');
      },
      onUnexpectedError: () => undefined,
    });

    expect(result).toMatchObject({ status: 'succeeded', productsCreated: 2 });
    expect(await world.count('products')).toBe(2);
  });
});

// ---- the fixture connector, end to end ----------------------------------------------------

describe('the fixture connector', () => {
  it('proves the whole workflow: ingest, review, refresh, and keep the curated data', async () => {
    const first = await runIngestion(world.d1, createFixtureSource('initial'), { now: () => daysBeforeNow(2) });
    expect(first).toMatchObject({ status: 'partial', discovered: 6, productsCreated: 3, duplicates: 1, invalid: 1, unmapped: 1 });
    expect(await world.publicSlugs()).toEqual([]);

    const pending = await world.repos.adminProducts.getPendingProducts();
    expect(pending.map((product) => product.name).sort()).toEqual(['Fixture Cobweb Garland', 'Fixture Glow Skeleton 5ft', 'Fixture Witch Costume (Adult)']);
    const skeleton = pending.find((product) => product.name === 'Fixture Glow Skeleton 5ft')!;
    const garland = pending.find((product) => product.name === 'Fixture Cobweb Garland')!;
    const witch = pending.find((product) => product.name === 'Fixture Witch Costume (Adult)')!;
    expect(garland.imageUrl).toBeUndefined(); // its unsafe image URL was dropped
    expect((await offerOf(skeleton.id)).priceCents).toBe(2999); // first occurrence won over the duplicate's 27.99

    await world.repos.adminProducts.changeReviewStatus(skeleton.id, 'approved');
    await world.repos.adminProducts.update(skeleton.id, { summary: 'Hand-written summary.' });
    expect(await world.publicSlugs()).toEqual([skeleton.slug]);

    const second = await runIngestion(world.d1, createFixtureSource('updated'), { now: () => CatalogWorld.NOW });
    expect(second).toMatchObject({ discovered: 5, productsCreated: 1, offersUpdated: 2, invalid: 1, unmapped: 1 });

    expect(await world.count('products')).toBe(4); // + the one new listing, no duplicates
    expect(await world.count('product_offers')).toBe(4);
    const refreshed = await offerOf(skeleton.id);
    expect(refreshed.priceCents).toBe(2499);
    expect(refreshed.lastCheckedAt).toBe(iso(CatalogWorld.NOW));
    expect(await world.repos.adminProducts.getById(skeleton.id)).toMatchObject({ reviewStatus: 'approved', summary: 'Hand-written summary.' });
    expect(await world.publicSlugs()).toEqual([skeleton.slug]);

    expect((await offerOf(garland.id)).availability).toBe('out_of_stock');
    expect(await sourceTitleOf(garland.id)).toBe('Fixture Cobweb Garland (2 Pack)');
    expect((await world.repos.adminProducts.getById(garland.id))?.name).toBe('Fixture Cobweb Garland'); // curated name untouched

    // FX-1003 was missing from the second feed: neither discontinued nor re-verified.
    expect(await offerOf(witch.id)).toMatchObject({ availability: 'out_of_stock', lastCheckedAt: iso(daysBeforeNow(2)) });
  });
});
