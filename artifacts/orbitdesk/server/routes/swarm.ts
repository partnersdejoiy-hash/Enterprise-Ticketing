/**
 * Swarm Mode routes (#5) — incident command rooms.
 *
 *  POST   /api/swarm/incidents/:id/start        manager+ : create room + auto-add commander
 *  GET    /api/swarm/rooms/:id                  member/manager : room + members + messages + tasks
 *  POST   /api/swarm/rooms/:id/join|leave
 *  POST   /api/swarm/rooms/:id/messages         member : post chat|note|decision|status_update
 *  GET    /api/swarm/rooms/:id/messages?since=   member : polling for real-time
 *  POST   /api/swarm/rooms/:id/tasks            member : create task
 *  PATCH  /api/swarm/rooms/:id/tasks/:taskId    member : update task
 *  POST   /api/swarm/rooms/:id/ai-summary       member : AI "last 15 min" summary
 *  POST   /api/swarm/rooms/:id/resolve          manager+ : resolve incident + room
 */

import { Router } from "express";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import { emitEvent, EventTypes } from "../lib/orbit-events.js";
import { runAnalysis } from "../lib/orbit-ai.js";
import { isValidSwarmMessageType } from "../lib/runbook-policy.js";

const router = Router();
// Scoped to this router's own paths: a bare router.use(authMiddleware) here
// would gate EVERY /api/* request (this router is mounted at "/"), breaking
// public routes like /api/auth/login.
router.use("/swarm", authMiddleware);

const MANAGER_ROLES = ["super_admin", "admin", "manager"];

function isManager(user: { role: string } | undefined): boolean {
  return !!user && MANAGER_ROLES.includes(user.role);
}

async function getRoom(roomId: number) {
  const { rows } = await pool.query(
    `SELECT sr.id, sr.incident_id AS "incidentId", sr.name, sr.status,
            sr.commander_id AS "commanderId", sr.ai_summary AS "aiSummary",
            sr.ai_summary_at AS "aiSummaryAt",
            sr.resolved_at AS "resolvedAt", sr.created_at AS "createdAt",
            i.incident_number AS "incidentNumber", i.title AS "incidentTitle",
            i.severity, i.status AS "incidentStatus"
     FROM swarm_rooms sr
     JOIN incidents i ON i.id = sr.incident_id
     WHERE sr.id = $1`,
    [roomId],
  );
  return rows[0] ?? null;
}

async function isMember(roomId: number, userId: number): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT 1 FROM swarm_members WHERE room_id = $1 AND user_id = $2",
    [roomId, userId],
  );
  return !!rows[0];
}

/** Room visibility: members + managers/admins. */
async function canViewRoom(
  roomId: number,
  user: { id: number; role: string },
): Promise<boolean> {
  if (isManager(user)) return true;
  return isMember(roomId, user.id);
}

// ─── Start swarm ──────────────────────────────────────────────────────

router.post("/swarm/incidents/:id/start", async (req: AuthenticatedRequest, res) => {
  try {
    if (!isManager(req.user)) {
      res.status(403).json({ error: "Manager role or above required" });
      return;
    }
    const incidentId = Number(req.params.id);
    const { rows: incRows } = await pool.query(
      `SELECT id, incident_number AS "incidentNumber", commander_id AS "commanderId"
       FROM incidents WHERE id = $1 AND deleted_at IS NULL`,
      [incidentId],
    );
    if (!incRows[0]) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    const { rows: existing } = await pool.query(
      "SELECT id FROM swarm_rooms WHERE incident_id = $1 AND status = 'active' LIMIT 1",
      [incidentId],
    );
    if (existing[0]) {
      res.json({ roomId: existing[0].id, existing: true });
      return;
    }
    const commanderId = incRows[0].commanderId as number | null;
    const { rows } = await pool.query(
      `INSERT INTO swarm_rooms (incident_id, name, commander_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [incidentId, `Swarm — ${incRows[0].incidentNumber}`, commanderId],
    );
    const roomId = rows[0].id as number;
    // Auto-add commander + the user who started the swarm.
    const toAdd = new Set<number>([req.user!.id]);
    if (commanderId) toAdd.add(commanderId);
    for (const uid of toAdd) {
      await pool.query(
        `INSERT INTO swarm_members (room_id, user_id, role)
         VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO NOTHING`,
        [roomId, uid, uid === commanderId ? "commander" : "participant"],
      );
    }
    await pool.query(
      `INSERT INTO swarm_messages (room_id, sender_id, sender_type, message_type, content)
       VALUES ($1, $2, 'ai', 'status_update', $3)`,
      [
        roomId,
        req.user!.id,
        `Swarm started for ${incRows[0].incidentNumber}. Incident command room is now active.`,
      ],
    );
    await emitEvent({
      type: "swarm.started",
      entityType: "incident",
      entityId: String(incidentId),
      actorId: req.user!.id,
      payload: { roomId },
    });
    res.status(201).json({ roomId, existing: false });
  } catch (err) {
    res.status(500).json({ error: "Failed to start swarm" });
  }
});

// ─── Room detail ──────────────────────────────────────────────────────

router.get("/swarm/rooms/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const roomId = Number(req.params.id);
    const room = await getRoom(roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (!(await canViewRoom(roomId, req.user!))) {
      res.status(403).json({ error: "Not a room member" });
      return;
    }
    const { rows: members } = await pool.query(
      `SELECT sm.user_id AS "userId", sm.role, sm.joined_at AS "joinedAt",
              u.name, u.email
       FROM swarm_members sm JOIN users u ON u.id = sm.user_id
       WHERE sm.room_id = $1 ORDER BY sm.joined_at ASC`,
      [roomId],
    );
    const { rows: messages } = await pool.query(
      `SELECT sm.id, sm.sender_id AS "senderId", sm.sender_type AS "senderType",
              sm.message_type AS "messageType", sm.content,
              sm.created_at AS "createdAt",
              COALESCE(u.name, CASE WHEN sm.sender_type = 'ai' THEN 'Orbit AI' END) AS author
       FROM swarm_messages sm
       LEFT JOIN users u ON u.id = sm.sender_id
       WHERE sm.room_id = $1 ORDER BY sm.created_at ASC LIMIT 500`,
      [roomId],
    );
    const { rows: tasks } = await pool.query(
      `SELECT st.id, st.title, st.assignee_id AS "assigneeId",
              st.status, st.created_at AS "createdAt",
              st.completed_at AS "completedAt", u.name AS "assigneeName"
       FROM swarm_tasks st
       LEFT JOIN users u ON u.id = st.assignee_id
       WHERE st.room_id = $1 ORDER BY st.created_at ASC`,
      [roomId],
    );
    res.json({ ...room, members, messages, tasks });
  } catch (err) {
    res.status(500).json({ error: "Failed to load room" });
  }
});

// ─── Join / leave ─────────────────────────────────────────────────────

router.post("/swarm/rooms/:id/join", async (req: AuthenticatedRequest, res) => {
  try {
    const roomId = Number(req.params.id);
    const room = await getRoom(roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (room.status !== "active") {
      res.status(400).json({ error: "Room is not active" });
      return;
    }
    await pool.query(
      `INSERT INTO swarm_members (room_id, user_id, role)
       VALUES ($1, $2, 'participant')
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [roomId, req.user!.id],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to join room" });
  }
});

router.post("/swarm/rooms/:id/leave", async (req: AuthenticatedRequest, res) => {
  try {
    const roomId = Number(req.params.id);
    await pool.query(
      "DELETE FROM swarm_members WHERE room_id = $1 AND user_id = $2",
      [roomId, req.user!.id],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to leave room" });
  }
});

// ─── Messages ─────────────────────────────────────────────────────────

router.post("/swarm/rooms/:id/messages", async (req: AuthenticatedRequest, res) => {
  try {
    const roomId = Number(req.params.id);
    const room = await getRoom(roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (room.status !== "active") {
      res.status(400).json({ error: "Room is not active" });
      return;
    }
    if (!(await isMember(roomId, req.user!.id))) {
      res.status(403).json({ error: "Join the room before posting" });
      return;
    }
    const { content, message_type } = req.body ?? {};
    if (!content || typeof content !== "string" || !content.trim()) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    if (content.length > 10000) {
      res.status(400).json({ error: "content too long (max 10000 chars)" });
      return;
    }
    const mtype = message_type ?? "chat";
    if (!isValidSwarmMessageType(mtype)) {
      res.status(400).json({
        error: "Invalid message_type",
        allowed: ["chat", "note", "decision", "status_update"],
      });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO swarm_messages (room_id, sender_id, sender_type, message_type, content)
       VALUES ($1, $2, 'user', $3, $4)
       RETURNING id, created_at AS "createdAt"`,
      [roomId, req.user!.id, mtype, content.trim()],
    );
    await emitEvent({
      type: "swarm.message",
      entityType: "swarm_room",
      entityId: String(roomId),
      actorId: req.user!.id,
      payload: { messageId: rows[0].id, messageType: mtype },
    });
    res.status(201).json({ id: rows[0].id, createdAt: rows[0].createdAt });
  } catch (err) {
    res.status(500).json({ error: "Failed to post message" });
  }
});

/** Polling endpoint for real-time updates (SSE later; polling now). */
router.get("/swarm/rooms/:id/messages", async (req: AuthenticatedRequest, res) => {
  try {
    const roomId = Number(req.params.id);
    if (!(await canViewRoom(roomId, req.user!))) {
      res.status(403).json({ error: "Not a room member" });
      return;
    }
    const since = req.query.since as string | undefined;
    const params: unknown[] = [roomId];
    let sinceClause = "";
    if (since) {
      const d = new Date(since);
      if (isNaN(d.getTime())) {
        res.status(400).json({ error: "Invalid since timestamp" });
        return;
      }
      params.push(d.toISOString());
      sinceClause = "AND sm.created_at > $2";
    }
    const { rows } = await pool.query(
      `SELECT sm.id, sm.sender_id AS "senderId", sm.sender_type AS "senderType",
              sm.message_type AS "messageType", sm.content,
              sm.created_at AS "createdAt",
              COALESCE(u.name, CASE WHEN sm.sender_type = 'ai' THEN 'Orbit AI' END) AS author
       FROM swarm_messages sm
       LEFT JOIN users u ON u.id = sm.sender_id
       WHERE sm.room_id = $1 ${sinceClause}
       ORDER BY sm.created_at ASC LIMIT 200`,
      params,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ─── Tasks ────────────────────────────────────────────────────────────

router.post("/swarm/rooms/:id/tasks", async (req: AuthenticatedRequest, res) => {
  try {
    const roomId = Number(req.params.id);
    const room = await getRoom(roomId);
    if (!room || room.status !== "active") {
      res.status(room ? 400 : 404).json({ error: room ? "Room is not active" : "Room not found" });
      return;
    }
    if (!(await isMember(roomId, req.user!.id))) {
      res.status(403).json({ error: "Not a room member" });
      return;
    }
    const { title, assignee_id } = req.body ?? {};
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO swarm_tasks (room_id, title, assignee_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        roomId,
        title.trim().slice(0, 500),
        typeof assignee_id === "number" ? assignee_id : null,
      ],
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create task" });
  }
});

router.patch("/swarm/rooms/:id/tasks/:taskId", async (req: AuthenticatedRequest, res) => {
  try {
    const roomId = Number(req.params.id);
    if (!(await isMember(roomId, req.user!.id))) {
      res.status(403).json({ error: "Not a room member" });
      return;
    }
    const { status, assignee_id, title } = req.body ?? {};
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (sql: string, val: unknown) => {
      params.push(val);
      sets.push(`${sql} = $${params.length}`);
    };
    if (status !== undefined) {
      if (!["open", "in_progress", "done"].includes(status)) {
        res.status(400).json({ error: "Invalid status" });
        return;
      }
      push("status", status);
      push("completed_at", status === "done" ? new Date().toISOString() : null);
    }
    if (assignee_id !== undefined)
      push("assignee_id", typeof assignee_id === "number" ? assignee_id : null);
    if (title !== undefined) push("title", String(title).trim().slice(0, 500));
    if (sets.length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    params.push(Number(req.params.taskId), roomId);
    const { rowCount } = await pool.query(
      `UPDATE swarm_tasks SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND room_id = $${params.length}`,
      params,
    );
    if (!rowCount) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update task" });
  }
});

// ─── AI summary (#22: "Last 15 minutes") ──────────────────────────────

router.post("/swarm/rooms/:id/ai-summary", async (req: AuthenticatedRequest, res) => {
  try {
    const roomId = Number(req.params.id);
    const room = await getRoom(roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (!(await canViewRoom(roomId, req.user!))) {
      res.status(403).json({ error: "Not a room member" });
      return;
    }
    const windowMinutes =
      typeof req.body?.window_minutes === "number"
        ? Math.min(Math.max(req.body.window_minutes, 5), 240)
        : 15;
    const { rows: msgs } = await pool.query(
      `SELECT sm.message_type AS "messageType", sm.content,
              sm.created_at AS "createdAt",
              COALESCE(u.name, 'AI') AS author
       FROM swarm_messages sm
       LEFT JOIN users u ON u.id = sm.sender_id
       WHERE sm.room_id = $1
         AND sm.created_at >= now() - make_interval(mins => $2)
       ORDER BY sm.created_at ASC LIMIT 150`,
      [roomId, windowMinutes],
    );
    const result = await runAnalysis({
      feature: "swarm_summary",
      entityType: "swarm_room",
      entityId: String(roomId),
      actorId: req.user!.id,
      canAccess: async () => true, // membership checked above
      systemPrompt: `
Summarize the incident-command room activity in the last ${windowMinutes} minutes.
Answer these questions: What happened? What changed? What is being investigated?
What is blocked? What is next?
Respond with valid JSON: { "confidence": 0-100,
  "what_happened": "...", "what_changed": "...",
  "investigating": "...", "blocked": "...", "next": "...",
  "sources": [ {"type":"swarm_message","id":"...","title":"..."} ] }
Use probabilistic language. Never invent facts not in the messages.`.trim(),
      untrustedInputs: msgs.map((m, i) => ({
        label: `message_${i}`,
        text: `[${m.messageType}] ${m.author} (${m.createdAt}): ${m.content}`,
      })),
      trustedContext: {
        incident: {
          number: room.incidentNumber,
          title: room.incidentTitle,
          severity: room.severity,
          status: room.incidentStatus,
        },
        messageCount: msgs.length,
        windowMinutes,
      },
      maxTokens: 1200,
    });
    const summary = JSON.stringify(result.result);
    await pool.query(
      "UPDATE swarm_rooms SET ai_summary = $1, ai_summary_at = now() WHERE id = $2",
      [summary, roomId],
    );
    res.json({ summary: result.result, confidence: result.confidence });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI summary failed";
    res.status(500).json({ error: msg });
  }
});

// ─── Resolve ──────────────────────────────────────────────────────────

router.post("/swarm/rooms/:id/resolve", async (req: AuthenticatedRequest, res) => {
  try {
    if (!isManager(req.user)) {
      res.status(403).json({ error: "Manager role or above required" });
      return;
    }
    const roomId = Number(req.params.id);
    const room = await getRoom(roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (room.status !== "active") {
      res.status(400).json({ error: "Room is not active" });
      return;
    }
    await pool.query("BEGIN");
    try {
      await pool.query(
        `UPDATE incidents SET status = 'resolved', resolved_at = now(),
         updated_at = now() WHERE id = $1`,
        [room.incidentId],
      );
      await pool.query(
        `UPDATE swarm_rooms SET status = 'resolved', resolved_at = now()
         WHERE id = $1`,
        [roomId],
      );
      await pool.query(
        `INSERT INTO swarm_messages (room_id, sender_id, sender_type, message_type, content)
         VALUES ($1, $2, 'ai', 'status_update', $3)`,
        [
          roomId,
          req.user!.id,
          `Incident ${room.incidentNumber} resolved. Swarm room closed. A post-incident review draft can now be generated.`,
        ],
      );
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
    await emitEvent({
      type: EventTypes.INCIDENT_RESOLVED,
      entityType: "incident",
      entityId: String(room.incidentId),
      actorId: req.user!.id,
      payload: { roomId },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to resolve swarm" });
  }
});

export default router;
