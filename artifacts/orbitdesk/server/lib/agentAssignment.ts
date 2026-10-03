import {
  db,
  pool,
  usersTable,
  ticketsTable,
  ticketHistoryTable,
  departmentsTable,
  eq,
} from "@workspace/db";
import { sendAgentEmail } from "./emailService.js";

/**
 * Unified ticket auto-assignment with a per-agent active-ticket cap.
 *
 * Candidate pool = active human agents/managers in the ticket's department
 * (users table) PLUS enabled AI workers in the department (orbit_ai_workers).
 * A ticket is "active" when its status is not resolved/closed.
 * Each candidate may hold at most MAX_ACTIVE_TICKETS_PER_AGENT active tickets;
 * the least-loaded candidate wins, ties broken by lowest id.
 *
 * All selection queries use raw SQL with string literals for enum values
 * (parameterized text does not coerce to Postgres enums in every driver).
 */
export const MAX_ACTIVE_TICKETS_PER_AGENT = 3;

export interface AssignmentCandidate {
  kind: "human" | "ai";
  /** users.id for humans, orbit_ai_workers.id for AI workers */
  id: number;
  name: string;
  activeCount: number;
}

export interface AssignmentResult {
  kind: "human" | "ai" | null;
  id: number | null;
  name: string | null;
}

type QueryFn = (text: string, params: any[]) => Promise<{ rows: any[] }>;

/**
 * Pick the best candidate in a department without assigning anything.
 * Returns null when nobody has capacity (< MAX_ACTIVE_TICKETS_PER_AGENT).
 * Accepts a query function so transactional callers can reuse their own
 * client/connection instead of grabbing another pool connection.
 */
export async function findAssignmentCandidateWith(
  query: QueryFn,
  departmentId: number,
): Promise<AssignmentCandidate | null> {
  const { rows: humans } = await query(
    `SELECT id, name FROM users
     WHERE department_id = $1 AND is_active = true AND role IN ('agent', 'manager')`,
    [departmentId],
  );

  // orbit_ai_workers exists only after migration 006; older test DBs may not
  // have it — fall back to human-only candidates instead of failing.
  let workers: any[] = [];
  try {
    const { rows } = await query(
      `SELECT id, name FROM orbit_ai_workers
       WHERE department_id = $1 AND enabled = true AND kind IN ('triage', 'draft')`,
      [departmentId],
    );
    workers = rows;
  } catch {
    workers = [];
  }

  const candidates: AssignmentCandidate[] = [];

  if (humans.length > 0) {
    const ids = humans.map((h: any) => Number(h.id));
    const { rows: counts } = await query(
      `SELECT assignee_id AS id, count(*)::int AS count FROM tickets
       WHERE assignee_id = ANY($1)
         AND status IN ('open', 'assigned', 'in_progress', 'waiting')
       GROUP BY assignee_id`,
      [ids],
    );
    const countMap = new Map<number, number>(
      counts.map((r: any) => [Number(r.id), Number(r.count)]),
    );
    for (const h of humans) {
      candidates.push({
        kind: "human",
        id: Number(h.id),
        name: String(h.name),
        activeCount: countMap.get(Number(h.id)) ?? 0,
      });
    }
  }

  if (workers.length > 0) {
    const ids = workers.map((w: any) => Number(w.id));
    const { rows: counts } = await query(
      `SELECT assigned_ai_worker_id AS id, count(*)::int AS count FROM tickets
       WHERE assigned_ai_worker_id = ANY($1)
         AND status IN ('open', 'assigned', 'in_progress', 'waiting')
       GROUP BY assigned_ai_worker_id`,
      [ids],
    );
    const countMap = new Map<number, number>(
      counts.map((r: any) => [Number(r.id), Number(r.count)]),
    );
    for (const w of workers) {
      candidates.push({
        kind: "ai",
        id: Number(w.id),
        name: String(w.name ?? "").trim() || "AI agent",
        activeCount: countMap.get(Number(w.id)) ?? 0,
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.activeCount - b.activeCount || a.id - b.id);
  const best = candidates[0];
  return best.activeCount < MAX_ACTIVE_TICKETS_PER_AGENT ? best : null;
}

/** Pool-backed convenience wrapper. */
export function findAssignmentCandidate(
  departmentId: number,
): Promise<AssignmentCandidate | null> {
  return findAssignmentCandidateWith(
    (text, params) => pool.query(text, params),
    departmentId,
  );
}

/** Persist an assignment decision on a ticket. */
export async function applyAssignment(
  ticketId: number,
  candidate: AssignmentCandidate,
  changedById: number,
): Promise<AssignmentResult> {
  // assigned_ai_worker_id exists only after migration 006; guard the column
  // reference so human-only assignment still works on older DBs.
  const hasAiColumn = await (async () => {
    try {
      await pool.query(`SELECT assigned_ai_worker_id FROM tickets LIMIT 0`, []);
      return true;
    } catch {
      return false;
    }
  })();

  if (candidate.kind === "human") {
    await db
      .update(ticketsTable)
      .set({
        assigneeId: candidate.id,
        ...(hasAiColumn ? { assignedAiWorkerId: null } : {}),
        status: "assigned",
        updatedAt: new Date(),
      })
      .where(eq(ticketsTable.id, ticketId));
  } else if (hasAiColumn) {
    await db
      .update(ticketsTable)
      .set({
        assignedAiWorkerId: candidate.id,
        assigneeId: null,
        status: "assigned",
        updatedAt: new Date(),
      })
      .where(eq(ticketsTable.id, ticketId));
  } else {
    // AI candidate but no column (pre-006 DB): leave unassigned.
    return { kind: null, id: null, name: null };
  }
  await db.insert(ticketHistoryTable).values({
    ticketId,
    action: "auto_assigned",
    newValue: `${candidate.kind}:${candidate.id}`,
    changedById,
  });
  return { kind: candidate.kind, id: candidate.id, name: candidate.name };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

/**
 * Proactive email from the AI worker that just picked up a ticket. Exported
 * so intake paths that assign inside their own transaction can notify after
 * commit. Never throws (sendAgentEmail swallows email failures).
 */
export async function sendAssignmentEmail(
  ticketId: number,
  candidate: Pick<AssignmentCandidate, "id" | "name">,
): Promise<void> {
  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId))
    .limit(1);
  if (!ticket) return;

  let to: string | null = ticket.raisedForEmail?.trim() || null;
  if (!to && ticket.createdById) {
    const [creator] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, ticket.createdById))
      .limit(1);
    to = creator?.email?.trim() || null;
  }
  if (!to) return;

  let deptName = "our support team";
  if (ticket.departmentId) {
    const [dept] = await db
      .select({ name: departmentsTable.name })
      .from(departmentsTable)
      .where(eq(departmentsTable.id, ticket.departmentId))
      .limit(1);
    if (dept?.name?.trim()) deptName = dept.name.trim();
  }

  const subject = `[OrbitDesk] ${candidate.name} picked up your ticket #${ticket.ticketNumber}`;
  const lines = [
    `Hi${ticket.raisedForName?.trim() ? ` ${ticket.raisedForName.trim()}` : ""},`,
    ``,
    `Good news — ${candidate.name}, an AI agent on our ${deptName} team, has picked up your ticket #${ticket.ticketNumber} ("${ticket.subject}") and started working on it.`,
    ``,
    `We'll keep you posted on progress.`,
    ``,
    `— ${candidate.name} · OrbitDesk AI`,
  ];
  const html = lines
    .map((l) => (l ? `<p>${escapeHtml(l)}</p>` : "<br>"))
    .join("\n");
  await sendAgentEmail(candidate.name, to, subject, html);
}

/**
 * Find the best candidate for a department and assign the ticket.
 * Sends the proactive "picked up" email when an AI worker is assigned.
 * Never throws for email failures (sendAgentEmail swallows them).
 */
export async function autoAssignTicket(
  ticketId: number,
  departmentId: number,
  changedById: number,
): Promise<AssignmentResult> {
  const candidate = await findAssignmentCandidate(departmentId);
  if (!candidate) return { kind: null, id: null, name: null };
  const result = await applyAssignment(ticketId, candidate, changedById);
  if (candidate.kind === "ai") {
    await sendAssignmentEmail(ticketId, candidate);
  }
  return result;
}

/**
 * Refill trigger: assign the oldest unassigned 'open' tickets in a
 * department (FIFO) while candidates have capacity. Called when a ticket
 * is resolved/closed, freeing a slot.
 */
export async function refillDepartmentQueue(
  departmentId: number,
  changedById: number,
): Promise<AssignmentResult[]> {
  const results: AssignmentResult[] = [];
  // Skip entirely on pre-006 DBs (no assigned_ai_worker_id column).
  try {
    await pool.query(`SELECT assigned_ai_worker_id FROM tickets LIMIT 0`, []);
  } catch {
    return results;
  }
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id FROM tickets
       WHERE department_id = $1 AND status = 'open'
         AND assignee_id IS NULL AND assigned_ai_worker_id IS NULL
       ORDER BY created_at ASC LIMIT 1`,
      [departmentId],
    );
    if (!rows[0]) break;
    const result = await autoAssignTicket(
      Number(rows[0].id),
      departmentId,
      changedById,
    );
    if (!result.kind) break;
    results.push(result);
  }
  return results;
}
