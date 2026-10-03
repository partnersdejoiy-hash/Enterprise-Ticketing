/**
 * Predictive Operations API (#4) — risk predictions.
 *
 * GET    /risks            — list risk predictions (staff only)
 * POST   /risks/analyze    — run spike analysis (staff only)
 * POST   /risks/:id/acknowledge
 * POST   /risks/:id/dismiss
 * POST   /risks/:id/create-problem — create a problem from a risk
 */

import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";
import { pool } from "@workspace/db";
import { emitEvent, EventTypes } from "../lib/orbit-events.js";
import { analyzeOperationalRisks } from "../lib/predictive-ops.js";
import { generateProblemNumber } from "../lib/root-cause.js";

const router = Router();
router.use("/risks", authMiddleware);

const STAFF_ROLES = ["super_admin", "admin", "manager", "agent"];
const RISK_STATUSES = ["open", "acknowledged", "resolved", "dismissed"] as const;

function requireStaff(req: AuthenticatedRequest): boolean {
  return !!req.user && STAFF_ROLES.includes(req.user.role);
}

/** GET /risks?status=open — list risk predictions, newest first. */
router.get("/risks", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const status = String(req.query.status ?? "open");
    if (!(RISK_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, tenant_id, risk_type, ref_type, ref_id, risk_level, title,
              evidence, suggested_actions, status, created_at
       FROM risk_predictions
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [status],
    );
    res.json({ ok: true, risks: rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to list risks" });
  }
});

/** POST /risks/analyze — run deterministic spike analysis. */
router.post("/risks/analyze", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const risks = await analyzeOperationalRisks(req.user!.id);
    res.json({ ok: true, created: risks.length, risks });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Analysis failed" });
  }
});

async function setRiskStatus(id: number, status: string) {
  const { rows } = await pool.query(
    `UPDATE risk_predictions SET status = $2
     WHERE id = $1 AND status = 'open'
     RETURNING id, status`,
    [id, status],
  );
  return rows[0] as { id: number; status: string } | undefined;
}

/** POST /risks/:id/acknowledge — staff acknowledges a risk. */
router.post("/risks/:id/acknowledge", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid risk id" });
      return;
    }
    const updated = await setRiskStatus(id, "acknowledged");
    if (!updated) {
      res.status(404).json({ error: "Risk not found or not open" });
      return;
    }
    res.json({ ok: true, ...updated });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to acknowledge risk" });
  }
});

/** POST /risks/:id/dismiss — staff dismisses a risk. */
router.post("/risks/:id/dismiss", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid risk id" });
      return;
    }
    const updated = await setRiskStatus(id, "dismissed");
    if (!updated) {
      res.status(404).json({ error: "Risk not found or not open" });
      return;
    }
    res.json({ ok: true, ...updated });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to dismiss risk" });
  }
});

/** POST /risks/:id/create-problem — create a problem from a risk, acknowledge the risk. */
router.post("/risks/:id/create-problem", async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireStaff(req)) {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid risk id" });
      return;
    }
    const { rows: riskRows } = await pool.query(
      `SELECT id, tenant_id, risk_type, ref_type, ref_id, risk_level, title, evidence
       FROM risk_predictions WHERE id = $1`,
      [id],
    );
    const risk = riskRows[0];
    if (!risk) {
      res.status(404).json({ error: "Risk not found" });
      return;
    }
    let problemId: number | null = null;
    let problemNumber: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO problems
             (tenant_id, problem_number, title, description, status, created_by_id)
           VALUES ($1, $2, $3, $4, 'open', $5)
           RETURNING id, problem_number`,
          [
            risk.tenant_id,
            generateProblemNumber(),
            `Investigate: ${risk.title}`,
            `Created from risk prediction #${risk.id} (${risk.risk_type}/${risk.ref_type}/${risk.ref_id}, level ${risk.risk_level}).\nEvidence: ${JSON.stringify(risk.evidence)}`,
            req.user!.id,
          ],
        );
        problemId = rows[0].id;
        problemNumber = rows[0].problem_number;
        break;
      } catch (err) {
        if ((err as { code?: string }).code !== "23505" || attempt === 4) throw err;
      }
    }
    await pool.query(
      "UPDATE risk_predictions SET status = 'acknowledged' WHERE id = $1",
      [id],
    );
    await emitEvent({
      type: EventTypes.PROBLEM_CREATED,
      entityType: "problem",
      entityId: String(problemId),
      actorId: req.user!.id,
      actorType: "user",
      tenantId: (risk.tenant_id as number | null) ?? null,
      payload: { from_risk_id: id, problem_number: problemNumber },
    });
    res.json({ ok: true, problem_id: problemId, problem_number: problemNumber });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to create problem" });
  }
});

export default router;
