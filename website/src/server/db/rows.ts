/**
 * Database row shapes (snake_case, as stored). These stay inside src/server/: repositories
 * map them to domain objects, so raw rows never reach pages or components.
 */

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  sort_order: number;
}

/** Every column, including INTERNAL review_notes. Used only by admin reads. */
export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string | null;
  category_id: string;
  quality_notes_json: string | null;
  details_json: string | null;
  badges_json: string | null;
  image_url: string | null;
  image_alt: string | null;
  review_status: string;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}

/**
 * The columns a public read may see. Deliberately has NO ids, review_notes, review_status,
 * or timestamps: public queries never select them, so they cannot leak.
 */
export interface PublicProductRow {
  slug: string;
  name: string;
  summary: string;
  description: string | null;
  category_id: string;
  quality_notes_json: string | null;
  details_json: string | null;
  badges_json: string | null;
  image_url: string | null;
  image_alt: string | null;
  // Selected offer (primary, else cheapest eligible) and its retailer. No ids on purpose.
  retailer_name: string;
  retailer_website_url: string;
  offer_product_url: string;
  offer_price_cents: number | null;
  offer_currency: string;
}

export interface RetailerRow {
  id: string;
  slug: string;
  name: string;
  website_url: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface OfferRow {
  id: string;
  product_id: string;
  retailer_id: string;
  retailer_product_id: string | null;
  product_url: string;
  affiliate_url: string | null;
  price_cents: number | null;
  currency: string;
  availability: string;
  is_primary: number;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DIYProjectRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string | null;
  materials_json: string | null;
  steps_json: string | null;
  difficulty: string;
  estimated_time: string | null;
  image_url: string | null;
  image_alt: string | null;
  status: string;
}

/** An offer as ingestion sees it: the identity and source-owned columns, including provenance. */
export interface IngestionOfferRow {
  id: string;
  product_id: string;
  retailer_product_id: string | null;
  product_url: string;
  price_cents: number | null;
  currency: string;
  availability: string;
  last_checked_at: string | null;
  source_id: string | null;
  source_title: string | null;
}

export interface IngestionRunRow {
  id: string;
  source_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  candidates_discovered: number;
  products_created: number;
  offers_created: number;
  offers_updated: number;
  offers_unchanged: number;
  candidates_skipped: number;
  candidates_failed: number;
  error_count: number;
  errors_json: string | null;
}
