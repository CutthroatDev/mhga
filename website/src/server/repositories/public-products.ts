import type { ProductListItem, ProductSection } from '../../types';
import type { Database } from '../db/database';
import type { PublicProductRow } from '../db/rows';
import type { CategoryRepository } from './categories';
import { mapPublicProduct } from './mappers';
import { CATEGORY_TREE_BY_SLUG, publicProductQuery } from './public-product-query';

export interface PublicProductQuery {
  section?: ProductSection;
  categorySlug?: string;
  limit?: number;
}

/**
 * PUBLIC product reads. Everything here returns approved products only, as the public
 * `Product` shape (via ProductListItem), and can never include review notes, because the
 * SQL in public-product-query.ts does not select them.
 *
 * Products with no usable offer from an active retailer are not returned, since the public
 * `Product` requires a purchase link.
 *
 * The public site does not use this yet (it still reads src/data-access/ static data);
 * it is here so the switch can be made later without changing pages.
 */
export class PublicProductRepository {
  constructor(
    private readonly db: Database,
    private readonly categories: CategoryRepository,
  ) {}

  /** Approved products, optionally narrowed to a section and/or category (with descendants). */
  async getApprovedProducts(query: PublicProductQuery = {}): Promise<ProductListItem[]> {
    // A category and its descendants; a section is just its root category.
    const treeSlug = query.categorySlug ?? query.section;
    const sql = treeSlug
      ? publicProductQuery({
          prefix: CATEGORY_TREE_BY_SLUG,
          where: 'AND p.category_id IN (SELECT id FROM tree)',
        })
      : publicProductQuery();
    const rows = await this.db.all<PublicProductRow>(sql, ...(treeSlug ? [treeSlug] : []));

    const items = await this.toItems(rows);
    const inSection = query.section ? items.filter((item) => item.product.section === query.section) : items;
    return query.limit === undefined ? inSection : inSection.slice(0, query.limit);
  }

  /** Approved products in a category (including its sub-categories), by category slug. */
  async getApprovedProductsByCategory(categorySlug: string): Promise<ProductListItem[]> {
    return this.getApprovedProducts({ categorySlug });
  }

  /** Slugs are unique across the site, so no section is needed. */
  async getApprovedProductBySlug(slug: string): Promise<ProductListItem | undefined> {
    const rows = await this.db.all<PublicProductRow>(
      publicProductQuery({ where: 'AND p.slug = ?' }),
      slug,
    );
    return (await this.toItems(rows))[0];
  }

  /** Approved products by id. Unknown or unapproved ids are skipped. */
  async getApprovedProductsByIds(ids: string[]): Promise<ProductListItem[]> {
    if (ids.length === 0) return [];
    // One bound JSON parameter instead of a variable-length IN (...) list.
    const rows = await this.db.all<PublicProductRow>(
      publicProductQuery({ where: 'AND p.id IN (SELECT value FROM json_each(?))' }),
      JSON.stringify(ids),
    );
    return this.toItems(rows);
  }

  /** Approved products used by a project, in the project's deliberate order. */
  async getApprovedProductsForProject(projectId: string): Promise<ProductListItem[]> {
    const rows = await this.db.all<PublicProductRow>(
      publicProductQuery({
        where: 'AND p.id IN (SELECT product_id FROM diy_project_products WHERE project_id = ?)',
        orderBy:
          '(SELECT l.sort_order FROM diy_project_products l WHERE l.project_id = ? AND l.product_id = p.id) ASC, p.id ASC',
      }),
      projectId,
      projectId,
    );
    return this.toItems(rows);
  }

  private async toItems(rows: PublicProductRow[]): Promise<ProductListItem[]> {
    if (rows.length === 0) return [];
    const index = await this.categories.getIndex();
    return rows.flatMap((row) => {
      const item = mapPublicProduct(row, index);
      return item ? [item] : [];
    });
  }
}
