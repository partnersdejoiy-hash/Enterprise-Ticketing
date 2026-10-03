-- OrbitDesk migration 010: change <-> CI link table (Superpower #17 AI Impact Analysis).
-- A change can affect multiple configuration items; impact traversal starts here.

CREATE TABLE IF NOT EXISTS change_cis (
  id serial PRIMARY KEY,
  change_id integer NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  ci_id integer NOT NULL REFERENCES configuration_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_id, ci_id)
);
CREATE INDEX IF NOT EXISTS change_cis_change ON change_cis(change_id);
CREATE INDEX IF NOT EXISTS change_cis_ci ON change_cis(ci_id);
