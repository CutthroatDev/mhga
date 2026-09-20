# Admin area (placeholder)

Nothing is implemented here yet. This directory reserves the place for the future
private review system at `/admin`, where product information is reviewed,
approved, edited, or rejected before it appears publicly.

## Intended layout

- `src/admin/` – admin-only components, layouts, and client logic.
- `src/pages/admin/` – the `/admin` routes (create when the admin is built).
- `src/server/` – review/ingestion server logic the admin calls (see its README).

## Notes for when this is built

- Do not add an admin link to the public navigation (`src/config/site.ts`).
- `/admin` must be protected before it ships (e.g. Cloudflare Access or real
  authentication). Do not rely on obscurity.
- `/admin` routes need on-demand rendering. Add `@astrojs/cloudflare` and set
  `export const prerender = false` on admin routes; public pages can stay static.
- Admin code must not be imported by public pages/components.
