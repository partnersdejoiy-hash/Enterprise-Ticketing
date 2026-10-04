/**
 * Post-Incident Intelligence (#23).
 *
 * After a major incident resolves, generate a DRAFT post-incident review.
 * Sections: Summary, Impact, Timeline, Detection, Response, Root Cause,
 * Contributing Factors, Resolution, What Went Well, What Didn't,
 * Corrective Actions, Preventive Actions.
 *
 * The draft is stored in ai_analyses (feature='postmortem', status='draft').
 * A human MUST approve before publication — incidents.postmortem_status
 * moves draft → approved. Nothing is auto-published.
 */

import { pool } from "@workspace/db";
import { runAnalysis } from "./orbit-ai.js";
import { emitEvent } from "./orbit-events.js";

const POSTMORTEM_SECTIONS = [
  "summary",
  "impact",
  "timeline",
  "detection",
  "response",
  "root_cause",
  "contributing_factors",
  "resolution",
  "went_well",
  "didnt_go_well",
  "corrective_actions",
  "preventive_actions",
] as const;

const SYSTEM_PROMPT = `
You are writing a DRAFT post-incident review for an IT incident. Use ONLY the
timeline and records provided in the trusted context and untrusted data.
Write each section concisely. For root cause, use probabilistic language
("potential root cause", "likely contributing factor") — never claim certainty.
If evidence is missing for a section, write "Insufficient data — needs human input."
Respond with valid JSON: { "confidence": 0-100,
  "sections": { "summary": "...", "impact": "...", "timeline": "...",
    "detection": "...", "response": "...", "root_cause": "...",
    "contributing_factors": "...", "resolution": "...",
    "went_well": "...", "didnt_go_well": "...",
    "corrective_actions": "...", "preventive_actions": "..." },
  "sources": [ {"type":"incident"|"ticket"|"swarm_message"|"event", "id":"...", "title":"..."} ] }
`.trim();

export async function generatePostmortemDraft(
  incidentId: number,
  actorId: number,
): Promise<{ analysisId: number; confidence: number }> {
  const { rows: incRows } = await pool.query(
    `SELECT id, incident_number AS "incidentNumber", title, description,
            severity, status, started_at AS "startedAt",
            mitigated_at AS "mitigatedAt", resolved_at AS "resolvedAt",
            commander_id AS "commanderId"
     FROM incidents WHERE id = $1 AND deleted_at IS NULL`,
    [incidentId],
  );
  const incident = incRows[0];
  if (!incident) throw new Error("Incident not found");
  if (!["resolved", "closed", "mitigated"].includes(incident.status)) {
    throw new Error(
      `Postmortem requires a resolved/mitigated incident (current: ${incident.status})`,
    );
  }

  // Timeline: linked tickets + swarm messages + domain events.
  const { rows: ticketRows } = await pool.query(
    `SELECT t.ticket_number AS "ticketNumber", t.subject, t.status,
            it.linked_at AS "linkedAt"
     FROM incident_tickets it
     JOIN tickets t ON t.id = it.ticket_id
     WHERE it.incident_id = $1 ORDER BY it.linked_at ASC`,
    [incidentId],
  );
  const { rows: msgRows } = await pool.query(
    `SELECT sm.message_type AS "messageType", sm.content, sm.created_at AS "createdAt",
            COALESCE(u.name, 'AI') AS author
     FROM swarm_messages sm
     LEFT JOIN users u ON u.id = sm.sender_id
     WHERE sm.room_id IN (SELECT id FROM swarm_rooms WHERE incident_id = $1)
     ORDER BY sm.created_at ASC LIMIT 200`,
    [incidentId],
  );
  const { rows: eventRows } = await pool.query(
    `SELECT event_type AS type, entity_type AS "entityType",
            entity_id AS "entityId", created_at AS "createdAt", payload
     FROM domain_events
     WHERE entity_type = 'incident' AND entity_id = $1
     ORDER BY created_at ASC LIMIT 200`,
    [String(incidentId)],
  );

  const result = await runAnalysis({
    feature: "postmortem",
    entityType: "incident",
    entityId: String(incidentId),
    actorId,
    canAccess: async () => true, // route already enforces manager+.
    systemPrompt: SYSTEM_PROMPT,
    untrustedInputs: msgRows.map((m, i) => ({
      label: `swarm_message_${i}`,
      text: `[${m.messageType}] ${m.author}: ${m.content}`,
    })),
    trustedContext: {
      incident: {
        number: incident.incidentNumber,
        title: incident.title,
        severity: incident.severity,
        startedAt: incident.startedAt,
        mitigatedAt: incident.mitigatedAt,
        resolvedAt: incident.resolvedAt,
      },
      linkedTickets: ticketRows,
      domainEvents: eventRows.map((e) => ({
        type: e.type,
        at: e.createdAt,
        payload: e.payload,
      })),
      messageCount: msgRows.length,
    },
    maxTokens: 2500,
  });

  // Mark the analysis row as a draft (runAnalysis persists as 'completed').
  await pool.query(
    "UPDATE ai_analyses SET status = 'draft' WHERE id = $1",
    [result.analysisId],
  );
  await pool.query(
    "UPDATE incidents SET postmortem_status = 'draft' WHERE id = $1",
    [incidentId],
  );
  await emitEvent({
    type: "incident.postmortem_drafted",
    entityType: "incident",
    entityId: String(incidentId),
    actorId,
    actorType: "ai",
    payload: { analysisId: result.analysisId, confidence: result.confidence },
  });

  return { analysisId: result.analysisId, confidence: result.confidence };
}

/** Fetch the latest postmortem draft for an incident. */
export async function getPostmortemDraft(incidentId: number): Promise<{
  analysisId: number;
  confidence: number;
  sections: Record<string, string>;
  sources: { type: string; id: string; title: string }[];
  status: string;
  createdAt: string;
} | null> {
  const { rows } = await pool.query(
    `SELECT id, confidence, result, sources, status, created_at AS "createdAt"
     FROM ai_analyses
     WHERE feature = 'postmortem' AND entity_type = 'incident'
       AND entity_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [String(incidentId)],
  );
  const row = rows[0];
  if (!row) return null;
  const result = row.result as Record<string, unknown>;
  const sections: Record<string, string> = {};
  const rawSections = (result.sections ?? {}) as Record<string, unknown>;
  for (const s of POSTMORTEM_SECTIONS) {
    sections[s] = typeof rawSections[s] === "string" ? (rawSections[s] as string) : "";
  }
  return {
    analysisId: row.id as number,
    confidence: row.confidence as number,
    sections,
    sources: (row.sources ?? []) as { type: string; id: string; title: string }[],
    status: row.status as string,
    createdAt: row.createdAt as string,
  };
}

/**
 * Human approves (publishes) the draft. Only managers/admins. The draft is
 * never auto-published.
 */
export async function approvePostmortem(
  incidentId: number,
  actorId: number,
  editedSections?: Record<string, string>,
): Promise<void> {
  const draft = await getPostmortemDraft(incidentId);
  if (!draft) throw new Error("No postmortem draft exists");
  if (draft.status === "approved") throw new Error("Postmortem already approved");

  if (editedSections) {
    const { rows } = await pool.query(
      "SELECT result FROM ai_analyses WHERE id = $1",
      [draft.analysisId],
    );
    const result = (rows[0].result ?? {}) as Record<string, unknown>;
    const sections = { ...((result.sections ?? {}) as Record<string, unknown>) };
    for (const s of POSTMORTEM_SECTIONS) {
      if (typeof editedSections[s] === "string") sections[s] = editedSections[s];
    }
    await pool.query(
      "UPDATE ai_analyses SET result = $1::jsonb, status = 'approved' WHERE id = $2",
      [JSON.stringify({ ...result, sections }), draft.analysisId],
    );
  } else {
    await pool.query(
      "UPDATE ai_analyses SET status = 'approved' WHERE id = $1",
      [draft.analysisId],
    );
  }
  await pool.query(
    "UPDATE incidents SET postmortem_status = 'approved' WHERE id = $1",
    [incidentId],
  );
  await emitEvent({
    type: "incident.postmortem_approved",
    entityType: "incident",
    entityId: String(incidentId),
    actorId,
    payload: { analysisId: draft.analysisId },
  });
}

export { POSTMORTEM_SECTIONS };
