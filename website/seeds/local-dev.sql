-- LOCAL DEVELOPMENT SEED. PLACEHOLDER/TEST DATA ONLY.
--
-- Run it only against the LOCAL database:   npm run db:seed:local
-- There is intentionally no remote seed script. Never run this against production.
--
-- Placeholder samples (porch skeleton, pending candle, witch hat, paper bats) that add just enough to exercise every rule: an approved, a pending, and a
-- rejected product; two retailers; multiple offers for one product; a published and a
-- draft DIY project; ordered project <-> product links.
--
-- Requires the migrations to have run first (npm run db:migrate:local). The category hierarchy
-- (decorations > outdoor, indoor; costumes) is structural data created by
-- migrations/0002_bootstrap_categories.sql, NOT by this file: the seed only looks categories up by
-- slug and never inserts, updates, or deletes them, so there is a single definition of the tree.
-- (If the migration has not run, the product inserts below fail with a NOT NULL error on
-- products.category_id: run npm run db:migrate:local first.)
--
-- Re-runnable: it first removes only rows with these seed ids, then inserts them again.
-- (Deleting a product/project cascades to its offers/links; children are removed first.)

-- ---------------------------------------------------------------------------
-- Reset seed rows
-- ---------------------------------------------------------------------------
DELETE FROM diy_projects WHERE id IN (
  '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d002'
);
DELETE FROM products WHERE id IN (
  '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000a002',
  '00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000a004'
);
DELETE FROM retailers WHERE id IN (
  '00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000e002'
);

-- ---------------------------------------------------------------------------
-- Retailers (fake)
-- ---------------------------------------------------------------------------
INSERT INTO retailers (id, slug, name, website_url, is_active) VALUES
  ('00000000-0000-4000-8000-00000000e001', 'example-retailer', 'Example Retailer', 'https://example.com', 1),
  ('00000000-0000-4000-8000-00000000e002', 'example-marketplace', 'Example Marketplace', 'https://example.org', 1);

-- ---------------------------------------------------------------------------
-- Products: approved, pending, rejected (+ an approved costume)
-- ---------------------------------------------------------------------------
INSERT INTO products (
  id, slug, name, summary, description, category_id,
  quality_notes_json, details_json, badges_json,
  review_status, review_notes, reviewed_at
) VALUES
  -- APPROVED, outdoor. Has two offers below.
  ('00000000-0000-4000-8000-00000000a001', 'sample-porch-skeleton', 'Sample Porch Skeleton',
   'Placeholder outdoor decoration.',
   'Placeholder product used to exercise the product detail layout.',
   (SELECT id FROM categories WHERE slug = 'outdoor'),
   '["Placeholder note about materials and construction."]',
   '[{"label":"Size","value":"Placeholder"}]',
   '["Sample badge"]',
   'approved', 'PLACEHOLDER internal note: approved for local testing.', '2026-01-01T00:00:00Z'),

  -- PENDING, indoor. Must never appear in public reads.
  ('00000000-0000-4000-8000-00000000a002', 'sample-pending-candle', 'Sample Pending Candle',
   'Not approved, so it must not appear anywhere on the public site.',
   NULL,
   (SELECT id FROM categories WHERE slug = 'indoor'),
   NULL, NULL, NULL,
   'pending', NULL, NULL),

  -- APPROVED, costumes root category (no sub-category), like the static sample.
  ('00000000-0000-4000-8000-00000000a003', 'sample-witch-hat', 'Sample Witch Hat',
   'Placeholder costume product.',
   NULL,
   (SELECT id FROM categories WHERE slug = 'costumes'),
   NULL, NULL, NULL,
   'approved', NULL, '2026-01-01T00:00:00Z'),

  -- REJECTED, outdoor. Internal notes must never leak.
  ('00000000-0000-4000-8000-00000000a004', 'sample-rejected-inflatable', 'Sample Rejected Inflatable',
   'Rejected during review, so it must not appear anywhere on the public site.',
   NULL,
   (SELECT id FROM categories WHERE slug = 'outdoor'),
   NULL, NULL, NULL,
   'rejected', 'PLACEHOLDER internal note: rejected for local testing. Must never be public.', '2026-01-01T00:00:00Z');

-- ---------------------------------------------------------------------------
-- Offers. Prices are integer cents.
-- ---------------------------------------------------------------------------
INSERT INTO product_offers (
  id, product_id, retailer_id, retailer_product_id, product_url, affiliate_url,
  price_cents, currency, availability, is_primary, last_checked_at
) VALUES
  -- Porch skeleton: preferred offer ($24.99) and a cheaper non-preferred one ($22.50).
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000e001',
   'EX-SKEL-1', 'https://example.com/sample-porch-skeleton', NULL, 2499, 'USD', 'in_stock', 1, '2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000b002', '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000e002',
   NULL, 'https://example.org/sample-porch-skeleton', NULL, 2250, 'USD', 'in_stock', 0, '2026-01-01T00:00:00Z'),
  -- Witch hat: single offer ($12.50).
  ('00000000-0000-4000-8000-00000000b003', '00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000e001',
   NULL, 'https://example.com/sample-witch-hat', NULL, 1250, 'USD', 'in_stock', 1, '2026-01-01T00:00:00Z'),
  -- Pending candle has an offer too, to prove an offer alone does not make a product public.
  ('00000000-0000-4000-8000-00000000b004', '00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-00000000e001',
   NULL, 'https://example.com/sample-pending-candle', NULL, 999, 'USD', 'unknown', 1, NULL);

-- ---------------------------------------------------------------------------
-- DIY projects: one published, one draft
-- ---------------------------------------------------------------------------
INSERT INTO diy_projects (
  id, slug, title, summary, materials_json, steps_json, difficulty, estimated_time, status
) VALUES
  ('00000000-0000-4000-8000-00000000d001', 'sample-paper-bats', 'Sample Paper Bats',
   'Placeholder DIY project.',
   '["Black paper","Scissors","Tape"]',
   '["Cut out bat shapes.","Tape them to a wall."]',
   'easy', '30 minutes', 'published'),
  ('00000000-0000-4000-8000-00000000d002', 'sample-draft-project', 'Sample Draft Project',
   'Unpublished, so it must not appear publicly.',
   NULL, NULL, 'medium', NULL, 'draft');

-- ---------------------------------------------------------------------------
-- Project <-> product links, with deliberate order.
-- The pending candle is linked on purpose: it must be filtered out of public reads.
-- ---------------------------------------------------------------------------
INSERT INTO diy_project_products (project_id, product_id, sort_order) VALUES
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000a003', 1),
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000a002', 2),
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000a001', 3);
