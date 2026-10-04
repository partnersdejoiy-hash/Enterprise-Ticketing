/**
 * Service Health API (Superpower #26).
 *
 * GET  /api/service-health          — all CIs with stored health levels
 * GET  /api/service-health/:id      — CI detail with explainable breakdown
 * POST /api/service-health/:id/recompute — recompute now (admin/manager)
 */
import { Router, type Response } from "express";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import {
  computeServiceHealth,
  listServiceHealth,
} from "../lib/service-health.js";

const router = Router();

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
  "/service-health",
  authMiddleware,
  requireManagerOrAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    const items = await listServiceHealth();
    res.json({ items });
  },
);

router.get(
  "/service-health/:id",
  authMiddleware,
  requireManagerOrAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const health = await computeServiceHealth(Number(req.params.id));
      res.json({ health });
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  },
);

router.post(
  "/service-health/:id/recompute",
  authMiddleware,
  requireManagerOrAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const health = await computeServiceHealth(Number(req.params.id));
      res.json({ health });
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  },
);

export default router;
