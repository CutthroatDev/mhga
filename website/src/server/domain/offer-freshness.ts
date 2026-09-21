/**
 * THE offer freshness policy: how old retailer/price information is treated. This module is the
 * single source of truth. The thresholds below appear nowhere else.
 *
 * Freshness is DERIVED from `product_offers.last_checked_at`. It is never stored (no stale or
 * expired column), so it cannot drift out of date.
 *
 *   age = now - last_checked_at
 *
 *   age <= 7 days                 fresh    eligible
 *   7 days < age <= 30 days       stale    still eligible; internally due for a refresh
 *   age > 30 days                 expired  NOT eligible for public use
 *   last_checked_at missing       expired  NOT eligible
 *   last_checked_at unparseable   expired  NOT eligible
 *
 * Boundaries are inclusive on the older side: exactly 7 days is fresh, exactly 30 days is still
 * usable, and one second past 30 days is expired.
 *
 * Why a missing timestamp is ineligible: once ingestion exists, an offer with no record of when
 * it was verified cannot be trusted, so it must not be sold publicly.
 *
 * Time: everything is UTC and compared in WHOLE SECONDS (fractions are truncated), so TypeScript
 * and SQL agree exactly, even on the boundary second. A timestamp in the future counts as fresh
 * (tolerates clock skew; the policy does not try to police it).
 *
 * How it is used:
 *  - Public eligibility (SQL): public-product-query.ts binds `oldestUsableCheckSeconds(now)` and
 *    requires a canonical `last_checked_at` at or after it. It contains no day counts. Doing it
 *    inside the offer-selection query is what makes an expired primary fall back to another
 *    eligible offer, and hides the product when none remains.
 *  - Internal (TypeScript): `classifyOfferFreshness` labels an offer. Future ingestion should
 *    refresh 'stale' offers BEFORE they become 'expired'.
 *
 * Freshness affects ELIGIBILITY only. Which eligible offer is chosen (primary first, else the
 * cheapest, unknown price last) is unchanged.
 */

export type OfferFreshness = 'fresh' | 'stale' | 'expired';

/** An offer checked within this many days is fresh. */
export const OFFER_FRESH_DAYS = 7;

/** An offer checked within this many days is still usable (stale). Older is expired. */
export const OFFER_USABLE_DAYS = 30;

const SECONDS_PER_DAY = 86_400;

/**
 * The only timestamp shape the policy trusts: ISO 8601, UTC, ending in Z (what the app and the
 * seed write). Anything else, including offset or local-time strings whose meaning depends on
 * the parser, is treated as missing. Kept in step with canonicalTimestampSql() below.
 */
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * The SQL side of CANONICAL_UTC_TIMESTAMP: a boolean expression that is true only for the same
 * shape. `column` must be a literal column reference written in code (never user input).
 *
 * It avoids a long GLOB because D1 rejects LIKE/GLOB patterns over about 50 bytes. Instead: SQLite
 * re-formatting the value must reproduce its first 19 characters exactly (this rejects a space
 * separator, local times, and offsets, and yields NULL for garbage), and the rest must be `Z` or
 * `.fraction` ending in `Z`. NULL results count as false in a WHERE clause.
 */
export function canonicalTimestampSql(column: string): string {
  return `(strftime('%Y-%m-%dT%H:%M:%S', ${column}) = substr(${column}, 1, 19)
      AND substr(${column}, 20, 1) IN ('Z', '.')
      AND substr(${column}, -1) = 'Z')`;
}

function wholeSeconds(milliseconds: number): number {
  return Math.floor(milliseconds / 1000);
}

export function classifyOfferFreshness(
  lastCheckedAt: string | null | undefined,
  now: Date,
): OfferFreshness {
  if (!lastCheckedAt || !CANONICAL_UTC_TIMESTAMP.test(lastCheckedAt)) return 'expired';
  const checked = Date.parse(lastCheckedAt);
  if (Number.isNaN(checked)) return 'expired';

  const ageSeconds = wholeSeconds(now.getTime()) - wholeSeconds(checked);
  if (ageSeconds <= OFFER_FRESH_DAYS * SECONDS_PER_DAY) return 'fresh';
  if (ageSeconds <= OFFER_USABLE_DAYS * SECONDS_PER_DAY) return 'stale';
  return 'expired';
}

/** Fresh and stale offers may be used publicly; expired ones may not. */
export function isOfferUsable(freshness: OfferFreshness): boolean {
  return freshness !== 'expired';
}

/**
 * The oldest `last_checked_at` (epoch seconds, UTC) that is still usable at `now`. An offer is
 * usable exactly when its timestamp is at or after this. Bound into the public SQL query, so
 * the day threshold is never duplicated there.
 */
export function oldestUsableCheckSeconds(now: Date): number {
  return wholeSeconds(now.getTime()) - OFFER_USABLE_DAYS * SECONDS_PER_DAY;
}
