/**
 * AI Resolution Agent (#3).
 *
 * Generates a grounded resolution plan for a ticket (similar resolved
 * tickets + published KB articles as trusted sources), persists it for
 * human approval, and executes only an allowlisted set of actions after
 * approval. Never runs shell commands or arbitrary operations.
 */

import { pool } from "@workspace/db";
import type { usersTable } from "@workspace/db";
import { runAnalysis, proposeRecommendation } from "./orbit-ai.js";
import { emitEvent, EventTypes } from "./orbit-events.js";
import { canAccessTicket, handlesTicket } from "./ticket-access.js";
import { extractKeywords, jaccard } from "./root-cause.js";

type UserRow = typeof usersTable.$inferSelect;

const PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;
const ASSIGNABLE_ROLES = ["super_admin", "admin", "manager", "agent"];

function httpError(status: number, message: string): Error & { status: number } {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

async function loadUser(userId: number): Promise<UserRow> {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [
    userId,
  ]);
  if (!rows[0]) throw httpError(404, "User not found");
  return rows[0] as UserRow;
}

async function resolveTenantId(): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      "SELECT id FROM tenants WHERE slug = 'default' LIMIT 1",
    );
    return (rows[0]?.id as number | undefined) ?? null;
  } catch {
    return null;
  }
}

interface TicketRow {
  id: number;
  ticket_number: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  department_id: number | null;
  department_name: string | null;
}

async function loadTicketRow(ticketId: number): Promise<TicketRow> {
  const { rows } = await pool.query(
    `SELECT t.id, t.ticket_number, t.subject, t.description, t.priority,
            t.status, t.department_id, d.name AS department_name
     FROM tickets t LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.id = $1`,
    [ticketId],
  );
  if (!rows[0]) throw httpError(404, "Ticket not found");
  return rows[0] as TicketRow;
}

interface SimilarTicket {
  id: number;
  ticket_number: string;
  subject: string;
  resolution_notes: string | null;
}

/** Recently resolved/closed tickets similar by subject keywords (Jaccard > 0.35). */
async function findSimilarResolved(
  ticket: TicketRow,
): Promise<SimilarTicket[]> {
  const { rows } = await pool.query(
    `SELECT id, ticket_number, subject
     FROM tickets
     WHERE status IN ('resolved', 'closed') AND id <> $1
     ORDER BY updated_at DESC
     LIMIT 200`,
    [ticket.id],
  );
  const target = new Set(extractKeywords(ticket.subject ?? ""));
  const scored: { row: (typeof rows)[number]; score: number }[] = [];
  for (const r of rows) {
    const score = jaccard(target, new Set(extractKeywords(String(r.subject ?? ""))));
    if (score > 0.35) scored.push({ row: r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: SimilarTicket[] = [];
  for (const s of scored.slice(0, 5)) {
    const { rows: cRows } = await pool.query(
      `SELECT content FROM ticket_comments
       WHERE ticket_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [s.row.id],
    );
    out.push({
      id: s.row.id as number,
      ticket_number: String(s.row.ticket_number),
      subject: String(s.row.subject ?? ""),
      resolution_notes: (cRows[0]?.content as string | undefined) ?? null,
    });
  }
  return out;
}

interface KbHit {
  id: number;
  title: string;
}

async function findKbArticles(subject: string): Promise<KbHit[]> {
  const keywords = extractKeywords(subject).slice(0, 10).join(" ");
  if (!keywords) return [];
  const { rows } = await pool.query(
    `SELECT id, title FROM knowledge_articles
     WHERE status = 'published' AND searchable AND deleted_at IS NULL
       AND to_tsvector('english', title || ' ' || content)
           @@ plainto_tsquery('english', $1)
     LIMIT 5`,
    [keywords],
  );
  return rows.map((r) => ({ id: r.id as number, title: String(r.title) }));
}

const RESOLUTION_SYSTEM_PROMPT = `You are an IT support resolution planner. Draft a resolution plan for the ticket described below, grounded ONLY in the provided trusted context (similar resolved tickets and knowledge articles).

Return ONLY valid JSON with this schema:
{
  "plan_steps": [
    { "step": string, "detail": string, "source_refs": [string] }
  ],
  "confidence": number (0-100),
  "sources": [ { "type": "ticket"|"knowledge", "id": string, "title": string } ],
  "recommended_action": string,
  "requires_approval": boolean,
  "risk_level": "low"|"medium"|"high",
  "actions": [
    { "type": "add_comment"|"set_priority"|"assign"|"add_tag", "params": object }
  ]
}

Rules:
- EVERY plan step MUST cite at least one source_ref (e.g. "ticket:123", "kb:7") from the trusted context. Never invent ticket IDs or article IDs.
- If the sources are insufficient to plan confidently, state that explicitly in recommended_action and set confidence below 40.
- Use probabilistic language ("likely", "may help"). Never claim certainty ("definitely", "certain").
- Set requires_approval=true when any action is assign (reassignment needs a human) or risk_level is high.
- Keep actions minimal and reversible where possible.`;

export interface PlanAction {
  type: string;
  params: Record<string, unknown>;
}

export interface ResolutionPlanRow {
  id: number;
  ticket_id: number;
  analysis_id: number | null;
  steps: unknown[];
  actions: PlanAction[];
  confidence: number | null;
  sources: unknown[];
  recommended_action: string | null;
  requires_approval: boolean;
  risk_level: string;
  status: string;
}

/**
 * Generate a grounded resolution plan. Permission-gated by canAccessTicket.
 */
export async function generateResolutionPlan(
  ticketId: number,
  actorId: number,
): Promise<ResolutionPlanRow> {
  const user = await loadUser(actorId);
  if (!(await canAccessTicket(user, ticketId))) {
    throw httpError(403, "Ticket not found");
  }
  const ticket = await loadTicketRow(ticketId);
  const tenantId = await resolveTenantId();

  const similar = await findSimilarResolved(ticket);
  const kb = await findKbArticles(ticket.subject);

  const analysis = await runAnalysis({
    feature: "resolution",
    entityType: "ticket",
    entityId: String(ticketId),
    tenantId,
    actorId,
    canAccess: () => canAccessTicket(user, ticketId),
    systemPrompt: RESOLUTION_SYSTEM_PROMPT,
    untrustedInputs: [
      { label: "ticket_description", text: ticket.description ?? "" },
    ],
    trustedContext: {
      ticket: {
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
        priority: ticket.priority,
        status: ticket.status,
        department: ticket.department_name,
      },
      similar_resolved_tickets: similar.map((s) => ({
        id: s.id,
        ticket_number: s.ticket_number,
        subject: s.subject,
        resolution_notes: s.resolution_notes,
      })),
      knowledge_articles: kb.map((a) => ({ id: a.id, title: a.title })),
    },
    maxTokens: 2000,
  });

  const parsed = analysis.result as {
    plan_steps?: unknown[];
    confidence?: number;
    sources?: unknown[];
    recommended_action?: string;
    requires_approval?: boolean;
    risk_level?: string;
    actions?: PlanAction[];
  };
  const steps = Array.isArray(parsed.plan_steps) ? parsed.plan_steps : [];
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.filter(
        (a) => a && typeof a === "object" && typeof a.type === "string",
      )
    : [];
  const requiresApproval = Boolean(parsed.requires_approval);
  const riskLevel =
    parsed.risk_level === "high" || parsed.risk_level === "medium"
      ? parsed.risk_level
      : "low";

  const { rows } = await pool.query(
    `INSERT INTO resolution_plans
       (tenant_id, ticket_id, analysis_id, steps, actions, confidence,
        sources, recommended_action, requires_approval, risk_level,
        status, created_by_id)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9,$10,'proposed',$11)
     RETURNING id, ticket_id, analysis_id, steps, actions, confidence,
               sources, recommended_action, requires_approval, risk_level, status`,
    [
      tenantId,
      ticketId,
      analysis.analysisId,
      JSON.stringify(steps),
      JSON.stringify(actions),
      analysis.confidence,
      JSON.stringify(analysis.sources),
      typeof parsed.recommended_action === "string"
        ? parsed.recommended_action
        : null,
      requiresApproval,
      riskLevel,
      actorId,
    ],
  );
  const plan = rows[0] as ResolutionPlanRow;

  if (requiresApproval) {
    try {
      await proposeRecommendation({
        tenantId,
        analysisId: analysis.analysisId,
        entityType: "ticket",
        entityId: String(ticketId),
        kind: "resolution_plan",
        title: `Resolution plan for ${ticket.ticket_number}`,
        detail:
          parsed.recommended_action ??
          "Review the proposed resolution plan before execution.",
        confidence: analysis.confidence,
        evidence: analysis.sources,
      });
    } catch (err) {
      console.error("[resolution] recommendation failed:", err);
    }
  }

  await emitEvent({
    type: EventTypes.RESOLUTION_PLAN_PROPOSED,
    entityType: "ticket",
    entityId: String(ticketId),
    actorId,
    actorType: "user",
    tenantId,
    payload: {
      plan_id: plan.id,
      requires_approval: requiresApproval,
      risk_level: riskLevel,
      confidence: analysis.confidence,
    },
  });

  return plan;
}

async function loadPlanRow(planId: number): Promise<ResolutionPlanRow> {
  const { rows } = await pool.query(
    `SELECT id, ticket_id, analysis_id, steps, actions, confidence, sources,
            recommended_action, requires_approval, risk_level, status
     FROM resolution_plans WHERE id = $1`,
    [planId],
  );
  if (!rows[0]) throw httpError(404, "Resolution plan not found");
  return rows[0] as ResolutionPlanRow;
}

/**
 * Approve a plan. Requires handlesTicket or admin. Optionally persists
 * human-edited steps.
 */
export async function approvePlan(
  planId: number,
  userId: number,
  editedSteps?: unknown[],
): Promise<ResolutionPlanRow> {
  const plan = await loadPlanRow(planId);
  if (plan.status !== "proposed") {
    throw httpError(400, "Only proposed plans can be approved");
  }
  const user = await loadUser(userId);
  if (!(await handlesTicket(user, plan.ticket_id))) {
    throw httpError(403, "Not authorized to approve this plan");
  }
  const { rows } = await pool.query(
    `UPDATE resolution_plans
     SET steps = COALESCE($2::jsonb, steps), status = 'approved',
         decided_by_id = $3, decided_at = now()
     WHERE id = $1
     RETURNING id, ticket_id, analysis_id, steps, actions, confidence, sources,
               recommended_action, requires_approval, risk_level, status`,
    [
      planId,
      editedSteps ? JSON.stringify(editedSteps) : null,
      userId,
    ],
  );
  return rows[0] as ResolutionPlanRow;
}

/** Reject a plan. Requires handlesTicket or admin. */
export async function rejectPlan(
  planId: number,
  userId: number,
  note?: string,
): Promise<ResolutionPlanRow> {
  const plan = await loadPlanRow(planId);
  if (plan.status !== "proposed") {
    throw httpError(400, "Only proposed plans can be rejected");
  }
  const user = await loadUser(userId);
  if (!(await handlesTicket(user, plan.ticket_id))) {
    throw httpError(403, "Not authorized to reject this plan");
  }
  const { rows } = await pool.query(
    `UPDATE resolution_plans
     SET status = 'rejected', decided_by_id = $3, decided_at = now(),
         decision_note = $2
     WHERE id = $1
     RETURNING id, ticket_id, analysis_id, steps, actions, confidence, sources,
               recommended_action, requires_approval, risk_level, status`,
    [planId, note ?? null, userId],
  );
  return rows[0] as ResolutionPlanRow;
}

/**
 * Execute an approved plan inside a single DB transaction. Only the
 * allowlisted action types are applied; anything else is skipped and logged.
 * Never runs shell commands or arbitrary operations.
 */
export async function executePlan(
  planId: number,
  userId: number,
): Promise<{ plan_id: number; execution_log: unknown[] }> {
  const plan = await loadPlanRow(planId);
  if (plan.status !== "approved") {
    throw httpError(400, "Plan must be approved before execution");
  }
  const user = await loadUser(userId);
  if (!(await handlesTicket(user, plan.ticket_id))) {
    throw httpError(403, "Not authorized to execute this plan");
  }

  const client = await pool.connect();
  const executionLog: Record<string, unknown>[] = [];
  try {
    await client.query("BEGIN");
    for (const action of plan.actions ?? []) {
      const type = String(action.type);
      const params = (action.params ?? {}) as Record<string, unknown>;
      switch (type) {
        case "add_comment": {
          const text = String(params.text ?? "").trim();
          if (!text) throw httpError(400, "add_comment requires params.text");
          await client.query(
            `INSERT INTO ticket_comments (ticket_id, content, is_internal, author_id)
             VALUES ($1, $2, $3, $4)`,
            [
              plan.ticket_id,
              text,
              Boolean(params.is_internal ?? false),
              userId,
            ],
          );
          executionLog.push({ action: type, status: "applied" });
          break;
        }
        case "set_priority": {
          const priority = String(params.priority ?? "");
          if (
            !(PRIORITY_VALUES as readonly string[]).includes(priority)
          ) {
            throw httpError(400, `Invalid priority: ${priority}`);
          }
          await client.query(
            "UPDATE tickets SET priority = $1::ticket_priority WHERE id = $2",
            [priority, plan.ticket_id],
          );
          executionLog.push({ action: type, status: "applied", priority });
          break;
        }
        case "assign": {
          const assigneeId = Number(params.assignee_id);
          if (!Number.isSafeInteger(assigneeId) || assigneeId < 1) {
            throw httpError(400, "assign requires a valid params.assignee_id");
          }
          const { rows } = await client.query(
            "SELECT id, role, is_active FROM users WHERE id = $1",
            [assigneeId],
          );
          const assignee = rows[0] as
            | { id: number; role: string; is_active: boolean }
            | undefined;
          if (
            !assignee ||
            !assignee.is_active ||
            !ASSIGNABLE_ROLES.includes(assignee.role)
          ) {
            throw httpError(
              400,
              "assign target must be an existing active staff user",
            );
          }
          await client.query(
            "UPDATE tickets SET assignee_id = $1 WHERE id = $2",
            [assigneeId, plan.ticket_id],
          );
          executionLog.push({ action: type, status: "applied", assigneeId });
          break;
        }
        case "add_tag": {
          const tag = String(params.tag ?? "").trim().slice(0, 64);
          if (!tag) throw httpError(400, "add_tag requires params.tag");
          await client.query(
            `UPDATE tickets
             SET tags = CASE WHEN NOT (tags @> ARRAY[$1]::text[])
                             THEN array_append(tags, $1) ELSE tags END
             WHERE id = $2`,
            [tag, plan.ticket_id],
          );
          executionLog.push({ action: type, status: "applied", tag });
          break;
        }
        default:
          executionLog.push({
            action: type,
            status: "skipped",
            detail: "action type not allowlisted",
          });
      }
    }
    await client.query(
      `UPDATE resolution_plans
       SET status = 'executed', executed_at = now(), execution_log = $2::jsonb
       WHERE id = $1`,
      [planId, JSON.stringify(executionLog)],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const tenantId = await resolveTenantId();
  await emitEvent({
    type: EventTypes.RESOLUTION_PLAN_EXECUTED,
    entityType: "ticket",
    entityId: String(plan.ticket_id),
    actorId: userId,
    actorType: "user",
    tenantId,
    payload: { plan_id: planId, execution_log: executionLog },
  });

  return { plan_id: planId, execution_log: executionLog };
}
