import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

test("sla-predict: deadline math, storage, permission denial", async () => {
  const pg = await PGlite.create();
  for (const f of [
    "000_initial_schema.sql",
    "001_secure_intake.sql",
    "002_hierarchy.sql",
    "003_ai_workforce.sql",
    "004_ticket_deletion.sql",
    "005_ai_team_chat.sql",
    "006_agent_assignment.sql",
    "007_intelligence_foundation.sql",
    "008_itsm_and_superpowers.sql",
  ])
    await pg.exec(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  const socket = new PGLiteSocketServer({
    db: pg,
    port: 5562,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5562/postgres";
  process.env.NODE_ENV = "test";

  const { pool } = await import("../lib/db/src/index.ts");
  const {
    addBusinessMinutes,
    businessMinutesBetween,
    getCalendar,
    ensureTicketSla,
    getSlaStatus,
  } = await import("../artifacts/orbitdesk/server/lib/sla-engine.ts");
  const { getLatestPrediction, getPredictionById } = await import(
    "../artifacts/orbitdesk/server/lib/sla-predict.ts"
  );
  const { canAccessTicket } = await import(
    "../artifacts/orbitdesk/server/lib/ticket-access.ts"
  );

  // ---------- 1. Pure deadline math ----------
  const cal = {
    id: 1,
    timezone: "Asia/Kolkata",
    workDays: [1, 2, 3, 4, 5],
    workStart: "09:00:00",
    workEnd: "18:00:00",
    holidays: [],
  };

  // Friday 2026-10-02 17:00 IST = 11:30 UTC. +120 business min should land
  // Monday 2026-10-05 10:00 IST (60 min Fri + 60 min Mon).
  const friday = new Date("2026-10-02T11:30:00Z");
  const due = addBusinessMinutes(friday, 120, cal);
  const dueIST = new Date(due.getTime() + 5.5 * 3600 * 1000);
  assert.equal(dueIST.getUTCDay(), 1, "lands on Monday");
  assert.equal(dueIST.getUTCHours(), 10, "lands at 10:00 IST");
  assert.equal(dueIST.getUTCMinutes(), 0);

  // businessMinutesBetween: 09:00-12:00 IST on a workday = 180.
  const morning = businessMinutesBetween(
    new Date("2026-10-05T03:30:00Z"), // 09:00 IST
    new Date("2026-10-05T06:30:00Z"), // 12:00 IST
    cal,
  );
  assert.equal(morning, 180);

  // Weekend contributes zero.
  const weekend = businessMinutesBetween(
    new Date("2026-10-03T00:00:00Z"), // Saturday
    new Date("2026-10-04T23:59:59Z"), // Sunday
    cal,
  );
  assert.equal(weekend, 0);

  // ---------- 2. Seed: policy + users + ticket ----------
  await pool.query("INSERT INTO departments(id,name) VALUES(1,'IT')");
  await pool.query(
    `INSERT INTO users(id,name,email,password_hash,role,department_id,is_active) VALUES
     (1,'SA','sa@t','x','super_admin',NULL,true),
     (2,'Agent','ag@t','x','agent',1,true),
     (3,'Ext','ex@t','x','external',NULL,true)`,
  );
  await pool.query(
    `INSERT INTO sla_policies(name,department_id,priority,first_response_minutes,resolution_minutes,business_hours_only,is_active)
     VALUES('IT default',1,NULL,60,480,true,true)`,
  );
  await pool.query(
    `INSERT INTO tickets(id,ticket_number,subject,description,status,priority,department_id,assignee_id,created_by_id,created_at)
     VALUES(1,'T-1','VPN down','cannot connect', 'open','high',1,2,2, now() - interval '7 hours')`,
  );
  const { rows: tRows } = await pool.query(
    "SELECT created_at FROM tickets WHERE id=1",
  );
  await ensureTicketSla(1, 1, "high", new Date(tRows[0].created_at));

  const status = await getSlaStatus(1);
  assert.ok(status.resolutionDueAt, "resolution due computed");
  assert.ok(
    ["safe", "at_risk", "critical"].includes(status.health),
    `health is sane, got ${status.health}`,
  );
  assert.ok(
    (status.percentElapsed ?? 0) > 0,
    "7h of 8h elapsed registers progress",
  );

  // Breach detection: move due date into the past.
  await pool.query(
    "UPDATE ticket_sla SET resolution_due_at = now() - interval '1 hour' WHERE ticket_id=1",
  );
  const breached = await getSlaStatus(1);
  assert.equal(breached.health, "breached");
  assert.equal(breached.remainingBusinessMinutes, 0);

  // ---------- 3. Prediction storage round-trip ----------
  await pool.query(
    `INSERT INTO sla_predictions
       (ticket_id, breach_probability, predicted_breach_at, health, confidence,
        factors, recommended_actions, model_version)
     VALUES (1, 82, now() + interval '47 minutes', 'critical', 74,
       '[{"factor":"queue","weight":60,"detail":"5 open in dept"}]'::jsonb,
       '["Escalate to manager"]'::jsonb, 'test-model')`,
  );
  const latest = await getLatestPrediction(1);
  assert.ok(latest, "latest prediction found");
  assert.equal(latest!.breachProbability, 82);
  assert.equal(latest!.health, "critical");
  assert.equal(latest!.factors[0].factor, "queue");
  const byId = await getPredictionById(latest!.id);
  assert.equal(byId.ticketId, 1);

  const none = await getLatestPrediction(999);
  assert.equal(none, null, "no prediction → null");

  // ---------- 4. Permission denial ----------
  const admin = { id: 1, role: "super_admin", departmentId: null };
  const agent = { id: 2, role: "agent", departmentId: 1 };
  const ext = { id: 3, role: "external", departmentId: null };
  assert.equal(await canAccessTicket(admin as never, 1), true);
  assert.equal(await canAccessTicket(agent as never, 1), true);
  assert.equal(
    await canAccessTicket(ext as never, 1),
    false,
    "external cannot access another user's ticket",
  );

  await socket.stop();
});
