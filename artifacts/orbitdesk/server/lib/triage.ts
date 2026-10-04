/**
 * Autonomous Ticket Triage (Superpower #20) + Duplicate Detection (#18).
 *
 * triageTicket() runs a grounded AI analysis over a ticket and stores the
 * structured result in ai_triage_results. It NEVER auto-applies priority
 * or department changes — it only recommends; a human approves.
 *
 * Duplicate detection is deterministic keyword-overlap (Jaccard) over open
 * tickets. Candidates above threshold are persisted as PROPOSED
 * ticket_relationships — merge/link/dismiss are always explicit human actions.
 */

import { pool, db, usersTable, ticketsTable, eq } from "@workspace/db";
import { runAnalysis } from "./orbit-ai.js";
import { emitEvent, EventTypes } from "./orbit-events.js";
import { canAccessTicket } from "./ticket-access.js";

export interface TriageRow {
  id: number;
  ticketId: number;
  intent: string | null;
  category: string | null;
  subcategory: string | null;
  priorityRecommendation: string | null;
  urgency: string | null;
  impact: string | null;
  departmentId: number | null;
  skillsRequired: string[];
  sentiment: string | null;
  language: string | null;
  duplicateOfTicketId: number | null;
  securityRisk: string | null;
  slaPolicyId: number | null;
  confidence: number | null;
  overridden: boolean;
  overrideNote: string | null;
  createdAt: string;
}

export interface DuplicateCandidate {
  relationshipId: number | null; // null = computed fresh, not yet proposed
  ticketId: number;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  similarity: number; // 0-100
  aiConfidence: number | null;
  relationshipStatus: string | null; // proposed|active|rejected|null
}

const STOPWORDS = new Set(
  "the,a,an,and,or,for,to,of,in,on,with,from,that,this,please,hello,hi,thanks,thank,you,your,are,was,were,has,have,had,not,but,our,their,they,them,we,us,can,could,should,would,will,just,need,needs,issue,problem,error,ticket,request,help,kindly,regards,dear,sir,mam,maam".split(
    ",",
  ),
);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/** Jaccard similarity 0..1 between two token sets. */
export function keywordSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

interface OpenTicketLite {
  id: number;
  ticketNumber: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
}

/** Fetch recent open tickets (excluding one id) for keyword comparison. */
async function fetchOpenTickets(
  excludeId: number,
  limit = 500,
): Promise<OpenTicketLite[]> {
  const { rows } = await pool.query(
    `SELECT id, ticket_number AS "ticketNumber", subject,
            COALESCE(description,'') AS description, status, priority
     FROM tickets
     WHERE id <> $1 AND status IN ('open','assigned','in_progress','waiting')
     ORDER BY created_at DESC LIMIT $2`,
    [excludeId, limit],
  );
  return rows as OpenTicketLite[];
}

/**
 * Deterministic duplicate candidates via keyword overlap.
 * Returns top matches with similarity 0-100, threshold 20.
 */
export async function computeDuplicateCandidates(
  ticketId: number,
): Promise<DuplicateCandidate[]> {
  const { rows: selfRows } = await pool.query(
    `SELECT id, ticket_number AS "ticketNumber", subject,
            COALESCE(description,'') AS description
     FROM tickets WHERE id = $1 LIMIT 1`,
    [ticketId],
  );
  if (!selfRows[0]) return [];
  const selfTokens = tokenize(
    `${selfRows[0].subject} ${selfRows[0].description}`,
  );
  const open = await fetchOpenTickets(ticketId);
  const scored = open
    .map((t) => ({
      ticket: t,
      score: Math.round(
        keywordSimilarity(selfTokens, tokenize(`${t.subject} ${t.description}`)) *
          100,
      ),
    }))
    .filter((s) => s.score >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  return scored.map((s) => ({
    relationshipId: null,
    ticketId: s.ticket.id,
    ticketNumber: s.ticket.ticketNumber,
    subject: s.ticket.subject,
    status: s.ticket.status,
    priority: s.ticket.priority,
    similarity: s.score,
    aiConfidence: null,
    relationshipStatus: null,
  }));
}

/**
 * Persist keyword candidates as PROPOSED duplicate_of relationships.
 * Idempotent via the UNIQUE(source,target,type) constraint.
 */
export async function ensureProposedDuplicates(
  ticketId: number,
): Promise<void> {
  const candidates = await computeDuplicateCandidates(ticketId);
  for (const c of candidates.slice(0, 5)) {
    try {
      await pool.query(
        `INSERT INTO ticket_relationships
           (source_ticket_id, target_ticket_id, relationship_type, status, ai_confidence)
         VALUES ($1, $2, 'duplicate_of', 'proposed', $3)
         ON CONFLICT (source_ticket_id, target_ticket_id, relationship_type)
         DO NOTHING`,
        [ticketId, c.ticketId, c.similarity],
      );
    } catch (err) {
      console.error("[triage] propose duplicate failed:", err);
    }
  }
}

/** Proposed + active duplicate relationships for a ticket, with details. */
export async function getDuplicateRelationships(
  ticketId: number,
): Promise<DuplicateCandidate[]> {
  const { rows } = await pool.query(
    `SELECT r.id AS "relationshipId", t.id AS "ticketId",
            t.ticket_number AS "ticketNumber", t.subject, t.status, t.priority,
            COALESCE(r.ai_confidence, 0)::float AS similarity,
            r.ai_confidence AS "aiConfidence", r.status AS "relationshipStatus"
     FROM ticket_relationships r
     JOIN tickets t ON t.id = r.target_ticket_id
     WHERE r.source_ticket_id = $1 AND r.relationship_type = 'duplicate_of'
       AND r.status IN ('proposed','active')
     ORDER BY r.ai_confidence DESC NULLS LAST, r.created_at DESC`,
    [ticketId],
  );
  return rows as DuplicateCandidate[];
}

function mapTriageRow(r: any): TriageRow {
  return {
    id: Number(r.id),
    ticketId: Number(r.ticket_id),
    intent: r.intent,
    category: r.category,
    subcategory: r.subcategory,
    priorityRecommendation: r.priority_recommendation,
    urgency: r.urgency,
    impact: r.impact,
    departmentId: r.department_id ? Number(r.department_id) : null,
    skillsRequired: r.skills_required ?? [],
    sentiment: r.sentiment,
    language: r.language,
    duplicateOfTicketId: r.duplicate_of_ticket_id
      ? Number(r.duplicate_of_ticket_id)
      : null,
    securityRisk: r.security_risk,
    slaPolicyId: r.sla_policy_id ? Number(r.sla_policy_id) : null,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    overridden: !!r.overridden,
    overrideNote: r.override_note,
    createdAt: r.created_at,
  };
}

export async function getLatestTriage(
  ticketId: number,
): Promise<TriageRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM ai_triage_results WHERE ticket_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [ticketId],
  );
  return rows[0] ? mapTriageRow(rows[0]) : null;
}

const TRIAGE_SYSTEM_PROMPT = `
You are an autonomous triage analyst for an enterprise ticketing system.
Analyze the ticket data and return ONLY valid JSON with this exact schema:
{
  "intent": "short phrase describing what the requester wants",
  "category": "one of: access, network, hardware, software, hr, finance, facilities, security, data, other",
  "subcategory": "more specific label or null",
  "priority_recommendation": "one of: low, medium, high, urgent",
  "urgency": "one of: low, medium, high, critical",
  "impact": "one of: individual, team, department, organization",
  "department_id": number or null (only if a department id is listed in trusted context),
  "skills_required": ["array of skill keywords"],
  "sentiment": "one of: neutral, frustrated, urgent_pleading, polite, angry",
  "language": "detected language code, e.g. en, hi, hinglish",
  "duplicate_of_ticket_id": number or null (only if a listed candidate is clearly the same issue),
  "security_risk": "one of: none, low, medium, high",
  "confidence": 0-100,
  "sources": [{"type":"ticket","id":"<id>","title":"<subject>"}]
}
Rules:
- This is a RECOMMENDATION. You do not change anything; a human approves.
- priority_recommendation is advisory only — never present it as applied.
- duplicate_of_ticket_id may only reference a ticket id from the candidate list.
- Use probabilistic language. If unsure, lower confidence.
`.trim();

const TRIAGE_UPDATABLE = new Set([
  "intent",
  "category",
  "subcategory",
  "priority_recommendation",
  "urgency",
  "impact",
  "department_id",
  "skills_required",
  "sentiment",
  "language",
  "security_risk",
]);
const TRIAGE_COLUMNS: Record<string, string> = {
  intent: "intent",
  category: "category",
  subcategory: "subcategory",
  priority_recommendation: "priority_recommendation",
  urgency: "urgency",
  impact: "impact",
  department_id: "department_id",
  skills_required: "skills_required",
  sentiment: "sentiment",
  language: "language",
  security_risk: "security_risk",
};

/**
 * Run autonomous triage on a ticket. Stores the result, proposes duplicate
 * relationships, emits an event. Never auto-applies changes.
 */
export async function triageTicket(
  ticketId: number,
  actorId: number | null,
): Promise<TriageRow> {
  const { rows: tRows } = await pool.query(
    `SELECT t.id, t.ticket_number AS "ticketNumber", t.subject,
            COALESCE(t.description,'') AS description, t.priority, t.status,
            t.department_id AS "departmentId", d.name AS "departmentName",
            t.tenant_id AS "tenantId"
     FROM tickets t LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.id = $1 LIMIT 1`,
    [ticketId],
  );
  const ticket = tRows[0];
  if (!ticket) throw new Error("Ticket not found");

  // Permission predicate: the actor must be able to see this ticket.
  let actor: any = null;
  if (actorId) {
    const [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, actorId))
      .limit(1);
    actor = u ?? null;
  }
  const tenantId = ticket.tenantId ?? null;

  const candidates = await computeDuplicateCandidates(ticketId);

  const analysis = await runAnalysis({
    feature: "triage",
    entityType: "ticket",
    entityId: String(ticketId),
    tenantId,
    actorId,
    canAccess: async () =>
      actor ? canAccessTicket(actor, ticketId) : false,
    systemPrompt: TRIAGE_SYSTEM_PROMPT,
    untrustedInputs: [
      { label: "ticket_subject", text: ticket.subject },
      { label: "ticket_description", text: ticket.description },
    ],
    trustedContext: {
      ticket_number: ticket.ticketNumber,
      current_priority: ticket.priority,
      current_status: ticket.status,
      department_id: ticket.departmentId,
      department_name: ticket.departmentName,
      duplicate_candidates: candidates.map((c) => ({
        ticket_id: c.ticketId,
        ticket_number: c.ticketNumber,
        subject: c.subject,
        status: c.status,
        keyword_similarity: c.similarity,
      })),
    },
    maxTokens: 1200,
  });

  const r = analysis.result;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isSafeInteger(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;

  let duplicateOf: number | null = null;
  const aiDup = num(r.duplicate_of_ticket_id);
  if (aiDup && candidates.some((c) => c.ticketId === aiDup)) duplicateOf = aiDup;

  const { rows: ins } = await pool.query(
    `INSERT INTO ai_triage_results
       (ticket_id, intent, category, subcategory, priority_recommendation,
        urgency, impact, department_id, skills_required, sentiment, language,
        duplicate_of_ticket_id, security_risk, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      ticketId,
      str(r.intent),
      str(r.category),
      str(r.subcategory),
      str(r.priority_recommendation),
      str(r.urgency),
      str(r.impact),
      num(r.department_id),
      Array.isArray(r.skills_required)
        ? (r.skills_required as unknown[]).filter((s) => typeof s === "string").slice(0, 20)
        : [],
      str(r.sentiment),
      str(r.language),
      duplicateOf,
      str(r.security_risk),
      analysis.confidence,
    ],
  );

  // Persist deterministic keyword candidates as proposed relationships.
  await ensureProposedDuplicates(ticketId);
  // Also propose the AI's pick if it named one (idempotent).
  if (duplicateOf) {
    try {
      await pool.query(
        `INSERT INTO ticket_relationships
           (tenant_id, source_ticket_id, target_ticket_id, relationship_type,
            status, ai_confidence)
         VALUES ($1,$2,$3,'duplicate_of','proposed',$4)
         ON CONFLICT (source_ticket_id, target_ticket_id, relationship_type)
         DO UPDATE SET ai_confidence = GREATEST(ticket_relationships.ai_confidence, EXCLUDED.ai_confidence)`,
        [tenantId, ticketId, duplicateOf, analysis.confidence],
      );
    } catch (err) {
      console.error("[triage] AI duplicate propose failed:", err);
    }
  }

  await emitEvent({
    type: EventTypes.TRIAGE_COMPLETED,
    entityType: "ticket",
    entityId: String(ticketId),
    actorId,
    actorType: actorId ? "user" : "system",
    tenantId,
    payload: {
      triage_id: Number(ins[0].id),
      confidence: analysis.confidence,
      category: str(r.category),
    },
  });

  return mapTriageRow(ins[0]);
}

/**
 * Human override of a triage result. Applies corrections to the stored row,
 * marks it overridden, records the human decision for accuracy evaluation.
 */
export async function overrideTriage(
  triageId: number,
  userId: number,
  corrections: Record<string, unknown>,
  note?: string,
): Promise<TriageRow> {
  const { rows } = await pool.query(
    `SELECT * FROM ai_triage_results WHERE id = $1 LIMIT 1`,
    [triageId],
  );
  const triage = rows[0];
  if (!triage) throw new Error("Triage result not found");

  const sets: string[] = ["overridden = true"];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(corrections ?? {})) {
    if (!TRIAGE_UPDATABLE.has(key)) continue;
    const col = TRIAGE_COLUMNS[key];
    params.push(
      key === "skills_required" && Array.isArray(value)
        ? (value as unknown[]).filter((s) => typeof s === "string").slice(0, 20)
        : key === "department_id"
          ? typeof value === "number" && Number.isSafeInteger(value)
            ? value
            : null
          : typeof value === "string"
            ? value.slice(0, 200)
            : null,
    );
    sets.push(`${col} = $${params.length}`);
  }
  params.push(
    JSON.stringify({
      corrected_by: userId,
      corrections,
      note: note ?? null,
      at: new Date().toISOString(),
    }),
  );
  sets.push(`override_note = $${params.length}`);
  params.push(triageId);

  const { rows: updated } = await pool.query(
    `UPDATE ai_triage_results SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return mapTriageRow(updated[0]);
}

/** Fetch a triage row by id (for override permission checks). */
export async function getTriageById(triageId: number): Promise<TriageRow | null> {
  const { rows } = await pool.query(
    `SELECT * FROM ai_triage_results WHERE id = $1 LIMIT 1`,
    [triageId],
  );
  return rows[0] ? mapTriageRow(rows[0]) : null;
}
