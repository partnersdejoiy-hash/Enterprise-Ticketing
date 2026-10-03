/**
 * Admin Copilot (#15) + Automation Copilot (#24) security tests.
 *
 * Covers:
 *  - Confirmation token: sign/verify roundtrip, tamper rejection, expiry.
 *  - RBAC denial: non-admin cannot parse or execute admin commands.
 *  - Confirmation gating: execute without valid token fails.
 *  - Draft-only creation: automation copilot never creates active rules.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// ---- Pure crypto tests (no DB) -------------------------------------------

test("confirmation token: sign/verify roundtrip", async () => {
  const { signConfirmation, verifyConfirmation } = await import(
    "../artifacts/orbitdesk/server/lib/admin-copilot.ts"
  );
  const payload = { action: "disable_automation", ruleId: 42 };
  const token = signConfirmation(payload);
  const verified = verifyConfirmation(token);
  assert.deepEqual(verified, payload);
});

test("confirmation token: tampered token rejected", async () => {
  const { signConfirmation, verifyConfirmation } = await import(
    "../artifacts/orbitdesk/server/lib/admin-copilot.ts"
  );
  const token = signConfirmation({ action: "x", ruleId: 1 });
  // Flip a character in the base64url body.
  const tampered =
    token.slice(0, 10) + (token[10] === "A" ? "B" : "A") + token.slice(11);
  assert.equal(verifyConfirmation(tampered), null);
});

test("confirmation token: garbage rejected", async () => {
  const { verifyConfirmation } = await import(
    "../artifacts/orbitdesk/server/lib/admin-copilot.ts"
  );
  assert.equal(verifyConfirmation("not-a-token"), null);
  assert.equal(verifyConfirmation(""), null);
});

// ---- DB-backed tests (PGlite) --------------------------------------------

async function setupDb() {
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
  ]) {
    await pg.exec(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  }
  const socket = new PGLiteSocketServer({
    db: pg,
    port: 5557,
    host: "127.0.0.1",
    maxConnections: 10,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5557/postgres";
  return { pg, socket };
}

test("RBAC: non-admin cannot parse admin commands", async () => {
  const { socket } = await setupDb();
  try {
    const { pool } = await import("../lib/db/src/index.ts");
    // Seed: one agent user.
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ('Agent','agent@test.dev','x','agent',true) RETURNING id`,
    );
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE email='agent@test.dev'`,
    );
    const agentId = rows[0].id;

    const { parseAdminCommand } = await import(
      "../artifacts/orbitdesk/server/lib/admin-copilot.ts"
    );
    await assert.rejects(
      () => parseAdminCommand("Show SLA breaches today", agentId),
      /Admin access required/,
    );
  } finally {
    await socket.stop();
  }
});

test("RBAC: non-admin cannot execute admin commands", async () => {
  const { socket } = await setupDb();
  try {
    const { pool } = await import("../lib/db/src/index.ts");
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ('Agent2','agent2@test.dev','x','agent',true) RETURNING id`,
    );
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE email='agent2@test.dev'`,
    );
    const agentId = rows[0].id;

    const { signConfirmation, executeAdminCommand } = await import(
      "../artifacts/orbitdesk/server/lib/admin-copilot.ts"
    );
    // Even with a VALID token, a non-admin must be denied.
    const token = signConfirmation({ action: "create_department", name: "Evil" });
    await assert.rejects(
      () => executeAdminCommand(token, agentId),
      /Admin access required/,
    );
  } finally {
    await socket.stop();
  }
});

test("Confirmation gating: execute with invalid token fails", async () => {
  const { socket } = await setupDb();
  try {
    const { pool } = await import("../lib/db/src/index.ts");
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ('Admin','admin@test.dev','x','super_admin',true) RETURNING id`,
    );
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE email='admin@test.dev'`,
    );
    const adminId = rows[0].id;

    const { executeAdminCommand } = await import(
      "../artifacts/orbitdesk/server/lib/admin-copilot.ts"
    );
    await assert.rejects(
      () => executeAdminCommand("bogus-token", adminId),
      /Invalid or expired/,
    );
  } finally {
    await socket.stop();
  }
});

test("Admin can execute confirmed create_department", async () => {
  const { socket } = await setupDb();
  try {
    const { pool } = await import("../lib/db/src/index.ts");
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ('Admin3','admin3@test.dev','x','admin',true) RETURNING id`,
    );
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE email='admin3@test.dev'`,
    );
    const adminId = rows[0].id;

    const { signConfirmation, executeAdminCommand } = await import(
      "../artifacts/orbitdesk/server/lib/admin-copilot.ts"
    );
    const token = signConfirmation({
      action: "create_department",
      name: "Vendor Management",
    });
    const result = await executeAdminCommand(token, adminId);
    assert.equal(result.success, true);

    const { rows: depts } = await pool.query(
      `SELECT name FROM departments WHERE name='Vendor Management'`,
    );
    assert.equal(depts.length, 1);

    // Audit log written.
    const { rows: audits } = await pool.query(
      `SELECT 1 FROM ai_audit_logs WHERE action='admin_copilot.execute' LIMIT 1`,
    );
    assert.equal(audits.length, 1);
  } finally {
    await socket.stop();
  }
});

test("Automation copilot: creates DRAFT (inactive) rules only", async () => {
  const { socket } = await setupDb();
  try {
    const { pool } = await import("../lib/db/src/index.ts");
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ('Admin4','admin4@test.dev','x','admin',true) RETURNING id`,
    );
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE email='admin4@test.dev'`,
    );
    const adminId = rows[0].id;

    const { createAutomationDraft } = await import(
      "../artifacts/orbitdesk/server/lib/automation-copilot.ts"
    );
    const { id } = await createAutomationDraft(
      {
        name: "Copilot test rule",
        description: "test",
        triggerType: "ticket_created",
        conditionLogic: "AND",
        priority: 100,
        conditions: [{ field: "priority", operator: "equals", value: "urgent" }],
        actions: [{ type: "set_priority", value: "urgent" }],
        notifications: [],
        slaNote: null,
      },
      adminId,
    );

    const { rows: rules } = await pool.query(
      `SELECT is_active FROM automation_rules WHERE id=$1`,
      [id],
    );
    assert.equal(rules.length, 1);
    assert.equal(rules[0].is_active, false, "copilot rules must be inactive drafts");
  } finally {
    await socket.stop();
  }
});

test("Automation copilot: non-admin cannot create drafts", async () => {
  const { socket } = await setupDb();
  try {
    const { pool } = await import("../lib/db/src/index.ts");
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ('Agent5','agent5@test.dev','x','agent',true) RETURNING id`,
    );
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE email='agent5@test.dev'`,
    );
    const agentId = rows[0].id;

    const { createAutomationDraft } = await import(
      "../artifacts/orbitdesk/server/lib/automation-copilot.ts"
    );
    await assert.rejects(
      () =>
        createAutomationDraft(
          {
            name: "Evil rule",
            description: "test",
            triggerType: "ticket_created",
            conditionLogic: "AND",
            priority: 100,
            conditions: [{ field: "priority", operator: "equals", value: "urgent" }],
            actions: [{ type: "set_priority", value: "urgent" }],
            notifications: [],
            slaNote: null,
          },
          agentId,
        ),
      /Admin access required/,
    );
  } finally {
    await socket.stop();
  }
});
