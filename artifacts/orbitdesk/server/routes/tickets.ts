import { Router } from "express";
import { db, ticketsTable, usersTable, departmentsTable, commentsTable, ticketHistoryTable, rolePermissionsTable, eq, and, sql, ilike, inArray } from "@workspace/db";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";
import { sendTicketCreatedEmail, sendTicketStatusEmail, sendDocumentRequestEmail } from "../lib/emailService";
import { autoAssignForDepartment } from "../lib/autoAssign.js";

const router = Router();

function generateTicketNumber(): string {
  const prefix = "DJ";
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
    raisedForName: (ticket as any).raisedForName ?? null,
    raisedForEmail: (ticket as any).raisedForEmail ?? null,
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
    const userRole = req.user!.role as string;

    // Super admins always bypass permission checks
    if (userRole !== "super_admin") {
      const [rolePerm] = await db.select({ canCreateTicket: rolePermissionsTable.canCreateTicket })
        .from(rolePermissionsTable)
        .where(eq(rolePermissionsTable.role, userRole as any))
        .limit(1);

      if (rolePerm && !rolePerm.canCreateTicket) {
        res.status(403).json({ error: "Forbidden", message: "Your role does not have permission to create tickets" });
        return;
      }
    }

    const { subject, description, priority = "medium", assigneeId, tags = [], raisedForName, raisedForEmail } = req.body;
    let departmentId: number | undefined = req.body.departmentId;

    if (!subject || !description) {
      res.status(400).json({ error: "Bad Request", message: "Subject and description required" });
      return;
    }

    const createdById = req.user!.id;
    const ticketNumber = generateTicketNumber();

    // Auto-route to department based on tags and subject keywords if no department was specified
    if (!departmentId) {
      const allDepts = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable);
      const tagList: string[] = Array.isArray(tags) ? tags : [];
      const text = `${subject} ${description}`.toLowerCase();

      const itDept   = allDepts.find(d => /\bit\b|it support|information.?tech/i.test(d.name));
      const hrDept   = allDepts.find(d => /hr|human.?resource/i.test(d.name));
      const finDept  = allDepts.find(d => /financ|accounts/i.test(d.name));
      const legalDept= allDepts.find(d => /legal/i.test(d.name));
      const adminDept= allDepts.find(d => /\badmin\b/i.test(d.name));
      const bgvDept  = allDepts.find(d => /bgv|background.?verif/i.test(d.name));
      const opsDept  = allDepts.find(d => /operat/i.test(d.name));
      const csDept   = allDepts.find(d => /customer.?support|support.?team/i.test(d.name));

      let resolved: typeof itDept | undefined;

      // 1. Tag-based routing (highest priority)
      if (tagList.includes("password-reset"))                           resolved = itDept;
      else if (tagList.includes("wfh-request"))                        resolved = hrDept;
      else if (tagList.includes("document-request"))                   resolved = hrDept;
      else if (tagList.includes("bgv-request"))                        resolved = bgvDept;
      // 2. Subject/description keyword routing
      else if (/password|reset.*password|cannot.*login|account.*lock|vpn|laptop|computer|printer|software|hardware|network|wifi|wi-fi|it support|email.*setup|email.*access|system.*error|access.*denied|two.?factor|2fa|antivirus|malware|virus/.test(text)) resolved = itDept;
      else if (/wfh|work.?from.?home|work from home|leave|salary|payroll|attendance|appraisal|performance.?review|joining|onboarding|resignation|offer.?letter|increment|promotion|transfer|pf\b|epf|esic|health.?insurance|id.?card|employee.?id|document.?request/.test(text)) resolved = hrDept;
      else if (/bgv|background.?check|background.?verif|reference.?check/.test(text)) resolved = bgvDept;
      else if (/invoic|payment|reimburs|expense|budget|finance|tax|audit|accounts|petty.?cash|purchase.?order|vendor.?payment/.test(text)) resolved = finDept;
      else if (/legal|contract|nda|compliance|agreement|clause|policy.?review|litigation/.test(text)) resolved = legalDept;
      else if (/admin|office.?supply|stationary|stationery|pantry|housekeep|facility|parking|cab|transport|travel.?request|hotel.?booking|flight/.test(text)) resolved = adminDept;
      else if (/customer|client.?issue|client.?complaint|customer.?complaint|refund|escalation/.test(text)) resolved = csDept;
      else if (/operation|ops\b|process|workflow|sop|procedure/.test(text)) resolved = opsDept;

      if (resolved) departmentId = resolved.id;
    }

    let slaDeadline: Date | null = null;
    let deptName: string | undefined;
    if (departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, departmentId)).limit(1);
      if (dept) { slaDeadline = new Date(Date.now() + dept.slaResolutionHours * 3600 * 1000); deptName = dept.name; }
    }

    // Auto-assign to the department member with the fewest open tickets (round-robin by workload)
    let resolvedAssigneeId: number | null = assigneeId ?? null;
    if (!resolvedAssigneeId && departmentId) {
      resolvedAssigneeId = await autoAssignForDepartment(departmentId);
    }

    const status = resolvedAssigneeId ? "assigned" : "open";

    const [ticket] = await db.insert(ticketsTable).values({ ticketNumber, subject, description, priority, status, departmentId: departmentId ?? null, assigneeId: resolvedAssigneeId, createdById, tags, slaDeadline, raisedForName: raisedForName ?? null, raisedForEmail: raisedForEmail ?? null } as any).returning();

    await db.insert(ticketHistoryTable).values({ ticketId: ticket.id, action: "created", newValue: status, changedById: createdById });

    const usersMap = new Map<number, string>();
    const userIdsToFetch = [...new Set([createdById, resolvedAssigneeId].filter(Boolean) as number[])];
    const fetchedUsers = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIdsToFetch));
    for (const u of fetchedUsers) usersMap.set(u.id, u.name);
    const creator = fetchedUsers.find(u => u.id === createdById);

    const deptsMap = new Map<number, string>();
    if (departmentId && deptName) deptsMap.set(departmentId, deptName);

    const formatted = await formatTicket(ticket, usersMap, deptsMap);

    const isDocumentRequest = Array.isArray(tags) && tags.includes("document-request");

    if (isDocumentRequest && creator?.email) {
      sendDocumentRequestEmail({
        ticketNumber, subject, status,
        requesterEmail: creator.email,
        requesterName: creator.name ?? req.user!.name,
      }).catch(() => {});
    } else {
      sendTicketCreatedEmail({
        ticketNumber, subject, status, priority,
        departmentName: deptName,
        createdByName: creator?.name ?? req.user!.name,
        createdByEmail: creator?.email,
        raisedForName: raisedForName ?? undefined,
        raisedForEmail: raisedForEmail ?? undefined,
      }).catch(() => {});
    }

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
    const userRows = userIds.length > 0 ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
    const usersMap = new Map(userRows.map((u) => [u.id, u.name]));
    const deptsMap = new Map<number, string>();
    let deptName: string | undefined;
    if (updated.departmentId) {
      const [dept] = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(eq(departmentsTable.id, updated.departmentId)).limit(1);
      if (dept) { deptsMap.set(dept.id, dept.name); deptName = dept.name; }
    }

    const [commentRow] = await db.select({ count: sql<number>`count(*)::int` }).from(commentsTable).where(eq(commentsTable.ticketId, ticketId));
    const formatted = await formatTicket(updated, usersMap, deptsMap);
    formatted.commentCount = commentRow?.count ?? 0;

    const statusEntry = historyEntries.find((e) => e.action === "status_changed");
    if (statusEntry) {
      const creatorRow = userRows.find((u) => u.id === updated.createdById);
      sendTicketStatusEmail({
        ticketNumber: updated.ticketNumber,
        subject: updated.subject,
        oldStatus: statusEntry.oldValue ?? "",
        newStatus: statusEntry.newValue ?? "",
        priority: updated.priority,
        departmentName: deptName,
        changedByName: req.user!.name,
        createdByEmail: creatorRow?.email,
        raisedForEmail: (updated as any).raisedForEmail ?? undefined,
      }).catch(() => {});
    }

    res.json(formatted);
  } catch (err) {
    console.error("Update ticket error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/tickets/:ticketId", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const callerRole = req.user!.role;
    if (callerRole !== "super_admin" && callerRole !== "admin") {
      res.status(403).json({ error: "Forbidden", message: "Only Super Admins and Admins can delete tickets" });
      return;
    }
    const ticketId = parseInt(req.params.ticketId, 10);
    // Delete comments and history first
    await db.delete(commentsTable).where(eq(commentsTable.ticketId, ticketId));
    await db.delete(ticketHistoryTable).where(eq(ticketHistoryTable.ticketId, ticketId));
    const deleted = await db.delete(ticketsTable).where(eq(ticketsTable.id, ticketId)).returning();
    if (!deleted.length) { res.status(404).json({ error: "Not Found" }); return; }
    res.status(204).end();
  } catch (err) {
    console.error("Delete ticket error", err);
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
