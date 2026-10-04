/**
 * Secure database migration runner.
 *
 * POST /api/admin/migrations/run — super_admin only.
 * Runs pending .sql files from the migrations/ directory in order,
 * tracking applied migrations in schema_migrations. Each file runs
 * in its own transaction (files should be transaction-safe).
 *
 * GET /api/admin/migrations/status — super_admin only.
 * Lists applied vs pending migrations.
 */

import { Router } from "express";
import { promises as fs, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  requireAdmin,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import type { Response, NextFunction } from "express";

const router = Router();
router.use(authMiddleware, requireAdmin);
// Extra guard: only super_admin may run migrations (not plain admin).
router.use(
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== "super_admin") {
      res.status(403).json({ error: "Super admin access required" });
      return;
    }
    next();
  },
);

async function listMigrationFiles(): Promise<string[]> {
  const files = await fs.readdir(resolveMigrationsDir());
  return files.filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Locate the migrations/ directory.
 *
 * - MIGRATIONS_DIR env var wins when set.
 * - In the bundled serverless function (Vercel), esbuild flattens everything
 *   into a single file, so the source-tree relative path no longer works;
 *   build-vercel.mjs copies migrations/ next to the bundled entry point.
 * - Otherwise fall back to the source-tree layout
 *   (<repo>/artifacts/orbitdesk/server/routes -> <repo>/migrations).
 */
function resolveMigrationsDir(): string {
  const fromEnv = process.env.MIGRATIONS_DIR?.trim();
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "migrations"),
    join(here, "..", "..", "..", "..", "migrations"),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `Migrations directory not found. Checked: ${candidates.join(", ")}. ` +
      `Set MIGRATIONS_DIR or ensure build-vercel.mjs copied migrations/ next to the bundle.`,
  );
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

router.get("/status", async (_req, res) => {
  try {
    await ensureMigrationsTable();
    const files = await listMigrationFiles();
    const { rows } = await pool.query(`SELECT filename FROM schema_migrations`);
    const applied = new Set(rows.map((r) => r.filename as string));
    res.json({
      migrations: files.map((f) => ({
        filename: f,
        applied: applied.has(f),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/run", async (_req, res) => {
  try {
    await ensureMigrationsTable();
    const files = await listMigrationFiles();
    const { rows } = await pool.query(`SELECT filename FROM schema_migrations`);
    const applied = new Set(rows.map((r) => r.filename as string));
    const pending = files.filter((f) => !applied.has(f));

    const results: { filename: string; status: string; error?: string }[] = [];
    for (const file of pending) {
      const sql = await fs.readFile(join(resolveMigrationsDir(), file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [file],
        );
        await client.query("COMMIT");
        results.push({ filename: file, status: "applied" });
      } catch (err) {
        await client.query("ROLLBACK");
        results.push({
          filename: file, status: "failed", error: String(err),
        });
        break; // stop on first failure — never skip a failed migration
      } finally {
        client.release();
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
