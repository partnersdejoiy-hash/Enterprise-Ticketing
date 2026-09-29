import {
  db,
  ticketsTable,
  ticketAttachmentsTable,
  usersTable,
  eq,
  and,
  or,
  sql,
} from "@workspace/db";
import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middlewares/auth.js";
type User = typeof usersTable.$inferSelect;
// Reporting relationships, rather than job titles, define a person's team.
// UNION deduplicates rows and terminates even if legacy data contains a cycle.
export function teamIds(user: User) {
  return sql`WITH RECURSIVE team(id) AS (
 SELECT ${user.id}::integer UNION SELECT u.id FROM users u JOIN team ON u.manager_id=team.id
) SELECT id FROM team`;
}
export function ticketScope(user: User) {
  if (["admin", "super_admin"].includes(user.role)) return sql`true`;
  const people =
    user.role === "external" ? sql`SELECT ${user.id}::integer` : teamIds(user);
  const personal = sql`(${ticketsTable.createdById} IN (${people}) OR ${ticketsTable.raisedForUserId} IN (${people}) OR EXISTS(SELECT 1 FROM unnest(${ticketsTable.taggedUserIds}) tagged(id) WHERE tagged.id IN (${people})))`;
  const handling =
    ["agent", "manager"].includes(user.role) && user.departmentId
      ? eq(ticketsTable.departmentId, user.departmentId)
      : sql`false`;
  return or(personal, handling, eq(ticketsTable.assigneeId, user.id))!;
}
export async function handlesTicket(user: User, id: number) {
  if (["admin", "super_admin"].includes(user.role)) return true;
  if (!["agent", "manager"].includes(user.role)) return false;
  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, id))
    .limit(1);
  return (
    !!ticket &&
    (ticket.assigneeId === user.id ||
      (!!user.departmentId && ticket.departmentId === user.departmentId))
  );
}
export async function canAccessTicket(user: User, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) return false;
  const [ticket] = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.id, id), ticketScope(user)))
    .limit(1);
  return !!ticket;
}
export async function ticketAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.params.ticketId === "bulk") return next();
  let id = Number(req.params.ticketId || req.params.id);
  if (req.baseUrl.includes("/attachments/")) {
    const [attachment] = await db
      .select({ ticketId: ticketAttachmentsTable.ticketId })
      .from(ticketAttachmentsTable)
      .where(eq(ticketAttachmentsTable.id, id))
      .limit(1);
    id = attachment?.ticketId ?? 0;
  }
  if (!req.user || !(await canAccessTicket(req.user, id))) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  const staff = await handlesTicket(req.user, id);
  if (
    !staff &&
    req.method !== "GET" &&
    !req.originalUrl.split("?")[0].endsWith("/comments") &&
    !(
      req.method === "POST" &&
      req.originalUrl.split("?")[0].endsWith("/attachments")
    )
  ) {
    res.status(403).json({ error: "Staff access required" });
    return;
  }
  next();
}
