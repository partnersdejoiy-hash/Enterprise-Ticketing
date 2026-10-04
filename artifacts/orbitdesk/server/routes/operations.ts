import { Router } from "express";
import {
  db,
  departmentsTable,
  ticketsTable,
  sql,
  and,
  eq,
  inArray,
  desc,
} from "@workspace/db";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import { ticketScope } from "../lib/ticket-access.js";
const router = Router();
router.get(
  "/operations",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const scope = ticketScope(req.user!);
    const [summary] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) FILTER(WHERE status NOT IN ('resolved','closed'))::int`,
        unassigned: sql<number>`count(*) FILTER(WHERE assignee_id IS NULL AND status NOT IN ('resolved','closed'))::int`,
        waiting: sql<number>`count(*) FILTER(WHERE status='waiting')::int`,
        resolved: sql<number>`count(*) FILTER(WHERE status IN ('resolved','closed'))::int`,
        overdue: sql<number>`count(*) FILTER(WHERE sla_deadline<now() AND status NOT IN ('resolved','closed'))::int`,
        website: sql<number>`count(*) FILTER(WHERE tags @> ARRAY['business-website']::text[])::int`,
        employment: sql<number>`count(*) FILTER(WHERE tags @> ARRAY['employment-verification']::text[] AND status NOT IN ('resolved','closed'))::int`,
        bgv: sql<number>`count(*) FILTER(WHERE tags @> ARRAY['bgv-request']::text[] AND status NOT IN ('resolved','closed'))::int`,
      })
      .from(ticketsTable)
      .where(scope);
    const recent = await db
      .select({
        id: ticketsTable.id,
        ticketNumber: ticketsTable.ticketNumber,
        subject: ticketsTable.subject,
        status: ticketsTable.status,
        priority: ticketsTable.priority,
        tags: ticketsTable.tags,
        createdAt: ticketsTable.createdAt,
        slaDeadline: ticketsTable.slaDeadline,
      })
      .from(ticketsTable)
      .where(scope)
      .orderBy(desc(ticketsTable.createdAt))
      .limit(8);
    const daily = await db
      .select({
        day: sql<string>`to_char(created_at,'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .where(and(scope, sql`created_at>=now()-interval '7 days'`))
      .groupBy(sql`to_char(created_at,'YYYY-MM-DD')`)
      .orderBy(sql`to_char(created_at,'YYYY-MM-DD')`);
    const departments = await db
      .select({
        id: ticketsTable.departmentId,
        name: departmentsTable.name,
        count: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .leftJoin(
        departmentsTable,
        eq(ticketsTable.departmentId, departmentsTable.id),
      )
      .where(scope)
      .groupBy(ticketsTable.departmentId, departmentsTable.name)
      .orderBy(departmentsTable.name);
    res.json({
      summary,
      recent,
      daily,
      departments,
      asOf: new Date().toISOString(),
    });
  },
);
export default router;
