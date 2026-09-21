/**
 * Read models for the admin review interface. INTERNAL: some fields (review notes,
 * timestamps, status) are never shown publicly. These types must not be used by public
 * pages or components.
 */
import type { ProductListItem, ProductReviewStatus } from '../../types';
import type { AdminProduct, OfferAvailability } from './catalog';
import type { OfferFreshness } from './offer-freshness';

export type ProductStatusCounts = Record<ProductReviewStatus, number> & { total: number };

/** One row in a review queue. */
export interface AdminProductSummary {
  id: string;
  slug: string;
  name: string;
  /** e.g. "Decorations › Outdoor Decorations" */
  categoryLabel: string;
  reviewStatus: ProductReviewStatus;
  hasReviewNotes: boolean;
  /** From the preferred offer (primary, else cheapest), if any offer exists. */
  retailerName?: string;
  priceCents?: number;
  currency?: string;
  offerCount: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

/** An offer as shown to a reviewer (no affiliate data). */
export interface AdminOfferView {
  id: string;
  retailerId: string;
  retailerName: string;
  retailerWebsiteUrl: string;
  retailerIsActive: boolean;
  retailerProductId?: string;
  productUrl: string;
  priceCents?: number;
  currency: string;
  availability: OfferAvailability;
  isPrimary: boolean;
  lastCheckedAt?: string;
  /** Set when the offer came from automated ingestion: the source that last observed it. Read-only. */
  sourceId?: string;
  /** The retailer's own title at that observation. May differ from the curated product name. Read-only. */
  sourceTitle?: string;
  /** Derived from lastCheckedAt by the freshness policy (never stored). 'expired' offers are not used publicly. */
  freshness: OfferFreshness;
}

export interface CategoryOption {
  id: string;
  label: string;
}

export interface AdminProductDetail {
  product: AdminProduct;
  categoryLabel: string;
  offers: AdminOfferView[];
  /**
   * Exactly what the public site would show for this product right now, or undefined when
   * it is not public (not approved, or no offer from an active retailer).
   */
  publicItem?: ProductListItem;
}
