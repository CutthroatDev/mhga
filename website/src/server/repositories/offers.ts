import type { Database } from '../db/database';
import { buildAssignments, fromBoolean, newId, nowIso } from '../db/helpers';
import type { OfferRow } from '../db/rows';
import type { NewProductOffer, ProductOffer, ProductOfferUpdate } from '../domain/catalog';
import { mapOffer } from './mappers';

const COLUMNS = `id, product_id, retailer_id, retailer_product_id, product_url, affiliate_url,
  price_cents, currency, availability, is_primary, last_checked_at, created_at, updated_at`;

/**
 * Retailer offers (listings) for products. Internal only; nothing here is exposed over HTTP.
 * No price tracking and no affiliate-link generation happens here: the affiliate URL is
 * just stored when supplied.
 */
export class OfferRepository {
  constructor(private readonly db: Database) {}

  async getById(id: string): Promise<ProductOffer | undefined> {
    const row = await this.db.first<OfferRow>(`SELECT ${COLUMNS} FROM product_offers WHERE id = ?`, id);
    return row ? mapOffer(row) : undefined;
  }

  /** All offers for a product, preferred offer first, then cheapest. */
  async getOffersForProduct(productId: string): Promise<ProductOffer[]> {
    const rows = await this.db.all<OfferRow>(
      `SELECT ${COLUMNS} FROM product_offers
       WHERE product_id = ?
       ORDER BY is_primary DESC, price_cents IS NULL, price_cents ASC, id ASC`,
      productId,
    );
    return rows.map(mapOffer);
  }

  async create(input: NewProductOffer): Promise<ProductOffer> {
    const id = input.id ?? newId();
    const insert = this.db.statement(
      `INSERT INTO product_offers (
         id, product_id, retailer_id, retailer_product_id, product_url, affiliate_url,
         price_cents, currency, availability, is_primary, last_checked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'USD'), COALESCE(?, 'unknown'), ?, ?)`,
      id,
      input.productId,
      input.retailerId,
      input.retailerProductId,
      input.productUrl,
      input.affiliateUrl,
      input.priceCents,
      input.currency,
      input.availability,
      fromBoolean(input.isPrimary ?? false),
      input.lastCheckedAt,
    );

    // Atomic: demote any current primary offer, then insert the new one.
    await this.db.batch(
      input.isPrimary
        ? [this.demotePrimaryStatement(input.productId, id), insert]
        : [insert],
    );

    const created = await this.getById(id);
    if (!created) throw new Error('Offer was not found after insert.');
    return created;
  }

  async update(id: string, patch: ProductOfferUpdate): Promise<ProductOffer | undefined> {
    const existing = await this.getById(id);
    if (!existing) return undefined;

    const { setClause, values } = buildAssignments([
      ['retailer_product_id', patch.retailerProductId],
      ['product_url', patch.productUrl],
      ['affiliate_url', patch.affiliateUrl],
      ['price_cents', patch.priceCents],
      ['currency', patch.currency],
      ['availability', patch.availability],
      ['is_primary', patch.isPrimary === undefined ? undefined : fromBoolean(patch.isPrimary)],
      ['last_checked_at', patch.lastCheckedAt],
    ]);
    if (!setClause) return existing;

    const update = this.db.statement(
      `UPDATE product_offers SET ${setClause}, updated_at = ? WHERE id = ?`,
      ...values,
      nowIso(),
      id,
    );
    await this.db.batch(
      patch.isPrimary ? [this.demotePrimaryStatement(existing.productId, id), update] : [update],
    );
    return this.getById(id);
  }

  /** Clears the primary flag on every other offer of the product. */
  private demotePrimaryStatement(productId: string, exceptOfferId: string) {
    return this.db.statement(
      'UPDATE product_offers SET is_primary = 0, updated_at = ? WHERE product_id = ? AND id <> ? AND is_primary = 1',
      nowIso(),
      productId,
      exceptOfferId,
    );
  }
}
