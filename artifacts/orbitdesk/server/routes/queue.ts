/**
 * AI Queue Optimizer (Superpower #7) routes.
 *
 * Mounted at /api/queue. All endpoints require session auth; ticket
 * endpoints additionally require ticket access (fail closed via
 * canAccessTicket). Apply + policy writes are manager+ only.
 */
import { Router } from "express";
import { authMiddleware, type AuthenticatedRequest } from "../middlewares/auth.js";
import { canAccessTicket } from "../lib/ticket-access.js";
import {
  QueueError,
  recommendAssignment,
  applyRecommendation,
  getQueuePolicy,
  setQueuePolicy,
  getFreshRecommendation,
  listRecommendations,
} from "../lib/queue-optimizer.js";

const router = Router();

function sendErr(res: any, err: unknown) {
  const status = err instanceof QueueError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Queue request failed";
  if (status === 500) console.error("[queue]", err);
  res.status(status).json({ ok: false, error: message });
}

function mustBeStaff(req: AuthenticatedRequest, res: any): boolean {
  const role = req.user?.role ?? "";
  if (!["admin", "super_admin", "manager"].includes(role)) {
    res.status(403).json({ ok: false, error: "Manager role required" });
    return false;
  }
  return true;
}

/**
 * GET /api/queue/tickets/:id/recommendation
 * Returns the latest unapplied recommendation if fresh (< 15 min),
 * otherwise computes a new one.
 */
router.get("/queue/tickets/:id/recommendation", authMiddleware, async (req, res) => {
  const r = req as AuthenticatedRequest;
  const ticketId = Number(r.params.id);
  try {
    if (!Number.isSafeInteger(ticketId) || ticketId < 1)
      throw new QueueError("Invalid ticket id", 400);
    if (!r.user || !(await canAccessTicket(r.user, ticketId)))
      throw new QueueError("Ticket not found", 404);

    const fresh = await getFreshRecommendation(ticketId);
    if (fresh) {
      res.json({ ok: true, fresh: true, recommendation: shapeStored(fresh) });
      return;
    }
    const result = await recommendAssignment(ticketId, r.user.id);
    res.json({ ok: true, fresh: false, recommendation: shapeComputed(result) });
  } catch (err) {
    sendErr(res, err);
  }
});

/**
 * POST /api/queue/tickets/:id/apply  { recommendationId }
 * Reassigns the ticket to the recommended agent. Manager+ only.
 */
router.post("/queue/tickets/:id/apply", authMiddleware, async (req, res) => {
  const r = req as AuthenticatedRequest;
  const ticketId = Number(r.params.id);
  try {
    if (!mustBeStaff(r, res)) return;
    if (!Number.isSafeInteger(ticketId) || ticketId < 1)
      throw new QueueError("Invalid ticket id", 400);
    const recommendationId = Number((r.body as any)?.recommendationId);
    if (!Number.isSafeInteger(recommendationId) || recommendationId < 1)
      throw new QueueError("recommendationId is required", 400);
    if (!r.user || !(await canAccessTicket(r.user, ticketId)))
      throw new QueueError("Ticket not found", 404);

    const applied = await applyRecommendation(recommendationId, r.user.id);
    if (applied.ticketId !== ticketId)
      throw new QueueError("Recommendation does not belong to this ticket", 409);
    res.json({ ok: true, ...applied });
  } catch (err) {
    sendErr(res, err);
  }
});

/**
 * GET /api/queue/policy?departmentId=<id>
 * Current assignment policy for a department (defaults to ai_recommended).
 */
router.get("/queue/policy", authMiddleware, async (req, res) => {
  try {
    const departmentId = req.query.departmentId
      ? Number(req.query.departmentId)
      : null;
    const policy = await getQueuePolicy(departmentId);
    res.json({ ok: true, departmentId, policy });
  } catch (err) {
    sendErr(res, err);
  }
});

/**
 * PUT /api/queue/policy  { departmentId, policy }
 * Set the assignment policy for a department. Manager+ only.
 */
router.put("/queue/policy", authMiddleware, async (req, res) => {
  const r = req as AuthenticatedRequest;
  try {
    if (!mustBeStaff(r, res)) return;
    const { departmentId, policy } = (r.body ?? {}) as {
      departmentId?: number | null;
      policy?: string;
    };
    const policyValue = await setQueuePolicy(
      departmentId == null ? null : Number(departmentId),
      policy ?? "",
    );
    res.json({ ok: true, departmentId: departmentId ?? null, policy: policyValue });
  } catch (err) {
    sendErr(res, err);
  }
});

/**
 * GET /api/queue/tickets/:id/history
 * All past recommendations for a ticket, newest first.
 */
router.get("/queue/tickets/:id/history", authMiddleware, async (req, res) => {
  const r = req as AuthenticatedRequest;
  const ticketId = Number(r.params.id);
  try {
    if (!Number.isSafeInteger(ticketId) || ticketId < 1)
      throw new QueueError("Invalid ticket id", 400);
    if (!r.user || !(await canAccessTicket(r.user, ticketId)))
      throw new QueueError("Ticket not found", 404);
    const history = await listRecommendations(ticketId);
    res.json({ ok: true, history: history.map(shapeStored) });
  } catch (err) {
    sendErr(res, err);
  }
});

function shapeStored(rec: {
  id: number;
  ticketId: number;
  agentId: number | null;
  agentName: string | null;
  policy: string;
  confidence: number | null;
  applied: boolean;
  createdAt: string;
  reasons: unknown;
}) {
  return {
    recommendationId: rec.id,
    ticketId: rec.ticketId,
    policy: rec.policy,
    applied: rec.applied,
    createdAt: rec.createdAt,
    confidence: rec.confidence,
    winner:
      rec.agentId != null
        ? { agentId: rec.agentId, agentName: rec.agentName }
        : null,
    candidates: (rec.reasons as any[]) ?? [],
  };
}

function shapeComputed(result: {
  recommendationId: number;
  ticketId: number;
  departmentId: number | null;
  policy: string;
  winner: unknown;
  candidates: unknown[];
  weights: unknown;
}) {
  return { ...result };
}

export default router;
