/**
 * Offer freshness policy (src/server/domain/offer-freshness.ts): how old retailer/price
 * information is treated by the public catalog.
 *
 *   <= 7 days fresh | <= 30 days stale but usable | > 30 days expired | missing: expired
 *
 * Time is fixed (CatalogWorld.NOW), never the real clock. The public repository decides
 * eligibility in SQL from a cutoff the policy computes, and the policy also classifies offers in
 * TypeScript; the boundary test checks that both agree.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { classifyOfferFreshness, isOfferUsable } from '../src/server/domain/offer-freshness';
import { CatalogWorld } from './helpers/catalog-world';

const NOW = CatalogWorld.NOW;
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

/** An approved product whose only offer was checked at `lastCheckedAt` (null = never). */
async function productWithOffer(slug: string, lastCheckedAt: string | null, priceCents = 1000) {
  const product = await world.product(slug);
  await world.offer(product, await world.retailer(`shop-${slug}`), { lastCheckedAt, priceCents, primary: true });
  return product;
}

describe('offer freshness', () => {
  it('keeps a fresh offer eligible', async () => {
    const checked = world.isoAgo(1);
    await productWithOffer('fresh-item', checked);

    expect(await world.publicSlugs()).toEqual(['fresh-item']);
    expect(classifyOfferFreshness(checked, NOW)).toBe('fresh');
  });

  it('keeps a stale-but-usable offer eligible, and classifies it as due for refresh', async () => {
    const checked = world.isoAgo(20);
    await productWithOffer('stale-item', checked);

    expect(await world.publicSlugs()).toEqual(['stale-item']);
    expect(classifyOfferFreshness(checked, NOW)).toBe('stale');
    expect(isOfferUsable('stale')).toBe(true);
  });

  it('hides a product whose only offer is expired', async () => {
    await world.eligibleProduct('control');
    const checked = world.isoAgo(45);
    await productWithOffer('expired-item', checked);

    expect(await world.publicSlugs()).toEqual(['control']);
    expect(await world.publicBySlug('expired-item')).toBeUndefined();
    expect(classifyOfferFreshness(checked, NOW)).toBe('expired');
  });

  it('treats a missing or untrustworthy last_checked_at as expired', async () => {
    await world.eligibleProduct('control');
    // NULL (never checked), unparseable text, and a non-UTC/non-canonical form whose meaning
    // would depend on the parser. None can be trusted, so none is eligible.
    const untrusted: Array<[string, string | null]> = [
      ['never-checked', null],
      ['garbage', 'not a date'],
      ['local-time', '2026-06-14 12:00:00'],
    ];
    for (const [slug, value] of untrusted) {
      await productWithOffer(slug, value);
      expect(classifyOfferFreshness(value, NOW)).toBe('expired'); // policy and SQL agree
    }

    expect(await world.publicSlugs()).toEqual(['control']);
  });

  it('falls back from an expired primary offer, and never lets freshness change price selection', async () => {
    // Expired primary and an even cheaper expired offer are skipped; the usable (stale) one wins.
    const product = await world.product('fallback-item');
    await world.offer(product, await world.retailer('primary-shop'), { priceCents: 1000, primary: true, lastCheckedAt: world.isoAgo(40) });
    await world.offer(product, await world.retailer('cheap-expired-shop'), { priceCents: 500, lastCheckedAt: world.isoAgo(60) });
    await world.offer(product, await world.retailer('backup-shop'), { priceCents: 3000, lastCheckedAt: world.isoAgo(25) });

    const item = await world.publicBySlug('fallback-item');
    expect(item?.retailer?.name).toBe('Retailer backup-shop');
    expect(item?.product.price?.amount).toBe(30);

    // With no primary, the CHEAPEST eligible offer wins even if it is stale and a pricier one
    // is fresh: freshness decides eligibility, not the choice among eligible offers.
    const other = await world.product('price-item');
    await world.offer(other, await world.retailer('stale-cheap-shop'), { priceCents: 1000, lastCheckedAt: world.isoAgo(25) });
    await world.offer(other, await world.retailer('fresh-pricey-shop'), { priceCents: 2000, lastCheckedAt: world.isoAgo(1) });

    expect((await world.publicBySlug('price-item'))?.retailer?.name).toBe('Retailer stale-cheap-shop');
  });

  it('applies the exact boundaries: 7 days fresh, 30 days usable, one second later is not', async () => {
    // Policy classification: inclusive on the older side.
    expect(classifyOfferFreshness(world.isoAgo(7), NOW)).toBe('fresh');
    expect(classifyOfferFreshness(world.isoAgo(7, 1), NOW)).toBe('stale');
    expect(classifyOfferFreshness(world.isoAgo(30), NOW)).toBe('stale');
    expect(classifyOfferFreshness(world.isoAgo(30, 1), NOW)).toBe('expired');

    // The public repository (SQL) agrees at the edge that matters publicly.
    await productWithOffer('exactly-30-days', world.isoAgo(30));
    await productWithOffer('thirty-days-and-a-second', world.isoAgo(30, 1));
    expect(await world.publicSlugs()).toEqual(['exactly-30-days']);
  });
});
