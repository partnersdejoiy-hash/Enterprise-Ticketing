/**
 * Executive Briefs API (Superpower #12).
 *
 * GET  /api/briefs/latest?period=daily|weekly   — latest brief (admin/manager)
 * GET  /api/briefs/history?period=daily|weekly  — brief history (admin/manager)
 * POST /api/briefs/generate                      — generate now (admin/manager)
 */
import { Router, type Response } from "express";
import {
  authMiddleware,
  requireAdmin,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import {
  generateBrief,
  getLatestBrief,
  getBriefHistory,
  type BriefPeriod,
} from "../lib/exec-brief.js";

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

function parsePeriod(req: AuthenticatedRequest): BriefPeriod {
  const p = (req.query.period as string) ?? "daily";
  return p === "weekly" ? "weekly" : "daily";
}

router.get(
  "/briefs/latest",
  authMiddleware,
  requireManagerOrAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const brief = await getLatestBrief(parsePeriod(req));
    if (!brief) {
      res.json({ brief: null, message: "No brief generated yet for this period." });
      return;
    }
    res.json({ brief });
  },
);

router.get(
  "/briefs/history",
  authMiddleware,
  requireManagerOrAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const history = await getBriefHistory(parsePeriod(req));
    res.json({ history });
  },
);

router.post(
  "/briefs/generate",
  authMiddleware,
  requireManagerOrAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const period: BriefPeriod =
        req.body?.period === "weekly" ? "weekly" : "daily";
      const brief = await generateBrief(period, req.user!.id);
      res.json({ brief });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

export default router;
