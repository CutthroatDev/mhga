/**
 * The one place that defines what a PUBLIC product read selects.
 *
 * Guarantees, by construction:
 *  - only review_status = 'approved' products
 *  - review_notes (and status/timestamps) are never selected
 *  - only products that have a usable offer from an ACTIVE retailer (the public `Product`
 *    needs a purchase link). The offer used is the primary one, else the cheapest.
 *
 * Callers add constant SQL fragments (`prefix`, `where`, `orderBy`) and bind any values.
 * Never build these fragments from user input.
 */
const SELECT_PUBLIC_PRODUCTS = `
SELECT
  p.id, p.slug, p.name, p.summary, p.description, p.category_id,
  p.quality_notes_json, p.details_json, p.badges_json, p.image_url, p.image_alt,
  o.retailer_id            AS retailer_id,
  r.name                   AS retailer_name,
  r.website_url            AS retailer_website_url,
  o.product_url            AS offer_product_url,
  o.price_cents            AS offer_price_cents,
  o.currency               AS offer_currency
FROM products p
JOIN product_offers o ON o.id = (
  SELECT o2.id
  FROM product_offers o2
  JOIN retailers r2 ON r2.id = o2.retailer_id AND r2.is_active = 1
  WHERE o2.product_id = p.id
  ORDER BY o2.is_primary DESC, o2.price_cents IS NULL, o2.price_cents ASC, o2.id ASC
  LIMIT 1
)
JOIN retailers r ON r.id = o.retailer_id
WHERE p.review_status = 'approved'`;

const DEFAULT_ORDER = 'p.created_at DESC, p.id ASC';

export interface PublicProductQueryParts {
  /** Optional leading WITH clause (constant SQL). */
  prefix?: string;
  /** Extra conditions, each starting with AND (constant SQL, using ? placeholders). */
  where?: string;
  orderBy?: string;
}

export function publicProductQuery({ prefix = '', where = '', orderBy = DEFAULT_ORDER }: PublicProductQueryParts = {}): string {
  return `${prefix}${SELECT_PUBLIC_PRODUCTS}${where ? `\n${where}` : ''}\nORDER BY ${orderBy}`;
}

/** Category and all of its descendants, by slug. Bind the slug as ?1 in the tree CTE. */
export const CATEGORY_TREE_BY_SLUG = `
WITH RECURSIVE tree(id) AS (
  SELECT id FROM categories WHERE slug = ?
  UNION ALL
  SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
)
`;
