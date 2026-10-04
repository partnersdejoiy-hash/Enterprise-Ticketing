/**
 * Customer Memory API (Superpower #21).
 *
 *   GET /api/customers/:id/summary   customer 360 summary (staff only)
 *
 * Staff-only: super_admin, admin, manager, agent. The summary includes only
 * tickets the requesting agent is permitted to see (ticket-access scope).
 * The AI layer is forbidden from inferring sensitive personal traits.
 */

import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthenticatedRequest } from "../middlewares/auth.js";
import { getCustomerSummary } from "../lib/customer-memory.js";

const router = Router();
router.use("/customers", authMiddleware);

router.get("/customers/:id/summary", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid customer id" });
      return;
    }
    const summary = await getCustomerSummary(id, req.user!.id);
    res.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load summary";
    const status = /not authorized|not found/i.test(msg) ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

export default router;
