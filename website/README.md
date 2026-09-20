# Halloween Site

A website of curated Halloween products (decorations and costumes) from outside
retailers, plus DIY project guides. **Public product data comes from Cloudflare D1**: a product
appears on the public site only after it is approved in the (local) admin and has an eligible
offer. DIY project content is still static (see *Public catalog*).

## Technology stack

- [Astro](https://astro.build) 5, hybrid: pages are prerendered (static); only routes
  that opt in with `export const prerender = false` run in a Worker
- `@astrojs/cloudflare` **v12** (the adapter line for Astro 5; v13+ need Astro 6+)
- TypeScript (strict), HTML, plain CSS
- Database: **Cloudflare D1** (direct SQL, no ORM)
- Deployment: **Cloudflare** Worker + static assets, configured in `wrangler.jsonc`

No PHP, ORM, scraping, or affiliate integration exists. There is **no production authentication**:
the review admin (see *Admin*) is local-development only and is disabled in every production build.

## Getting started

Requires Node.js 20.3 or newer (`.nvmrc` pins 22).

```sh
npm install        # install dependencies
npm run dev        # start the dev server at http://localhost:4321
npm run build      # build into dist/ (prerendered pages + Worker in dist/_worker.js)
npm run preview    # serve the BUILT site locally with wrangler dev (local D1 only)
npm run check      # type-check .astro and .ts files (including tests)
npm test           # run the focused business-rule tests (see Tests)
```

The public pages work with just these commands. The database commands below are only
needed for backend work.

## Deployment

Cloudflare is the intended deployment platform. Nothing has been deployed yet.

**Before the first deploy:** the D1 database `halloween-site-db` exists and its `database_id` is
in `wrangler.jsonc`. Migrations are never applied to it automatically; do that deliberately (see
*Applying migrations to production* below). The admin is disabled in production builds, so a
deployed site has no way to review products yet.

Then either:

- `npm run deploy` (builds, then `wrangler deploy`; requires `wrangler login`), or
- connect the repo in the Cloudflare dashboard (Workers Builds) with build command
  `npm run build` and deploy command `npx wrangler deploy`.

## Routes

**Static** pages are prerendered at build time. **On-demand** pages run in the Worker and read
live data from D1 on every request (see *Public catalog*).

| Route                              | Purpose                     | Rendering                                   |
| ---------------------------------- | --------------------------- | ------------------------------------------- |
| `/`                                | Home (live product shelves) | on-demand                                   |
| `/decorations`                     | Decorations overview        | on-demand (live featured shelf)             |
| `/decorations/outdoor`             | Outdoor decorations         | on-demand                                   |
| `/decorations/indoor`              | Indoor decorations          | on-demand                                   |
| `/decorations/products`            | All decoration products     | on-demand                                   |
| `/decorations/products/<slug>`     | Decoration product detail   | on-demand                                   |
| `/costumes`                        | Costumes overview           | on-demand (live featured shelf)             |
| `/costumes/products`               | All costume products        | on-demand                                   |
| `/costumes/products/<slug>`        | Costume product detail      | on-demand                                   |
| `/diy-projects`                    | DIY projects list           | static (static content, no products)        |
| `/diy-projects/<slug>`             | DIY project detail          | on-demand (live related products)           |
| `/about`, `/404`, `/500`           | About and error pages       | static                                      |
| `/api/health`                      | Health check                | on-demand                                   |

A local-only review admin lives under `/admin` (see *Admin* below). It is never linked from the
public site and is disabled in production builds.

## Cute / Scary theme

The header toggle switches the site's *decorative atmosphere* only. It never filters
or changes products, categories, or content.

- **State:** one attribute on `<html>`: `data-halloween-theme="cute" | "scary"`
  (default `cute`, set in the server-rendered HTML).
- **Styling:** `src/styles/tokens.css` holds content tokens (identical in both themes, so
  content stays readable). `src/styles/theme.css` overrides atmosphere tokens
  (`--band-*`, `--deco-*`, `--page-bg`) per theme.
- **Persistence:** the choice is saved in `localStorage` (key `halloween-theme`). A tiny
  inline script in `BaseLayout` applies it before first paint (no flash). If storage is
  blocked, the choice still works for the current page. No account needed.
- **JavaScript:** the toggle script (`ThemeToggle.astro`) and the mobile menu script
  (`SiteHeader.astro`) are the only client JS. The toggle is hidden when JS is off.

## Decorations

Decorative characters live in `src/components/decor/` as small inline SVG placeholders.
Each component renders a Cute and a Scary variant, and CSS shows the active one
(`.only-cute` / `.only-scary`), so there is never a second copy of a page.

- `Decor.astro` positions a piece (corner, size, offset, hide-on-mobile, motion).
- `HeadingDecor.astro` chooses the piece for each page heading.
- Decor is `aria-hidden`, sits behind content, ignores the pointer, is absolutely
  positioned (no layout shift), is mostly hidden below 48rem, and animates only when the
  user has not requested reduced motion.
- Real artwork goes in `src/assets/decorations/{shared,cute,scary}/` (see its README).

## Public catalog

Public product pages read **live from Cloudflare D1**. `npm run dev` uses the local D1
simulation (never the remote database), so approving a product in the local admin shows it on
the public pages on the next refresh, with no rebuild or restart.

```
public Astro page -> getPublicCatalog() (src/data-access) -> public repositories -> D1
                  -> public domain model (src/types) -> UI component
```

**Who is public.** A product is publicly visible only when *all* of these hold (defined once,
in `src/server/repositories/public-product-query.ts`; lists, direct slug access, related
products and DIY all use it):

1. `review_status = approved`.
2. It has an **eligible offer**: the offer's retailer is active, the offer is not
   `discontinued`, and its URL is `http(s)`. The **primary** eligible offer is used; if there is
   none, the **cheapest** eligible offer (unknown price last). No eligible offer, not public.
3. Its category resolves to a supported section (decorations or costumes).

**Hidden products are invisible.** A pending, rejected, ineligible, wrong-section or unknown
slug all return the site's ordinary 404 page, byte-for-byte identical, so nothing reveals
that a hidden product exists. Internal review notes and status are not selected by public
queries and have no place in the public model (`Product` has no id, status, or notes).

**Failures are loud, never silent.** If D1 is missing or a query fails, the page returns a
generic 500 (`src/pages/500.astro`); the real error is logged on the server only. There is no
fallback to sample products.

**Static vs. dynamic.** Only routes that show live catalog data are on-demand (table above).
Pages without it stay prerendered. Responses from live pages are `Cache-Control: no-store`.

**What is still static.** DIY project *content* lives in `src/data/diy-projects.ts` (a D1 schema
for DIY exists and is seeded, but the site does not read it yet). A DIY page's related products
are referenced by slug and looked up live through the same public catalog, so a hidden product
cannot leak through a DIY page.

## Backend / Database

The site curates **products**. **Retailers** provide **offers** (listings, prices, links)
for those products; a product and a retailer listing are different things. Data lives in
**Cloudflare D1**, used directly through its typed binding: plain SQL plus small
repository classes. No ORM, no other database.

- **Binding name:** `DB` (`env.DB` in server code). Database name: `halloween-site-db`.
- **Schema:** `migrations/0001_initial_schema.sql`. Tables: `categories`, `products`,
  `retailers`, `product_offers`, `diy_projects`, `diy_project_products`. IDs are
  app-generated UUID text; URLs use slugs; money is integer cents; timestamps are ISO 8601 UTC.
- **Migrations are the authoritative schema history.** They are committed. Never edit a
  migration that has been applied anywhere; add a new numbered file.
- **The public site reads product data from D1** through `src/data-access/` (see *Public
  catalog*). There is no static product data and no fallback to sample products.
- **Write endpoints exist only for the local-only admin** (`/api/admin/*`, see *Admin*), and every
  one refuses to run outside a local dev server. There is no public write endpoint. The only
  public route is `GET /api/health` ("ok"/"error" for the Worker and a trivial DB query, nothing else).

### Repository architecture

```
src/server/                 Server-only code. Public pages/components must never import it.
  db/database.ts            Wrapper over a D1Database: bound (prepared) statements only
  db/rows.ts                Raw row shapes (snake_case), kept inside src/server/
  db/runtime.ts             Gets the DB from Astro's locals (locals.runtime.env.DB)
  domain/                   Internal models (AdminProduct incl. review notes, offers, ...)
  repositories/
    public-products.ts      PUBLIC reads: approved products only, no review notes
    diy-projects.ts         PUBLIC reads: published projects, their approved products
    products.ts             ADMIN: pending queue, create (always pending), update, review status
    admin-review.ts         ADMIN read models: status counts, queues, a product's review detail
    retailers.ts, offers.ts ADMIN: create/update retailers and offers
    categories.ts           Category tree
    mappers.ts              Rows -> domain objects (the only row<->domain translation)
  admin/                    Local-only admin logic: access guard, validation, HTTP helpers, messages
```

Public reads return the existing public types (`Product`, `ProductListItem`, `DIYProject`
in `src/types/`). Their SQL (`public-product-query.ts`) never selects `review_notes`, and
only returns approved products that have an offer from an active retailer. Internal
review notes cannot reach a public object.

### Local development (LOCAL D1 only)

Local development uses Wrangler's **local D1 simulation** (SQLite files in
`.wrangler/state/`, git-ignored). It never connects to the remote database.

Wrangler's D1 commands need a `database_id` in `wrangler.jsonc` even for local use; it is
already set. The `--local` scripts below only read and write the local files.

```sh
npm install
npm run cf:types           # regenerate worker-configuration.d.ts (only after editing wrangler.jsonc;
                           # delete dist/ first so the committed file doesn't reference build output)
npm run db:migrate:local   # apply migrations to the LOCAL database
npm run db:seed:local      # load placeholder test data into the LOCAL database
npm run dev                # http://localhost:4321  ->  /api/health
npm run db:query:local -- "SELECT slug, review_status FROM products"
npm run db:migrations:list:local
```

The seed (`seeds/local-dev.sql`) is placeholder data: approved, pending and rejected
products, two retailers, several offers, a published and a draft project, and ordered
project-product links. It is re-runnable. There is deliberately **no remote seed script**.

To reset the local database, delete the local state (this only removes local files):
`rm -rf .wrangler/state`, then migrate and seed again.

### Creating the remote D1 database (already done; for reference)

The remote database has been created and its id is in `wrangler.jsonc`. To create another
(for example a staging copy), never invent an id:

```sh
npx wrangler login
npx wrangler d1 create halloween-site-db
```

Copy the `database_id` it prints into `wrangler.jsonc` under `d1_databases[0]`, keeping
`"binding": "DB"` and `"database_name": "halloween-site-db"`. If Wrangler offers to add the
binding for you, make sure the binding name is `DB`. This creates an **empty** database;
nothing is written to it.

### Applying migrations to production

> ⚠️ **REMOTE / PRODUCTION.** These commands change your real Cloudflare database.
> They are never run by `dev`, `build`, or any local script.

```sh
npm run db:migrations:list:remote   # read-only: shows which migrations are pending
npm run db:migrate:remote           # ⚠️ applies pending migrations to the REMOTE database
```

Wrangler asks you to confirm before applying. Consider a backup first:
`npx wrangler d1 export halloween-site-db --remote --output=backup.sql` (read-only).
Migrations do not add reference data such as categories; that is a separate, deliberate
step for later. Seed data is local-only.

## Admin (local development only)

A product review interface: see products awaiting review, inspect public vs. internal
information and retailer offers, approve / reject / return to pending, keep internal
review notes, and make basic edits (name, summary, description, category, quality notes,
badges, details).

> ⚠️ **This is NOT production authentication.** Nothing identifies who is using it. It
> works only on a local development server and is **disabled in every production build**.
> **Cloudflare Access will be configured once the site has its production hostname**;
> until then the admin must not (and cannot) be used on a deployed site.

### Run it locally

```sh
npm run db:migrate:local   # once (needs the D1 database created; see Backend / Database)
npm run db:seed:local      # placeholder data: one pending, two approved, one rejected product
npm run dev
```

Open <http://localhost:4321/admin>. It must be reached as `localhost` (or `[::1]`); any
other hostname is refused, so `astro dev --host` does not expose it. Re-run
`npm run db:seed:local` at any time to restore the sample data after experimenting.

| Route                                                  | Purpose                                     |
| ------------------------------------------------------ | ------------------------------------------- |
| `/admin`                                               | Dashboard: counts and the next pending items |
| `/admin/products`                                      | All products (pending first)                |
| `/admin/products/pending` `/approved` `/rejected`      | Review queues                               |
| `/admin/products/<id-or-slug>`                         | Review page (public vs. internal info)      |
| `POST /api/admin/products/<id>/review`                 | Change status and/or save internal notes    |
| `POST /api/admin/products/<id>/update`                 | Save edited product information             |

Approving a product makes it appear on the public site **immediately** (no build or restart),
provided it has an eligible offer; returning it to pending or rejecting it removes it
immediately. Offers are shown read-only. Affiliate links are not implemented.

### How the temporary production lockout works

The secure default is **production admin access = disabled**, and there is no setting that
changes it.

- `src/server/admin/access.ts` is the single place that decides. It depends on
  `import.meta.env.DEV`, which the build replaces with the constant `false` in every
  production build. In the deployed Worker the check is literally `return false`; no
  environment variable, binding, or header can turn it on.
- In a dev server it additionally requires a loopback hostname (`localhost`, `[::1]`).
- **Enforced on the server, in three layers, all calling that one function:**
  `src/middleware.ts` (every path under `/admin` and `/api/admin`, so a new admin route is
  protected automatically), each admin page, and each write endpoint. Refused requests get a
  bare `404`.
- **Build-time safety net:** `astro.config.mjs` fails the build if any admin page is
  prerendered, because a static admin page would be public and skip request-time checks.
  Every admin route must set `export const prerender = false`.
- **CSRF:** state-changing requests must carry a same-origin `Origin` header, or get `403`.
  Astro's built-in origin check does not run in the dev server, so the guard enforces it.
- Not linked from the public navigation.

When the production hostname exists, put Cloudflare Access in front of `/admin*` and
`/api/admin*`, verify the Access identity in the server (do not rely only on the edge), and
then decide deliberately whether to keep or replace this guard. See `src/admin/README.md`.

## Tests

```sh
npm test              # run once, non-interactive
npm run test:watch    # re-run on change while developing
```

A small [Vitest](https://vitest.dev) suite (10 tests) that protects the **product visibility and
review rules**, the rules that keep unreviewed or unsafe products off the public site. It runs the
real repositories, with nothing mocked.

**Covered:** pending and rejected products are hidden; an approved product with an eligible offer is
public; an inactive retailer, a discontinued-only offer, or an unsafe (non-http/https) purchase URL
keeps a product hidden; review notes and admin fields never appear in public output; pending → approved
makes a product public immediately, and approved → rejected/pending hides it; the primary eligible
offer wins, else the cheapest eligible one. Each "hidden" case includes an eligible control product, so
a broken fixture cannot pass by accident.

**How it works:** each test file builds its own **in-memory D1** (Miniflare, the same engine as local D1)
from the real `migrations/*.sql`, so a schema change that breaks the repositories fails the tests. It
never touches `.wrangler/state` (your local dev database), never reads `wrangler.jsonc`, and cannot
reach the remote database.

**Intentionally not covered:** UI, rendered HTML, components, CSS, themes, navigation, accessibility,
responsive layout, admin screens and forms, browser interaction, Cloudflare Access, deployment, and
generic framework or SQL-constraint behavior. Check those manually.

## Folder structure

```
migrations/             D1 migrations (committed; the schema history)
tests/                  Focused business-rule tests (Vitest) and their helpers
seeds/                  LOCAL-only placeholder seed data
public/                 Static files served as-is (favicon, .assetsignore)
worker-configuration.d.ts   Generated Cloudflare binding types (committed)
src/
  admin/                Local-only admin UI: layout, components, styles (see Admin)
  assets/images/        Images processed by the build
  assets/decorations/   Future decorative artwork: shared/, cute/, scary/
  components/
    layout/             Header, footer, logo, theme toggle, sections, page header, sub-nav
    ui/                 Shared primitives (Button, Badge, EmptyState, LinkTile, ...)
    decor/              Decorative SVG pieces and the Decor placement wrapper
    home/               Homepage sections (Hero, Philosophy)
    products/           ProductCard, ProductGrid, ProductShelf, ProductDetail
    categories/         CategoryPage (template for product listing pages)
    diy/                DIY project card, grid, and detail
  config/               Site name and navigation
  data/                 STATIC DIY project content only (products are in D1, not here)
  data-access/          The public boundary: getPublicCatalog() (D1) + static DIY reads
  layouts/              BaseLayout (document shell)
  pages/                Routes (file-based)
  server/               Database layer and repositories (see Backend / Database)
  styles/               tokens.css, theme.css (Cute/Scary), decor.css, global.css
  types/                TypeScript models (Product, Retailer, DIYProject, ...)
  utils/                Small helpers (route builders, formatting)
```

## Key conventions

- Pages and components read data only through `src/data-access/`; they never import from
  `src/data/` or `src/server/`.
- D1 is the source of truth for public products. Public reads return only publicly eligible
  products (below), never pending or rejected ones.
- Product review status is `pending`, `approved`, or `rejected`.

See `AGENTS.md` for guidance for coding agents.
