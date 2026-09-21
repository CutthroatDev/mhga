/**
 * Ingestion write models: what the ingestion repositories accept and return. INTERNAL, like
 * everything in src/server/domain. None of this ever reaches a public page or model.
 *
 * The split that matters here is OWNERSHIP:
 *
 *  - `OfferFacts` are SOURCE-OWNED. They describe what a retailer says about one listing, so a
 *    fresh observation may overwrite them.
 *  - `NewIngestedProduct` seeds CURATOR-OWNED product fields (name, summary, category, image),
 *    but only when a brand-new product is created. Nothing here can update an existing
 *    product: the refresh path takes `OfferFacts` and touches `product_offers` only.
 */
import type { OfferAvailability } from './catalog';

/** What a retailer reports about one listing at one moment. All of it is refreshed on re-observation. */
export interface OfferFacts {
  productUrl: string;
  /** The retailer's own listing id, when it has one. Only ever adopted, never replaced (see refreshOffer). */
  retailerProductId?: string;
  /** Integer cents, or null when the source gave no price. */
  priceCents: number | null;
  currency: string;
  availability: OfferAvailability;
  /** When the source was observed (canonical UTC). Drives offer freshness. */
  lastCheckedAt: string;
  sourceId: string;
  /** The retailer's own title. A source observation, kept apart from the curated product name. */
  sourceTitle: string;
}

/** An offer found by identity lookup: just what ingestion needs to decide what changed. */
export interface ExistingOffer {
  id: string;
  productId: string;
  retailerProductId?: string;
  productUrl: string;
  priceCents?: number;
  currency: string;
  availability: OfferAvailability;
  lastCheckedAt?: string;
  sourceId?: string;
  sourceTitle?: string;
}

/** A new pending product plus its first offer, written together. */
export interface NewIngestedProduct {
  productId: string;
  offerId: string;
  slug: string;
  name: string;
  summary: string;
  categoryId: string;
  imageUrl?: string;
  retailerId: string;
  offer: OfferFacts;
}

export type IngestionRunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

export type IngestionIssueCode =
  | 'invalid'
  | 'unmapped_category'
  | 'duplicate'
  | 'identity_conflict'
  | 'write_failed'
  | 'run_failed';

/** One problem worth reporting. `message` is engine-written text: never a raw SQL error or retailer payload. */
export interface IngestionIssue {
  /** Position of the item in the source's list (0-based); absent for run-level problems. */
  index?: number;
  code: IngestionIssueCode;
  message: string;
  /** A short handle for finding the listing: its external id, else its URL. */
  ref?: string;
}

export interface IngestionRunCounts {
  discovered: number;
  productsCreated: number;
  offersCreated: number;
  offersUpdated: number;
  offersUnchanged: number;
  /** Duplicate + invalid + unmapped + conflict. */
  skipped: number;
  /** Candidates whose handling failed unexpectedly. */
  failed: number;
}

export interface IngestionRunRecord extends IngestionRunCounts {
  id: string;
  sourceId: string;
  status: IngestionRunStatus;
  startedAt: string;
  finishedAt?: string;
  errorCount: number;
  issues: IngestionIssue[];
}
