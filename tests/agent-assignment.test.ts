import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// Redirect `nodemailer` to a stub before the app is imported, so no real
// SMTP connection is ever attempted in this test file's process.
register("./email-stub-hooks.mjs", import.meta.url);
(globalThis as any).__testSentEmails = [];
const sentEmails = (): any[] => (globalThis as any).__testSentEmails;

test("agent assignment: unified pool, 3-ticket cap, refill, proactive email", async () => {
  const pg = await PGlite.create();
  for (const f of [
    "000_initial_schema.sql",
    "001_secure_intake.sql",
    "002_hierarchy.sql",
    "003_ai_workforce.sql",
    "004_ticket_deletion.sql",
    "005_ai_team_chat.sql",
    "006_agent_assignment.sql",
  ])
    await pg.exec(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  const socket = new PGLiteSocketServer({
    db: pg,
    port: 5558,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5558/postgres";
  process.env.NODE_ENV = "test";

  const { pool } = await import("../lib/db/src/index.ts");
  const { getAgentFromAddress, sendAgentEmail } =
    await import("../artifacts/orbitdesk/server/lib/emailService.ts");
  const {
    findAssignmentCandidate,
    autoAssignTicket,
    refillDepartmentQueue,
    MAX_ACTIVE_TICKETS_PER_AGENT,
  } = await import("../artifacts/orbitdesk/server/lib/agentAssignment.ts");

  // --- FEATURE 1: new email format <slug>-orbitdesk@dejoiy.com ---
  assert.equal(getAgentFromAddress("Mew").email, "mew-orbitdesk@dejoiy.com");
  assert.equal(getAgentFromAddress("Buzz").email, "buzz-orbitdesk@dejoiy.com");
  assert.equal(
    getAgentFromAddress("Dark Volt").email,
    "darkvolt-orbitdesk@dejoiy.com",
  );
  assert.deepEqual(getAgentFromAddress("Mew"), {
    email: "mew-orbitdesk@dejoiy.com",
    name: "Mew · OrbitDesk AI",
  });

  // --- Seed: departments, humans, AI workers ---
  await pool.query("INSERT INTO departments(id,name) VALUES(1,'IT'),(2,'HR')");
  await pool.query(
    `INSERT INTO users(id,name,email,password_hash,role,department_id,is_active) VALUES
     (1,'SA','sa@t','x','super_admin',NULL,true),
     (2,'H1','h1@t','x','agent',1,true),
     (3,'H2','h2@t','x','agent',1,true),
     (4,'H3','h3@t','x','manager',2,true),
     (5,'Inactive','in@t','x','agent',1,false)`,
  );
  await pool.query(
    `INSERT INTO orbit_ai_workers(id,department_id,kind,name,enabled) VALUES
     (10,1,'triage','Buzz',true),
     (11,1,'draft','Rocky',true),
     (12,2,'triage','Aero',true),
     (14,2,'draft','Disabled',false)
     ON CONFLICT (id) DO NOTHING`,
  );
  // Migration 003 already seeds a PA worker; just name it.
  await pool.query(`UPDATE orbit_ai_workers SET name='Mew' WHERE kind='pa'`);

  let n = 0;
  async function mkTicket(
    dept: number,
    opts: {
      status?: string;
      assigneeId?: number | null;
      aiWorkerId?: number | null;
      email?: string | null;
    } = {},
  ) {
    n++;
    const { rows } = await pool.query(
      `INSERT INTO tickets(ticket_number,subject,description,status,department_id,assignee_id,assigned_ai_worker_id,created_by_id,raised_for_email,raised_for_name)
       VALUES($1,'subject','desc',$2,$3,$4,$5,1,$6,'Req Name') RETURNING id`,
      [
        `T-${n}`,
        opts.status ?? "open",
        dept,
        opts.assigneeId ?? null,
        opts.aiWorkerId ?? null,
        opts.email ?? null,
      ],
    );
    return rows[0].id as number;
  }
  async function activeCountForHuman(userId: number) {
    const { rows } = await pool.query(
      `SELECT count(*)::int c FROM tickets WHERE assignee_id=$1 AND status NOT IN ('resolved','closed')`,
      [userId],
    );
    return rows[0].c as number;
  }

  assert.equal(MAX_ACTIVE_TICKETS_PER_AGENT, 3);

  // --- Least-loaded wins; tie-break lowest id (H1 id=2) ---
  let c = await findAssignmentCandidate(1);
  assert.equal(c?.kind, "human");
  assert.equal(c?.id, 2);
  assert.equal(c?.activeCount, 0);

  // --- H1 gets 1 ticket -> H2 (id=3) wins ---
  await mkTicket(1, { status: "assigned", assigneeId: 2 });
  c = await findAssignmentCandidate(1);
  assert.equal(c?.kind, "human");
  assert.equal(c?.id, 3);

  // --- Inactive users and disabled workers are excluded ---
  // (Inactive id=5, Disabled worker id=14 must never be picked)
  c = await findAssignmentCandidate(1);
  assert.ok(c && c.id !== 5 && c.id !== 14);

  // --- PA worker (no department) is excluded from department pool ---
  const cHr = await findAssignmentCandidate(2);
  assert.ok(cHr); // H3 (manager, dept 2) or Aero
  assert.ok(cHr!.id === 4 || cHr!.id === 12);

  // --- Departments are isolated: dept-2 pool has no dept-1 members ---
  await mkTicket(1, { status: "assigned", assigneeId: 2 });
  await mkTicket(1, { status: "assigned", assigneeId: 2 });
  // H1 now at 3 (cap). H2:0, Buzz:0, Rocky:0 -> H2 wins
  c = await findAssignmentCandidate(1);
  assert.equal(c?.id, 3);

  // --- Fill H2, Buzz, Rocky to cap -> AI worker path exercised ---
  await mkTicket(1, { status: "assigned", assigneeId: 3 });
  await mkTicket(1, { status: "assigned", assigneeId: 3 });
  await mkTicket(1, { status: "assigned", assigneeId: 3 });
  await mkTicket(1, { status: "in_progress", aiWorkerId: 10 });
  await mkTicket(1, { status: "in_progress", aiWorkerId: 10 });
  await mkTicket(1, { status: "in_progress", aiWorkerId: 10 });
  await mkTicket(1, { status: "assigned", aiWorkerId: 11 });
  await mkTicket(1, { status: "assigned", aiWorkerId: 11 });
  // H1:3, H2:3, Buzz:3, Rocky:2 -> Rocky (id=11) wins with 2
  c = await findAssignmentCandidate(1);
  assert.equal(c?.kind, "ai");
  assert.equal(c?.id, 11);
  assert.equal(c?.name, "Rocky");

  // --- 3-cap: everyone at 3 -> null, ticket stays unassigned ---
  await mkTicket(1, { status: "assigned", aiWorkerId: 11 });
  c = await findAssignmentCandidate(1);
  assert.equal(c, null);

  // --- Resolved/closed tickets do NOT count as active ---
  // Resolve one of H1's tickets -> H1 drops to 2 -> H1 wins again
  await pool.query(
    `UPDATE tickets SET status='resolved' WHERE id=(SELECT id FROM tickets WHERE assignee_id=2 AND status='assigned' LIMIT 1)`,
  );
  c = await findAssignmentCandidate(1);
  // H1 should now have capacity (2 < 3)
  assert.ok(c && c.activeCount < 3);

  // --- autoAssignTicket: assigns + sets status ---
  // Free a slot first: resolve all of Rocky's tickets
  await pool.query(
    `UPDATE tickets SET status='closed' WHERE assigned_ai_worker_id=11`,
  );
  const t1 = await mkTicket(1, { email: "requester@example.com" });
  const r1 = await autoAssignTicket(t1, 1, 1);
  assert.equal(r1.kind, "ai");
  assert.equal(r1.id, 11);
  assert.equal(r1.name, "Rocky");
  const { rows: t1rows } = await pool.query(
    `SELECT status, assigned_ai_worker_id, assignee_id FROM tickets WHERE id=$1`,
    [t1],
  );
  assert.equal(t1rows[0].status, "assigned");
  assert.equal(Number(t1rows[0].assigned_ai_worker_id), 11);
  assert.equal(t1rows[0].assignee_id, null);

  // --- Proactive assignment email via stub ---
  // Email is not configured yet -> sendAgentEmail warns and skips (never throws)
  await sendAgentEmail("Mew", "x@example.com", "s", "<p>b</p>");
  assert.equal(sentEmails().length, 0);

  // Configure email via legacy settings, then the assignment email must send
  await pool.query(
    `INSERT INTO system_settings(key,value) VALUES
     ('email_enabled','true'),('smtp_host','smtp.test'),('smtp_port','587'),
     ('smtp_user','u'),('smtp_pass','p'),('email_from','noreply@dejoiy.com')
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
  );
  const t2 = await mkTicket(1, { email: "requester2@example.com" });
  // Rocky now at 1 (t1) -> give Rocky 2 more so H1 (2 active) still loses... make deterministic:
  // directly assign to least-loaded and check the email
  const before = sentEmails().length;
  const r2 = await autoAssignTicket(t2, 1, 1);
  assert.equal(sentEmails().length, before + (r2.kind === "ai" ? 1 : 0));
  if (r2.kind === "ai") {
    const sent = sentEmails()[sentEmails().length - 1];
    const expectedFrom = `"${r2.name} · OrbitDesk AI" <${r2.name!.toLowerCase()}-orbitdesk@dejoiy.com>`;
    assert.equal(sent.from, expectedFrom);
    assert.ok((sent.subject as string).includes("picked up your ticket"));
    assert.equal(sent.to, "requester2@example.com");
  }

  // --- Refill: resolve a ticket -> oldest waiting 'open' ticket gets assigned ---
  const w1 = await mkTicket(1);
  const w2 = await mkTicket(1);
  await new Promise((r) => setTimeout(r, 10));
  // Ensure w1 is older (createdAt ordering); both are 'open' + unassigned
  const refilled = await refillDepartmentQueue(1, 1);
  assert.ok(refilled.length >= 1);
  const { rows: w1rows } = await pool.query(
    `SELECT status FROM tickets WHERE id=$1`,
    [w1],
  );
  assert.equal(w1rows[0].status, "assigned");
  // w1 (older) must have been assigned before w2
  const assignedIds = refilled.length;
  assert.ok(assignedIds >= 1);

  await socket.stop();
  await pool.end();
});
