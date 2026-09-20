/**
 * Internal (server-side) domain models. These are richer than the public models in
 * src/types/, and some hold internal-only data (review notes). They must never be passed
 * to pages or components. Public reads return the public types from src/types/ instead.
 */
import type {
  ProductDetailItem,
  ProductReviewStatus,
} from '../../types';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description?: string;
  parentId?: string;
  sortOrder: number;
}

/** Full product for internal/admin use. Includes INTERNAL review notes. */
export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description?: string;
  categoryId: string;
  qualityNotes: string[];
  details: ProductDetailItem[];
  badges: string[];
  imageUrl?: string;
  imageAlt?: string;
  reviewStatus: ProductReviewStatus;
  /** INTERNAL. Never expose publicly. */
  reviewNotes?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

/** Input for creating a product. New products always start as `pending`. */
export interface NewProduct {
  /** Optional; generated when omitted. */
  id?: string;
  slug: string;
  name: string;
  summary: string;
  categoryId: string;
  description?: string;
  qualityNotes?: string[];
  details?: ProductDetailItem[];
  badges?: string[];
  imageUrl?: string;
  imageAlt?: string;
  reviewNotes?: string;
}

/**
 * Fields an update may change. `null` clears an optional field. Review status is NOT
 * here: it changes only through ProductRepository.changeReviewStatus.
 */
export interface ProductUpdate {
  slug?: string;
  name?: string;
  summary?: string;
  categoryId?: string;
  description?: string | null;
  qualityNotes?: string[] | null;
  details?: ProductDetailItem[] | null;
  badges?: string[] | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  reviewNotes?: string | null;
}

export interface RetailerRecord {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewRetailer {
  id?: string;
  slug: string;
  name: string;
  websiteUrl: string;
  isActive?: boolean;
}

export interface RetailerUpdate {
  slug?: string;
  name?: string;
  websiteUrl?: string;
  isActive?: boolean;
}

export type OfferAvailability = 'in_stock' | 'out_of_stock' | 'discontinued' | 'unknown';

/** A retailer's listing for a product. Amounts are integer cents. */
export interface ProductOffer {
  id: string;
  productId: string;
  retailerId: string;
  retailerProductId?: string;
  productUrl: string;
  /** Reserved for the future; nothing generates it yet. */
  affiliateUrl?: string;
  priceCents?: number;
  currency: string;
  availability: OfferAvailability;
  isPrimary: boolean;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewProductOffer {
  id?: string;
  productId: string;
  retailerId: string;
  retailerProductId?: string;
  productUrl: string;
  affiliateUrl?: string;
  priceCents?: number;
  currency?: string;
  availability?: OfferAvailability;
  isPrimary?: boolean;
  lastCheckedAt?: string;
}

export interface ProductOfferUpdate {
  retailerProductId?: string | null;
  productUrl?: string;
  affiliateUrl?: string | null;
  priceCents?: number | null;
  currency?: string;
  availability?: OfferAvailability;
  isPrimary?: boolean;
  lastCheckedAt?: string | null;
}
