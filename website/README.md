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

No PHP, ORM, or affiliate integration exists, and there are **no retailer-specific connectors yet**. Products
enter the catalog as *pending* through the ingestion engine, either from a fictional fixture or from product
page URLs a reviewer submits in the local admin (see *Product ingestion* and *Importing products from URLs*). There is
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
fresh. It is an internal, local-only tool. It has two entry points, both local: `npm run ingest:local` (the
fictional **fixture** source) and the local-only admin's **Import Products** page (see *Importing products
from URLs*). Nothing exposes ingestion over HTTP outside the local admin, and **no retailer-specific connector
exists yet**.

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
| `engine.ts`               | `runIngestion(d1, source)`: dedupe, identity, create/refresh, run tracking, result. An optional `onItem` observer reports each item's outcome and product id (it cannot change what the engine does) |
| `category-mapping.ts`     | Supported categories (`outdoor`, `indoor`, `costumes`) and an exact-match mapper factory   |
| `url.ts`, `price.ts`      | Conservative retailer-URL normalization; text/dollars -> integer cents                     |
| `sources/fixture.ts`      | The controlled fixture connector (fictional feed, two snapshots)                            |
| `sources/url-import.ts`   | The URL-import connector: reviewer-submitted product pages -> candidates (see *Importing products from URLs*) |
| `url-import/`             | Everything the URL importer needs: input parsing, safe fetching, metadata extraction, the pipeline |
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

The generic URL importer (below) covers any page that publishes standard product metadata. A retailer whose pages
do not (or that offers an API or feed) gets its own connector: implement `ProductIngestionSource` in
`src/server/ingestion/sources/`, register it in `local-cli.ts`, and add
its category table with `createCategoryMapper`. Do not edit `engine.ts` or `repositories/ingestion.ts`. See
*Not built yet* below for what must exist before the first one.

**Not built yet:** real retailer connectors; a remote/production run path, scheduling (Cron Triggers), and the
authentication they need; prioritising *stale* offers for refresh before they expire (`classifyOfferFreshness`
already labels them); manual merge/reconciliation of duplicate products; a review-queue view of skipped candidates.

## Importing products from URLs (local admin)

**Reviewer-driven discovery.** A person finds quality Halloween products while browsing, collects their
product-page URLs, and imports them in the local admin. The importer removes the tedious data entry (name, image,
price, ...); the reviewer stays responsible for deciding what is worth listing. Imported products are **always
pending**: nothing becomes public until the reviewer approves it in the normal review interface.

Open <http://localhost:4321/admin/products/import> (linked as **Import products** in the admin navigation).
It is part of the local-only admin: it is refused in every production build, on any non-loopback host, and for
any state-changing request that is not same-origin (see *Admin*). There is no public route or API for it.

### Using it

1. **Choose a category** (Outdoor decorations, Indoor decorations, or Costumes). It is applied to every **new**
   product in that import. A page rarely states a category that could be mapped without guessing, so none is
   inferred, and ingestion never creates categories. Products that already exist keep their own category (it is
   reviewer-owned), so importing a known URL under a different category changes nothing. To import products
   of different categories, do one import per category.
2. **Give it URLs**, either or both:
   - **Paste them**, one per line. Blank lines are ignored and whitespace is trimmed.
   - **Upload a CSV** with a header row named `url`:

     ```csv
     url
     https://example.com/product/one
     https://example.com/product/two
     ```

     Blank rows are ignored and values are trimmed. Quoting works as in ordinary CSV (a quoted value may contain
     commas, `""` for a quote, or line breaks; CRLF, LF and a leading byte-order mark are all fine). Other columns
     are ignored today; the parser keeps each row keyed by its header so an optional column can be read later
     without redesigning it. A malformed CSV (no `url` header, an unclosed quote) is rejected with a message
     instead of being guessed at.
3. **Import.** Up to 50 URLs per submission. Both input methods become one list and go through one pipeline.
4. **Read the results.** Each URL gets one row, in the order submitted, with a link to its review page when it
   has a product, then a summary count. One failing URL never stops the others.

| Result    | Meaning                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Imported  | A new **pending** product and its offer were created.                                                |
| Updated   | The listing already existed; its **offer** was refreshed (price, availability, link). The product was not touched. |
| Unchanged | The listing already existed and nothing changed; it was re-verified (`last_checked_at`).             |
| Skipped   | Not a valid or public address; a repeat of an earlier line or listing; or the page has no usable product metadata. |
| Conflict  | The listing's id and URL disagree with what is stored. Nothing was changed; a person must decide.    |
| Failed    | The page could not be retrieved (timeout, HTTP error, not a web page, blocked redirect) or could not be saved. |

Identical URLs (after normalization: trimmed, lower-case host, no `#fragment`) are collapsed **before** any
network request, so each URL is fetched at most once.

### How it relates to the ingestion engine

The importer is a **connector, not a second way to create products**. Its pipeline (`src/server/ingestion/url-import/run-import.ts`):

```
pasted lines / CSV  ->  prepareUrls (normalize, reject unsafe, dedupe)       no network
                    ->  fetchPublicPage + extractProduct, per URL             failures stay per URL
                    ->  group by retailer (host, www-insensitive)
                    ->  runIngestion(d1, createUrlImportSource(...)) per retailer   THE existing engine
                    ->  one result row per submitted URL
```

The engine needs a retailer up front, and a page's retailer is only known from its final address (after
redirects), so pages are fetched first and one engine run is made per retailer. A page that could not be fetched
never reaches the engine, so a failed fetch changes nothing about any listing. Because everything that reaches the
database goes through `runIngestion`, every rule in *Product ingestion* holds unchanged for imported URLs: new
products are `pending`, nothing is auto-approved, an existing product's review status and curated fields are never
overwritten (only the offer is refreshed), identity is retailer + listing id else exact URL (never title, never
across retailers), prices are integer cents, only an explicit statement marks a listing discontinued, `is_primary`
and `affiliate_url` are never touched, and a retailer a human deactivated is neither reactivated nor imported for.

**Retailers.** A retailer is identified by its host name with a leading `www.` ignored (`www.shop.example` and
`shop.example` are one retailer, slug `shop-example`). Other subdomains are *not* merged. A retailer that already
exists with the same website host is reused, whatever its slug (and if the slug the importer would derive is already
used by a retailer for a *different* website, a short suffix keeps the two apart). A new one is named from the
page's `og:site_name`, else its host name. The importer never renames or reactivates an existing retailer.

**Listing address.** The offer records the page's canonical URL (`<link rel="canonical">`, else `og:url`) when it
is on the same site and is not the site's home page, so tracking parameters do not make the same listing look new.
Otherwise it records the final URL after redirects.

### What is read from a page (generic, no retailer-specific rules)

In order of preference, using only structured data the page publishes: **JSON-LD `Product`** (schema.org:
name, description, image, offers), then **Open Graph / `product:*`** metadata (`og:title`, `og:image`,
`product:price:amount`, `product:availability`, ...), then **standard HTML metadata** (`<title>`,
`<meta name=description>`, canonical link). There are no CSS selectors, no page scripts are run, and there is no
AI inference. Anything not clearly stated is left **unknown**:

- A page must show it is a product page (a JSON-LD `Product`, or `og:type=product`); a page with only a title
  (a home page, an article, a login wall) is skipped, not turned into a product.
- Several Products in one page (a carousel) are not guessed between: the one whose `url` is the page's own is
  used, otherwise JSON-LD is ignored and Open Graph is the fallback.
- **Price** must be one clear amount with a currency: `"29.99"`, `29.99` and `"$1,299.00"` become integer cents
  exactly; `"19,99"`, ranges (`AggregateOffer` low/high, "from $5"), several different offers, `0`, fractions of
  a cent, and a price with no currency are **unknown** (the product still imports, with no price). A currency is
  never assumed.
- **Availability** is `in_stock` or `out_of_stock` only when clearly stated; pre-order, back-order and the like are
  unknown. **Discontinued** is set only for an explicit `Discontinued` availability.
- **Listing id** is taken only from an explicit `product:retailer_item_id`. `sku`, `mpn` and `gtin` are not used:
  they often identify a model or a variant, and a shared one would make two listings look like one.
- An unsafe or missing **image** is dropped (the product is created without one); a missing description or price is
  simply empty.

### Security: server-side fetching (SSRF)

The importer makes the *server* request reviewer-supplied URLs, so it treats them as untrusted
(`url-import/public-address.ts`, `safe-fetch.ts`, `node-transport.ts`):

- Only `http:`/`https:`, no credentials in the URL, and only the standard ports (80/443).
- Never fetched: `localhost` and other local-only names (`.local`, `.internal`, `.lan`, single-label names, cloud
  metadata names), and any IP that is not public: loopback, private (RFC 1918), CGNAT, **link-local (including the
  `169.254.169.254` metadata address)**, documentation/benchmark/multicast/reserved ranges, and IPv6 outside global
  unicast (which excludes `::1`, unique-local, link-local, IPv4-mapped and NAT64 forms). Obfuscated IPv4 spellings
  (`2130706433`, `0x7f.1`, `0177.0.0.1`) are normalized by the URL parser and caught.
- A host **name** is resolved and *every* address must be public (one private answer refuses it). The connection is
  then made to the address that was checked, not to the name, so there is no DNS-rebinding window.
- Redirects are followed by hand (at most 5) and **each target goes through all of the above again**, so a public
  URL cannot redirect the importer onto an internal address.
- 10 s total per page (redirects included), at most 2 MiB of body read (measured *after* decompression), HTML
  responses only (`text/html`, `application/xhtml+xml`); nothing else is read. 4 pages are fetched at a time.
- No cookies or credentials are sent. The request identifies itself honestly (`MHGA-Product-Importer/1.0`); it does
  not pretend to be a browser.
- Failure messages are fixed text. Nothing from the remote response, the network stack, SQL, or a stack trace is
  shown to the reviewer.

The transport uses Node's `dns`/`https` (the Workers runtime has neither DNS nor address pinning). That is
acceptable only because the importer lives in the local-only admin (it runs in the dev server). If Node is not
available it fails closed: every URL reports "could not be retrieved".

### Limitations

- **Some retailers block server-side retrieval** (for example, Etsy answers with HTTP 403) or render product data
  only with JavaScript. The importer reports those as *Failed* or *Skipped*; it does not use a headless browser,
  spoof a browser, or work around blocking. Add such a product by hand, or later through a retailer-specific
  connector.
- Only what a page publishes as structured data is read. Microdata and site-specific markup are not; a page
  without JSON-LD `Product` or `og:type=product` is skipped.
- `robots.txt` is not consulted. Each fetch is a single page a reviewer explicitly asked for (like a link
  preview), not crawling.
- One category per import; up to 50 URLs per import; no scheduled or remote imports.
- A page whose price is not stated unambiguously imports with **no price**. Re-importing a listing whose page no
  longer states a price records the price as unknown (the engine's normal rule: an observation is the truth of that
  moment) and refreshes `last_checked_at`.

### Affiliate links are optional

A normal retailer URL is a valid offer. The importer never generates or changes an `affiliate_url`. Building a
quality catalog comes first; an affiliate URL can be attached to an existing offer later without recreating the
product.

## Admin (local development only)

A product review interface: see products awaiting review, inspect public vs. internal
information and retailer offers, approve / reject / return to pending, keep internal
review notes, make basic edits (name, summary, description, category, quality notes,
badges, details), and import products from product-page URLs.

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
| `/admin/products/import`                               | Import products from URLs (paste or CSV); see *Importing products from URLs* |
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

A focused [Vitest](https://vitest.dev) suite (159 tests) that protects the **product visibility and
review rules** (the rules that keep unreviewed or unsafe products off the public site), the
**ingestion engine's business rules**, and the **URL importer's parsing, safety and pipeline rules**. It runs
the real repositories and engine, with nothing mocked except the network.

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

**URL import coverage** (`tests/url-import-*.test.ts`, `tests/url-import.test.ts`): manual URL and CSV parsing
(quoting, line endings, blank rows, malformed input, the `url` header), normalization and de-duplication before any
network work, and the category being required; the SSRF rules (loopback, private, link-local/metadata, IPv6 and
obfuscated IPv4 spellings, non-http schemes, credentials, ports, host names resolving to private addresses, and a
redirect from a public URL to a private one, at any hop) asserting that nothing blocked is ever looked up or
requested; redirect limits, timeouts, size and content-type limits; the real Node transport against a throwaway
loopback server (address pinning, gzip, a compression bomb, redirects not followed, cancellation);
JSON-LD `Product` and Open Graph extraction, malformed or ambiguous metadata, missing optional fields, integer-cent
price conversion with invalid/floating/ambiguous prices left unknown, availability and explicit-only discontinued,
canonical-URL rules, and unsafe image URLs being dropped; and, through the real engine, that an imported product
is created pending and not public, one failing URL never stops a batch, re-importing never duplicates, approved
and rejected products keep their status, curated fields and the affiliate URL are never overwritten, and identity
conflicts and retailer handling (www vs. non-www, existing retailers, a deactivated retailer) behave. All of it uses
fixture pages: no test touches the internet or a real retailer.

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
