import type { ProductCategory, ProductListItem, ProductSection } from '../../types';
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
 * PUBLIC product reads: the data source for the public site.
 *
 * Every method returns only publicly eligible products (see public-product-query.ts for
 * the single definition of eligibility) as the public `Product` shape. Internal data such
 * as review notes is not selected by the SQL and cannot appear in the result.
 *
 * Listing and by-slug reads share the same query, so a product hidden from a list is
 * equally hidden from direct access: a pending, rejected, ineligible or unknown slug all
 * return `undefined`, indistinguishably.
 *
 * Query cost per call: one product query, plus the (small) category tree, which is loaded
 * once per repository instance. No per-product queries. Create the repository per request.
 */
export class PublicProductRepository {
  constructor(
    private readonly db: Database,
    private readonly categories: CategoryRepository,
  ) {}

  /**
   * Eligible products, optionally narrowed to a section and/or category (including its
   * sub-categories). Newest first with a stable tie-break, so the order is deterministic.
   */
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

  /** Eligible products in a category (including its sub-categories), by category slug. */
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

  /**
   * Eligible products for the given slugs, in the order the slugs were given. Unknown and
   * ineligible slugs are skipped.
   */
  async getApprovedProductsBySlugs(slugs: string[]): Promise<ProductListItem[]> {
    if (slugs.length === 0) return [];
    // One bound JSON parameter instead of a variable-length IN (...) list.
    const rows = await this.db.all<PublicProductRow>(
      publicProductQuery({ where: 'AND p.slug IN (SELECT value FROM json_each(?))' }),
      JSON.stringify(slugs),
    );
    const items = await this.toItems(rows);
    return items.sort((a, b) => slugs.indexOf(a.product.slug) - slugs.indexOf(b.product.slug));
  }

  /**
   * Other eligible products in the same section, those sharing the most categories first
   * (then the normal deterministic order). One query.
   */
  async getRelatedProducts(item: ProductListItem, limit = 4): Promise<ProductListItem[]> {
    const shared = (other: ProductListItem) =>
      other.product.categorySlugs.filter((slug) => item.product.categorySlugs.includes(slug)).length;
    const candidates = (await this.getApprovedProducts({ section: item.product.section })).filter(
      (other) => other.product.slug !== item.product.slug,
    );
    // Array.prototype.sort is stable, so ties keep the query's deterministic order.
    return candidates.sort((a, b) => shared(b) - shared(a)).slice(0, limit);
  }

  /**
   * A public sub-category (e.g. outdoor) of a section, for page titles. Public-safe fields
   * only. Returns undefined for unknown categories or ones outside that section.
   */
  async getCategory(section: ProductSection, slug: string): Promise<ProductCategory | undefined> {
    const category = await this.categories.getBySlug(slug);
    if (!category) return undefined;
    const placement = (await this.categories.getIndex()).resolve(category.id);
    return placement?.section === section
      ? placement.categories.find((candidate) => candidate.slug === slug)
      : undefined;
  }

  /** Eligible products used by a D1 DIY project, in the project's deliberate order. */
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
      // Products whose category is not in a supported public section are dropped here.
      const item = mapPublicProduct(row, index);
      return item ? [item] : [];
    });
  }
}
