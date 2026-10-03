/**
 * Knowledge routes (#25 + article management).
 * /api/knowledge/*
 *
 * Articles: CRUD with status workflow draft → in_review → published (→ archived).
 * Gaps: GET list, POST detect (admin), POST :id/approve → draft article.
 * Search: full-text over published articles.
 *
 * Creating/editing requires agent+; publishing requires admin.
 */
import { Router } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
  requireAdmin,
} from "../middlewares/auth.js";
import { pool } from "@workspace/db";
import { detectGaps, approveGap } from "../lib/knowledge-gaps.js";

const router = Router();
router.use("/knowledge", authMiddleware);

const VALID_STATUSES = ["draft", "in_review", "published", "archived"] as const;

function canEdit(role: string): boolean {
  return ["super_admin", "admin", "manager", "agent"].includes(role);
}

/* ---------- Search (published, searchable) ---------- */
router.get("/knowledge/search", async (req: AuthenticatedRequest, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q || q.length > 200) {
      res.status(400).json({ error: "Provide a search query (1–200 chars)" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, title, category, tags, view_count, helpful_count,
              ts_headline('english', content, plainto_tsquery('english', $1),
                          'MaxFragments=2,MaxWords=30') AS snippet
       FROM knowledge_articles
       WHERE status = 'published' AND searchable = true AND deleted_at IS NULL
         AND to_tsvector('english', title || ' ' || content)
             @@ plainto_tsquery('english', $1)
       ORDER BY ts_rank(to_tsvector('english', title || ' ' || content),
                        plainto_tsquery('english', $1)) DESC
       LIMIT 30`,
      [q],
    );
    res.json({ results: rows });
  } catch (err) {
    console.error("[knowledge] search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/* ---------- Article list ---------- */
router.get("/knowledge/articles", async (req: AuthenticatedRequest, res) => {
  try {
    const status = String(req.query.status ?? "");
    const isAdmin = ["super_admin", "admin"].includes(req.user!.role);
    let where = "deleted_at IS NULL";
    const params: unknown[] = [];
    if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    } else if (!isAdmin) {
      where += " AND status = 'published' AND searchable = true";
    }
    const { rows } = await pool.query(
      `SELECT id, title, category, tags, status, version, view_count,
              helpful_count, searchable, published_at, created_at, updated_at
       FROM knowledge_articles
       WHERE ${where}
       ORDER BY updated_at DESC
       LIMIT 100`,
      params,
    );
    res.json({ articles: rows });
  } catch (err) {
    console.error("[knowledge] list error:", err);
    res.status(500).json({ error: "Failed to list articles" });
  }
});

/* ---------- Get one article ---------- */
router.get(
  "/knowledge/articles/:id",
  async (req: AuthenticatedRequest, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM knowledge_articles WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [req.params.id],
      );
      const a = rows[0];
      if (!a) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      const isAdmin = ["super_admin", "admin"].includes(req.user!.role);
      if (a.status !== "published" && !isAdmin && !canEdit(req.user!.role)) {
        res.status(403).json({ error: "Not authorized to view this draft" });
        return;
      }
      // Count a view on published articles.
      if (a.status === "published") {
        void pool.query(
          `UPDATE knowledge_articles SET view_count = view_count + 1 WHERE id = $1`,
          [a.id],
        );
      }
      res.json({ article: a });
    } catch (err) {
      console.error("[knowledge] get error:", err);
      res.status(500).json({ error: "Failed to fetch article" });
    }
  },
);

/* ---------- Create article (draft) ---------- */
router.post("/knowledge/articles", async (req: AuthenticatedRequest, res) => {
  try {
    if (!canEdit(req.user!.role)) {
      res.status(403).json({ error: "Agent role or above required" });
      return;
    }
    const { title, content, category, tags } = req.body ?? {};
    if (typeof title !== "string" || !title.trim() || title.length > 200) {
      res.status(400).json({ error: "Title is required (1–200 chars)" });
      return;
    }
    if (typeof content !== "string" || !content.trim() || content.length > 100000) {
      res.status(400).json({ error: "Content is required (max 100k chars)" });
      return;
    }
    const cleanTags = Array.isArray(tags)
      ? tags.filter((t) => typeof t === "string").slice(0, 20)
      : [];
    const { rows } = await pool.query(
      `INSERT INTO knowledge_articles
         (title, content, category, tags, status, created_by_id)
       VALUES ($1,$2,$3,$4::text[],'draft',$5)
       RETURNING id, title, status`,
      [
        title.trim(),
        content,
        typeof category === "string" ? category.slice(0, 100) : null,
        cleanTags,
        req.user!.id,
      ],
    );
    res.status(201).json({ article: rows[0] });
  } catch (err) {
    console.error("[knowledge] create error:", err);
    res.status(500).json({ error: "Failed to create article" });
  }
});

/* ---------- Update article (bump version on content change) ---------- */
router.patch(
  "/knowledge/articles/:id",
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!canEdit(req.user!.role)) {
        res.status(403).json({ error: "Agent role or above required" });
        return;
      }
      const { title, content, category, tags, searchable } = req.body ?? {};
      const sets: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      if (typeof title === "string" && title.trim() && title.length <= 200) {
        params.push(title.trim());
        sets.push(`title = $${params.length}`);
      }
      if (typeof content === "string" && content.trim() && content.length <= 100000) {
        params.push(content);
        sets.push(`content = $${params.length}`, `version = version + 1`);
      }
      if (typeof category === "string") {
        params.push(category.slice(0, 100) || null);
        sets.push(`category = $${params.length}`);
      }
      if (Array.isArray(tags)) {
        params.push(tags.filter((t) => typeof t === "string").slice(0, 20));
        sets.push(`tags = $${params.length}::text[]`);
      }
      if (typeof searchable === "boolean") {
        const isAdmin = ["super_admin", "admin"].includes(req.user!.role);
        if (!isAdmin) {
          res.status(403).json({ error: "Only admins can change the searchable flag" });
          return;
        }
        params.push(searchable);
        sets.push(`searchable = $${params.length}`);
      }
      if (sets.length === 1) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }
      params.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE knowledge_articles SET ${sets.join(", ")}
         WHERE id = $${params.length} AND deleted_at IS NULL
         RETURNING id, title, status, version`,
        params,
      );
      if (!rows.length) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      res.json({ article: rows[0] });
    } catch (err) {
      console.error("[knowledge] update error:", err);
      res.status(500).json({ error: "Failed to update article" });
    }
  },
);

/* ---------- Status transition ---------- */
router.post(
  "/knowledge/articles/:id/status",
  async (req: AuthenticatedRequest, res) => {
    try {
      const { status } = req.body ?? {};
      if (!(VALID_STATUSES as readonly string[]).includes(status)) {
        res.status(400).json({ error: "Invalid status" });
        return;
      }
      const { rows: cur } = await pool.query(
        `SELECT status FROM knowledge_articles WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [req.params.id],
      );
      if (!cur.length) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      const from = cur[0].status as string;
      const isAdmin = ["super_admin", "admin"].includes(req.user!.role);
      // Publishing / archiving requires admin; draft↔in_review allowed for editors.
      const allowed =
        (from === "draft" && status === "in_review" && canEdit(req.user!.role)) ||
        (from === "in_review" && status === "draft" && canEdit(req.user!.role)) ||
        (from === "in_review" && status === "published" && isAdmin) ||
        (from === "published" && status === "archived" && isAdmin) ||
        (from === "archived" && status === "draft" && isAdmin);
      if (!allowed) {
        res.status(403).json({
          error: `Transition ${from} → ${status} not allowed for your role`,
        });
        return;
      }
      const { rows } = await pool.query(
        `UPDATE knowledge_articles
         SET status = $1, updated_at = now(),
             published_at = CASE WHEN $1 = 'published' THEN now() ELSE published_at END
         WHERE id = $2 RETURNING id, title, status`,
        [status, req.params.id],
      );
      await pool.query(
        `INSERT INTO ai_audit_logs (actor_id, actor_type, action, entity_type, entity_id, detail)
         VALUES ($1, 'human', 'knowledge.status', 'knowledge_article', $2, $3::jsonb)`,
        [req.user!.id, req.params.id, JSON.stringify({ from, to: status })],
      );
      res.json({ article: rows[0] });
    } catch (err) {
      console.error("[knowledge] status error:", err);
      res.status(500).json({ error: "Failed to change status" });
    }
  },
);

/* ---------- Gaps ---------- */
router.get("/knowledge/gaps", async (req: AuthenticatedRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, a.title AS article_title
       FROM knowledge_gaps g
       LEFT JOIN knowledge_articles a ON a.id = g.article_id
       ORDER BY g.status = 'proposed' DESC, g.occurrence_count DESC, g.created_at DESC
       LIMIT 100`,
    );
    res.json({ gaps: rows });
  } catch (err) {
    console.error("[knowledge] gaps error:", err);
    res.status(500).json({ error: "Failed to list gaps" });
  }
});

router.post(
  "/knowledge/gaps/detect",
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await detectGaps(req.user!.id);
      res.json(result);
    } catch (err) {
      console.error("[knowledge] detect error:", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Detection failed",
      });
    }
  },
);

router.post(
  "/knowledge/gaps/:id/approve",
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await approveGap(Number(req.params.id), req.user!.id);
      res.json({
        ...result,
        message: "Draft article created. Review and publish it when ready.",
      });
    } catch (err) {
      console.error("[knowledge] approve error:", err);
      const msg = err instanceof Error ? err.message : "Approve failed";
      const status = /not found/i.test(msg)
        ? 404
        : /already/i.test(msg)
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    }
  },
);

router.post(
  "/knowledge/gaps/:id/reject",
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pool.query(
        `UPDATE knowledge_gaps SET status = 'rejected' WHERE id = $1`,
        [req.params.id],
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[knowledge] reject error:", err);
      res.status(500).json({ error: "Failed to reject gap" });
    }
  },
);

export default router;
