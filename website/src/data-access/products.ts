import { products } from '@/data/products';
import type { Product, ProductSection } from '@/types';

export interface ProductQuery {
  section?: ProductSection;
  categorySlug?: string;
}

// Public read API for products. It intentionally exposes approved products only:
// there is no public accessor for pending or rejected items. Review/ingestion
// code belongs in src/server/, not here.
// Functions are async so a database or API can replace the static data without
// changing any caller.

export async function getApprovedProducts(query: ProductQuery = {}): Promise<Product[]> {
  return products.filter(
    (product) =>
      product.reviewStatus === 'approved' &&
      (!query.section || product.section === query.section) &&
      (!query.categorySlug || product.categorySlugs.includes(query.categorySlug)),
  );
}

export async function getApprovedProductBySlug(
  section: ProductSection,
  slug: string,
): Promise<Product | undefined> {
  return (await getApprovedProducts({ section })).find((product) => product.slug === slug);
}
