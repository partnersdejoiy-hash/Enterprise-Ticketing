/**
 * Root Cause Intelligence API (#6).
 *
 * GET  /root-cause/clusters                    — recurring-issue clusters (staff)
 * POST /root-cause/analyze                     — propose hypotheses (staff)
 * GET  /root-cause/hypotheses                   — list hypotheses (staff)
 * POST /root-cause/hypotheses/:id/confirm      — human confirm/reject (staff)
 */

import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";
import { pool } from "@workspace/db";
import {
  detectClusters,
  proposeRootCause,
  confirmHypothesis,
} from "../lib/root-cause.js";

const router = Router();
router.use("/root-cause", authMiddleware);

const STAFF_ROLES = ["super_admin", "admin", "manager", "agent"];
const ENTITY_TYPES = ["incident", "problem"];

function requireStaff(req: AuthenticatedRequest): boolean {
  return !!req.user && STAFF_ROLES.includes(req.user.role);
}

/** GET /root-cause/clusters — ticket clusters with >= 3 members. */
router.get("/root-cause/clusters", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const clusters = await detectClusters(req.user!.id);
    res.json({ ok: true, clusters });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Clustering failed" });
  }
});

/** POST /root-cause/analyze { ticket_ids: number[] } — propose hypotheses. */
router.post("/root-cause/analyze", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const { ticket_ids: ticketIds } = req.body ?? {};
    if (
      !Array.isArray(ticketIds) ||
      ticketIds.length < 3 ||
      ticketIds.length > 50 ||
      !ticketIds.every((n) => Number.isSafeInteger(n) && n > 0)
    ) {
      res
        .status(400)
        .json({ error: "ticket_ids must be an array of 3..50 ticket ids" });
      return;
    }
    const result = await proposeRootCause(ticketIds, req.user!.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Analysis failed" });
  }
});

/** GET /root-cause/hypotheses?entity_type=problem&entity_id=N */
router.get("/root-cause/hypotheses", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const entityType = String(req.query.entity_type ?? "");
    const entityId = Number(req.query.entity_id);
    if (!ENTITY_TYPES.includes(entityType)) {
      res.status(400).json({ error: "entity_type must be incident or problem" });
      return;
    }
    if (!Number.isSafeInteger(entityId) || entityId < 1) {
      res.status(400).json({ error: "entity_id must be a positive integer" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, tenant_id, entity_type, entity_id, hypothesis, confidence,
              evidence, status, decided_by_id, decided_at, created_at
       FROM root_cause_hypotheses
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY created_at DESC`,
      [entityType, entityId],
    );
    res.json({ ok: true, hypotheses: rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to list hypotheses" });
  }
});

/** POST /root-cause/hypotheses/:id/confirm { confirmed, authored_text? } */
router.post(
  "/root-cause/hypotheses/:id/confirm",
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!requireStaff(req)) {
        res.status(403).json({ error: "Staff access required" });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        res.status(400).json({ error: "Invalid hypothesis id" });
        return;
      }
      const { confirmed, authored_text: authoredText } = req.body ?? {};
      if (typeof confirmed !== "boolean") {
        res.status(400).json({ error: "confirmed must be a boolean" });
        return;
      }
      if (
        authoredText !== undefined &&
        (typeof authoredText !== "string" || authoredText.length > 5000)
      ) {
        res.status(400).json({ error: "authored_text must be a string" });
        return;
      }
      const hypothesis = await confirmHypothesis(
        id,
        req.user!.id,
        confirmed,
        authoredText,
      );
      res.json({ ok: true, hypothesis });
    } catch (err) {
      const e = err as Error & { status?: number };
      res
        .status(e.status ?? 500)
        .json({ error: e.message ?? "Failed to decide hypothesis" });
    }
  },
);

export default router;
