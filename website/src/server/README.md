# Server code

Server-only code: the D1 database layer, repositories, the ingestion engine, and the local-only admin logic.
Public pages and components must never import from this directory. Only server routes
(`src/pages/api/*`) and the local-only admin (`src/pages/admin/*`, `src/admin/`) may.

See "Backend / Database" in the root `README.md` for the workflow and architecture.

```
db/            Database wrapper (bound statements only), row types, helpers, locals accessor
domain/        Internal models (some hold internal-only data such as review notes)
repositories/  Public reads, admin operations, admin review read models, mappers
admin/         Local-only admin: access guard, validation, HTTP helpers, messages
ingestion/     Product ingestion engine, connector interface, fixture connector, and the URL importer (url-import/)
```

Routes using this layer today: `src/pages/api/health.ts` (just `Database.ping()`) and the
local-only admin. The admin write endpoints (`/api/admin/*`) are refused outside a local dev
server (see `src/admin/README.md`).

## Rules

- **Public vs internal.** `PublicProductRepository` (the public site's data source) and
  `DIYProjectRepository` (not used by the site yet) return public types from `src/types/`. `AdminProductRepository`,
  `RetailerRepository`, and `OfferRepository` are internal: they can see everything,
  including review notes, and must never feed a public page.
- **Public queries never select internal columns.** All public product SQL is built from
  `public-product-query.ts`. Add columns there deliberately.
- **No SQL outside this directory.** Public pages call `src/data-access/` (`getPublicCatalog`),
  which is built from `createPublicRepositories` (public repositories only) and reads D1 live.
  Public product visibility is defined in one place: `repositories/public-product-query.ts`.
- **Bound values only.** Use `Database.statement/all/first/run`. Never concatenate values into SQL.
- **No public write endpoints.** The only write endpoints are the local-only admin ones, which
  are guarded by `src/server/admin/access.ts` and disabled in production builds.
- Runs in the Cloudflare Workers runtime: no Node-only APIs unless verified compatible.
- Use relative imports here (keeps the code loadable outside Astro's alias config).

- **Ingestion is internal and local.** `ingestion/` and `repositories/ingestion.ts` are reachable only
  through `npm run ingest:local` and the local-only admin's Import Products page
  (`src/pages/admin/products/import.astro`, guarded like every admin route). No other route may call them,
  and `createPublicRepositories` must never expose them. Retailer-specific acquisition belongs in
  `ingestion/sources/`, not in the engine. See "Product ingestion" and "Importing products from URLs" in the
  root `README.md`.
- **The URL importer fetches reviewer-supplied URLs, so SSRF protection is mandatory.** Every fetch goes through
  `ingestion/url-import/safe-fetch.ts` (public addresses only, every redirect re-validated, connection pinned to
  the verified address, time and size limits, HTML only). Never call `fetch` on a reviewer-supplied URL directly.
  Its transport (`node-transport.ts`) is the one deliberate use of Node-only APIs in this directory, because the
  Workers runtime has no DNS or address pinning; it is acceptable only because the importer runs in the
  local-only admin, and it fails closed where Node is unavailable.
- **Imports go through the engine.** `url-import/` produces candidates via `sources/url-import.ts` and calls
  `runIngestion`. It must never write products or offers itself.

## Not built yet

Retailer-specific connectors (the engine, a fixture connector and the generic URL importer exist), remote/scheduled ingestion,
authentication (Cloudflare Access), offer editing, affiliate handling, price tracking.
