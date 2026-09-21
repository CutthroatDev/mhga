import type { D1Database } from '@cloudflare/workers-types';
import { Database } from '../db/database';
import { AdminReviewRepository } from './admin-review';
import { CategoryRepository } from './categories';
import { DIYProjectRepository } from './diy-projects';
import { IngestionRepository, IngestionRunRepository } from './ingestion';
import { OfferRepository } from './offers';
import { AdminProductRepository } from './products';
import { PublicProductRepository } from './public-products';
import { RetailerRepository } from './retailers';

export { AdminReviewRepository } from './admin-review';
export { CategoryRepository } from './categories';
export { DIYProjectRepository } from './diy-projects';
export { IngestionRepository, IngestionRunRepository } from './ingestion';
export { OfferRepository } from './offers';
export { AdminProductRepository, isReviewStatus } from './products';
export { PublicProductRepository } from './public-products';
export type { PublicProductQuery } from './public-products';
export { RetailerRepository } from './retailers';

/** Options shared by the factories. `now` is the clock used for offer freshness (default: real time). */
export interface RepositoryOptions {
  now?: () => Date;
}

/**
 * Public-only repositories, for the public site's data-access layer (src/data-access/).
 * Deliberately excludes every admin/internal repository, so public code has no way to reach
 * review notes, pending or rejected products, or any write operation.
 */
export function createPublicRepositories(d1: D1Database, options: RepositoryOptions = {}) {
  const db = new Database(d1);
  const categories = new CategoryRepository(db);
  return { products: new PublicProductRepository(db, categories, options.now) };
}

export type PublicRepositories = ReturnType<typeof createPublicRepositories>;

/**
 * Builds every repository from a D1 binding. Call once per request (they are cheap and
 * hold no state beyond the binding).
 *
 * "public*" repositories return approved/published data only. Everything else is for
 * trusted server code and must never feed a public page.
 */
export function createRepositories(d1: D1Database, options: RepositoryOptions = {}) {
  const db = new Database(d1);
  const categories = new CategoryRepository(db);
  const publicProducts = new PublicProductRepository(db, categories, options.now);
  const adminProducts = new AdminProductRepository(db);

  return {
    categories,
    publicProducts,
    publicDIYProjects: new DIYProjectRepository(db, publicProducts),
    adminProducts,
    adminReview: new AdminReviewRepository(db, categories, adminProducts, publicProducts, options.now),
    retailers: new RetailerRepository(db),
    offers: new OfferRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

/**
 * What the ingestion engine needs, and nothing else. Deliberately separate from both factories
 * above: the public factory must never reach ingestion writes, and the admin's
 * `createRepositories` has no business writing ingested data either.
 */
export function createIngestionRepositories(d1: D1Database) {
  const db = new Database(d1);
  return {
    categories: new CategoryRepository(db),
    ingestion: new IngestionRepository(db),
    runs: new IngestionRunRepository(db),
  };
}

export type IngestionRepositories = ReturnType<typeof createIngestionRepositories>;
