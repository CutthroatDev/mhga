/**
 * Row -> domain mapping. This is the only place snake_case rows become domain objects,
 * so nothing else in the app sees database shapes.
 */
import type { DIYDifficulty, DIYProject, ProductDetailItem, ProductListItem, ProductReviewStatus } from '../../types';
import type {
  AdminProduct,
  Category,
  OfferAvailability,
  ProductOffer,
  RetailerRecord,
} from '../domain/catalog';
import type { CategoryIndex } from '../domain/category-index';
import { toPublicImageUrl } from '../domain/image-url';
import { parseJsonArray, toBoolean } from '../db/helpers';
import type {
  CategoryRow,
  DIYProjectRow,
  OfferRow,
  ProductRow,
  PublicProductRow,
  RetailerRow,
} from '../db/rows';

/** Only set a key when there is a value, so optional fields stay absent (not undefined). */
function optional<K extends string, V>(key: K, value: V | null | undefined): Partial<Record<K, V>> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function nonEmpty<K extends string, V>(key: K, values: V[]): Partial<Record<K, V[]>> {
  return values.length > 0 ? ({ [key]: values } as Record<K, V[]>) : {};
}

export function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sortOrder: row.sort_order,
    ...optional('description', row.description),
    ...optional('parentId', row.parent_id),
  };
}

/** Internal/admin product. Includes review notes. Never hand this to a page. */
export function mapAdminProduct(row: ProductRow): AdminProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    categoryId: row.category_id,
    qualityNotes: parseJsonArray<string>(row.quality_notes_json),
    details: parseJsonArray<ProductDetailItem>(row.details_json),
    badges: parseJsonArray<string>(row.badges_json),
    reviewStatus: row.review_status as ProductReviewStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...optional('description', row.description),
    ...optional('imageUrl', row.image_url),
    ...optional('imageAlt', row.image_alt),
    ...optional('reviewNotes', row.review_notes),
    ...optional('reviewedAt', row.reviewed_at),
  };
}

/**
 * Public product (the same `Product` the front end already uses) plus its retailer and
 * categories. Built only from PublicProductRow, which has no review notes. Returns
 * undefined for products whose category tree is not a supported public section.
 */
export function mapPublicProduct(row: PublicProductRow, categories: CategoryIndex): ProductListItem | undefined {
  const placement = categories.resolve(row.category_id);
  if (!placement) return undefined;

  const qualityNotes = parseJsonArray<string>(row.quality_notes_json);
  const details = parseJsonArray<ProductDetailItem>(row.details_json);
  const badges = parseJsonArray<string>(row.badges_json);
  // Only a safe http(s) image URL may become public. Otherwise: no image (the placeholder
  // renders), and the product stays public. See domain/image-url.ts.
  const imageUrl = toPublicImageUrl(row.image_url);

  return {
    product: {
      slug: row.slug,
      section: placement.section,
      name: row.name,
      summary: row.summary,
      categorySlugs: placement.categories.map((category) => category.slug),
      sourceUrl: row.offer_product_url,
      ...optional('description', row.description),
      ...optional('imageUrl', imageUrl),
      // Alt text only means something alongside an image.
      ...(imageUrl ? optional('imageAlt', row.image_alt) : {}),
      ...(row.offer_price_cents === null
        ? {}
        : {
            // Assumes a two-decimal currency (e.g. USD). Revisit if other currencies are added.
            price: { amount: row.offer_price_cents / 100, currency: row.offer_currency },
          }),
      ...nonEmpty('badges', badges),
      ...nonEmpty('qualityNotes', qualityNotes),
      ...nonEmpty('details', details),
    },
    retailer: {
      name: row.retailer_name,
      websiteUrl: row.retailer_website_url,
    },
    categories: placement.categories,
  };
}

export function mapRetailer(row: RetailerRow): RetailerRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    websiteUrl: row.website_url,
    isActive: toBoolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOffer(row: OfferRow): ProductOffer {
  return {
    id: row.id,
    productId: row.product_id,
    retailerId: row.retailer_id,
    productUrl: row.product_url,
    currency: row.currency,
    availability: row.availability as OfferAvailability,
    isPrimary: toBoolean(row.is_primary),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...optional('retailerProductId', row.retailer_product_id),
    ...optional('affiliateUrl', row.affiliate_url),
    ...optional('priceCents', row.price_cents),
    ...optional('lastCheckedAt', row.last_checked_at),
  };
}

/** Public DIY project. Callers pass only published rows. */
export function mapPublicDIYProject(row: DIYProjectRow, relatedProductSlugs: string[]): DIYProject {
  const imageUrl = toPublicImageUrl(row.image_url); // public-safe http(s) only, else no image
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    difficulty: row.difficulty as DIYDifficulty,
    materials: parseJsonArray<string>(row.materials_json),
    steps: parseJsonArray<string>(row.steps_json),
    published: true,
    ...optional('body', row.body),
    ...optional('estimatedTime', row.estimated_time),
    ...optional('imageUrl', imageUrl),
    ...(imageUrl ? optional('imageAlt', row.image_alt) : {}),
    ...nonEmpty('relatedProductSlugs', relatedProductSlugs),
  };
}
