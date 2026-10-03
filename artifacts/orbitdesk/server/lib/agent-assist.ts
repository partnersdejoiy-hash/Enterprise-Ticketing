/**
 * AI Agent Assist (#28) + One-Click Ticket Intelligence (#29).
 *
 * Every AI call goes through runAnalysis() (orbit-ai.ts) — grounded,
 * permission-checked, shield-scanned, audited, confidence-scored.
 * DB lookups (similar tickets, knowledge) are non-AI and respect
 * ticket access scopes.
 *
 * Drafts are drafts — they are never sent. The agent must click to use.
 * Customer section data comes only from the ticket itself; traits are
 * never inferred.
 */

import { pool } from "@workspace/db";
import { db, ticketsTable, usersTable, eq } from "@workspace/db";
import { runAnalysis, type AnalysisSource } from "./orbit-ai.js";
import { canAccessTicket, ticketScope } from "./ticket-access.js";
import { getSlaStatus } from "./sla-engine.js";
import { scanContent } from "./security-shield.js";

type User = typeof usersTable.$inferSelect;

async function getUser(actorId: number): Promise<User> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, actorId))
    .limit(1);
  if (!user) throw new Error("User not found");
  return user;
}

interface TicketRow {
  id: number;
  ticket_number: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  department_id: number | null;
  assignee_id: number | null;
  created_by_id: number | null;
  raised_for_user_id: number | null;
  created_at: string;
}

async function getTicketRow(ticketId: number): Promise<TicketRow> {
  const { rows } = await pool.query(
    `SELECT id, ticket_number, subject, description, status, priority,
            department_id, assignee_id, created_by_id, raised_for_user_id,
            created_at::text AS created_at
     FROM tickets WHERE id = $1 LIMIT 1`,
    [ticketId],
  );
  if (!rows[0]) throw new Error("Ticket not found");
  return rows[0] as TicketRow;
}

async function customerInfo(ticket: TicketRow): Promise<{
  name: string | null;
  email: string | null;
  ticketNumber: string;
}> {
  // Only data from the ticket itself. Never infer traits.
  const uid = ticket.raised_for_user_id ?? ticket.created_by_id;
  if (!uid) {
    return { name: null, email: null, ticketNumber: ticket.ticket_number };
  }
  const { rows } = await pool.query(
    `SELECT name, email FROM users WHERE id = $1 LIMIT 1`,
    [uid],
  );
  return {
    name: rows[0]?.name ?? null,
    email: rows[0]?.email ?? null,
    ticketNumber: ticket.ticket_number,
  };
}

const canAccess = (user: User, ticketId: number) => async () =>
  canAccessTicket(user, ticketId);

const SUMMARY_PROMPT = `Summarize this support ticket for a support agent.
Respond with JSON: {"summary": string (2-4 sentences, factual),
"key_points": string[] (up to 6 bullets, each a concrete fact from the ticket),
"confidence": number (0-100), "sources": [{"type":"ticket","id":"<ticket id>","title":"<subject>"}]}.
Only use facts present in the data. Do not invent details.`;

const DRAFT_PROMPT = `Draft a professional customer-facing reply to this support ticket.
The draft is a DRAFT for a human agent to review, edit, or reject — never send it.
Respond with JSON: {"draft": string (the reply body, professional and empathetic,
address the customer's issue concretely, sign as the support team),
"confidence": number (0-100), "sources": [{"type":"ticket","id":"<ticket id>","title":"<subject>"}]}.
If the tone requested is provided in trusted context, match it (professional|friendly|formal|concise).
Do not promise anything not in the data. Do not include internal notes.`;

const INTEL_PROMPT = `You are performing one-click ticket intelligence for a support agent.
Analyze the ticket and respond with JSON:
{
  "intent": string (what the customer wants, one line),
  "priority_recommendation": "low"|"medium"|"high"|"critical",
  "priority_reason": string (one sentence, grounded in the data),
  "possible_root_cause": string|null (candidate cause based on similar tickets/knowledge, or null if none evident),
  "recommended_next_action": string (concrete next step for the agent),
  "confidence": number (0-100),
  "sources": [{"type":"ticket"|"knowledge","id":"<id>","title":"<title>"}]
}
Use probabilistic language for predictions. Only cite items present in the provided context.
Never invent ticket IDs, metrics, or sources.`;

/** #28: AI summary of a ticket. */
export async function getTicketSummary(ticketId: number, actorId: number) {
  const user = await getUser(actorId);
  const ticket = await getTicketRow(ticketId);
  const res = await runAnalysis({
    feature: "summarize",
    entityType: "ticket",
    entityId: String(ticketId),
    actorId,
    canAccess: canAccess(user, ticketId),
    systemPrompt: SUMMARY_PROMPT,
    untrustedInputs: [
      { label: "ticket_subject", text: ticket.subject },
      { label: "ticket_description", text: ticket.description },
    ],
    trustedContext: {
      ticket_number: ticket.ticket_number,
      status: ticket.status,
      priority: ticket.priority,
    },
  });
  return {
    summary: (res.result.summary as string) ?? "",
    key_points: (res.result.key_points as string[]) ?? [],
    confidence: res.confidence,
    sources: res.sources,
    analysisId: res.analysisId,
  };
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "are", "was", "were", "be", "been", "has",
  "have", "had", "it", "its", "this", "that", "these", "those", "i",
  "we", "you", "he", "she", "they", "my", "our", "your", "please",
  "from", "as", "not", "no", "yes", "do", "does", "did", "can", "will",
  "would", "should", "there", "their", "when", "what", "which", "who",
  "how", "all", "any", "some", "more", "very", "just", "about",
]);

/** Extract salient keywords (no AI) for similarity + knowledge search. */
export function extractKeywords(text: string, max = 20): string[] {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w);
}

export interface SimilarTicket {
  id: number;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  similarity: number; // 0-100
}

/**
 * #28: keyword-overlap similar-ticket search (DB only, no AI).
 * Only returns tickets the actor is allowed to see.
 */
export async function getSimilarTickets(
  ticketId: number,
  actorId: number,
  limit = 5,
): Promise<SimilarTicket[]> {
  const user = await getUser(actorId);
  const ticket = await getTicketRow(ticketId);
  const keywords = extractKeywords(`${ticket.subject} ${ticket.description}`);
  if (keywords.length === 0) return [];

  // Build OR'd ILIKE conditions via drizzle, scoped by ticketScope.
  const { or, ne, and, sql } = await import("@workspace/db");
  const kwConds = keywords.map((kw) =>
    or(
      sql`${ticketsTable.subject} ILIKE ${`%${kw}%`}`,
      sql`${ticketsTable.description} ILIKE ${`%${kw}%`}`,
    ),
  );
  const rows = await db
    .select({
      id: ticketsTable.id,
      ticketNumber: ticketsTable.ticketNumber,
      subject: ticketsTable.subject,
      description: ticketsTable.description,
      status: ticketsTable.status,
      priority: ticketsTable.priority,
    })
    .from(ticketsTable)
    .where(
      and(ne(ticketsTable.id, ticketId), ticketScope(user), or(...kwConds)!),
    )
    .limit(50);

  // Score: subject keyword match = 2 pts, description match = 1 pt.
  const scored = rows.map((r) => {
    const subj = r.subject.toLowerCase();
    const desc = (r.description ?? "").toLowerCase();
    let pts = 0;
    for (const kw of keywords) {
      if (subj.includes(kw)) pts += 2;
      else if (desc.includes(kw)) pts += 1;
    }
    return {
      ...r,
      similarity: Math.min(100, Math.round((pts / (keywords.length * 2)) * 100)),
    };
  });
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit).map(({ id, ticketNumber, subject, status, priority, similarity }) => ({
    id, ticketNumber, subject, status, priority, similarity,
  }));
}

export interface KnowledgeHit {
  id: number;
  title: string;
  rank: number;
  excerpt: string;
}

/** #28: full-text search over published knowledge articles. */
export async function getRelevantKnowledge(
  ticketId: number,
  actorId: number,
  limit = 3,
): Promise<KnowledgeHit[]> {
  await getUser(actorId); // validates actor; KB is org-wide published content
  const ticket = await getTicketRow(ticketId);
  const query = extractKeywords(`${ticket.subject} ${ticket.description}`, 15).join(" ");
  if (!query) return [];
  const { rows } = await pool.query(
    `SELECT id, title, LEFT(content, 400) AS excerpt,
            ts_rank(to_tsvector('english', title || ' ' || content),
                    plainto_tsquery('english', $1)) AS rank
     FROM knowledge_articles
     WHERE status = 'published' AND deleted_at IS NULL AND searchable
       AND to_tsvector('english', title || ' ' || content)
           @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC LIMIT $2`,
    [query, limit],
  );
  return rows.map((r) => ({
    id: r.id as number,
    title: r.title as string,
    rank: Math.round((r.rank as number) * 100),
    excerpt: (r.excerpt as string) ?? "",
  }));
}

/** #28: draft a customer reply. Draft only — never sends. */
export async function draftResponse(
  ticketId: number,
  actorId: number,
  tone?: string,
) {
  const user = await getUser(actorId);
  const ticket = await getTicketRow(ticketId);
  const res = await runAnalysis({
    feature: "draft_response",
    entityType: "ticket",
    entityId: String(ticketId),
    actorId,
    canAccess: canAccess(user, ticketId),
    systemPrompt: DRAFT_PROMPT,
    untrustedInputs: [
      { label: "ticket_subject", text: ticket.subject },
      { label: "ticket_description", text: ticket.description },
    ],
    trustedContext: {
      ticket_number: ticket.ticket_number,
      status: ticket.status,
      priority: ticket.priority,
      requested_tone: tone ?? "professional",
    },
  });
  return {
    draft: (res.result.draft as string) ?? "",
    confidence: res.confidence,
    sources: res.sources,
    analysisId: res.analysisId,
  };
}

export interface TicketIntelligence {
  summary: string;
  key_points: string[];
  intent: string;
  priority_recommendation: string;
  priority_reason: string;
  sla_risk: {
    health: string;
    policyName: string | null;
    remainingBusinessMinutes: number | null;
    percentElapsed: number | null;
  };
  similar_tickets: SimilarTicket[];
  possible_root_cause: string | null;
  recommended_knowledge: KnowledgeHit[];
  recommended_next_action: string;
  draft_response: string;
  confidence: number;
  sources: AnalysisSource[];
  security: {
    highestRisk: string;
    findings: { detectionType: string; riskLevel: string }[];
  };
}

/**
 * #29: One-click ticket intelligence. Runs summary + draft + intelligence
 * (AI) and similar tickets + knowledge + SLA (DB) in parallel, returns a
 * unified result. The intelligence pass is stored as
 * ai_analyses(feature='ticket_intelligence').
 */
export async function analyzeTicket(
  ticketId: number,
  actorId: number,
): Promise<TicketIntelligence> {
  const user = await getUser(actorId);
  const ticket = await getTicketRow(ticketId);

  const [summaryRes, draftRes, similar, knowledge, sla] = await Promise.all([
    runAnalysis({
      feature: "summarize",
      entityType: "ticket",
      entityId: String(ticketId),
      actorId,
      canAccess: canAccess(user, ticketId),
      systemPrompt: SUMMARY_PROMPT,
      untrustedInputs: [
        { label: "ticket_subject", text: ticket.subject },
        { label: "ticket_description", text: ticket.description },
      ],
      trustedContext: {
        ticket_number: ticket.ticket_number,
        status: ticket.status,
        priority: ticket.priority,
      },
    }),
    runAnalysis({
      feature: "draft_response",
      entityType: "ticket",
      entityId: String(ticketId),
      actorId,
      canAccess: canAccess(user, ticketId),
      systemPrompt: DRAFT_PROMPT,
      untrustedInputs: [
        { label: "ticket_subject", text: ticket.subject },
        { label: "ticket_description", text: ticket.description },
      ],
      trustedContext: {
        ticket_number: ticket.ticket_number,
        status: ticket.status,
        priority: ticket.priority,
        requested_tone: "professional",
      },
    }),
    getSimilarTickets(ticketId, actorId),
    getRelevantKnowledge(ticketId, actorId),
    getSlaStatus(ticketId),
  ]);

  const shield = scanContent(`${ticket.subject}\n${ticket.description}`);

  const intel = await runAnalysis({
    feature: "ticket_intelligence",
    entityType: "ticket",
    entityId: String(ticketId),
    actorId,
    canAccess: canAccess(user, ticketId),
    systemPrompt: INTEL_PROMPT,
    untrustedInputs: [
      { label: "ticket_subject", text: ticket.subject },
      { label: "ticket_description", text: ticket.description },
    ],
    trustedContext: {
      ticket_number: ticket.ticket_number,
      status: ticket.status,
      priority: ticket.priority,
      ai_summary: summaryRes.result.summary,
      similar_tickets: similar.map((s) => ({
        id: s.id, ticket_number: s.ticketNumber, subject: s.subject,
        status: s.status, similarity: s.similarity,
      })),
      knowledge_articles: knowledge.map((k) => ({ id: k.id, title: k.title })),
      sla: {
        health: sla.health, policy: sla.policyName,
        percent_elapsed: sla.percentElapsed,
        remaining_minutes: sla.remainingBusinessMinutes,
      },
    },
  });

  const r = intel.result;
  return {
    summary: (summaryRes.result.summary as string) ?? "",
    key_points: (summaryRes.result.key_points as string[]) ?? [],
    intent: (r.intent as string) ?? "",
    priority_recommendation: (r.priority_recommendation as string) ?? ticket.priority,
    priority_reason: (r.priority_reason as string) ?? "",
    sla_risk: {
      health: sla.health,
      policyName: sla.policyName,
      remainingBusinessMinutes: sla.remainingBusinessMinutes,
      percentElapsed: sla.percentElapsed,
    },
    similar_tickets: similar,
    possible_root_cause: (r.possible_root_cause as string) ?? null,
    recommended_knowledge: knowledge,
    recommended_next_action: (r.recommended_next_action as string) ?? "",
    draft_response: (draftRes.result.draft as string) ?? "",
    confidence: intel.confidence,
    sources: intel.sources,
    security: {
      highestRisk: shield.highestRisk,
      findings: shield.findings.map((f) => ({
        detectionType: f.detectionType,
        riskLevel: f.riskLevel,
      })),
    },
  };
}

/** Customer facts from the ticket itself — never inferred traits. */
export async function getCustomerFacts(ticketId: number, actorId: number) {
  const user = await getUser(actorId);
  if (!(await canAccessTicket(user, ticketId))) {
    throw new Error("AI analysis denied: permission check failed");
  }
  const ticket = await getTicketRow(ticketId);
  return customerInfo(ticket);
}
