/**
 * Superpower #21 — AI Customer Conversation Memory.
 *
 * Customer-level intelligence: recent interactions, open tickets,
 * previous resolutions, related knowledge — all source-grounded.
 *
 * HARD PRIVACY RULES:
 *  - NEVER infer sensitive personal traits: personality, health, disability,
 *    financial status, ethnicity, religion, political views, sexual
 *    orientation, or any other protected attribute.
 *  - Only summarize what is in the records. No speculation about the person.
 *  - The system prompt (CUSTOMER_SUMMARY_PROMPT) enforces this; a unit test
 *    asserts the prohibition text is present.
 *  - Respects ticket visibility: only tickets the requesting agent can see
 *    (via ticket-access scope) are included.
 *
 * All AI reasoning goes through runAnalysis() (orbit-ai.ts).
 */

import { pool } from "@workspace/db";
import { runAnalysis, type AnalysisSource } from "./orbit-ai.js";
import { canAccessTicket } from "./ticket-access.js";

export interface CustomerSummaryStats {
  total_tickets: number;
  open_tickets: number;
  resolved_tickets: number;
  avg_resolution_hours: number | null;
  top_categories: { tag: string; count: number }[];
  first_seen: string | null;
  last_activity: string | null;
}

export interface CustomerSummary {
  customer: { id: number; name: string; email: string; department: string | null };
  summary: string;
  stats: CustomerSummaryStats;
  open_tickets: { id: number; ticket_number: string; subject: string; status: string; priority: string }[];
  recent_resolutions: { id: number; ticket_number: string; subject: string; resolved_at: string | null }[];
  related_knowledge: { id: number; title: string }[];
  sources: AnalysisSource[];
  confidence: number;
  analysis_id: number;
}

interface Actor {
  id: number;
  role: string;
}

/** Only staff may view customer summaries. */
export function canViewCustomerSummary(user: Actor): boolean {
  return ["super_admin", "admin", "manager", "agent"].includes(user.role);
}

/**
 * The trait-inference ban. Keep this text verbatim — a unit test asserts its
 * presence so the prohibition cannot silently regress.
 */
export const TRAIT_INFERENCE_BAN = `
FORBIDDEN: You must NEVER infer, guess, or comment on the customer's
personality, character, temperament, mental or physical health, disability
status, financial situation, income, ethnicity, race, religion, political
opinions, trade-union membership, criminal history, or sexual orientation.
Do not describe the person — only summarize their recorded service
interactions. If any input contains such information, ignore it for the
summary and do not repeat it. Violation of this rule is a safety failure.
`.trim();

/** Exported for tests: asserts the trait-inference ban reaches the model prompt. */
export const CUSTOMER_SUMMARY_PROMPT = `
You are a support-operations analyst writing a CUSTOMER SERVICE SUMMARY for a
support agent about to handle this customer's ticket.

${TRAIT_INFERENCE_BAN}

Respond with JSON ONLY, matching this schema:
{
  "summary": string,  // 3-6 sentences: who the customer is in service terms,
                      // recent ticket themes, how past tickets were resolved,
                      // current open items. Factual, neutral tone.
  "confidence": number // 0-100
}

Rules:
- Summarize ONLY recorded interactions (tickets, resolutions, knowledge used).
- Do not invent tickets, dates, or outcomes. Use only the provided context.
- Do not offer opinions about the customer as a person.
- If there are no tickets, say so plainly with low confidence.
`.trim();

export async function getCustomerSummary(
  customerUserId: number,
  actorId: number,
): Promise<CustomerSummary> {
  if (!Number.isSafeInteger(customerUserId) || customerUserId < 1) {
    throw new Error("Invalid customer id");
  }
  const { rows: actorRows } = await pool.query(
    `SELECT id, role FROM users WHERE id = $1 AND is_active = true LIMIT 1`,
    [actorId],
  );
  const actor: Actor | null = actorRows[0] ?? null;
  if (!actor || !canViewCustomerSummary(actor)) {
    throw new Error("Not authorized to view customer summaries");
  }

  const { rows: custRows } = await pool.query(
    `SELECT u.id, u.name, u.email, d.name AS department
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.id = $1 AND u.is_active = true LIMIT 1`,
    [customerUserId],
  );
  const customer = custRows[0];
  if (!customer) throw new Error("Customer not found");

  // All tickets involving this customer (created by / raised for / tagged).
  const { rows: ticketRows } = await pool.query(
    `SELECT t.id, t.ticket_number, t.subject, t.status, t.priority,
            t.tags, t.created_at, t.updated_at, t.closed_at, t.resolution
     FROM tickets t
     WHERE t.created_by_id = $1
        OR t.raised_for_user_id = $1
        OR $1 = ANY(t.tagged_user_ids)
     ORDER BY t.created_at DESC LIMIT 100`,
    [customerUserId],
  );

  // Visibility filter: only tickets THIS agent is allowed to see.
  // (Drizzle user object needed for ticketScope — load minimal shape.)
  const { db, usersTable, eq } = await import("@workspace/db");
  const [drizzleActor] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, actorId))
    .limit(1);
  const visibleTickets: typeof ticketRows = [];
  for (const t of ticketRows) {
    if (await canAccessTicket(drizzleActor, t.id)) visibleTickets.push(t);
  }

  const openStatuses = ["open", "assigned", "in_progress", "waiting", "reopened"];
  const open = visibleTickets.filter((t) => openStatuses.includes(t.status));
  const resolved = visibleTickets.filter((t) =>
    ["resolved", "closed"].includes(t.status),
  );

  let avgResolutionHours: number | null = null;
  const withTimes = resolved.filter((t) => t.closed_at && t.created_at);
  if (withTimes.length > 0) {
    const totalMs = withTimes.reduce(
      (sum, t) =>
        sum + (new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()),
      0,
    );
    avgResolutionHours = Math.round((totalMs / withTimes.length / 3600000) * 10) / 10;
  }

  const tagCounts = new Map<string, number>();
  for (const t of visibleTickets) {
    for (const tag of t.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topCategories = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  // Related published knowledge overlapping the customer's ticket tags.
  const tags = [...tagCounts.keys()].slice(0, 10);
  let relatedKnowledge: { id: number; title: string }[] = [];
  if (tags.length > 0) {
    const { rows } = await pool.query(
      `SELECT id, title FROM knowledge_articles
       WHERE status = 'published' AND deleted_at IS NULL AND searchable = true
         AND tags && $1::text[]
       ORDER BY helpful_count DESC LIMIT 5`,
      [tags],
    );
    relatedKnowledge = rows;
  }

  const stats: CustomerSummaryStats = {
    total_tickets: visibleTickets.length,
    open_tickets: open.length,
    resolved_tickets: resolved.length,
    avg_resolution_hours: avgResolutionHours,
    top_categories: topCategories,
    first_seen: visibleTickets.length
      ? visibleTickets[visibleTickets.length - 1].created_at
      : null,
    last_activity: visibleTickets.length ? visibleTickets[0].created_at : null,
  };

  const analysis = await runAnalysis({
    feature: "customer_summary",
    entityType: "user",
    entityId: String(customerUserId),
    actorId,
    canAccess: async () => true, // permission checked above
    systemPrompt: CUSTOMER_SUMMARY_PROMPT,
    untrustedInputs: [
      {
        label: "ticket_subjects",
        text: visibleTickets
          .slice(0, 30)
          .map((t) => `[${t.ticket_number}] ${t.subject} (${t.status})`)
          .join("\n"),
      },
    ],
    trustedContext: {
      customer: { name: customer.name, department: customer.department },
      stats,
      recent_resolutions: resolved.slice(0, 10).map((t) => ({
        ticket_number: t.ticket_number,
        subject: t.subject,
        resolved_at: t.closed_at,
        resolution: (t.resolution ?? "").slice(0, 500),
      })),
      open_tickets: open.map((t) => ({
        ticket_number: t.ticket_number,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
      })),
      related_knowledge: relatedKnowledge.map((k) => k.title),
    },
    maxTokens: 1200,
  });

  const sources: AnalysisSource[] = [
    { type: "user", id: String(customerUserId), title: customer.name },
    ...open.slice(0, 10).map((t) => ({
      type: "ticket", id: String(t.id), title: t.ticket_number,
    })),
    ...resolved.slice(0, 10).map((t) => ({
      type: "ticket", id: String(t.id), title: t.ticket_number,
    })),
    ...relatedKnowledge.map((k) => ({
      type: "knowledge", id: String(k.id), title: k.title,
    })),
  ];

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      department: customer.department,
    },
    summary: String(
      analysis.result.summary ?? "No summary could be generated.",
    ),
    stats,
    open_tickets: open.map((t) => ({
      id: t.id,
      ticket_number: t.ticket_number,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
    })),
    recent_resolutions: resolved.slice(0, 10).map((t) => ({
      id: t.id,
      ticket_number: t.ticket_number,
      subject: t.subject,
      resolved_at: t.closed_at,
    })),
    related_knowledge: relatedKnowledge,
    sources,
    confidence: analysis.confidence,
    analysis_id: analysis.analysisId,
  };
}
