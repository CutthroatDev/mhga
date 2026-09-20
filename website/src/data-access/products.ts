import { products } from '@/data/products';
import type { Product, ProductListItem, ProductSection } from '@/types';
import { getCategories } from './categories';
import { getRetailerById } from './retailers';

export interface ProductQuery {
  section?: ProductSection;
  categorySlug?: string;
  limit?: number;
}

// Public read API for products. It intentionally exposes approved products only:
// there is no public accessor for pending or rejected items. Review/ingestion
// code belongs in src/server/, not here.
// Functions are async so a database or API can replace the static data without
// changing any caller.

function approved(): Product[] {
  return products.filter((product) => product.reviewStatus === 'approved');
}

async function toListItem(product: Product): Promise<ProductListItem> {
  const [retailer, categories] = await Promise.all([
    getRetailerById(product.retailerId),
    getCategories(product.section),
  ]);
  return {
    product,
    retailer,
    categories: categories.filter((category) => product.categorySlugs.includes(category.slug)),
  };
}

export async function getApprovedProducts(query: ProductQuery = {}): Promise<Product[]> {
  const matches = approved().filter(
    (product) =>
      (!query.section || product.section === query.section) &&
      (!query.categorySlug || product.categorySlugs.includes(query.categorySlug)),
  );
  return query.limit === undefined ? matches : matches.slice(0, query.limit);
}

export async function getApprovedProductBySlug(
  section: ProductSection,
  slug: string,
): Promise<Product | undefined> {
  return (await getApprovedProducts({ section })).find((product) => product.slug === slug);
}

/** Approved products with their retailer and categories resolved, ready for cards. */
export async function getApprovedProductListItems(
  query: ProductQuery = {},
): Promise<ProductListItem[]> {
  return Promise.all((await getApprovedProducts(query)).map(toListItem));
}

/** Approved products by id. Unknown or unapproved ids are skipped. */
export async function getApprovedProductListItemsByIds(ids: string[]): Promise<ProductListItem[]> {
  const matches = approved().filter((product) => ids.includes(product.id));
  return Promise.all(matches.map(toListItem));
}

/** Other approved products in the same section, most shared categories first. */
export async function getRelatedProducts(product: Product, limit = 4): Promise<ProductListItem[]> {
  const shared = (other: Product) =>
    other.categorySlugs.filter((slug) => product.categorySlugs.includes(slug)).length;
  const related = approved()
    .filter((other) => other.id !== product.id && other.section === product.section)
    .sort((a, b) => shared(b) - shared(a))
    .slice(0, limit);
  return Promise.all(related.map(toListItem));
}
