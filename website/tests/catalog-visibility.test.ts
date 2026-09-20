/**
 * The public product visibility / review business rules. These are the rules that keep
 * unreviewed or unsafe products off the public site, so they must keep passing when
 * ingestion, review, repositories, or offers change.
 *
 * They run the REAL repositories against an isolated in-memory D1 built from the real
 * migrations. Nothing is mocked. Each "hidden" case also includes a fully eligible control
 * product that must be public, so a broken fixture cannot make a test pass by accident.
 *
 * Intentionally not covered: UI, rendering, CSS, themes, navigation, admin screens/forms,
 * Cloudflare Access, deployment, and generic framework or SQL-constraint behavior.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

/** The control is public, and every listed slug is hidden from both lists and slug lookup. */
async function expectOnlyControlIsPublic(...hiddenSlugs: string[]) {
  expect(await world.publicSlugs()).toEqual(['control']);
  expect(await world.publicBySlug('control')).toBeDefined();
  for (const slug of hiddenSlugs) {
    expect(await world.publicBySlug(slug)).toBeUndefined();
  }
}

describe('who is public', () => {
  it('hides a pending product even with an active retailer and a valid offer', async () => {
    await world.eligibleProduct('control');
    const pending = await world.product('pending-item', { status: 'pending' });
    await world.offer(pending, await world.retailer('pending-shop'));

    await expectOnlyControlIsPublic('pending-item');
  });

  it('hides a rejected product even with an active retailer and a valid offer', async () => {
    await world.eligibleProduct('control');
    const rejected = await world.product('rejected-item', { status: 'rejected' });
    await world.offer(rejected, await world.retailer('rejected-shop'));

    await expectOnlyControlIsPublic('rejected-item');
  });

  it('shows an approved product with an eligible offer, built from that offer', async () => {
    const product = await world.product('good-item');
    const retailer = await world.retailer('good-shop');
    await world.offer(product, retailer, { url: 'https://good-shop.example/item', priceCents: 1234, primary: true });

    expect(await world.publicSlugs()).toEqual(['good-item']);
    const item = await world.publicBySlug('good-item');
    expect(item).toMatchObject({
      product: {
        slug: 'good-item',
        section: 'decorations', // derived from the category tree
        categorySlugs: ['outdoor'],
        sourceUrl: 'https://good-shop.example/item',
        price: { amount: 12.34, currency: 'USD' },
      },
      retailer: { name: 'Retailer good-shop' },
    });
  });

  it('hides an approved product whose only offer is from an inactive retailer', async () => {
    await world.eligibleProduct('control');
    const product = await world.product('inactive-item');
    await world.offer(product, await world.retailer('closed-shop', { active: false }));

    await expectOnlyControlIsPublic('inactive-item');
  });

  it('hides an approved product whose only offer is discontinued', async () => {
    await world.eligibleProduct('control');
    const product = await world.product('discontinued-item');
    await world.offer(product, await world.retailer('old-shop'), { availability: 'discontinued' });

    await expectOnlyControlIsPublic('discontinued-item');
  });

  it('does not treat an unsafe purchase URL as an eligible offer', async () => {
    await world.eligibleProduct('control');
    // A javascript: link must never become a public "buy" button; ftp: is simply not http(s).
    const unsafe = ['javascript:alert(1)', 'ftp://files.example/item'];
    for (const [index, url] of unsafe.entries()) {
      const product = await world.product(`unsafe-${index}`);
      await world.offer(product, await world.retailer(`unsafe-shop-${index}`), { url });
    }

    await expectOnlyControlIsPublic('unsafe-0', 'unsafe-1');
  });
});

describe('internal data stays internal', () => {
  it('never puts review notes or admin fields in public output', async () => {
    const NOTE = 'INTERNAL: supplier looks shady, double-check';
    const product = await world.product('noted-item', { reviewNotes: NOTE });
    await world.offer(product, await world.retailer('noted-shop'), { primary: true });

    // Control: the note really is stored and visible to the admin side.
    expect((await world.repos.adminProducts.getById(product.id))?.reviewNotes).toBe(NOTE);

    // ...but no public read exposes it, in a list or by slug.
    const list = await world.repos.publicProducts.getApprovedProducts();
    const item = await world.publicBySlug('noted-item');
    expect(item).toBeDefined();
    expect(JSON.stringify(list)).not.toContain(NOTE);
    expect(JSON.stringify(item)).not.toContain(NOTE);

    // The public Product has no administrative fields, at runtime and in its type.
    const keys = Object.keys(item!.product);
    for (const forbidden of ['id', 'reviewNotes', 'reviewStatus', 'reviewedAt', 'createdAt', 'updatedAt']) {
      expect(keys).not.toContain(forbidden);
    }
    // @ts-expect-error review notes are not part of the public Product type
    void item!.product.reviewNotes;
    // @ts-expect-error review status is not part of the public Product type
    void item!.product.reviewStatus;
  });
});

describe('review transitions take effect immediately', () => {
  it('makes a pending product public as soon as it is approved', async () => {
    await world.eligibleProduct('control');
    const waiting = await world.product('waiting-item', { status: 'pending' });
    await world.offer(waiting, await world.retailer('waiting-shop'), { primary: true });
    await expectOnlyControlIsPublic('waiting-item');

    await world.repos.adminProducts.changeReviewStatus(waiting.id, 'approved');

    // No restart or rebuild: the very next public read sees it.
    expect(await world.publicSlugs()).toEqual(['control', 'waiting-item']);
    expect(await world.publicBySlug('waiting-item')).toBeDefined();
  });

  it('hides a public product as soon as it is rejected or returned to pending', async () => {
    await world.eligibleProduct('control');
    const live = await world.eligibleProduct('live-item');
    expect(await world.publicBySlug('live-item')).toBeDefined();

    for (const hidden of ['rejected', 'pending'] as const) {
      await world.repos.adminProducts.changeReviewStatus(live.id, 'approved');
      expect(await world.publicSlugs()).toEqual(['control', 'live-item']);

      await world.repos.adminProducts.changeReviewStatus(live.id, hidden);
      await expectOnlyControlIsPublic('live-item');
    }
  });
});

describe('offer selection', () => {
  it('uses the eligible primary offer, else the cheapest eligible one', async () => {
    const product = await world.product('multi-offer');
    const primary = await world.offer(product, await world.retailer('a-shop'), { priceCents: 3000, primary: true });
    await world.offer(product, await world.retailer('b-shop'), { priceCents: 1000 }); // cheapest eligible
    await world.offer(product, await world.retailer('c-shop'), { priceCents: 2000 });
    // Cheaper than everything, but not eligible (inactive retailer), so it must never be chosen.
    await world.offer(product, await world.retailer('d-shop', { active: false }), { priceCents: 500 });

    // The eligible primary wins even though it is not the cheapest.
    let item = await world.publicBySlug('multi-offer');
    expect(item?.retailer?.name).toBe('Retailer a-shop');
    expect(item?.product.price?.amount).toBe(30);

    // Primary becomes ineligible (discontinued): fall back to the cheapest ELIGIBLE offer.
    await world.repos.offers.update(primary.id, { availability: 'discontinued' });
    item = await world.publicBySlug('multi-offer');
    expect(item?.retailer?.name).toBe('Retailer b-shop');
    expect(item?.product.price?.amount).toBe(10);
  });
});
