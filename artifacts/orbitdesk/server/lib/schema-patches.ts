/**
 * Idempotent, additive schema patches the API code depends on.
 *
 * The Drizzle schema selects every column, so a column added in code must
 * exist before any ticket query runs. Migrations are run manually by a
 * super admin (POST /api/admin/migrations/run); these patches make a fresh
 * deploy safe before that happens. Each statement mirrors a file in
 * migrations/ and only ever ADDs (never drops or rewrites).
 */
import { pool } from "@workspace/db";

const PATCHES = [
  // 015_ticket_category.sql
  `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category text`,
  `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS subcategory text`,
  `CREATE INDEX IF NOT EXISTS tickets_category_idx ON tickets (category, subcategory)`,
  // 016_it_service_management.sql
  `ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'service'`,
  `ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS group_name text NOT NULL DEFAULT 'General'`,
  `ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT 'box'`,
  `ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT ''`,
  `ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false`,
  `ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100`,
  `ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS fulfilment_tasks jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `CREATE TABLE IF NOT EXISTS it_request_tasks (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES service_catalog_requests(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  done boolean NOT NULL DEFAULT false,
  done_by_id integer REFERENCES users(id) ON DELETE SET NULL,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS it_request_tasks_request ON it_request_tasks(request_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS ci_owner ON configuration_items(owner_id) WHERE deleted_at IS NULL`,
];

let applied: Promise<void> | null = null;

/** Runs once per process; later calls reuse the same promise. Retries after a failure. */
export function ensureSchemaPatches(): Promise<void> {
  if (!applied) {
    applied = (async () => {
      for (const stmt of PATCHES) await pool.query(stmt);
    })().catch((err) => {
      applied = null;
      throw err;
    });
  }
  return applied;
}
