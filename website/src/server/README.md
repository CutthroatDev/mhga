# Server code (placeholder)

Reserved for future backend functionality. Nothing is implemented yet.

Expected contents over time:

- product ingestion (collecting product data from retailers)
- the review workflow (`pending` → `approved` / `rejected`)
- API handlers used by the admin area

## Rules

- Keep this separate from public presentation. Public pages and components read
  data only through `src/data-access/`, which exposes approved products only.
- Public UI code must not import from this directory.
- Runs on Cloudflare (Workers runtime): no Node-only APIs unless verified compatible.
