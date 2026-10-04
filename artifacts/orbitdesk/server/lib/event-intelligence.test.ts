/**
 * Tests for Event Intelligence (#9): pure helpers + a PGlite-backed
 * end-to-end test of the ingest pipeline (dedup, correlation, incident +
 * ticket creation, API-key verification).
 *
 * Import note: the module under test pulls in @workspace/db, which reads
 * DATABASE_URL once at import time and throws if it is unset. The
 * DB-backed test runs FIRST and imports the module only after pointing
 * DATABASE_URL at a PGlite socket server. The pure tests below never issue
 * a query, so they reuse the cached module safely. Do NOT add a top-level
 * static import of the module under test — it would freeze the pool's
 * connection string before the DB test can set it.
 *
 * Run: node --import tsx --test artifacts/orbitdesk/server/lib/event-intelligence.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// Harmless fallback: the pure tests never open a connection (the Pool only
// connects on first query). The DB-backed test overrides this before any
// import of the module under test.
process.env.DATABASE_URL ??=
  "postgres://postgres:postgres@127.0.0.1:1/postgres";

// ---------------------------------------------------------------------------
// PGlite-backed end-to-end ingest test (runs first — see note above)
// ---------------------------------------------------------------------------

test("ingest pipeline: dedup, incident+ticket creation, correlation, key auth", async () => {
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
    "010_monitoring_keys.sql",
  ])
    await pg.exec(
      await readFile(new URL("../../../../migrations/" + f, import.meta.url), "utf8"),
    );
  const socket = new PGLiteSocketServer({
    db: pg,
    port: 0, // ephemeral port — actual port read back below
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@" + socket.getServerConn() + "/postgres";

  const { pool } = await import("../../../../lib/db/src/index.ts");
  const {
    ingestEvent,
    generateApiKey,
    verifyApiKey,
  } = await import("./event-intelligence.ts");

  try {
    // Seed a super admin (resolveSystemAuthorId fallback).
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ('Admin','admin@example.test','x','super_admin',true)`,
    );
    const admin = await pool.query(
      `SELECT id, tenant_id FROM users WHERE email='admin@example.test'`,
    );

    // --- API key roundtrip --------------------------------------------
    const { key, keyHash, keyPrefix } = generateApiKey();
    await pool.query(
      `INSERT INTO monitoring_api_keys (tenant_id, name, key_hash, key_prefix, created_by_id)
       VALUES ($1,'zabbix-prod',$2,$3,$4)`,
      [admin.rows[0].tenant_id, keyHash, keyPrefix, admin.rows[0].id],
    );
    const keyInfo = await verifyApiKey(key);
    assert.ok(keyInfo);
    assert.equal(keyInfo.name, "zabbix-prod");
    assert.equal(await verifyApiKey("odm_" + "0".repeat(64)), null);
    assert.equal(await verifyApiKey(""), null);
    // Revoked keys are rejected.
    await pool.query(
      `UPDATE monitoring_api_keys SET is_active=false WHERE key_hash=$1`,
      [keyHash],
    );
    assert.equal(await verifyApiKey(key), null);
    await pool.query(
      `UPDATE monitoring_api_keys SET is_active=true WHERE key_hash=$1`,
      [keyHash],
    );
    const activeKey = (await verifyApiKey(key))!;
    assert.ok(activeKey);

    // --- First critical event creates incident + ticket ----------------
    const r1 = await ingestEvent(
      {
        source: "zabbix",
        severity: "critical",
        title: "Disk usage > 90%",
        message: "/var at 95%",
        service_name: "postgres",
        host: "db-01",
      },
      activeKey,
    );
    assert.equal(r1.deduplicated, false);
    assert.equal(r1.correlated, false);
    assert.ok(r1.incidentId);
    assert.ok(r1.ticketId);
    const ev1 = await pool.query(
      `SELECT status, dedup_count FROM monitoring_events WHERE id=$1`,
      [r1.eventId],
    );
    assert.equal(ev1.rows[0].status, "incident_created");
    assert.equal(ev1.rows[0].dedup_count, 1);
    const inc = await pool.query(
      `SELECT incident_number, severity, status, is_major FROM incidents WHERE id=$1`,
      [r1.incidentId],
    );
    assert.match(inc.rows[0].incident_number, /^INC-[A-F0-9]{8}$/);
    assert.equal(inc.rows[0].severity, "critical");
    assert.equal(inc.rows[0].status, "open");
    assert.equal(inc.rows[0].is_major, true);
    const tkt = await pool.query(
      `SELECT ticket_number, priority, tags, subject FROM tickets WHERE id=$1`,
      [r1.ticketId],
    );
    assert.equal(tkt.rows[0].priority, "urgent");
    assert.deepEqual(tkt.rows[0].tags, ["monitoring-event"]);
    assert.ok(
      (tkt.rows[0].subject as string).startsWith("[Monitoring]"),
    );
    const corr = await pool.query(
      `SELECT correlation_type, confidence FROM event_correlations WHERE incident_id=$1 AND event_id=$2`,
      [r1.incidentId, r1.eventId],
    );
    assert.equal(corr.rows[0].correlation_type, "fingerprint");
    assert.equal(Number(corr.rows[0].confidence), 100);
    const link = await pool.query(
      `SELECT 1 FROM incident_tickets WHERE incident_id=$1 AND ticket_id=$2`,
      [r1.incidentId, r1.ticketId],
    );
    assert.equal(link.rowCount, 1);

    // --- Same event within the window dedups ----------------------------
    const r2 = await ingestEvent(
      {
        source: "zabbix",
        severity: "critical",
        title: "Disk usage > 90%",
        message: "/var at 96%",
        service_name: "postgres",
        host: "db-01",
      },
      activeKey,
    );
    assert.equal(r2.deduplicated, true);
    assert.equal(r2.eventId, r1.eventId);
    assert.equal(r2.incidentId, null);
    const ev2 = await pool.query(
      `SELECT dedup_count, status FROM monitoring_events WHERE id=$1`,
      [r1.eventId],
    );
    assert.equal(ev2.rows[0].dedup_count, 2);
    assert.equal(ev2.rows[0].status, "incident_created");
    const incCount = await pool.query(
      `SELECT count(*)::int AS n FROM incidents`,
    );
    assert.equal(incCount.rows[0].n, 1); // no second incident

    // --- New critical event, same service → correlates to open incident --
    const r3 = await ingestEvent(
      {
        source: "zabbix",
        severity: "critical",
        title: "Connection pool exhausted",
        service_name: "postgres",
        host: "db-02",
      },
      activeKey,
    );
    assert.equal(r3.deduplicated, false);
    assert.equal(r3.correlated, true);
    assert.equal(r3.incidentId, r1.incidentId);
    assert.equal(r3.ticketId, null);
    const ev3 = await pool.query(
      `SELECT status, incident_id FROM monitoring_events WHERE id=$1`,
      [r3.eventId],
    );
    assert.equal(ev3.rows[0].status, "correlated");
    const corr3 = await pool.query(
      `SELECT correlation_type, confidence FROM event_correlations WHERE incident_id=$1 AND event_id=$2`,
      [r1.incidentId, r3.eventId],
    );
    assert.equal(corr3.rows[0].correlation_type, "service");
    assert.equal(Number(corr3.rows[0].confidence), 75);

    // --- Low-severity event: no incident/ticket --------------------------
    const r4 = await ingestEvent(
      { source: "datadog", severity: "info", title: "Deploy finished" },
      activeKey,
    );
    assert.equal(r4.incidentId, null);
    assert.equal(r4.ticketId, null);
    const ev4 = await pool.query(
      `SELECT status FROM monitoring_events WHERE id=$1`,
      [r4.eventId],
    );
    assert.equal(ev4.rows[0].status, "new");
  } finally {
    await pool.end();
    await socket.stop();
    await pg.close();
  }
});

// ---------------------------------------------------------------------------
// Pure helper tests (reuse the cached module — they never query)
// ---------------------------------------------------------------------------

const {
  computeFingerprint,
  withinDedupWindow,
  validateIngestInput,
  pickCorrelation,
  generateApiKey,
} = await import("./event-intelligence.ts");

test("fingerprint is stable for identical input", () => {
  const a = computeFingerprint({
    source: "zabbix",
    title: "Disk usage > 90%",
    host: "db-01",
    service_name: "postgres",
  });
  const b = computeFingerprint({
    source: "zabbix",
    title: "Disk usage > 90%",
    host: "db-01",
    service_name: "postgres",
  });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("fingerprint changes when host or service differs", () => {
  const base = {
    source: "zabbix",
    title: "Disk usage > 90%",
    host: "db-01",
    service_name: "postgres",
  };
  assert.notEqual(
    computeFingerprint(base),
    computeFingerprint({ ...base, host: "db-02" }),
  );
  assert.notEqual(
    computeFingerprint(base),
    computeFingerprint({ ...base, service_name: "mysql" }),
  );
  assert.notEqual(
    computeFingerprint(base),
    computeFingerprint({ ...base, title: "CPU load > 90%" }),
  );
});

test("fingerprint normalizes host/service case and whitespace", () => {
  const a = computeFingerprint({
    source: "zabbix",
    title: "x",
    host: "DB-01",
    service_name: " Postgres ",
  });
  const b = computeFingerprint({
    source: "zabbix",
    title: "x",
    host: "db-01",
    service_name: "postgres",
  });
  assert.equal(a, b);
});

test("dedup window: recent last_seen is inside, old is outside", () => {
  const now = new Date("2026-10-03T13:00:00Z");
  assert.equal(
    withinDedupWindow(new Date("2026-10-03T12:50:00Z"), 15, now),
    true,
  );
  assert.equal(
    withinDedupWindow(new Date("2026-10-03T12:30:00Z"), 15, now),
    false,
  );
  // Boundary is exclusive.
  assert.equal(
    withinDedupWindow(new Date("2026-10-03T12:45:00Z"), 15, now),
    false,
  );
});

test("severity validation rejects bad input", () => {
  const valid = {
    source: "prometheus",
    severity: "warning",
    title: "High latency",
  };
  assert.equal(validateIngestInput(valid).severity, "warning");
  // Uppercase severity is normalized.
  assert.equal(
    validateIngestInput({ ...valid, severity: "CRITICAL" }).severity,
    "critical",
  );
  for (const bad of ["urgent", "p0", ""]) {
    assert.throws(
      () => validateIngestInput({ ...valid, severity: bad }),
      /severity must be one of/,
    );
  }
  assert.throws(
    () => validateIngestInput({ source: "zabbix", title: "x" }),
    /severity is required/,
  );
  assert.throws(
    () => validateIngestInput({ source: "zabbix", severity: "info" }),
    /title is required/,
  );
  assert.throws(
    () => validateIngestInput({ title: "x", severity: "info" }),
    /source is required/,
  );
  // ci_id and raw_payload type checks.
  assert.throws(
    () => validateIngestInput({ ...valid, ci_id: -5 }),
    /ci_id must be a positive integer/,
  );
  assert.throws(
    () => validateIngestInput({ ...valid, raw_payload: [1, 2] }),
    /raw_payload must be a JSON object/,
  );
});

test("validateIngestInput normalizes service/host and caps lengths", () => {
  const e = validateIngestInput({
    source: " datadog ",
    severity: "high",
    title: "  API 5xx spike  ",
    service_name: " Checkout-API ",
    host: "WEB-02",
    raw_payload: { a: 1 },
  });
  assert.equal(e.source, "datadog");
  assert.equal(e.title, "API 5xx spike");
  assert.equal(e.service_name, "checkout-api");
  assert.equal(e.host, "web-02");
  assert.throws(
    () =>
      validateIngestInput({
        source: "s",
        severity: "info",
        title: "x".repeat(301),
      }),
    /title must be at most 300 characters/,
  );
});

test("correlation matching prefers same service over same host", () => {
  const hostMatch = { incidentId: 1, serviceName: "billing", host: "web-01" };
  const serviceMatch = {
    incidentId: 2,
    serviceName: "checkout-api",
    host: "web-99",
  };
  const event = { service_name: "checkout-api", host: "web-01" };
  const pick = pickCorrelation(event, [hostMatch, serviceMatch]);
  assert.ok(pick);
  assert.equal(pick.incidentId, 2);
  assert.equal(pick.correlationType, "service");

  // Host-only fallback when no service matches.
  const hostOnly = pickCorrelation(
    { service_name: "unknown-svc", host: "web-01" },
    [hostMatch, serviceMatch],
  );
  assert.ok(hostOnly);
  assert.equal(hostOnly.incidentId, 1);
  assert.equal(hostOnly.correlationType, "host");

  // Nothing matches → null.
  assert.equal(
    pickCorrelation({ service_name: "nope", host: "nope" }, [hostMatch]),
    null,
  );
  // No identifying fields → null.
  assert.equal(
    pickCorrelation({ service_name: null, host: null }, [hostMatch]),
    null,
  );
});

test("generateApiKey produces odm_ keys with hash + prefix", () => {
  const { key, keyHash, keyPrefix } = generateApiKey();
  assert.match(key, /^odm_[a-f0-9]{64}$/);
  assert.match(keyHash, /^[a-f0-9]{64}$/);
  assert.equal(keyPrefix, key.slice(0, 8));
  // Keys are unique.
  assert.notEqual(generateApiKey().key, key);
});
