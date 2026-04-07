import { Router } from "express";
import { db, ticketsTable, usersTable, departmentsTable, commentsTable, sql, eq, and, inArray } from "@workspace/db";
import { authMiddleware } from "../middlewares/auth.js";

const router = Router();

router.get("/dashboard/stats", authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalRow, openRow, inProgressRow, resolvedRow, closedRow, urgentRow, breachedRow, todayCreatedRow, todayResolvedRow] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.status, "open")),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.status, "in_progress")),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.status, "resolved")),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.status, "closed")),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.priority, "urgent")),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.slaBreached, true)),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(sql`${ticketsTable.createdAt} >= ${todayStart}`),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(and(eq(ticketsTable.status, "resolved"), sql`${ticketsTable.updatedAt} >= ${todayStart}`)),
    ]);

    const avgRow = await db.select({ avg: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${ticketsTable.updatedAt} - ${ticketsTable.createdAt})) / 3600), 0)::float` }).from(ticketsTable).where(eq(ticketsTable.status, "resolved"));

    res.json({
      totalTickets: totalRow[0]?.count ?? 0,
      openTickets: openRow[0]?.count ?? 0,
      inProgressTickets: inProgressRow[0]?.count ?? 0,
      resolvedTickets: resolvedRow[0]?.count ?? 0,
      closedTickets: closedRow[0]?.count ?? 0,
      urgentTickets: urgentRow[0]?.count ?? 0,
      slaBreachedTickets: breachedRow[0]?.count ?? 0,
      avgResolutionHours: Math.round((avgRow[0]?.avg ?? 0) * 10) / 10,
      ticketsCreatedToday: todayCreatedRow[0]?.count ?? 0,
      ticketsResolvedToday: todayResolvedRow[0]?.count ?? 0,
    });
  } catch (err) {
    console.error("Dashboard stats error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/dashboard/department-stats", authMiddleware, async (req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT d.id as department_id, d.name as department_name, d.color,
        COALESCE(SUM(CASE WHEN t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END),0)::int as open_count,
        COALESCE(SUM(CASE WHEN t.status='resolved' THEN 1 ELSE 0 END),0)::int as resolved_count,
        COALESCE(SUM(CASE WHEN t.sla_breached=true THEN 1 ELSE 0 END),0)::int as breached_count
      FROM departments d LEFT JOIN tickets t ON t.department_id=d.id
      GROUP BY d.id,d.name,d.color ORDER BY open_count DESC
    `);

    res.json((rows.rows as Array<{ department_id: number; department_name: string; color: string | null; open_count: number; resolved_count: number; breached_count: number }>).map((r) => ({
      departmentId: r.department_id,
      departmentName: r.department_name,
      openCount: r.open_count,
      resolvedCount: r.resolved_count,
      breachedCount: r.breached_count,
      color: r.color,
    })));
  } catch (err) {
    console.error("Department stats error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/dashboard/recent-tickets", authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? "10", 10), 50);
    const tickets = await db.select().from(ticketsTable).orderBy(sql`${ticketsTable.createdAt} DESC`).limit(limit);

    const userIds = [...new Set([...tickets.map((t) => t.createdById), ...tickets.filter((t) => t.assigneeId).map((t) => t.assigneeId!)])];
    const deptIds = [...new Set(tickets.filter((t) => t.departmentId).map((t) => t.departmentId!))];
    const ticketIds = tickets.map((t) => t.id);

    const [userRows, deptRows, commentRows] = await Promise.all([
      userIds.length > 0 ? db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds)) : [],
      deptIds.length > 0 ? db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(inArray(departmentsTable.id, deptIds)) : [],
      ticketIds.length > 0 ? db.select({ ticketId: commentsTable.ticketId, count: sql<number>`COUNT(*)::int` }).from(commentsTable).where(inArray(commentsTable.ticketId, ticketIds)).groupBy(commentsTable.ticketId) : [],
    ]);

    const usersMap = new Map(userRows.map((u) => [u.id, u.name]));
    const deptsMap = new Map(deptRows.map((d) => [d.id, d.name]));
    const commentMap = new Map(commentRows.map((c) => [c.ticketId, c.count]));

    res.json(tickets.map((t) => ({
      id: t.id, ticketNumber: t.ticketNumber, subject: t.subject, description: t.description,
      status: t.status, priority: t.priority, departmentId: t.departmentId,
      departmentName: t.departmentId ? deptsMap.get(t.departmentId) ?? null : null,
      assigneeId: t.assigneeId, assigneeName: t.assigneeId ? usersMap.get(t.assigneeId) ?? null : null,
      createdById: t.createdById, createdByName: usersMap.get(t.createdById) ?? "Unknown",
      tags: t.tags ?? [], slaBreached: t.slaBreached, slaDeadline: t.slaDeadline?.toISOString() ?? null,
      commentCount: commentMap.get(t.id) ?? 0, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
    })));
  } catch (err) {
    console.error("Recent tickets error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/dashboard/agent-performance", authMiddleware, async (req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT u.id as agent_id, u.name as agent_name, u.avatar,
        COALESCE(SUM(CASE WHEN t.status='resolved' THEN 1 ELSE 0 END),0)::int as resolved_count,
        COALESCE(AVG(CASE WHEN t.status='resolved' THEN EXTRACT(EPOCH FROM (t.updated_at-t.created_at))/3600 ELSE NULL END),0)::float as avg_resolution_hours,
        COALESCE(SUM(CASE WHEN t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END),0)::int as active_tickets
      FROM users u LEFT JOIN tickets t ON t.assignee_id=u.id
      WHERE u.role IN ('agent','manager') AND u.is_active=true
      GROUP BY u.id,u.name,u.avatar ORDER BY resolved_count DESC LIMIT 10
    `);

    res.json((rows.rows as Array<{ agent_id: number; agent_name: string; avatar: string | null; resolved_count: number; avg_resolution_hours: number; active_tickets: number }>).map((r) => ({
      agentId: r.agent_id, agentName: r.agent_name, avatar: r.avatar,
      resolvedCount: r.resolved_count, avgResolutionHours: Math.round(r.avg_resolution_hours * 10) / 10,
      activeTickets: r.active_tickets, satisfactionScore: null,
    })));
  } catch (err) {
    console.error("Agent performance error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/dashboard/sla-overview", authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const atRiskThreshold = new Date(now.getTime() + 4 * 3600 * 1000);

    const [[totalRow], [compliantRow], [breachedRow], [atRiskRow]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(sql`${ticketsTable.slaDeadline} IS NOT NULL`),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(and(sql`${ticketsTable.slaDeadline} IS NOT NULL`, eq(ticketsTable.slaBreached, false))),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.slaBreached, true)),
      db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(and(sql`${ticketsTable.slaDeadline} IS NOT NULL`, eq(ticketsTable.slaBreached, false), sql`${ticketsTable.slaDeadline} <= ${atRiskThreshold}`, sql`${ticketsTable.status} NOT IN ('resolved','closed')`)),
    ]);

    const total = totalRow?.count ?? 0;
    const compliant = compliantRow?.count ?? 0;

    res.json({ totalWithSla: total, compliant, breached: breachedRow?.count ?? 0, atRisk: atRiskRow?.count ?? 0, complianceRate: total > 0 ? Math.round((compliant / total) * 1000) / 10 : 100 });
  } catch (err) {
    console.error("SLA overview error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
