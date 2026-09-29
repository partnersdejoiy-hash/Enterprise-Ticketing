// Run manually on the authorised server. Does not create accounts or change roles.
import { db, pool, usersTable, eq } from "@workspace/db";
import { hashPassword } from "../../../artifacts/orbitdesk/server/lib/security.js";
const email = process.env.RESET_USER_EMAIL?.trim().toLowerCase();
const password = process.env.RESET_USER_PASSWORD;
if (!email || !password || password.length < 16)
  throw new Error(
    "Set RESET_USER_EMAIL and a unique RESET_USER_PASSWORD of at least 16 characters in the server environment.",
  );
const changed = await db
  .update(usersTable)
  .set({
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    updatedAt: new Date(),
  })
  .where(eq(usersTable.email, email))
  .returning({ id: usersTable.id });
if (!changed.length)
  throw new Error("Account not found. No account was changed.");
await pool.query("DELETE FROM orbit_sessions WHERE user_id=$1", [
  changed[0].id,
]);
console.log(
  "Password reset; existing sessions revoked. Remove reset variables.",
);
await pool.end();
