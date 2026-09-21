/**
 * The URL-import connector: a `ProductIngestionSource` for product pages a reviewer submitted.
 *
 * Like every connector it only reduces raw items to candidates. It does not touch the database,
 * decide review status, create categories, or mark anything discontinued because it was missing.
 * The engine does the rest (validation, strong identity, pending products, offer refresh).
 *
 * How it differs from a feed connector:
 *  - The raw items are ALREADY FETCHED pages (`ExtractedProduct`). The engine needs a retailer up
 *    front, and for a page the retailer is only known from its final address (after redirects), so
 *    the importer fetches and extracts first, groups pages by retailer, and creates one source per
 *    retailer. A page that could not be fetched never reaches the engine, so a failed fetch changes
 *    nothing about any listing.
 *  - The CATEGORY is chosen by the reviewer for the whole import. A page rarely states a category
 *    we can map without guessing, so none is inferred. The engine only uses it for a NEW product;
 *    for a listing it already knows, category is reviewer-owned and is never touched.
 */
import type { CandidateInput } from '../candidate';
import type { IngestibleCategorySlug } from '../category-mapping';
import type { ProductIngestionSource, RetailerDescriptor } from '../source';
import type { ExtractedProduct } from '../url-import/extract-product';

/** Recorded on ingestion runs and offers (`source_id`). */
export const URL_IMPORT_SOURCE_ID = 'url-import';

export interface UrlImportSourceOptions {
  retailer: RetailerDescriptor;
  category: IngestibleCategorySlug;
  products: readonly ExtractedProduct[];
}

export function createUrlImportSource(options: UrlImportSourceOptions): ProductIngestionSource<ExtractedProduct> {
  return {
    id: URL_IMPORT_SOURCE_ID,
    retailer: options.retailer,
    fetchItems: async () => options.products,
    toCandidate: (product): CandidateInput => ({
      externalId: product.externalId,
      name: product.name,
      url: product.url,
      category: options.category,
      description: product.description,
      imageUrl: product.imageUrl,
      priceCents: product.priceCents,
      currency: product.currency,
      availability: product.availability,
      // Only ever true when the page explicitly says discontinued (see extract-product.ts).
      discontinued: product.discontinued,
    }),
  };
}
