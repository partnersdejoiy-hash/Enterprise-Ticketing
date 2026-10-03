/**
 * Organizational Memory (#14) — searchable institutional knowledge.
 *
 * Builds memory entries from resolved tickets / incidents / problems /
 * changes / knowledge articles / postmortems. Every entry carries its
 * source; search is permission-filtered; admins control the `searchable`
 * flag on both memory entries and knowledge articles.
 *
 * Summaries are AI-generated (feature=memory_summarize) but every result
 * cites its source — never invent information.
 */

import { pool } from "@workspace/db";
import { runAnalysis } from "./orbit-ai.js";

export interface MemoryResult {
  id: number | string;
  kind: "memory" | "article";
  sourceType: string;
  sourceId: string;
  title: string;
  snippet: string;
  sourceLink: string;
}

async function getUser(
  actorId: number,
): Promise<{ id: number; role: string; departmentId: number | null } | null> {
  const { rows } = await pool.query(
    `SELECT id, role, department_id AS "departmentId" FROM users WHERE id = $1 LIMIT 1`,
    [actorId],
  );
  return rows[0] ?? null;
}

function isAdminRole(role: string): boolean {
  return ["super_admin", "admin"].includes(role);
}

/**
 * Index a resolved entity into organizational memory.
 * sourceType: ticket|incident|problem|change|knowledge|postmortem
 * Idempotent: upserts on (tenant_id, source_type, source_id).
 */
export async function indexMemory(
  sourceType: string,
  sourceId: string,
  actorId?: number | null,
  tenantId?: number | null,
): Promise<{ memoryId: number; title: string }> {
  const valid = ["ticket", "incident", "problem", "change", "knowledge", "postmortem"];
  if (!valid.includes(sourceType)) {
    throw new Error(`Invalid source type: ${sourceType}`);
  }

  // Fetch the source record for summarization.
  let title = "";
  let body = "";
  let searchable = true;

  if (sourceType === "ticket") {
    const { rows } = await pool.query(
      `SELECT t.ticket_number, t.subject, t.description, t.status, t.resolution_notes,
              d.name AS department
       FROM tickets t
       LEFT JOIN departments d ON d.id = t.department_id
       WHERE t.id = $1 LIMIT 1`,
      [Number(sourceId)],
    );
    const t = rows[0];
    if (!t) throw new Error("Ticket not found");
    if (!["resolved", "closed"].includes(t.status)) {
      throw new Error("Only resolved/closed tickets can be indexed");
    }
    title = `${t.ticket_number}: ${t.subject}`;
    body = `Department: ${t.department ?? "unassigned"}\nDescription: ${t.description ?? ""}\nResolution: ${t.resolution_notes ?? "n/a"}`;
  } else if (sourceType === "incident") {
    const { rows } = await pool.query(
      `SELECT id, title, description, status, resolution_notes FROM incidents WHERE id = $1 LIMIT 1`,
      [Number(sourceId)],
    );
    const i = rows[0];
    if (!i) throw new Error("Incident not found");
    title = `Incident: ${i.title}`;
    body = `Description: ${i.description ?? ""}\nResolution: ${i.resolution_notes ?? "n/a"}`;
  } else if (sourceType === "problem") {
    const { rows } = await pool.query(
      `SELECT id, title, description, root_cause FROM problems WHERE id = $1 LIMIT 1`,
      [Number(sourceId)],
    );
    const p = rows[0];
    if (!p) throw new Error("Problem not found");
    title = `Problem: ${p.title}`;
    body = `Description: ${p.description ?? ""}\nRoot cause: ${p.root_cause ?? "n/a"}`;
  } else if (sourceType === "change") {
    const { rows } = await pool.query(
      `SELECT id, title, description, status FROM changes WHERE id = $1 LIMIT 1`,
      [Number(sourceId)],
    );
    const c = rows[0];
    if (!c) throw new Error("Change not found");
    title = `Change: ${c.title}`;
    body = `Description: ${c.description ?? ""}\nStatus: ${c.status}`;
  } else if (sourceType === "knowledge") {
    const { rows } = await pool.query(
      `SELECT id, title, content, status, searchable FROM knowledge_articles
       WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [Number(sourceId)],
    );
    const k = rows[0];
    if (!k) throw new Error("Knowledge article not found");
    title = k.title;
    body = k.content;
    searchable = k.status === "published" && k.searchable !== false;
  } else {
    // postmortem: body supplied via actor context; keep generic.
    title = `Postmortem ${sourceId}`;
    body = `Postmortem reference: ${sourceId}`;
  }

  // AI summary (grounded on the fetched record).
  let summary = body.slice(0, 2000);
  try {
    const analysis = await runAnalysis({
      feature: "memory_summarize",
      entityType: sourceType,
      entityId: sourceId,
      actorId,
      tenantId,
      canAccess: async () => true, // indexing is admin-triggered; route is admin-gated
      systemPrompt: `Summarize this resolved ${sourceType} for organizational memory.
Output ONLY valid JSON: {"summary": "2-4 sentences: what happened, what fixed it, key lesson", "confidence": 0-100, "sources": [{"type": "${sourceType}", "id": "${sourceId}", "title": ${JSON.stringify(title)}}]}
Never invent details. Use probabilistic language for uncertain causes.`.trim(),
      untrustedInputs: [{ label: `${sourceType}_record`, text: `${title}\n\n${body}`.slice(0, 4000) }],
      maxTokens: 600,
    });
    const r = analysis.result as { summary?: string };
    if (r.summary) summary = String(r.summary).slice(0, 4000);
  } catch (err) {
    console.error("[org-memory] summarize failed, using raw excerpt:", err);
  }

  const { rows } = await pool.query(
    `INSERT INTO organizational_memory
       (tenant_id, source_type, source_id, title, summary, searchable)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, source_type, source_id)
     DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
                   searchable = EXCLUDED.searchable
     RETURNING id`,
    [tenantId ?? null, sourceType, sourceId, title, summary, searchable],
  );

  return { memoryId: rows[0].id as number, title };
}

/**
 * Keyword search over memory + published knowledge articles.
 * Permission-filtered:
 *  - memory entries: searchable=true required; ticket-sourced entries
 *    additionally require the user to pass the ticket scope check.
 *  - knowledge articles: published + searchable for everyone;
 *    drafts/in_review visible to admins only.
 */
export async function searchMemory(
  query: string,
  actorId: number,
): Promise<MemoryResult[]> {
  const user = await getUser(actorId);
  if (!user) throw new Error("Authentication required");
  const admin = isAdminRole(user.role);
  const q = query.trim();
  if (!q) return [];

  const results: MemoryResult[] = [];

  // 1. Organizational memory (searchable entries).
  const { rows: memRows } = await pool.query(
    `SELECT id, source_type, source_id, title, summary
     FROM organizational_memory
     WHERE searchable = true
       AND (title ILIKE $1 OR summary ILIKE $1)
     ORDER BY created_at DESC
     LIMIT 30`,
    [`%${q}%`],
  );

  for (const m of memRows as {
    id: number; source_type: string; source_id: string;
    title: string; summary: string;
  }[]) {
    // Ticket-sourced memory: enforce ticket access for non-admins.
    if (!admin && m.source_type === "ticket") {
      const { rows: ok } = await pool.query(
        `SELECT 1 FROM tickets t WHERE t.id = $1 AND (
           t.created_by_id = $2 OR t.raised_for_user_id = $2 OR t.assignee_id = $2
           OR ($3::text IN ('agent','manager') AND t.department_id = $4)
         ) LIMIT 1`,
        [Number(m.source_id), user.id, user.role, user.departmentId],
      );
      if (!ok.length) continue;
    }
    results.push({
      id: m.id,
      kind: "memory",
      sourceType: m.source_type,
      sourceId: m.source_id,
      title: m.title,
      snippet: m.summary.slice(0, 300),
      sourceLink: memorySourceLink(m.source_type, m.source_id),
    });
  }

  // 2. Knowledge articles.
  const { rows: kbRows } = await pool.query(
    `SELECT id, title, content, status
     FROM knowledge_articles
     WHERE deleted_at IS NULL
       AND (title ILIKE $1 OR content ILIKE $1)
       AND (${admin ? "true" : "status = 'published' AND searchable = true"})
     ORDER BY
       CASE status WHEN 'published' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
       updated_at DESC
     LIMIT 30`,
    [`%${q}%`],
  );

  for (const k of kbRows as {
    id: number; title: string; content: string; status: string;
  }[]) {
    results.push({
      id: `kb-${k.id}`,
      kind: "article",
      sourceType: "knowledge",
      sourceId: String(k.id),
      title: `${k.title} [${k.status}]`,
      snippet: k.content.slice(0, 300),
      sourceLink: `/knowledge/${k.id}`,
    });
  }

  return results.slice(0, 40);
}

function memorySourceLink(sourceType: string, sourceId: string): string {
  switch (sourceType) {
    case "ticket":
      return `/tickets/${sourceId}`;
    case "incident":
      return `/incidents/${sourceId}`;
    case "problem":
      return `/problems/${sourceId}`;
    case "change":
      return `/changes/${sourceId}`;
    case "knowledge":
      return `/knowledge/${sourceId}`;
    default:
      return `#`;
  }
}

/**
 * Admin toggle for the searchable flag (both tables).
 */
export async function setSearchable(
  kind: "memory" | "article",
  id: number,
  searchable: boolean,
  actorId: number,
): Promise<void> {
  const user = await getUser(actorId);
  if (!user || !isAdminRole(user.role)) {
    throw new Error("Admin access required");
  }
  const table =
    kind === "memory" ? "organizational_memory" : "knowledge_articles";
  await pool.query(`UPDATE ${table} SET searchable = $1 WHERE id = $2`, [
    searchable,
    id,
  ]);
  await pool.query(
    `INSERT INTO ai_audit_logs (actor_id, actor_type, action, entity_type, entity_id, detail)
     VALUES ($1, 'human', 'memory.set_searchable', $2, $3, $4::jsonb)`,
    [actorId, table, String(id), JSON.stringify({ searchable })],
  );
}
