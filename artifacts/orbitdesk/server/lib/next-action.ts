/**
 * Next-Best-Action Engine (Superpower #19).
 *
 * Deterministic, rule-based v1 — NO AI calls. Every recommendation is
 * explainable: it carries the reason and the evidence that triggered it.
 * Stored as an ai_recommendation with kind='next_action' so a human can
 * approve/reject it. Nothing is executed automatically.
 */

import { pool } from "@workspace/db";
import { proposeRecommendation } from "./orbit-ai.js";

export interface NextAction {
  action: string; // machine key: review_duplicate | send_followup | escalate | assign_agent | post_update | none
  title: string;
  reason: string;
  confidence: number;
  evidence: { fact: string; value: string }[];
  recommendationId: number | null;
}

interface TicketLite {
  id: number;
  ticketNumber: string;
  status: string;
  priority: string;
  assigneeId: number | null;
  departmentId: number | null;
  departmentName: string | null;
  slaDeadline: string | null;
  updatedAt: string;
  tenantId: number | null;
}

const HOURS = 3600_000;

export async function getNextBestAction(
  ticketId: number,
): Promise<NextAction> {
  const { rows } = await pool.query(
    `SELECT t.id, t.ticket_number AS "ticketNumber", t.status, t.priority,
            t.assignee_id AS "assigneeId", t.department_id AS "departmentId",
            d.name AS "departmentName", t.sla_deadline AS "slaDeadline",
            t.updated_at AS "updatedAt", t.tenant_id AS "tenantId"
     FROM tickets t LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.id = $1 LIMIT 1`,
    [ticketId],
  );
  const t = rows[0] as TicketLite | undefined;
  if (!t) throw new Error("Ticket not found");

  const now = Date.now();
  const updatedAgoH = (now - new Date(t.updatedAt).getTime()) / HOURS;
  const evidence: { fact: string; value: string }[] = [];
  let action = "none";
  let title = "No action needed";
  let reason =
    "Ticket is progressing normally — no rule threshold was crossed.";
  let confidence = 60;

  // 1. Proposed duplicate awaiting review (highest priority — data quality).
  const { rows: dupRows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ticket_relationships
     WHERE source_ticket_id = $1 AND relationship_type = 'duplicate_of'
       AND status = 'proposed'`,
    [ticketId],
  );
  if (dupRows[0].c > 0) {
    action = "review_duplicate";
    title = "Review duplicate suggestion";
    reason = `${dupRows[0].c} possible duplicate ticket${dupRows[0].c > 1 ? "s were" : " was"} detected. Review and merge, link, or dismiss.`;
    confidence = 88;
    evidence.push({
      fact: "proposed_duplicates",
      value: String(dupRows[0].c),
    });
  }
  // 2. Waiting on customer too long.
  else if (t.status === "waiting" && updatedAgoH > 18) {
    action = "send_followup";
    title = "Send customer follow-up";
    reason = `Waiting for customer response for ${Math.floor(updatedAgoH)} hours. A follow-up nudge usually unblocks these tickets.`;
    confidence = 85;
    evidence.push(
      { fact: "status", value: t.status },
      { fact: "hours_since_update", value: updatedAgoH.toFixed(1) },
    );
  }
  // 3. SLA breached or about to breach.
  else if (t.slaDeadline) {
    const msLeft = new Date(t.slaDeadline).getTime() - now;
    if (msLeft <= 0) {
      action = "escalate";
      title = `Escalate to ${t.departmentName ?? "department"} team`;
      reason = "SLA deadline has been breached. Escalation is recommended to protect resolution time.";
      confidence = 95;
      evidence.push({ fact: "sla_status", value: "breached" });
    } else if (msLeft < 2 * HOURS) {
      action = "escalate";
      title = `Escalate to ${t.departmentName ?? "department"} team`;
      reason = `SLA breach predicted within ${Math.max(1, Math.round(msLeft / 60000))} minutes. Escalate before the deadline passes.`;
      confidence = 90;
      evidence.push({
        fact: "sla_minutes_remaining",
        value: String(Math.round(msLeft / 60000)),
      });
    }
  }
  // 4. Nobody owns it.
  if (action === "none" && !t.assigneeId) {
    action = "assign_agent";
    title = "Assign an agent";
    reason =
      "Ticket has no assignee. Unassigned tickets age without attention — assign an agent to start the clock on resolution.";
    confidence = 92;
    evidence.push({ fact: "assignee", value: "unassigned" });
  }
  // 5. Gone quiet.
  if (action === "none" && updatedAgoH > 24) {
    action = "post_update";
    title = "Post a status update";
    reason = `No update in ${Math.floor(updatedAgoH / 24)} day(s). A brief status note keeps the requester informed and the ticket moving.`;
    confidence = 80;
    evidence.push({
      fact: "hours_since_update",
      value: updatedAgoH.toFixed(1),
    });
  }

  let recommendationId: number | null = null;
  if (action !== "none") {
    try {
      recommendationId = await proposeRecommendation({
        tenantId: t.tenantId,
        entityType: "ticket",
        entityId: String(ticketId),
        kind: "next_action",
        title,
        detail: reason,
        confidence,
        evidence,
        expiresInHours: 24,
      });
    } catch (err) {
      console.error("[next-action] recommendation store failed:", err);
    }
  }

  return { action, title, reason, confidence, evidence, recommendationId };
}
