/**
 * Orbit Command Center API (Superpower #30).
 *
 * GET /api/command-center/summary — ONE aggregated response powering the
 * enterprise command center UI. Every number comes from a real table query.
 * Empty tables produce empty sections (never fabricated numbers).
 */
import { Router, type Response } from "express";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import { healthLevelCounts } from "../lib/service-health.js";
import { todaysForecast } from "../lib/workload-forecast.js";
import { getLatestBrief } from "../lib/exec-brief.js";

const router = Router();

const OPEN_STATUSES = ["open", "assigned", "in_progress", "waiting"];

function requireManagerOrAdmin(
  req: AuthenticatedRequest, res: Response, next: () => void,
) {
  if (!["super_admin", "admin", "manager"].includes(req.user?.role ?? "")) {
    res.status(403).json({ error: "Manager access required" });
    return;
  }
  next();
}

router.get(
  "/command-center/summary",
  authMiddleware,
  requireManagerOrAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const [
        liveOps,
        sla,
        triage,
        majorIncidents,
        serviceHealth,
        queueHealth,
        risks,
        security,
        automation,
        aiActivity,
        knowledgeGaps,
        forecast,
        brief,
      ] = await Promise.all([
        liveOpsSection(),
        slaSection(),
        triageSection(),
        majorIncidentsSection(),
        healthLevelCounts(),
        queueHealthSection(),
        risksSection(),
        securitySection(),
        automationSection(),
        aiActivitySection(),
        knowledgeGapsSection(),
        todaysForecast(),
        getLatestBrief("daily"),
      ]);

      res.json({
        generated_at: new Date().toISOString(),
        live_ops: liveOps,
        sla_intelligence: sla,
        ai_triage: triage,
        major_incidents: majorIncidents,
        service_health: serviceHealth,
        queue_health: queueHealth,
        predictive_risks: risks,
        security_alerts: security,
        automation_health: automation,
        ai_activity: aiActivity,
        knowledge_gaps: knowledgeGaps,
        workload_forecast: forecast,
        executive_brief: brief
          ? {
              id: brief.id,
              briefDate: brief.briefDate,
              metrics: brief.metrics,
              hasAiSummary: brief.aiSummary != null,
            }
          : null,
      });
    } catch (err) {
      console.error("[command-center] summary failed:", err);
      res.status(500).json({ error: "Failed to build command center summary" });
    }
  },
);

async function liveOpsSection() {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = ANY($1::text[]))::int AS open_tickets,
            COUNT(*) FILTER (WHERE status = ANY($1::text[]) AND assignee_id IS NULL)::int AS unassigned,
            (SELECT COUNT(*)::int FROM incidents
             WHERE is_major AND deleted_at IS NULL AND status NOT IN ('resolved','closed')) AS major_incidents_open`,
    [OPEN_STATUSES],
  );
  return rows[0];
}

async function slaSection() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE s.resolution_due_at < now())::int AS breached,
       COUNT(*) FILTER (WHERE s.resolution_due_at >= now()
         AND (EXTRACT(EPOCH FROM (now() - t.created_at)) /
              NULLIF(EXTRACT(EPOCH FROM (s.resolution_due_at - t.created_at)), 0)) >= 0.9)::int AS critical,
       COUNT(*) FILTER (WHERE s.resolution_due_at >= now()
         AND (EXTRACT(EPOCH FROM (now() - t.created_at)) /
              NULLIF(EXTRACT(EPOCH FROM (s.resolution_due_at - t.created_at)), 0)) BETWEEN 0.7 AND 0.9)::int AS at_risk,
       COUNT(*) FILTER (WHERE s.resolution_due_at >= now()
         AND (EXTRACT(EPOCH FROM (now() - t.created_at)) /
              NULLIF(EXTRACT(EPOCH FROM (s.resolution_due_at - t.created_at)), 0)) < 0.7)::int AS safe
     FROM ticket_sla s
     JOIN tickets t ON t.id = s.ticket_id
     WHERE t.status = ANY($1::text[]) AND s.resolved_at IS NULL AND s.resolution_due_at IS NOT NULL`,
    [OPEN_STATUSES],
  );
  return {
    ...rows[0],
    note: "Calendar-time approximation of business-hours SLA health.",
  };
}

async function triageSection() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM ai_triage_results
        WHERE created_at >= now() - interval '24 hours') AS completed_24h,
       (SELECT COUNT(*)::int FROM tickets t
        WHERE t.status = ANY($1::text[])
          AND t.created_at >= now() - interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM ai_triage_results tr WHERE tr.ticket_id = t.id)
       ) AS pending`,
    [OPEN_STATUSES],
  );
  return rows[0];
}

async function majorIncidentsSection() {
  const { rows } = await pool.query(
    `SELECT id, incident_number AS "incidentNumber", title, severity, status,
            started_at AS "startedAt"
     FROM incidents
     WHERE is_major AND deleted_at IS NULL AND status NOT IN ('resolved','closed')
     ORDER BY started_at DESC LIMIT 10`,
  );
  return rows;
}

async function queueHealthSection() {
  const { rows } = await pool.query(
    `SELECT COALESCE(d.name, 'Unassigned dept') AS department,
            COUNT(*)::int AS unassigned
     FROM tickets t
     LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.status = ANY($1::text[]) AND t.assignee_id IS NULL
     GROUP BY 1 ORDER BY 2 DESC`,
    [OPEN_STATUSES],
  );
  return rows;
}

async function risksSection() {
  const { rows } = await pool.query(
    `SELECT id, risk_level AS "riskLevel", title, evidence, suggested_actions AS "suggestedActions",
            created_at AS "createdAt"
     FROM risk_predictions
     WHERE status = 'open'
     ORDER BY CASE risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              created_at DESC
     LIMIT 10`,
  );
  return rows;
}

async function securitySection() {
  const { rows } = await pool.query(
    `SELECT id, entity_type AS "entityType", entity_id AS "entityId",
            detection_type AS "detectionType", risk_level AS "riskLevel",
            evidence, recommendation, created_at AS "createdAt"
     FROM security_detections
     WHERE status = 'open'
     ORDER BY CASE risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              created_at DESC
     LIMIT 10`,
  );
  return rows;
}

async function automationSection() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'success')::int AS succeeded,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM automation_executions
     WHERE created_at >= now() - interval '24 hours'`,
  );
  const r = rows[0] as { total: number; succeeded: number; failed: number };
  return {
    ...r,
    success_rate:
      r.total > 0 ? Math.round((r.succeeded / r.total) * 100) : null,
  };
}

async function aiActivitySection() {
  const { rows } = await pool.query(
    `SELECT feature, COUNT(*)::int AS count
     FROM ai_analyses
     WHERE created_at >= now() - interval '24 hours'
     GROUP BY feature ORDER BY 2 DESC LIMIT 12`,
  );
  return rows;
}

async function knowledgeGapsSection() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS open FROM knowledge_gaps WHERE status = 'proposed'`,
  );
  const { rows: top } = await pool.query(
    `SELECT id, suggested_title AS "suggestedTitle",
            occurrence_count AS "occurrenceCount",
            created_at AS "createdAt"
     FROM knowledge_gaps WHERE status = 'proposed'
     ORDER BY occurrence_count DESC LIMIT 5`,
  );
  return { open: (rows[0] as { open: number }).open, top };
}

export default router;
