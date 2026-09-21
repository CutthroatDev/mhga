/**
 * Small fixture builders for the catalog tests: category, retailer, product, offer.
 *
 * Fixtures go through the REAL repositories (the same ones the admin uses), so they follow
 * the real workflow: a product is created pending, then moved to approved/rejected with
 * changeReviewStatus. Categories are NOT created here: the required hierarchy (decorations >
 * outdoor, indoor; costumes) comes from migrations/0002_bootstrap_categories.sql, and the
 * tests look those real categories up by slug.
 *
 * Repositories are created fresh on every access, like a real request does, so nothing is
 * cached between calls.
 *
 * TIME IS FIXED. The repositories run on `CatalogWorld.NOW`, not the real clock, so freshness
 * results never depend on today's date. Offer timestamps are always explicit: by default an
 * offer was checked one day before NOW (fresh); pass `lastCheckedAt` (or null for "never").
 */
import type { ProductReviewStatus } from '../../src/types';
import type { OfferAvailability, ProductOffer, RetailerRecord, AdminProduct } from '../../src/server/domain/catalog';
import { createRepositories } from '../../src/server/repositories';
import { createTestDatabase, type TestDatabase } from './test-db';

export class CatalogWorld {
  /** The reference "now" for every test (UTC). Arbitrary, but fixed. */
  static readonly NOW = new Date('2026-06-15T12:00:00Z');

  private constructor(private readonly db: TestDatabase) {}

  static async create(): Promise<CatalogWorld> {
    return new CatalogWorld(await createTestDatabase());
  }

  /** Empties everything except the migration-created categories. */
  async reset(): Promise<void> {
    await this.db.clear();
  }

  dispose(): Promise<void> {
    return this.db.dispose();
  }

  get repos() {
    return createRepositories(this.db.d1, { now: () => CatalogWorld.NOW });
  }

  /**
   * An ISO timestamp (whole seconds, UTC, `...Z`) that is `days` days plus `extraSeconds` before
   * NOW. `isoAgo(30)` is exactly 30 days old; `isoAgo(30, 1)` is one second older than that.
   */
  isoAgo(days: number, extraSeconds = 0): string {
    const milliseconds = CatalogWorld.NOW.getTime() - (days * 86_400 + extraSeconds) * 1000;
    return new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/, 'Z');
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
    options: {
      status?: ProductReviewStatus;
      reviewNotes?: string;
      category?: string;
      imageUrl?: string;
      imageAlt?: string;
    } = {},
  ): Promise<AdminProduct> {
    const { adminProducts, categories } = this.repos;
    const category = await categories.getBySlug(options.category ?? 'outdoor');
    if (!category) throw new Error(`Category "${options.category ?? 'outdoor'}" is missing: are the migrations applied?`);
    const created = await adminProducts.create({
      slug,
      name: `Product ${slug}`,
      summary: `Summary of ${slug}`,
      categoryId: category.id,
      ...(options.reviewNotes ? { reviewNotes: options.reviewNotes } : {}),
      ...(options.imageUrl !== undefined ? { imageUrl: options.imageUrl } : {}),
      ...(options.imageAlt !== undefined ? { imageAlt: options.imageAlt } : {}),
    });
    const status = options.status ?? 'approved';
    if (status === 'pending') return created;
    return (await adminProducts.changeReviewStatus(created.id, status)) ?? created;
  }

  offer(
    product: AdminProduct,
    retailer: RetailerRecord,
    options: {
      url?: string;
      priceCents?: number;
      availability?: OfferAvailability;
      primary?: boolean;
      /** ISO timestamp; `null` means never checked (stored as NULL). Default: 1 day before NOW. */
      lastCheckedAt?: string | null;
    } = {},
  ): Promise<ProductOffer> {
    const lastCheckedAt = options.lastCheckedAt === undefined ? this.isoAgo(1) : options.lastCheckedAt;
    return this.repos.offers.create({
      productId: product.id,
      retailerId: retailer.id,
      productUrl: options.url ?? `https://${retailer.slug}.example/${product.slug}`,
      priceCents: options.priceCents ?? 1000,
      availability: options.availability ?? 'in_stock',
      isPrimary: options.primary ?? false,
      ...(lastCheckedAt === null ? {} : { lastCheckedAt }),
    });
  }

  /** Approved + active retailer + valid http(s) offer: the baseline that IS public. */
  async eligibleProduct(
    slug: string,
    options: { category?: string; imageUrl?: string; imageAlt?: string } = {},
  ): Promise<AdminProduct> {
    const product = await this.product(slug, options);
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
