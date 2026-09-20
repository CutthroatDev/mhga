-- 0002_bootstrap_categories
--
-- Structural REFERENCE DATA (not sample data): the category hierarchy the site requires.
-- The public catalog derives a product's section (decorations | costumes) and sub-category
-- from this tree, so a fresh database needs it before any product can be public.
--
--   Decorations
--     Outdoor Decorations   (slug: outdoor)
--     Indoor Decorations    (slug: indoor)
--   Costumes
--
-- Stability
--   * IDs are fixed, well-known values (not generated), so this migration is deterministic
--     and identical in every environment. They match the IDs local seed products have always
--     used. Never change them.
--   * Idempotent: ON CONFLICT (id) DO NOTHING. A database that already has these rows (for
--     example a local database seeded before this migration existed) is left untouched, and
--     nothing is overwritten (names and descriptions may be edited later).
--   * INSERT OR IGNORE is deliberately NOT used: it would also hide a clash on the unique
--     slug column caused by a row with a different id. That should fail loudly instead.
--
-- Do not edit an applied migration. To add or change categories later, add a new numbered
-- migration.

-- Top-level sections first, then their children.
INSERT INTO categories (id, slug, name, description, parent_id, sort_order) VALUES
  ('00000000-0000-4000-8000-00000000c001', 'decorations', 'Decorations', 'Outdoor and indoor Halloween decorations.', NULL, 1),
  ('00000000-0000-4000-8000-00000000c004', 'costumes', 'Costumes', 'Halloween costumes for everyone.', NULL, 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO categories (id, slug, name, description, parent_id, sort_order) VALUES
  ('00000000-0000-4000-8000-00000000c002', 'outdoor', 'Outdoor Decorations', 'Yard, porch, and front-door Halloween decorations.', '00000000-0000-4000-8000-00000000c001', 1),
  ('00000000-0000-4000-8000-00000000c003', 'indoor', 'Indoor Decorations', 'Halloween decorations for inside the home.', '00000000-0000-4000-8000-00000000c001', 2)
ON CONFLICT (id) DO NOTHING;
