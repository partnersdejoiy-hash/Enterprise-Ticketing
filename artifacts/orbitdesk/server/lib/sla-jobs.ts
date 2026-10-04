/**
 * SLA background jobs (Superpower #1).
 *
 * runSlaPredictionBatch: periodically re-predicts breach risk for open
 * tickets with SLA policies. Called from the cron worker
 * (GET /api/cron/sla-predict). Bounded to respect the shared AI quota.
 *
 * Emits ticket.sla_warning when deterministic health escalates to
 * at_risk/critical, and ticket.sla_breached on first breach detection.
 */

import { pool } from "@workspace/db";
import { getSlaStatus } from "./sla-engine.js";
import { predictSlaBreach } from "./sla-predict.js";
import { emitEvent, EventTypes } from "./orbit-events.js";

const OPEN_STATUSES = ["open", "assigned", "in_progress", "waiting"];

/**
 * Run predictions for the most at-risk open tickets.
 * Skips tickets predicted in the last 6 hours. Stops early if the AI
 * quota is exhausted (completeAi throws).
 */
export async function runSlaPredictionBatch(
  max = 20,
): Promise<{ predicted: number; warnings: number; breaches: number }> {
  // Candidates: open tickets with an SLA row, ordered by most-elapsed first
  // (approximation in SQL; precise business-hours math happens per ticket).
  // Prefer tickets not predicted recently.
  const { rows: candidates } = await pool.query(
    `SELECT t.id
     FROM tickets t
     JOIN ticket_sla s ON s.ticket_id = t.id
     WHERE t.status = ANY($1)
       AND s.resolution_due_at IS NOT NULL
       AND s.resolved_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM sla_predictions p
         WHERE p.ticket_id = t.id
           AND p.created_at > now() - interval '6 hours'
       )
     ORDER BY s.resolution_due_at ASC NULLS LAST
     LIMIT $2`,
    [OPEN_STATUSES, max],
  );

  let predicted = 0;
  let warnings = 0;
  let breaches = 0;

  for (const { id } of candidates) {
    let status;
    try {
      status = await getSlaStatus(id);
    } catch (err) {
      console.error(`[sla-jobs] status failed for ticket ${id}:`, err);
      continue;
    }

    // Deterministic breach handling (no AI needed).
    if (status.health === "breached") {
      const { rows: flagged } = await pool.query(
        `UPDATE ticket_sla SET breach_notified = true, updated_at = now()
         WHERE ticket_id = $1 AND breach_notified = false
         RETURNING ticket_id`,
        [id],
      );
      if (flagged[0]) {
        await emitEvent({
          type: EventTypes.TICKET_SLA_BREACHED,
          entityType: "ticket",
          entityId: String(id),
          actorType: "system",
          payload: { policy: status.policyName },
        });
        breaches++;
      }
      continue;
    }

    // AI prediction (force=true: batch owns the refresh cadence).
    try {
      const prediction = await predictSlaBreach(id, null, { force: true });
      predicted++;
      if (prediction.health === "at_risk" || prediction.health === "critical") {
        await emitEvent({
          type: EventTypes.TICKET_SLA_WARNING,
          entityType: "ticket",
          entityId: String(id),
          actorType: "ai",
          payload: {
            health: prediction.health,
            breach_probability: prediction.breachProbability,
            predicted_breach_at: prediction.predictedBreachAt,
          },
        });
        warnings++;
      }
    } catch (err) {
      const msg = String(err);
      console.error(`[sla-jobs] prediction failed for ticket ${id}:`, msg);
      // Quota exhausted → stop the batch, don't burn further calls.
      if (/quota|rate limit|429/i.test(msg)) break;
    }
  }

  return { predicted, warnings, breaches };
}
