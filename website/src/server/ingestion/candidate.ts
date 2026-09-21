/**
 * The normalized ingestion candidate: what ANY connector (API, feed, JSON, HTML scraper, CSV)
 * reduces a retailer listing to. Nothing here is specific to how the data was acquired.
 *
 * Two shapes, on purpose:
 *
 *  - `CandidateInput` is what a connector returns. Every field is `unknown`: connectors read
 *    outside data, and TypeScript cannot vouch for it. The engine never trusts it.
 *  - `IngestionCandidate` is what `validateCandidate` produces. Only this validated shape
 *    reaches the database. Unsafe URLs, malformed prices, and junk text cannot get past it.
 *
 * REQUIRED (a candidate without these is invalid and skipped):
 *   name          the retailer's title
 *   url           the retailer listing URL: http(s) only, normalized (see url.ts)
 *
 * OPTIONAL (absent is fine; a bad value is handled as described):
 *   externalId        the retailer's stable listing id. The strongest identity. Absent: the URL
 *                     is the identity. Present-but-malformed: invalid (never silently ignored,
 *                     which could create a duplicate).
 *   category          a supported category slug, mapped by the connector (category-mapping.ts).
 *                     Absent or unsupported: the candidate is `unmapped`, and can only refresh
 *                     an offer that already exists; it cannot create a product.
 *   externalCategory  the retailer's own category text, kept only to report unmapped listings.
 *   description       used to seed a NEW product's summary. Dropped if unusable.
 *   imageUrl          used to seed a NEW product's image. Dropped if not a safe http(s) URL;
 *                     never makes the candidate invalid.
 *   priceCents        INTEGER cents. A non-integer or negative value is invalid (so a float
 *                     dollar amount can never be stored). Absent: the price is unknown.
 *   currency          ISO 4217, required whenever a price is given.
 *   availability      in_stock | out_of_stock | unknown | discontinued. Absent: unknown.
 *   discontinued      true ONLY when the source itself says so. It wins over `availability`.
 *   observedAt        when the source was observed (`YYYY-MM-DDTHH:MM:SSZ`, UTC). Absent: the
 *                     time of processing. A time in the future is clamped to now.
 *
 * The retailer and source identity are NOT supplied by the connector per item: the engine
 * stamps them from the source, so an item cannot claim to belong to another retailer.
 */
import type { OfferAvailability } from '../domain/catalog';
import { toPublicImageUrl } from '../domain/image-url';
import { toIso } from '../db/helpers';
import { isIngestibleCategorySlug, type IngestibleCategorySlug } from './category-mapping';
import { cleanText, truncateAtWord } from './text';
import { normalizeRetailerUrl } from './url';

export const CANDIDATE_LIMITS = {
  name: 200,
  description: 2000,
  externalId: 200,
  externalCategory: 200,
  /** Sanity ceiling ($100,000) that catches unit mistakes (dollars vs cents) without limiting real listings. */
  maxPriceCents: 10_000_000,
} as const;

/** A validated candidate. Produced only by `validateCandidate`. */
export interface IngestionCandidate {
  // Stamped by the engine from the source.
  sourceId: string;
  retailerSlug: string;
  // Required.
  name: string;
  url: string;
  // Always present after validation.
  availability: OfferAvailability;
  observedAt: string;
  // Optional.
  externalId?: string;
  category?: IngestibleCategorySlug;
  externalCategory?: string;
  description?: string;
  imageUrl?: string;
  priceCents?: number;
  currency?: string;
}

/** What a connector returns for one item. Everything is unchecked until validated. */
export interface CandidateInput {
  externalId?: unknown;
  name?: unknown;
  url?: unknown;
  category?: unknown;
  externalCategory?: unknown;
  description?: unknown;
  imageUrl?: unknown;
  priceCents?: unknown;
  currency?: unknown;
  availability?: unknown;
  discontinued?: unknown;
  observedAt?: unknown;
}

export type CandidateValidation =
  | { ok: true; candidate: IngestionCandidate }
  | { ok: false; errors: string[] };

const AVAILABILITY: readonly OfferAvailability[] = ['in_stock', 'out_of_stock', 'discontinued', 'unknown'];
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const isPresent = (value: unknown): boolean => value !== undefined && value !== null;

export interface ValidationContext {
  sourceId: string;
  retailerSlug: string;
  /** The current moment: the default observation time, and the ceiling for `observedAt`. */
  now: Date;
}

export function validateCandidate(input: unknown, context: ValidationContext): CandidateValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['candidate is not an object'] };
  }
  const raw = input as CandidateInput;
  const errors: string[] = [];

  // ---- required -------------------------------------------------------------------------
  const cleanName = cleanText(raw.name);
  if (cleanName === undefined) errors.push('name is required');
  const name = cleanName === undefined ? '' : truncateAtWord(cleanName, CANDIDATE_LIMITS.name);

  const url = normalizeRetailerUrl(raw.url);
  if (url === undefined) errors.push('url is missing or not a safe http(s) URL');

  // ---- identity -------------------------------------------------------------------------
  let externalId: string | undefined;
  if (isPresent(raw.externalId)) {
    const id = typeof raw.externalId === 'number' && Number.isSafeInteger(raw.externalId) ? String(raw.externalId) : cleanText(raw.externalId);
    if (id === undefined || id.length > CANDIDATE_LIMITS.externalId) errors.push('externalId is present but not usable');
    else externalId = id;
  }

  // ---- offer facts ----------------------------------------------------------------------
  let priceCents: number | undefined;
  if (isPresent(raw.priceCents)) {
    const price = raw.priceCents;
    if (typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0 || price > CANDIDATE_LIMITS.maxPriceCents) {
      errors.push('priceCents must be a whole number of cents between 0 and 10000000');
    } else {
      priceCents = price;
    }
  }

  let currency: string | undefined;
  if (isPresent(raw.currency)) {
    if (typeof raw.currency === 'string' && /^[A-Za-z]{3}$/.test(raw.currency.trim())) currency = raw.currency.trim().toUpperCase();
    else errors.push('currency must be a 3-letter ISO 4217 code');
  } else if (priceCents !== undefined) {
    errors.push('currency is required when a price is given');
  }

  let availability: OfferAvailability = 'unknown';
  if (isPresent(raw.availability)) {
    if (typeof raw.availability === 'string' && (AVAILABILITY as readonly string[]).includes(raw.availability)) {
      availability = raw.availability as OfferAvailability;
    } else {
      errors.push('availability must be in_stock, out_of_stock, discontinued, or unknown');
    }
  }
  if (isPresent(raw.discontinued)) {
    if (typeof raw.discontinued !== 'boolean') errors.push('discontinued must be true or false');
    else if (raw.discontinued) availability = 'discontinued'; // only ever set from an explicit source statement
  }

  let observedAt = toIso(context.now);
  if (isPresent(raw.observedAt)) {
    const observed = typeof raw.observedAt === 'string' ? raw.observedAt : '';
    if (!CANONICAL_TIMESTAMP.test(observed) || Number.isNaN(Date.parse(observed))) {
      errors.push('observedAt must be a UTC timestamp like 2026-01-31T18:04:05Z');
    } else if (Date.parse(observed) < context.now.getTime()) {
      observedAt = observed; // never later than now: a future time would keep an offer "fresh" too long
    }
  }

  if (errors.length > 0 || url === undefined) return { ok: false, errors };

  // ---- optional, best-effort (never make the candidate invalid) ---------------------------
  const rawCategory = typeof raw.category === 'string' ? raw.category : undefined;
  const category = isIngestibleCategorySlug(rawCategory) ? rawCategory : undefined;
  const externalCategoryText = cleanText(raw.externalCategory) ?? (category === undefined ? cleanText(rawCategory) : undefined);
  const description = cleanText(raw.description);
  const imageUrl = typeof raw.imageUrl === 'string' ? toPublicImageUrl(raw.imageUrl) : undefined;

  return {
    ok: true,
    candidate: {
      sourceId: context.sourceId,
      retailerSlug: context.retailerSlug,
      name,
      url,
      availability,
      observedAt,
      ...(externalId !== undefined ? { externalId } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(externalCategoryText !== undefined ? { externalCategory: truncateAtWord(externalCategoryText, CANDIDATE_LIMITS.externalCategory) } : {}),
      ...(description !== undefined ? { description: truncateAtWord(description, CANDIDATE_LIMITS.description) } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(priceCents !== undefined ? { priceCents } : {}),
      ...(currency !== undefined ? { currency } : {}),
    },
  };
}
