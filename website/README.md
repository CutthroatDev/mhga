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

No PHP, ORM, or affiliate integration exists, and there are **no real retailer connectors yet** (the
ingestion *engine* exists and is proven with a fictional fixture source; see *Product ingestion*). There is
**no production authentication**: the review admin (see *Admin*) is local-development only and is disabled
in every production build.

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
   `discontinued`, its URL is `http(s)`, and it is **not expired** (see *Offer freshness*). The
   **primary** eligible offer is used; if there is none, the **cheapest** eligible offer (unknown
   price last). No eligible offer, not public.
3. Its category resolves to a supported section (decorations or costumes).

**Offer freshness.** Old retailer/price information is not trusted forever. Freshness is *derived*
from `product_offers.last_checked_at` (never stored in a column) by one policy,
`src/server/domain/offer-freshness.ts`, in UTC whole seconds:

| Age of `last_checked_at`         | State   | Public use                        |
| -------------------------------- | ------- | --------------------------------- |
| 0 to 7 days (7 days included)    | fresh   | eligible                          |
| over 7 to 30 days (30 included)  | stale   | still eligible; due for a refresh |
| over 30 days                     | expired | **not eligible**                  |
| missing (`NULL`) or unparseable  | expired | **not eligible**                  |

A missing timestamp is ineligible on purpose: once ingestion exists, an offer with no record of when it
was verified cannot be trusted. Only canonical UTC timestamps (`YYYY-MM-DDTHH:MM:SSZ`) count. An expired
primary offer falls back to the next eligible offer, and a product with no eligible offer is hidden.
Freshness decides *eligibility* only; the choice among eligible offers (primary, else cheapest) is
unchanged. Nothing about freshness is shown publicly. The public SQL contains no day counts: it receives a
cutoff computed by the policy, so the thresholds live in exactly one place.

**Image URLs are validated too.** A product's image is public only if it is an `http(s)` URL; anything else
(`javascript:`, `data:`, malformed, blank) is dropped from the public product and the placeholder image
renders. An invalid image never hides an otherwise eligible product.

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
  `migrations/0003_ingestion.sql` adds `ingestion_runs` and two provenance columns on `product_offers`
  (see *Product ingestion*).
- **Required categories are created by migrations**, not by the seed. `migrations/0002_bootstrap_categories.sql`
  inserts the structural hierarchy the public catalog depends on: **Decorations** (`decorations`) with
  **Outdoor Decorations** (`outdoor`) and **Indoor Decorations** (`indoor`) beneath it, and **Costumes**
  (`costumes`). It uses fixed IDs and `ON CONFLICT (id) DO NOTHING`, so it is safe on a database that
  already has the rows and never overwrites them. A fresh database (including production) gets the tree
  from `npm run db:migrate:*` alone.
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
    ingestion.ts            INGESTION writes: pending product + offer (atomic), offer refresh, run tracking
    categories.ts           Category tree
    mappers.ts              Rows -> domain objects (the only row<->domain translation)
  admin/                    Local-only admin logic: access guard, validation, HTTP helpers, messages
  ingestion/                Product ingestion engine, connector interface, fixture connector (see below)
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
npm run ingest:local -- --source fixture   # run the fixture ingestion against the LOCAL database
```

The seed (`seeds/local-dev.sql`) is placeholder **sample** data only: approved, pending and rejected
products, two retailers, several offers, a published and a draft project, and ordered
project-product links. It does **not** create categories: it looks them up by slug, so run
`npm run db:migrate:local` first. It is re-runnable. Its offers are timestamped **relative to the moment you
run it** (1 to 15 days old), so they are fresh or stale-but-usable under the freshness policy; if the
seeded catalog ever disappears after 30+ days, re-run `npm run db:seed:local`. There is deliberately **no
remote seed script**.

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
Migration `0002` adds the required categories (structural reference data), so applying migrations
to a fresh production database is enough for them to exist. Sample data (products, retailers, offers)
is never part of a migration: the seed is local-only.

## Product ingestion

The **ingestion engine** turns structured retailer listings into *pending* products and keeps their offers
fresh. It is an internal, local-only tool: nothing exposes it over HTTP, and **no real retailer connector
exists yet**. The only source is a fictional **fixture** that proves the engine end to end.

```
connector (per retailer)            engine (retailer-agnostic)
fetchItems()  -> raw items
toCandidate() -> CandidateInput  -> validate -> identity -> D1 write
                                                (new) pending product + offer, atomically
                                                (known) refresh the OFFER only
```

Human review in `/admin` stays the only gate: **pending -> approve -> public**.

### Architecture (`src/server/ingestion/`, `src/server/repositories/ingestion.ts`)

| File                      | Role                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `source.ts`               | `ProductIngestionSource`: the connector contract (`id`, `retailer`, `fetchItems`, `toCandidate`) |
| `candidate.ts`            | `CandidateInput` (untrusted, from a connector) -> `validateCandidate` -> `IngestionCandidate` |
| `engine.ts`               | `runIngestion(d1, source)`: dedupe, identity, create/refresh, run tracking, result         |
| `category-mapping.ts`     | Supported categories (`outdoor`, `indoor`, `costumes`) and an exact-match mapper factory   |
| `url.ts`, `price.ts`      | Conservative retailer-URL normalization; text/dollars -> integer cents                     |
| `sources/fixture.ts`      | The controlled fixture connector (fictional feed, two snapshots)                            |
| `local-cli.ts`            | Logic behind `npm run ingest:local`                                                        |
| `repositories/ingestion.ts` | All ingestion SQL. New products are `pending` via a SQL literal; refresh never writes `products` |

**Connector model.** A connector owns *acquisition and normalization only*: fetch raw items (API, feed,
JSON, HTML, CSV), and reduce each to a `CandidateInput` (prices to integer cents, the retailer's category to
one of the supported slugs, stock wording to `in_stock | out_of_stock | unknown`, `discontinued: true` only
when the source itself says so). It never writes to the database, decides review status, or invents
categories. A new retailer is a new file implementing `ProductIngestionSource`; the engine is not edited.
Everything a connector returns is treated as untrusted and re-validated by the engine.

**The candidate.** Required: `name`, `url` (http(s) only, normalized). Optional: `externalId`, `category`,
`externalCategory`, `description`, `imageUrl`, `priceCents` (+ `currency`, required with a price),
`availability`, `discontinued`, `observedAt`. An unsafe URL invalidates the candidate; an unsafe image URL
is just dropped (the product is still created). A future `observedAt` is clamped to now.

### Run it locally (fixture)

```sh
npm run db:migrate:local                             # once; applies 0003
npm run db:seed:local                                # optional sample data
npm run ingest:local -- --source fixture             # first feed: 3 pending products, 3 skipped
npm run ingest:local -- --source fixture             # again: nothing created, offers re-verified
npm run ingest:local -- --source fixture --snapshot updated   # price/title/availability changes, a new listing
npm run dev                                          # new products appear in /admin/products/pending
```

`ingest:local` runs against the **local D1 only** (`.wrangler/state`, the same database `npm run dev` uses).
The launcher opens it through Wrangler's local proxy with remote bindings off, and any unrecognised argument
(including `--remote`) is refused. There is deliberately **no** `npm run ingest`, no remote variant, no
HTTP endpoint, and no scheduled job. Those need production authentication and deployment decisions first.
The fixture creates a `fixture-retailer` retailer and a few clearly fictional products in your local database.

### Rules

- **New products always start `pending`.** There is no auto-approve option of any kind.
- **Existing products keep their review status.** Re-ingesting never resets, approves, or rejects.
- **Identity is strong, never fuzzy.** A listing is *retailer + external listing id*, else *retailer + exact
  normalized URL*. Titles are never compared and products are never merged across retailers: a duplicate
  pending product is cheap to merge later, a false merge is not. An id/URL disagreement is reported as a
  `conflict` and nothing is changed. The database enforces the same identity (`UNIQUE (retailer_id,
  retailer_product_id)` and `UNIQUE (retailer_id, product_url)`), so a repeat can never insert a duplicate.
- **Idempotent.** The same feed again creates nothing; it only refreshes `last_checked_at`. A feed that
  repeats a listing is deduplicated (first occurrence wins) and reported.
- **A missing listing is not a discontinued listing.** Unseen offers are never touched (an outage or parser
  bug must not delist products); the freshness policy ages them out. Only an explicit `discontinued: true`
  from the source marks one. A source that cannot be read fails the run and changes nothing.
- **Atomic.** A new product and its offer are written in one D1 batch (one transaction), never one without the other.
- **A bad candidate never aborts the run.** It is skipped and reported (`invalid`, `unmapped`, `duplicate`,
  `conflict`, or `failed`), and the run finishes `partial`.
- **Categories are never created by ingestion.** A new listing whose category cannot be mapped to an existing
  supported category creates nothing and is reported as `unmapped`. (A *known* listing still refreshes: category
  is curator-owned.)

### What ingestion may and may not change

| Source-owned: refreshed on every observation (offer only) | Curator-owned: never overwritten on an existing product |
| --------------------------------------------------------- | -------------------------------------------------------- |
| price (integer cents), currency, availability, discontinued | `review_status`, `reviewed_at`, internal `review_notes`  |
| retailer listing URL (when it safely changes), listing id (only filled in, never replaced) | name, summary, description, category, slug |
| `last_checked_at` (the observation time, canonical UTC)   | badges, details, quality notes, image and alt text       |
| the retailer's own title (`source_title`) and `source_id`, internal | `is_primary`, `affiliate_url`                     |

Source data only *seeds* a **new** pending product (name and image from the listing, a short summary from its
description or its title, category from the mapping); the reviewer is expected to rewrite it. A retailer
renaming a listing updates only the offer's `source_title`, which the admin shows read-only next to the curated name.

### Tracking and schema (migration `0003_ingestion.sql`)

- `ingestion_runs`: one row per run: source, start/finish, status (`running | succeeded | partial | failed`),
  counts (discovered, products created, offers created/updated/unchanged, skipped, failed), and a bounded JSON
  list of the first problems (engine-written text only: never raw SQL errors or retailer payloads).
- `product_offers.source_id` and `.source_title`: provenance. Internal: no public query selects them.
- Nothing else is stored: no raw payloads, HTML, or per-candidate history.

### Adding a real retailer connector (later)

Implement `ProductIngestionSource` in `src/server/ingestion/sources/`, register it in `local-cli.ts`, and add
its category table with `createCategoryMapper`. Do not edit `engine.ts` or `repositories/ingestion.ts`. See
*Not built yet* below for what must exist before the first one.

**Not built yet:** real retailer connectors; a remote/production run path, scheduling (Cron Triggers), and the
authentication they need; prioritising *stale* offers for refresh before they expire (`classifyOfferFreshness`
already labels them); manual merge/reconciliation of duplicate products; a review-queue view of skipped candidates.

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
immediately. Offers are shown read-only (an offer created by ingestion also shows its source and the retailer's own
title, kept separate from the curated name). Affiliate links are not implemented.

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

A small [Vitest](https://vitest.dev) suite (50 tests) that protects the **product visibility and
review rules** (the rules that keep unreviewed or unsafe products off the public site) and the
**ingestion engine's business rules**. It runs the real repositories and engine, with nothing mocked.

**Covered:** pending and rejected products are hidden; an approved product with an eligible offer is
public; an inactive retailer, a discontinued-only offer, or an unsafe (non-http/https) purchase URL
keeps a product hidden; the offer freshness policy (fresh, stale-but-usable, expired, missing timestamp,
fallback from an expired primary, and the exact 7 and 30 day boundaries on a fixed clock); review notes and admin fields never appear in public output; pending → approved
makes a product public immediately, and approved → rejected/pending hides it; the primary eligible
offer wins, else the cheapest eligible one; and the required category hierarchy exists on a freshly
migrated database (no seed) with products resolving through it; and only a safe `http(s)` image URL reaches
a public product, while an invalid one is dropped without hiding the product. Each "hidden" case includes an eligible control product, so
a broken fixture cannot pass by accident.

**Ingestion coverage:** new listings become one pending product and one offer (not public until approved); repeat
runs create no duplicates; identity by listing id, then exact URL, with no cross-retailer or title merging; price
changes and `last_checked_at` refresh (never backwards); review status and every reviewer-owned field survive
re-ingestion (approved stays public, rejected stays hidden); invalid, unsafe, unmapped and repeated candidates are
skipped without stopping the run; a missing listing or an unreadable source never marks anything discontinued;
product + offer creation is atomic; run tracking; and the fixture connector end to end (ingest, approve, refresh,
curated data preserved).

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
scripts/                LOCAL tooling launchers (ingest-local.mjs)
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
