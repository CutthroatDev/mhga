import type { ProductReviewStatus } from '../../types';
import type { Database } from '../db/database';
import { buildAssignments, newId, nowIso, toJsonArray } from '../db/helpers';
import type { ProductRow } from '../db/rows';
import type { AdminProduct, NewProduct, ProductUpdate } from '../domain/catalog';
import { mapAdminProduct } from './mappers';

const COLUMNS = `id, slug, name, summary, description, category_id,
  quality_notes_json, details_json, badges_json, image_url, image_alt,
  review_status, review_notes, created_at, updated_at, reviewed_at`;

const REVIEW_STATUSES: readonly ProductReviewStatus[] = ['pending', 'approved', 'rejected'];

export function isReviewStatus(value: string): value is ProductReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(value);
}

/**
 * INTERNAL/ADMIN product access. Returns every product regardless of review status, and
 * includes internal review notes. It must only ever be used from trusted server code
 * (a future authenticated admin), never to build public pages. Public reads live in
 * PublicProductRepository.
 *
 * Nothing here is exposed over HTTP.
 */
export class AdminProductRepository {
  constructor(private readonly db: Database) {}

  async getById(id: string): Promise<AdminProduct | undefined> {
    const row = await this.db.first<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE id = ?`, id);
    return row ? mapAdminProduct(row) : undefined;
  }

  async getBySlug(slug: string): Promise<AdminProduct | undefined> {
    const row = await this.db.first<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE slug = ?`, slug);
    return row ? mapAdminProduct(row) : undefined;
  }

  async listByStatus(status: ProductReviewStatus): Promise<AdminProduct[]> {
    const rows = await this.db.all<ProductRow>(
      `SELECT ${COLUMNS} FROM products WHERE review_status = ? ORDER BY created_at, id`,
      status,
    );
    return rows.map(mapAdminProduct);
  }

  /** The review queue, oldest first. */
  async getPendingProducts(): Promise<AdminProduct[]> {
    return this.listByStatus('pending');
  }

  /** Products in a category and its descendants, any status, for admin browsing. */
  async listByCategorySlug(categorySlug: string): Promise<AdminProduct[]> {
    const rows = await this.db.all<ProductRow>(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM categories WHERE slug = ?
         UNION ALL
         SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
       )
       SELECT ${COLUMNS} FROM products
       WHERE category_id IN (SELECT id FROM tree)
       ORDER BY created_at, id`,
      categorySlug,
    );
    return rows.map(mapAdminProduct);
  }

  /**
   * Creates a product. It always starts as `pending`: nothing becomes public without going
   * through changeReviewStatus.
   */
  async create(input: NewProduct): Promise<AdminProduct> {
    const id = input.id ?? newId();
    await this.db.run(
      `INSERT INTO products (
         id, slug, name, summary, description, category_id,
         quality_notes_json, details_json, badges_json, image_url, image_alt, review_notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.slug,
      input.name,
      input.summary,
      input.description,
      input.categoryId,
      toJsonArray(input.qualityNotes),
      toJsonArray(input.details),
      toJsonArray(input.badges),
      input.imageUrl,
      input.imageAlt,
      input.reviewNotes,
    );
    const created = await this.getById(id);
    if (!created) throw new Error('Product was not found after insert.');
    return created;
  }

  /** Updates content fields. Review status is intentionally not updatable here. */
  async update(id: string, patch: ProductUpdate): Promise<AdminProduct | undefined> {
    const { setClause, values } = buildAssignments([
      ['slug', patch.slug],
      ['name', patch.name],
      ['summary', patch.summary],
      ['category_id', patch.categoryId],
      ['description', patch.description],
      ['quality_notes_json', toJsonArray(patch.qualityNotes)],
      ['details_json', toJsonArray(patch.details)],
      ['badges_json', toJsonArray(patch.badges)],
      ['image_url', patch.imageUrl],
      ['image_alt', patch.imageAlt],
      ['review_notes', patch.reviewNotes],
    ]);

    if (setClause) {
      await this.db.run(
        `UPDATE products SET ${setClause}, updated_at = ? WHERE id = ?`,
        ...values,
        nowIso(),
        id,
      );
    }
    return this.getById(id);
  }

  /**
   * The only way a product's review status changes. Approving or rejecting records
   * `reviewed_at`; returning a product to `pending` keeps the last review time.
   */
  async changeReviewStatus(
    id: string,
    status: ProductReviewStatus,
    options: { notes?: string | null } = {},
  ): Promise<AdminProduct | undefined> {
    if (!isReviewStatus(status)) throw new Error(`Invalid review status: ${String(status)}`);

    const now = nowIso();
    const { setClause, values } = buildAssignments([
      ['review_status', status],
      ['reviewed_at', status === 'pending' ? undefined : now],
      ['review_notes', options.notes],
    ]);
    await this.db.run(`UPDATE products SET ${setClause}, updated_at = ? WHERE id = ?`, ...values, now, id);
    return this.getById(id);
  }
}
