import type { ProductCategory, ProductSection } from '../../types';
import type { Category } from './catalog';

const SECTIONS: readonly ProductSection[] = ['decorations', 'costumes'];

export function isProductSection(value: string): value is ProductSection {
  return (SECTIONS as readonly string[]).includes(value);
}

/**
 * In-memory view of the (small) category tree. It turns a product's category id into the
 * pieces the public model needs:
 *  - `section`: the slug of the root category (decorations | costumes)
 *  - `categories`: the categories beneath the root, e.g. [outdoor]
 *
 * Doing this in code keeps the hierarchy as data. Nothing about it is hard-coded in SQL.
 */
export class CategoryIndex {
  private readonly byId: Map<string, Category>;

  constructor(categories: Category[]) {
    this.byId = new Map(categories.map((category) => [category.id, category]));
  }

  /** The category and its ancestors, from the category up to the root. */
  chain(categoryId: string): Category[] {
    const path: Category[] = [];
    const seen = new Set<string>();
    let current = this.byId.get(categoryId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.push(current);
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    return path;
  }

  /** Human label for a category including its ancestors, e.g. "Decorations › Outdoor Decorations". */
  pathLabel(categoryId: string): string | undefined {
    const path = this.chain(categoryId);
    if (path.length === 0) return undefined;
    return path
      .map((category) => category.name)
      .reverse()
      .join(' › ');
  }

  /**
   * Section plus sub-categories for a category id, or undefined if the category is unknown
   * or its root is not a section the public site supports yet.
   */
  resolve(categoryId: string): { section: ProductSection; categories: ProductCategory[] } | undefined {
    const path = this.chain(categoryId);
    const root = path[path.length - 1];
    if (!root || !isProductSection(root.slug)) return undefined;
    const section = root.slug;
    return {
      section,
      categories: path
        .slice(0, -1)
        .reverse()
        .map((category) => ({
          slug: category.slug,
          name: category.name,
          section,
          ...(category.description ? { description: category.description } : {}),
        })),
    };
  }
}
