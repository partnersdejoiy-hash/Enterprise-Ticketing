/**
 * Change Management API (Superpower #17 — AI Impact Analysis).
 *
 *   GET    /api/changes            list (visibility-filtered)
 *   POST   /api/changes            create a change (staff)
 *   GET    /api/changes/:id        detail + linked CIs + impact + approvals
 *   PATCH  /api/changes/:id        update draft fields (creator / privileged)
 *   POST   /api/changes/:id/cis    link configuration items {ci_ids: number[]}
 *   POST   /api/changes/:id/analyze  run AI impact analysis (advisory only)
 *   POST   /api/changes/:id/approve approve via approvals table (manager+)
 *   POST   /api/changes/:id/reject  reject via approvals table (manager+)
 *
 * Impact analysis never approves or executes anything — approval is a
 * separate human decision recorded in the approvals table.
 */

import { Router } from "express";
import { randomBytes } from "crypto";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import {
  analyzeChangeImpact,
  canViewChange,
  canDecideChange,
} from "../lib/impact-analysis.js";
import { emitEvent, EventTypes } from "../lib/orbit-events.js";
import type { Response } from "express";

const router = Router();
router.use("/changes", authMiddleware);

function generateChangeNumber(): string {
  return `CHG-${randomBytes(4).toString("hex").toUpperCase()}`;
}

const STAFF = ["super_admin", "admin", "manager", "agent"];

router.get("/changes", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = String(req.query.status ?? "");
    const { rows } = await pool.query(
      `SELECT id, change_number, title, change_type, risk, status,
              scheduled_start, scheduled_end, created_by_id, created_at, updated_at
       FROM changes
       WHERE deleted_at IS NULL ${status ? "AND status = $1" : ""}
       ORDER BY created_at DESC LIMIT 200`,
      status ? [status] : [],
    );
    const user = { id: req.user!.id, role: req.user!.role, departmentId: req.user!.departmentId ?? null };
    res.json(
      rows.filter((c) => canViewChange(user, c)),
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to list changes" });
  }
});

router.post("/changes", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!STAFF.includes(req.user!.role)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const { title, description, change_type, risk, scheduled_start, scheduled_end, rollback_plan } = req.body ?? {};
    if (!title || typeof title !== "string" || title.trim().length < 3) {
      res.status(400).json({ error: "Title is required (min 3 chars)" });
      return;
    }
    const validTypes = ["standard", "normal", "emergency"];
    const validRisks = ["low", "medium", "high"];
    const { rows } = await pool.query(
      `INSERT INTO changes
         (change_number, title, description, change_type, risk,
          scheduled_start, scheduled_end, rollback_plan, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        generateChangeNumber(),
        title.trim(),
        description ?? null,
        validTypes.includes(change_type) ? change_type : "standard",
        validRisks.includes(risk) ? risk : "medium",
        scheduled_start ?? null,
        scheduled_end ?? null,
        rollback_plan ?? null,
        req.user!.id,
      ],
    );
    const change = rows[0];
    await emitEvent({
      type: EventTypes.CHANGE_CREATED,
      entityType: "change",
      entityId: String(change.id),
      actorId: req.user!.id,
      payload: { change_number: change.change_number, title: change.title },
    });
    res.status(201).json(change);
  } catch (err) {
    res.status(500).json({ error: "Failed to create change" });
  }
});

router.get("/changes/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid change id" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT * FROM changes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const change = rows[0];
    if (!change) {
      res.status(404).json({ error: "Change not found" });
      return;
    }
    const user = { id: req.user!.id, role: req.user!.role, departmentId: req.user!.departmentId ?? null };
    if (!canViewChange(user, change)) {
      res.status(404).json({ error: "Change not found" });
      return;
    }
    const [cis, approvals] = await Promise.all([
      pool.query(
        `SELECT ci.id, ci.name, ci.ci_type, ci.health
         FROM change_cis cc JOIN configuration_items ci ON ci.id = cc.ci_id
         WHERE cc.change_id = $1 AND ci.deleted_at IS NULL ORDER BY ci.name`,
        [id],
      ),
      pool.query(
        `SELECT a.*, u.name AS approver_name FROM approvals a
         LEFT JOIN users u ON u.id = a.approver_id
         WHERE a.entity_type = 'change' AND a.entity_id = $1
         ORDER BY a.step_order, a.created_at`,
        [String(id)],
      ),
    ]);
    res.json({ ...change, cis: cis.rows, approvals: approvals.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to load change" });
  }
});

router.patch("/changes/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid change id" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT * FROM changes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const change = rows[0];
    if (!change) {
      res.status(404).json({ error: "Change not found" });
      return;
    }
    const privileged = ["super_admin", "admin", "manager"].includes(req.user!.role);
    if (change.created_by_id !== req.user!.id && !privileged) {
      res.status(403).json({ error: "Only the creator or a manager can edit" });
      return;
    }
    if (!["draft", "pending_approval"].includes(change.status)) {
      res.status(400).json({ error: "Only draft/pending changes can be edited" });
      return;
    }
    const allowedFields = [
      "title", "description", "change_type", "risk",
      "scheduled_start", "scheduled_end", "rollback_plan",
    ];
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const f of allowedFields) {
      if (req.body?.[f] !== undefined) {
        vals.push(req.body[f]);
        sets.push(`${f} = $${vals.length}`);
      }
    }
    if (sets.length === 0) {
      res.status(400).json({ error: "No editable fields provided" });
      return;
    }
    vals.push(id);
    const { rows: updated } = await pool.query(
      `UPDATE changes SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to update change" });
  }
});

/** Link configuration items to a change. */
router.post("/changes/:id/cis", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const ciIds: unknown = req.body?.ci_ids;
    if (!Number.isSafeInteger(id) || id < 1 || !Array.isArray(ciIds)) {
      res.status(400).json({ error: "Invalid change id or ci_ids" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, status, created_by_id FROM changes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const change = rows[0];
    if (!change) {
      res.status(404).json({ error: "Change not found" });
      return;
    }
    const privileged = ["super_admin", "admin", "manager"].includes(req.user!.role);
    if (change.created_by_id !== req.user!.id && !privileged) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const cleanIds = [...new Set(ciIds)].filter(
      (c): c is number => Number.isSafeInteger(c) && (c as number) > 0,
    ).slice(0, 100);
    for (const ciId of cleanIds) {
      await pool.query(
        `INSERT INTO change_cis (change_id, ci_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, ciId],
      );
    }
    res.json({ linked: cleanIds.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to link CIs" });
  }
});

/** Run AI impact analysis — advisory only, never approves. */
router.post("/changes/:id/analyze", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid change id" });
      return;
    }
    const impact = await analyzeChangeImpact(id, req.user!.id);
    res.json(impact);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analysis failed";
    const status = /not authorized|not found/i.test(msg) ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

async function decide(
  req: AuthenticatedRequest,
  res: Response,
  decision: "approved" | "rejected",
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid change id" });
      return;
    }
    const user = { id: req.user!.id, role: req.user!.role, departmentId: req.user!.departmentId ?? null };
    if (!canDecideChange(user)) {
      res.status(403).json({ error: "Manager approval required" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT * FROM changes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    const change = rows[0];
    if (!change) {
      res.status(404).json({ error: "Change not found" });
      return;
    }
    if (!["draft", "pending_approval"].includes(change.status)) {
      res.status(400).json({ error: `Change is already ${change.status}` });
      return;
    }
    const comment = typeof req.body?.comment === "string" ? req.body.comment.slice(0, 2000) : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO approvals
           (entity_type, entity_id, step_order, approver_id, approver_role, status, decided_at, comment)
         VALUES ('change', $1, 1, $2, $3, $4, now(), $5)`,
        [String(id), req.user!.id, req.user!.role, decision, comment],
      );
      const newStatus = decision === "approved" ? "approved" : "cancelled";
      const { rows: updated } = await client.query(
        `UPDATE changes SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
        [newStatus, id],
      );
      await client.query("COMMIT");
      await emitEvent({
        type: decision === "approved" ? EventTypes.CHANGE_APPROVED : "change.rejected",
        entityType: "change",
        entityId: String(id),
        actorId: req.user!.id,
        payload: { change_number: change.change_number, decision, comment },
      });
      res.json(updated[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to record decision" });
  }
}

router.post("/changes/:id/approve", (req: AuthenticatedRequest, res: Response) =>
  decide(req, res, "approved"));
router.post("/changes/:id/reject", (req: AuthenticatedRequest, res: Response) =>
  decide(req, res, "rejected"));

export default router;
