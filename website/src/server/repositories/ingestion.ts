import type { Database } from '../db/database';
import { newId, nowIso } from '../db/helpers';
import type { IngestionOfferRow, IngestionRunRow, RetailerRow } from '../db/rows';
import type { OfferAvailability, NewRetailer, RetailerRecord } from '../domain/catalog';
import type {
  ExistingOffer,
  IngestionIssue,
  IngestionRunCounts,
  IngestionRunRecord,
  IngestionRunStatus,
  NewIngestedProduct,
  OfferFacts,
} from '../domain/ingestion';
import { mapRetailer } from './mappers';

/** How many problems one run persists. The counts stay exact; only the detail list is bounded. */
export const MAX_PERSISTED_ISSUES = 50;

const OFFER_COLUMNS = `id, product_id, retailer_product_id, product_url, price_cents, currency,
  availability, last_checked_at, source_id, source_title`;

function mapExistingOffer(row: IngestionOfferRow): ExistingOffer {
  return {
    id: row.id,
    productId: row.product_id,
    productUrl: row.product_url,
    currency: row.currency,
    availability: row.availability as OfferAvailability,
    ...(row.retailer_product_id !== null ? { retailerProductId: row.retailer_product_id } : {}),
    ...(row.price_cents !== null ? { priceCents: row.price_cents } : {}),
    ...(row.last_checked_at !== null ? { lastCheckedAt: row.last_checked_at } : {}),
    ...(row.source_id !== null ? { sourceId: row.source_id } : {}),
    ...(row.source_title !== null ? { sourceTitle: row.source_title } : {}),
  };
}

/**
 * INTERNAL writes for the ingestion engine. Nothing here is exposed over HTTP, and it is not
 * part of the public repositories.
 *
 * The two structural guarantees live here, in SQL, not in the engine:
 *
 *  1. A product created by ingestion is ALWAYS `pending`. The status is a literal in the INSERT,
 *     not a parameter, so there is no way to ask this repository for anything else.
 *  2. Refreshing an offer touches `product_offers` only. It never writes to `products`, so a
 *     product's review status, review notes, name, summary, description, category, badges,
 *     details, quality notes and image cannot be changed by re-observing a listing.
 */
export class IngestionRepository {
  constructor(private readonly db: Database) {}

  /**
   * The retailer with this slug, creating it if it does not exist yet. An existing retailer is
   * returned exactly as it is: ingestion never renames, edits, or re-activates one (turning a
   * retailer off is a human decision).
   */
  async ensureRetailer(retailer: NewRetailer): Promise<RetailerRecord> {
    await this.db.run(
      `INSERT INTO retailers (id, slug, name, website_url, is_active) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (slug) DO NOTHING`,
      newId(),
      retailer.slug,
      retailer.name,
      retailer.websiteUrl,
    );
    const row = await this.db.first<RetailerRow>(
      'SELECT id, slug, name, website_url, is_active, created_at, updated_at FROM retailers WHERE slug = ?',
      retailer.slug,
    );
    if (!row) throw new Error('Retailer was not found after insert.');
    return mapRetailer(row);
  }

  /** Strong identity: this retailer's own listing id. */
  async findOfferByListingId(retailerId: string, listingId: string): Promise<ExistingOffer | undefined> {
    const row = await this.db.first<IngestionOfferRow>(
      `SELECT ${OFFER_COLUMNS} FROM product_offers WHERE retailer_id = ? AND retailer_product_id = ?`,
      retailerId,
      listingId,
    );
    return row ? mapExistingOffer(row) : undefined;
  }

  /** Fallback identity: this retailer's exact (normalized) listing URL. */
  async findOfferByUrl(retailerId: string, productUrl: string): Promise<ExistingOffer | undefined> {
    const row = await this.db.first<IngestionOfferRow>(
      `SELECT ${OFFER_COLUMNS} FROM product_offers WHERE retailer_id = ? AND product_url = ?`,
      retailerId,
      productUrl,
    );
    return row ? mapExistingOffer(row) : undefined;
  }

  async productSlugExists(slug: string): Promise<boolean> {
    return (await this.db.first('SELECT 1 AS found FROM products WHERE slug = ?', slug)) !== null;
  }

  /**
   * Creates a pending product and its offer in ONE batch (a single D1 transaction). Either both
   * rows exist afterwards or neither does, so a failure (including a unique-constraint clash
   * with a concurrent run) can never leave a product without its offer, or an offer pointing
   * nowhere. The new offer is the product's only offer, so it is the primary one.
   */
  async createProductWithOffer(input: NewIngestedProduct): Promise<void> {
    const { offer } = input;
    await this.db.batch([
      this.db.statement(
        `INSERT INTO products (id, slug, name, summary, category_id, image_url, review_status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        input.productId,
        input.slug,
        input.name,
        input.summary,
        input.categoryId,
        input.imageUrl,
      ),
      this.db.statement(
        `INSERT INTO product_offers (
           id, product_id, retailer_id, retailer_product_id, product_url,
           price_cents, currency, availability, is_primary, last_checked_at, source_id, source_title
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        input.offerId,
        input.productId,
        input.retailerId,
        offer.retailerProductId,
        offer.productUrl,
        offer.priceCents,
        offer.currency,
        offer.availability,
        offer.lastCheckedAt,
        offer.sourceId,
        offer.sourceTitle,
      ),
    ]);
  }

  /**
   * Writes a fresh observation onto an existing offer. Source-owned facts only: `is_primary`,
   * `affiliate_url` and every `products` column are left alone.
   *
   * `retailer_product_id` is only ever ADOPTED (filled in when it was empty), never replaced:
   * the engine treats a listing-id mismatch as a conflict, and this COALESCE makes sure a bug
   * there could not silently re-point an offer to a different retailer listing.
   */
  async refreshOffer(offerId: string, facts: OfferFacts): Promise<void> {
    await this.db.run(
      `UPDATE product_offers SET
         product_url = ?,
         retailer_product_id = COALESCE(retailer_product_id, ?),
         price_cents = ?,
         currency = ?,
         availability = ?,
         last_checked_at = ?,
         source_id = ?,
         source_title = ?,
         updated_at = ?
       WHERE id = ?`,
      facts.productUrl,
      facts.retailerProductId,
      facts.priceCents,
      facts.currency,
      facts.availability,
      facts.lastCheckedAt,
      facts.sourceId,
      facts.sourceTitle,
      nowIso(),
      offerId,
    );
  }
}

/** Lightweight run tracking: one row per ingestion run. */
export class IngestionRunRepository {
  constructor(private readonly db: Database) {}

  async start(id: string, sourceId: string, startedAt: string): Promise<void> {
    await this.db.run(
      "INSERT INTO ingestion_runs (id, source_id, status, started_at) VALUES (?, ?, 'running', ?)",
      id,
      sourceId,
      startedAt,
    );
  }

  async finish(
    id: string,
    outcome: { status: Exclude<IngestionRunStatus, 'running'>; finishedAt: string; counts: IngestionRunCounts; issues: IngestionIssue[]; errorCount: number },
  ): Promise<void> {
    const { counts } = outcome;
    await this.db.run(
      `UPDATE ingestion_runs SET
         status = ?, finished_at = ?,
         candidates_discovered = ?, products_created = ?, offers_created = ?, offers_updated = ?,
         offers_unchanged = ?, candidates_skipped = ?, candidates_failed = ?,
         error_count = ?, errors_json = ?
       WHERE id = ?`,
      outcome.status,
      outcome.finishedAt,
      counts.discovered,
      counts.productsCreated,
      counts.offersCreated,
      counts.offersUpdated,
      counts.offersUnchanged,
      counts.skipped,
      counts.failed,
      outcome.errorCount,
      outcome.issues.length > 0 ? JSON.stringify(outcome.issues.slice(0, MAX_PERSISTED_ISSUES)) : null,
      id,
    );
  }

  async getById(id: string): Promise<IngestionRunRecord | undefined> {
    const row = await this.db.first<IngestionRunRow>(
      `SELECT id, source_id, status, started_at, finished_at, candidates_discovered, products_created,
              offers_created, offers_updated, offers_unchanged, candidates_skipped, candidates_failed,
              error_count, errors_json
       FROM ingestion_runs WHERE id = ?`,
      id,
    );
    if (!row) return undefined;
    return {
      id: row.id,
      sourceId: row.source_id,
      status: row.status as IngestionRunStatus,
      startedAt: row.started_at,
      discovered: row.candidates_discovered,
      productsCreated: row.products_created,
      offersCreated: row.offers_created,
      offersUpdated: row.offers_updated,
      offersUnchanged: row.offers_unchanged,
      skipped: row.candidates_skipped,
      failed: row.candidates_failed,
      errorCount: row.error_count,
      issues: parseIssues(row.errors_json),
      ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    };
  }
}

function parseIssues(json: string | null): IngestionIssue[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? (value as IngestionIssue[]) : [];
  } catch {
    return [];
  }
}
