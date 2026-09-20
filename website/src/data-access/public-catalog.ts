/**
 * The PUBLIC product catalog, backed by Cloudflare D1. This is the only way public pages
 * read product data:
 *
 *   public Astro page -> getPublicCatalog() -> public repositories -> D1
 *                        -> public domain model (src/types) -> UI component
 *
 * Rules this module enforces:
 *  - Public-only. It is built from `createPublicRepositories`, which contains no admin
 *    repository, so review notes and pending/rejected products are unreachable from here.
 *  - No sample-data fallback. If D1 is missing or a query fails, the request fails with a
 *    generic error (Astro renders src/pages/500.astro). A broken database must never
 *    silently turn into placeholder products.
 *  - Errors are logged on the server only. The thrown error has a fixed message and no
 *    cause, so SQL, ids, and internals cannot reach a visitor.
 *  - Responses that depend on live data are marked uncacheable, so an approval or removal
 *    is visible on the next request.
 */
import type { ProductCategory, ProductListItem, ProductSection } from '@/types';
import { getD1 } from '../server/db/runtime';
import { createPublicRepositories } from '../server/repositories';
import type { PublicProductQuery } from '../server/repositories';

/** The Astro context pieces the catalog needs (`Astro` in a page satisfies this). */
export interface PublicCatalogContext {
  locals: Parameters<typeof getD1>[0];
  response?: { headers: Headers };
}

export interface PublicCatalog {
  /** Publicly eligible products, newest first, optionally by section / category / limit. */
  getProducts(query?: PublicProductQuery): Promise<ProductListItem[]>;
  /**
   * One eligible product in the given section, or undefined. Pending, rejected, ineligible,
   * wrong-section and unknown slugs are indistinguishable (all undefined).
   */
  getProductBySlug(section: ProductSection, slug: string): Promise<ProductListItem | undefined>;
  /** Eligible products for these slugs, in the order given. Others are skipped. */
  getProductsBySlugs(slugs: string[]): Promise<ProductListItem[]>;
  /** Other eligible products in the same section as `item`. */
  getRelatedProducts(item: ProductListItem, limit?: number): Promise<ProductListItem[]>;
  /** A sub-category (e.g. outdoor) for page titles. */
  getCategory(section: ProductSection, slug: string): Promise<ProductCategory | undefined>;
}

/** Thrown when the public catalog cannot be read. The message is safe to show. */
export class PublicCatalogUnavailableError extends Error {
  constructor() {
    super('The product catalog is temporarily unavailable.');
    this.name = 'PublicCatalogUnavailableError';
  }
}

/** Logs the real failure on the server and replaces it with the generic error. */
async function guarded<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`[public-catalog] ${operation} failed:`, error instanceof Error ? error.message : 'unknown error');
    throw new PublicCatalogUnavailableError();
  }
}

export function getPublicCatalog(context: PublicCatalogContext): PublicCatalog {
  // Live data: never cache (also keeps hidden products from lingering in a cache).
  context.response?.headers.set('Cache-Control', 'no-store');

  const d1 = getD1(context.locals);
  if (!d1) {
    console.error('[public-catalog] the D1 binding "DB" is not available');
    throw new PublicCatalogUnavailableError();
  }
  const { products } = createPublicRepositories(d1);

  return {
    getProducts: (query) => guarded('getProducts', () => products.getApprovedProducts(query)),

    getProductBySlug: (section, slug) =>
      guarded('getProductBySlug', async () => {
        const item = await products.getApprovedProductBySlug(slug);
        // A product only exists under its own section (/decorations/... vs /costumes/...).
        return item?.product.section === section ? item : undefined;
      }),

    getProductsBySlugs: (slugs) => guarded('getProductsBySlugs', () => products.getApprovedProductsBySlugs(slugs)),

    getRelatedProducts: (item, limit) => guarded('getRelatedProducts', () => products.getRelatedProducts(item, limit)),

    getCategory: (section, slug) => guarded('getCategory', () => products.getCategory(section, slug)),
  };
}
