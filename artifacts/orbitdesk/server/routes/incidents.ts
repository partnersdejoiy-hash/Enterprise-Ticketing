/**
 * Incident routes — Major Incident management (#22, #23).
 *
 *  - CRUD for incidents (manager+ to create/manage)
 *  - POST /:id/auto-command  → #22 prepareMajorIncident checklist
 *  - POST /:id/postmortem/generate → #23 draft (resolved incidents only)
 *  - GET  /:id/postmortem           → latest draft
 *  - POST /:id/postmortem/approve   → human publishes (never auto)
 */

import { Router } from "express";
import { randomBytes } from "crypto";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import { emitEvent, EventTypes } from "../lib/orbit-events.js";
import { prepareMajorIncident } from "../lib/auto-command.js";
import {
  generatePostmortemDraft,
  getPostmortemDraft,
  approvePostmortem,
} from "../lib/postmortem.js";

const router = Router();
router.use(authMiddleware);

const MANAGER_ROLES = ["super_admin", "admin", "manager"];

function generateIncidentNumber(): string {
  return `INC-${randomBytes(4).toString("hex").toUpperCase()}`;
}

// ─── List ─────────────────────────────────────────────────────────────

router.get("/incidents", async (req: AuthenticatedRequest, res) => {
  try {
    const { status, is_major } = req.query as Record<string, string | undefined>;
    const conds = ["i.deleted_at IS NULL"];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conds.push(`i.status = $${params.length}`);
    }
    if (is_major === "true") conds.push("i.is_major");
    const { rows } = await pool.query(
      `SELECT i.id, i.incident_number AS "incidentNumber", i.title,
              i.severity, i.status, i.is_major AS "isMajor",
              i.started_at AS "startedAt", i.resolved_at AS "resolvedAt",
              i.postmortem_status AS "postmortemStatus",
              i.created_at AS "createdAt",
              u.name AS "commanderName",
              (SELECT COUNT(*)::int FROM swarm_rooms sr WHERE sr.incident_id = i.id AND sr.status = 'active') AS "activeRooms"
       FROM incidents i
       LEFT JOIN users u ON u.id = i.commander_id
       WHERE ${conds.join(" AND ")}
       ORDER BY i.created_at DESC LIMIT 200`,
      params,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to list incidents" });
  }
});

// ─── Detail ───────────────────────────────────────────────────────────

router.get("/incidents/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.incident_number AS "incidentNumber", i.title, i.description,
              i.severity, i.status, i.is_major AS "isMajor",
              i.commander_id AS "commanderId",
              i.started_at AS "startedAt", i.mitigated_at AS "mitigatedAt",
              i.resolved_at AS "resolvedAt",
              i.postmortem_status AS "postmortemStatus",
              i.created_at AS "createdAt",
              u.name AS "commanderName"
       FROM incidents i
       LEFT JOIN users u ON u.id = i.commander_id
       WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [req.params.id],
    );
    const incident = rows[0];
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    const { rows: tickets } = await pool.query(
      `SELECT t.id, t.ticket_number AS "ticketNumber", t.subject, t.status
       FROM incident_tickets it JOIN tickets t ON t.id = it.ticket_id
       WHERE it.incident_id = $1 ORDER BY it.linked_at ASC`,
      [req.params.id],
    );
    const { rows: rooms } = await pool.query(
      `SELECT id, name, status, commander_id AS "commanderId",
              ai_summary_at AS "aiSummaryAt", created_at AS "createdAt"
       FROM swarm_rooms WHERE incident_id = $1 ORDER BY created_at DESC`,
      [req.params.id],
    );
    res.json({ ...incident, tickets, rooms });
  } catch (err) {
    res.status(500).json({ error: "Failed to load incident" });
  }
});

// ─── Create ───────────────────────────────────────────────────────────

router.post("/incidents", async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user || !MANAGER_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: "Manager role or above required" });
      return;
    }
    const { title, description, severity, is_major, department_id } = req.body ?? {};
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    const sev = ["critical", "high", "medium", "low"].includes(severity) ? severity : "medium";
    const { rows } = await pool.query(
      `INSERT INTO incidents
         (incident_number, title, description, severity, is_major,
          department_id, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, incident_number AS "incidentNumber"`,
      [
        generateIncidentNumber(),
        title.trim(),
        description ?? null,
        sev,
        is_major === true,
        typeof department_id === "number" ? department_id : null,
        req.user.id,
      ],
    );
    const id = rows[0].id as number;
    await emitEvent({
      type: EventTypes.INCIDENT_CREATED,
      entityType: "incident",
      entityId: String(id),
      actorId: req.user.id,
      payload: { incidentNumber: rows[0].incidentNumber, severity: sev, isMajor: is_major === true },
    });

    // #22: major incidents get auto-command immediately.
    let autoCommand = null;
    if (is_major === true) {
      try {
        autoCommand = await prepareMajorIncident(id, req.user.id);
      } catch (err) {
        console.error("[incidents] auto-command failed:", err);
      }
    }
    res.status(201).json({ id, incidentNumber: rows[0].incidentNumber, autoCommand });
  } catch (err) {
    res.status(500).json({ error: "Failed to create incident" });
  }
});

// ─── Update ───────────────────────────────────────────────────────────

router.patch("/incidents/:id", async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user || !MANAGER_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: "Manager role or above required" });
      return;
    }
    const { title, description, severity, status, commander_id, is_major } = req.body ?? {};
    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [];
    const push = (sql: string, val: unknown) => {
      params.push(val);
      sets.push(`${sql} = $${params.length}`);
    };
    if (title !== undefined) push("title", String(title).trim());
    if (description !== undefined) push("description", description);
    if (severity !== undefined && ["critical", "high", "medium", "low"].includes(severity))
      push("severity", severity);
    if (commander_id !== undefined) push("commander_id", commander_id);
    if (is_major !== undefined) push("is_major", !!is_major);
    if (status !== undefined && ["open", "investigating", "mitigated", "resolved", "closed"].includes(status)) {
      push("status", status);
      if (status === "mitigated") push("mitigated_at", new Date().toISOString());
      if (status === "resolved" || status === "closed") push("resolved_at", new Date().toISOString());
    }
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE incidents SET ${sets.join(", ")}
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING id, status`,
      params,
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    const eventType =
      rows[0].status === "resolved" || rows[0].status === "closed"
        ? EventTypes.INCIDENT_RESOLVED
        : EventTypes.INCIDENT_UPDATED;
    await emitEvent({
      type: eventType,
      entityType: "incident",
      entityId: String(rows[0].id),
      actorId: req.user.id,
      payload: { status: rows[0].status },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update incident" });
  }
});

// ─── #22 Auto-command ─────────────────────────────────────────────────

router.post("/incidents/:id/auto-command", async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user || !MANAGER_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: "Manager role or above required" });
      return;
    }
    const checklist = await prepareMajorIncident(Number(req.params.id), req.user.id);
    res.json(checklist);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Auto-command failed";
    res.status(msg === "Incident not found" ? 404 : 500).json({ error: msg });
  }
});

// ─── #23 Postmortem ───────────────────────────────────────────────────

router.post("/incidents/:id/postmortem/generate", async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user || !MANAGER_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: "Manager role or above required" });
      return;
    }
    const { analysisId, confidence } = await generatePostmortemDraft(
      Number(req.params.id),
      req.user.id,
    );
    res.status(201).json({ analysisId, confidence, status: "draft" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Postmortem generation failed";
    const code = msg === "Incident not found" ? 404 : 400;
    res.status(code).json({ error: msg });
  }
});

router.get("/incidents/:id/postmortem", async (req: AuthenticatedRequest, res) => {
  try {
    const draft = await getPostmortemDraft(Number(req.params.id));
    if (!draft) {
      res.status(404).json({ error: "No postmortem draft" });
      return;
    }
    res.json(draft);
  } catch (err) {
    res.status(500).json({ error: "Failed to load postmortem" });
  }
});

router.post("/incidents/:id/postmortem/approve", async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user || !MANAGER_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: "Manager role or above required" });
      return;
    }
    await approvePostmortem(
      Number(req.params.id),
      req.user.id,
      req.body?.sections ?? undefined,
    );
    res.json({ ok: true, status: "approved" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Approval failed";
    res.status(400).json({ error: msg });
  }
});

export default router;
