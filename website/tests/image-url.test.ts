/**
 * Product image URLs: only a safe http(s) URL may reach a public product. An invalid image must
 * degrade to "no image" (the placeholder renders); it must never hide an otherwise eligible
 * product. Tested on the public repository output, not on rendered HTML.
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

/** The product is public and complete, but has no image (so the placeholder renders). */
async function expectPublicWithoutImage(slug: string) {
  expect(await world.publicSlugs()).toContain(slug);
  const item = await world.publicBySlug(slug);
  expect(item).toBeDefined();
  expect(item!.product.sourceUrl).toBeTruthy(); // still a fully usable, purchasable product
  expect(Object.keys(item!.product)).not.toContain('imageUrl');
  expect(Object.keys(item!.product)).not.toContain('imageAlt');
}

describe('public product image URL', () => {
  it('exposes a valid http(s) image URL unchanged', async () => {
    await world.eligibleProduct('secure-image', { imageUrl: 'https://cdn.example/skeleton.jpg', imageAlt: 'A skeleton' });
    await world.eligibleProduct('plain-image', { imageUrl: 'http://cdn.example/ghost.png' });

    for (const [slug, url] of [
      ['secure-image', 'https://cdn.example/skeleton.jpg'],
      ['plain-image', 'http://cdn.example/ghost.png'],
    ] as const) {
      const item = await world.publicBySlug(slug);
      expect(item?.product.imageUrl).toBe(url); // exactly as stored, never rewritten
      const listed = (await world.repos.publicProducts.getApprovedProducts()).find((entry) => entry.product.slug === slug);
      expect(listed?.product.imageUrl).toBe(url);
    }
    expect((await world.publicBySlug('secure-image'))?.product.imageAlt).toBe('A skeleton');
  });

  it('removes an unsafe-scheme image URL from public output but keeps the product public', async () => {
    const unsafe = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>'];
    for (const [index, imageUrl] of unsafe.entries()) {
      const product = await world.eligibleProduct(`unsafe-image-${index}`, { imageUrl, imageAlt: 'should not survive' });
      // Control: the unsafe value really is stored (the admin side keeps the raw data)...
      expect((await world.repos.adminProducts.getById(product.id))?.imageUrl).toBe(imageUrl);
      // ...but the public product has no image and the unsafe string appears nowhere in it.
      await expectPublicWithoutImage(`unsafe-image-${index}`);
      expect(JSON.stringify(await world.publicBySlug(`unsafe-image-${index}`))).not.toContain(imageUrl);
    }
    // Explicit: nothing about the products disappeared from the catalog.
    expect(await world.publicSlugs()).toEqual(['unsafe-image-0', 'unsafe-image-1']);
  });

  it('removes malformed and non-http image URLs (and never rewrites them)', async () => {
    const invalid = ['not a url', 'ftp://files.example/skeleton.png', '   ', ' https://cdn.example/padded.jpg '];
    for (const [index, imageUrl] of invalid.entries()) {
      await world.eligibleProduct(`bad-image-${index}`, { imageUrl });
      await expectPublicWithoutImage(`bad-image-${index}`);
    }
    // The padded URL is rejected, not "fixed" into a trimmed one nobody stored.
    const padded = await world.publicBySlug('bad-image-3');
    expect(JSON.stringify(padded)).not.toContain('padded.jpg');
  });
});
