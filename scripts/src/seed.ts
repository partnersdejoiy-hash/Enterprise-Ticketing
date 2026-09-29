// Explicit first-run bootstrap. Never inserts sample people, tickets or known passwords.
import { db, pool, usersTable, eq } from "@workspace/db";
import { hashPassword } from "../../artifacts/orbitdesk/server/lib/security.js";
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (
  !email ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  !password ||
  password.length < 16
)
  throw new Error(
    "Provide BOOTSTRAP_ADMIN_EMAIL and a unique BOOTSTRAP_ADMIN_PASSWORD of at least 16 characters via the server environment.",
  );
const [existing] = await db
  .select({ id: usersTable.id })
  .from(usersTable)
  .where(eq(usersTable.email, email))
  .limit(1);
if (existing)
  throw new Error(
    "Account exists; use the documented password reset script. No account was changed.",
  );
await db
  .insert(usersTable)
  .values({
    name: process.env.BOOTSTRAP_ADMIN_NAME || "Workspace administrator",
    email,
    passwordHash: await hashPassword(password),
    role: "super_admin",
  });
console.log(
  "Administrator created; first login requires a new password. Remove bootstrap variables from the environment.",
);
await pool.end();
