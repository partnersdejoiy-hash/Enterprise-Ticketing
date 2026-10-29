import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// SUPABASE_DATABASE_URL (orbitdesk_app role, schema "helpdesk" in the DEJOIY BPO database)
// wins; without it OrbitDesk keeps its old DATABASE_URL, so switching back is one env var.
// Forgive copy-paste slips in Vercel: spaces, wrapping quotes, or a pasted "KEY=" prefix.
const url = (process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "")
  .trim()
  .replace(/^[A-Z_]+=/, "")
  .replace(/^["'`]+|["'`]+$/g, "")
  .trim();
if (!url) {
  throw new Error(
    "SUPABASE_DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: url,
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: process.env.VERCEL ? 10_000 : 30_000,
  connectionTimeoutMillis: 5_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { eq, and, or, sql, ilike, inArray, gte, lte, ne, gt, lt, desc, asc, isNull, isNotNull } from "drizzle-orm";
