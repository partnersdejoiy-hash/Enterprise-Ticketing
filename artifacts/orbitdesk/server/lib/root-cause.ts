/**
 * Root Cause Intelligence (#6).
 *
 * Pure, testable text-analysis helpers (keyword extraction, Jaccard
 * similarity, greedy single-link clustering) plus DB orchestration for
 * detecting recurring-issue clusters and proposing probabilistic
 * root-cause hypotheses. Hypotheses stay "proposed" until a human
 * explicitly confirms one — the problems.root_cause column is only ever
 * written from human-approved text.
 */

import { pool } from "@workspace/db";
import { runAnalysis, proposeRecommendation } from "./orbit-ai.js";
import { emitEvent, EventTypes } from "./orbit-events.js";

const STAFF_ROLES = ["super_admin", "admin", "manager", "agent"];

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "to", "for", "of", "in",
  "on", "at", "with", "by", "from", "as", "and", "or", "not", "error",
  "issue", "ticket", "please", "help", "get", "getting", "has", "have", "had",
]);

/** Lowercase, strip punctuation, split whitespace, drop stopwords + short words. */
export function extractKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)) {
    if (word.length < 3 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** Jaccard similarity of two keyword sets. Empty union => 0 (no signal). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface ClusterInput {
  id: number;
  subject: string;
}

export interface TicketCluster {
  members: ClusterInput[];
  keywords: string[];
}

/**
 * Greedy single-link clustering: each ticket attaches to the first cluster
 * whose representative keyword set (union of member keywords) has
 * Jaccard similarity > 0.4, otherwise it seeds a new cluster.
 * Input capped at 500 tickets.
 */
export function clusterTickets(tickets: ClusterInput[]): TicketCluster[] {
  const capped = tickets.slice(0, 500);
  const clusters: { members: ClusterInput[]; kw: Set<string> }[] = [];
  for (const t of capped) {
    const kws = new Set(extractKeywords(t.subject ?? ""));
    let placed = false;
    for (const c of clusters) {
      if (jaccard(kws, c.kw) > 0.4) {
        c.members.push(t);
        for (const k of kws) c.kw.add(k);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ members: [t], kw: kws });
  }
  return clusters.map((c) => ({
    members: c.members,
    keywords: [...c.kw].sort(),
  }));
}

/** Unique PRB-<yymmdd>-<rand4> style problem numbers. */
export function generateProblemNumber(): string {
  const d = new Date();
  const yymmdd = d.toISOString().slice(2, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `PRB-${yymmdd}-${rand}`;
}

function httpError(status: number, message: string): Error & { status: number } {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

/** The 'default' tenant row seeded by 007 (nullable everywhere for back-compat). */
async function resolveTenantId(): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      "SELECT id FROM tenants WHERE slug = 'default' LIMIT 1",
    );
    return (rows[0]?.id as number | undefined) ?? null;
  } catch {
    return null;
  }
}

interface StaffUser {
  id: number;
  role: string;
  tenantId: number | null;
}

async function requireStaffUser(actorId: number): Promise<StaffUser> {
  const { rows } = await pool.query(
    "SELECT id, role FROM users WHERE id = $1",
    [actorId],
  );
  const user = rows[0] as { id: number; role: string } | undefined;
  if (!user || !STAFF_ROLES.includes(user.role)) {
    throw httpError(403, "Staff access required");
  }
  return { id: user.id, role: user.role, tenantId: await resolveTenantId() };
}

async function insertProblem(
  tenantId: number | null,
  title: string,
  description: string | null,
  createdById: number,
): Promise<{ id: number; problem_number: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO problems (tenant_id, problem_number, title, description, status, created_by_id)
         VALUES ($1, $2, $3, $4, 'open', $5)
         RETURNING id, problem_number`,
        [tenantId, generateProblemNumber(), title, description, createdById],
      );
      return rows[0];
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "23505" || attempt === 4) throw err;
    }
  }
  throw new Error("Could not generate a unique problem number");
}

export interface ClusterView {
  key: string;
  keywords: string[];
  ticket_count: number;
  tickets: { id: number; ticket_number: string; subject: string }[];
}

/**
 * Cluster tickets from the last 30 days and return only clusters with
 * >= 3 members, sorted by size descending.
 */
export async function detectClusters(actorId: number): Promise<ClusterView[]> {
  await requireStaffUser(actorId);
  const { rows } = await pool.query(
    `SELECT id, ticket_number, subject, department_id
     FROM tickets
     WHERE created_at >= now() - interval '30 days'
     ORDER BY created_at DESC
     LIMIT 500`,
  );
  const clusters = clusterTickets(
    rows.map((r) => ({ id: r.id as number, subject: String(r.subject ?? "") })),
  );
  const byId = new Map<number, { ticket_number: string; subject: string }>();
  for (const r of rows) {
    byId.set(r.id as number, {
      ticket_number: String(r.ticket_number),
      subject: String(r.subject ?? ""),
    });
  }
  return clusters
    .filter((c) => c.members.length >= 3)
    .sort((a, b) => b.members.length - a.members.length)
    .map((c, i) => ({
      key: `cluster-${i + 1}`,
      keywords: c.keywords.slice(0, 10),
      ticket_count: c.members.length,
      tickets: c.members.map((m) => ({
        id: m.id,
        ticket_number: byId.get(m.id)?.ticket_number ?? "",
        subject: byId.get(m.id)?.subject ?? m.subject,
      })),
    }));
}

export interface ProposedHypothesis {
  id: number;
  hypothesis: string;
  confidence: number | null;
  evidence: unknown;
  status: string;
}

/**
 * Propose probabilistic root-cause hypotheses for a set of tickets.
 * Find-or-creates a problems row, runs a grounded AI analysis, stores
 * each hypothesis as "proposed", and emits rca.hypothesis_proposed.
 */
export async function proposeRootCause(
  ticketIds: number[],
  actorId: number,
): Promise<{
  problem_id: number;
  problem_number: string;
  hypotheses: ProposedHypothesis[];
}> {
  const user = await requireStaffUser(actorId);
  const ids = [...new Set(ticketIds)].filter(
    (n) => Number.isSafeInteger(n) && n > 0,
  );
  if (ids.length === 0) throw httpError(400, "No valid ticket ids provided");

  const { rows: tickets } = await pool.query(
    `SELECT t.id, t.ticket_number, t.subject, t.description, t.created_at,
            d.name AS department_name
     FROM tickets t LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.id = ANY($1::int[])`,
    [ids],
  );
  if (tickets.length === 0) throw httpError(404, "No tickets found");

  // Top keywords across the ticket set -> problem title.
  const kwCount = new Map<string, number>();
  for (const t of tickets) {
    for (const k of extractKeywords(String(t.subject ?? ""))) {
      kwCount.set(k, (kwCount.get(k) ?? 0) + 1);
    }
  }
  const topKeywords = [...kwCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k);
  const title = `Potential recurring issue: ${topKeywords.join(", ") || "unclassified"}`;

  // Find-or-create the problem row.
  const { rows: existing } = await pool.query(
    `SELECT id, problem_number FROM problems
     WHERE tenant_id IS NOT DISTINCT FROM $1 AND title = $2 AND status = 'open'
     LIMIT 1`,
    [user.tenantId, title],
  );
  let problemId: number;
  let problemNumber: string;
  if (existing.length > 0) {
    problemId = existing[0].id;
    problemNumber = existing[0].problem_number;
  } else {
    const created = await insertProblem(
      user.tenantId,
      title,
      `Candidate recurring-issue cluster of ${tickets.length} ticket(s): ${tickets
        .map((t) => t.ticket_number)
        .join(", ")}`,
      actorId,
    );
    problemId = created.id;
    problemNumber = created.problem_number;
  }

  const createdTimes = tickets
    .map((t) => new Date(t.created_at).getTime())
    .filter((n) => !Number.isNaN(n));
  const departments = [
    ...new Set(tickets.map((t) => t.department_name).filter(Boolean)),
  ];
  const systemPrompt = `You are performing probabilistic root-cause analysis on a cluster of support tickets.

Return ONLY valid JSON with this schema:
{
  "hypotheses": [
    { "hypothesis": string, "confidence": number (0-100), "evidence": [string] }
  ],
  "affected_services": [string],
  "time_period": { "from": string, "to": string }
}

Rules:
- Use probabilistic language only ("likely", "may indicate", "could be caused by"). NEVER use "definitely", "certain", "guaranteed", or "proven".
- Cite only ticket IDs present in the provided context. Never invent ticket IDs, metrics, names, or sources.
- Evidence entries must reference concrete observations from the ticket data.
- If the data is insufficient for a hypothesis, state that explicitly and keep its confidence below 40.`;

  const analysis = await runAnalysis({
    feature: "root_cause",
    entityType: "problem",
    entityId: String(problemId),
    tenantId: user.tenantId,
    actorId,
    canAccess: async () => {
      const { rows } = await pool.query(
        "SELECT role FROM users WHERE id = $1",
        [actorId],
      );
      return !!rows[0] && STAFF_ROLES.includes(rows[0].role);
    },
    systemPrompt,
    untrustedInputs: tickets.map((t) => ({
      label: `ticket_${t.id}`,
      text: `Ticket ${t.ticket_number} (id ${t.id}):\nSubject: ${t.subject}\nDescription: ${(t.description ?? "").slice(0, 2000)}`,
    })),
    trustedContext: {
      ticket_count: tickets.length,
      time_period: {
        from: createdTimes.length
          ? new Date(Math.min(...createdTimes)).toISOString()
          : null,
        to: createdTimes.length
          ? new Date(Math.max(...createdTimes)).toISOString()
          : null,
      },
      departments,
      ticket_ids: tickets.map((t) => t.id),
    },
    maxTokens: 1500,
  });

  const parsed = analysis.result as {
    hypotheses?: {
      hypothesis?: string;
      confidence?: number;
      evidence?: unknown[];
    }[];
  };
  const hypothesisInputs = Array.isArray(parsed.hypotheses)
    ? parsed.hypotheses
    : [];
  const hypotheses: ProposedHypothesis[] = [];
  for (const h of hypothesisInputs) {
    if (!h || typeof h.hypothesis !== "string" || !h.hypothesis.trim()) continue;
    const confidence =
      typeof h.confidence === "number"
        ? Math.max(0, Math.min(100, h.confidence))
        : null;
    const { rows } = await pool.query(
      `INSERT INTO root_cause_hypotheses
         (tenant_id, entity_type, entity_id, hypothesis, confidence, evidence, status)
       VALUES ($1, 'problem', $2, $3, $4, $5::jsonb, 'proposed')
       RETURNING id, hypothesis, confidence, evidence, status`,
      [
        user.tenantId,
        problemId,
        h.hypothesis.trim(),
        confidence,
        JSON.stringify(Array.isArray(h.evidence) ? h.evidence : []),
      ],
    );
    hypotheses.push(rows[0]);
  }

  // Human-approval recommendation for reviewing the hypotheses.
  try {
    await proposeRecommendation({
      tenantId: user.tenantId,
      analysisId: analysis.analysisId,
      entityType: "problem",
      entityId: String(problemId),
      kind: "root_cause_review",
      title: `Review root-cause hypotheses for ${problemNumber}`,
      detail: `${hypotheses.length} hypotheses proposed from ${tickets.length} tickets. Confirm one to set the problem's root cause.`,
      confidence: analysis.confidence,
      evidence: hypotheses.map((h) => ({
        hypothesis_id: h.id,
        hypothesis: h.hypothesis,
        confidence: h.confidence,
      })),
    });
  } catch (err) {
    console.error("[root-cause] recommendation failed:", err);
  }

  await emitEvent({
    type: EventTypes.RCA_HYPOTHESIS_PROPOSED,
    entityType: "problem",
    entityId: String(problemId),
    actorId,
    actorType: "user",
    tenantId: user.tenantId,
    payload: {
      problem_number: problemNumber,
      hypothesis_ids: hypotheses.map((h) => h.id),
      hypothesis_count: hypotheses.length,
      ticket_count: tickets.length,
    },
  });

  return { problem_id: problemId, problem_number: problemNumber, hypotheses };
}

/**
 * Human decision on a hypothesis. Confirming writes the (human-approved)
 * text into problems.root_cause; rejecting leaves it untouched.
 */
export async function confirmHypothesis(
  id: number,
  userId: number,
  confirmed: boolean,
  authoredText?: string,
): Promise<ProposedHypothesis> {
  const user = await requireStaffUser(userId);
  const { rows } = await pool.query(
    `SELECT id, entity_type, entity_id, hypothesis, status
     FROM root_cause_hypotheses WHERE id = $1`,
    [id],
  );
  const row = rows[0] as
    | {
        id: number;
        entity_type: string;
        entity_id: number;
        hypothesis: string;
        status: string;
      }
    | undefined;
  if (!row) throw httpError(404, "Hypothesis not found");
  if (row.status !== "proposed") {
    throw httpError(400, "Hypothesis has already been decided");
  }

  const status = confirmed ? "confirmed" : "rejected";
  const { rows: updated } = await pool.query(
    `UPDATE root_cause_hypotheses
     SET status = $2, decided_by_id = $3, decided_at = now()
     WHERE id = $1
     RETURNING id, hypothesis, confidence, evidence, status`,
    [id, status, userId],
  );

  if (confirmed && row.entity_type === "problem") {
    // Human explicitly approved this text — safe to record as root cause.
    const rootCause =
      authoredText && authoredText.trim()
        ? authoredText.trim()
        : row.hypothesis;
    await pool.query(
      `UPDATE problems
       SET root_cause = $2, root_cause_confirmed_by_id = $3,
           root_cause_confirmed_at = now(), updated_at = now()
       WHERE id = $1`,
      [row.entity_id, rootCause, userId],
    );
  }

  await emitEvent({
    type: "rca.hypothesis_decided",
    entityType: row.entity_type,
    entityId: String(row.entity_id),
    actorId: userId,
    actorType: "user",
    tenantId: user.tenantId,
    payload: { hypothesis_id: id, decision: status },
  });

  return updated[0];
}
