/**
 * Superpowers #18/#19/#20 — duplicate detection, next-best-action, triage.
 *
 * - keywordSimilarity: pure-function unit tests
 * - computeDuplicateCandidates / ensureProposedDuplicates: real PGlite DB
 * - getNextBestAction: rule engine against real DB rows
 * - triageTicket: fail-closed permission tests (no AI call — denial happens
 *   before completeAi is ever invoked)
 * - overrideTriage: storage + human-decision recording
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

test("triage intelligence: similarity, candidates, next-action rules, override", async () => {
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
    port: 5565,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5565/postgres";
  process.env.NODE_ENV = "test";

  const { pool } = await import("../lib/db/src/index.ts");
  const {
    keywordSimilarity,
    computeDuplicateCandidates,
    ensureProposedDuplicates,
    getDuplicateRelationships,
    triageTicket,
    overrideTriage,
    getLatestTriage,
  } = await import("../artifacts/orbitdesk/server/lib/triage.ts");
  const { getNextBestAction } = await import(
    "../artifacts/orbitdesk/server/lib/next-action.ts"
  );

  // --- keywordSimilarity unit tests ---
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3),
    );
  assert.equal(keywordSimilarity(tok("vpn not working"), tok("vpn not working")), 1);
  assert.equal(keywordSimilarity(tok("vpn broken"), tok("printer jammed")), 0);
  assert.equal(keywordSimilarity(new Set(), tok("something")), 0);
  const partial = keywordSimilarity(
    tok("vpn connection timeout office"),
    tok("vpn connection reset home"),
  );
  assert.ok(partial > 0 && partial < 1, "partial overlap scores between 0 and 1");

  // --- Seed ---
  await pool.query(
    `INSERT INTO departments(id,name) VALUES(1,'IT'),(2,'HR')`,
  );
  await pool.query(
    `INSERT INTO users(id,name,email,password_hash,role,department_id,is_active) VALUES
     (1,'SA','sa@t','x','super_admin',NULL,true),
     (2,'Agent','ag@t','x','agent',1,true),
     (3,'Ext','ex@t','x','external',NULL,true)`,
  );
  let n = 0;
  async function mkTicket(
    subject: string,
    opts: {
      dept?: number;
      createdBy?: number;
      status?: string;
      assignee?: number | null;
      priority?: string;
    } = {},
  ) {
    n++;
    const { rows } = await pool.query(
      `INSERT INTO tickets(ticket_number,subject,description,status,priority,department_id,created_by_id,assignee_id)
       VALUES($1,$2,'vpn connection drops every hour in the branch office',
              $3,$4,$5,$6,$7) RETURNING id`,
      [
        `T-${n}`,
        subject,
        opts.status ?? "open",
        opts.priority ?? "medium",
        opts.dept ?? 1,
        opts.createdBy ?? 1,
        opts.assignee ?? null,
      ],
    );
    return rows[0].id as number;
  }

  const t1 = await mkTicket("VPN keeps disconnecting");
  const t2 = await mkTicket("VPN keeps disconnecting for me too");
  const t3 = await mkTicket("Printer jammed on floor 3", { dept: 2 });
  const tExt = await mkTicket("My laptop screen flickers", { createdBy: 3 });

  // --- Duplicate candidates: similar subjects match, unrelated don't ---
  const cands = await computeDuplicateCandidates(t1);
  const candIds = cands.map((c) => c.ticketId);
  assert.ok(candIds.includes(t2), "similar ticket detected as candidate");
  assert.ok(!candIds.includes(t3), "unrelated ticket not a candidate");
  assert.ok(!candIds.includes(t1), "ticket never matches itself");
  assert.ok(
    cands.every((c) => c.similarity >= 20 && c.similarity <= 100),
    "scores within 20-100",
  );
  const t2cand = cands.find((c) => c.ticketId === t2)!;
  assert.ok(t2cand.similarity > 40, "near-identical subjects score high");

  // --- ensureProposedDuplicates: persists + idempotent ---
  await ensureProposedDuplicates(t1);
  await ensureProposedDuplicates(t1); // second run must not duplicate
  let rels = await getDuplicateRelationships(t1);
  assert.equal(rels.length, 1, "one proposed relationship");
  assert.equal(rels[0].relationshipStatus, "proposed");
  assert.equal(rels[0].ticketId, t2);
  const { rows: relCount } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ticket_relationships
     WHERE source_ticket_id=$1 AND relationship_type='duplicate_of'`,
    [t1],
  );
  assert.equal(relCount[0].c, 1, "idempotent under re-run");

  // --- Next-best-action rules ---
  // 1. Proposed duplicate wins.
  let na = await getNextBestAction(t1);
  assert.equal(na.action, "review_duplicate");
  assert.ok(na.confidence >= 80);
  assert.ok(na.evidence.some((e) => e.fact === "proposed_duplicates"));

  // Clear the proposal for the remaining rule tests.
  await pool.query(`DELETE FROM ticket_relationships WHERE source_ticket_id=$1`, [t1]);

  // 2. Unassigned -> assign_agent.
  na = await getNextBestAction(t1);
  assert.equal(na.action, "assign_agent", "unassigned ticket");

  // 3. Waiting > 18h -> send_followup.
  await pool.query(
    `UPDATE tickets SET status='waiting', assignee_id=2,
       updated_at = now() - interval '20 hours' WHERE id=$1`,
    [t1],
  );
  na = await getNextBestAction(t1);
  assert.equal(na.action, "send_followup");

  // 4. SLA breached -> escalate.
  await pool.query(
    `UPDATE tickets SET status='in_progress',
       sla_deadline = now() - interval '1 hour' WHERE id=$1`,
    [t1],
  );
  na = await getNextBestAction(t1);
  assert.equal(na.action, "escalate");
  assert.ok(na.evidence.some((e) => e.fact === "sla_status"));

  // 5. SLA within 2h -> escalate.
  await pool.query(
    `UPDATE tickets SET sla_deadline = now() + interval '30 minutes' WHERE id=$1`,
    [t1],
  );
  na = await getNextBestAction(t1);
  assert.equal(na.action, "escalate");
  assert.ok(na.evidence.some((e) => e.fact === "sla_minutes_remaining"));

  // 6. Gone quiet (>24h, no other trigger) -> post_update.
  await pool.query(
    `UPDATE tickets SET sla_deadline=NULL, updated_at = now() - interval '30 hours'
     WHERE id=$1`,
    [t1],
  );
  na = await getNextBestAction(t1);
  assert.equal(na.action, "post_update");

  // 7. Healthy ticket -> none.
  await pool.query(`UPDATE tickets SET updated_at = now() WHERE id=$1`, [t1]);
  na = await getNextBestAction(t1);
  assert.equal(na.action, "none");

  // Recommendation persisted for non-none actions.
  await pool.query(`UPDATE tickets SET assignee_id=NULL WHERE id=$1`, [t1]);
  na = await getNextBestAction(t1);
  assert.equal(na.action, "assign_agent");
  assert.ok(na.recommendationId, "recommendation stored");
  const { rows: recRows } = await pool.query(
    `SELECT kind,status FROM ai_recommendations WHERE id=$1`,
    [na.recommendationId],
  );
  assert.equal(recRows[0].kind, "next_action");
  assert.equal(recRows[0].status, "pending");

  // --- triageTicket fail-closed (no AI invoked) ---
  await assert.rejects(
    () => triageTicket(t1, null),
    /permission check failed/,
    "anonymous triage denied",
  );
  await assert.rejects(
    () => triageTicket(t1, 3),
    /permission check failed/,
    "external user cannot triage another's ticket",
  );
  await assert.rejects(
    () => triageTicket(999999, 1),
    /Ticket not found/,
    "missing ticket errors cleanly",
  );

  // --- overrideTriage: storage + human decision ---
  const { rows: ins } = await pool.query(
    `INSERT INTO ai_triage_results
       (ticket_id,intent,category,priority_recommendation,confidence)
     VALUES ($1,'reset vpn','network','high',72) RETURNING id`,
    [t1],
  );
  const triageId = ins[0].id as number;
  const overridden = await overrideTriage(
    triageId,
    2,
    {
      priority_recommendation: "urgent",
      category: "network",
      bogus_field: "ignored",
      department_id: "not-a-number",
    },
    "customer is the CEO",
  );
  assert.equal(overridden.overridden, true);
  assert.equal(overridden.priorityRecommendation, "urgent");
  assert.equal(overridden.category, "network");
  assert.equal(overridden.departmentId, null, "invalid dept coerced to null");
  const note = JSON.parse(overridden.overrideNote!);
  assert.equal(note.corrected_by, 2);
  assert.equal(note.note, "customer is the CEO");

  const latest = await getLatestTriage(t1);
  assert.equal(latest!.id, triageId, "latest triage retrievable");

  await assert.rejects(
    () => overrideTriage(999999, 2, { category: "x" }),
    /not found/,
    "override of missing triage errors",
  );

  await socket.stop();
  await pg.close();
});
