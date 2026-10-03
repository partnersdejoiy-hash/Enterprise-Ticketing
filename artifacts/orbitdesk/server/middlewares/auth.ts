import { Request, Response, NextFunction } from "express";
import { db, pool, usersTable, eq } from "@workspace/db";
import { digest, constantEqual } from "../lib/security.js";
export interface AuthenticatedRequest extends Request {
  user?: typeof usersTable.$inferSelect;
  sessionHash?: string;
}
export const cookieName =
  process.env.NODE_ENV === "production"
    ? "__Host-orbit_session"
    : "orbit_session";
export function sessionToken(req: Request) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  return (
    cookie ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "")
  );
}
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.user) return next();
  res.setHeader("Cache-Control", "no-store");
  const token = sessionToken(req);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const sessionHash = digest(token);
  const result = await pool.query(
    "SELECT user_id,password_fingerprint FROM orbit_sessions WHERE token_hash=$1 AND expires_at>now()",
    [sessionHash],
  );
  if (!result.rowCount) {
    res.status(401).json({ error: "Session expired" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, result.rows[0].user_id))
    .limit(1);
  if (
    !user?.isActive ||
    !constantEqual(
      digest(user.passwordHash),
      result.rows[0].password_fingerprint,
    )
  ) {
    res.status(401).json({ error: "Session revoked" });
    return;
  }
  req.user = user;
  req.sessionHash = sessionHash;
  const path = req.originalUrl.split("?")[0];
  if (
    user.mustChangePassword &&
    !["/api/auth/me", "/api/auth/logout", "/api/auth/change-password"].includes(
      path,
    )
  ) {
    res
      .status(428)
      .json({
        error: "Password change required",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    return;
  }
  next();
}
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (!["super_admin", "admin"].includes(req.user?.role ?? "")) {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
}
