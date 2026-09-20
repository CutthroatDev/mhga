import type { Retailer } from './retailer';

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

/** A labelled fact shown in the "Details" list on a product page, e.g. Size / 6 ft. */
export interface ProductDetailItem {
  label: string;
  value: string;
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
  /** Short optional labels shown on cards, e.g. "Editor's pick". Not a rating. */
  badges?: string[];
  /** Short notes on why this product made the cut. */
  qualityNotes?: string[];
  /** Additional facts (size, material, ...). */
  details?: ProductDetailItem[];
}

/** A product together with the related records a card or detail page needs to render. */
export interface ProductListItem {
  product: Product;
  retailer?: Retailer;
  categories: ProductCategory[];
}
