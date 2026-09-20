import type { Database } from '../db/database';
import type { CategoryRow } from '../db/rows';
import type { Category } from '../domain/catalog';
import { CategoryIndex } from '../domain/category-index';
import { mapCategory } from './mappers';

const COLUMNS = 'id, slug, name, description, parent_id, sort_order';

export class CategoryRepository {
  constructor(private readonly db: Database) {}

  async getAll(): Promise<Category[]> {
    const rows = await this.db.all<CategoryRow>(
      `SELECT ${COLUMNS} FROM categories ORDER BY sort_order, name`,
    );
    return rows.map(mapCategory);
  }

  async getBySlug(slug: string): Promise<Category | undefined> {
    const row = await this.db.first<CategoryRow>(
      `SELECT ${COLUMNS} FROM categories WHERE slug = ?`,
      slug,
    );
    return row ? mapCategory(row) : undefined;
  }

  /** The whole (small) tree in memory, for resolving a product's section and sub-categories. */
  async getIndex(): Promise<CategoryIndex> {
    return new CategoryIndex(await this.getAll());
  }
}
