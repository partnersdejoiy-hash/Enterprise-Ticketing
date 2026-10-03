/**
 * Automation Copilot routes (#24).
 * POST /api/automation-copilot/preview — AI-generated rule preview (not saved).
 * POST /api/automation-copilot/create  — saves as DRAFT (is_active=false).
 * Both require super_admin/admin.
 */
import { Router } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
  requireAdmin,
} from "../middlewares/auth.js";
import {
  generateAutomation,
  createAutomationDraft,
  GeneratedAutomation,
} from "../lib/automation-copilot.js";

const router = Router();
router.use("/automation-copilot", authMiddleware, requireAdmin);

router.post(
  "/automation-copilot/preview",
  async (req: AuthenticatedRequest, res) => {
    try {
      const { description } = req.body ?? {};
      if (
        typeof description !== "string" ||
        !description.trim() ||
        description.length > 2000
      ) {
        res.status(400).json({ error: "Provide a description (1–2000 characters)" });
        return;
      }
      const generated = await generateAutomation(
        description.trim(),
        req.user!.id,
      );
      res.json({ preview: generated });
    } catch (err) {
      console.error("[automation-copilot] preview error:", err);
      const msg = err instanceof Error ? err.message : "Preview failed";
      const status = /access required/i.test(msg) ? 403 : 500;
      res.status(status).json({ error: msg });
    }
  },
);

router.post(
  "/automation-copilot/create",
  async (req: AuthenticatedRequest, res) => {
    try {
      const { generated } = req.body ?? {} as {
        generated?: GeneratedAutomation;
      };
      if (!generated || typeof generated !== "object") {
        res.status(400).json({ error: "generated rule payload is required" });
        return;
      }
      const rule = await createAutomationDraft(generated, req.user!.id);
      res.status(201).json({
        ...rule,
        is_active: false,
        message:
          "Draft rule created (inactive). Enable it from Automation Rules when ready.",
      });
    } catch (err) {
      console.error("[automation-copilot] create error:", err);
      const msg = err instanceof Error ? err.message : "Create failed";
      const status = /access required/i.test(msg)
        ? 403
        : /invalid|validation/i.test(msg)
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    }
  },
);

export default router;
