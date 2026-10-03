/**
 * AI Resolution Agent API (#3).
 *
 * POST /resolution/tickets/:id/plan — generate a grounded resolution plan
 * GET  /resolution/tickets/:id/plan — latest plan for a ticket
 * POST /resolution/plan/:id/approve — approve (optionally with edited steps)
 * POST /resolution/plan/:id/reject  — reject with optional note
 * POST /resolution/plan/:id/execute — execute an approved plan (allowlisted actions only)
 */

import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";
import { pool } from "@workspace/db";
import { canAccessTicket } from "../lib/ticket-access.js";
import {
  generateResolutionPlan,
  approvePlan,
  rejectPlan,
  executePlan,
} from "../lib/resolution-agent.js";

const router = Router();
router.use("/resolution", authMiddleware);

function errStatus(err: unknown): number {
  return (err as Error & { status?: number }).status ?? 500;
}

/** POST /resolution/tickets/:id/plan — generate plan. Access denial -> 404. */
router.post("/resolution/tickets/:id/plan", async (req: AuthenticatedRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    if (!Number.isSafeInteger(ticketId) || ticketId < 1) {
      res.status(400).json({ error: "Invalid ticket id" });
      return;
    }
    const plan = await generateResolutionPlan(ticketId, req.user!.id);
    res.json({ ok: true, plan });
  } catch (err) {
    const status = errStatus(err);
    res
      .status(status === 403 ? 404 : status)
      .json({ error: (err as Error).message ?? "Failed to generate plan" });
  }
});

/** GET /resolution/tickets/:id/plan — latest plan for the ticket. */
router.get("/resolution/tickets/:id/plan", async (req: AuthenticatedRequest, res) => {
  try {
    const ticketId = Number(req.params.id);
    if (!Number.isSafeInteger(ticketId) || ticketId < 1) {
      res.status(400).json({ error: "Invalid ticket id" });
      return;
    }
    if (!req.user || !(await canAccessTicket(req.user, ticketId))) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, ticket_id, analysis_id, steps, actions, confidence, sources,
              recommended_action, requires_approval, risk_level, status,
              decided_by_id, decided_at, decision_note, executed_at,
              execution_log, created_by_id, created_at
       FROM resolution_plans
       WHERE ticket_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [ticketId],
    );
    res.json({ ok: true, plan: rows[0] ?? null });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to load plan" });
  }
});

/** POST /resolution/plan/:id/approve { steps?: [...] } */
router.post("/resolution/plan/:id/approve", async (req: AuthenticatedRequest, res) => {
  try {
    const planId = Number(req.params.id);
    if (!Number.isSafeInteger(planId) || planId < 1) {
      res.status(400).json({ error: "Invalid plan id" });
      return;
    }
    const { steps } = req.body ?? {};
    if (steps !== undefined && !Array.isArray(steps)) {
      res.status(400).json({ error: "steps must be an array" });
      return;
    }
    const plan = await approvePlan(planId, req.user!.id, steps);
    res.json({ ok: true, plan });
  } catch (err) {
    res
      .status(errStatus(err))
      .json({ error: (err as Error).message ?? "Failed to approve plan" });
  }
});

/** POST /resolution/plan/:id/reject { note?: string } */
router.post("/resolution/plan/:id/reject", async (req: AuthenticatedRequest, res) => {
  try {
    const planId = Number(req.params.id);
    if (!Number.isSafeInteger(planId) || planId < 1) {
      res.status(400).json({ error: "Invalid plan id" });
      return;
    }
    const { note } = req.body ?? {};
    if (note !== undefined && typeof note !== "string") {
      res.status(400).json({ error: "note must be a string" });
      return;
    }
    const plan = await rejectPlan(planId, req.user!.id, note);
    res.json({ ok: true, plan });
  } catch (err) {
    res
      .status(errStatus(err))
      .json({ error: (err as Error).message ?? "Failed to reject plan" });
  }
});

/** POST /resolution/plan/:id/execute — approval gating enforced in lib. */
router.post("/resolution/plan/:id/execute", async (req: AuthenticatedRequest, res) => {
  try {
    const planId = Number(req.params.id);
    if (!Number.isSafeInteger(planId) || planId < 1) {
      res.status(400).json({ error: "Invalid plan id" });
      return;
    }
    const result = await executePlan(planId, req.user!.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res
      .status(errStatus(err))
      .json({ error: (err as Error).message ?? "Failed to execute plan" });
  }
});

export default router;
