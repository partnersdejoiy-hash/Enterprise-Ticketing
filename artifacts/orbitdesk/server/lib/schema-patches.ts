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
