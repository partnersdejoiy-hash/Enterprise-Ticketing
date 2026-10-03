/**
 * AI Agent Assist (#28) + One-Click Ticket Intelligence (#29) routes.
 *
 * Mounted at /api/assist. All endpoints require auth + ticket access.
 * GET endpoints are readable by anyone who can see the ticket; POST
 * endpoints (draft/analyze) require staff access (handled by ticketAccess).
 */
import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.js";
import { ticketAccess } from "../lib/ticket-access.js";
import {
  getTicketSummary,
  getSimilarTickets,
  getRelevantKnowledge,
  getCustomerFacts,
  draftResponse,
  analyzeTicket,
} from "../lib/agent-assist.js";

const router = Router();

// All assist endpoints run under ticket access control.
// ticketAccess reads req.params.ticketId || req.params.id.
router.use("/assist/tickets/:id", authMiddleware, ticketAccess);

const asyncHandler =
  (fn: (req: any, res: any) => Promise<void>) =>
  async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      const status = /denied|not found/i.test(String(err?.message)) ? 404 : 500;
      res.status(status).json({ error: err?.message ?? "Assist request failed" });
    }
  };

router.get(
  "/assist/tickets/:id/summary",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await getTicketSummary(id, req.user.id);
    res.json(result);
  }),
);

router.get(
  "/assist/tickets/:id/similar",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await getSimilarTickets(id, req.user.id);
    res.json({ similar_tickets: result });
  }),
);

router.get(
  "/assist/tickets/:id/knowledge",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await getRelevantKnowledge(id, req.user.id);
    res.json({ knowledge: result });
  }),
);

router.get(
  "/assist/tickets/:id/customer",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await getCustomerFacts(id, req.user.id);
    res.json(result);
  }),
);

router.post(
  "/assist/tickets/:id/draft",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const tone =
      typeof req.body?.tone === "string" ? req.body.tone.slice(0, 32) : undefined;
    const result = await draftResponse(id, req.user.id, tone);
    res.json(result);
  }),
);

router.post(
  "/assist/tickets/:id/analyze",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await analyzeTicket(id, req.user.id);
    res.json(result);
  }),
);

export default router;
