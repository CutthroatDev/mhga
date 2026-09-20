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
 * The columns a public read may see. Deliberately has NO review_notes, review_status,
 * or timestamps: public queries never select them, so they cannot leak.
 */
export interface PublicProductRow {
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
  // Chosen offer (primary, else cheapest) and its retailer
  retailer_id: string;
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
