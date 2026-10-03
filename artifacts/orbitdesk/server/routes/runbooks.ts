/**
 * Runbook routes — Self-Healing (#13).
 *
 * CRUD for runbooks (admin only) + execution with mandatory approval gating.
 * The allowlist (clear_cache, restart_service, scale_up, notify) is enforced
 * server-side on BOTH create and execute. Destructive (high/critical risk)
 * steps ALWAYS require human approval — enforced in runbook-policy.ts, not
 * just in the UI.
 *
 * v1 executes steps in "simulated" mode: each step is logged with actor +
 * timestamp + result, and a real verification query runs where possible.
 * No arbitrary commands are ever executed.
 */

import { Router } from "express";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  requireAdmin,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import {
  validateSteps,
  approvalRequired,
  highestRisk,
  type RunbookStep,
} from "../lib/runbook-policy.js";
import { emitEvent, EventTypes } from "../lib/orbit-events.js";

const router = Router();
router.use(authMiddleware);

const MANAGER_ROLES = ["super_admin", "admin", "manager"];

function canOperate(user: { role: string } | undefined): boolean {
  return !!user && MANAGER_ROLES.includes(user.role);
}

// ─── Runbook CRUD ─────────────────────────────────────────────────────

router.get("/runbooks", async (req: AuthenticatedRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, trigger_condition AS "triggerCondition",
              steps, max_risk AS "maxRisk", requires_approval AS "requiresApproval",
              is_active AS "isActive", created_by_id AS "createdById",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM runbooks ORDER BY updated_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to list runbooks" });
  }
});

router.get("/runbooks/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, trigger_condition AS "triggerCondition",
              steps, max_risk AS "maxRisk", requires_approval AS "requiresApproval",
              is_active AS "isActive", created_by_id AS "createdById",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM runbooks WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Runbook not found" });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to load runbook" });
  }
});

router.post("/runbooks", requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { name, description, trigger_condition, steps, max_risk, requires_approval, is_active } =
      req.body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    // Allowlist validation — server side, always.
    const v = validateSteps(steps ?? []);
    if (!v.valid) {
      res.status(400).json({ error: "Invalid steps", details: v.errors });
      return;
    }
    const computedMax = highestRisk(v.normalized);
    const { rows } = await pool.query(
      `INSERT INTO runbooks
         (name, description, trigger_condition, steps, max_risk,
          requires_approval, is_active, created_by_id)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8) RETURNING id`,
      [
        name.trim(),
        description ?? null,
        JSON.stringify(trigger_condition ?? {}),
        JSON.stringify(v.normalized),
        max_risk ?? computedMax,
        requires_approval ?? true,
        // Explicit opt-in only: new runbooks default to inactive.
        is_active === true,
        req.user!.id,
      ],
    );
    await emitEvent({
      type: "runbook.created",
      entityType: "runbook",
      entityId: String(rows[0].id),
      actorId: req.user!.id,
      payload: { name: name.trim() },
    });
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create runbook" });
  }
});

router.patch("/runbooks/:id", requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { name, description, trigger_condition, steps, max_risk, requires_approval, is_active } =
      req.body ?? {};
    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [];
    const push = (sql: string, val: unknown) => {
      params.push(val);
      sets.push(`${sql} = $${params.length}`);
    };
    if (name !== undefined) push("name", String(name).trim());
    if (description !== undefined) push("description", description);
    if (trigger_condition !== undefined)
      push("trigger_condition", JSON.stringify(trigger_condition));
    if (steps !== undefined) {
      const v = validateSteps(steps);
      if (!v.valid) {
        res.status(400).json({ error: "Invalid steps", details: v.errors });
        return;
      }
      push("steps", JSON.stringify(v.normalized));
      if (max_risk === undefined) push("max_risk", highestRisk(v.normalized));
    }
    if (max_risk !== undefined) push("max_risk", max_risk);
    if (requires_approval !== undefined) push("requires_approval", !!requires_approval);
    if (is_active !== undefined) push("is_active", !!is_active);
    params.push(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE runbooks SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params,
    );
    if (!rowCount) {
      res.status(404).json({ error: "Runbook not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update runbook" });
  }
});

router.delete("/runbooks/:id", requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM runbooks WHERE id = $1",
      [req.params.id],
    );
    if (!rowCount) {
      res.status(404).json({ error: "Runbook not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    // ON DELETE RESTRICT on executions prevents deleting runbooks with history.
    res.status(400).json({ error: "Cannot delete: runbook has execution history" });
  }
});

// ─── Execution ────────────────────────────────────────────────────────

/** Simulate a single allowlisted step. Returns the step log entry. */
async function simulateStep(
  step: RunbookStep,
  incidentId: number | null,
): Promise<{ action: string; result: string; at: string }> {
  const at = new Date().toISOString();
  // Real verification query where possible: for notify, we can at least
  // confirm the incident still exists. Everything else is simulated in v1.
  let result = "simulated";
  if (step.action === "notify" && incidentId) {
    const { rows } = await pool.query(
      "SELECT id FROM incidents WHERE id = $1",
      [incidentId],
    );
    result = rows[0]
      ? "simulated — stakeholder notification prepared"
      : "simulated — incident no longer exists, skipped";
  } else if (step.action === "clear_cache") {
    result = "simulated — cache-clear request validated (no-op in v1)";
  } else if (step.action === "restart_service") {
    result = "simulated — restart request validated (no-op in v1)";
  } else if (step.action === "scale_up") {
    result = "simulated — scale-up request validated (no-op in v1)";
  }
  return { action: step.action, result, at };
}

router.post("/runbooks/:id/execute", async (req: AuthenticatedRequest, res) => {
  try {
    if (!canOperate(req.user)) {
      res.status(403).json({ error: "Manager role or above required" });
      return;
    }
    const { rows } = await pool.query("SELECT * FROM runbooks WHERE id = $1", [
      req.params.id,
    ]);
    const runbook = rows[0];
    if (!runbook) {
      res.status(404).json({ error: "Runbook not found" });
      return;
    }
    // Re-validate against the allowlist at execute time (defense in depth).
    const v = validateSteps(runbook.steps);
    if (!v.valid) {
      res.status(400).json({
        error: "Runbook contains non-allowlisted actions and cannot execute",
        details: v.errors,
      });
      return;
    }
    const gate = approvalRequired(v.normalized, runbook.requires_approval);
    const incidentId =
      typeof req.body?.incident_id === "number" ? req.body.incident_id : null;

    const { rows: exRows } = await pool.query(
      `INSERT INTO runbook_executions
         (runbook_id, incident_id, event_id, status, steps_log, executed_by)
       VALUES ($1,$2,$3,$4,'[]'::jsonb,$5) RETURNING id`,
      [
        runbook.id,
        incidentId,
        typeof req.body?.event_id === "number" ? req.body.event_id : null,
        gate.required ? "pending_approval" : "approved",
        `user:${req.user!.id}`,
      ],
    );
    const execId = exRows[0].id as number;

    if (gate.required) {
      // Create the approval request. Approver must be admin/manager.
      const { rows: apRows } = await pool.query(
        `INSERT INTO approvals (entity_type, entity_id, approver_role, status)
         VALUES ('runbook_execution', $1, 'manager', 'pending') RETURNING id`,
        [String(execId)],
      );
      await pool.query(
        "UPDATE runbook_executions SET approval_id = $1 WHERE id = $2",
        [apRows[0].id, execId],
      );
      await emitEvent({
        type: "runbook.approval_requested",
        entityType: "runbook_execution",
        entityId: String(execId),
        actorId: req.user!.id,
        payload: { runbook_id: runbook.id, reason: gate.reason },
      });
      res.status(202).json({
        execution_id: execId,
        status: "pending_approval",
        approval_id: apRows[0].id,
        reason: gate.reason,
      });
      return;
    }

    // Low-risk + approval disabled: execute immediately (simulated in v1).
    await runExecution(execId, v.normalized, incidentId, req.user!.id);
    res.status(202).json({ execution_id: execId, status: "completed" });
  } catch (err) {
    console.error("[runbooks] execute failed:", err);
    res.status(500).json({ error: "Failed to start runbook execution" });
  }
});

async function runExecution(
  execId: number,
  steps: RunbookStep[],
  incidentId: number | null,
  actorId: number,
): Promise<void> {
  await pool.query(
    "UPDATE runbook_executions SET status = 'running' WHERE id = $1",
    [execId],
  );
  const log: { action: string; result: string; at: string; actor: string }[] = [];
  let failed = false;
  for (const step of steps) {
    try {
      const entry = await simulateStep(step, incidentId);
      log.push({ ...entry, actor: `user:${actorId}` });
    } catch (err) {
      failed = true;
      log.push({
        action: step.action,
        result: `failed: ${String(err)}`,
        at: new Date().toISOString(),
        actor: `user:${actorId}`,
      });
      break;
    }
  }
  await pool.query(
    `UPDATE runbook_executions
     SET status = $1, steps_log = $2::jsonb,
         verification = $3::jsonb, completed_at = now()
     WHERE id = $4`,
    [
      failed ? "failed" : "completed",
      JSON.stringify(log),
      JSON.stringify({
        mode: "simulated",
        note: "v1 executes steps in simulated mode; no real infrastructure changes were made.",
      }),
      execId,
    ],
  );
  await emitEvent({
    type: "runbook.executed",
    entityType: "runbook_execution",
    entityId: String(execId),
    actorId,
    actorType: "automation",
    payload: { status: failed ? "failed" : "completed", steps: log.length },
  });
}

router.post(
  "/runbooks/executions/:execId/approve",
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!canOperate(req.user)) {
        res.status(403).json({ error: "Manager role or above required" });
        return;
      }
      const { rows } = await pool.query(
        `SELECT re.*, r.steps AS runbook_steps, r.requires_approval
         FROM runbook_executions re
         JOIN runbooks r ON r.id = re.runbook_id
         WHERE re.id = $1`,
        [req.params.execId],
      );
      const exec = rows[0];
      if (!exec) {
        res.status(404).json({ error: "Execution not found" });
        return;
      }
      if (exec.status !== "pending_approval") {
        res.status(400).json({ error: `Execution is ${exec.status}, not pending approval` });
        return;
      }
      // Re-validate allowlist before approved execution.
      const v = validateSteps(exec.runbook_steps);
      if (!v.valid) {
        await pool.query(
          "UPDATE runbook_executions SET status = 'rejected' WHERE id = $1",
          [exec.id],
        );
        res.status(400).json({
          error: "Runbook contains non-allowlisted actions — execution rejected",
          details: v.errors,
        });
        return;
      }
      if (exec.approval_id) {
        await pool.query(
          `UPDATE approvals SET status = 'approved', approver_id = $1,
           decided_at = now(), comment = $2 WHERE id = $3`,
          [req.user!.id, req.body?.comment ?? null, exec.approval_id],
        );
      }
      await pool.query(
        "UPDATE runbook_executions SET status = 'approved' WHERE id = $1",
        [exec.id],
      );
      await emitEvent({
        type: "runbook.approved",
        entityType: "runbook_execution",
        entityId: String(exec.id),
        actorId: req.user!.id,
        payload: { approved_by: req.user!.id },
      });
      await runExecution(exec.id, v.normalized, exec.incident_id, req.user!.id);
      res.json({ ok: true, status: "completed" });
    } catch (err) {
      console.error("[runbooks] approve failed:", err);
      res.status(500).json({ error: "Failed to approve execution" });
    }
  },
);

router.post(
  "/runbooks/executions/:execId/reject",
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!canOperate(req.user)) {
        res.status(403).json({ error: "Manager role or above required" });
        return;
      }
      const { rows } = await pool.query(
        "SELECT id, status, approval_id FROM runbook_executions WHERE id = $1",
        [req.params.execId],
      );
      const exec = rows[0];
      if (!exec) {
        res.status(404).json({ error: "Execution not found" });
        return;
      }
      if (exec.status !== "pending_approval") {
        res.status(400).json({ error: `Execution is ${exec.status}, not pending approval` });
        return;
      }
      if (exec.approval_id) {
        await pool.query(
          `UPDATE approvals SET status = 'rejected', approver_id = $1,
           decided_at = now(), comment = $2 WHERE id = $3`,
          [req.user!.id, req.body?.comment ?? null, exec.approval_id],
        );
      }
      await pool.query(
        "UPDATE runbook_executions SET status = 'rejected', completed_at = now() WHERE id = $1",
        [exec.id],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to reject execution" });
    }
  },
);

router.get("/runbooks/:id/executions", async (req: AuthenticatedRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT re.id, re.runbook_id AS "runbookId", re.incident_id AS "incidentId",
              re.status, re.steps_log AS "stepsLog", re.verification,
              re.executed_by AS "executedBy", re.created_at AS "createdAt",
              re.completed_at AS "completedAt",
              a.status AS "approvalStatus", a.comment AS "approvalComment",
              u.name AS "approverName"
       FROM runbook_executions re
       LEFT JOIN approvals a ON a.id = re.approval_id
       LEFT JOIN users u ON u.id = a.approver_id
       WHERE re.runbook_id = $1
       ORDER BY re.created_at DESC LIMIT 100`,
      [req.params.id],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load execution history" });
  }
});

router.get("/runbooks/executions/pending", async (req: AuthenticatedRequest, res) => {
  try {
    if (!canOperate(req.user)) {
      res.status(403).json({ error: "Manager role or above required" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT re.id, re.runbook_id AS "runbookId", rb.name AS "runbookName",
              re.incident_id AS "incidentId", re.status,
              re.executed_by AS "executedBy", re.created_at AS "createdAt",
              a.id AS "approvalId"
       FROM runbook_executions re
       JOIN runbooks rb ON rb.id = re.runbook_id
       LEFT JOIN approvals a ON a.id = re.approval_id
       WHERE re.status = 'pending_approval'
       ORDER BY re.created_at ASC`,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load pending approvals" });
  }
});

export default router;
