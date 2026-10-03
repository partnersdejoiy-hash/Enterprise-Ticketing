/**
 * Tests for Superpowers #17 (AI Impact Analysis), #21 (Customer Conversation
 * Memory), #11 (Global Operations Map).
 *
 * Pure logic (no DB): change visibility/decision rules, trait-inference ban
 * text, coordinate rounding, exact-location gate.
 *
 * DB-backed (PGlite + real migrations 000-008, 010, 011):
 * - CI graph traversal: cycle-safe, depth-limited.
 * - Ops map markers: counts aggregate correctly; coordinates rounded for
 *   non-privileged viewers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// Dummy DATABASE_URL so @workspace/db's module-level Pool can be constructed
// for the pure-logic imports below (no query is issued without a live socket).
process.env.DATABASE_URL =
  "postgres://postgres:postgres@127.0.0.1:1/postgres";

const { canViewChange, canDecideChange } = await import(
  "../artifacts/orbitdesk/server/lib/impact-analysis.ts"
);
const {
  TRAIT_INFERENCE_BAN,
  CUSTOMER_SUMMARY_PROMPT,
  canViewCustomerSummary,
} = await import(
  "../artifacts/orbitdesk/server/lib/customer-memory.ts"
);
const { roundCoordinate, maySeeExactLocation } = await import(
  "../artifacts/orbitdesk/server/lib/geo.ts"
);

// ---------------------------------------------------------------------------
// #17: change visibility + decision rules (pure)
// ---------------------------------------------------------------------------

test("#17 canViewChange: staff see all changes, others only their own", () => {
  const change = { created_by_id: 7 };
  for (const role of ["super_admin", "admin", "manager", "agent"]) {
    assert.equal(
      canViewChange({ id: 1, role, departmentId: null }, change),
      true,
      `${role} should see any change`,
    );
  }
  assert.equal(
    canViewChange({ id: 7, role: "employee", departmentId: null }, change),
    true,
    "employee should see own change",
  );
  assert.equal(
    canViewChange({ id: 9, role: "employee", departmentId: null }, change),
    false,
    "employee should NOT see another's change",
  );
  assert.equal(
    canViewChange({ id: 9, role: "external", departmentId: null }, change),
    false,
    "external should NOT see another's change",
  );
});

test("#17 canDecideChange: only manager+ can approve/reject", () => {
  for (const role of ["super_admin", "admin", "manager"]) {
    assert.equal(
      canDecideChange({ id: 1, role, departmentId: null }),
      true,
      `${role} should decide`,
    );
  }
  for (const role of ["agent", "employee", "external"]) {
    assert.equal(
      canDecideChange({ id: 1, role, departmentId: null }),
      false,
      `${role} should NOT decide`,
    );
  }
});

// ---------------------------------------------------------------------------
// #21: trait-inference ban (static + import)
// ---------------------------------------------------------------------------

test("#21 TRAIT_INFERENCE_BAN forbids all sensitive trait categories", () => {
  const required = [
    "personality",
    "health",
    "financial",
    "ethnicity",
    "religion",
    "political",
    "sexual orientation",
  ];
  for (const term of required) {
    assert.ok(
      TRAIT_INFERENCE_BAN.toLowerCase().includes(term),
      `ban must mention "${term}"`,
    );
  }
});

test("#21 customer summary prompt embeds the ban (reaches the model)", () => {
  assert.ok(
    CUSTOMER_SUMMARY_PROMPT.includes("TRAIT_INFERENCE_BAN") ||
      CUSTOMER_SUMMARY_PROMPT.includes("FORBIDDEN: You must NEVER infer"),
    "system prompt must embed the trait-inference ban",
  );
});

test("#21 canViewCustomerSummary: staff only", () => {
  for (const role of ["super_admin", "admin", "manager", "agent"]) {
    assert.equal(canViewCustomerSummary({ id: 1, role }), true);
  }
  for (const role of ["employee", "external"]) {
    assert.equal(canViewCustomerSummary({ id: 1, role }), false);
  }
});

// ---------------------------------------------------------------------------
// #11: location privacy (pure)
// ---------------------------------------------------------------------------

test("#11 roundCoordinate rounds to 1 decimal (~11km)", () => {
  assert.equal(roundCoordinate(28.6139), 28.6);
  assert.equal(roundCoordinate(77.209), 77.2);
  assert.equal(roundCoordinate(-33.8688), -33.9);
  // Rounded value must hide the precise original.
  assert.notEqual(roundCoordinate(28.6139), 28.6139);
});

test("#11 maySeeExactLocation: only super_admin/admin", () => {
  assert.equal(maySeeExactLocation("super_admin"), true);
  assert.equal(maySeeExactLocation("admin"), true);
  for (const role of ["manager", "agent", "employee", "external"]) {
    assert.equal(maySeeExactLocation(role), false);
  }
});

// ---------------------------------------------------------------------------
// DB-backed: PGlite with real migrations
// ---------------------------------------------------------------------------

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
  "010_change_cis.sql",
  "011_dept_locations.sql",
]) {
  await pg.exec(
    await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
  );
}
const socket = new PGLiteSocketServer({
  db: pg,
  port: 5559,
  host: "127.0.0.1",
  maxConnections: 30,
});
await socket.start();
process.env.DATABASE_URL =
  "postgres://postgres:postgres@127.0.0.1:5559/postgres";

const { traverseCiGraph } = await import(
  "../artifacts/orbitdesk/server/lib/impact-analysis.ts"
);
const { getOpsMarkers } = await import(
  "../artifacts/orbitdesk/server/lib/geo.ts"
);
const { pool } = await import("../lib/db/src/index.ts");

test("#17 traverseCiGraph is cycle-safe and depth-limited", async () => {
  // A -> B -> C -> A (cycle), C -> D.
  const ids: Record<string, number> = {};
  for (const name of ["ci-a", "ci-b", "ci-c", "ci-d"]) {
    const r = await pool.query(
      `INSERT INTO configuration_items (name, ci_type) VALUES ($1,'server') RETURNING id`,
      [name],
    );
    ids[name] = r.rows[0].id;
  }
  for (const [s, t] of [
    ["ci-a", "ci-b"],
    ["ci-b", "ci-c"],
    ["ci-c", "ci-a"],
    ["ci-c", "ci-d"],
  ]) {
    await pool.query(
      `INSERT INTO ci_relationships (source_ci_id, target_ci_id, relationship_type)
       VALUES ($1,$2,'depends_on')`,
      [ids[s], ids[t]],
    );
  }

  // Depth 2 from A: A(0), B(1), C(2). D is depth 3 -> excluded. No hang on cycle.
  const shallow = await traverseCiGraph([ids["ci-a"]], 2);
  const shallowIds = new Set(shallow.map((c) => c.id));
  assert.ok(shallowIds.has(ids["ci-a"]), "seed included");
  assert.ok(shallowIds.has(ids["ci-b"]), "depth-1 included");
  assert.ok(shallowIds.has(ids["ci-c"]), "depth-2 included");
  assert.ok(!shallowIds.has(ids["ci-d"]), "depth-3 excluded at maxDepth=2");
  assert.equal(shallow.length, 3, "no duplicates from cycle");

  // Depth 4 from A: D reachable.
  const deep = await traverseCiGraph([ids["ci-a"]], 4);
  assert.ok(
    new Set(deep.map((c) => c.id)).has(ids["ci-d"]),
    "D reachable at maxDepth=4",
  );

  // Empty seeds -> empty result, no query storm.
  assert.deepEqual(await traverseCiGraph([], 4), []);
});

test("#11 getOpsMarkers aggregates counts and rounds coords for non-admins", async () => {
  const dept = (
    await pool.query(
      `INSERT INTO departments (name, location_name, location_lat, location_lng)
       VALUES ('Map Test Dept','Gurugram DC',28.6139,77.2090) RETURNING id`,
    )
  ).rows[0].id;
  const user = (
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ('Map Agent','map.agent@example.com','x','agent',$1) RETURNING id`,
      [dept],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO tickets (ticket_number, subject, description, priority, department_id, created_by_id)
     VALUES ('MAP-1','outage','down','urgent',$1,$2)`,
    [dept, user],
  );
  await pool.query(
    `INSERT INTO configuration_items (name, ci_type, department_id)
     VALUES ('core-switch-1','network',$1)`,
    [dept],
  );

  const adminMarkers = await getOpsMarkers({ actorRole: "admin" });
  const marker = adminMarkers.find((m) => m.department_id === dept);
  assert.ok(marker, "marker exists for department with coords");
  assert.equal(marker.counts.open_tickets, 1);
  assert.equal(marker.counts.assets, 1);
  assert.equal(marker.counts.active_agents, 1);
  assert.equal(marker.lat, 28.6139, "admin sees exact coordinates");
  assert.equal(marker.approximate, false);
  assert.equal(marker.max_severity, "critical", "urgent ticket -> critical");

  const agentMarkers = await getOpsMarkers({ actorRole: "agent" });
  const agentMarker = agentMarkers.find((m) => m.department_id === dept)!;
  assert.equal(agentMarker.lat, 28.6, "non-admin gets rounded latitude");
  assert.equal(agentMarker.lng, 77.2, "non-admin gets rounded longitude");
  assert.equal(agentMarker.approximate, true);
  // Counts are still real — privacy only affects coordinates.
  assert.equal(agentMarker.counts.open_tickets, 1);
});

test("cleanup", async () => {
  await pool.end();
  await socket.stop();
});
