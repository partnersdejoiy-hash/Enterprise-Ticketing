import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

test("relationship graph: BFS depth, permission filtering, no self-loops/duplicates", async () => {
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
    port: 5561,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5561/postgres";
  process.env.NODE_ENV = "test";

  const { pool } = await import("../lib/db/src/index.ts");
  const {
    getTicketGraph,
    createRelationship,
    deleteRelationship,
    suggestRelationships,
    MAX_GRAPH_NODES,
  } = await import("../artifacts/orbitdesk/server/lib/relationship-graph.ts");
  const { getEntityGraph, findSimilar } =
    await import("../artifacts/orbitdesk/server/lib/intelligence-graph.ts");

  // --- Seed ---
  await pool.query("INSERT INTO departments(id,name) VALUES(1,'IT'),(2,'HR')");
  await pool.query(
    `INSERT INTO users(id,name,email,password_hash,role,department_id,is_active) VALUES
     (1,'SA','sa@t','x','super_admin',NULL,true),
     (2,'Agent1','a1@t','x','agent',1,true),
     (3,'Agent2','a2@t','x','agent',2,true),
     (4,'Ext','ex@t','x','external',NULL,true)`,
  );
  const admin = { id: 1, role: "super_admin", departmentId: null };
  const agent1 = { id: 2, role: "agent", departmentId: 1 };
  const agent2 = { id: 3, role: "agent", departmentId: 2 };
  const ext = { id: 4, role: "external", departmentId: null };

  let n = 0;
  async function mkTicket(dept: number, createdBy = 1, subject = "subject") {
    n++;
    const { rows } = await pool.query(
      `INSERT INTO tickets(ticket_number,subject,description,status,department_id,created_by_id)
       VALUES($1,$2,'desc','open',$3,$4) RETURNING id`,
      [`T-${n}`, subject, dept, createdBy],
    );
    return rows[0].id as number;
  }

  // Chain: t1 -rel-> t2 -rel-> t3, plus t4 in HR (different dept)
  const t1 = await mkTicket(1);
  const t2 = await mkTicket(1);
  const t3 = await mkTicket(1);
  const t4 = await mkTicket(2); // HR — agent1 should NOT see it
  const t5 = await mkTicket(1, 4, "my external ticket"); // created by external user

  // --- createRelationship: happy path ---
  const relId = await createRelationship({
    sourceId: t1, targetId: t2, type: "related_to", userId: 1,
  });
  assert.ok(relId > 0, "relationship created");
  await createRelationship({ sourceId: t2, targetId: t3, type: "parent_of", userId: 1 });
  await createRelationship({ sourceId: t1, targetId: t4, type: "related_to", userId: 1 });

  // --- no self-loop ---
  await assert.rejects(
    () => createRelationship({ sourceId: t1, targetId: t1, type: "related_to", userId: 1 }),
    /itself/,
  );

  // --- no duplicates ---
  await assert.rejects(
    () => createRelationship({ sourceId: t1, targetId: t2, type: "related_to", userId: 1 }),
    /already exists/,
  );

  // --- invalid type ---
  await assert.rejects(
    () => createRelationship({ sourceId: t1, targetId: t2, type: "bogus", userId: 1 }),
    /Invalid relationship type/,
  );

  // --- BFS depth limit ---
  const g1 = await getTicketGraph(t1, admin, 1);
  const ids1 = new Set(g1.nodes.map((x) => x.id));
  assert.ok(ids1.has(`ticket:${t1}`), "root present at depth 1");
  assert.ok(ids1.has(`ticket:${t2}`), "t2 (1 hop) present at depth 1");
  assert.ok(ids1.has(`ticket:${t4}`), "t4 (1 hop) present at depth 1");
  assert.ok(!ids1.has(`ticket:${t3}`), "t3 (2 hops) NOT present at depth 1");

  const g2 = await getTicketGraph(t1, admin, 2);
  const ids2 = new Set(g2.nodes.map((x) => x.id));
  assert.ok(ids2.has(`ticket:${t3}`), "t3 reachable at depth 2");
  assert.ok(g2.edges.some((e) => e.type === "parent_of"), "edge type preserved");

  // --- permission filtering: agent1 (IT) must not see HR ticket t4 ---
  const gAgent = await getTicketGraph(t1, agent1, 2);
  const idsA = new Set(gAgent.nodes.map((x) => x.id));
  assert.ok(!idsA.has(`ticket:${t4}`), "IT agent cannot see HR ticket in graph");
  assert.ok(idsA.has(`ticket:${t2}`), "IT agent sees own-dept ticket");

  // --- permission filtering: external user sees only own ticket ---
  const gExt = await getTicketGraph(t5, ext, 2);
  const idsE = new Set(gExt.nodes.map((x) => x.id));
  assert.ok(idsE.has(`ticket:${t5}`), "external sees own ticket");
  await assert.rejects(() => getTicketGraph(t1, ext, 1), /not found/i);

  // --- no circular rendering: diamond t1->t2->t3 and t1->t4 doesn't loop ---
  assert.ok(g2.nodes.length <= MAX_GRAPH_NODES, "node cap respected");
  const nodeIds = g2.nodes.map((x) => x.id);
  assert.equal(new Set(nodeIds).size, nodeIds.length, "no duplicate nodes");

  // --- deleteRelationship ---
  assert.equal(await deleteRelationship(relId), true);
  assert.equal(await deleteRelationship(999999), false);

  // --- suggestRelationships: triage duplicate_of ---
  await pool.query(
    `INSERT INTO ai_triage_results(ticket_id, duplicate_of_ticket_id, confidence)
     VALUES($1, $2, 88)`,
    [t1, t2],
  );
  const sugg = await suggestRelationships(t1, admin);
  assert.ok(
    sugg.some((s) => s.ticketId === t2 && s.type === "duplicate_of"),
    "triage duplicate suggestion returned",
  );

  // --- intelligence graph (#16): ticket → dept/user traversal ---
  const ig = await getEntityGraph("ticket", t1, admin, 1);
  assert.ok(ig.nodes.some((x) => x.type === "department"), "department node traversed");
  assert.ok(ig.nodes.some((x) => x.type === "user"), "user node traversed");
  assert.ok(ig.edges.length > 0, "edges present");

  // --- intelligence graph: invalid entity ---
  await assert.rejects(() => getEntityGraph("ticket", 999999, admin, 1), /not found/i);

  // --- findSimilar: same-dept tickets rank higher; IT agent can't see HR ticket ---
  const similar = await findSimilar("ticket", t1, agent1, 8);
  assert.ok(similar.some((s) => s.entityId === t2), "t2 found as similar");
  assert.ok(!similar.some((s) => s.entityId === t4), "cross-dept HR ticket excluded for IT agent");

  await socket.stop();
});
