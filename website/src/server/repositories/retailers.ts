import type { Database } from '../db/database';
import { buildAssignments, fromBoolean, newId, nowIso } from '../db/helpers';
import type { RetailerRow } from '../db/rows';
import type { NewRetailer, RetailerRecord, RetailerUpdate } from '../domain/catalog';
import { mapRetailer } from './mappers';

const COLUMNS = 'id, slug, name, website_url, is_active, created_at, updated_at';

/** Internal retailer access. Nothing here is exposed over HTTP. */
export class RetailerRepository {
  constructor(private readonly db: Database) {}

  async getById(id: string): Promise<RetailerRecord | undefined> {
    const row = await this.db.first<RetailerRow>(`SELECT ${COLUMNS} FROM retailers WHERE id = ?`, id);
    return row ? mapRetailer(row) : undefined;
  }

  async getBySlug(slug: string): Promise<RetailerRecord | undefined> {
    const row = await this.db.first<RetailerRow>(`SELECT ${COLUMNS} FROM retailers WHERE slug = ?`, slug);
    return row ? mapRetailer(row) : undefined;
  }

  async list(options: { activeOnly?: boolean } = {}): Promise<RetailerRecord[]> {
    const rows = await this.db.all<RetailerRow>(
      options.activeOnly
        ? `SELECT ${COLUMNS} FROM retailers WHERE is_active = 1 ORDER BY name`
        : `SELECT ${COLUMNS} FROM retailers ORDER BY name`,
    );
    return rows.map(mapRetailer);
  }

  async create(input: NewRetailer): Promise<RetailerRecord> {
    const id = input.id ?? newId();
    await this.db.run(
      'INSERT INTO retailers (id, slug, name, website_url, is_active) VALUES (?, ?, ?, ?, ?)',
      id,
      input.slug,
      input.name,
      input.websiteUrl,
      fromBoolean(input.isActive ?? true),
    );
    const created = await this.getById(id);
    if (!created) throw new Error('Retailer was not found after insert.');
    return created;
  }

  async update(id: string, patch: RetailerUpdate): Promise<RetailerRecord | undefined> {
    const { setClause, values } = buildAssignments([
      ['slug', patch.slug],
      ['name', patch.name],
      ['website_url', patch.websiteUrl],
      ['is_active', patch.isActive === undefined ? undefined : fromBoolean(patch.isActive)],
    ]);
    if (setClause) {
      await this.db.run(`UPDATE retailers SET ${setClause}, updated_at = ? WHERE id = ?`, ...values, nowIso(), id);
    }
    return this.getById(id);
  }
}
