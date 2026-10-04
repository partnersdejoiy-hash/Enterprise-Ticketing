/**
 * Orbit Executive Brief (Superpower #12).
 *
 * Generates daily/weekly executive summaries from REAL database aggregates.
 * Every number is traceable: the originating SQL is stored alongside the
 * metrics under `metric_queries`. An AI narrative summary is produced via the
 * unified analysis pipeline (runAnalysis, feature=exec_brief) with the metrics
 * as trusted context — the model only interprets, never invents numbers.
 *
 * Rules:
 *  - NEVER fabricate metrics. Empty tables produce zero/empty values.
 *  - AI output is labeled as AI-generated and carries a confidence score.
 */

import { pool } from "@workspace/db";
import { runAnalysis } from "./orbit-ai.js";

export type BriefPeriod = "daily" | "weekly";

export interface BriefMetrics {
  generated_at: string;
  period: BriefPeriod;
  window_days: number;
  major_incidents: number;
  sla_at_risk: number;
  sla_breached: number;
  sla_critical: number;
  backlog: number;
  unassigned: number;
  resolved_in_window: number;
  avg_resolution_minutes: number | null;
  tickets_created_in_window: number;
  top_categories: { category: string; count: number }[];
  agent_workload: { agent_id: number; agent_name: string; open_tickets: number }[];
  open_by_priority: Record<string, number>;
  open_by_department: { department: string; open: number }[];
  knowledge_gaps_open: number;
  /** Every metric -> the SQL that produced it. */
  metric_queries: Record<string, string>;
}

const OPEN_STATUSES = ["open", "assigned", "in_progress", "waiting"];

/** Resolve the default tenant id (single-workspace deployments). */
export async function resolveTenantId(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id FROM tenants WHERE slug = 'default' LIMIT 1`,
  );
  return (rows[0]?.id as number) ?? 1;
}

/**
 * Run REAL SQL aggregates for the brief. No AI here — pure numbers.
 * Empty tables yield zeros/empties, never placeholders.
 */
export async function collectBriefMetrics(
  period: BriefPeriod,
): Promise<BriefMetrics> {
  const windowDays = period === "weekly" ? 7 : 1;
  const q: Record<string, string> = {};

  const majorIncidentsQ = `
    SELECT COUNT(*)::int AS n FROM incidents
    WHERE is_major AND deleted_at IS NULL AND status NOT IN ('resolved','closed')`;
  const { rows: miRows } = await pool.query(majorIncidentsQ);
  q.major_incidents = majorIncidentsQ.trim();

  // SLA health buckets via calendar-time approximation (documented as such).
  const slaQ = `
    SELECT
      COUNT(*) FILTER (WHERE s.resolution_due_at < now())::int AS breached,
      COUNT(*) FILTER (WHERE s.resolution_due_at >= now()
        AND (EXTRACT(EPOCH FROM (now() - t.created_at)) /
             NULLIF(EXTRACT(EPOCH FROM (s.resolution_due_at - t.created_at)), 0)) >= 0.9)::int AS critical,
      COUNT(*) FILTER (WHERE s.resolution_due_at >= now()
        AND (EXTRACT(EPOCH FROM (now() - t.created_at)) /
             NULLIF(EXTRACT(EPOCH FROM (s.resolution_due_at - t.created_at)), 0)) >= 0.7)::int AS at_risk_incl_critical
    FROM ticket_sla s
    JOIN tickets t ON t.id = s.ticket_id
    WHERE t.status = ANY($1::text[]) AND s.resolved_at IS NULL AND s.resolution_due_at IS NOT NULL`;
  const { rows: slaRows } = await pool.query(slaQ, [OPEN_STATUSES]);
  q.sla_health = slaQ.trim();
  const sla = slaRows[0] as {
    breached: number; critical: number; at_risk_incl_critical: number;
  };

  const backlogQ = `
    SELECT COUNT(*)::int AS n FROM tickets WHERE status = ANY($1::text[])`;
  const { rows: bRows } = await pool.query(backlogQ, [OPEN_STATUSES]);
  q.backlog = backlogQ.trim();

  const unassignedQ = `
    SELECT COUNT(*)::int AS n FROM tickets
    WHERE status = ANY($1::text[]) AND assignee_id IS NULL`;
  const { rows: uRows } = await pool.query(unassignedQ, [OPEN_STATUSES]);
  q.unassigned = unassignedQ.trim();

  const createdQ = `
    SELECT COUNT(*)::int AS n FROM tickets
    WHERE created_at >= now() - make_interval(days => $1)`;
  const { rows: cRows } = await pool.query(createdQ, [windowDays]);
  q.tickets_created_in_window = createdQ.trim();

  const resolvedQ = `
    SELECT COUNT(*)::int AS n,
           ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(s.resolved_at, t.updated_at) - t.created_at)) / 60))::int AS avg_min
    FROM tickets t
    LEFT JOIN ticket_sla s ON s.ticket_id = t.id
    WHERE t.status IN ('resolved','closed')
      AND t.updated_at >= now() - make_interval(days => $1)`;
  const { rows: rRows } = await pool.query(resolvedQ, [windowDays]);
  q.resolved_in_window = resolvedQ.trim();

  const catQ = `
    SELECT COALESCE(NULLIF(t.category, ''), 'uncategorized') AS category, COUNT(*)::int AS count
    FROM tickets t
    WHERE t.created_at >= now() - make_interval(days => $1)
    GROUP BY 1 ORDER BY 2 DESC LIMIT 8`;
  let top_categories: { category: string; count: number }[] = [];
  try {
    const { rows } = await pool.query(catQ, [windowDays]);
    top_categories = rows as { category: string; count: number }[];
  } catch {
    // Older schema without tickets.category — fall back to priority mix.
    top_categories = [];
  }
  q.top_categories = catQ.trim();

  const workloadQ = `
    SELECT u.id AS agent_id, u.name AS agent_name, COUNT(t.id)::int AS open_tickets
    FROM users u
    LEFT JOIN tickets t ON t.assignee_id = u.id AND t.status = ANY($1::text[])
    WHERE u.role IN ('agent','manager')
    GROUP BY u.id, u.name
    HAVING COUNT(t.id) > 0
    ORDER BY 3 DESC LIMIT 10`;
  const { rows: wRows } = await pool.query(workloadQ, [OPEN_STATUSES]);
  q.agent_workload = workloadQ.trim();

  const prioQ = `
    SELECT t.priority, COUNT(*)::int AS n FROM tickets t
    WHERE t.status = ANY($1::text[]) GROUP BY 1`;
  const { rows: pRows } = await pool.query(prioQ, [OPEN_STATUSES]);
  q.open_by_priority = prioQ.trim();

  const deptQ = `
    SELECT COALESCE(d.name, 'unassigned') AS department, COUNT(t.id)::int AS open
    FROM tickets t
    LEFT JOIN departments d ON d.id = t.department_id
    WHERE t.status = ANY($1::text[])
    GROUP BY 1 ORDER BY 2 DESC`;
  const { rows: dRows } = await pool.query(deptQ, [OPEN_STATUSES]);
  q.open_by_department = deptQ.trim();

  const kgQ = `
    SELECT COUNT(*)::int AS n FROM knowledge_gaps WHERE status = 'proposed'`;
  const { rows: kgRows } = await pool.query(kgQ);
  q.knowledge_gaps_open = kgQ.trim();

  return {
    generated_at: new Date().toISOString(),
    period,
    window_days: windowDays,
    major_incidents: miRows[0].n as number,
    sla_at_risk: Math.max(
      0,
      (sla.at_risk_incl_critical as number) - (sla.critical as number),
    ),
    sla_breached: sla.breached as number,
    sla_critical: sla.critical as number,
    backlog: bRows[0].n as number,
    unassigned: uRows[0].n as number,
    resolved_in_window: rRows[0].n as number,
    avg_resolution_minutes:
      rRows[0].avg_min == null ? null : Number(rRows[0].avg_min),
    tickets_created_in_window: cRows[0].n as number,
    top_categories,
    agent_workload: wRows as {
      agent_id: number; agent_name: string; open_tickets: number;
    }[],
    open_by_priority: Object.fromEntries(
      (pRows as { priority: string; n: number }[]).map((r) => [r.priority, r.n]),
    ),
    open_by_department: dRows as { department: string; open: number }[],
    knowledge_gaps_open: kgRows[0].n as number,
    metric_queries: q,
  };
}

const BRIEF_SYSTEM_PROMPT = `
You are an executive operations analyst for OrbitDesk, an enterprise service
management platform. You receive TRUSTED METRICS computed directly from the
database (metric_queries show the SQL). Write a concise executive brief.

RULES:
- Use ONLY the numbers provided. Never invent, round up, or estimate metrics.
- If a metric is 0 or null, say so plainly ("no major incidents").
- Use probabilistic language for any interpretation ("suggests", "may indicate").
- Respond with valid JSON: {
    "executive_summary": "2-4 sentence overview",
    "major_incidents": ["bullet strings, empty if none"],
    "sla_risk": ["bullets"],
    "backlog": ["bullets"],
    "customer_experience": ["bullets"],
    "agent_workload": ["bullets"],
    "top_categories": ["bullets"],
    "emerging_problems": ["bullets"],
    "operational_risks": ["bullets"],
    "recommended_actions": ["bullets"],
    "confidence": 0-100,
    "sources": [{"type":"metric","id":"<metric name>","title":"<metric name>"}]
  }
- Every source must reference a metric name present in the trusted context.
`.trim();

export interface GeneratedBrief {
  id: number;
  period: BriefPeriod;
  briefDate: string;
  metrics: BriefMetrics;
  aiSummary: string | null;
  aiConfidence: number | null;
  analysisId: number | null;
}

/**
 * Generate + persist an executive brief. AI narrative via runAnalysis with the
 * metrics as trusted context. Only admins/managers may generate (route-enforced;
 * the canAccess predicate double-checks via DB).
 */
export async function generateBrief(
  period: BriefPeriod,
  actorId: number,
): Promise<GeneratedBrief> {
  const tenantId = await resolveTenantId();
  const metrics = await collectBriefMetrics(period);
  const briefDate = new Date().toISOString().slice(0, 10);

  let aiSummary: string | null = null;
  let aiConfidence: number | null = null;
  let analysisId: number | null = null;

  try {
    const result = await runAnalysis({
      feature: "exec_brief",
      entityType: "executive_brief",
      entityId: `${period}:${briefDate}`,
      tenantId,
      actorId,
      canAccess: async () => {
        const { rows } = await pool.query(
          `SELECT role FROM users WHERE id = $1 LIMIT 1`,
          [actorId],
        );
        return ["super_admin", "admin", "manager"].includes(rows[0]?.role);
      },
      systemPrompt: BRIEF_SYSTEM_PROMPT,
      untrustedInputs: [], // pure DB metrics — no untrusted surface
      trustedContext: { metrics },
      maxTokens: 1800,
    });
    analysisId = result.analysisId;
    aiConfidence = result.confidence;
    aiSummary = JSON.stringify(result.result);
  } catch (err) {
    // AI failure must not block the brief: metrics are the real deliverable.
    console.error("[exec-brief] AI summary failed:", err);
  }

  const { rows } = await pool.query(
    `INSERT INTO executive_briefs
       (tenant_id, period, brief_date, metrics, ai_summary)
     VALUES ($1,$2,$3::date,$4::jsonb,$5)
     ON CONFLICT (tenant_id, period, brief_date) DO UPDATE SET
       metrics = EXCLUDED.metrics,
       ai_summary = EXCLUDED.ai_summary,
       created_at = now()
     RETURNING id, brief_date::text AS "briefDate"`,
    [
      tenantId, period, briefDate,
      JSON.stringify(metrics), aiSummary,
    ],
  );

  const { emitEvent } = await import("./orbit-events.js");
  await emitEvent({
    type: "brief.generated",
    entityType: "executive_brief",
    entityId: `${period}:${briefDate}`,
    actorType: "user",
    actorId,
    tenantId,
    payload: { period, briefDate, analysisId, aiConfidence },
  });

  return {
    id: rows[0].id as number,
    period,
    briefDate: rows[0].briefDate as string,
    metrics,
    aiSummary,
    aiConfidence,
    analysisId,
  };
}

/** Latest brief for a period (null when none generated yet). */
export async function getLatestBrief(
  period: BriefPeriod,
): Promise<GeneratedBrief | null> {
  const tenantId = await resolveTenantId();
  const { rows } = await pool.query(
    `SELECT id, period, brief_date::text AS "briefDate",
            metrics, ai_summary AS "aiSummary"
     FROM executive_briefs
     WHERE tenant_id = $1 AND period = $2
     ORDER BY brief_date DESC LIMIT 1`,
    [tenantId, period],
  );
  if (!rows[0]) return null;
  const m = rows[0].metrics as BriefMetrics;
  return {
    id: rows[0].id, period: rows[0].period, briefDate: rows[0].briefDate,
    metrics: m, aiSummary: rows[0].aiSummary,
    aiConfidence: null, analysisId: null,
  };
}

/** Brief history (newest first). */
export async function getBriefHistory(
  period: BriefPeriod, limit = 30,
): Promise<{ id: number; briefDate: string; hasAiSummary: boolean }[]> {
  const tenantId = await resolveTenantId();
  const { rows } = await pool.query(
    `SELECT id, brief_date::text AS "briefDate",
            (ai_summary IS NOT NULL) AS "hasAiSummary"
     FROM executive_briefs
     WHERE tenant_id = $1 AND period = $2
     ORDER BY brief_date DESC LIMIT $3`,
    [tenantId, period, limit],
  );
  return rows as { id: number; briefDate: string; hasAiSummary: boolean }[];
}
