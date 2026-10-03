/**
 * Service Catalog (#10) tests — run with the repo's test runner:
 *   node --import tsx --test artifacts/orbitdesk/server/lib/service-catalog.test.ts
 *
 * Spins up PGlite, applies migrations 000-008, points DATABASE_URL at it,
 * then exercises the catalog lib end-to-end (validation, approval ordering,
 * auto-approval, rejection, fulfillment ticket creation).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// --- PGlite bootstrap (before any import of service-catalog / @workspace/db) ---
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
    await readFile(new URL("../../../../migrations/" + f, import.meta.url), "utf8"),
  );
const socket = new PGLiteSocketServer({
  db: pg,
  port: 5554,
  host: "127.0.0.1",
  maxConnections: 30,
});
await socket.start();
process.env.DATABASE_URL =
  "postgres://postgres:postgres@127.0.0.1:5554/postgres";
process.env.NODE_ENV = "test";

const { pool } = await import("../../../../lib/db/src/index.ts");
const catalog = await import("./service-catalog.ts");
const {
  CatalogError,
  validateFormSchema,
  validateFormData,
  validateApprovalChain,
  createRequestItem,
  decideApproval,
  fulfillRequest,
} = catalog;

async function seedUsers() {
  await pool.query(
    `INSERT INTO departments(id, name) VALUES (1, 'IT') ON CONFLICT (id) DO NOTHING`,
  );
  for (const [id, role] of [
    [11, "employee"],
    [12, "manager"],
    [13, "admin"],
    [14, "agent"],
  ] as const) {
    await pool.query(
      `INSERT INTO users(id, name, email, password_hash, role, department_id, is_active, must_change_password)
       VALUES ($1, $2, $3, 'x', $4, 1, true, false)
       ON CONFLICT (id) DO NOTHING`,
      [id, `Catalog ${role}`, `catalog-${role}@example.test`, role],
    );
  }
}

async function createItem(overrides: Record<string, unknown> = {}) {
  const { rows } = await pool.query(
    `INSERT INTO service_catalog_items
       (name, category, description, form_schema, approval_chain, department_id, created_by_id)
     VALUES ($1, 'IT', 'test item', $2::jsonb, $3::jsonb, 1, 13)
     RETURNING id`,
    [
      (overrides.name as string) ?? "Test Item",
      JSON.stringify(
        (overrides.form_schema as unknown) ?? {
          fields: [
            { name: "laptop_model", label: "Laptop model", type: "text", required: true },
            { name: "quantity", label: "Quantity", type: "number", required: false },
            {
              name: "os",
              label: "OS",
              type: "select",
              required: true,
              options: ["macOS", "Windows", "Linux"],
            },
          ],
        },
      ),
      JSON.stringify((overrides.approval_chain as unknown) ?? []),
    ],
  );
  return rows[0].id as number;
}

const GOOD_DATA = { laptop_model: "ThinkPad", quantity: 2, os: "Linux" };

async function eventTypes(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT event_type FROM domain_events ORDER BY id`,
  );
  return rows.map((r) => r.event_type as string);
}

test("validateFormSchema rejects bad field types and shapes", () => {
  const badType = { fields: [{ name: "a", label: "A", type: "email" }] };
  assert.throws(() => validateFormSchema(badType), CatalogError);

  const badName = { fields: [{ name: "Bad Name!", label: "B", type: "text" }] };
  assert.throws(() => validateFormSchema(badName), CatalogError);

  const selectNoOptions = {
    fields: [{ name: "s", label: "S", type: "select" }],
  };
  assert.throws(() => validateFormSchema(selectNoOptions), CatalogError);

  const dup = {
    fields: [
      { name: "a", label: "A", type: "text" },
      { name: "a", label: "A2", type: "text" },
    ],
  };
  assert.throws(() => validateFormSchema(dup), CatalogError);

  assert.throws(() => validateFormSchema({ fields: "nope" }), CatalogError);
  assert.throws(() => validateFormSchema(null), CatalogError);

  // Valid schema passes.
  validateFormSchema({
    fields: [
      { name: "a", label: "A", type: "text", required: true },
      { name: "b", label: "B", type: "select", options: ["x", "y"] },
      { name: "c", label: "C", type: "checkbox" },
      { name: "d", label: "D", type: "date" },
      { name: "e", label: "E", type: "number" },
      { name: "f", label: "F", type: "textarea" },
    ],
  });
});

test("validateFormData catches missing required fields and bad values", () => {
  const schema = {
    fields: [
      { name: "req_text", label: "Required text", type: "text", required: true },
      { name: "os", label: "OS", type: "select", required: true, options: ["a", "b"] },
      { name: "qty", label: "Qty", type: "number", required: false },
    ],
  } as const;

  const missing = validateFormData(schema as any, { os: "a" });
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((e) => e.includes("Required text")));

  const badSelect = validateFormData(schema as any, { req_text: "x", os: "zzz" });
  assert.equal(badSelect.valid, false);
  assert.ok(badSelect.errors.some((e) => e.includes("OS")));

  const badNumber = validateFormData(schema as any, { req_text: "x", os: "a", qty: "many" });
  assert.equal(badNumber.valid, false);

  const ok = validateFormData(schema as any, { req_text: "x", os: "a", qty: "3" });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.errors, []);
});

test("validateApprovalChain sorts by order and rejects junk", () => {
  const sorted = validateApprovalChain([
    { role: "admin", order: 2 },
    { role: "manager", order: 1 },
  ]);
  assert.deepEqual(sorted, [
    { role: "manager", order: 1 },
    { role: "admin", order: 2 },
  ]);
  assert.throws(() => validateApprovalChain([{ role: "", order: 1 }]), CatalogError);
  assert.throws(() => validateApprovalChain([{ role: "manager", order: 0 }]), CatalogError);
  assert.throws(
    () => validateApprovalChain([{ role: "a", order: 1 }, { role: "b", order: 1 }]),
    CatalogError,
  );
  assert.throws(() => validateApprovalChain("nope"), CatalogError);
});

test("empty approval chain auto-approves and fulfills with a ticket", async () => {
  await seedUsers();
  const itemId = await createItem({ approval_chain: [] });

  const before = await eventTypes();
  const request = await createRequestItem(itemId, 11, GOOD_DATA);

  assert.match(request.request_number, /^REQ-[0-9A-F]{8}$/);
  assert.equal(request.status, "approved");

  const { rows } = await pool.query(
    `SELECT status, ticket_id FROM service_catalog_requests WHERE id = $1`,
    [request.id],
  );
  assert.equal(rows[0].status, "completed");
  assert.ok(rows[0].ticket_id);

  const { rows: tRows } = await pool.query(
    `SELECT ticket_number, subject, description, priority, status, department_id, created_by_id, tags
     FROM tickets WHERE id = $1`,
    [rows[0].ticket_id],
  );
  const ticket = tRows[0];
  assert.match(ticket.ticket_number, /^DJ-[0-9A-F]{16}$/);
  assert.ok(ticket.subject.startsWith("[Catalog]"));
  assert.ok(ticket.subject.includes(request.request_number));
  assert.ok(ticket.description.includes("ThinkPad"));
  assert.equal(ticket.priority, "medium");
  assert.equal(ticket.status, "open");
  assert.equal(ticket.department_id, 1);
  assert.equal(ticket.created_by_id, 11);
  assert.deepEqual(ticket.tags, ["catalog-request"]);

  const newEvents = (await eventTypes()).slice(before.length);
  assert.ok(newEvents.includes("catalog.request_created"));
  assert.ok(newEvents.includes("catalog.fulfilled"));
  assert.ok(newEvents.includes("ticket.created"));
});

test("createRequestItem rejects invalid form data and inactive items", async () => {
  await seedUsers();
  const itemId = await createItem({ approval_chain: [] });

  await assert.rejects(
    createRequestItem(itemId, 11, { quantity: 1, os: "Linux" }),
    (e: any) => e instanceof CatalogError && e.status === 400,
  );
  await assert.rejects(
    createRequestItem(itemId, 11, { ...GOOD_DATA, os: "BeOS" }),
    (e: any) => e instanceof CatalogError && e.status === 400,
  );
  await assert.rejects(
    createRequestItem(999999, 11, GOOD_DATA),
    (e: any) => e instanceof CatalogError && e.status === 404,
  );

  // Deactivated item cannot be requested.
  await pool.query(`UPDATE service_catalog_items SET is_active = false WHERE id = $1`, [itemId]);
  await assert.rejects(
    createRequestItem(itemId, 11, GOOD_DATA),
    (e: any) => e instanceof CatalogError && e.status === 404,
  );
});

test("approval chain is sequential: out-of-order decide throws", async () => {
  await seedUsers();
  const itemId = await createItem({
    approval_chain: [
      { role: "manager", order: 1 },
      { role: "admin", order: 2 },
    ],
  });
  const request = await createRequestItem(itemId, 11, GOOD_DATA);
  assert.equal(request.status, "in_approval");
  assert.equal(request.current_step, 1);

  // Wrong role (agent) cannot decide the manager's step -> 403.
  await assert.rejects(
    decideApproval(request.id, { id: 14, role: "agent" }, "approved"),
    (e: any) => e instanceof CatalogError && e.status === 403,
  );

  // Manager approves step 1 -> moves to step 2 (admin).
  const afterFirst = await decideApproval(request.id, { id: 12, role: "manager" }, "approved", "looks good");
  assert.equal(afterFirst.status, "in_approval");
  assert.equal(afterFirst.current_step, 2);

  // Manager tries to decide again (step 2 needs admin) -> 403: cannot skip ahead / re-decide.
  await assert.rejects(
    decideApproval(request.id, { id: 12, role: "manager" }, "approved"),
    (e: any) => e instanceof CatalogError && e.status === 403,
  );

  // Admin approves the final step -> fulfilled with a ticket.
  const final = await decideApproval(request.id, { id: 13, role: "admin" }, "approved");
  assert.equal(final.status, "approved");
  const { rows } = await pool.query(
    `SELECT status, ticket_id FROM service_catalog_requests WHERE id = $1`,
    [request.id],
  );
  assert.equal(rows[0].status, "completed");
  assert.ok(rows[0].ticket_id);

  // Deciding a completed request throws (no pending step).
  await assert.rejects(
    decideApproval(request.id, { id: 13, role: "admin" }, "approved"),
    (e: any) => e instanceof CatalogError && (e.status === 409 || e.status === 403),
  );

  const { rows: steps } = await pool.query(
    `SELECT step_order, status, approver_role FROM approvals
     WHERE entity_type = 'catalog_request' AND entity_id = $1 ORDER BY step_order`,
    [String(request.id)],
  );
  assert.deepEqual(
    steps.map((s) => [s.step_order, s.status, s.approver_role]),
    [
      [1, "approved", "manager"],
      [2, "approved", "admin"],
    ],
  );
});

test("reject stops the chain and emits catalog.request_rejected", async () => {
  await seedUsers();
  const itemId = await createItem({
    approval_chain: [
      { role: "manager", order: 1 },
      { role: "admin", order: 2 },
    ],
  });
  const before = await eventTypes();
  const request = await createRequestItem(itemId, 11, GOOD_DATA);

  const rejected = await decideApproval(request.id, { id: 12, role: "manager" }, "rejected", "not needed");
  assert.equal(rejected.status, "rejected");

  const { rows } = await pool.query(
    `SELECT status, ticket_id, completed_at FROM service_catalog_requests WHERE id = $1`,
    [request.id],
  );
  assert.equal(rows[0].status, "rejected");
  assert.equal(rows[0].ticket_id, null);
  assert.ok(rows[0].completed_at);

  // Chain is dead: the admin cannot decide anything now.
  await assert.rejects(
    decideApproval(request.id, { id: 13, role: "admin" }, "approved"),
    (e: any) => e instanceof CatalogError && e.status === 409,
  );

  // No ticket was created for this request.
  const { rows: tRows } = await pool.query(
    `SELECT count(*)::int AS n FROM tickets WHERE subject LIKE $1`,
    [`%${request.request_number}%`],
  );
  assert.equal(tRows[0].n, 0);

  const newEvents = (await eventTypes()).slice(before.length);
  assert.ok(newEvents.includes("catalog.request_rejected"));
  assert.ok(!newEvents.includes("catalog.fulfilled"));
});

test("fulfillRequest is idempotent and refuses non-approved requests", async () => {
  await seedUsers();
  const itemId = await createItem({ approval_chain: [] });
  const request = await createRequestItem(itemId, 11, GOOD_DATA);

  const { rows } = await pool.query(
    `SELECT ticket_id FROM service_catalog_requests WHERE id = $1`,
    [request.id],
  );
  const first = await fulfillRequest(request.id, 13);
  assert.equal(first.id, rows[0].ticket_id); // already fulfilled -> same ticket

  const item2 = await createItem({
    approval_chain: [{ role: "manager", order: 1 }],
  });
  const pending = await createRequestItem(item2, 11, GOOD_DATA);
  await assert.rejects(
    fulfillRequest(pending.id, 13),
    (e: any) => e instanceof CatalogError && e.status === 409,
  );
});

test("teardown", async () => {
  await socket.stop();
  await pool.end();
  await pg.close();
});
