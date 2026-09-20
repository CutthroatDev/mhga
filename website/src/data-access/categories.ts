import { categories } from '@/data/categories';
import type { ProductCategory, ProductSection } from '@/types';

export async function getCategories(section?: ProductSection): Promise<ProductCategory[]> {
  return section ? categories.filter((category) => category.section === section) : categories;
}

export async function getCategoryBySlug(
  section: ProductSection,
  slug: string,
): Promise<ProductCategory | undefined> {
  return categories.find((category) => category.section === section && category.slug === slug);
}
