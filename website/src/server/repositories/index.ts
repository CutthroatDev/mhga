import type { D1Database } from '@cloudflare/workers-types';
import { Database } from '../db/database';
import { AdminReviewRepository } from './admin-review';
import { CategoryRepository } from './categories';
import { DIYProjectRepository } from './diy-projects';
import { OfferRepository } from './offers';
import { AdminProductRepository } from './products';
import { PublicProductRepository } from './public-products';
import { RetailerRepository } from './retailers';

export { AdminReviewRepository } from './admin-review';
export { CategoryRepository } from './categories';
export { DIYProjectRepository } from './diy-projects';
export { OfferRepository } from './offers';
export { AdminProductRepository, isReviewStatus } from './products';
export { PublicProductRepository } from './public-products';
export type { PublicProductQuery } from './public-products';
export { RetailerRepository } from './retailers';

/**
 * Builds every repository from a D1 binding. Call once per request (they are cheap and
 * hold no state beyond the binding).
 *
 * "public*" repositories return approved/published data only. Everything else is for
 * trusted server code and must never feed a public page.
 */
export function createRepositories(d1: D1Database) {
  const db = new Database(d1);
  const categories = new CategoryRepository(db);
  const publicProducts = new PublicProductRepository(db, categories);
  const adminProducts = new AdminProductRepository(db);

  return {
    categories,
    publicProducts,
    publicDIYProjects: new DIYProjectRepository(db, publicProducts),
    adminProducts,
    adminReview: new AdminReviewRepository(db, categories, adminProducts, publicProducts),
    retailers: new RetailerRepository(db),
    offers: new OfferRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
