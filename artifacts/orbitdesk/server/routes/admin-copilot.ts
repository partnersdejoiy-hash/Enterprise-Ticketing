/**
 * Admin Copilot routes (#15).
 * POST /api/admin-copilot/parse   — read-only intent parse + proposed diff.
 * POST /api/admin-copilot/execute — applies ONLY with valid confirmation token.
 * Both endpoints require super_admin/admin (requireAdmin).
 */
import { Router } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
  requireAdmin,
} from "../middlewares/auth.js";
import { parseAdminCommand, executeAdminCommand } from "../lib/admin-copilot.js";

const router = Router();
router.use("/admin-copilot", authMiddleware, requireAdmin);

router.post(
  "/admin-copilot/parse",
  async (req: AuthenticatedRequest, res) => {
    try {
      const { text } = req.body ?? {};
      if (typeof text !== "string" || !text.trim() || text.length > 500) {
        res.status(400).json({ error: "Provide a command (1–500 characters)" });
        return;
      }
      const result = await parseAdminCommand(text.trim(), req.user!.id);
      res.json(result);
    } catch (err) {
      console.error("[admin-copilot] parse error:", err);
      const msg = err instanceof Error ? err.message : "Parse failed";
      const status = /access required/i.test(msg) ? 403 : 500;
      res.status(status).json({ error: msg });
    }
  },
);

router.post(
  "/admin-copilot/execute",
  async (req: AuthenticatedRequest, res) => {
    try {
      const { confirmationToken } = req.body ?? {};
      if (typeof confirmationToken !== "string" || !confirmationToken) {
        res.status(400).json({ error: "confirmationToken is required" });
        return;
      }
      const result = await executeAdminCommand(confirmationToken, req.user!.id);
      res.json(result);
    } catch (err) {
      console.error("[admin-copilot] execute error:", err);
      const msg = err instanceof Error ? err.message : "Execute failed";
      const status = /access required/i.test(msg)
        ? 403
        : /invalid|expired/i.test(msg)
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    }
  },
);

export default router;
