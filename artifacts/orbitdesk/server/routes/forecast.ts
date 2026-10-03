/**
 * Workload Forecast API (Superpower #27).
 *
 * GET /api/forecast/dept/:id   — 7-day forecast + 90d history for a department
 * GET /api/forecast/overall    — workspace-wide forecast
 */
import { Router, type Response } from "express";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import { forecastWorkload } from "../lib/workload-forecast.js";

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
  "/forecast/dept/:id",
  authMiddleware,
  requireManagerOrAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await forecastWorkload(Number(req.params.id));
      res.json(result);
    } catch (err) {
      res.status(404).json({ error: String(err) });
    }
  },
);

router.get(
  "/forecast/overall",
  authMiddleware,
  requireManagerOrAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    const result = await forecastWorkload(null);
    res.json(result);
  },
);

export default router;
