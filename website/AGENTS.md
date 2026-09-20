# Guidance for coding agents

Astro + TypeScript site deployed to Cloudflare. See `README.md` for commands and
folder structure.

- Preserve existing functionality; don't remove or rewrite working code without reason.
- Prefer reusable components (`src/components/`) over one-off markup in pages.
- Keep mobile/responsive behavior in mind for every UI change.
- Do not introduce PHP.
- Do not hard-code product data in UI components. Data lives in `src/data/` and is read
  only through `src/data-access/`.
- Keep public product presentation separate from future ingestion/review logic.
  Public code shows approved products only; ingestion, review, and admin code goes in
  `src/server/` and `src/admin/` and must not be imported by public pages/components.
- Do not link `/admin` from public navigation.
- Cute/Scary theming is decorative only. Drive it with `data-halloween-theme` and CSS
  tokens in `src/styles/theme.css`; never filter or alter products by theme, and never
  build separate per-theme pages.
- Decorations go through `src/components/decor/Decor.astro`: `aria-hidden`, behind
  content, no layout impact, mostly hidden on mobile, motion-safe animation only.
- Avoid unnecessary dependencies; prefer the platform, Astro, and plain CSS.
- Verify changes with `npm run build` (and `npm run check` for types).

## Admin security (temporary rule)

- **Admin functionality is local-only until Cloudflare Access is configured.** There is no
  real authentication yet. The admin (`/admin`, `/api/admin/*`) works only on a local dev
  server and must stay disabled in production. This is NOT production authentication.
- **Production admin access must remain disabled by default.** The only switch is the
  compile-time check in `src/server/admin/access.ts` (`import.meta.env.DEV`). Never add an
  environment variable, binding, header, or query parameter that can enable admin, and never
  scatter `DEV` checks elsewhere: call `localAdminDenied()` (and keep `src/middleware.ts`).
- **Never introduce an unauthenticated production admin or write route.** Any new route under
  `/admin` or `/api/admin` must: set `export const prerender = false`, call `localAdminDenied`
  first, accept only the methods it needs (others get 405 via `ALL`), validate all input on
  the server, use repository functions (no SQL in pages), and never return SQL errors.
  The build fails if an admin page is prerendered; do not weaken that check.
- State-changing admin requests require a same-origin `Origin` (enforced in the guard,
  because Astro's `checkOrigin` does not run in the dev server).
- Admin code lives in `src/admin/` (UI) and `src/server/admin/` (guard, validation). Public
  pages and components must not import from either.
- When the production hostname exists, add Cloudflare Access (and verify the identity on the
  server) before enabling anything in production. That is a separate, deliberate change.

## Backend / database

- Cloudflare D1 is the primary database (binding `DB`). Do not add another database or an
  ORM without an explicit architectural decision.
- Schema changes go in a NEW numbered file in `migrations/`. Never edit an applied migration.
- Never modify production data from normal development commands. `dev`, `build`, `check`
  and all `*:local` scripts touch only the local simulation. Do not run `*:remote` scripts
  (or any `--remote` command) unless the user explicitly asks; never add a remote seed.
- Do not put a made-up `database_id` in `wrangler.jsonc`. It must come from `wrangler d1 create`.
- Database access lives in `src/server/` (repositories). UI components and pages contain no SQL
  and never import from `src/server/` (only API routes/admin, which are server code, may).
- Use prepared/bound statements (`Database.statement`/`all`/`first`/`run`). Never build SQL by
  concatenating values. Column names in dynamic updates must be literals in repository code.
- Public reads expose approved/published data only. Internal review information
  (`review_notes`, status history) must never appear in public models: public queries live in
  `public-product-query.ts` and do not select it.
- Keep ingestion, review, and public presentation separate. Do not expose HTTP endpoints that
  create/approve/reject products or edit retailers, offers, or projects until authentication
  exists.
- Astro 5 + `@astrojs/cloudflare` v12: reach bindings via `Astro.locals.runtime.env`. Do not use
  Astro 6 APIs (e.g. `import { env } from 'cloudflare:workers'`). Keep pages prerendered; use
  `export const prerender = false` only for routes that truly need the Worker.
- Never remove `public/.assetsignore`: it keeps the server bundle out of the public assets.
- Do not set `assets.not_found_handling` in `wrangler.jsonc`: it would bypass the Worker for `/api/*`.
