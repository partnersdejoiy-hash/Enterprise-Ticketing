/**
 * Organizational Memory routes (#14).
 * POST /api/memory/index   — index an entity (admin).
 * GET  /api/memory/search  — permission-filtered keyword search.
 * POST /api/memory/searchable — admin toggle for searchable flag.
 */
import { Router } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
  requireAdmin,
} from "../middlewares/auth.js";
import { indexMemory, searchMemory, setSearchable } from "../lib/org-memory.js";

const router = Router();
router.use("/memory", authMiddleware);

router.post(
  "/memory/index",
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { sourceType, sourceId } = req.body ?? {};
      if (typeof sourceType !== "string" || typeof sourceId !== "string") {
        res.status(400).json({ error: "sourceType and sourceId are required" });
        return;
      }
      const result = await indexMemory(
        sourceType,
        sourceId,
        req.user!.id,
      );
      res.status(201).json(result);
    } catch (err) {
      console.error("[memory] index error:", err);
      const msg = err instanceof Error ? err.message : "Index failed";
      const status = /not found|invalid|only resolved/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  },
);

router.get("/memory/search", async (req: AuthenticatedRequest, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q || q.length > 200) {
      res.status(400).json({ error: "Provide a query (1–200 chars)" });
      return;
    }
    const results = await searchMemory(q, req.user!.id);
    res.json({ results });
  } catch (err) {
    console.error("[memory] search error:", err);
    const msg = err instanceof Error ? err.message : "Search failed";
    const status = /authentication required/i.test(msg) ? 401 : 500;
    res.status(status).json({ error: msg });
  }
});

router.post(
  "/memory/searchable",
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { kind, id, searchable } = req.body ?? {};
      if (!["memory", "article"].includes(kind) || typeof searchable !== "boolean") {
        res.status(400).json({ error: "kind (memory|article) and searchable are required" });
        return;
      }
      await setSearchable(kind, Number(id), searchable, req.user!.id);
      res.json({ success: true });
    } catch (err) {
      console.error("[memory] searchable error:", err);
      const msg = err instanceof Error ? err.message : "Update failed";
      const status = /access required/i.test(msg) ? 403 : 500;
      res.status(status).json({ error: msg });
    }
  },
);

export default router;
