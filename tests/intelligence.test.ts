/**
 * tests/intelligence.test.ts — Superpowers #6 (root cause), #4 (predictive
 * ops), #3 (resolution agent).
 *
 * Part 1: pure-function tests — clustering (Jaccard/keywords) and spike
 * detection. No DB I/O.
 * Part 2: approval-gating tests against PGlite — executePlan must refuse
 * unapproved plans, apply allowlisted actions after approval, and skip
 * non-allowlisted action types.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// ---------------------------------------------------------------------------
// Part 1: pure functions. The pool is lazy — it never connects for these.
//
// IMPORTANT: DATABASE_URL must point at the PGlite socket BEFORE the first
// import, because @workspace/db creates its Pool at module load time.
// ---------------------------------------------------------------------------
const TEST_DB_PORT = Number(process.env.INTELLIGENCE_TEST_PORT ?? 5571);
process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres`;
process.env.NODE_ENV = "test";

const rc = await import(
  "../artifacts/orbitdesk/server/lib/root-cause.ts"
);
const po = await import(
  "../artifacts/orbitdesk/server/lib/predictive-ops.ts"
);

test("extractKeywords: lowercases, drops stopwords and short words", () => {
  const kws = rc.extractKeywords("VPN connection timeout on my laptop please");
  assert.ok(kws.includes("vpn"), `expected vpn in ${kws}`);
  assert.ok(kws.includes("connection"));
  assert.ok(kws.includes("timeout"));
  assert.ok(kws.includes("laptop"));
  assert.ok(!kws.includes("on"), "stopword 'on' must be dropped");
  assert.ok(!kws.includes("my"), "stopword 'my' must be dropped");
  assert.ok(!kws.includes("please"), "stopword 'please' must be dropped");
  assert.ok(kws.every((w) => w.length >= 3), "short words dropped");
});

test("extractKeywords: empty input yields no keywords", () => {
  assert.deepEqual(rc.extractKeywords(""), []);
  assert.deepEqual(rc.extractKeywords("a an the to"), []);
});

test("jaccard: identical=1, disjoint=0, empty union=0", () => {
  assert.equal(rc.jaccard(new Set(["a", "b"]), new Set(["a", "b"])), 1);
  assert.equal(rc.jaccard(new Set(["a"]), new Set(["b"])), 0);
  assert.equal(rc.jaccard(new Set(), new Set()), 0);
  assert.equal(rc.jaccard(new Set(["a", "b", "c"]), new Set(["b", "c", "d"])), 0.5);
});

test("clusterTickets: similar subjects cluster, unrelated stay apart", () => {
  const clusters = rc.clusterTickets([
    { id: 1, subject: "VPN connection timeout on laptop" },
    { id: 2, subject: "VPN timeout when connecting laptop" },
    { id: 3, subject: "laptop VPN connection keeps timing out" },
    { id: 4, subject: "Printer not working in finance office" },
  ]);
  const vpnCluster = clusters.find((c) =>
    c.members.some((m) => m.id === 1),
  );
  assert.ok(vpnCluster, "VPN tickets should form a cluster");
  assert.ok(
    vpnCluster.members.length >= 2,
    `expected >=2 VPN members, got ${vpnCluster.members.length}`,
  );
  const printerCluster = clusters.find((c) =>
    c.members.some((m) => m.id === 4),
  );
  assert.ok(printerCluster, "printer ticket should exist in some cluster");
  assert.ok(
    !vpnCluster.members.some((m) => m.id === 4),
    "printer ticket must NOT join the VPN cluster",
  );
});

test("clusterTickets: respects the 500-ticket cap", () => {
  const many = Array.from({ length: 600 }, (_, i) => ({
    id: i + 1,
    subject: `unique unrelated subject number ${i} xyzzy`,
  }));
  const clusters = rc.clusterTickets(many);
  const total = clusters.reduce((n, c) => n + c.members.length, 0);
  assert.ok(total <= 500, `expected <=500 clustered, got ${total}`);
});

test("detectSpike: flat volume is not a spike", () => {
  const r = po.detectSpike(7, 21); // 1/day vs 1/day
  assert.equal(r.isSpike, false);
});

test("detectSpike: >1.5x lift is a spike with ratio", () => {
  const r = po.detectSpike(14, 21); // 2/day vs 1/day
  assert.equal(r.isSpike, true);
  assert.ok(Math.abs(r.ratio - 2) < 0.001, `ratio ~2, got ${r.ratio}`);
});

test("detectSpike: zero prior history is guarded (no spike)", () => {
  const r = po.detectSpike(10, 0);
  assert.equal(r.isSpike, false);
  assert.equal(r.ratio, 0);
});

test("detectSpike: exactly 1.5x is not a spike (strict threshold)", () => {
  // 1.5/day vs 1/day -> ratio exactly 1.5 -> not a spike
  const r = po.detectSpike(10.5, 21);
  assert.equal(r.isSpike, false);
});

// ---------------------------------------------------------------------------
// Part 2: approval gating against PGlite.
// ---------------------------------------------------------------------------
const stage = (m: string) => process.stderr.write(`[stage] ${m}\n`);
stage("pglite create");
const pg = await PGlite.create();
stage("pglite created");
const migrationFiles = (await readdir("migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const f of migrationFiles) {
  stage(`loading ${f}`);
  await pg.exec(await readFile(`migrations/${f}`, "utf8"));
}
stage("migrations loaded");
const socket = new PGLiteSocketServer({
  db: pg,
  port: TEST_DB_PORT,
  host: "127.0.0.1",
  maxConnections: 30,
});
stage("socket start");
await socket.start();
stage("socket started");
stage("importing db");
const { pool } = await import("../lib/db/src/index.ts");
stage("db imported");
const ra = await import(
  "../artifacts/orbitdesk/server/lib/resolution-agent.ts"
);
stage("ra imported");

async function fixtures() {
  const { rows: deptRows } = await pool.query(
    `INSERT INTO departments (name) VALUES ('IT') RETURNING id`,
  );
  const deptId = deptRows[0].id as number;
  const { rows: dept2Rows } = await pool.query(
    `INSERT INTO departments (name) VALUES ('HR') RETURNING id`,
  );
  const otherDeptId = dept2Rows[0].id as number;

  const mkUser = async (name: string, role: string, departmentId: number | null) => {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ($1, $2, 'x', $3::\"role\", $4) RETURNING id`,
      [name, `${name}@test.local`, role, departmentId],
    );
    return rows[0].id as number;
  };
  const agentId = await mkUser("agent-it", "agent", deptId);
  const outsiderId = await mkUser("agent-hr", "agent", otherDeptId);
  const adminId = await mkUser("admin", "admin", null);

  const { rows: tRows } = await pool.query(
    `INSERT INTO tickets (ticket_number, subject, description, department_id, created_by_id)
     VALUES ('T-1', 'VPN down', 'vpn broken', $1, $2) RETURNING id`,
    [deptId, adminId],
  );
  const ticketId = tRows[0].id as number;
  return { deptId, agentId, outsiderId, adminId, ticketId };
}

const fx = await fixtures();

async function makePlan(
  ticketId: number,
  createdBy: number,
  actions: unknown[],
  status = "proposed",
) {
  const { rows } = await pool.query(
    `INSERT INTO resolution_plans
       (ticket_id, steps, actions, confidence, sources, recommended_action,
        requires_approval, risk_level, status, created_by_id)
     VALUES ($1, '[]'::jsonb, $2::jsonb, 80, '[]'::jsonb, 'test', true, 'low', $3, $4)
     RETURNING id`,
    [ticketId, JSON.stringify(actions), status, createdBy],
  );
  return rows[0].id as number;
}

test("executePlan: refuses unapproved plan (approval gate)", async () => {
  const planId = await makePlan(fx.ticketId, fx.adminId, [
    { type: "add_comment", params: { text: "hello" } },
  ]);
  await assert.rejects(() => ra.executePlan(planId, fx.agentId), (err: Error & { status?: number }) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /approved/i);
    return true;
  });
});

test("executePlan: applies allowlisted actions after approval", async () => {
  const planId = await makePlan(fx.ticketId, fx.adminId, [
    { type: "add_comment", params: { text: "investigating vpn" } },
    { type: "set_priority", params: { priority: "high" } },
    { type: "add_tag", params: { tag: "network" } },
  ]);
  await ra.approvePlan(planId, fx.agentId);
  const { execution_log } = await ra.executePlan(planId, fx.agentId);

  const { rows: comments } = await pool.query(
    `SELECT content FROM ticket_comments WHERE ticket_id = $1`,
    [fx.ticketId],
  );
  assert.ok(
    comments.some((c) => c.content === "investigating vpn"),
    "add_comment must create a ticket comment",
  );
  const { rows: t } = await pool.query(
    `SELECT priority, tags FROM tickets WHERE id = $1`,
    [fx.ticketId],
  );
  assert.equal(t[0].priority, "high");
  assert.ok(t[0].tags.includes("network"));
  const { rows: p } = await pool.query(
    `SELECT status FROM resolution_plans WHERE id = $1`,
    [planId],
  );
  assert.equal(p[0].status, "executed");
  assert.equal((execution_log as unknown[]).length, 3);
});

test("executePlan: non-allowlisted action is skipped, never executed", async () => {
  const planId = await makePlan(
    fx.ticketId,
    fx.adminId,
    [{ type: "run_shell", params: { command: "rm -rf /" } }],
    "approved",
  );
  const { execution_log } = await ra.executePlan(planId, fx.agentId);
  const log = execution_log as { action: string; status: string; detail?: string }[];
  assert.equal(log.length, 1);
  assert.equal(log[0].action, "run_shell");
  assert.equal(log[0].status, "skipped");
  assert.match(log[0].detail ?? "", /allowlist/i);
});

test("approvePlan: outsider agent cannot approve another department's plan", async () => {
  const planId = await makePlan(fx.ticketId, fx.adminId, []);
  await assert.rejects(() => ra.approvePlan(planId, fx.outsiderId), (err: Error & { status?: number }) => {
    assert.equal(err.status, 403);
    return true;
  });
});

test("executePlan: invalid set_priority value is rejected", async () => {
  const planId = await makePlan(
    fx.ticketId,
    fx.adminId,
    [{ type: "set_priority", params: { priority: "extreme" } }],
    "approved",
  );
  await assert.rejects(() => ra.executePlan(planId, fx.agentId), /Invalid priority/);
  // Plan must remain approved (transaction rolled back, not half-applied).
  const { rows } = await pool.query(
    `SELECT status FROM resolution_plans WHERE id = $1`,
    [planId],
  );
  assert.equal(rows[0].status, "approved");
});

test("teardown", async () => {
  await pool.end();
  await socket.stop();
  await pg.close();
});
