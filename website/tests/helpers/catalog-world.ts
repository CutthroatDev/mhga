/**
 * Small fixture builders for the catalog tests: category, retailer, product, offer.
 *
 * Fixtures go through the REAL repositories (the same ones the admin uses), so they follow
 * the real workflow: a product is created pending, then moved to approved/rejected with
 * changeReviewStatus. Only categories are inserted with SQL, because there is no category
 * write repository yet.
 *
 * Repositories are created fresh on every access, like a real request does, so nothing is
 * cached between calls.
 */
import type { ProductReviewStatus } from '../../src/types';
import type { OfferAvailability, ProductOffer, RetailerRecord, AdminProduct } from '../../src/server/domain/catalog';
import { createRepositories } from '../../src/server/repositories';
import { createTestDatabase, type TestDatabase } from './test-db';

const CATEGORY = { decorations: 'cat-decorations', outdoor: 'cat-outdoor' } as const;

export class CatalogWorld {
  private constructor(private readonly db: TestDatabase) {}

  static async create(): Promise<CatalogWorld> {
    return new CatalogWorld(await createTestDatabase());
  }

  /** Empties the database and inserts the one category tree the tests use. */
  async reset(): Promise<void> {
    await this.db.clear();
    await this.db.d1.batch([
      this.db.d1
        .prepare('INSERT INTO categories (id, slug, name, parent_id) VALUES (?, ?, ?, ?)')
        .bind(CATEGORY.decorations, 'decorations', 'Decorations', null),
      this.db.d1
        .prepare('INSERT INTO categories (id, slug, name, parent_id) VALUES (?, ?, ?, ?)')
        .bind(CATEGORY.outdoor, 'outdoor', 'Outdoor', CATEGORY.decorations),
    ]);
  }

  dispose(): Promise<void> {
    return this.db.dispose();
  }

  get repos() {
    return createRepositories(this.db.d1);
  }

  // ---- builders --------------------------------------------------------------------------

  retailer(slug: string, options: { active?: boolean } = {}): Promise<RetailerRecord> {
    return this.repos.retailers.create({
      slug,
      name: `Retailer ${slug}`,
      websiteUrl: `https://${slug}.example`,
      isActive: options.active ?? true,
    });
  }

  /** Created pending (as in real life), then moved to `status` if it is not pending. */
  async product(
    slug: string,
    options: { status?: ProductReviewStatus; reviewNotes?: string } = {},
  ): Promise<AdminProduct> {
    const { adminProducts } = this.repos;
    const created = await adminProducts.create({
      slug,
      name: `Product ${slug}`,
      summary: `Summary of ${slug}`,
      categoryId: CATEGORY.outdoor,
      ...(options.reviewNotes ? { reviewNotes: options.reviewNotes } : {}),
    });
    const status = options.status ?? 'approved';
    if (status === 'pending') return created;
    return (await adminProducts.changeReviewStatus(created.id, status)) ?? created;
  }

  offer(
    product: AdminProduct,
    retailer: RetailerRecord,
    options: { url?: string; priceCents?: number; availability?: OfferAvailability; primary?: boolean } = {},
  ): Promise<ProductOffer> {
    return this.repos.offers.create({
      productId: product.id,
      retailerId: retailer.id,
      productUrl: options.url ?? `https://${retailer.slug}.example/${product.slug}`,
      priceCents: options.priceCents ?? 1000,
      availability: options.availability ?? 'in_stock',
      isPrimary: options.primary ?? false,
    });
  }

  /** Approved + active retailer + valid http(s) offer: the baseline that IS public. */
  async eligibleProduct(slug: string): Promise<AdminProduct> {
    const product = await this.product(slug);
    await this.offer(product, await this.retailer(`shop-${slug}`), { primary: true });
    return product;
  }

  // ---- public reads (what the public site sees) -------------------------------------------

  async publicSlugs(): Promise<string[]> {
    const items = await this.repos.publicProducts.getApprovedProducts();
    return items.map((item) => item.product.slug).sort();
  }

  publicBySlug(slug: string) {
    return this.repos.publicProducts.getApprovedProductBySlug(slug);
  }
}
