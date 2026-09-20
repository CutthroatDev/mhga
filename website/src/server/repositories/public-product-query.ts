/**
 * THE single definition of what makes a product publicly visible, and what a public read
 * selects. Every public product read (lists, by-slug, related, DIY) goes through
 * `publicProductQuery()`, so list pages and direct slug access can never disagree.
 *
 * A product is public only when ALL of these hold:
 *
 *  1. review_status = 'approved'.
 *  2. It has an ELIGIBLE OFFER: the offer's retailer is active, the offer is not
 *     'discontinued', and its product_url is an http(s) URL (a public buy link must never
 *     be something like a javascript: URL). Among eligible offers the PRIMARY one is used;
 *     if there is no eligible primary, the cheapest eligible offer (unknown price last).
 *     A product with no eligible offer is not public.
 *  3. Its category resolves to a supported public section (decorations | costumes). That
 *     check needs the category tree, so it lives in TypeScript: `CategoryIndex.resolve()`
 *     via `mapPublicProduct()`, which drops the product otherwise.
 *
 * What it selects: only public columns. review_notes, review_status, timestamps, and every
 * database id are never selected, so they cannot reach a public object.
 *
 * Callers add constant SQL fragments (`prefix`, `where`, `orderBy`) and bind any values.
 * Never build these fragments from user input.
 */
const SELECT_PUBLIC_PRODUCTS = `
SELECT
  p.slug, p.name, p.summary, p.description, p.category_id,
  p.quality_notes_json, p.details_json, p.badges_json, p.image_url, p.image_alt,
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
    AND o2.availability <> 'discontinued'
    AND (o2.product_url LIKE 'https://%' OR o2.product_url LIKE 'http://%')
  ORDER BY o2.is_primary DESC, o2.price_cents IS NULL, o2.price_cents ASC, o2.id ASC
  LIMIT 1
)
JOIN retailers r ON r.id = o.retailer_id
WHERE p.review_status = 'approved'`;

// Newest first, with the id as a tie-breaker so the order is always deterministic.
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
