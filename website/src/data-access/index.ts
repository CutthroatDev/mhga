// PUBLIC data-access boundary. Public pages import from here, never from src/server/ directly.
//
//  - Products (and their categories/retailers/offers): LIVE from Cloudflare D1, through the
//    public-only catalog. There is no static product data anymore.
//  - DIY project CONTENT: still static (src/data/diy-projects.ts). Only the products related
//    to a project are looked up live, through the same public catalog, so a hidden product
//    can never appear via a DIY page.
export { getPublicCatalog, PublicCatalogUnavailableError } from './public-catalog';
export type { PublicCatalog, PublicCatalogContext } from './public-catalog';
export {
  getPublishedDIYProjectBySlug,
  getPublishedDIYProjects,
  getRelatedDIYProjects,
} from './diy-projects';
