-- OrbitDesk migration 015: request category and subcategory on tickets.
-- Set by the requester's portal (magistick Get Help) when the ticket is raised;
-- agents can filter by them and handlers can correct them.
-- Also applied idempotently at startup (server/lib/schema-patches.ts) so the
-- API never selects a column that does not exist yet.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS subcategory text;
CREATE INDEX IF NOT EXISTS tickets_category_idx ON tickets (category, subcategory);
