/**
 * Major Incident Auto-Command (#22).
 *
 * When a major incident is declared, automatically prepare:
 *  - incident room (swarm room)
 *  - incident commander suggestion (department manager)
 *  - stakeholder list (department members)
 *  - communication templates (status page draft)
 *  - related tickets (keyword match against open tickets)
 *  - timeline skeleton + initial AI summary prompt
 *
 * The AI continuously summarizes changes; the room's "Last 15 min" summary
 * is generated on demand via /api/swarm/rooms/:id/ai-summary.
 */

import { pool } from "@workspace/db";
import { emitEvent, EventTypes } from "./orbit-events.js";

export interface AutoCommandChecklist {
  incidentId: number;
  roomId: number;
  commander: { id: number; name: string; email: string } | null;
  stakeholders: { id: number; name: string; email: string; role: string }[];
  commsTemplates: { name: string; subject: string; body: string }[];
  relatedTickets: { id: number; ticketNumber: string; subject: string }[];
  timelineSeeded: boolean;
}

function keywords(title: string, description: string | null): string[] {
  const text = `${title} ${description ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
  const stop = new Set([
    "the", "and", "for", "with", "from", "that", "this", "have", "has",
    "are", "was", "were", "will", "can", "not", "out", "down", "issue",
    "error", "please", "help", "urgent", "a", "an", "of", "to", "in", "on",
    "is", "it", "as", "at", "by", "be", "or",
  ]);
  return [...new Set(text.split(/\s+/).filter((w) => w.length > 3 && !stop.has(w)))].slice(0, 6);
}

export async function prepareMajorIncident(
  incidentId: number,
  actorId: number,
): Promise<AutoCommandChecklist> {
  const { rows: incRows } = await pool.query(
    `SELECT id, incident_number AS "incidentNumber", title, description,
            severity, department_id AS "departmentId"
     FROM incidents WHERE id = $1 AND deleted_at IS NULL`,
    [incidentId],
  );
  const incident = incRows[0];
  if (!incident) throw new Error("Incident not found");

  // 1. Swarm room (reuse if already exists).
  let roomId: number;
  const { rows: roomRows } = await pool.query(
    "SELECT id FROM swarm_rooms WHERE incident_id = $1 AND status = 'active' LIMIT 1",
    [incidentId],
  );
  if (roomRows[0]) {
    roomId = roomRows[0].id as number;
  } else {
    const { rows } = await pool.query(
      `INSERT INTO swarm_rooms (incident_id, name, commander_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [incidentId, `Swarm — ${incident.incidentNumber}`, null],
    );
    roomId = rows[0].id as number;
  }

  // 2. Commander suggestion: a manager in the incident's department,
  //    else any manager/admin, else the actor.
  let commander: AutoCommandChecklist["commander"] = null;
  const { rows: mgrRows } = await pool.query(
    `SELECT id, name, email FROM users
     WHERE is_active AND role IN ('manager','admin','super_admin')
       AND ($1::int IS NULL OR department_id = $1)
     ORDER BY CASE WHEN role = 'manager' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [incident.departmentId],
  );
  if (mgrRows[0]) {
    commander = {
      id: mgrRows[0].id as number,
      name: mgrRows[0].name as string,
      email: mgrRows[0].email as string,
    };
    await pool.query(
      `INSERT INTO swarm_members (room_id, user_id, role)
       VALUES ($1, $2, 'commander')
       ON CONFLICT (room_id, user_id) DO UPDATE SET role = 'commander'`,
      [roomId, commander.id],
    );
    await pool.query(
      "UPDATE swarm_rooms SET commander_id = $1 WHERE id = $2",
      [commander.id, roomId],
    );
    await pool.query(
      "UPDATE incidents SET commander_id = $1 WHERE id = $2",
      [commander.id, incidentId],
    );
  }

  // 3. Stakeholder list: active members of the incident's department.
  const { rows: stRows } = await pool.query(
    `SELECT id, name, email, role FROM users
     WHERE is_active AND ($1::int IS NULL OR department_id = $1)
       AND role IN ('agent','manager','admin','super_admin')
     ORDER BY id ASC LIMIT 50`,
    [incident.departmentId],
  );
  const stakeholders = stRows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    email: r.email as string,
    role: r.role as string,
  }));
  // Auto-add stakeholders as room members.
  for (const s of stakeholders) {
    await pool.query(
      `INSERT INTO swarm_members (room_id, user_id, role)
       VALUES ($1, $2, 'participant')
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [roomId, s.id],
    );
  }

  // 4. Communication templates (status page draft + stakeholder update).
  const commsTemplates = [
    {
      name: "Status page — initial",
      subject: `[Investigating] ${incident.title}`,
      body: `We are currently investigating an incident affecting: ${incident.title}.\n\nSeverity: ${incident.severity}\nStarted: ${new Date().toISOString()}\n\nOur team is actively working on mitigation. Next update within 30 minutes.\n\n— OrbitDesk Incident Command`,
    },
    {
      name: "Stakeholder update",
      subject: `[Major Incident] ${incident.incidentNumber} — ${incident.title}`,
      body: `A major incident has been declared.\n\nIncident: ${incident.incidentNumber}\nTitle: ${incident.title}\nSeverity: ${incident.severity}\nCommander: ${commander ? commander.name : "TBD"}\n\nSwarm room is active. Please join for coordination.\n\n— OrbitDesk`,
    },
  ];

  // 5. Related tickets: keyword match against open tickets.
  const kws = keywords(incident.title, incident.description);
  let relatedTickets: AutoCommandChecklist["relatedTickets"] = [];
  if (kws.length > 0) {
    const conditions = kws.map((_, i) => `(t.subject ILIKE $${i + 1} OR t.description ILIKE $${i + 1})`);
    const params = kws.map((k) => `%${k}%`);
    const { rows: tRows } = await pool.query(
      `SELECT t.id, t.ticket_number AS "ticketNumber", t.subject
       FROM tickets t
       WHERE t.status IN ('open','assigned','in_progress','waiting')
         AND (${conditions.join(" OR ")})
       ORDER BY t.created_at DESC LIMIT 20`,
      params,
    );
    relatedTickets = tRows.map((r) => ({
      id: r.id as number,
      ticketNumber: r.ticketNumber as string,
      subject: r.subject as string,
    }));
    // Link them to the incident.
    for (const t of relatedTickets) {
      await pool.query(
        `INSERT INTO incident_tickets (incident_id, ticket_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [incidentId, t.id],
      );
    }
  }

  // 6. Seed the timeline with a status_update message.
  await pool.query(
    `INSERT INTO swarm_messages (room_id, sender_id, sender_type, message_type, content)
     VALUES ($1, $2, 'ai', 'status_update', $3)`,
    [
      roomId,
      actorId,
      `Major incident declared: ${incident.incidentNumber} — ${incident.title} (severity: ${incident.severity}). Auto-command prepared: commander ${commander ? commander.name : "TBD"}, ${stakeholders.length} stakeholders added, ${relatedTickets.length} related tickets linked.`,
    ],
  );

  await emitEvent({
    type: "incident.auto_command",
    entityType: "incident",
    entityId: String(incidentId),
    actorId,
    payload: { roomId, commanderId: commander?.id ?? null, relatedTickets: relatedTickets.length },
  });

  return {
    incidentId,
    roomId,
    commander,
    stakeholders,
    commsTemplates,
    relatedTickets,
    timelineSeeded: true,
  };
}
