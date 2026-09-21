/**
 * THE single definition of what makes a product publicly visible, and what a public read
 * selects. Every public product read (lists, by-slug, related, DIY) goes through
 * `buildPublicProductQuery()`, so list pages and direct slug access can never disagree.
 *
 * A product is public only when ALL of these hold:
 *
 *  1. review_status = 'approved'.
 *  2. It has an ELIGIBLE OFFER: the offer's retailer is active, the offer is not
 *     'discontinued', its product_url is an http(s) URL (a public buy link must never be
 *     something like a javascript: URL), and it is NOT EXPIRED: last_checked_at must be present
 *     and no older than the usable window. The window is defined only in
 *     domain/offer-freshness.ts; this query just receives its cutoff as a bound value and
 *     contains no day counts. Among eligible offers the PRIMARY one is used; if there is no
 *     eligible primary, the cheapest eligible offer (unknown price last). Freshness affects
 *     eligibility only, never that choice. A product with no eligible offer is not public.
 *  3. Its category resolves to a supported public section (decorations | costumes). That
 *     check needs the category tree, so it lives in TypeScript: `CategoryIndex.resolve()`
 *     via `mapPublicProduct()`, which drops the product otherwise.
 *
 * What it selects: only public columns. review_notes, review_status, timestamps (including
 * last_checked_at), and every database id are never selected, so they cannot reach a public
 * object.
 *
 * Callers add constant SQL fragments (`prefix`, `where`, `orderBy`) and pass their values
 * separately. Never build these fragments from user input.
 */
import { canonicalTimestampSql } from '../domain/offer-freshness';
import type { SqlValue } from '../db/database';

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
    AND ${canonicalTimestampSql('o2.last_checked_at')}
    AND CAST(strftime('%s', o2.last_checked_at) AS INTEGER) >= ?
  ORDER BY o2.is_primary DESC, o2.price_cents IS NULL, o2.price_cents ASC, o2.id ASC
  LIMIT 1
)
JOIN retailers r ON r.id = o.retailer_id
WHERE p.review_status = 'approved'`;

// Newest first, with the id as a tie-breaker so the order is always deterministic.
const DEFAULT_ORDER = 'p.created_at DESC, p.id ASC';

export interface PublicProductQueryParts {
  /** Oldest usable `last_checked_at`, in epoch seconds: `oldestUsableCheckSeconds(now)`. */
  offerCutoffSeconds: number;
  /** Optional leading WITH clause (constant SQL) and the values of its `?` placeholders. */
  prefix?: string;
  prefixValues?: SqlValue[];
  /** Extra conditions, each starting with AND (constant SQL) and their values. */
  where?: string;
  whereValues?: SqlValue[];
  orderBy?: string;
  orderValues?: SqlValue[];
}

/**
 * Assembles the SQL and its bound values together. Positional `?` placeholders bind in the
 * order they appear in the text: prefix, then the offer freshness cutoff (inside the offer
 * subquery), then the WHERE additions, then ORDER BY. Building both here keeps that order in
 * one place.
 */
export function buildPublicProductQuery({
  offerCutoffSeconds,
  prefix = '',
  prefixValues = [],
  where = '',
  whereValues = [],
  orderBy = DEFAULT_ORDER,
  orderValues = [],
}: PublicProductQueryParts): { sql: string; values: SqlValue[] } {
  return {
    sql: `${prefix}${SELECT_PUBLIC_PRODUCTS}${where ? `\n${where}` : ''}\nORDER BY ${orderBy}`,
    values: [...prefixValues, offerCutoffSeconds, ...whereValues, ...orderValues],
  };
}

/** Category and all of its descendants, by slug. Its one `?` is the category slug. */
export const CATEGORY_TREE_BY_SLUG = `
WITH RECURSIVE tree(id) AS (
  SELECT id FROM categories WHERE slug = ?
  UNION ALL
  SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
)
`;
