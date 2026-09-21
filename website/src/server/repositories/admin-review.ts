import type { ProductReviewStatus } from '../../types';
import type { Database } from '../db/database';
import { toBoolean } from '../db/helpers';
import type {
  AdminOfferView,
  AdminProductDetail,
  AdminProductSummary,
  CategoryOption,
  ProductStatusCounts,
} from '../domain/admin';
import type { OfferAvailability } from '../domain/catalog';
import { classifyOfferFreshness } from '../domain/offer-freshness';
import type { CategoryRepository } from './categories';
import type { AdminProductRepository } from './products';
import type { PublicProductRepository } from './public-products';
import { isReviewStatus } from './products';

interface SummaryRow {
  id: string;
  slug: string;
  name: string;
  category_id: string;
  review_status: string;
  has_notes: number;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  price_cents: number | null;
  currency: string | null;
  retailer_name: string | null;
  offer_count: number;
}

interface OfferViewRow {
  id: string;
  retailer_id: string;
  retailer_name: string;
  retailer_website_url: string;
  retailer_is_active: number;
  retailer_product_id: string | null;
  product_url: string;
  price_cents: number | null;
  currency: string;
  availability: string;
  is_primary: number;
  last_checked_at: string | null;
  source_id: string | null;
  source_title: string | null;
}

// Preferred offer for display: primary first, else cheapest. (Unlike public reads, admin
// views also show offers from inactive retailers, so a reviewer can see everything.)
const SUMMARIES_SQL = `
SELECT
  p.id, p.slug, p.name, p.category_id, p.review_status,
  (p.review_notes IS NOT NULL AND length(trim(p.review_notes)) > 0) AS has_notes,
  p.created_at, p.updated_at, p.reviewed_at,
  o.price_cents, o.currency, r.name AS retailer_name,
  (SELECT COUNT(*) FROM product_offers x WHERE x.product_id = p.id) AS offer_count
FROM products p
LEFT JOIN product_offers o ON o.id = (
  SELECT o2.id FROM product_offers o2
  WHERE o2.product_id = p.id
  ORDER BY o2.is_primary DESC, o2.price_cents IS NULL, o2.price_cents ASC, o2.id ASC
  LIMIT 1
)
LEFT JOIN retailers r ON r.id = o.retailer_id
WHERE (? IS NULL OR p.review_status = ?)
ORDER BY
  CASE p.review_status WHEN 'pending' THEN 0 ELSE 1 END,
  CASE WHEN p.review_status = 'pending' THEN p.created_at END ASC,
  COALESCE(p.reviewed_at, p.created_at) DESC,
  p.id ASC`;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read models for the admin review UI: counts, queues, and a product's full review detail.
 * INTERNAL. Never use to build public pages. Writes go through AdminProductRepository.
 */
export class AdminReviewRepository {
  constructor(
    private readonly db: Database,
    private readonly categories: CategoryRepository,
    private readonly products: AdminProductRepository,
    private readonly publicProducts: PublicProductRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getStatusCounts(): Promise<ProductStatusCounts> {
    const rows = await this.db.all<{ status: string; count: number }>(
      'SELECT review_status AS status, COUNT(*) AS count FROM products GROUP BY review_status',
    );
    const counts: ProductStatusCounts = { pending: 0, approved: 0, rejected: 0, total: 0 };
    for (const row of rows) {
      if (isReviewStatus(row.status)) counts[row.status] = row.count;
      counts.total += row.count;
    }
    return counts;
  }

  /**
   * Queue rows. Pending are oldest-first (a review queue); approved/rejected are most
   * recently reviewed first. With no status, all products, pending first.
   */
  async listSummaries(status?: ProductReviewStatus): Promise<AdminProductSummary[]> {
    const index = await this.categories.getIndex();
    const rows = await this.db.all<SummaryRow>(SUMMARIES_SQL, status ?? null, status ?? null);

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      categoryLabel: index.pathLabel(row.category_id) ?? 'Unknown category',
      reviewStatus: row.review_status as ProductReviewStatus,
      hasReviewNotes: toBoolean(row.has_notes),
      offerCount: row.offer_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
      ...(row.retailer_name ? { retailerName: row.retailer_name } : {}),
      ...(row.price_cents !== null ? { priceCents: row.price_cents } : {}),
      ...(row.currency && row.price_cents !== null ? { currency: row.currency } : {}),
    }));
  }

  /** Categories for the edit form's dropdown, labelled with their ancestors. */
  async getCategoryOptions(): Promise<CategoryOption[]> {
    const index = await this.categories.getIndex();
    const all = await this.categories.getAll();
    return all
      .map((category) => ({ id: category.id, label: index.pathLabel(category.id) ?? category.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** A product by id (UUID) or slug, with offers and its current public representation. */
  async getReviewDetail(idOrSlug: string): Promise<AdminProductDetail | undefined> {
    const product = UUID_SHAPE.test(idOrSlug)
      ? await this.products.getById(idOrSlug)
      : await this.products.getBySlug(idOrSlug);
    if (!product) return undefined;

    const [index, offerRows, publicItem] = await Promise.all([
      this.categories.getIndex(),
      this.db.all<OfferViewRow>(
        `SELECT o.id, o.retailer_id, r.name AS retailer_name, r.website_url AS retailer_website_url,
                r.is_active AS retailer_is_active, o.retailer_product_id, o.product_url,
                o.price_cents, o.currency, o.availability, o.is_primary, o.last_checked_at,
                o.source_id, o.source_title
         FROM product_offers o
         JOIN retailers r ON r.id = o.retailer_id
         WHERE o.product_id = ?
         ORDER BY o.is_primary DESC, o.price_cents IS NULL, o.price_cents ASC, o.id ASC`,
        product.id,
      ),
      // Only approved products can be returned here, so this is undefined for pending/rejected.
      this.publicProducts.getApprovedProductBySlug(product.slug),
    ]);

    const offers: AdminOfferView[] = offerRows.map((row) => ({
      id: row.id,
      retailerId: row.retailer_id,
      retailerName: row.retailer_name,
      retailerWebsiteUrl: row.retailer_website_url,
      retailerIsActive: toBoolean(row.retailer_is_active),
      productUrl: row.product_url,
      currency: row.currency,
      availability: row.availability as OfferAvailability,
      isPrimary: toBoolean(row.is_primary),
      freshness: classifyOfferFreshness(row.last_checked_at, this.now()),
      ...(row.retailer_product_id ? { retailerProductId: row.retailer_product_id } : {}),
      ...(row.price_cents !== null ? { priceCents: row.price_cents } : {}),
      ...(row.last_checked_at ? { lastCheckedAt: row.last_checked_at } : {}),
      ...(row.source_id ? { sourceId: row.source_id } : {}),
      ...(row.source_title ? { sourceTitle: row.source_title } : {}),
    }));

    return {
      product,
      categoryLabel: index.pathLabel(product.categoryId) ?? 'Unknown category',
      offers,
      ...(publicItem ? { publicItem } : {}),
    };
  }
}
