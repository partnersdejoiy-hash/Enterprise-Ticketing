import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

test("Agent Assist (#28) + One-Click Ticket Intelligence (#29)", async () => {
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
    port: 5566,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
process.env.DATABASE_URL=<redacted>
    "postgres://postgres:postgres@127.0.0.1:5566/postgres";
  process.env.NODE_ENV = "test";
process.env.OPENROUTER_API_KEY=<redacted>

  const { pool } = await import("../lib/db/src/index.ts");
  const {
    getTicketSummary,
    getSimilarTickets,
    getRelevantKnowledge,
    draftResponse,
    analyzeTicket,
    extractKeywords,
  } = await import(
    "../artifacts/orbitdesk/server/lib/agent-assist.ts"
  );

  // ---- Mock AI provider: return canned JSON per feature ----
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://openrouter.ai/")) {
      const body = JSON.parse(String(init?.body));
      const system: string = body.messages?.[0]?.content ?? "";
      let content: Record<string, unknown>;
      if (system.includes("Summarize this support ticket")) {
        content = {
          summary: "Customer cannot connect to VPN after the network change.",
          key_points: ["VPN fails with timeout", "Started after network change"],
          confidence: 88,
          sources: [{ type: "ticket", id: "1", title: "VPN timeout" }],
        };
      } else if (system.includes("Draft a professional")) {
        content = {
          draft: "Hello, thank you for reporting the VPN issue. We are investigating.",
          confidence: 82,
          sources: [{ type: "ticket", id: "1", title: "VPN timeout" }],
        };
      } else {
        // ticket_intelligence
        content = {
          intent: "Restore VPN connectivity",
          priority_recommendation: "high",
          priority_reason: "VPN outage blocks remote work",
          possible_root_cause: "Recent network change may have broken VPN routing",
          recommended_next_action: "Check VPN gateway logs and recent change records",
          confidence: 79,
          sources: [{ type: "ticket", id: "2", title: "VPN slow" }],
        };
      }
      return new Response(
        JSON.stringify({
          model: "qwen/qwen3.8-27b:free",
          choices: [{ message: { content: JSON.stringify(content) } }],
        }),
        { status: 200 },
      );
    }
    return realFetch(url, init);
  };

  // ---- Seed ----
  const deptIT = (
    await pool.query(`INSERT INTO departments (name) VALUES ('IT') RETURNING id`)
  ).rows[0].id;
  const deptHR = (
    await pool.query(`INSERT INTO departments (name) VALUES ('HR') RETURNING id`)
  ).rows[0].id;
  const admin = (
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ('Admin','admin@t.test','x','super_admin',$1) RETURNING id`,
      [deptIT],
    )
  ).rows[0].id;
  const agentIT = (
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ('Agent IT','it@t.test','x','agent',$1) RETURNING id`,
      [deptIT],
    )
  ).rows[0].id;
  const agentHR = (
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ('Agent HR','hr@t.test','x','agent',$1) RETURNING id`,
      [deptHR],
    )
  ).rows[0].id;

  const t1 = (
    await pool.query(
      `INSERT INTO tickets (ticket_number, subject, description, priority, department_id, created_by_id)
       VALUES ('T-1','VPN connection timeout after network change',
               'Customer reports VPN client times out since yesterday network maintenance. Error 809.',
               'high',$1,$2) RETURNING id`,
      [deptIT, admin],
    )
  ).rows[0].id;
  // Similar tickets (IT dept)
  await pool.query(
    `INSERT INTO tickets (ticket_number, subject, description, priority, department_id, created_by_id)
     VALUES ('T-2','VPN very slow for remote users','VPN throughput degraded after network change, latency high','medium',$1,$2),
            ('T-3','VPN client error 809 on connect','Users getting error 809 when connecting VPN since maintenance','high',$1,$2)`,
    [deptIT, admin],
  );
  // HR ticket with overlapping keyword "network" — agentIT must NOT see it
  const tHR = (
    await pool.query(
      `INSERT INTO tickets (ticket_number, subject, description, priority, department_id, created_by_id)
       VALUES ('T-HR','Network printer not working in HR','HR network printer offline, needs network check','low',$1,$2) RETURNING id`,
      [deptHR, admin],
    )
  ).rows[0].id;

  // Knowledge articles
  await pool.query(
    `INSERT INTO knowledge_articles (title, content, status, searchable)
     VALUES ('Fixing VPN timeout errors','To fix VPN timeout error 809, check the gateway firewall rules and restart the VPN service. Network changes often require rule updates.','published',true),
            ('VPN client setup guide','Install the VPN client and import the profile.','published',true),
            ('Draft: VPN migration plan','Internal draft, not published.','draft',true)`,
  );

  // ---- 1. extractKeywords: stopwords removed ----
  {
    const kws = extractKeywords("The VPN connection is timing out please help");
    assert.ok(kws.includes("vpn"));
    assert.ok(!kws.includes("the") && !kws.includes("is"));
  }

  // ---- 2. Summary (mocked AI) ----
  {
    const s = await getTicketSummary(t1, admin);
    assert.match(s.summary, /VPN/);
    assert.equal(s.key_points.length, 2);
    assert.equal(s.confidence, 88);
    assert.equal(s.sources[0].type, "ticket");
    const { rows } = await pool.query(
      `SELECT feature, status FROM ai_analyses WHERE entity_id=$1 ORDER BY id DESC LIMIT 1`,
      [String(t1)],
    );
    assert.equal(rows[0].feature, "summarize");
    assert.equal(rows[0].status, "completed");
  }

  // ---- 3. Similar tickets: keyword overlap, access-scoped ----
  {
    const sim = await getSimilarTickets(t1, agentIT);
    assert.ok(sim.length >= 2, "expected at least 2 similar IT tickets");
    assert.ok(sim[0].similarity >= sim[1].similarity, "sorted by similarity desc");
    assert.ok(sim.every((t) => t.similarity > 0));
    // HR ticket must not leak to IT agent
    assert.ok(!sim.some((t) => t.id === tHR), "cross-department ticket leaked");
    // Admin sees everything incl. HR ticket (keyword "network" overlaps)
    const simAdmin = await getSimilarTickets(t1, admin);
    assert.ok(simAdmin.some((t) => t.id === tHR), "admin should see HR ticket");
  }

  // ---- 4. Knowledge search: published only ----
  {
    const kb = await getRelevantKnowledge(t1, agentIT);
    assert.ok(kb.length >= 1);
    assert.ok(kb.length <= 3);
    assert.match(kb[0].title, /VPN/);
    assert.ok(kb[0].excerpt.length > 0);
    assert.ok(!kb.some((k) => k.title.includes("Draft")), "draft article leaked");
  }

  // ---- 5. Draft response (mocked AI) ----
  {
    const d = await draftResponse(t1, agentIT, "friendly");
    assert.match(d.draft, /VPN/i);
    assert.equal(d.confidence, 82);
    const { rows } = await pool.query(
      `SELECT feature FROM ai_analyses WHERE entity_id=$1 ORDER BY id DESC LIMIT 1`,
      [String(t1)],
    );
    assert.equal(rows[0].feature, "draft_response");
  }

  // ---- 6. One-click analyze: unified result ----
  {
    const a = await analyzeTicket(t1, agentIT);
    assert.match(a.summary, /VPN/);
    assert.equal(a.intent, "Restore VPN connectivity");
    assert.equal(a.priority_recommendation, "high");
    assert.ok(a.similar_tickets.length >= 2);
    assert.ok(a.recommended_knowledge.length >= 1);
    assert.match(a.recommended_next_action, /gateway logs/);
    assert.match(a.draft_response, /VPN/i);
    assert.equal(a.confidence, 79);
    assert.ok(a.sla_risk); // sla engine returns a status object
    assert.equal(a.security.highestRisk, "none");
    const { rows } = await pool.query(
      `SELECT feature FROM ai_analyses WHERE entity_id=$1 AND feature='ticket_intelligence'`,
      [String(t1)],
    );
    assert.equal(rows.length, 1, "ticket_intelligence analysis not stored");
  }

  // ---- 7. Permission: HR agent cannot analyze IT ticket? ----
  // (HR agent has no access to IT-department ticket T-1)
  {
    await assert.rejects(
      () => getTicketSummary(t1, agentHR),
      /denied/i,
      "HR agent should be denied access to IT ticket",
    );
  }

  // ---- 8. Security shield flags secrets in ticket ----
  {
    const tSec = (
      await pool.query(
        `INSERT INTO tickets (ticket_number, subject, description, priority, department_id, created_by_id)
         VALUES ('T-SEC','API integration failing','My key is sk-test-abcdef12345678 please help','high',$1,$2) RETURNING id`,
        [deptIT, admin],
      )
    ).rows[0].id;
    const a = await analyzeTicket(tSec, admin);
    assert.ok(
      ["medium", "high", "critical"].includes(a.security.highestRisk),
      "secret in ticket should raise shield risk",
    );
  }

  globalThis.fetch = realFetch;
  await pool.end();
  await socket.stop();
  await pg.close();
});
