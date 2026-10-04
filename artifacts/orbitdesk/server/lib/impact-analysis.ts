/**
 * Superpower #17 — AI Impact Analysis.
 *
 * BEFORE a change is approved, analyze what it could affect:
 *   affected services (CI graph traversal) -> departments using those
 *   services -> recent incidents in those departments -> historical
 *   changes that touched the same CIs.
 *
 * This is ADVISORY ONLY. It never approves, executes, or modifies
 * anything. A human must approve the change (see routes/changes.ts).
 *
 * All AI reasoning goes through runAnalysis() (orbit-ai.ts): permission
 * checks, prompt-injection protection, PII shielding, audit logging,
 * confidence scores, and source grounding are enforced there.
 */

import { pool } from "@workspace/db";
import { runAnalysis, type AnalysisSource } from "./orbit-ai.js";

export interface ChangeImpact {
  potential_impact: string;
  risk_level: "low" | "medium" | "high" | "critical";
  affected_services: { ci_id: number; name: string; ci_type: string }[];
  affected_departments: { id: number; name: string }[];
  affected_customers_estimate: number;
  rollback_concerns: string[];
  evidence: { label: string; detail: string }[];
  confidence: number;
  sources: AnalysisSource[];
  analysis_id: number;
}

interface Actor {
  id: number;
  role: string;
  departmentId: number | null;
}

async function getActor(actorId: number): Promise<Actor | null> {
  const { rows } = await pool.query(
    `SELECT id, role, department_id AS "departmentId" FROM users WHERE id = $1 AND is_active = true LIMIT 1`,
    [actorId],
  );
  return rows[0] ?? null;
}

/** Who may see a change record. Employees/external see only their own. */
export function canViewChange(
  user: Actor,
  change: { created_by_id: number | null },
): boolean {
  if (["super_admin", "admin", "manager", "agent"].includes(user.role))
    return true;
  return change.created_by_id === user.id;
}

export function canDecideChange(user: Actor): boolean {
  return ["super_admin", "admin", "manager"].includes(user.role);
}

/**
 * Traverse the CI relationship graph from seed CI ids.
 * BFS, depth-limited, cycle-safe (visited set). Both edge directions.
 */
export async function traverseCiGraph(
  seedCiIds: number[],
  maxDepth = 4,
): Promise<{ id: number; name: string; ci_type: string; depth: number }[]> {
  if (seedCiIds.length === 0) return [];
  const visited = new Map<number, number>(); // ci_id -> depth
  const queue: { id: number; depth: number }[] = [];
  for (const id of seedCiIds) {
    visited.set(id, 0);
    queue.push({ id, depth: 0 });
  }
  const meta = new Map<number, { name: string; ci_type: string }>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    const { rows } = await pool.query(
      `SELECT ci.id, ci.name, ci.ci_type,
              CASE WHEN r.source_ci_id = $1 THEN r.target_ci_id ELSE r.source_ci_id END AS neighbor
       FROM ci_relationships r
       JOIN configuration_items ci
         ON ci.id = CASE WHEN r.source_ci_id = $1 THEN r.target_ci_id ELSE r.source_ci_id END
       WHERE (r.source_ci_id = $1 OR r.target_ci_id = $1)
         AND ci.deleted_at IS NULL`,
      [id],
    );
    for (const row of rows) {
      if (!meta.has(row.id)) meta.set(row.id, { name: row.name, ci_type: row.ci_type });
      if (!visited.has(row.neighbor)) {
        visited.set(row.neighbor, depth + 1);
        queue.push({ id: row.neighbor, depth: depth + 1 });
      }
    }
  }

  // Ensure seed CIs have metadata too.
  const missing = [...visited.keys()].filter((id) => !meta.has(id));
  if (missing.length > 0) {
    const { rows } = await pool.query(
      `SELECT id, name, ci_type FROM configuration_items WHERE id = ANY($1) AND deleted_at IS NULL`,
      [missing],
    );
    for (const row of rows) meta.set(row.id, { name: row.name, ci_type: row.ci_type });
  }

  return [...visited.entries()].map(([id, depth]) => ({
    id,
    name: meta.get(id)?.name ?? `CI #${id}`,
    ci_type: meta.get(id)?.ci_type ?? "unknown",
    depth,
  }));
}

const SERVICE_TYPES = ["service", "application", "database", "network"];

const IMPACT_SYSTEM_PROMPT = `
You are an IT change impact analyst. You receive database-grounded facts about a
proposed change and the configuration items it touches (directly and via
dependency traversal).

Respond with JSON ONLY, matching this schema:
{
  "potential_impact": string,   // 2-4 sentence plain-language summary
  "risk_level": "low"|"medium"|"high"|"critical",
  "affected_customers_estimate": number,
  "rollback_concerns": string[], // things that make rollback hard; empty if none
  "evidence": string[],          // each evidence item is a short factual statement
  "confidence": number           // 0-100
}

Rules:
- This analysis is ADVISORY. Use probabilistic language ("may", "potential").
  Never claim certainty about future impact.
- Base risk_level on: number of affected services, recent incidents in those
  departments, and past changes on the same CIs. Fewer than 2 affected services
  and no recent incidents -> low/medium.
- affected_customers_estimate: use the provided estimate, do not invent.
- rollback_concerns: consider missing rollback plan, database CIs, many
  dependent services. If the change already has a rollback plan, say so as
  mitigating evidence instead of a concern.
- evidence: cite concrete facts from the context (service names, incident
  counts, department names). Never invent names or numbers not in the context.
`.trim();

/**
 * Run impact analysis for a change. Advisory only — stores the result on
 * changes.impact_analysis and returns it. Throws on permission failure.
 */
export async function analyzeChangeImpact(
  changeId: number,
  actorId: number,
): Promise<ChangeImpact> {
  const actor = await getActor(actorId);
  if (!actor) throw new Error("Actor not found");

  const { rows: changeRows } = await pool.query(
    `SELECT id, change_number, title, description, change_type, risk, status,
            rollback_plan, created_by_id
     FROM changes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [changeId],
  );
  const change = changeRows[0];
  if (!change) throw new Error("Change not found");
  if (!canViewChange(actor, change)) {
    throw new Error("Not authorized to analyze this change");
  }

  // 1. Directly affected CIs.
  const { rows: ciRows } = await pool.query(
    `SELECT ci.id, ci.name, ci.ci_type
     FROM change_cis cc JOIN configuration_items ci ON ci.id = cc.ci_id
     WHERE cc.change_id = $1 AND ci.deleted_at IS NULL`,
    [changeId],
  );

  // 2. Graph traversal (blast radius).
  const reachable = await traverseCiGraph(
    ciRows.map((c) => c.id),
    4,
  );
  const affectedServices = reachable.filter((c) =>
    SERVICE_TYPES.includes(c.ci_type),
  );

  // 3. Departments using those CIs.
  const ciIds = reachable.map((c) => c.id);
  let departments: { id: number; name: string }[] = [];
  if (ciIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT DISTINCT d.id, d.name
       FROM configuration_items ci
       JOIN departments d ON d.id = ci.department_id
       WHERE ci.id = ANY($1) AND ci.department_id IS NOT NULL`,
      [ciIds],
    );
    departments = rows;
  }
  const deptIds = departments.map((d) => d.id);

  // 4. Recent incidents (90d) in affected departments, via linked tickets.
  let recentIncidents: { incident_number: string; title: string; severity: string }[] = [];
  if (deptIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT DISTINCT i.incident_number, i.title, i.severity
       FROM incidents i
       JOIN incident_tickets it ON it.incident_id = i.id
       JOIN tickets t ON t.id = it.ticket_id
       WHERE i.deleted_at IS NULL
         AND i.started_at > now() - interval '90 days'
         AND t.department_id = ANY($1)
       ORDER BY i.started_at DESC LIMIT 20`,
      [deptIds],
    );
    recentIncidents = rows;
  }

  // 5. Historical changes touching the same CIs (excluding this one).
  let pastChanges: { change_number: string; title: string; status: string }[] = [];
  if (ciIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT DISTINCT c.change_number, c.title, c.status
       FROM changes c
       JOIN change_cis cc ON cc.change_id = c.id
       WHERE cc.ci_id = ANY($1) AND c.id <> $2 AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC LIMIT 15`,
      [ciIds, changeId],
    );
    pastChanges = rows;
  }

  // 6. Affected customers estimate: distinct people with open tickets in
  //    affected departments in the last 30 days (explicitly an estimate).
  let customerEstimate = 0;
  if (deptIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT count(DISTINCT created_by_id)::int AS n
       FROM tickets
       WHERE department_id = ANY($1)
         AND created_at > now() - interval '30 days'`,
      [deptIds],
    );
    customerEstimate = rows[0]?.n ?? 0;
  }

  // 7. AI reasoning over the grounded facts.
  const trustedContext = {
    change: {
      number: change.change_number,
      title: change.title,
      type: change.change_type,
      declared_risk: change.risk,
      has_rollback_plan: !!change.rollback_plan,
    },
    directly_affected_cis: ciRows.map((c) => ({
      id: c.id, name: c.name, type: c.ci_type,
    })),
    blast_radius_ci_count: reachable.length,
    affected_services: affectedServices.map((s) => ({
      id: s.id, name: s.name, type: s.ci_type, depth: s.depth,
    })),
    affected_departments: departments,
    recent_incidents_90d: recentIncidents,
    past_changes_same_cis: pastChanges,
    affected_customers_estimate: customerEstimate,
  };

  const analysis = await runAnalysis({
    feature: "impact_analysis",
    entityType: "change",
    entityId: String(changeId),
    actorId,
    canAccess: async () => true, // permission already checked above
    systemPrompt: IMPACT_SYSTEM_PROMPT,
    untrustedInputs: [
      { label: "change_title", text: change.title ?? "" },
      { label: "change_description", text: change.description ?? "" },
    ],
    trustedContext,
    maxTokens: 1500,
  });

  const r = analysis.result;
  const riskLevel = ["low", "medium", "high", "critical"].includes(r.risk_level)
    ? (r.risk_level as ChangeImpact["risk_level"])
    : "medium";

  const sources: AnalysisSource[] = [
    { type: "change", id: String(changeId), title: change.change_number },
    ...affectedServices.slice(0, 10).map((s) => ({
      type: "configuration_item", id: String(s.id), title: s.name,
    })),
    ...recentIncidents.slice(0, 10).map((i) => ({
      type: "incident", id: i.incident_number, title: i.title,
    })),
  ];

  const impact: ChangeImpact = {
    potential_impact: String(r.potential_impact ?? "Insufficient data for impact assessment."),
    risk_level: riskLevel,
    affected_services: affectedServices.map((s) => ({
      ci_id: s.id, name: s.name, ci_type: s.ci_type,
    })),
    affected_departments: departments,
    affected_customers_estimate:
      typeof r.affected_customers_estimate === "number"
        ? r.affected_customers_estimate
        : customerEstimate,
    rollback_concerns: Array.isArray(r.rollback_concerns)
      ? r.rollback_concerns.map(String)
      : [],
    evidence: [
      ...reachable.slice(0, 15).map((c) => ({
        label: "ci",
        detail: `${c.name} (${c.ci_type}) — ${c.depth === 0 ? "directly affected" : `via dependency, depth ${c.depth}`}`,
      })),
      ...(Array.isArray(r.evidence) ? r.evidence.map((e: unknown) => ({ label: "ai", detail: String(e) })) : []),
    ],
    confidence: analysis.confidence,
    sources,
    analysis_id: analysis.analysisId,
  };

  // 8. Persist the advisory result on the change.
  await pool.query(
    `UPDATE changes SET impact_analysis = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(impact), changeId],
  );

  return impact;
}
