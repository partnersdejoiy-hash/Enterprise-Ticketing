/**
 * Orbit Intelligence Graph (#16) — unified organizational intelligence graph.
 *
 * This is a GRAPH ABSTRACTION over the existing relational data — no graph
 * database. Traversal uses foreign keys + relationship tables
 * (ticket_relationships, incident_tickets, ci_relationships, monitoring_events,
 * root_cause_hypotheses, ai_triage_results, knowledge links).
 *
 * Powers: AI recommendations, similarity search, root-cause analysis,
 * impact analysis, customer-360, service mapping.
 *
 * Edge types: owns, assigned_to, affected_by, depends_on, caused_by,
 * resolved_by, related_to, documented_by, reported_by, belongs_to,
 * runs_on, created (proposed).
 */

import { pool } from "@workspace/db";
import { canAccessTicket } from "./ticket-access.js";
import type { GraphNode, GraphEdge } from "./relationship-graph.js";

export const MAX_INTEL_NODES = 60;

export type EntityType =
  | "ticket" | "incident" | "problem" | "change"
  | "ci" | "knowledge" | "user" | "department";

export interface IntelligenceGraph {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

interface Ctx {
  user: { id: number; role: string; departmentId: number | null };
  nodes: GraphNode[];
  edges: GraphEdge[];
  visited: Set<string>;
  edgeKeys: Set<string>;
  truncated: boolean;
}

function makeCtx(user: Ctx["user"]): Ctx {
  return { user, nodes: [], edges: [], visited: new Set(), edgeKeys: new Set(), truncated: false };
}

function addEdge(ctx: Ctx, from: string, to: string, type: string) {
  const key = `${from}|${to}|${type}`;
  if (ctx.edgeKeys.has(key)) return;
  ctx.edgeKeys.add(key);
  ctx.edges.push({ id: `e${ctx.edges.length}`, from, to, type });
}

function addNode(ctx: Ctx, n: GraphNode): boolean {
  if (ctx.visited.has(n.id)) return true;
  if (ctx.nodes.length >= MAX_INTEL_NODES) {
    ctx.truncated = true;
    return false;
  }
  ctx.visited.add(n.id);
  ctx.nodes.push(n);
  return true;
}

const trunc = (s: string, n = 60) =>
  s.length > n ? s.slice(0, n - 3) + "…" : s;

async function ticketAccessible(ctx: Ctx, id: number): Promise<boolean> {
  try {
    return await canAccessTicket(ctx.user as never, id);
  } catch {
    return false;
  }
}

/** Expand a ticket node (1 hop): relationships, incidents, people, dept, CIs, triage. */
async function expandTicket(ctx: Ctx, id: number): Promise<string[]> {
  const next: string[] = [];
  const { rows } = await pool.query(
    `SELECT id, ticket_number, subject, status, priority,
            department_id, assignee_id, created_by_id
     FROM tickets WHERE id = $1`,
    [id],
  );
  const t = rows[0];
  if (!t) return next;

  // → department (belongs_to)
  if (t.department_id) {
    const { rows: d } = await pool.query(
      `SELECT id, name FROM departments WHERE id = $1`, [t.department_id],
    );
    if (d[0]) {
      const key = `department:${d[0].id}`;
      if (addNode(ctx, { id: key, type: "department", label: trunc(String(d[0].name)), detailUrl: `/departments` })) {
        addEdge(ctx, `ticket:${id}`, key, "belongs_to");
        next.push(key);
      }
    }
  }
  // → assignee (assigned_to), reporter (reported_by)
  for (const [uid, edge] of [[t.assignee_id, "assigned_to"], [t.created_by_id, "reported_by"]] as const) {
    if (uid) {
      const { rows: u } = await pool.query(
        `SELECT id, name, role FROM users WHERE id = $1`, [uid],
      );
      if (u[0]) {
        const key = `user:${u[0].id}`;
        // Never expose full user directory to external users.
        if (ctx.user.role === "external" && uid !== ctx.user.id) continue;
        if (addNode(ctx, { id: key, type: "user", label: trunc(String(u[0].name), 40), status: String(u[0].role) })) {
          addEdge(ctx, `ticket:${id}`, key, edge);
          next.push(key);
        }
      }
    }
  }
  // → other tickets via ticket_relationships
  const { rows: rels } = await pool.query(
    `SELECT source_ticket_id, target_ticket_id, relationship_type
     FROM ticket_relationships
     WHERE status = 'active'
       AND (source_ticket_id = $1 OR target_ticket_id = $1) LIMIT 25`,
    [id],
  );
  for (const r of rels) {
    const other = r.source_ticket_id === id ? r.target_ticket_id : r.source_ticket_id;
    if (!(await ticketAccessible(ctx, other))) continue;
    const { rows: ot } = await pool.query(
      `SELECT id, ticket_number, subject, status FROM tickets WHERE id = $1`, [other],
    );
    if (!ot[0]) continue;
    const key = `ticket:${other}`;
    if (addNode(ctx, {
      id: key, type: "ticket", label: trunc(String(ot[0].subject)),
      status: String(ot[0].status), number: String(ot[0].ticket_number),
      detailUrl: `/tickets/${other}`,
    })) {
      addEdge(ctx, `ticket:${id}`, key, String(r.relationship_type));
      next.push(key);
    }
  }
  // → incidents via incident_tickets
  const { rows: incs } = await pool.query(
    `SELECT i.id, i.incident_number, i.title, i.status, i.severity
     FROM incident_tickets it JOIN incidents i ON i.id = it.incident_id
     WHERE it.ticket_id = $1 AND i.deleted_at IS NULL LIMIT 10`,
    [id],
  );
  for (const i of incs) {
    const key = `incident:${i.id}`;
    if (addNode(ctx, {
      id: key, type: "incident", label: trunc(String(i.title)),
      status: String(i.status), number: String(i.incident_number),
      detailUrl: `/incidents/${i.id}`,
    })) {
      addEdge(ctx, `ticket:${id}`, key, "belongs_to");
      next.push(key);
    }
  }
  // → CIs via monitoring_events that reference this ticket
  const { rows: cis } = await pool.query(
    `SELECT DISTINCT ci.id, ci.name, ci.ci_type, ci.health
     FROM monitoring_events me JOIN configuration_items ci ON ci.id = me.ci_id
     WHERE me.ticket_id = $1 AND ci.deleted_at IS NULL LIMIT 10`,
    [id],
  );
  for (const c of cis) {
    const key = `ci:${c.id}`;
    if (addNode(ctx, {
      id: key, type: "ci", label: trunc(String(c.name), 40),
      status: String(c.health), number: String(c.ci_type),
    })) {
      addEdge(ctx, `ticket:${id}`, key, "affected_by");
      next.push(key);
    }
  }
  // → triage duplicate suggestion (proposed edge)
  const { rows: tri } = await pool.query(
    `SELECT duplicate_of_ticket_id FROM ai_triage_results
     WHERE ticket_id = $1 AND duplicate_of_ticket_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [id],
  );
  if (tri[0]?.duplicate_of_ticket_id) {
    const dup = tri[0].duplicate_of_ticket_id as number;
    if (await ticketAccessible(ctx, dup)) {
      const { rows: dt } = await pool.query(
        `SELECT id, ticket_number, subject, status FROM tickets WHERE id = $1`, [dup],
      );
      if (dt[0]) {
        const key = `ticket:${dup}`;
        if (addNode(ctx, {
          id: key, type: "ticket", label: trunc(String(dt[0].subject)),
          status: String(dt[0].status), number: String(dt[0].ticket_number),
          detailUrl: `/tickets/${dup}`,
        })) {
          addEdge(ctx, `ticket:${id}`, key, "duplicate_of");
          next.push(key);
        }
      }
    }
  }
  return next;
}

/** Expand an incident node (1 hop). */
async function expandIncident(ctx: Ctx, id: number): Promise<string[]> {
  const next: string[] = [];
  // → tickets
  const { rows: ts } = await pool.query(
    `SELECT t.id, t.ticket_number, t.subject, t.status
     FROM incident_tickets it JOIN tickets t ON t.id = it.ticket_id
     WHERE it.incident_id = $1 LIMIT 20`,
    [id],
  );
  for (const t of ts) {
    if (!(await ticketAccessible(ctx, t.id as number))) continue;
    const key = `ticket:${t.id}`;
    if (addNode(ctx, {
      id: key, type: "ticket", label: trunc(String(t.subject)),
      status: String(t.status), number: String(t.ticket_number),
      detailUrl: `/tickets/${t.id}`,
    })) {
      addEdge(ctx, `incident:${id}`, key, "affects");
      next.push(key);
    }
  }
  // → CIs via monitoring_events
  const { rows: cis } = await pool.query(
    `SELECT DISTINCT ci.id, ci.name, ci.ci_type, ci.health
     FROM monitoring_events me JOIN configuration_items ci ON ci.id = me.ci_id
     WHERE me.incident_id = $1 AND ci.deleted_at IS NULL LIMIT 10`,
    [id],
  );
  for (const c of cis) {
    const key = `ci:${c.id}`;
    if (addNode(ctx, {
      id: key, type: "ci", label: trunc(String(c.name), 40),
      status: String(c.health), number: String(c.ci_type),
    })) {
      addEdge(ctx, `incident:${id}`, key, "affected_by");
      next.push(key);
    }
  }
  // → root-cause hypotheses → problem (if a hypothesis references one via evidence)
  const { rows: hyps } = await pool.query(
    `SELECT id, hypothesis, confidence, status FROM root_cause_hypotheses
     WHERE entity_type = 'incident' AND entity_id = $1
     ORDER BY confidence DESC NULLS LAST LIMIT 5`,
    [id],
  );
  for (const h of hyps) {
    const key = `hypothesis:${h.id}`;
    if (addNode(ctx, {
      id: key, type: "problem", label: trunc(`Hypothesis: ${h.hypothesis}`, 70),
      status: String(h.status),
    })) {
      addEdge(ctx, `incident:${id}`, key, "caused_by");
      next.push(key);
    }
  }
  // → swarm room (command)
  const { rows: rooms } = await pool.query(
    `SELECT id, name, status FROM swarm_rooms WHERE incident_id = $1
     ORDER BY created_at DESC LIMIT 3`,
    [id],
  );
  for (const r of rooms) {
    const key = `swarm:${r.id}`;
    if (addNode(ctx, {
      id: key, type: "incident", label: `Swarm: ${trunc(String(r.name), 40)}`,
      status: String(r.status),
    })) {
      addEdge(ctx, `incident:${id}`, key, "documented_by");
      next.push(key);
    }
  }
  return next;
}

/** Expand a CI node (1 hop): dependency edges + health context. */
async function expandCi(ctx: Ctx, id: number): Promise<string[]> {
  const next: string[] = [];
  const { rows: rels } = await pool.query(
    `SELECT cr.source_ci_id, cr.target_ci_id, cr.relationship_type,
            s.name AS sname, t.name AS tname
     FROM ci_relationships cr
     JOIN configuration_items s ON s.id = cr.source_ci_id
     JOIN configuration_items t ON t.id = cr.target_ci_id
     WHERE (cr.source_ci_id = $1 OR cr.target_ci_id = $1)
       AND s.deleted_at IS NULL AND t.deleted_at IS NULL LIMIT 25`,
    [id],
  );
  for (const r of rels) {
    const other = r.source_ci_id === id ? r.target_ci_id : r.source_ci_id;
    const otherName = r.source_ci_id === id ? r.tname : r.sname;
    const key = `ci:${other}`;
    if (addNode(ctx, {
      id: key, type: "ci", label: trunc(String(otherName), 40),
    })) {
      const fwd = r.source_ci_id === id;
      addEdge(ctx,
        fwd ? `ci:${id}` : key,
        fwd ? key : `ci:${id}`,
        String(r.relationship_type));
      next.push(key);
    }
  }
  // → recent incidents/tickets touching this CI
  const { rows: ev } = await pool.query(
    `SELECT DISTINCT incident_id, ticket_id FROM monitoring_events
     WHERE ci_id = $1 AND (incident_id IS NOT NULL OR ticket_id IS NOT NULL)
     ORDER BY last_seen_at DESC LIMIT 10`,
    [id],
  );
  for (const e of ev) {
    if (e.incident_id) {
      const { rows: ir } = await pool.query(
        `SELECT id, incident_number, title, status FROM incidents
         WHERE id = $1 AND deleted_at IS NULL`, [e.incident_id],
      );
      if (ir[0]) {
        const key = `incident:${ir[0].id}`;
        if (addNode(ctx, {
          id: key, type: "incident", label: trunc(String(ir[0].title)),
          status: String(ir[0].status), number: String(ir[0].incident_number),
        })) {
          addEdge(ctx, key, `ci:${id}`, "affected_by");
          next.push(key);
        }
      }
    }
    if (e.ticket_id && await ticketAccessible(ctx, e.ticket_id as number)) {
      const { rows: tr } = await pool.query(
        `SELECT id, ticket_number, subject, status FROM tickets WHERE id = $1`,
        [e.ticket_id],
      );
      if (tr[0]) {
        const key = `ticket:${tr[0].id}`;
        if (addNode(ctx, {
          id: key, type: "ticket", label: trunc(String(tr[0].subject)),
          status: String(tr[0].status), number: String(tr[0].ticket_number),
          detailUrl: `/tickets/${tr[0].id}`,
        })) {
          addEdge(ctx, key, `ci:${id}`, "affected_by");
          next.push(key);
        }
      }
    }
  }
  return next;
}

/** Expand a problem or change node (1 hop). */
async function expandProblemChange(ctx: Ctx, kind: "problem" | "change", id: number): Promise<string[]> {
  const next: string[] = [];
  // Root-cause hypotheses (problems) / impact analysis (changes)
  if (kind === "problem") {
    const { rows: hyps } = await pool.query(
      `SELECT id, hypothesis, confidence, status FROM root_cause_hypotheses
       WHERE entity_type = 'problem' AND entity_id = $1
       ORDER BY confidence DESC NULLS LAST LIMIT 5`,
      [id],
    );
    for (const h of hyps) {
      const key = `hypothesis:${h.id}`;
      if (addNode(ctx, {
        id: key, type: "problem", label: trunc(`Hypothesis: ${h.hypothesis}`, 70),
        status: String(h.status),
      })) {
        addEdge(ctx, `problem:${id}`, key, "caused_by");
        next.push(key);
      }
    }
  }
  // Related tickets via keyword overlap in title (bounded, permission-filtered)
  const table = kind === "problem" ? "problems" : "changes";
  const { rows: selfRows } = await pool.query(
    `SELECT title FROM ${table} WHERE id = $1`, [id],
  );
  if (selfRows[0]) {
    const { rows: ts } = await pool.query(
      `SELECT id, ticket_number, subject, status FROM tickets
       WHERE to_tsvector('english', subject) @@ plainto_tsquery('english', $1)
         AND status IN ('open','assigned','in_progress','waiting')
       ORDER BY created_at DESC LIMIT 10`,
      [String(selfRows[0].title).slice(0, 120)],
    );
    for (const t of ts) {
      if (!(await ticketAccessible(ctx, t.id as number))) continue;
      const key = `ticket:${t.id}`;
      if (addNode(ctx, {
        id: key, type: "ticket", label: trunc(String(t.subject)),
        status: String(t.status), number: String(t.ticket_number),
        detailUrl: `/tickets/${t.id}`,
      })) {
        addEdge(ctx, `${kind}:${id}`, key, "related_to");
        next.push(key);
      }
    }
  }
  return next;
}

/** Expand a user or department node (1 hop, bounded). */
async function expandUserDepartment(ctx: Ctx, kind: "user" | "department", id: number): Promise<string[]> {
  const next: string[] = [];
  if (ctx.user.role === "external") return next; // no directory browsing for externals
  if (kind === "department") {
    // recent open tickets in the department (permission-filtered)
    const { rows: ts } = await pool.query(
      `SELECT id, ticket_number, subject, status FROM tickets
       WHERE department_id = $1 AND status IN ('open','assigned','in_progress','waiting')
       ORDER BY created_at DESC LIMIT 12`,
      [id],
    );
    for (const t of ts) {
      if (!(await ticketAccessible(ctx, t.id as number))) continue;
      const key = `ticket:${t.id}`;
      if (addNode(ctx, {
        id: key, type: "ticket", label: trunc(String(t.subject)),
        status: String(t.status), number: String(t.ticket_number),
        detailUrl: `/tickets/${t.id}`,
      })) {
        addEdge(ctx, key, `department:${id}`, "belongs_to");
        next.push(key);
      }
    }
  } else {
    // tickets assigned to the user (permission-filtered)
    const { rows: ts } = await pool.query(
      `SELECT id, ticket_number, subject, status FROM tickets
       WHERE assignee_id = $1 AND status IN ('open','assigned','in_progress','waiting')
       ORDER BY created_at DESC LIMIT 12`,
      [id],
    );
    for (const t of ts) {
      if (!(await ticketAccessible(ctx, t.id as number))) continue;
      const key = `ticket:${t.id}`;
      if (addNode(ctx, {
        id: key, type: "ticket", label: trunc(String(t.subject)),
        status: String(t.status), number: String(t.ticket_number),
        detailUrl: `/tickets/${t.id}`,
      })) {
        addEdge(ctx, key, `user:${id}`, "assigned_to");
        next.push(key);
      }
    }
  }
  return next;
}

/** Fetch the root node descriptor for any entity. Returns null if not found/inaccessible. */
async function rootNode(
  ctx: Ctx, entityType: EntityType, entityId: number,
): Promise<GraphNode | null> {
  switch (entityType) {
    case "ticket": {
      if (!(await ticketAccessible(ctx, entityId))) return null;
      const { rows } = await pool.query(
        `SELECT id, ticket_number, subject, status FROM tickets WHERE id = $1`, [entityId],
      );
      if (!rows[0]) return null;
      return {
        id: `ticket:${entityId}`, type: "ticket",
        label: trunc(String(rows[0].subject)), status: String(rows[0].status),
        number: String(rows[0].ticket_number), detailUrl: `/tickets/${entityId}`,
      };
    }
    case "incident": {
      const { rows } = await pool.query(
        `SELECT id, incident_number, title, status, severity FROM incidents
         WHERE id = $1 AND deleted_at IS NULL`, [entityId],
      );
      if (!rows[0]) return null;
      return {
        id: `incident:${entityId}`, type: "incident",
        label: trunc(String(rows[0].title)), status: String(rows[0].status),
        number: String(rows[0].incident_number),
      };
    }
    case "problem": {
      const { rows } = await pool.query(
        `SELECT id, problem_number, title, status FROM problems
         WHERE id = $1 AND deleted_at IS NULL`, [entityId],
      );
      if (!rows[0]) return null;
      return {
        id: `problem:${entityId}`, type: "problem",
        label: trunc(String(rows[0].title)), status: String(rows[0].status),
        number: String(rows[0].problem_number),
      };
    }
    case "change": {
      const { rows } = await pool.query(
        `SELECT id, change_number, title, status FROM changes
         WHERE id = $1 AND deleted_at IS NULL`, [entityId],
      );
      if (!rows[0]) return null;
      return {
        id: `change:${entityId}`, type: "change",
        label: trunc(String(rows[0].title)), status: String(rows[0].status),
        number: String(rows[0].change_number),
      };
    }
    case "ci": {
      const { rows } = await pool.query(
        `SELECT id, name, ci_type, health FROM configuration_items
         WHERE id = $1 AND deleted_at IS NULL`, [entityId],
      );
      if (!rows[0]) return null;
      return {
        id: `ci:${entityId}`, type: "ci",
        label: trunc(String(rows[0].name), 40), status: String(rows[0].health),
        number: String(rows[0].ci_type),
      };
    }
    case "knowledge": {
      const { rows } = await pool.query(
        `SELECT id, title, status FROM knowledge_articles
         WHERE id = $1 AND deleted_at IS NULL
           AND (status = 'published' OR $2)`,
        [entityId, ["admin", "super_admin", "manager", "agent"].includes(ctx.user.role)],
      );
      if (!rows[0]) return null;
      return {
        id: `knowledge:${entityId}`, type: "knowledge",
        label: trunc(String(rows[0].title)), status: String(rows[0].status),
      };
    }
    case "user": {
      if (ctx.user.role === "external" && entityId !== ctx.user.id) return null;
      const { rows } = await pool.query(
        `SELECT id, name, role FROM users WHERE id = $1 AND is_active = true`, [entityId],
      );
      if (!rows[0]) return null;
      return {
        id: `user:${entityId}`, type: "user",
        label: trunc(String(rows[0].name), 40), status: String(rows[0].role),
      };
    }
    case "department": {
      const { rows } = await pool.query(
        `SELECT id, name FROM departments WHERE id = $1`, [entityId],
      );
      if (!rows[0]) return null;
      return {
        id: `department:${entityId}`, type: "department",
        label: trunc(String(rows[0].name)),
      };
    }
  }
}

function expand(
  ctx: Ctx, key: string,
): Promise<string[]> {
  const [kind, idStr] = key.split(":");
  const id = Number(idStr);
  if (!Number.isSafeInteger(id)) return Promise.resolve([]);
  switch (kind) {
    case "ticket": return expandTicket(ctx, id);
    case "incident": return expandIncident(ctx, id);
    case "ci": return expandCi(ctx, id);
    case "problem": return expandProblemChange(ctx, "problem", id);
    case "change": return expandProblemChange(ctx, "change", id);
    case "user": return expandUserDepartment(ctx, "user", id);
    case "department": return expandUserDepartment(ctx, "department", id);
    default: return Promise.resolve([]); // knowledge/hypothesis/swarm are leaves
  }
}

/**
 * Unified entity graph: BFS up to `depth` hops from any supported entity,
 * traversing tickets→incidents→problems→changes→CIs→knowledge→users→departments
 * via existing FKs + relationship tables. Permission-filtered.
 */
export async function getEntityGraph(
  entityType: EntityType,
  entityId: number,
  user: { id: number; role: string; departmentId: number | null },
  depth = 2,
): Promise<IntelligenceGraph> {
  if (!Number.isSafeInteger(entityId) || entityId < 1) {
    throw new Error("Invalid entity id");
  }
  depth = Math.max(0, Math.min(3, Math.floor(depth) || 0));
  const ctx = makeCtx(user);
  const root = await rootNode(ctx, entityType, entityId);
  if (!root) {
    const err = new Error("Entity not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  ctx.visited.add(root.id);
  ctx.nodes.push(root);

  let frontier = [root.id];
  for (let d = 0; d < depth && frontier.length > 0 && !ctx.truncated; d++) {
    const nextFrontier: string[] = [];
    for (const key of frontier) {
      const discovered = await expand(ctx, key);
      nextFrontier.push(...discovered);
      if (ctx.truncated) break;
    }
    frontier = [...new Set(nextFrontier)].filter((k) => ctx.visited.has(k));
  }

  return { root: root.id, nodes: ctx.nodes, edges: ctx.edges, truncated: ctx.truncated };
}

/**
 * findSimilar — recommendation primitive for the intelligence graph.
 * Similarity via shared tags/keywords/department (no embeddings required;
 * keeps it dependency-free and honest about being heuristic).
 */
export async function findSimilar(
  entityType: "ticket" | "incident" | "problem",
  entityId: number,
  user: { id: number; role: string; departmentId: number | null },
  limit = 8,
): Promise<
  { entityType: string; entityId: number; label: string; score: number; reasons: string[] }[]
> {
  const results: {
    entityType: string; entityId: number; label: string; score: number; reasons: string[];
  }[] = [];
  limit = Math.max(1, Math.min(20, limit));

  if (entityType === "ticket") {
    if (!(await ticketAccessible(makeCtx(user), entityId))) return results;
    const { rows } = await pool.query(
      `SELECT id, subject, tags, department_id FROM tickets WHERE id = $1`, [entityId],
    );
    const self = rows[0];
    if (!self) return results;
    const tags: string[] = self.tags ?? [];
    const { rows: cands } = await pool.query(
      `SELECT id, ticket_number, subject, tags, department_id
       FROM tickets
       WHERE id <> $1 AND status IN ('open','assigned','in_progress','waiting')
         AND (department_id IS NOT DISTINCT FROM $2
              OR (tags && $3::text[])
              OR to_tsvector('english', subject) @@ plainto_tsquery('english', $4))
       ORDER BY created_at DESC LIMIT 30`,
      [entityId, self.department_id, tags,
       String(self.subject).toLowerCase().split(/[^a-z0-9]+/).filter((w: string) => w.length > 3).slice(0, 8).join(" ")],
    );
    for (const c of cands) {
      const reasons: string[] = [];
      let score = 0;
      if (c.department_id === self.department_id) { score += 25; reasons.push("same department"); }
      const shared = (c.tags as string[] ?? []).filter((t: string) => tags.includes(t));
      if (shared.length) { score += Math.min(40, shared.length * 15); reasons.push(`shared tags: ${shared.slice(0, 3).join(", ")}`); }
      if (reasons.length === 0) { score = 20; reasons.push("similar keywords"); }
      if (await ticketAccessible(makeCtx(user), c.id as number)) {
        results.push({
          entityType: "ticket", entityId: c.id as number,
          label: `${c.ticket_number}: ${trunc(String(c.subject), 70)}`,
          score, reasons,
        });
      }
      if (results.length >= limit) break;
    }
    results.sort((a, b) => b.score - a.score);
  } else {
    // incident/problem → similar via title keyword overlap
    const table = entityType === "incident" ? "incidents" : "problems";
    const numCol = entityType === "incident" ? "incident_number" : "problem_number";
    const { rows } = await pool.query(
      `SELECT id, ${numCol} AS num, title FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
      [entityId],
    );
    const self = rows[0];
    if (!self) return results;
    const { rows: cands } = await pool.query(
      `SELECT id, ${numCol} AS num, title FROM ${table}
       WHERE id <> $1 AND deleted_at IS NULL
         AND to_tsvector('english', title) @@ plainto_tsquery('english', $2)
       ORDER BY created_at DESC LIMIT $3`,
      [entityId, String(self.title).slice(0, 120), limit],
    );
    for (const c of cands) {
      results.push({
        entityType, entityId: c.id as number,
        label: `${c.num}: ${trunc(String(c.title), 70)}`,
        score: 40, reasons: ["similar title keywords"],
      });
    }
  }
  return results.slice(0, limit);
}
