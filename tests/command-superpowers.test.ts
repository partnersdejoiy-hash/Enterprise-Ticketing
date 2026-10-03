/**
 * Tests for Superpowers #12 (Executive Brief), #26 (Service Health),
 * #27 (Workload Forecasting), #30 (Command Center summary inputs).
 *
 * Pattern follows existing tests: one PGlite instance per file, DATABASE_URL
 * set before any lib import, dynamic imports for the modules under test.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

let pg: PGlite;
let socket: PGLiteSocketServer;
let pool: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };
let scoreHealth: (s: any) => { score: number; level: string; deductions: unknown[] };
let forecastFromHistory: (h: { date: string; volume: number }[]) => {
  predictedVolume: number; confidence: string; basis: { date: string; volume: number }[];
};
let collectBriefMetrics: (p: "daily" | "weekly") => Promise<any>;

before(async () => {
  pg = await PGlite.create();
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
  ]) {
    await pg.exec(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  }
  socket = new PGLiteSocketServer({
    db: pg, port: 5562, host: "127.0.0.1", maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5562/postgres";
  process.env.NODE_ENV = "test";

  const dbMod = await import("../lib/db/src/index.ts");
  pool = dbMod.pool;
  const sh = await import(
    "../artifacts/orbitdesk/server/lib/service-health.ts"
  );
  scoreHealth = sh.scoreHealth;
  const wf = await import(
    "../artifacts/orbitdesk/server/lib/workload-forecast.ts"
  );
  forecastFromHistory = wf.forecastFromHistory;
  const eb = await import(
    "../artifacts/orbitdesk/server/lib/exec-brief.ts"
  );
  collectBriefMetrics = eb.collectBriefMetrics;
});

after(async () => {
  await socket?.stop();
  await pg?.close();
});

// ---------------------------------------------------------------------------
// #26 service-health scoring math
// ---------------------------------------------------------------------------

test("#26 scoreHealth: clean service scores 100/healthy", () => {
  const r = scoreHealth({
    criticalEvents: 0, highEvents: 0, warningEvents: 0,
    openIncidents: 0, resolvedIncidents30d: 0,
    ticketVolume30d: 0, slaBreaches30d: 0,
  });
  assert.equal(r.score, 100);
  assert.equal(r.level, "healthy");
  assert.equal(r.deductions.length, 0);
});

test("#26 scoreHealth: caps apply (no negative score)", () => {
  const r = scoreHealth({
    criticalEvents: 50, highEvents: 50, warningEvents: 50,
    openIncidents: 10, resolvedIncidents30d: 50,
    ticketVolume30d: 1000, slaBreaches30d: 50,
  });
  // 24+12+6+20+10+15+20 = 107 deductions -> floor at 0
  assert.equal(r.score, 0);
  assert.equal(r.level, "critical");
});

test("#26 scoreHealth: mid-range signals land in watch", () => {
  const r = scoreHealth({
    criticalEvents: 1, highEvents: 1, warningEvents: 0,
    openIncidents: 1, resolvedIncidents30d: 1,
    ticketVolume30d: 20, slaBreaches30d: 0,
  });
  // 8 + 4 + 10 + 2 + 2 = 26 -> score 74 -> watch
  assert.equal(r.score, 74);
  assert.equal(r.level, "watch");
  assert.equal(r.deductions.length, 5);
});

// ---------------------------------------------------------------------------
// #27 forecast math
// ---------------------------------------------------------------------------

test("#27 forecastFromHistory: stable history -> high confidence", () => {
  const history = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    volume: 10,
  }));
  const r = forecastFromHistory(history);
  assert.equal(r.predictedVolume, 10);
  assert.equal(r.confidence, "high");
  assert.equal(r.basis.length, 7);
});

test("#27 forecastFromHistory: empty history -> 0/low", () => {
  const r = forecastFromHistory([]);
  assert.equal(r.predictedVolume, 0);
  assert.equal(r.confidence, "low");
});

test("#27 forecastFromHistory: volatile history -> low confidence", () => {
  const history = [
    { date: "2026-09-01", volume: 1 },
    { date: "2026-09-02", volume: 50 },
    { date: "2026-09-03", volume: 2 },
    { date: "2026-09-04", volume: 48 },
    { date: "2026-09-05", volume: 1 },
    { date: "2026-09-06", volume: 55 },
    { date: "2026-09-07", volume: 3 },
  ];
  const r = forecastFromHistory(history);
  assert.equal(r.confidence, "low");
  assert.ok(r.predictedVolume >= 0);
});

test("#27 forecastFromHistory: sparse history (<4 days) -> low confidence", () => {
  const r = forecastFromHistory([
    { date: "2026-09-01", volume: 10 },
    { date: "2026-09-02", volume: 10 },
  ]);
  assert.equal(r.confidence, "low");
});

// ---------------------------------------------------------------------------
// #12 exec-brief aggregates against a real (PGlite) database
// ---------------------------------------------------------------------------

test("#12 collectBriefMetrics: real aggregates, traceable queries", async () => {
  const { rows: deptRows } = await pool.query(
    `INSERT INTO departments (name) VALUES ('IT') RETURNING id`,
  );
  const deptId = deptRows[0].id as number;
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, department_id)
     VALUES ('Admin','admin@t.test','x','admin',$1),
            ('Agent','agent@t.test','x','agent',$1)`,
    [deptId],
  );
  const { rows: adminRows } = await pool.query(
    `SELECT id FROM users WHERE email='admin@t.test'`,
  );
  const adminId = adminRows[0].id as number;
  await pool.query(
    `INSERT INTO tickets (ticket_number, subject, description, status, priority, department_id, assignee_id, created_by_id)
     VALUES ('T-1','open one','d1','open','high',$1,(SELECT id FROM users WHERE email='agent@t.test'),$2),
            ('T-2','open two','d2','in_progress','medium',$1,NULL,$2),
            ('T-3','done','d3','resolved','low',$1,(SELECT id FROM users WHERE email='agent@t.test'),$2)`,
    [deptId, adminId],
  );
  await pool.query(
    `INSERT INTO ticket_sla (ticket_id, resolution_due_at)
     VALUES ((SELECT id FROM tickets WHERE ticket_number='T-1'), now() - interval '1 hour'),
            ((SELECT id FROM tickets WHERE ticket_number='T-2'), now() + interval '30 days')`,
  );
  await pool.query(
    `INSERT INTO incidents (incident_number, title, is_major, status)
     VALUES ('INC-1','major outage', true, 'open')`,
  );
  await pool.query(
    `INSERT INTO knowledge_gaps (suggested_title) VALUES ('gap one')`,
  );

  const m = await collectBriefMetrics("daily");

  assert.equal(m.backlog, 2, "two open tickets");
  assert.equal(m.unassigned, 1, "one unassigned");
  assert.equal(m.major_incidents, 1);
  assert.equal(m.sla_breached, 1);
  assert.equal(m.knowledge_gaps_open, 1);
  assert.equal(m.tickets_created_in_window, 3);
  assert.equal(m.resolved_in_window, 1);
  assert.ok(
    m.metric_queries.major_incidents.includes("incidents"),
    "metric query recorded",
  );
  assert.ok(
    m.metric_queries.sla_health.includes("ticket_sla"),
    "sla query recorded",
  );
  assert.ok(
    Object.keys(m.metric_queries).length >= 8,
    "every metric is traceable",
  );
  assert.equal(m.agent_workload.length, 1);
  assert.equal(m.agent_workload[0].open_tickets, 1);
});
