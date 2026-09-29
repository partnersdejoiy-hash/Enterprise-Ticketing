import { pool } from "@workspace/db";
import { readFile } from "node:fs/promises";
const schema = await pool.query("SELECT to_regclass('public.users') as users");
if (!schema.rows[0].users)
  await pool.query(
    await readFile(
      new URL("../../migrations/000_initial_schema.sql", import.meta.url),
      "utf8",
    ),
  );
await pool.query(
  await readFile(
    new URL("../../migrations/001_secure_intake.sql", import.meta.url),
    "utf8",
  ),
);
await pool.query(
  await readFile(
    new URL("../../migrations/002_hierarchy.sql", import.meta.url),
    "utf8",
  ),
);
console.log("Database migrations applied.");
await pool.end();
