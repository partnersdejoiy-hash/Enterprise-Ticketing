import { Router } from "express";
import { db, ticketsTable, usersTable, departmentsTable, commentsTable, ticketHistoryTable, eq, and, sql, ilike, inArray } from "@workspace/db";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";

const router = Router();

function generateTicketNumber(): string {
  const prefix = "TKT";
  const num = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}-${num}`;
}

async function formatTicket(ticket: typeof ticketsTable.$inferSelect, users: Map<number, string>, depts: Map<number, string>) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    departmentId: ticket.departmentId,
    departmentName: ticket.departmentId ? (depts.get(ticket.departmentId) ?? null) : null,
    assigneeId: ticket.assigneeId,
    assigneeName: ticket.assigneeId ? (users.get(ticket.assigneeId) ?? null) : null,
    createdById: ticket.createdById,
    createdByName: users.get(ticket.createdById) ?? "Unknown",
    tags: ticket.tags ?? [],
    slaBreached: ticket.slaBreached,
    slaDeadline: ticket.slaDeadline?.toISOString() ?? null,
    commentCount: 0,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

router.get("/tickets", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, priority, departmentId, assigneeId, search, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = Math.min(parseInt(limit as string, 10), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];

    if (req.user?.role === "employee") {
      conditions.push(eq(ticketsTable.createdById, req.user.id));
    } else if (req.user?.role === "agent") {
      if (req.user.departmentId) {
        conditions.push(eq(ticketsTable.departmentId, req.user.departmentId));
      }
    }

    if (status) conditions.push(eq(ticketsTable.status, status as string));
    if (priority) conditions.push(eq(ticketsTable.priority, priority as string));
    if (departmentId) conditions.push(eq(ticketsTable.departmentId, parseInt(departmentId as string, 10)));
    if (assigneeId) conditions.push(eq(ticketsTable.assigneeId, parseInt(assigneeId as string, 10)));
    if (search) conditions.push(ilike(ticketsTable.subject, `%${search}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(whereClause);
    const total = countRow?.count ?? 0;

    const tickets = await db.select().from(ticketsTable).where(whereClause).orderBy(sql`${ticketsTable.createdAt} DESC`).limit(limitNum).offset(offset);

    const userIds = [...new Set([...tickets.map((t) => t.createdById), ...tickets.filter((t) => t.assigneeId).map((t) => t.assigneeId!)])];
    const deptIds = [...new Set(tickets.filter((t) => t.departmentId).map((t) => t.departmentId!))];

    const [userRows, deptRows, commentCounts] = await Promise.all([
      userIds.length > 0 ? db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds)) : [],
      deptIds.length > 0 ? db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(inArray(departmentsTable.id, deptIds)) : [],
      tickets.length > 0 ? db.select({ ticketId: commentsTable.ticketId, count: sql<number>`count(*)::int` }).from(commentsTable).where(inArray(commentsTable.ticketId, tickets.map((t) => t.id))).groupBy(commentsTable.ticketId) : [],
    ]);

    const usersMap = new Map(userRows.map((u) => [u.id, u.name]));
    const deptsMap = new Map(deptRows.map((d) => [d.id, d.name]));
    const commentMap = new Map(commentCounts.map((c) => [c.ticketId, c.count]));

    const formattedTickets = await Promise.all(tickets.map(async (t) => {
      const formatted = await formatTicket(t, usersMap, deptsMap);
      formatted.commentCount = commentMap.get(t.id) ?? 0;
      return formatted;
    }));

    res.json({ tickets: formattedTickets, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) {
    console.error("List tickets error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/tickets", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { subject, description, priority = "medium", departmentId, assigneeId, tags = [] } = req.body;

    if (!subject || !description) {
      res.status(400).json({ error: "Bad Request", message: "Subject and description required" });
      return;
    }

    const createdById = req.user!.id;
    const ticketNumber = generateTicketNumber();

    let slaDeadline: Date | null = null;
    if (departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, departmentId)).limit(1);
      if (dept) slaDeadline = new Date(Date.now() + dept.slaResolutionHours * 3600 * 1000);
    }

    const status = assigneeId ? "assigned" : "open";

    const [ticket] = await db.insert(ticketsTable).values({ ticketNumber, subject, description, priority, status, departmentId: departmentId ?? null, assigneeId: assigneeId ?? null, createdById, tags, slaDeadline }).returning();

    await db.insert(ticketHistoryTable).values({ ticketId: ticket.id, action: "created", newValue: "open", changedById: createdById });

    const usersMap = new Map<number, string>();
    const [creator] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, createdById)).limit(1);
    if (creator) usersMap.set(creator.id, creator.name);

    const deptsMap = new Map<number, string>();
    if (departmentId) {
      const [dept] = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(eq(departmentsTable.id, departmentId)).limit(1);
      if (dept) deptsMap.set(dept.id, dept.name);
    }

    const formatted = await formatTicket(ticket, usersMap, deptsMap);
    res.status(201).json(formatted);
  } catch (err) {
    console.error("Create ticket error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/tickets/:ticketId", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);

    if (!ticket) { res.status(404).json({ error: "Not Found" }); return; }

    const userIds = [ticket.createdById, ticket.assigneeId].filter(Boolean) as number[];
    const userRows = userIds.length > 0 ? await db.select({ id: usersTable.id, name: usersTable.name, avatar: usersTable.avatar }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
    const usersMap = new Map(userRows.map((u) => [u.id, u.name]));
    const usersAvatarMap = new Map(userRows.map((u) => [u.id, u.avatar]));

    const deptsMap = new Map<number, string>();
    if (ticket.departmentId) {
      const [dept] = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(eq(departmentsTable.id, ticket.departmentId)).limit(1);
      if (dept) deptsMap.set(dept.id, dept.name);
    }

    const [comments, history, [commentCountRow]] = await Promise.all([
      db.select().from(commentsTable).where(eq(commentsTable.ticketId, ticketId)).orderBy(commentsTable.createdAt),
      db.select().from(ticketHistoryTable).where(eq(ticketHistoryTable.ticketId, ticketId)).orderBy(ticketHistoryTable.createdAt),
      db.select({ count: sql<number>`count(*)::int` }).from(commentsTable).where(eq(commentsTable.ticketId, ticketId)),
    ]);

    const allIds = [...new Set([...comments.map((c) => c.authorId), ...history.map((h) => h.changedById)])].filter((id) => !usersMap.has(id));
    if (allIds.length > 0) {
      const moreUsers = await db.select({ id: usersTable.id, name: usersTable.name, avatar: usersTable.avatar }).from(usersTable).where(inArray(usersTable.id, allIds));
      moreUsers.forEach((u) => { usersMap.set(u.id, u.name); usersAvatarMap.set(u.id, u.avatar); });
    }

    const formatted = await formatTicket(ticket, usersMap, deptsMap);
    formatted.commentCount = commentCountRow?.count ?? 0;

    res.json({
      ...formatted,
      comments: comments.map((c) => ({ id: c.id, ticketId: c.ticketId, content: c.content, isInternal: c.isInternal, authorId: c.authorId, authorName: usersMap.get(c.authorId) ?? "Unknown", authorAvatar: usersAvatarMap.get(c.authorId) ?? null, createdAt: c.createdAt.toISOString() })),
      history: history.map((h) => ({ id: h.id, ticketId: h.ticketId, action: h.action, oldValue: h.oldValue, newValue: h.newValue, changedById: h.changedById, changedByName: usersMap.get(h.changedById) ?? "Unknown", createdAt: h.createdAt.toISOString() })),
    });
  } catch (err) {
    console.error("Get ticket error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/tickets/:ticketId", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    const { subject, description, status, priority, departmentId, assigneeId, tags } = req.body;

    const [existing] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not Found" }); return; }

    const updates: Partial<typeof ticketsTable.$inferInsert> = {};
    const historyEntries: Array<{ action: string; oldValue: string | null; newValue: string | null }> = [];

    if (subject !== undefined) updates.subject = subject;
    if (description !== undefined) updates.description = description;
    if (status !== undefined && status !== existing.status) {
      historyEntries.push({ action: "status_changed", oldValue: existing.status, newValue: status });
      updates.status = status;
    }
    if (priority !== undefined && priority !== existing.priority) {
      historyEntries.push({ action: "priority_changed", oldValue: existing.priority, newValue: priority });
      updates.priority = priority;
    }
    if (departmentId !== undefined) updates.departmentId = departmentId;
    if (assigneeId !== undefined) {
      if (assigneeId !== existing.assigneeId) {
        historyEntries.push({ action: "assignee_changed", oldValue: String(existing.assigneeId), newValue: String(assigneeId) });
        if (updates.status === undefined && existing.status === "open") updates.status = "assigned";
      }
      updates.assigneeId = assigneeId;
    }
    if (tags !== undefined) updates.tags = tags;

    const [updated] = await db.update(ticketsTable).set({ ...updates, updatedAt: new Date() }).where(eq(ticketsTable.id, ticketId)).returning();

    const changedById = req.user!.id;
    if (historyEntries.length > 0) {
      await Promise.all(historyEntries.map((entry) => db.insert(ticketHistoryTable).values({ ticketId, changedById, ...entry })));
    }

    const userIds = [updated.createdById, updated.assigneeId].filter(Boolean) as number[];
    const userRows = userIds.length > 0 ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
    const usersMap = new Map(userRows.map((u) => [u.id, u.name]));
    const deptsMap = new Map<number, string>();
    if (updated.departmentId) {
      const [dept] = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(eq(departmentsTable.id, updated.departmentId)).limit(1);
      if (dept) deptsMap.set(dept.id, dept.name);
    }

    const [commentRow] = await db.select({ count: sql<number>`count(*)::int` }).from(commentsTable).where(eq(commentsTable.ticketId, ticketId));
    const formatted = await formatTicket(updated, usersMap, deptsMap);
    formatted.commentCount = commentRow?.count ?? 0;

    res.json(formatted);
  } catch (err) {
    console.error("Update ticket error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/tickets/:ticketId/comments", authMiddleware, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    const comments = await db.select().from(commentsTable).where(eq(commentsTable.ticketId, ticketId)).orderBy(commentsTable.createdAt);

    const authorIds = [...new Set(comments.map((c) => c.authorId))];
    const authorRows = authorIds.length > 0 ? await db.select({ id: usersTable.id, name: usersTable.name, avatar: usersTable.avatar }).from(usersTable).where(inArray(usersTable.id, authorIds)) : [];
    const authorsMap = new Map(authorRows.map((u) => [u.id, u]));

    res.json(comments.map((c) => ({ id: c.id, ticketId: c.ticketId, content: c.content, isInternal: c.isInternal, authorId: c.authorId, authorName: authorsMap.get(c.authorId)?.name ?? "Unknown", authorAvatar: authorsMap.get(c.authorId)?.avatar ?? null, createdAt: c.createdAt.toISOString() })));
  } catch (err) {
    console.error("List comments error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/tickets/:ticketId/comments", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId, 10);
    const { content, isInternal = false } = req.body;

    if (!content) { res.status(400).json({ error: "Bad Request", message: "Content required" }); return; }

    const authorId = req.user!.id;
    const [comment] = await db.insert(commentsTable).values({ ticketId, content, isInternal, authorId }).returning();

    await db.update(ticketsTable).set({ updatedAt: new Date() }).where(eq(ticketsTable.id, ticketId));

    res.status(201).json({ id: comment.id, ticketId: comment.ticketId, content: comment.content, isInternal: comment.isInternal, authorId: comment.authorId, authorName: req.user!.name, authorAvatar: req.user!.avatar ?? null, createdAt: comment.createdAt.toISOString() });
  } catch (err) {
    console.error("Create comment error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/tickets/bulk", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { rows } = req.body as { rows: Array<Record<string, string>> };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Bad Request", message: "rows array required" });
      return;
    }

    const departments = await db.select().from(departmentsTable);
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));
    const users = await db.select().from(usersTable);
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

    const created: number[] = [];
    const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const subject = row.subject?.trim();
      if (!subject) { errors.push({ row: i + 1, error: "subject is required" }); continue; }

      const priority = (["low", "medium", "high", "urgent"].includes(row.priority?.trim().toLowerCase()) ? row.priority.trim().toLowerCase() : "medium") as "low" | "medium" | "high" | "urgent";
      const status = (["open", "in_progress", "pending", "resolved", "closed"].includes(row.status?.trim().toLowerCase()) ? row.status.trim().toLowerCase() : "open") as "open" | "in_progress" | "pending" | "resolved" | "closed";

      let departmentId: number | null = null;
      if (row.department_name?.trim()) {
        const dept = deptByName.get(row.department_name.trim().toLowerCase());
        if (dept) departmentId = dept.id;
        else { errors.push({ row: i + 1, error: `Department "${row.department_name}" not found` }); continue; }
      }

      let assigneeId: number | null = null;
      if (row.assignee_email?.trim()) {
        const u = userByEmail.get(row.assignee_email.trim().toLowerCase());
        if (u) assigneeId = u.id;
      }

      const tags = row.tags ? row.tags.split("|").map((t) => t.trim()).filter(Boolean) : [];
      const ticketNumber = generateTicketNumber();

      try {
        const [ticket] = await db.insert(ticketsTable).values({
          ticketNumber, subject, description: row.description?.trim() ?? "",
          priority, status, departmentId, assigneeId,
          createdById: req.user!.id, tags,
        }).returning();
        created.push(ticket.id);
      } catch (e) {
        errors.push({ row: i + 1, error: "Insert failed" });
      }
    }

    res.status(201).json({ created: created.length, errors });
  } catch (err) {
    console.error("Bulk create tickets error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
