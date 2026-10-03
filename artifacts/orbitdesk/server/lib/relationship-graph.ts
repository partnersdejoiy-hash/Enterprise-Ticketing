/**
 * Ticket Relationship Graph (#2) — "Orbit Relationship Graph".
 *
 * BFS traversal over ticket_relationships (bidirectional) plus linked
 * incidents (via incident_tickets), starting from a ticket. Every ticket
 * node is permission-filtered through canAccessTicket — inaccessible nodes
 * are excluded entirely (no label leakage).
 *
 * Lazy expansion: at most MAX_NODES nodes per request; deeper expansion
 * happens on the client via repeated calls. Cycles are impossible to render
 * infinitely because of the visited set.
 */

import { pool } from "@workspace/db";
import { canAccessTicket } from "./ticket-access.js";

export interface GraphNode {
  id: string; // "ticket:123", "incident:4", ...
  type: "ticket" | "incident" | "problem" | "change" | "ci" | "knowledge" | "user" | "department";
  label: string;
  status?: string;
  number?: string; // ticket_number / incident_number / ...
  detailUrl?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
}

export interface TicketGraph {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export const MAX_GRAPH_NODES = 50;

export const TICKET_REL_TYPES = [
  "related_to",
  "duplicate_of",
  "parent_of",
  "child_of",
  "caused_by",
  "resolved_by",
] as const;
export type TicketRelType = (typeof TICKET_REL_TYPES)[number];

/** Inverse direction label for undirected display. */
const INVERSE: Record<string, string> = {
  parent_of: "child_of",
  child_of: "parent_of",
  duplicate_of: "duplicate_of",
  related_to: "related_to",
  caused_by: "resolved_by",
  resolved_by: "caused_by",
};

interface TicketRow {
  id: number;
  ticket_number: string;
  subject: string;
  status: string;
}

async function fetchTickets(ids: number[]): Promise<Map<number, TicketRow>> {
  const map = new Map<number, TicketRow>();
  if (!ids.length) return map;
  const { rows } = await pool.query(
    `SELECT id, ticket_number, subject, status FROM tickets WHERE id = ANY($1)`,
    [ids],
  );
  for (const r of rows) map.set(r.id, r as TicketRow);
  return map;
}

function ticketNode(t: TicketRow): GraphNode {
  return {
    id: `ticket:${t.id}`,
    type: "ticket",
    label: t.subject.length > 60 ? t.subject.slice(0, 57) + "…" : t.subject,
    status: t.status,
    number: t.ticket_number,
    detailUrl: `/tickets/${t.id}`,
  };
}

/**
 * BFS from a ticket through ticket_relationships (both directions) and
 * incident links. Permission-filtered; lazy (max 50 nodes).
 */
export async function getTicketGraph(
  ticketId: number,
  user: { id: number; role: string; departmentId: number | null },
  depth = 2,
): Promise<TicketGraph> {
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) {
    throw new Error("Invalid ticket id");
  }
  depth = Math.max(0, Math.min(3, Math.floor(depth) || 0));

  // Root must be accessible — fail closed.
  if (!(await canAccessTicket(user as never, ticketId))) {
    const err = new Error("Ticket not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const visited = new Set<string>([`ticket:${ticketId}`]);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  let truncated = false;

  const addEdge = (from: string, to: string, type: string) => {
    const key = `${from}|${to}|${type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ id: `e${edges.length}`, from, to, type });
  };
  const addNode = (n: GraphNode): boolean => {
    if (visited.has(n.id)) return true;
    if (nodes.length >= MAX_GRAPH_NODES) {
      truncated = true;
      return false;
    }
    visited.add(n.id);
    nodes.push(n);
    return true;
  };

  // Root node.
  const rootRows = await fetchTickets([ticketId]);
  const root = rootRows.get(ticketId);
  if (!root) {
    const err = new Error("Ticket not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const rootKey = `ticket:${ticketId}`;
  nodes.push(ticketNode(root));

  let frontier = new Set<number>([ticketId]);

  for (let d = 0; d < depth && frontier.size > 0 && !truncated; d++) {
    const ids = [...frontier];
    frontier = new Set<number>();

    // 1. ticket↔ticket relationships, both directions.
    const { rows: rels } = await pool.query(
      `SELECT source_ticket_id, target_ticket_id, relationship_type
       FROM ticket_relationships
       WHERE status = 'active'
         AND (source_ticket_id = ANY($1) OR target_ticket_id = ANY($1))`,
      [ids],
    );

    const candidateIds = new Set<number>();
    const relList: { from: number; to: number; type: string }[] = [];
    for (const r of rels) {
      const s = r.source_ticket_id as number;
      const t = r.target_ticket_id as number;
      if (ids.includes(s)) {
        relList.push({ from: s, to: t, type: r.relationship_type as string });
        candidateIds.add(t);
      } else {
        // reverse direction — use inverse label
        const inv = INVERSE[r.relationship_type as string] ?? (r.relationship_type as string);
        relList.push({ from: s, to: t, type: inv });
        candidateIds.add(s);
      }
    }

    // 2. linked incidents (via incident_tickets).
    const { rows: incLinks } = await pool.query(
      `SELECT it.ticket_id, i.id, i.incident_number, i.title, i.severity, i.status
       FROM incident_tickets it
       JOIN incidents i ON i.id = it.incident_id
       WHERE it.ticket_id = ANY($1) AND i.deleted_at IS NULL`,
      [ids],
    );
    for (const l of incLinks) {
      const nodeKey = `incident:${l.id}`;
      if (!visited.has(nodeKey) && nodes.length < MAX_GRAPH_NODES) {
        visited.add(nodeKey);
        nodes.push({
          id: nodeKey,
          type: "incident",
          label: String(l.title).length > 60 ? String(l.title).slice(0, 57) + "…" : String(l.title),
          status: String(l.status),
          number: String(l.incident_number),
          detailUrl: `/incidents/${l.id}`,
        });
        addEdge(`ticket:${l.ticket_id}`, nodeKey, "belongs_to");
      } else if (visited.has(nodeKey)) {
        addEdge(`ticket:${l.ticket_id}`, nodeKey, "belongs_to");
      } else {
        truncated = true;
      }
    }

    // 3. Permission-filter candidate tickets, then add nodes + edges.
    const candArr = [...candidateIds].filter(
      (id) => !visited.has(`ticket:${id}`),
    );
    const ticketMap = await fetchTickets(candArr);
    for (const rel of relList) {
      const otherId = ids.includes(rel.from) ? rel.to : rel.from;
      const otherKey = `ticket:${otherId}`;
      if (visited.has(otherKey)) {
        addEdge(`ticket:${rel.from}`, `ticket:${rel.to}`, rel.type);
        continue;
      }
      const row = ticketMap.get(otherId);
      if (!row) continue;
      // Permission check per node — exclude silently if not accessible.
      if (!(await canAccessTicket(user as never, otherId))) continue;
      if (!addNode(ticketNode(row))) break;
      addEdge(`ticket:${rel.from}`, `ticket:${rel.to}`, rel.type);
      frontier.add(otherId);
    }
  }

  return { root: rootKey, nodes, edges, truncated };
}

/**
 * Create a ticket relationship. Agent+ only (checked in route).
 * Validates: no self-loop, valid type, no duplicate, both tickets exist.
 */
export async function createRelationship(opts: {
  sourceId: number;
  targetId: number;
  type: string;
  userId: number | null;
}): Promise<number> {
  const { sourceId, targetId, type } = opts;
  if (!Number.isSafeInteger(sourceId) || !Number.isSafeInteger(targetId)) {
    throw new Error("Invalid ticket ids");
  }
  if (sourceId === targetId) {
    throw new Error("A ticket cannot relate to itself");
  }
  if (!(TICKET_REL_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Invalid relationship type: ${type}`);
  }
  const { rows: exist } = await pool.query(
    `SELECT id FROM tickets WHERE id = $1 OR id = $2`,
    [sourceId, targetId],
  );
  if (exist.length !== 2) {
    throw new Error("One or both tickets do not exist");
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO ticket_relationships
         (source_ticket_id, target_ticket_id, relationship_type, created_by_id, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [sourceId, targetId, type, opts.userId],
    );
    return rows[0].id as number;
  } catch (err: unknown) {
    if (String((err as Error).message ?? "").includes("ticket_relationships")) {
      throw new Error("This relationship already exists");
    }
    throw err;
  }
}

/** Delete (soft → status) a relationship. */
export async function deleteRelationship(id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid id");
  const { rowCount } = await pool.query(
    `DELETE FROM ticket_relationships WHERE id = $1`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Suggest relationships for a ticket from:
 *  1. ai_triage_results.duplicate_of_ticket_id (AI duplicate detection, #18)
 *  2. keyword/tag overlap with other tickets in the same department
 * Returns proposed (not created) relationships — agent chooses merge/link/ignore.
 */
export async function suggestRelationships(
  ticketId: number,
  user: { id: number; role: string; departmentId: number | null },
): Promise<
  { ticketId: number; ticketNumber: string; subject: string; type: string; reason: string; confidence: number }[]
> {
  if (!(await canAccessTicket(user as never, ticketId))) {
    const err = new Error("Ticket not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const suggestions: {
    ticketId: number; ticketNumber: string; subject: string;
    type: string; reason: string; confidence: number;
  }[] = [];
  const seen = new Set<number>();

  const { rows: selfRows } = await pool.query(
    `SELECT id, subject, tags, department_id FROM tickets WHERE id = $1`,
    [ticketId],
  );
  const self = selfRows[0];
  if (!self) return suggestions;

  // Existing relationships — don't suggest what's already linked.
  const { rows: existing } = await pool.query(
    `SELECT source_ticket_id, target_ticket_id FROM ticket_relationships
     WHERE status = 'active' AND (source_ticket_id = $1 OR target_ticket_id = $1)`,
    [ticketId],
  );
  for (const r of existing) {
    seen.add(r.source_ticket_id === ticketId ? r.target_ticket_id : r.source_ticket_id);
  }
  seen.add(ticketId);

  // 1. AI triage duplicate suggestion.
  const { rows: triage } = await pool.query(
    `SELECT duplicate_of_ticket_id, confidence FROM ai_triage_results
     WHERE ticket_id = $1 AND duplicate_of_ticket_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [ticketId],
  );
  if (triage[0]?.duplicate_of_ticket_id && !seen.has(triage[0].duplicate_of_ticket_id)) {
    const dupId = triage[0].duplicate_of_ticket_id as number;
    if (await canAccessTicket(user as never, dupId)) {
      const dup = (await fetchTickets([dupId])).get(dupId);
      if (dup) {
        suggestions.push({
          ticketId: dupId,
          ticketNumber: dup.ticket_number,
          subject: dup.subject,
          type: "duplicate_of",
          reason: "AI triage flagged as possible duplicate",
          confidence: Number(triage[0].confidence ?? 70),
        });
        seen.add(dupId);
      }
    }
  }

  // 2. Keyword/tag overlap within the same department (open tickets only).
  const tags: string[] = (self.tags as string[]) ?? [];
  const words = String(self.subject)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  if (tags.length > 0 || words.length > 0) {
    const { rows: candidates } = await pool.query(
      `SELECT id, ticket_number, subject, tags
       FROM tickets
       WHERE id <> $1
         AND status IN ('open','assigned','in_progress','waiting')
         AND department_id IS NOT DISTINCT FROM $2
         AND (tags && $3::text[]
              OR to_tsvector('english', subject) @@ plainto_tsquery('english', $4))
       ORDER BY created_at DESC LIMIT 15`,
      [ticketId, self.department_id, tags, words.slice(0, 8).join(" ")],
    );
    for (const c of candidates) {
      const cid = c.id as number;
      if (seen.has(cid)) continue;
      seen.add(cid);
      if (!(await canAccessTicket(user as never, cid))) continue;
      const sharedTags = (c.tags as string[] ?? []).filter((t: string) => tags.includes(t));
      suggestions.push({
        ticketId: cid,
        ticketNumber: c.ticket_number as string,
        subject: c.subject as string,
        type: "related_to",
        reason:
          sharedTags.length > 0
            ? `Shared tags: ${sharedTags.slice(0, 3).join(", ")}`
            : "Similar subject keywords",
        confidence: sharedTags.length > 0 ? 75 : 55,
      });
      if (suggestions.length >= 10) break;
    }
  }

  return suggestions;
}
