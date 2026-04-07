import { Request, Response, NextFunction } from "express";
import { db, usersTable, eq } from "@workspace/db";
import { parseToken } from "../lib/auth.js";

export interface AuthenticatedRequest extends Request {
  user?: typeof usersTable.$inferSelect;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "No token provided" });
    return;
  }

  const token = authHeader.slice(7);
  const userId = parseToken(token);

  if (!userId) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid token" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Unauthorized", message: "User not found or inactive" });
    return;
  }

  req.user = user;
  next();
}
