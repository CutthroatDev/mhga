# Admin area (local development only)

The first version of the product review interface. It is **not** production-ready and is
**not authenticated**. It works only on a local dev server and is disabled in every
production build (see below). Cloudflare Access will be configured once the site has its
production hostname.

## Layout

- `src/admin/layouts/AdminLayout.astro` – its own shell (no public header/footer/theme
  toggle/decorations).
- `src/admin/components/` – status badge, tabs, queue table, offers table, review and edit
  forms, notices, and the import form and import results.
- `src/admin/styles/admin.css` – the admin visual system (loaded only by the admin layout).
- `src/admin/format.ts` – date/price display helpers.
- `src/pages/admin/**` – the pages: `/admin`, `/admin/products[/pending|approved|rejected]`,
  `/admin/products/import`, `/admin/products/<id-or-slug>`.
- `src/pages/api/admin/products/[id]/{review,update}.ts` – the write endpoints (POST only).
- `src/server/admin/` – the local-only guard (`access.ts`), input validation (including the import form,
  `import-form.ts`), HTTP helpers.
- `src/server/repositories/` – all database access (`adminProducts`, `adminReview`, ...).
  Pages contain no SQL.

## The local-only guard

`src/server/admin/access.ts` is the single place that decides whether admin is available:

- `import.meta.env.DEV` must be true. The build replaces it with the constant `false` in
  every production build, so a deployed site cannot pass; there is no environment variable
  or setting that can enable production admin.
- The request must be for a loopback hostname (`localhost`, `[::1]`).
- State-changing requests must carry a same-origin `Origin` header (CSRF protection; Astro's
  own origin check does not run in the dev server).

It is enforced in `src/middleware.ts` (all `/admin*` and `/api/admin*` paths), in every admin
page, and in every write endpoint. Refused requests get a bare 404. `astro.config.mjs`
fails the build if any admin page is prerendered.

**This is not authentication.** It only makes the admin exist on a local machine.

## Rules for new admin routes

1. `export const prerender = false;`
2. First lines: `const denied = localAdminDenied(request); if (denied) return denied;`
3. Endpoints: export `POST` and an `ALL` that returns `405`; validate every input with
   `src/server/admin/validation.ts`; redirect (303) to fixed paths; never return SQL errors.
4. Use repository functions. No SQL in pages or components.
5. Never link `/admin` from the public navigation.

## Import Products (`/admin/products/import`)

Reviewers paste product URLs or upload a CSV (a `url` column); the server reads each page's public product
metadata and creates **pending** products through the ingestion engine. Details, limits and the security model
are in the root `README.md` ("Importing products from URLs").

It is the one admin page that handles both GET (the form) and POST (runs the import and renders the results on
the same page; results are not stored, so there is no redirect). It follows the rules above: `prerender = false`,
`localAdminDenied` first (which also enforces same-origin for the POST), methods other than GET/HEAD/POST get
`405`, all input is validated on the server (`src/server/admin/import-form.ts`), no SQL in the page, and failures
show fixed messages, never raw errors. The server fetches the submitted URLs, so it must only ever do so through
`safe-fetch.ts`.

## Later: when Cloudflare Access is added (production hostname exists)

- Put Cloudflare Access in front of `/admin*` and `/api/admin*`.
- Validate the Access identity (the `Cf-Access-Jwt-Assertion` JWT) in the server instead of
  trusting the edge alone, and record who reviewed what (there is no reviewer identity yet).
- Decide deliberately whether to keep or replace the local-only guard. Do not simply flip
  it off. Extend it so production is allowed only with a verified identity.
- Revisit CSRF and the same-origin check for the production hostname.
- Add offer editing, pagination, search, and an audit trail as needed.
