/**
 * Predictive Operations (#4) — deterministic risk detection, no AI needed.
 *
 * Compares the last 7 days of operational volume against the prior 21 days
 * across three dimensions (department ticket volume, incident severity,
 * emerging subject keywords) and records probabilistic risk predictions
 * for anything that looks like an emerging spike.
 */

import { pool } from "@workspace/db";
import { emitEvent, EventTypes } from "./orbit-events.js";

const STAFF_ROLES = ["super_admin", "admin", "manager", "agent"];

/**
 * Pure spike test: is the current 7-day daily rate more than 1.5x the
 * prior 21-day daily rate?
 */
export function detectSpike(
  current7d: number,
  prior21d: number,
): { isSpike: boolean; ratio: number } {
  if (prior21d <= 0) return { isSpike: false, ratio: 0 };
  const ratio = current7d / 7 / (prior21d / 21);
  return { isSpike: ratio > 1.5, ratio };
}

function httpError(status: number, message: string): Error & { status: number } {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

function levelFor(ratio: number): "low" | "medium" | "high" | "critical" {
  if (ratio > 3) return "critical";
  if (ratio > 2) return "high";
  return "medium";
}

const SUGGESTED_ACTIONS = [
  { action: "create_problem", label: "Create problem" },
  { action: "create_investigation", label: "Start investigation" },
  { action: "preventive_change", label: "Schedule preventive change" },
];

interface SpikeCandidate {
  risk_type: string;
  ref_type: string;
  ref_id: string;
  title: string;
  metric: string;
  current7d: number;
  prior21d: number;
  ratio: number;
}

/**
 * Analyze operational risk signals. Staff-only. Dedupes against open risks
 * of the same (risk_type, ref_type, ref_id) created in the last 24h.
 */
export async function analyzeOperationalRisks(
  actorId: number,
): Promise<Record<string, unknown>[]> {
  const { rows: userRows } = await pool.query(
    "SELECT id, role FROM users WHERE id = $1",
    [actorId],
  );
  const user = userRows[0] as { id: number; role: string } | undefined;
  if (!user || !STAFF_ROLES.includes(user.role)) {
    throw httpError(403, "Staff access required");
  }
  let tenantId: number | null = null;
  try {
    const { rows: tRows } = await pool.query(
      "SELECT id FROM tenants WHERE slug = 'default' LIMIT 1",
    );
    tenantId = (tRows[0]?.id as number | undefined) ?? null;
  } catch {
    tenantId = null;
  }

  const candidates: SpikeCandidate[] = [];

  // 1. Ticket volume by department: last 7d vs prior 21d.
  const { rows: deptRows } = await pool.query(
    `SELECT d.id AS department_id, d.name AS department_name,
            COUNT(*) FILTER (WHERE t.created_at >= now() - interval '7 days') AS c7,
            COUNT(*) FILTER (WHERE t.created_at >= now() - interval '28 days'
                             AND t.created_at < now() - interval '7 days') AS c21
     FROM tickets t
     JOIN departments d ON d.id = t.department_id
     WHERE t.created_at >= now() - interval '28 days'
     GROUP BY d.id, d.name`,
  );
  for (const r of deptRows) {
    const c7 = Number(r.c7);
    const c21 = Number(r.c21);
    if (c7 < 5) continue;
    const { isSpike, ratio } = detectSpike(c7, c21);
    if (!isSpike) continue;
    candidates.push({
      risk_type: "department",
      ref_type: "department",
      ref_id: String(r.department_id),
      title: `Potential elevated ticket volume detected in ${r.department_name}`,
      metric: "department_ticket_volume",
      current7d: c7,
      prior21d: c21,
      ratio,
    });
  }

  // 2. Incident counts by severity: last 7d vs prior 21d.
  const { rows: incRows } = await pool.query(
    `SELECT severity,
            COUNT(*) FILTER (WHERE started_at >= now() - interval '7 days') AS c7,
            COUNT(*) FILTER (WHERE started_at >= now() - interval '28 days'
                             AND started_at < now() - interval '7 days') AS c21
     FROM incidents
     WHERE started_at >= now() - interval '28 days'
       AND deleted_at IS NULL
     GROUP BY severity`,
  );
  for (const r of incRows) {
    const c7 = Number(r.c7);
    const c21 = Number(r.c21);
    if (c7 < 5) continue;
    const { isSpike, ratio } = detectSpike(c7, c21);
    if (!isSpike) continue;
    candidates.push({
      risk_type: "service",
      ref_type: "incident_severity",
      ref_id: String(r.severity),
      title: `Potential spike in ${r.severity}-severity incidents detected`,
      metric: "incident_count_by_severity",
      current7d: c7,
      prior21d: c21,
      ratio,
    });
  }

  // 3. Emerging keywords in ticket subjects: last 7d vs prior 21d.
  const { rows: kwRows } = await pool.query(
    `SELECT kw AS keyword,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') AS c7,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '28 days'
                             AND created_at < now() - interval '7 days') AS c21
     FROM (
       SELECT DISTINCT t.id, t.created_at, w AS kw
       FROM tickets t,
            unnest(string_to_array(
              lower(regexp_replace(t.subject, '[^a-z0-9 ]', ' ', 'g')), ' ')) AS w
       WHERE t.created_at >= now() - interval '28 days'
         AND length(w) >= 4
     ) k
     GROUP BY kw
     ORDER BY c7 DESC
     LIMIT 50`,
  );
  for (const r of kwRows) {
    const c7 = Number(r.c7);
    const c21 = Number(r.c21);
    if (c7 < 5) continue;
    const { isSpike, ratio } = detectSpike(c7, c21);
    if (!isSpike) continue;
    candidates.push({
      risk_type: "service",
      ref_type: "subject_keyword",
      ref_id: String(r.keyword),
      title: `Potential emerging issue: rising mentions of '${r.keyword}' in ticket subjects`,
      metric: "subject_keyword_frequency",
      current7d: c7,
      prior21d: c21,
      ratio,
    });
  }

  const created: Record<string, unknown>[] = [];
  for (const c of candidates) {
    // Dedupe: skip if an open risk for the same signal exists from the last 24h.
    const { rows: dupes } = await pool.query(
      `SELECT id FROM risk_predictions
       WHERE tenant_id IS NOT DISTINCT FROM $1
         AND risk_type = $2 AND ref_type = $3 AND ref_id = $4
         AND status = 'open'
         AND created_at >= now() - interval '24 hours'
       LIMIT 1`,
      [tenantId, c.risk_type, c.ref_type, c.ref_id],
    );
    if (dupes.length > 0) continue;

    const riskLevel = levelFor(c.ratio);
    const evidence = [
      {
        metric: c.metric,
        current_7d: c.current7d,
        prior_21d_avg: Math.round((c.prior21d / 21) * 100) / 100,
        ratio: Math.round(c.ratio * 100) / 100,
      },
    ];
    const { rows } = await pool.query(
      `INSERT INTO risk_predictions
         (tenant_id, risk_type, ref_type, ref_id, risk_level, title,
          evidence, suggested_actions, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'open')
       RETURNING id, risk_type, ref_type, ref_id, risk_level, title,
                 evidence, suggested_actions, status, created_at`,
      [
        tenantId,
        c.risk_type,
        c.ref_type,
        c.ref_id,
        riskLevel,
        c.title,
        JSON.stringify(evidence),
        JSON.stringify(SUGGESTED_ACTIONS),
      ],
    );
    const risk = rows[0];
    created.push(risk);

    await emitEvent({
      type: EventTypes.RISK_PREDICTED,
      entityType: "risk_prediction",
      entityId: String(risk.id),
      actorId,
      actorType: "user",
      tenantId,
      payload: {
        risk_type: c.risk_type,
        ref_type: c.ref_type,
        ref_id: c.ref_id,
        risk_level: riskLevel,
        title: c.title,
        evidence,
      },
    });
  }

  return created;
}
