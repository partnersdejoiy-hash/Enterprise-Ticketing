/**
 * Orbit Service Health Score (Superpower #26).
 *
 * For every configuration item, compute a 0-100 health score from REAL data:
 *   - monitoring events (30d) tied to the CI
 *   - incidents (30d) correlated to the CI via event_correlations
 *   - ticket volume flowing through those incidents (incident_tickets)
 *   - SLA breaches among that ticket volume
 *
 * The score is fully explainable: every computation returns a breakdown of
 * {factor, value, weight, detail}. Levels:
 *   healthy (>=80) | watch (60-79) | at_risk (40-59) | critical (<40)
 */

import { pool } from "@workspace/db";

export type HealthLevel = "healthy" | "watch" | "at_risk" | "critical";

export interface HealthFactor {
  factor: string;
  value: number;
  weight: number; // points at stake (deduction when value > 0)
  detail: string;
}

export interface ServiceHealth {
  ciId: number;
  ciName: string;
  ciType: string;
  score: number; // 0-100
  level: HealthLevel;
  breakdown: HealthFactor[];
  computedAt: string;
}

const LOOKBACK_DAYS = 30;

/**
 * Pure scoring function — unit-testable without a database.
 * `signals` carries the raw counts; returns score + level.
 */
export function scoreHealth(signals: {
  criticalEvents: number;
  highEvents: number;
  warningEvents: number;
  openIncidents: number;
  resolvedIncidents30d: number;
  ticketVolume30d: number;
  slaBreaches30d: number;
}): { score: number; level: HealthLevel; deductions: { factor: string; points: number }[] } {
  const deductions: { factor: string; points: number }[] = [];
  const deduct = (factor: string, points: number) => {
    if (points > 0) deductions.push({ factor, points: Math.round(points) });
  };

  // Monitoring events (weight 35): critical 8 pts each (cap 24), high 4 (cap 12),
  // warning 1 (cap 6).
  deduct("monitoring_critical_events", Math.min(24, signals.criticalEvents * 8));
  deduct("monitoring_high_events", Math.min(12, signals.highEvents * 4));
  deduct("monitoring_warning_events", Math.min(6, signals.warningEvents * 1));

  // Incidents (weight 30): each open incident 10 pts (cap 20); each resolved
  // in 30d 2 pts (cap 10).
  deduct("open_incidents", Math.min(20, signals.openIncidents * 10));
  deduct("resolved_incidents_30d", Math.min(10, signals.resolvedIncidents30d * 2));

  // Ticket volume (weight 15): 1 pt per 10 tickets (cap 15).
  deduct("ticket_volume_30d", Math.min(15, Math.floor(signals.ticketVolume30d / 10)));

  // SLA breaches (weight 20): 5 pts each (cap 20).
  deduct("sla_breaches_30d", Math.min(20, signals.slaBreaches30d * 5));

  const total = deductions.reduce((s, d) => s + d.points, 0);
  const score = Math.max(0, 100 - total);
  const level: HealthLevel =
    score >= 80 ? "healthy" : score >= 60 ? "watch" : score >= 40 ? "at_risk" : "critical";
  return { score, level, deductions };
}

/**
 * Compute health for one CI from real DB data and persist it to
 * configuration_items (health, health_score, health_computed_at).
 */
export async function computeServiceHealth(ciId: number): Promise<ServiceHealth> {
  const { rows: ciRows } = await pool.query(
    `SELECT id, name, ci_type AS "ciType"
     FROM configuration_items WHERE id = $1 AND deleted_at IS NULL`,
    [ciId],
  );
  const ci = ciRows[0];
  if (!ci) throw new Error(`Configuration item ${ciId} not found`);

  // Monitoring events for this CI in the last 30 days.
  const { rows: evRows } = await pool.query(
    `SELECT severity, COUNT(*)::int AS n
     FROM monitoring_events
     WHERE ci_id = $1 AND first_seen_at >= now() - make_interval(days => $2)
     GROUP BY severity`,
    [ciId, LOOKBACK_DAYS],
  );
  const evBySev: Record<string, number> = {};
  for (const r of evRows) evBySev[r.severity] = r.n as number;

  // Incidents correlated to this CI via event_correlations.
  const { rows: incRows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE i.status NOT IN ('resolved','closed'))::int AS open_incidents,
       COUNT(*) FILTER (WHERE i.status IN ('resolved','closed'))::int AS resolved_incidents
     FROM incidents i
     JOIN event_correlations ec ON ec.incident_id = i.id
     JOIN monitoring_events me ON me.id = ec.event_id
     WHERE me.ci_id = $1
       AND i.deleted_at IS NULL
       AND i.started_at >= now() - make_interval(days => $2)`,
    [ciId, LOOKBACK_DAYS],
  );
  const inc = incRows[0] as { open_incidents: number; resolved_incidents: number };

  // Ticket volume + SLA breaches flowing through those incidents.
  const { rows: tRows } = await pool.query(
    `SELECT
       COUNT(DISTINCT it.ticket_id)::int AS ticket_volume,
       COUNT(DISTINCT it.ticket_id) FILTER (
         WHERE s.resolution_due_at < now() AND s.resolved_at IS NULL
       )::int AS sla_breaches
     FROM incident_tickets it
     JOIN event_correlations ec ON ec.incident_id = it.incident_id
     JOIN monitoring_events me ON me.id = ec.event_id
     JOIN incidents i ON i.id = it.incident_id
     LEFT JOIN ticket_sla s ON s.ticket_id = it.ticket_id
     WHERE me.ci_id = $1
       AND i.deleted_at IS NULL
       AND i.started_at >= now() - make_interval(days => $2)`,
    [ciId, LOOKBACK_DAYS],
  );
  const t = tRows[0] as { ticket_volume: number; sla_breaches: number };

  const signals = {
    criticalEvents: evBySev["critical"] ?? 0,
    highEvents: evBySev["high"] ?? 0,
    warningEvents: evBySev["warning"] ?? 0,
    openIncidents: inc.open_incidents,
    resolvedIncidents30d: inc.resolved_incidents,
    ticketVolume30d: t.ticket_volume,
    slaBreaches30d: t.sla_breaches,
  };
  const { score, level, deductions } = scoreHealth(signals);

  const breakdown: HealthFactor[] = [
    {
      factor: "monitoring_events",
      value: signals.criticalEvents + signals.highEvents + signals.warningEvents,
      weight: 35,
      detail: `${signals.criticalEvents} critical, ${signals.highEvents} high, ${signals.warningEvents} warning in last ${LOOKBACK_DAYS}d`,
    },
    {
      factor: "incidents",
      value: signals.openIncidents + signals.resolvedIncidents30d,
      weight: 30,
      detail: `${signals.openIncidents} open, ${signals.resolvedIncidents30d} resolved in last ${LOOKBACK_DAYS}d (correlated to this service)`,
    },
    {
      factor: "ticket_volume",
      value: signals.ticketVolume30d,
      weight: 15,
      detail: `${signals.ticketVolume30d} tickets linked via correlated incidents in last ${LOOKBACK_DAYS}d`,
    },
    {
      factor: "sla_breaches",
      value: signals.slaBreaches30d,
      weight: 20,
      detail: `${signals.slaBreaches30d} SLA breaches among correlated tickets in last ${LOOKBACK_DAYS}d`,
    },
  ];

  const computedAt = new Date().toISOString();
  await pool.query(
    `UPDATE configuration_items
     SET health = $2, health_score = $3, health_computed_at = $4, updated_at = now()
     WHERE id = $1`,
    [ciId, level, score, computedAt],
  );

  return {
    ciId, ciName: ci.name as string, ciType: ci.ciType as string,
    score, level, breakdown, computedAt,
  };
}

/** List all active CIs with their stored health (recompute on demand). */
export async function listServiceHealth(): Promise<
  { id: number; name: string; ciType: string; status: string; health: HealthLevel; healthScore: number | null; healthComputedAt: string | null }[]
> {
  const { rows } = await pool.query(
    `SELECT id, name, ci_type AS "ciType", status, health,
            health_score AS "healthScore",
            health_computed_at AS "healthComputedAt"
     FROM configuration_items
     WHERE deleted_at IS NULL
     ORDER BY health_score ASC NULLS LAST, name ASC`,
  );
  return rows as {
    id: number; name: string; ciType: string; status: string;
    health: HealthLevel; healthScore: number | null; healthComputedAt: string | null;
  }[];
}

/** Counts by health level for the command center. */
export async function healthLevelCounts(): Promise<Record<HealthLevel, number>> {
  const { rows } = await pool.query(
    `SELECT health, COUNT(*)::int AS n
     FROM configuration_items WHERE deleted_at IS NULL GROUP BY health`,
  );
  const out: Record<HealthLevel, number> = {
    healthy: 0, watch: 0, at_risk: 0, critical: 0,
  };
  for (const r of rows as { health: HealthLevel; n: number }[]) {
    if (r.health in out) out[r.health] = r.n;
  }
  return out;
}
