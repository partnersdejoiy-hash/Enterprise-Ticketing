/**
 * AI Queue Optimizer (Superpower #7).
 *
 * Scores eligible agents on work metrics and recommends the best assignee
 * for a ticket. All scoring inputs are strictly WORK METRICS — age, gender,
 * location and any other personal attribute are never read, let alone used.
 * The candidate query below selects only id / name / department_id / role.
 *
 * Scoring weights (must sum to 1):
 *   skill       0.40  — proven output: resolved tickets in this department (90d)
 *   workload    0.30  — current open load: fewer open tickets scores higher
 *   sla_risk    0.20  — capacity to absorb an at-risk ticket: inverse of the
 *                       candidate's own breached/at-risk open ticket count
 *   round_robin 0.10  — fairness: longer since last assignment scores higher
 *
 * Heuristics (documented because the tickets schema has no category column):
 *   - skillScore: min(100, resolvedSameDept90d * 10). "Resolved" = tickets the
 *     candidate was assigned and that moved to resolved/closed with an update
 *     in the last 90 days, restricted to the target ticket's department. Ten
 *     such tickets saturates the score.
 *   - workloadScore: 100 - min(100, openAssigned * 20). Five open tickets
 *     zeroes the score. Open = status in open/assigned/in_progress/waiting.
 *   - slaRiskScore: 100 - min(100, atRiskOpen * 25). atRiskOpen counts the
 *     candidate's open assigned tickets with sla_breached = true OR an
 *     sla_deadline within the next 2 hours.
 *   - roundRobinScore: min(100, (minutesSinceLastAssign / 60) * 10). An agent
 *     never assigned before scores a full 100 (idle). 10 hours idle saturates.
 *
 * Policies (per department, stored in system_settings as queue_policy_dept_<id>,
 * default "ai_recommended"):
 *   - round_robin   → highest roundRobinScore
 *   - least_loaded  → highest workloadScore
 *   - skill_based   → highest skillScore
 *   - ai_recommended→ highest weighted final score
 */

import { pool, db, usersTable, eq } from "@workspace/db";
import { canAccessTicket } from "./ticket-access.js";
import { emitEvent, EventTypes } from "./orbit-events.js";

/** Scoring weights for the four work-metric signals. Must sum to 1. */
export const POLICY_WEIGHTS = {
  skill: 0.4,
  workload: 0.3,
  sla_risk: 0.2,
  round_robin: 0.1,
} as const;

export type QueuePolicy =
  | "round_robin"
  | "least_loaded"
  | "skill_based"
  | "ai_recommended";

export const QUEUE_POLICIES: QueuePolicy[] = [
  "round_robin",
  "least_loaded",
  "skill_based",
  "ai_recommended",
];

const POLICY_KEY_PREFIX = "queue_policy_dept_";

/** Candidate query — work identity only. No personal attributes are selected. */
const CANDIDATE_QUERY = `SELECT id, name, department_id, role
FROM users
WHERE role IN ('agent','manager') AND is_active = true AND department_id = $1
ORDER BY id ASC`;
const CANDIDATE_FALLBACK_QUERY = `SELECT id, name, department_id, role
FROM users
WHERE role IN ('agent','manager') AND is_active = true
ORDER BY id ASC`;

export class QueueError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ScoreBreakdown {
  skill: number;
  workload: number;
  slaRisk: number;
  roundRobin: number;
}

export interface CandidateScore {
  agentId: number;
  agentName: string;
  score: number;
  breakdown: ScoreBreakdown;
  note?: string;
}

export interface QueueRecommendationResult {
  recommendationId: number;
  ticketId: number;
  departmentId: number | null;
  policy: QueuePolicy;
  winner: CandidateScore;
  /** Top 3 candidates, ranked. */
  candidates: CandidateScore[];
  weights: typeof POLICY_WEIGHTS;
}

const OPEN_STATUSES = ["open", "assigned", "in_progress", "waiting"];
const CLOSED_STATUSES = ["resolved", "closed"];

/** Resolve the default tenant id (single-workspace deployments). */
async function resolveTenantId(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id FROM tenants WHERE slug = 'default' LIMIT 1`,
  );
  return (rows[0]?.id as number) ?? 1;
}

/** Pure weighted sum of a candidate's four metric scores. */
export function weightedFinalScore(b: ScoreBreakdown): number {
  return (
    POLICY_WEIGHTS.skill * b.skill +
    POLICY_WEIGHTS.workload * b.workload +
    POLICY_WEIGHTS.sla_risk * b.slaRisk +
    POLICY_WEIGHTS.round_robin * b.roundRobin
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure policy picker over pre-scored candidates.
 * Deterministic tie-break: lowest agentId wins.
 */
export function pickWinner(
  candidates: CandidateScore[],
  policy: QueuePolicy,
): CandidateScore {
  if (candidates.length === 0) throw new QueueError("No eligible agents", 409);
  const key = (c: CandidateScore): number =>
    policy === "round_robin"
      ? c.breakdown.roundRobin
      : policy === "least_loaded"
        ? c.breakdown.workload
        : policy === "skill_based"
          ? c.breakdown.skill
          : c.score;
  return [...candidates].sort((a, b) => key(b) - key(a) || a.agentId - b.agentId)[0];
}

export async function getQueuePolicy(
  departmentId: number | null,
): Promise<QueuePolicy> {
  const key = departmentId
    ? `${POLICY_KEY_PREFIX}${departmentId}`
    : `${POLICY_KEY_PREFIX}none`;
  const { rows } = await pool.query(
    "SELECT value FROM system_settings WHERE key = $1",
    [key],
  );
  const v = rows[0]?.value;
  return (QUEUE_POLICIES as string[]).includes(v) ? (v as QueuePolicy) : "ai_recommended";
}

export async function setQueuePolicy(
  departmentId: number | null,
  policy: string,
): Promise<QueuePolicy> {
  if (!(QUEUE_POLICIES as string[]).includes(policy))
    throw new QueueError(`Invalid policy: ${policy}`, 400);
  const key = departmentId
    ? `${POLICY_KEY_PREFIX}${departmentId}`
    : `${POLICY_KEY_PREFIX}none`;
  await pool.query(
    `INSERT INTO system_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, policy],
  );
  return policy as QueuePolicy;
}

interface CandidateRow {
  id: number;
  name: string;
  department_id: number | null;
  role: string;
}

interface TicketRow {
  id: number;
  department_id: number | null;
  priority: string;
}

async function computeBreakdown(
  agentId: number,
  departmentId: number | null,
): Promise<ScoreBreakdown> {
  const openQ = pool.query(
    `SELECT COUNT(*)::int AS n FROM tickets
     WHERE assignee_id = $1 AND status = ANY($2::text[])`,
    [agentId, OPEN_STATUSES],
  );
  const resolvedQ = pool.query(
    `SELECT COUNT(*)::int AS n FROM tickets
     WHERE assignee_id = $1
       AND ($2::int IS NULL OR department_id = $2)
       AND status = ANY($3::text[])
       AND updated_at >= now() - interval '90 days'`,
    [agentId, departmentId, CLOSED_STATUSES],
  );
  const atRiskQ = pool.query(
    `SELECT COUNT(*)::int AS n FROM tickets
     WHERE assignee_id = $1 AND status = ANY($2::text[])
       AND (sla_breached = true
            OR (sla_deadline IS NOT NULL AND sla_deadline < now() + interval '2 hours'))`,
    [agentId, OPEN_STATUSES],
  );
  const lastAssignQ = pool.query(
    `SELECT MAX(created_at) AS last_assign FROM tickets WHERE assignee_id = $1`,
    [agentId],
  );
  const [openR, resolvedR, atRiskR, lastAssignR] = await Promise.all([
    openQ,
    resolvedQ,
    atRiskQ,
    lastAssignQ,
  ]);
  const openCount = openR.rows[0].n as number;
  const resolved = resolvedR.rows[0].n as number;
  const atRisk = atRiskR.rows[0].n as number;
  const lastAssign = lastAssignR.rows[0].last_assign as string | null;

  const skill = Math.min(100, resolved * 10);
  const workload = 100 - Math.min(100, openCount * 20);
  const slaRisk = 100 - Math.min(100, atRisk * 25);
  let roundRobin: number;
  if (!lastAssign) {
    roundRobin = 100; // never assigned — fully idle, fairest pick
  } else {
    const minutesIdle =
      (Date.now() - new Date(lastAssign).getTime()) / 60000;
    roundRobin = Math.min(100, Math.max(0, (minutesIdle / 60) * 10));
  }
  return {
    skill: round2(skill),
    workload: round2(workload),
    slaRisk: round2(slaRisk),
    roundRobin: round2(roundRobin),
  };
}

/**
 * Score eligible agents for a ticket and persist the recommendation.
 * Fail closed: throws 404 when the actor cannot access the ticket.
 */
export async function recommendAssignment(
  ticketId: number,
  actorId: number,
): Promise<QueueRecommendationResult> {
  const [actor] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, actorId))
    .limit(1);
  if (!actor) throw new QueueError("Actor not found", 404);
  if (!(await canAccessTicket(actor, ticketId)))
    throw new QueueError("Ticket not found", 404);

  const { rows: ticketRows } = await pool.query(
    "SELECT id, department_id, priority FROM tickets WHERE id = $1",
    [ticketId],
  );
  const ticket = ticketRows[0] as TicketRow | undefined;
  if (!ticket) throw new QueueError("Ticket not found", 404);

  const policy = await getQueuePolicy(ticket.department_id);

  let note: string | undefined;
  let { rows } = ticket.department_id
    ? await pool.query(CANDIDATE_QUERY, [ticket.department_id])
    : { rows: [] as CandidateRow[] };
  if (rows.length === 0) {
    ({ rows } = await pool.query(CANDIDATE_FALLBACK_QUERY));
    note =
      "Department fallback: no active agents/managers in the ticket's department; scoring across all active agents/managers.";
  }
  if (rows.length === 0) throw new QueueError("No eligible agents", 409);

  const scored: CandidateScore[] = await Promise.all(
    (rows as CandidateRow[]).map(async (c) => {
      const breakdown = await computeBreakdown(c.id, ticket.department_id);
      return {
        agentId: c.id,
        agentName: c.name,
        score: round2(weightedFinalScore(breakdown)),
        breakdown,
        ...(note ? { note } : {}),
      };
    }),
  );

  const winner = pickWinner(scored, policy);
  const top3 = [...scored].sort((a, b) => b.score - a.score).slice(0, 3);

  const reasons = top3.map((c) => ({
    agentId: c.agentId,
    agentName: c.agentName,
    score: c.score,
    breakdown: c.breakdown,
    ...(c.note ? { note: c.note } : {}),
  }));

  const { rows: ins } = await pool.query(
    `INSERT INTO queue_recommendations
       (tenant_id, ticket_id, recommended_agent_id, policy, reasons, confidence, applied)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, false)
     RETURNING id`,
    [
      await resolveTenantId(),
      ticketId,
      winner.agentId,
      policy,
      JSON.stringify(reasons),
      winner.score,
    ],
  );

  return {
    recommendationId: ins[0].id as number,
    ticketId,
    departmentId: ticket.department_id,
    policy,
    winner,
    candidates: top3,
    weights: POLICY_WEIGHTS,
  };
}

/**
 * Apply a persisted recommendation: reassign the ticket.
 * Roles: admin / super_admin / manager. Managers are department-scoped.
 */
export async function applyRecommendation(
  recommendationId: number,
  actorId: number,
): Promise<{ ticketId: number; assigneeId: number; policy: string }> {
  const [actor] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, actorId))
    .limit(1);
  if (!actor) throw new QueueError("Actor not found", 404);
  if (!["admin", "super_admin", "manager"].includes(actor.role))
    throw new QueueError("Only managers and admins can apply recommendations", 403);

  const { rows } = await pool.query(
    `SELECT id, ticket_id, recommended_agent_id, policy, applied
     FROM queue_recommendations WHERE id = $1`,
    [recommendationId],
  );
  const rec = rows[0];
  if (!rec) throw new QueueError("Recommendation not found", 404);
  if (rec.applied) throw new QueueError("Recommendation already applied", 409);
  if (!rec.recommended_agent_id)
    throw new QueueError("Recommendation has no eligible agent", 409);

  const { rows: ticketRows } = await pool.query(
    "SELECT id, department_id FROM tickets WHERE id = $1",
    [rec.ticket_id],
  );
  const ticket = ticketRows[0];
  if (!ticket) throw new QueueError("Ticket not found", 404);

  if (
    actor.role === "manager" &&
    (actor.departmentId == null || actor.departmentId !== ticket.department_id)
  )
    throw new QueueError(
      "Managers can only apply recommendations for their own department",
      403,
    );

  await pool.query("UPDATE tickets SET assignee_id = $1 WHERE id = $2", [
    rec.recommended_agent_id,
    rec.ticket_id,
  ]);
  await pool.query(
    "UPDATE queue_recommendations SET applied = true WHERE id = $1",
    [recommendationId],
  );

  await emitEvent({
    type: EventTypes.TICKET_ASSIGNED,
    entityType: "ticket",
    entityId: String(rec.ticket_id),
    actorId: actor.id,
    tenantId: await resolveTenantId(),
    payload: { recommendationId, policy: rec.policy },
  });

  return {
    ticketId: rec.ticket_id as number,
    assigneeId: rec.recommended_agent_id as number,
    policy: rec.policy as string,
  };
}

export interface RecommendationHistoryEntry {
  id: number;
  ticketId: number;
  agentId: number | null;
  agentName: string | null;
  policy: string;
  confidence: number | null;
  applied: boolean;
  createdAt: string;
  reasons: unknown;
}

export async function listRecommendations(
  ticketId: number,
): Promise<RecommendationHistoryEntry[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.ticket_id AS "ticketId",
            r.recommended_agent_id AS "agentId", u.name AS "agentName",
            r.policy, r.confidence, r.applied,
            r.created_at AS "createdAt", r.reasons
     FROM queue_recommendations r
     LEFT JOIN users u ON u.id = r.recommended_agent_id
     WHERE r.ticket_id = $1
     ORDER BY r.created_at DESC`,
    [ticketId],
  );
  return rows as RecommendationHistoryEntry[];
}

/** Latest unapplied recommendation, if still fresh (< 15 minutes old). */
export async function getFreshRecommendation(
  ticketId: number,
): Promise<RecommendationHistoryEntry | null> {
  const { rows } = await pool.query(
    `SELECT r.id, r.ticket_id AS "ticketId",
            r.recommended_agent_id AS "agentId", u.name AS "agentName",
            r.policy, r.confidence, r.applied,
            r.created_at AS "createdAt", r.reasons
     FROM queue_recommendations r
     LEFT JOIN users u ON u.id = r.recommended_agent_id
     WHERE r.ticket_id = $1 AND r.applied = false
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [ticketId],
  );
  const rec = rows[0] as RecommendationHistoryEntry | undefined;
  if (!rec) return null;
  const ageMs = Date.now() - new Date(rec.createdAt).getTime();
  return ageMs < 15 * 60 * 1000 ? rec : null;
}
