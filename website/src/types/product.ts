/** Top-level product sections. Values double as the first URL segment. */
export type ProductSection = 'decorations' | 'costumes';

/** Only `approved` products may ever be shown publicly. */
export type ProductReviewStatus = 'pending' | 'approved' | 'rejected';

export interface ProductCategory {
  /** Unique within a section; used in URLs and to link products to categories. */
  slug: string;
  name: string;
  section: ProductSection;
  description?: string;
}

export interface ProductPrice {
  amount: number;
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
}

export interface Product {
  id: string;
  /** URL segment: /<section>/products/<slug> */
  slug: string;
  section: ProductSection;
  name: string;
  summary: string;
  description?: string;
  categorySlugs: string[];
  imageUrl?: string;
  imageAlt?: string;
  price?: ProductPrice;
  retailerId: string;
  /** Link to the product on the retailer's site. */
  sourceUrl: string;
  reviewStatus: ProductReviewStatus;
}
