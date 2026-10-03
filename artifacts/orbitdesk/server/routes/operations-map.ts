/**
 * Operations Map API (Superpower #11 — Global Operations Map).
 *
 *   GET /api/ops-map/markers?department_id=&severity=
 *       Clustered per-department markers: open tickets, incidents,
 *       SLA risks, assets, active agents, worst severity.
 *   GET /api/ops-map/markers/:departmentId
 *       Detail panel: tickets, incidents, assets, SLA risks, agents.
 *
 * Location privacy: exact coordinates only for super_admin/admin.
 * Others get rounded coordinates (~11 km) and never see exact lat/lng
 * in the detail endpoint.
 */

import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthenticatedRequest } from "../middlewares/auth.js";
import { getOpsMarkers, getMarkerDetail } from "../lib/geo.js";

const router = Router();
router.use("/ops-map", authMiddleware);

router.get("/ops-map/markers", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const departmentId = req.query.department_id ? Number(req.query.department_id) : null;
    const severity = typeof req.query.severity === "string" ? req.query.severity : null;
    const markers = await getOpsMarkers({
      actorRole: req.user!.role,
      departmentFilter: departmentId,
      severityFilter: severity,
    });
    res.json({ markers });
  } catch (err) {
    res.status(500).json({ error: "Failed to load operations map" });
  }
});

router.get("/ops-map/markers/:departmentId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.departmentId);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid department id" });
      return;
    }
    const detail = await getMarkerDetail(id, req.user!.role);
    res.json(detail);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load marker detail";
    res.status(/not found|invalid/i.test(msg) ? 404 : 500).json({ error: msg });
  }
});

export default router;
