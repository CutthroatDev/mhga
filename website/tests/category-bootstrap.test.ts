/**
 * The required category hierarchy is structural data created by the migrations (not by the
 * local seed). The public catalog derives a product's section and sub-category from it, so a
 * fresh database must have it. One small test: it starts from a freshly migrated database with
 * no seed, checks the tree, then checks products resolve through it.
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

describe('required categories', () => {
  it('come from the migrations, and products resolve through the hierarchy', async () => {
    // The tree exists on a freshly migrated database: no seed, no fixtures.
    const all = await world.repos.categories.getAll();
    const bySlug = new Map(all.map((category) => [category.slug, category]));
    expect([...bySlug.keys()].sort()).toEqual(['costumes', 'decorations', 'indoor', 'outdoor']);
    expect(all).toHaveLength(4); // slugs are unique: nothing duplicated

    expect(bySlug.get('decorations')?.parentId).toBeUndefined();
    expect(bySlug.get('costumes')?.parentId).toBeUndefined();
    expect(bySlug.get('outdoor')?.parentId).toBe(bySlug.get('decorations')?.id);
    expect(bySlug.get('indoor')?.parentId).toBe(bySlug.get('decorations')?.id);
    expect(bySlug.get('outdoor')?.name).toBe('Outdoor Decorations');
    expect(bySlug.get('indoor')?.name).toBe('Indoor Decorations');

    // Public products resolve to the right category and section through that tree.
    await world.eligibleProduct('yard-skeleton', { category: 'outdoor' });
    await world.eligibleProduct('mantel-candle', { category: 'indoor' });
    await world.eligibleProduct('witch-hat', { category: 'costumes' });

    const { publicProducts } = world.repos;
    const slugs = async (query: Parameters<typeof publicProducts.getApprovedProducts>[0]) =>
      (await publicProducts.getApprovedProducts(query)).map((item) => item.product.slug).sort();

    expect(await slugs({ categorySlug: 'outdoor' })).toEqual(['yard-skeleton']);
    expect(await slugs({ categorySlug: 'indoor' })).toEqual(['mantel-candle']);
    expect(await slugs({ section: 'costumes' })).toEqual(['witch-hat']);
    expect(await slugs({ section: 'decorations' })).toEqual(['mantel-candle', 'yard-skeleton']);

    const skeleton = await publicProducts.getApprovedProductBySlug('yard-skeleton');
    expect(skeleton?.product).toMatchObject({ section: 'decorations', categorySlugs: ['outdoor'] });
    const hat = await publicProducts.getApprovedProductBySlug('witch-hat');
    expect(hat?.product).toMatchObject({ section: 'costumes', categorySlugs: [] });
  });
});
