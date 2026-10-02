import { notifyTicket } from "../lib/ticket-notifications.js";
import { classifyTeam } from "../lib/team-classifier.js";
import {
  autoAssignTicket,
  refillDepartmentQueue,
} from "../lib/agentAssignment.js";
import { getRoutingSettings } from "../lib/workspace-settings.js";
import { runAutomations } from "../lib/automation.js";
import { allowed } from "../lib/permissions.js";
import { Router } from "express";
import {
  db,
  pool,
  ticketsTable,
  usersTable,
  departmentsTable,
  commentsTable,
  ticketHistoryTable,
  rolePermissionsTable,
  eq,
  and,
  sql,
  ilike,
  inArray,
  or,
} from "@workspace/db";
import {
  authMiddleware,
  AuthenticatedRequest,
  requireAdmin,
} from "../middlewares/auth.js";
import {
  sendTicketCreatedEmail,
  sendTicketStatusEmail,
  sendDocumentRequestEmail,
} from "../lib/emailService";

import {
  ticketScope,
  ticketAccess,
  handlesTicket,
} from "../lib/ticket-access.js";
import { randomBytes } from "node:crypto";
const router = Router();
router.use(
  "/tickets/bulk",
  authMiddleware,
  requireAdmin,
  async (req: AuthenticatedRequest, res, next) => {
    if (!(await allowed(req.user!, "canBulkUpload"))) {
      res.status(403).json({ error: "Bulk upload is disabled for your role" });
      return;
    }
    next();
  },
);
router.use("/tickets/:ticketId", authMiddleware, ticketAccess);

async function validParticipants(raisedFor: unknown, tagged: unknown) {
  if (
    raisedFor !== null &&
    (!Number.isSafeInteger(raisedFor) || Number(raisedFor) < 1)
  )
    return false;
  if (
    !Array.isArray(tagged) ||
    tagged.length > 30 ||
    tagged.some((id) => !Number.isSafeInteger(id) || id < 1)
  )
    return false;
  const ids = [
    ...new Set(
      [raisedFor, ...tagged].filter(
        (id): id is number => typeof id === "number",
      ),
    ),
  ];
  if (!ids.length) return true;
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.id, ids),
        eq(usersTable.isActive, true),
        sql`${usersTable.role}<>'external'`,
      ),
    );
  return users.length === ids.length;
}
async function validAssignee(id: number, departmentId: number | null) {
  if (!Number.isSafeInteger(id) || !departmentId) return false;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return (
    !!u &&
    u.isActive &&
    u.departmentId === departmentId &&
    ["agent", "manager", "admin", "super_admin"].includes(u.role)
  );
}

function generateTicketNumber(): string {
  const prefix = "DJ";
  const num = randomBytes(8).toString("hex").toUpperCase();
  return `${prefix}-${num}`;
}

async function aiWorkerNameMap(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  const { rows } = await pool.query(
    `SELECT id, name FROM orbit_ai_workers WHERE id = ANY($1)`,
    [unique],
  );
  for (const r of rows) {
    map.set(Number(r.id), String(r.name ?? "").trim() || "AI agent");
  }
  return map;
}

async function formatTicket(
  ticket: typeof ticketsTable.$inferSelect,
  users: Map<number, string>,
  depts: Map<number, string>,
  workers?: Map<number, string>,
) {
  const aiWorkerName = (ticket as any).assignedAiWorkerId
    ? (workers?.get((ticket as any).assignedAiWorkerId) ?? "AI agent")
    : null;
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    departmentId: ticket.departmentId,
    departmentName: ticket.departmentId
      ? (depts.get(ticket.departmentId) ?? null)
      : null,
    assigneeId: ticket.assigneeId,
    assigneeName: aiWorkerName
      ? `${aiWorkerName} (AI)`
      : ticket.assigneeId
        ? (users.get(ticket.assigneeId) ?? null)
        : null,
    assignedAiWorkerId: (ticket as any).assignedAiWorkerId ?? null,
    createdById: ticket.createdById,
    createdByName:
      ticket.createdById === 0
        ? "Business website"
        : (users.get(ticket.createdById) ?? "Unknown"),
    raisedForUserId: ticket.raisedForUserId,
    taggedUserIds: ticket.taggedUserIds,
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

router.get(
  "/tickets",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const {
        status,
        priority,
        departmentId,
        assigneeId,
        search,
        page = "1",
        limit = "20",
      } = req.query;
      const pageNum = Math.max(1, Math.min(Number(page) || 1, 100000));
      const limitNum = Math.max(1, Math.min(Number(limit) || 20, 100));
      const offset = (pageNum - 1) * limitNum;

      const conditions = [ticketScope(req.user!)];
      if (req.query.unassignedDepartment === "true")
        conditions.push(sql`${ticketsTable.departmentId} IS NULL`);
      if (req.query.view === "mine")
        conditions.push(eq(ticketsTable.createdById, req.user!.id));
      const tag = req.query.tags;
      if (tag && (typeof tag !== "string" || tag.length > 80)) {
        res.status(400).json({ error: "Invalid queue" });
        return;
      }
      if (tag)
        conditions.push(sql`${ticketsTable.tags} @> ARRAY[${tag}]::text[]`);
      if (
        status &&
        ![
          "open",
          "assigned",
          "in_progress",
          "waiting",
          "resolved",
          "closed",
        ].includes(String(status))
      ) {
        res.status(400).json({ error: "Invalid status" });
        return;
      }
      if (
        priority &&
        !["low", "medium", "high", "urgent"].includes(String(priority))
      ) {
        res.status(400).json({ error: "Invalid priority" });
        return;
      }
      if (status)
        conditions.push(
          eq(
            ticketsTable.status,
            status as typeof ticketsTable.$inferSelect.status,
          ),
        );
      if (priority)
        conditions.push(
          eq(
            ticketsTable.priority,
            priority as typeof ticketsTable.$inferSelect.priority,
          ),
        );
      if (departmentId)
        conditions.push(
          eq(ticketsTable.departmentId, parseInt(departmentId as string, 10)),
        );
      if (assigneeId)
        conditions.push(
          eq(ticketsTable.assigneeId, parseInt(assigneeId as string, 10)),
        );
      if (search)
        conditions.push(
          or(
            ilike(ticketsTable.subject, `%${String(search).slice(0, 150)}%`),
            ilike(
              ticketsTable.ticketNumber,
              `%${String(search).slice(0, 150)}%`,
            ),
            ilike(
              ticketsTable.raisedForName,
              `%${String(search).slice(0, 150)}%`,
            ),
          )!,
        );

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketsTable)
        .where(whereClause);
      const total = countRow?.count ?? 0;

      const tickets = await db
        .select()
        .from(ticketsTable)
        .where(whereClause)
        .orderBy(sql`${ticketsTable.createdAt} DESC`)
        .limit(limitNum)
        .offset(offset);

      const userIds = [
        ...new Set([
          ...tickets.map((t) => t.createdById),
          ...tickets.filter((t) => t.assigneeId).map((t) => t.assigneeId!),
        ]),
      ];
      const deptIds = [
        ...new Set(
          tickets.filter((t) => t.departmentId).map((t) => t.departmentId!),
        ),
      ];

      const [userRows, deptRows, commentCounts] = await Promise.all([
        userIds.length > 0
          ? db
              .select({ id: usersTable.id, name: usersTable.name })
              .from(usersTable)
              .where(inArray(usersTable.id, userIds))
          : [],
        deptIds.length > 0
          ? db
              .select({ id: departmentsTable.id, name: departmentsTable.name })
              .from(departmentsTable)
              .where(inArray(departmentsTable.id, deptIds))
          : [],
        tickets.length > 0
          ? db
              .select({
                ticketId: commentsTable.ticketId,
                count: sql<number>`count(*)::int`,
              })
              .from(commentsTable)
              .where(
                inArray(
                  commentsTable.ticketId,
                  tickets.map((t) => t.id),
                ),
              )
              .groupBy(commentsTable.ticketId)
          : [],
      ]);

      const usersMap = new Map(userRows.map((u) => [u.id, u.name]));
      const deptsMap = new Map(deptRows.map((d) => [d.id, d.name]));
      const commentMap = new Map(
        commentCounts.map((c) => [c.ticketId, c.count]),
      );
      const workersMap = await aiWorkerNameMap(
        tickets.map((t) => (t as any).assignedAiWorkerId),
      );

      const formattedTickets = await Promise.all(
        tickets.map(async (t) => {
          const formatted = await formatTicket(
            t,
            usersMap,
            deptsMap,
            workersMap,
          );
          formatted.commentCount = commentMap.get(t.id) ?? 0;
          return formatted;
        }),
      );

      res.json({
        tickets: formattedTickets,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (err) {
      console.error("List tickets error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.post(
  "/tickets",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userRole = req.user!.role as string;

      // Super admins always bypass permission checks
      if (userRole !== "super_admin") {
        const [rolePerm] = await db
          .select({ canCreateTicket: rolePermissionsTable.canCreateTicket })
          .from(rolePermissionsTable)
          .where(eq(rolePermissionsTable.role, userRole as any))
          .limit(1);

        if (rolePerm && !rolePerm.canCreateTicket) {
          res.status(403).json({
            error: "Forbidden",
            message: "Your role does not have permission to create tickets",
          });
          return;
        }
      }

      const {
        subject,
        description,
        priority = "medium",
        assigneeId,
        tags = [],
        raisedForName,
        raisedForEmail,
        ccEmails = [],
      } = req.body;
      let departmentId: number | undefined = req.body.departmentId;

      if (
        typeof subject !== "string" ||
        typeof description !== "string" ||
        !subject.trim() ||
        !description.trim() ||
        subject.length > 250 ||
        description.length > 12000 ||
        !["low", "medium", "high", "urgent"].includes(priority) ||
        !Array.isArray(tags) ||
        tags.length > 20 ||
        tags.some((t: any) => typeof t !== "string" || t.length > 80)
      ) {
        res.status(400).json({
          error: "Bad Request",
          message: "Subject and description required",
        });
        return;
      }

      const { raisedForUserId = null, taggedUserIds = [] } = req.body;
      if (
        req.user!.role === "external" &&
        (raisedForUserId || taggedUserIds.length)
      ) {
        res
          .status(403)
          .json({ error: "External accounts cannot link employees" });
        return;
      }
      if (!(await validParticipants(raisedForUserId, taggedUserIds))) {
        res
          .status(400)
          .json({ error: "Select active employees from the directory" });
        return;
      }
      if (
        tags.some((t: string) =>
          ["business-website", "authorisation-review-required"].includes(t),
        )
      ) {
        res.status(400).json({ error: "Reserved source tags" });
        return;
      }
      if (assigneeId && !(await allowed(req.user!, "canAssignTickets"))) {
        res.status(403).json({ error: "Your role cannot assign tickets" });
        return;
      }
      if (
        assigneeId &&
        !["admin", "super_admin", "manager"].includes(req.user!.role)
      ) {
        res
          .status(403)
          .json({ error: "Assignment requires a manager or administrator" });
        return;
      }
      const createdById = req.user!.id;
      const ticketNumber = generateTicketNumber();

      // Structured verification type outranks the local text classifier.
      if (!departmentId) {
        const routing = await getRoutingSettings();
        if (
          tags.includes("bgv-request") ||
          tags.includes("background-verification")
        )
          departmentId = routing.bgvDepartmentId ?? undefined;
        else if (tags.includes("employment-verification"))
          departmentId = routing.employmentDepartmentId ?? undefined;
        else {
          const teams = await db.select().from(departmentsTable);
          departmentId =
            classifyTeam(`${subject} ${description}`, teams).departmentId ??
            undefined;
        }
      }

      // SLA and explicit assignment are validated before the event engine runs.
      let slaDeadline: Date | null = null;
      let deptName: string | undefined;
      if (departmentId) {
        const [dept] = await db
          .select()
          .from(departmentsTable)
          .where(eq(departmentsTable.id, departmentId))
          .limit(1);
        if (dept) {
          slaDeadline = new Date(
            Date.now() + dept.slaResolutionHours * 3600 * 1000,
          );
          deptName = dept.name;
        }
      }

      // Automatic assignment runs transactionally after the ticket is saved.
      let resolvedAssigneeId: number | null = assigneeId ?? null;

      if (
        departmentId &&
        !(
          await db
            .select({ id: departmentsTable.id })
            .from(departmentsTable)
            .where(eq(departmentsTable.id, departmentId))
        ).length
      ) {
        res.status(400).json({ error: "Invalid department" });
        return;
      }
      if (
        resolvedAssigneeId &&
        !(await validAssignee(resolvedAssigneeId, departmentId ?? null))
      ) {
        res.status(400).json({
          error: "Assign an active handling agent in the selected department",
        });
        return;
      }
      const status = resolvedAssigneeId ? "assigned" : "open";

      const [ticket] = await db
        .insert(ticketsTable)
        .values({
          ticketNumber,
          subject,
          description,
          priority,
          status,
          departmentId: departmentId ?? null,
          assigneeId: resolvedAssigneeId,
          createdById,
          raisedForUserId,
          taggedUserIds,
          tags,
          slaDeadline,
          raisedForName: raisedForName ?? null,
          raisedForEmail: raisedForEmail ?? null,
          ccEmails: Array.isArray(ccEmails) ? ccEmails : [],
        } as any)
        .returning();

      await db.insert(ticketHistoryTable).values({
        ticketId: ticket.id,
        action: "created",
        newValue: status,
        changedById: createdById,
      });

      // Unified auto-assignment: least-loaded agent/AI worker in the
      // department, hard-capped at 3 active tickets each.
      if (!resolvedAssigneeId && departmentId) {
        const assignment = await autoAssignTicket(
          ticket.id,
          departmentId,
          createdById,
        );
        if (assignment.kind === "human") {
          ticket.assigneeId = assignment.id;
          ticket.status = "assigned";
        } else if (assignment.kind === "ai") {
          ticket.assigneeId = null;
          (ticket as any).assignedAiWorkerId = assignment.id;
          ticket.status = "assigned";
        }
      }

      Object.assign(
        ticket,
        (await runAutomations(ticket.id, ["ticket_created"])) || {},
      );
      const usersMap = new Map<number, string>();
      const userIdsToFetch = [
        ...new Set(
          [createdById, ticket.assigneeId].filter(Boolean) as number[],
        ),
      ];
      const fetchedUsers = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, userIdsToFetch));
      for (const u of fetchedUsers) usersMap.set(u.id, u.name);
      const creator = fetchedUsers.find((u) => u.id === createdById);

      const deptsMap = new Map<number, string>();
      if (departmentId && deptName) deptsMap.set(departmentId, deptName);

      const workersMap = await aiWorkerNameMap([
        (ticket as any).assignedAiWorkerId,
      ]);
      const formatted = await formatTicket(
        ticket,
        usersMap,
        deptsMap,
        workersMap,
      );

      const isDocumentRequest =
        Array.isArray(tags) && tags.includes("document-request");

      if (isDocumentRequest && creator?.email) {
        sendDocumentRequestEmail({
          ticketNumber,
          subject,
          status,
          requesterEmail: creator.email,
          requesterName: creator.name ?? req.user!.name,
        }).catch(() => {});
      } else {
        sendTicketCreatedEmail({
          ticketNumber,
          subject,
          status,
          priority,
          departmentName: deptName,
          createdByName: creator?.name ?? req.user!.name,
          createdByEmail: creator?.email,
          raisedForName: raisedForName ?? undefined,
          raisedForEmail: raisedForEmail ?? undefined,
          ccEmails: Array.isArray(ccEmails) ? ccEmails : [],
        }).catch(() => {});
      }

      res.status(201).json(formatted);
    } catch (err) {
      console.error("Create ticket error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.get(
  "/tickets/:ticketId",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const ticketId = parseInt(String(req.params.ticketId), 10);
      const [ticket] = await db
        .select()
        .from(ticketsTable)
        .where(eq(ticketsTable.id, ticketId))
        .limit(1);

      if (!ticket) {
        res.status(404).json({ error: "Not Found" });
        return;
      }

      const userIds = [ticket.createdById, ticket.assigneeId].filter(
        Boolean,
      ) as number[];
      const userRows =
        userIds.length > 0
          ? await db
              .select({
                id: usersTable.id,
                name: usersTable.name,
                avatar: usersTable.avatar,
              })
              .from(usersTable)
              .where(inArray(usersTable.id, userIds))
          : [];
      const usersMap = new Map(userRows.map((u) => [u.id, u.name]));
      const usersAvatarMap = new Map(userRows.map((u) => [u.id, u.avatar]));

      const deptsMap = new Map<number, string>();
      if (ticket.departmentId) {
        const [dept] = await db
          .select({ id: departmentsTable.id, name: departmentsTable.name })
          .from(departmentsTable)
          .where(eq(departmentsTable.id, ticket.departmentId))
          .limit(1);
        if (dept) deptsMap.set(dept.id, dept.name);
      }

      const [comments, history, [commentCountRow]] = await Promise.all([
        db
          .select()
          .from(commentsTable)
          .where(eq(commentsTable.ticketId, ticketId))
          .orderBy(commentsTable.createdAt),
        db
          .select()
          .from(ticketHistoryTable)
          .where(eq(ticketHistoryTable.ticketId, ticketId))
          .orderBy(ticketHistoryTable.createdAt),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(commentsTable)
          .where(eq(commentsTable.ticketId, ticketId)),
      ]);

      const allIds = [
        ...new Set([
          ...comments.map((c) => c.authorId),
          ...history.map((h) => h.changedById),
        ]),
      ].filter((id) => !usersMap.has(id));
      if (allIds.length > 0) {
        const moreUsers = await db
          .select({
            id: usersTable.id,
            name: usersTable.name,
            avatar: usersTable.avatar,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, allIds));
        moreUsers.forEach((u) => {
          usersMap.set(u.id, u.name);
          usersAvatarMap.set(u.id, u.avatar);
        });
      }

      const canHandle = await handlesTicket(req.user!, ticketId);
      const workersMap = await aiWorkerNameMap([
        (ticket as any).assignedAiWorkerId,
      ]);
      const formatted = await formatTicket(
        ticket,
        usersMap,
        deptsMap,
        workersMap,
      );
      formatted.commentCount = commentCountRow?.count ?? 0;

      res.json({
        ...formatted,
        comments: comments
          .filter((c) => !c.isInternal || canHandle)
          .map((c) => ({
            id: c.id,
            ticketId: c.ticketId,
            content: c.content,
            isInternal: c.isInternal,
            authorId: c.authorId,
            authorName: usersMap.get(c.authorId) ?? "Unknown",
            authorAvatar: usersAvatarMap.get(c.authorId) ?? null,
            createdAt: c.createdAt.toISOString(),
          })),
        history: history.map((h) => ({
          id: h.id,
          ticketId: h.ticketId,
          action: h.action,
          oldValue: h.oldValue,
          newValue: h.newValue,
          changedById: h.changedById,
          changedByName:
            h.changedById === 0
              ? "Business website"
              : (usersMap.get(h.changedById) ?? "Unknown"),
          createdAt: h.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      console.error("Get ticket error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.patch(
  "/tickets/:ticketId",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const ticketId = parseInt(String(req.params.ticketId), 10);
      const {
        subject,
        description,
        status,
        priority,
        departmentId,
        assigneeId,
        tags,
        raisedForUserId,
        taggedUserIds,
      } = req.body;

      const [existing] = await db
        .select()
        .from(ticketsTable)
        .where(eq(ticketsTable.id, ticketId))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Not Found" });
        return;
      }

      if (
        !["super_admin", "admin"].includes(req.user!.role) &&
        (departmentId !== undefined ||
          (assigneeId !== undefined && req.user!.role !== "manager") ||
          tags !== undefined)
      ) {
        res.status(403).json({
          error: "Only administrators can change routing and classification",
        });
        return;
      }
      if (
        (status !== undefined &&
          ![
            "open",
            "assigned",
            "in_progress",
            "waiting",
            "resolved",
            "closed",
          ].includes(status)) ||
        (priority !== undefined &&
          !["low", "medium", "high", "urgent"].includes(priority)) ||
        (subject !== undefined &&
          (typeof subject !== "string" ||
            !subject.trim() ||
            subject.length > 250)) ||
        (description !== undefined &&
          (typeof description !== "string" || description.length > 12000))
      ) {
        res.status(400).json({ error: "Invalid update" });
        return;
      }
      if (
        existing.tags.includes("business-website") &&
        (tags !== undefined || departmentId !== undefined)
      ) {
        res.status(409).json({
          error:
            "Website request classification is protected. Configure department routing before intake.",
        });
        return;
      }
      if (
        (raisedForUserId !== undefined || taggedUserIds !== undefined) &&
        !(await validParticipants(
          raisedForUserId ?? existing.raisedForUserId,
          taggedUserIds ?? existing.taggedUserIds,
        ))
      ) {
        res
          .status(400)
          .json({ error: "Select active employees from the directory" });
        return;
      }
      if (
        tags !== undefined &&
        (!Array.isArray(tags) ||
          tags.length > 20 ||
          tags.some((t: any) => typeof t !== "string" || t.length > 80))
      ) {
        res.status(400).json({ error: "Invalid tags" });
        return;
      }
      if (
        assigneeId != null &&
        !(await validAssignee(
          assigneeId,
          departmentId ?? existing.departmentId,
        ))
      ) {
        res
          .status(400)
          .json({ error: "Choose an active agent in the handling department" });
        return;
      }
      if (
        assigneeId !== undefined &&
        !(await allowed(req.user!, "canAssignTickets"))
      ) {
        res.status(403).json({ error: "Your role cannot assign tickets" });
        return;
      }
      if (
        ["closed", "resolved"].includes(status) &&
        !(await allowed(req.user!, "canCloseTicket"))
      ) {
        res.status(403).json({ error: "Your role cannot close tickets" });
        return;
      }
      const updates: Partial<typeof ticketsTable.$inferInsert> = {};
      const historyEntries: Array<{
        action: string;
        oldValue: string | null;
        newValue: string | null;
      }> = [];

      if (raisedForUserId !== undefined) {
        updates.raisedForUserId = raisedForUserId;
        historyEntries.push({
          action: "employee_link_changed",
          oldValue: String(existing.raisedForUserId),
          newValue: String(raisedForUserId),
        });
      }
      if (taggedUserIds !== undefined) {
        updates.taggedUserIds = [...new Set(taggedUserIds)] as number[];
        historyEntries.push({
          action: "tagged_employees_changed",
          oldValue: JSON.stringify(existing.taggedUserIds),
          newValue: JSON.stringify(updates.taggedUserIds),
        });
      }
      if (subject !== undefined) updates.subject = subject;
      if (description !== undefined) updates.description = description;
      if (status !== undefined && status !== existing.status) {
        historyEntries.push({
          action: "status_changed",
          oldValue: existing.status,
          newValue: status,
        });
        updates.status = status;
      }
      if (priority !== undefined && priority !== existing.priority) {
        historyEntries.push({
          action: "priority_changed",
          oldValue: existing.priority,
          newValue: priority,
        });
        updates.priority = priority;
      }
      if (departmentId !== undefined) updates.departmentId = departmentId;
      if (assigneeId !== undefined) {
        if (assigneeId !== existing.assigneeId) {
          historyEntries.push({
            action: "assignee_changed",
            oldValue: String(existing.assigneeId),
            newValue: String(assigneeId),
          });
          if (updates.status === undefined && existing.status === "open")
            updates.status = "assigned";
        }
        updates.assigneeId = assigneeId;
      }
      if (tags !== undefined) updates.tags = tags;

      const [updated] = await db
        .update(ticketsTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(ticketsTable.id, ticketId))
        .returning();

      Object.assign(
        updated,
        (await runAutomations(updated.id, ["ticket_updated"])) || {},
      );
      if (assigneeId && assigneeId !== existing.assigneeId)
        await notifyTicket(updated.id, "assigned", req.user!.id);
      const changedById = req.user!.id;
      if (historyEntries.length > 0) {
        await Promise.all(
          historyEntries.map((entry) =>
            db
              .insert(ticketHistoryTable)
              .values({ ticketId, changedById, ...entry }),
          ),
        );
      }

      const userIds = [updated.createdById, updated.assigneeId].filter(
        Boolean,
      ) as number[];
      const userRows =
        userIds.length > 0
          ? await db
              .select({
                id: usersTable.id,
                name: usersTable.name,
                email: usersTable.email,
              })
              .from(usersTable)
              .where(inArray(usersTable.id, userIds))
          : [];
      const usersMap = new Map(userRows.map((u) => [u.id, u.name]));
      const deptsMap = new Map<number, string>();
      let deptName: string | undefined;
      if (updated.departmentId) {
        const [dept] = await db
          .select({ id: departmentsTable.id, name: departmentsTable.name })
          .from(departmentsTable)
          .where(eq(departmentsTable.id, updated.departmentId))
          .limit(1);
        if (dept) {
          deptsMap.set(dept.id, dept.name);
          deptName = dept.name;
        }
      }

      const [commentRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(commentsTable)
        .where(eq(commentsTable.ticketId, ticketId));
      const workersMap = await aiWorkerNameMap([
        (updated as any).assignedAiWorkerId,
      ]);
      const formatted = await formatTicket(
        updated,
        usersMap,
        deptsMap,
        workersMap,
      );
      formatted.commentCount = commentRow?.count ?? 0;

      const statusEntry = historyEntries.find(
        (e) => e.action === "status_changed",
      );
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

      // Refill trigger: a resolved/closed ticket frees a slot — assign the
      // oldest waiting 'open' ticket(s) in the same department.
      if (
        statusEntry &&
        ["resolved", "closed"].includes(statusEntry.newValue ?? "") &&
        updated.departmentId
      ) {
        await refillDepartmentQueue(updated.departmentId, req.user!.id);
      }

      res.json(formatted);
    } catch (err) {
      console.error("Update ticket error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.delete(
  "/tickets/:ticketId",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const callerRole = req.user!.role;
      if (callerRole !== "super_admin" && callerRole !== "admin") {
        res.status(403).json({
          error: "Forbidden",
          message: "Only Super Admins and Admins can delete tickets",
        });
        return;
      }
      if (!(await allowed(req.user!, "canDeleteTickets"))) {
        res.status(403).json({ error: "Your role cannot delete tickets" });
        return;
      }
      const ticketId = parseInt(String(req.params.ticketId), 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query(
          "SELECT ticket_number FROM tickets WHERE id=$1 FOR UPDATE",
          [ticketId],
        );
        if (!found.rowCount) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "Ticket not found" });
          return;
        }
        await client.query(
          "INSERT INTO orbit_ticket_deletions(ticket_id,ticket_number,deleted_by) VALUES($1,$2,$3)",
          [ticketId, found.rows[0].ticket_number, req.user!.id],
        );
        // Foreign keys remove comments, history, files and AI jobs atomically.
        // Intake receipts keep a null ticket_id to prevent accidental recreation.
        await client.query("DELETE FROM tickets WHERE id=$1", [ticketId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      res.status(204).end();
    } catch (err) {
      console.error("Delete ticket error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.get(
  "/tickets/:ticketId/comments",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const ticketId = parseInt(String(req.params.ticketId), 10);
      const comments = await db
        .select()
        .from(commentsTable)
        .where(eq(commentsTable.ticketId, ticketId))
        .orderBy(commentsTable.createdAt);

      const authorIds = [...new Set(comments.map((c) => c.authorId))];
      const authorRows =
        authorIds.length > 0
          ? await db
              .select({
                id: usersTable.id,
                name: usersTable.name,
                avatar: usersTable.avatar,
              })
              .from(usersTable)
              .where(inArray(usersTable.id, authorIds))
          : [];
      const authorsMap = new Map(authorRows.map((u) => [u.id, u]));

      const canHandle = await handlesTicket(req.user!, ticketId);
      res.json(
        comments
          .filter((c) => !c.isInternal || canHandle)
          .map((c) => ({
            id: c.id,
            ticketId: c.ticketId,
            content: c.content,
            isInternal: c.isInternal,
            authorId: c.authorId,
            authorName: authorsMap.get(c.authorId)?.name ?? "Unknown",
            authorAvatar: authorsMap.get(c.authorId)?.avatar ?? null,
            createdAt: c.createdAt.toISOString(),
          })),
      );
    } catch (err) {
      console.error("List comments error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.post(
  "/tickets/:ticketId/comments",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const ticketId = parseInt(String(req.params.ticketId), 10);
      const { content, isInternal = false } = req.body;

      if (
        typeof content !== "string" ||
        !content.trim() ||
        content.length > 12000 ||
        (isInternal && !(await handlesTicket(req.user!, ticketId)))
      ) {
        res
          .status(400)
          .json({ error: "Bad Request", message: "Content required" });
        return;
      }

      const authorId = req.user!.id;
      const [comment] = await db
        .insert(commentsTable)
        .values({ ticketId, content, isInternal, authorId })
        .returning();

      await db
        .update(ticketsTable)
        .set({ updatedAt: new Date() })
        .where(eq(ticketsTable.id, ticketId));

      await runAutomations(ticketId, ["ticket_updated"]);
      await notifyTicket(ticketId, "comments", authorId, isInternal);
      res.status(201).json({
        id: comment.id,
        ticketId: comment.ticketId,
        content: comment.content,
        isInternal: comment.isInternal,
        authorId: comment.authorId,
        authorName: req.user!.name,
        authorAvatar: req.user!.avatar ?? null,
        createdAt: comment.createdAt.toISOString(),
      });
    } catch (err) {
      console.error("Create comment error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.post(
  "/tickets/bulk",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { rows } = req.body as { rows: Array<Record<string, string>> };
      if (!Array.isArray(rows) || rows.length === 0) {
        res
          .status(400)
          .json({ error: "Bad Request", message: "rows array required" });
        return;
      }

      const departments = await db.select().from(departmentsTable);
      const deptByName = new Map(
        departments.map((d) => [d.name.toLowerCase(), d]),
      );
      const users = await db.select().from(usersTable);
      const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

      const created: number[] = [];
      const errors: { row: number; error: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const subject = row.subject?.trim();
        if (!subject) {
          errors.push({ row: i + 1, error: "subject is required" });
          continue;
        }

        const priority = (
          ["low", "medium", "high", "urgent"].includes(
            row.priority?.trim().toLowerCase(),
          )
            ? row.priority.trim().toLowerCase()
            : "medium"
        ) as "low" | "medium" | "high" | "urgent";
        const status = (
          ["open", "in_progress", "waiting", "resolved", "closed"].includes(
            row.status?.trim().toLowerCase(),
          )
            ? row.status.trim().toLowerCase()
            : "open"
        ) as "open" | "in_progress" | "waiting" | "resolved" | "closed";

        let departmentId: number | null = null;
        if (row.department_name?.trim()) {
          const dept = deptByName.get(row.department_name.trim().toLowerCase());
          if (dept) departmentId = dept.id;
          else {
            errors.push({
              row: i + 1,
              error: `Department "${row.department_name}" not found`,
            });
            continue;
          }
        }

        let assigneeId: number | null = null;
        if (row.assignee_email?.trim()) {
          const u = userByEmail.get(row.assignee_email.trim().toLowerCase());
          if (u) assigneeId = u.id;
        }

        const tags = row.tags
          ? row.tags
              .split("|")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const ticketNumber = generateTicketNumber();

        try {
          const [ticket] = await db
            .insert(ticketsTable)
            .values({
              ticketNumber,
              subject,
              description: row.description?.trim() ?? "",
              priority,
              status,
              departmentId,
              assigneeId,
              createdById: req.user!.id,
              tags,
            })
            .returning();
          await runAutomations(ticket.id, ["ticket_created"]);
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
  },
);

export default router;
