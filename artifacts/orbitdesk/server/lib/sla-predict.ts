/**
 * Orbit Predictive SLA Intelligence (Superpower #1).
 *
 * Computes real SLA signals from the database, then calls the unified AI
 * pipeline (runAnalysis) for a grounded breach prediction. Predictions are
 * stored in sla_predictions for historical accuracy analysis.
 *
 * Rules:
 *  - NEVER auto-reassign. Output is recommendations only.
 *  - All numbers come from real DB queries. No fabricated metrics.
 *  - Permission-gated via canAccessTicket (fail-closed).
 */

import { pool } from "@workspace/db";
import { runAnalysis } from "./orbit-ai.js";
import { getSlaStatus, type SlaStatus } from "./sla-engine.js";
import { canAccessTicket } from "./ticket-access.js";

export type SlaHealth = "safe" | "at_risk" | "critical" | "breached";

export interface SlaSignals {
  ticketId: number;
  ticketNumber: string;
  subject: string;
  priority: string;
  status: string;
  departmentId: number | null;
  departmentName: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  ageMinutes: number;
  elapsedBusinessMinutes: number;
  remainingBusinessMinutes: number | null;
  percentElapsed: number | null;
  deterministicHealth: SlaHealth | "met" | "no_policy";
  resolutionDueAt: string | null;
  firstResponseDueAt: string | null;
  pausedMinutes: number;
  queueSize: number; // open tickets in same department
  assigneeWorkload: number; // assignee's open tickets
  departmentWorkload: number; // open tickets in department (same as queueSize)
  historicalAvgResolutionMinutes: number | null;
  historicalSampleSize: number;
  minutesSinceLastResponse: number | null;
  commentCount: number;
}

const OPEN_STATUSES = ["open", "assigned", "in_progress", "waiting"];

/** Gather every real signal the prediction model needs. */
export async function collectSlaSignals(ticketId: number): Promise<SlaSignals> {
  const { rows: tRows } = await pool.query(
    `SELECT t.id, t.ticket_number AS "ticketNumber", t.subject, t.description,
            t.priority, t.status, t.department_id AS "departmentId",
            t.assignee_id AS "assigneeId", t.created_at AS "createdAt",
            d.name AS "departmentName", u.name AS "assigneeName",
            s.resolution_due_at AS "resolutionDueAt",
            s.first_response_due_at AS "firstResponseDueAt",
            s.paused_seconds AS "pausedSeconds"
     FROM tickets t
     LEFT JOIN departments d ON d.id = t.department_id
     LEFT JOIN users u ON u.id = t.assignee_id
     LEFT JOIN ticket_sla s ON s.ticket_id = t.id
     WHERE t.id = $1`,
    [ticketId],
  );
  const t = tRows[0];
  if (!t) throw new Error(`Ticket ${ticketId} not found`);

  const now = new Date();
  const ageMinutes = Math.max(
    0,
    Math.round((now.getTime() - new Date(t.createdAt).getTime()) / 60000),
  );

  // Queue size: open tickets in the same department.
  const queueSize = t.departmentId
    ? Number(
        (
          await pool.query(
            `SELECT COUNT(*) FROM tickets
             WHERE department_id = $1 AND status = ANY($2) AND id <> $3`,
            [t.departmentId, OPEN_STATUSES, ticketId],
          )
        ).rows[0].count,
      )
    : 0;

  // Assignee workload: their open (non-waiting) tickets.
  const assigneeWorkload = t.assigneeId
    ? Number(
        (
          await pool.query(
            `SELECT COUNT(*) FROM tickets
             WHERE assignee_id = $1
               AND status = ANY($2) AND id <> $3`,
            [t.assigneeId, ["open", "assigned", "in_progress"], ticketId],
          )
        ).rows[0].count,
      )
    : 0;

  // Historical average resolution time for same department + priority.
  const hist = (
    await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (s.resolved_at - t.created_at))/60) AS avg_min,
              COUNT(*) AS n
       FROM ticket_sla s
       JOIN tickets t ON t.id = s.ticket_id
       WHERE s.resolved_at IS NOT NULL
         AND (($1::int IS NULL AND t.department_id IS NULL) OR t.department_id = $1)
         AND t.priority = $2`,
      [t.departmentId, t.priority],
    )
  ).rows[0];

  // Comment activity.
  const activity = (
    await pool.query(
      `SELECT COUNT(*) AS c,
              EXTRACT(EPOCH FROM (now() - MAX(created_at)))/60 AS mins_since
       FROM ticket_comments WHERE ticket_id = $1`,
      [ticketId],
    )
  ).rows[0];

  // Live deterministic SLA status.
  const status: SlaStatus = await getSlaStatus(ticketId);
  const det = ["safe", "at_risk", "critical", "breached"].includes(status.health)
    ? (status.health as SlaHealth)
    : status.health;

  return {
    ticketId,
    ticketNumber: t.ticketNumber,
    subject: t.subject,
    priority: t.priority,
    status: t.status,
    departmentId: t.departmentId,
    departmentName: t.departmentName,
    assigneeId: t.assigneeId,
    assigneeName: t.assigneeName,
    ageMinutes,
    elapsedBusinessMinutes: status.elapsedBusinessMinutes,
    remainingBusinessMinutes: status.remainingBusinessMinutes,
    percentElapsed: status.percentElapsed,
    deterministicHealth: det as SlaSignals["deterministicHealth"],
    resolutionDueAt: status.resolutionDueAt,
    firstResponseDueAt: status.firstResponseDueAt,
    pausedMinutes: Math.round((t.pausedSeconds ?? 0) / 60),
    queueSize,
    assigneeWorkload,
    departmentWorkload: queueSize,
    historicalAvgResolutionMinutes:
      hist.avg_min != null ? Math.round(Number(hist.avg_min)) : null,
    historicalSampleSize: Number(hist.n),
    minutesSinceLastResponse:
      activity.mins_since != null ? Math.round(Number(activity.mins_since)) : null,
    commentCount: Number(activity.c),
  };
}

export interface SlaPrediction {
  id: number;
  ticketId: number;
  breachProbability: number;
  predictedBreachAt: string | null;
  health: SlaHealth;
  confidence: number;
  factors: { factor: string; weight: number; detail: string }[];
  recommendedActions: string[];
  modelVersion: string | null;
  createdAt: string;
}

const PREDICTION_SYSTEM_PROMPT = `
You are an SLA risk analyst for an enterprise ticketing platform.
Given trusted SLA signals (database records) and ticket content (untrusted),
predict the likelihood of an SLA breach.

Respond with valid JSON only:
{
  "breach_probability": <0-100 number>,
  "predicted_breach_at": "<ISO8601 timestamp of likely breach, or null if unlikely>",
  "health": "safe" | "at_risk" | "critical" | "breached",
  "confidence": <0-100>,
  "factors": [{"factor": "<name>", "weight": <0-100>, "detail": "<why>"}],
  "recommended_actions": ["<actionable recommendation>"],
  "sources": [{"type": "ticket", "id": "<ticket id>", "title": "<ticket number>"}]
}

Guidance:
- If the ticket is already past its resolution due date, health MUST be "breached" with breach_probability 100.
- Weight heavily: percent of SLA elapsed, remaining time vs historical avg resolution, queue size, assignee workload.
- Use probabilistic language in details ("likely", "potential"). Never claim certainty.
- NEVER recommend automatic reassignment — recommendations are for humans to decide.
- If data is insufficient, lower confidence rather than guessing.
`.trim();

const SEVERITY: Record<SlaHealth, number> = {
  safe: 0, at_risk: 1, critical: 2, breached: 3,
};

/** Run a fresh AI prediction and store it. Permission-gated. */
export async function predictSlaBreach(
  ticketId: number,
  actorId: number | null,
  opts: { force?: boolean } = {},
): Promise<SlaPrediction> {
  // 1. Permission check (fail-closed). System batch runs pass actorId=null
  //    and are trusted callers (cron), not end users.
  if (actorId != null) {
    const { rows: uRows } = await pool.query(
      `SELECT id, role, department_id AS "departmentId" FROM users WHERE id = $1 LIMIT 1`,
      [actorId],
    );
    const user = uRows[0];
    if (!user || !(await canAccessTicket(user as never, ticketId))) {
      throw new Error("Prediction denied: no ticket access");
    }
  }

  // 2. Cooldown: at most one fresh prediction per ticket per 10 minutes
  //    (batch jobs may force).
  if (!opts.force) {
    const { rows } = await pool.query(
      `SELECT id FROM sla_predictions
       WHERE ticket_id = $1 AND created_at > now() - interval '10 minutes'
       LIMIT 1`,
      [ticketId],
    );
    if (rows[0]) {
      return getPredictionById(rows[0].id);
    }
  }

  // 3. Collect real signals.
  const signals = await collectSlaSignals(ticketId);

  // 4. Grounded AI analysis. Ticket subject/description are untrusted inputs
  //    (shield-scanned + redacted inside runAnalysis).
  const { rows: bodyRows } = await pool.query(
    `SELECT description FROM tickets WHERE id = $1`,
    [ticketId],
  );
  const description: string = bodyRows[0]?.description ?? "";

  const analysis = await runAnalysis({
    feature: "sla_prediction",
    entityType: "ticket",
    entityId: String(ticketId),
    actorId,
    canAccess: () => true, // already checked above
    systemPrompt: PREDICTION_SYSTEM_PROMPT,
    untrustedInputs: [
      { label: "ticket_subject", text: signals.subject },
      { label: "ticket_description", text: description.slice(0, 3000) },
    ],
    trustedContext: {
      ticket_number: signals.ticketNumber,
      priority: signals.priority,
      status: signals.status,
      department: signals.departmentName,
      assignee: signals.assigneeName,
      age_minutes: signals.ageMinutes,
      elapsed_sla_minutes: signals.elapsedBusinessMinutes,
      remaining_sla_minutes: signals.remainingBusinessMinutes,
      percent_sla_elapsed: signals.percentElapsed,
      deterministic_health: signals.deterministicHealth,
      resolution_due_at: signals.resolutionDueAt,
      paused_minutes: signals.pausedMinutes,
      queue_size_same_dept: signals.queueSize,
      assignee_open_workload: signals.assigneeWorkload,
      historical_avg_resolution_minutes: signals.historicalAvgResolutionMinutes,
      historical_sample_size: signals.historicalSampleSize,
      minutes_since_last_response: signals.minutesSinceLastResponse,
      comment_count: signals.commentCount,
    },
    maxTokens: 1200,
  });

  // 5. Validate + clamp to schema.
  const r = analysis.result as Record<string, unknown>;
  const aiHealth = ["safe", "at_risk", "critical", "breached"].includes(
    String(r.health),
  )
    ? (String(r.health) as SlaHealth)
    : "safe";
  // Conservative floor: deterministic health never downgraded by AI.
  const det = signals.deterministicHealth as SlaHealth;
  const health: SlaHealth =
    ["safe", "at_risk", "critical", "breached"].includes(det) &&
    SEVERITY[det] > SEVERITY[aiHealth]
      ? det
      : aiHealth;
  const breachProbability = Math.max(
    0,
    Math.min(100, Math.round(Number(r.breach_probability ?? 0) || 0)),
  );
  const predictedBreachAt =
    typeof r.predicted_breach_at === "string" && r.predicted_breach_at
      ? r.predicted_breach_at
      : signals.resolutionDueAt;

  const factors = Array.isArray(r.factors)
    ? (r.factors as unknown[])
        .filter(
          (f): f is { factor: string; weight: number; detail: string } =>
            !!f &&
            typeof f === "object" &&
            "factor" in f &&
            "detail" in f,
        )
        .slice(0, 10)
        .map((f) => ({
          factor: String(f.factor).slice(0, 120),
          weight: Math.max(0, Math.min(100, Math.round(Number(f.weight) || 0))),
          detail: String(f.detail).slice(0, 500),
        }))
    : [];
  const recommendedActions = Array.isArray(r.recommended_actions)
    ? (r.recommended_actions as unknown[])
        .filter((a): a is string => typeof a === "string" && a.length > 0)
        .slice(0, 8)
        .map((a) => a.slice(0, 300))
    : [];

  // 6. Store.
  const { rows } = await pool.query(
    `INSERT INTO sla_predictions
       (ticket_id, breach_probability, predicted_breach_at, health, confidence,
        factors, recommended_actions, model_version)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
     RETURNING id, ticket_id AS "ticketId",
       breach_probability AS "breachProbability",
       predicted_breach_at AS "predictedBreachAt",
       health, confidence, factors, recommended_actions AS "recommendedActions",
       model_version AS "modelVersion", created_at AS "createdAt"`,
    [
      ticketId,
      breachProbability,
      predictedBreachAt,
      health,
      analysis.confidence,
      JSON.stringify(factors),
      JSON.stringify(recommendedActions),
      analysis.model,
    ],
  );
  return rows[0] as SlaPrediction;
}

export async function getPredictionById(id: number): Promise<SlaPrediction> {
  const { rows } = await pool.query(
    `SELECT id, ticket_id AS "ticketId",
            breach_probability AS "breachProbability",
            predicted_breach_at AS "predictedBreachAt",
            health, confidence, factors,
            recommended_actions AS "recommendedActions",
            model_version AS "modelVersion", created_at AS "createdAt"
     FROM sla_predictions WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new Error(`Prediction ${id} not found`);
  return rows[0] as SlaPrediction;
}

/** Latest stored prediction for a ticket, or null. */
export async function getLatestPrediction(
  ticketId: number,
): Promise<SlaPrediction | null> {
  const { rows } = await pool.query(
    `SELECT id, ticket_id AS "ticketId",
            breach_probability AS "breachProbability",
            predicted_breach_at AS "predictedBreachAt",
            health, confidence, factors,
            recommended_actions AS "recommendedActions",
            model_version AS "modelVersion", created_at AS "createdAt"
     FROM sla_predictions WHERE ticket_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [ticketId],
  );
  return (rows[0] as SlaPrediction) ?? null;
}
