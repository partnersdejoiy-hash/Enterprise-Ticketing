/**
 * Knowledge Gap Detector (#25).
 *
 * Analyzes unresolved/repeated tickets, detects clusters of similar issues
 * with no covering knowledge article, and proposes draft articles.
 *
 * Flow: detectGaps() → clusters → KB coverage check → AI draft →
 * knowledge_gaps row (status=proposed). Human approves → draft article.
 */

import { pool } from "@workspace/db";
import { runAnalysis } from "./orbit-ai.js";

export interface TicketCluster {
  keywords: string[];
  ticketIds: number[];
  ticketNumbers: string[];
  subjects: string[];
  count: number;
  coveredByArticleId: number | null;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "are", "was", "were", "be", "been", "has",
  "have", "had", "do", "does", "did", "will", "would", "can", "not",
  "no", "please", "help", "need", "request", "issue", "problem", "error",
  "unable", "cannot", "cant", "wont", "hi", "hello", "thanks", "thank",
  "regards", "dear", "sir", "mam", "urgent", "asap", "kindly",
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .slice(0, 12);
}

function clusterKey(keywords: string[]): string {
  return [...new Set(keywords)].sort().slice(0, 3).join("|");
}

/**
 * Detect ticket clusters with no covering knowledge article.
 * Returns created gap IDs.
 */
export async function detectGaps(
  actorId: number,
  tenantId?: number | null,
): Promise<{ gapsCreated: number; clusters: TicketCluster[] }> {
  // 1. Pull unresolved tickets (last 90 days to keep it relevant).
  const { rows: tickets } = await pool.query(
    `SELECT id, ticket_number, subject, description
     FROM tickets
     WHERE status NOT IN ('resolved','closed')
       AND created_at > now() - interval '90 days'
     ORDER BY created_at DESC
     LIMIT 2000`,
  );

  // 2. Cluster by shared keyword triples.
  const clusters = new Map<
    string,
    { keywords: string[]; ids: number[]; numbers: string[]; subjects: string[] }
  >();
  for (const t of tickets as {
    id: number; ticket_number: string; subject: string; description: string;
  }[]) {
    const kws = extractKeywords(`${t.subject} ${t.description ?? ""}`);
    if (kws.length < 2) continue;
    const key = clusterKey(kws);
    if (!key) continue;
    let c = clusters.get(key);
    if (!c) {
      c = { keywords: [...new Set(kws)].slice(0, 5), ids: [], numbers: [], subjects: [] };
      clusters.set(key, c);
    }
    c.ids.push(t.id);
    c.numbers.push(t.ticket_number);
    c.subjects.push(t.subject);
  }

  const MIN_CLUSTER = 3;
  const significant = [...clusters.values()].filter(
    (c) => c.ids.length >= MIN_CLUSTER,
  );

  const results: TicketCluster[] = [];
  let gapsCreated = 0;

  for (const c of significant.slice(0, 20)) {
    // 3. Check KB coverage: does a published article match these keywords?
    const query = c.keywords.join(" | ");
    const { rows: articles } = await pool.query(
      `SELECT id FROM knowledge_articles
       WHERE status = 'published' AND deleted_at IS NULL
         AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', $1)
       LIMIT 1`,
      [query],
    );
    const coveredByArticleId = articles[0]?.id ?? null;
    results.push({
      keywords: c.keywords,
      ticketIds: c.ids,
      ticketNumbers: c.numbers,
      subjects: c.subjects.slice(0, 5),
      count: c.ids.length,
      coveredByArticleId,
    });
    if (coveredByArticleId) continue;

    // 4. Skip if a proposed gap already covers these tickets.
    const { rows: existing } = await pool.query(
      `SELECT id FROM knowledge_gaps
       WHERE status = 'proposed'
         AND ticket_ids && $1::integer[]
       LIMIT 1`,
      [c.ids.slice(0, 20)],
    );
    if (existing.length) continue;

    // 5. AI-draft a suggested article.
    let suggestedTitle = `How to resolve: ${c.keywords.join(", ")}`;
    let draftContent = "";
    try {
      const analysis = await runAnalysis({
        feature: "kb_draft",
        entityType: "knowledge_gap",
        entityId: `gap-${Date.now()}-${c.ids[0]}`,
        actorId,
        tenantId,
        canAccess: async () => true, // gap detection is admin-triggered; route is admin-gated
        systemPrompt: `Draft a knowledge-base article suggestion from these repeated ticket subjects.
Output ONLY valid JSON: {"suggested_title": "...", "draft_content": "...markdown, 100-300 words: symptoms, likely causes, resolution steps, when to escalate...", "confidence": 0-100, "sources": []}
Never invent ticket IDs. Use probabilistic language.`.trim(),
        untrustedInputs: [
          {
            label: "repeated_ticket_subjects",
            text: c.subjects.slice(0, 10).join("\n"),
          },
        ],
        maxTokens: 1200,
      });
      const r = analysis.result as {
        suggested_title?: string; draft_content?: string;
      };
      if (r.suggested_title) suggestedTitle = String(r.suggested_title).slice(0, 200);
      if (r.draft_content) draftContent = String(r.draft_content).slice(0, 8000);
    } catch (err) {
      console.error("[knowledge-gaps] AI draft failed:", err);
      draftContent = `**Symptoms:** ${c.subjects.slice(0, 3).join("; ")}\n\n**Status:** Draft pending — ${c.ids.length} similar tickets detected. An agent should write the resolution steps.`;
    }

    await pool.query(
      `INSERT INTO knowledge_gaps
         (tenant_id, suggested_title, draft_content, ticket_ids, occurrence_count, status)
       VALUES ($1,$2,$3,$4::integer[],$5,'proposed')`,
      [
        tenantId ?? null,
        suggestedTitle,
        draftContent,
        c.ids.slice(0, 100),
        c.ids.length,
      ],
    );
    gapsCreated++;
  }

  return { gapsCreated, clusters: results };
}

/**
 * Approve a gap → creates a knowledge article in draft status.
 * Human must publish it through the article workflow.
 */
export async function approveGap(
  gapId: number,
  actorId: number,
): Promise<{ articleId: number }> {
  const { rows } = await pool.query(
    `SELECT id, suggested_title, draft_content, status
     FROM knowledge_gaps WHERE id = $1 LIMIT 1`,
    [gapId],
  );
  const gap = rows[0];
  if (!gap) throw new Error("Knowledge gap not found");
  if (gap.status !== "proposed") {
    throw new Error(`Gap is already ${gap.status}`);
  }

  const { rows: articles } = await pool.query(
    `INSERT INTO knowledge_articles
       (title, content, status, created_by_id)
     VALUES ($1,$2,'draft',$3)
     RETURNING id`,
    [gap.suggested_title, gap.draft_content ?? "", actorId],
  );
  const articleId = articles[0].id as number;

  await pool.query(
    `UPDATE knowledge_gaps SET status = 'approved', article_id = $1 WHERE id = $2`,
    [articleId, gapId],
  );

  await pool.query(
    `INSERT INTO ai_audit_logs (actor_id, actor_type, action, entity_type, entity_id, detail)
     VALUES ($1, 'human', 'knowledge_gap.approve', 'knowledge_gap', $2, $3::jsonb)`,
    [actorId, String(gapId), JSON.stringify({ articleId })],
  );

  return { articleId };
}
