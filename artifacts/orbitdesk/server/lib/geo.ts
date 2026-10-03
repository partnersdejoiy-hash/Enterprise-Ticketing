/**
 * Superpower #11 — Global Operations Map (backend).
 *
 * Aggregates per-location operational markers:
 *   open tickets, open incidents, SLA risks, assets, max severity.
 *
 * LOCATION PRIVACY: exact coordinates are only shown to super_admin/admin.
 * Everyone else receives coordinates rounded to 1 decimal place (~11 km),
 * which hides precise office/facility positions while keeping the map useful.
 * Departments without coordinates are excluded from the map entirely.
 */

import { pool } from "@workspace/db";

export interface OpsMarker {
  id: string; // dept:<id>
  department_id: number;
  department_name: string;
  label: string;
  lat: number;
  lng: number;
  /** True when coordinates were rounded for privacy. */
  approximate: boolean;
  counts: {
    open_tickets: number;
    open_incidents: number;
    sla_risks: number;
    assets: number;
    active_agents: number;
  };
  max_severity: "none" | "low" | "medium" | "high" | "critical";
}

const SEVERITY_RANK: Record<OpsMarker["max_severity"], number> = {
  none: 0, low: 1, medium: 2, high: 3, critical: 4,
};

/** Round coordinates for non-privileged viewers (~11 km grid). */
export function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

export function maySeeExactLocation(role: string): boolean {
  return ["super_admin", "admin"].includes(role);
}

export async function getOpsMarkers(opts: {
  actorRole: string;
  departmentFilter?: number | null;
  severityFilter?: string | null;
}): Promise<OpsMarker[]> {
  const exact = maySeeExactLocation(opts.actorRole);

  const deptWhere =
    opts.departmentFilter && Number.isSafeInteger(opts.departmentFilter)
      ? `AND d.id = ${opts.departmentFilter}`
      : "";

  // One row per department that has coordinates.
  const { rows } = await pool.query(
    `SELECT d.id, d.name, d.location_name,
            d.location_lat AS lat, d.location_lng AS lng,
     (SELECT count(*)::int FROM tickets t
       WHERE t.department_id = d.id
         AND t.status NOT IN ('resolved','closed')) AS open_tickets,
     (SELECT count(*)::int FROM tickets t
       WHERE t.department_id = d.id
         AND t.sla_breached = true
         AND t.status NOT IN ('resolved','closed')) AS sla_risks,
     (SELECT count(*)::int FROM configuration_items ci
       WHERE ci.department_id = d.id AND ci.deleted_at IS NULL) AS assets,
     (SELECT count(*)::int FROM users u
       WHERE u.department_id = d.id AND u.is_active = true
         AND u.role IN ('agent','manager')) AS active_agents,
     (SELECT count(DISTINCT i.id)::int FROM incidents i
       JOIN incident_tickets it ON it.incident_id = i.id
       JOIN tickets t ON t.id = it.ticket_id
       WHERE i.deleted_at IS NULL
         AND i.status NOT IN ('resolved','closed')
         AND t.department_id = d.id) AS open_incidents,
     (SELECT max(i.severity) FROM incidents i
       JOIN incident_tickets it ON it.incident_id = i.id
       JOIN tickets t ON t.id = it.ticket_id
       WHERE i.deleted_at IS NULL
         AND i.status NOT IN ('resolved','closed')
         AND t.department_id = d.id) AS incident_severity,
     (SELECT max(CASE t.priority
                  WHEN 'urgent' THEN 4 WHEN 'high' THEN 3
                  WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END)
      FROM tickets t
      WHERE t.department_id = d.id
        AND t.status NOT IN ('resolved','closed')) AS ticket_priority_rank
     FROM departments d
     WHERE d.location_lat IS NOT NULL AND d.location_lng IS NOT NULL
     ${deptWhere}
     ORDER BY d.name`,
  );

  const markers: OpsMarker[] = rows.map((r) => {
    // Severity: worst of incident severity and ticket priority rank.
    const sev = String(r.incident_severity ?? "none").toLowerCase();
    const rankSev = { 4: "critical", 3: "high", 2: "medium", 1: "low" }[
      Number(r.ticket_priority_rank) ?? 0
    ] as OpsMarker["max_severity"] | undefined;
    const sevRank: Record<string, number> = {
      none: 0, low: 1, medium: 2, high: 3, critical: 4,
    };
    const incidentRank = sevRank[sev] ?? 0;
    const ticketRank = sevRank[rankSev ?? "none"] ?? 0;
    const maxRank = Math.max(incidentRank, ticketRank);
    const max_severity = (Object.keys(sevRank).find(
      (k) => sevRank[k] === maxRank,
    ) ?? "none") as OpsMarker["max_severity"];

    const lat = Number(r.lat);
    const lng = Number(r.lng);
    return {
      id: `dept:${r.id}`,
      department_id: r.id,
      department_name: r.name,
      label: r.location_name ?? r.name,
      lat: exact ? lat : roundCoordinate(lat),
      lng: exact ? lng : roundCoordinate(lng),
      approximate: !exact,
      counts: {
        open_tickets: r.open_tickets,
        open_incidents: r.open_incidents,
        sla_risks: r.sla_risks,
        assets: r.assets,
        active_agents: r.active_agents,
      },
      max_severity,
    };
  });

  if (opts.severityFilter && opts.severityFilter !== "all") {
    const minRank = SEVERITY_RANK[opts.severityFilter as OpsMarker["max_severity"]] ?? 0;
    return markers.filter((m) => SEVERITY_RANK[m.max_severity] >= minRank);
  }
  return markers;
}

/** Detail for a clicked marker: tickets, incidents, assets, SLA risks, agents. */
export async function getMarkerDetail(
  departmentId: number,
  actorRole: string,
): Promise<{
  department: { id: number; name: string; location_name: string | null };
  open_tickets: { id: number; ticket_number: string; subject: string; priority: string; status: string }[];
  open_incidents: { id: number; incident_number: string; title: string; severity: string; status: string }[];
  sla_risks: { id: number; ticket_number: string; subject: string; sla_deadline: string | null }[];
  assets: { id: number; name: string; ci_type: string; health: string }[];
  active_agents: { id: number; name: string }[];
}> {
  if (!Number.isSafeInteger(departmentId) || departmentId < 1) {
    throw new Error("Invalid department id");
  }
  const exact = maySeeExactLocation(actorRole);

  const { rows: deptRows } = await pool.query(
    `SELECT id, name, location_name,
            ${exact ? "location_lat, location_lng" : "NULL AS location_lat, NULL AS location_lng"}
     FROM departments WHERE id = $1 LIMIT 1`,
    [departmentId],
  );
  if (!deptRows[0]) throw new Error("Department not found");

  const [tickets, incidents, slaRisks, assets, agents] = await Promise.all([
    pool.query(
      `SELECT id, ticket_number, subject, priority, status FROM tickets
       WHERE department_id = $1 AND status NOT IN ('resolved','closed')
       ORDER BY
         CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at DESC LIMIT 25`,
      [departmentId],
    ),
    pool.query(
      `SELECT DISTINCT i.id, i.incident_number, i.title, i.severity, i.status
       FROM incidents i
       JOIN incident_tickets it ON it.incident_id = i.id
       JOIN tickets t ON t.id = it.ticket_id
       WHERE i.deleted_at IS NULL AND i.status NOT IN ('resolved','closed')
         AND t.department_id = $1
       ORDER BY i.started_at DESC LIMIT 15`,
      [departmentId],
    ),
    pool.query(
      `SELECT id, ticket_number, subject, sla_deadline FROM tickets
       WHERE department_id = $1 AND sla_breached = true
         AND status NOT IN ('resolved','closed')
       ORDER BY sla_deadline ASC NULLS LAST LIMIT 15`,
      [departmentId],
    ),
    pool.query(
      `SELECT id, name, ci_type, health FROM configuration_items
       WHERE department_id = $1 AND deleted_at IS NULL
       ORDER BY
         CASE health WHEN 'critical' THEN 0 WHEN 'at_risk' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END,
         name LIMIT 25`,
      [departmentId],
    ),
    pool.query(
      `SELECT id, name FROM users
       WHERE department_id = $1 AND is_active = true
         AND role IN ('agent','manager')
       ORDER BY name LIMIT 25`,
      [departmentId],
    ),
  ]);

  return {
    department: {
      id: deptRows[0].id,
      name: deptRows[0].name,
      location_name: deptRows[0].location_name,
    },
    open_tickets: tickets.rows,
    open_incidents: incidents.rows,
    sla_risks: slaRisks.rows,
    assets: assets.rows,
    active_agents: agents.rows,
  };
}
