# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

`AGENTS.md` (imported above) holds the binding rules for the public catalog, ingestion, admin security and
database work. `README.md` documents routes, the freshness policy and local D1 setup in more depth. This file
only adds commands and the cross-file picture.

## Commands

```sh
npm run dev                  # http://localhost:4321, bindings come from the LOCAL D1 in .wrangler/state
npm run build                # prerendered pages + Worker in dist/_worker.js (also runs the admin-prerender guard)
npm run check                # astro check: types for .astro, .ts and tests
npm test                     # vitest run (all of tests/)
npx vitest run tests/offer-freshness.test.ts            # one file
npx vitest run tests/ingestion.test.ts -t "some name"   # one test by name

npm run db:migrate:local     # apply migrations to LOCAL D1 (run before seeding)
npm run db:seed:local        # sample data, re-runnable; offer timestamps are relative to run time
npm run ingest:local -- --source fixture
rm -rf .wrangler/state       # reset local D1, then migrate + seed again
```

Only use the `*:local` scripts. Never run `*:remote` scripts or `--remote` commands unless explicitly asked.
After editing `wrangler.jsonc`, run `npm run cf:types` (delete `dist/` first).

## Architecture

Astro 5 (`output: 'static'`) with `@astrojs/cloudflare` v12. Pages are prerendered unless they set
`prerender = false`; those run in the Worker and read D1 through `Astro.locals.runtime.env.DB`.

**Three layers with one-way imports.** This is the part that takes several files to see:

- `src/server/` is the only place that touches D1: `db/database.ts` (bound statements only) ->
  `repositories/` -> `domain/` models. `createPublicRepositories` has no admin repository, so public code
  cannot reach review notes or pending products.
- `src/data-access/` is the bridge for public pages (`getPublicCatalog()`). It turns any D1 failure into a
  generic 500 and marks live responses `no-store`. Public pages/components import from here and `src/types/`
  only, never from `src/server/`, `src/admin/` or ingestion.
- `src/admin/` (UI) + `src/server/admin/` (guard, validation) + `src/pages/admin/`, `src/pages/api/admin/` form
  the local-only review tool. It is enforced in three places that must stay in sync: `src/middleware.ts`, the
  per-route `localAdminDenied()` call, and the `forbid-prerendered-admin` integration in `astro.config.mjs`
  that fails the build if an admin page is prerendered.

**Public visibility is one SQL definition.** `src/server/repositories/public-product-query.ts` decides
what is public (approved + eligible offer + supported category). Lists, slug lookups, related products and DIY
pages all go through it. Offer freshness is not stored: `domain/offer-freshness.ts` computes a cutoff that is
passed into that SQL as a bound value. Public mappers sanitize image URLs via `domain/image-url.ts`.

**Ingestion pipeline** (`src/server/ingestion/`): a connector in `sources/` (implements `ProductIngestionSource`,
fetch + `toCandidate`, no DB access) -> the retailer-agnostic `engine.ts` (validate, match by strong source
identity, write via `repositories/ingestion.ts`) -> a new *pending* product + offer, or an offer-only refresh
for a known listing. There are two entry points, both local: `scripts/ingest-local.mjs` (loads `local-cli.ts`
through Vite's module runner against a local-only D1 proxy; fixture connector only) and the local-only admin
page `/admin/products/import`, which runs the URL importer (`url-import/`: pasted URLs or CSV -> `safe-fetch.ts`
(SSRF-checked fetching) -> `extract-product.ts` (JSON-LD / Open Graph) -> one `runIngestion` per retailer via
`sources/url-import.ts`). Reviewer-supplied URLs must only ever be fetched through `safe-fetch.ts`.

**Tests** (`tests/`) run the real repositories against an in-memory Miniflare D1 built from `migrations/*.sql`
(`tests/helpers/test-db.ts`). The migration splitter is naive (splits on `;`, rejects `BEGIN...END`), so a
migration containing triggers needs the helper updated first. `tests/helpers/catalog-world.ts` builds the
fixture catalog the visibility tests share.

**Theming and decor.** The Cute/Scary toggle only sets `data-halloween-theme` on `<html>`; CSS tokens in
`src/styles/theme.css` do the rest (content tokens in `tokens.css` are theme-independent). Decorative SVGs
render both variants and CSS shows one (`.only-cute` / `.only-scary`).

DIY project *content* is static (`src/data/diy-projects.ts`); only its related products are resolved live by slug.
Migrations `0001` (schema), `0002` (bootstrap categories) and `0003` (ingestion) are the schema history.
