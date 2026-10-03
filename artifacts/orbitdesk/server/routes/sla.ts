/**
 * Orbit SLA Intelligence routes (Superpower #1).
 *
 *  GET  /sla/tickets/:id/status      live deterministic SLA status
 *  GET  /sla/tickets/:id/prediction  latest AI prediction (read-only)
 *  POST /sla/tickets/:id/predict     run fresh AI prediction (agent+, cooldown)
 *  GET  /sla/dashboard               health counts for SLA widgets
 *  GET  /sla/policies                list policies (admin)
 *  POST /sla/policies                create policy (admin)
 *
 * Predictions never auto-execute actions — recommendations only.
 */

import { Router } from "express";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  requireAdmin,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import { ticketAccess } from "../lib/ticket-access.js";
import { getSlaStatus } from "../lib/sla-engine.js";
import {
  predictSlaBreach,
  getLatestPrediction,
} from "../lib/sla-predict.js";

const router = Router();

router.use("/sla", authMiddleware);

// ---- Per-ticket: status + prediction (ticket access enforced) ----

router.get(
  "/sla/tickets/:id/status",
  ticketAccess,
  async (req: AuthenticatedRequest, res) => {
    try {
      const status = await getSlaStatus(Number(req.params.id));
      res.json({ ok: true, status });
    } catch (err: unknown) {
      console.error("[sla] status failed:", err);
      res.status(500).json({ ok: false, error: "Failed to compute SLA status" });
    }
  },
);

router.get(
  "/sla/tickets/:id/prediction",
  ticketAccess,
  async (req: AuthenticatedRequest, res) => {
    try {
      const prediction = await getLatestPrediction(Number(req.params.id));
      res.json({ ok: true, prediction, hasPrediction: !!prediction });
    } catch (err: unknown) {
      console.error("[sla] prediction fetch failed:", err);
      res
        .status(500)
        .json({ ok: false, error: "Failed to load SLA prediction" });
    }
  },
);

router.post(
  "/sla/tickets/:id/predict",
  ticketAccess,
  async (req: AuthenticatedRequest, res) => {
    try {
      // External requesters may view predictions, not trigger AI analysis.
      if (req.user?.role === "external") {
        res.status(403).json({ ok: false, error: "Not permitted" });
        return;
      }
      const prediction = await predictSlaBreach(
        Number(req.params.id),
        req.user!.id,
      );
      res.json({ ok: true, prediction });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Prediction failed";
      console.error("[sla] predict failed:", msg);
      const code = /denied|access/i.test(msg) ? 403 : 500;
      res.status(code).json({ ok: false, error: msg });
    }
  },
);

// ---- Dashboard: health counts (scoped to the caller's tickets) ----

router.get("/sla/dashboard", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const isAdmin = ["admin", "super_admin"].includes(user.role);

    // Replicate ticketScope in raw SQL (personal + department handling).
    let scope = "TRUE";
    const params: unknown[] = [];
    if (!isAdmin) {
      const parts: string[] = [
        `(t.created_by_id = $1 OR t.raised_for_user_id = $1 OR t.assignee_id = $1 OR $1 = ANY(t.tagged_user_ids))`,
      ];
      params.push(user.id);
      if (["agent", "manager"].includes(user.role) && user.departmentId) {
        parts.push(`(t.department_id = $2)`);
        params.push(user.departmentId);
      }
      scope = `(${parts.join(" OR ")})`;
    }

    const { rows } = await pool.query(
      `WITH open_sla AS (
         SELECT t.id, s.resolution_due_at, s.resolved_at,
                p.resolution_minutes, t.created_at
         FROM tickets t
         JOIN ticket_sla s ON s.ticket_id = t.id
         LEFT JOIN sla_policies p ON p.id = s.policy_id
         WHERE t.status = ANY(ARRAY['open','assigned','in_progress','waiting'])
           AND ${scope}
       ),
       scored AS (
         SELECT id,
           CASE
             WHEN resolved_at IS NOT NULL THEN 'met'
             WHEN resolution_due_at IS NULL OR resolution_minutes IS NULL THEN 'no_policy'
             WHEN resolution_due_at < now() THEN 'breached'
             WHEN (EXTRACT(EPOCH FROM (now() - created_at))/60) / NULLIF(resolution_minutes,0) * 100 >= 90 THEN 'critical'
             WHEN (EXTRACT(EPOCH FROM (now() - created_at))/60) / NULLIF(resolution_minutes,0) * 100 >= 70 THEN 'at_risk'
             ELSE 'safe'
           END AS health
         FROM open_sla
       )
       SELECT
         COUNT(*) FILTER (WHERE health='safe') AS safe,
         COUNT(*) FILTER (WHERE health='at_risk') AS at_risk,
         COUNT(*) FILTER (WHERE health='critical') AS critical,
         COUNT(*) FILTER (WHERE health='breached') AS breached,
         COUNT(*) FILTER (WHERE health='met') AS met,
         COUNT(*) FILTER (WHERE health='no_policy') AS no_policy,
         COUNT(*) AS total
       FROM scored`,
      params,
    );
    const r = rows[0];
    res.json({
      ok: true,
      dashboard: {
        safe: Number(r.safe),
        atRisk: Number(r.at_risk),
        critical: Number(r.critical),
        breached: Number(r.breached),
        met: Number(r.met),
        noPolicy: Number(r.no_policy),
        total: Number(r.total),
      },
      // Wall-clock approximation; per-ticket view uses exact business-hours math.
      approximate: true,
    });
  } catch (err: unknown) {
    console.error("[sla] dashboard failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load SLA dashboard" });
  }
});

// ---- Policies (admin only) ----

router.get("/sla/policies", requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.department_id AS "departmentId", d.name AS "departmentName",
              p.priority, p.first_response_minutes AS "firstResponseMinutes",
              p.resolution_minutes AS "resolutionMinutes",
              p.business_hours_only AS "businessHoursOnly",
              p.is_active AS "isActive"
       FROM sla_policies p
       LEFT JOIN departments d ON d.id = p.department_id
       ORDER BY p.is_active DESC, p.id DESC`,
    );
    res.json({ ok: true, policies: rows });
  } catch (err: unknown) {
    console.error("[sla] policies list failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load policies" });
  }
});

router.post("/sla/policies", requireAdmin, async (req, res) => {
  try {
    const {
      name, departmentId, priority,
      firstResponseMinutes, resolutionMinutes, businessHoursOnly,
    } = req.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ ok: false, error: "Policy name is required" });
      return;
    }
    const fr = Number(firstResponseMinutes);
    const rr = Number(resolutionMinutes);
    if (!Number.isInteger(fr) || fr <= 0 || !Number.isInteger(rr) || rr <= 0) {
      res.status(400).json({
        ok: false,
        error: "firstResponseMinutes and resolutionMinutes must be positive integers",
      });
      return;
    }
    const prio = priority ?? null;
    if (prio !== null && !["low", "medium", "high", "urgent"].includes(prio)) {
      res.status(400).json({ ok: false, error: "Invalid priority" });
      return;
    }
    const dept = departmentId ?? null;
    if (dept !== null && (!Number.isInteger(Number(dept)) || Number(dept) < 1)) {
      res.status(400).json({ ok: false, error: "Invalid department" });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO sla_policies
         (name, department_id, priority, first_response_minutes,
          resolution_minutes, business_hours_only, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name`,
      [
        name.trim(), dept, prio, fr, rr,
        businessHoursOnly !== false,
        (req as AuthenticatedRequest).user?.id ?? null,
      ],
    );
    res.status(201).json({ ok: true, policy: rows[0] });
  } catch (err: unknown) {
    console.error("[sla] policy create failed:", err);
    res.status(500).json({ ok: false, error: "Failed to create policy" });
  }
});

export default router;
