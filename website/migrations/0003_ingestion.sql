-- 0003_ingestion
--
-- Support for the product ingestion engine (see "Product ingestion" in README.md).
--
-- What already gives listing identity (0001, unchanged):
--   UNIQUE (retailer_id, retailer_product_id)   the retailer's own listing id
--   UNIQUE (retailer_id, product_url)           exact URL fallback
-- SQLite treats NULLs as distinct in a UNIQUE constraint, so offers that have no retailer
-- listing id never clash with each other. Ingestion relies on these constraints as its
-- last line of defense against duplicate offers; nothing more is needed for identity.
--
-- What this migration adds, and nothing else:
--   1. Two small provenance columns on product_offers: where an offer was last observed
--      and the retailer's own title for it. The retailer's title is a SOURCE observation.
--      It can differ from the curated product name, and a retailer renaming a listing
--      must never overwrite what a human curated. Both columns are INTERNAL: no public
--      query selects them.
--   2. ingestion_runs: one row per run, for a lightweight audit trail.
--
-- Not stored on purpose: raw retailer payloads, HTML, or per-candidate history.

ALTER TABLE product_offers ADD COLUMN source_id    TEXT;  -- ingestion source that last observed this offer, e.g. 'fixture'
ALTER TABLE product_offers ADD COLUMN source_title TEXT;  -- the retailer's own title at that observation (internal only)

CREATE TABLE ingestion_runs (
  id                    TEXT PRIMARY KEY NOT NULL,
  source_id             TEXT NOT NULL CHECK (length(source_id) > 0),
  -- running:   started, not finished (also what a run that was killed mid-way looks like)
  -- succeeded: finished, every candidate was handled or was a harmless duplicate
  -- partial:   finished, but some candidates were invalid, unmapped, in conflict, or failed
  -- failed:    the run itself failed (source unavailable, database error): nothing was assumed
  status                TEXT NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  started_at            TEXT NOT NULL,
  finished_at           TEXT,
  candidates_discovered INTEGER NOT NULL DEFAULT 0 CHECK (candidates_discovered >= 0),
  products_created      INTEGER NOT NULL DEFAULT 0 CHECK (products_created >= 0),
  offers_created        INTEGER NOT NULL DEFAULT 0 CHECK (offers_created >= 0),
  offers_updated        INTEGER NOT NULL DEFAULT 0 CHECK (offers_updated >= 0),
  offers_unchanged      INTEGER NOT NULL DEFAULT 0 CHECK (offers_unchanged >= 0),
  candidates_skipped    INTEGER NOT NULL DEFAULT 0 CHECK (candidates_skipped >= 0), -- duplicate, invalid, unmapped, conflict
  candidates_failed     INTEGER NOT NULL DEFAULT 0 CHECK (candidates_failed >= 0),  -- unexpected error handling one candidate
  error_count           INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  -- A short, bounded JSON array of the first few problems ({index, code, message, ref?}).
  -- Engine-written text only: never raw SQL errors and never retailer payloads.
  errors_json           TEXT
                          CHECK (errors_json IS NULL
                                 OR (json_valid(errors_json) AND json_type(errors_json) = 'array')),

  -- A finished run records when it finished.
  CHECK (status = 'running' OR finished_at IS NOT NULL)
);

CREATE INDEX idx_ingestion_runs_source ON ingestion_runs (source_id, started_at);
