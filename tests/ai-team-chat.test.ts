import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

test("AI team chat: roster, direct chat, huddle, unread, proactive bot messages", async () => {
  const pg = await PGlite.create();
  for (const f of [
    "000_initial_schema.sql",
    "001_secure_intake.sql",
    "002_hierarchy.sql",
    "003_ai_workforce.sql",
    "004_ticket_deletion.sql",
    "005_ai_team_chat.sql",
  ])
    await pg.exec(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  const socket = new PGLiteSocketServer({
    db: pg,
    port: 5556,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5556/postgres";
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "test-key";
  const { pool } = await import("../lib/db/src/index.ts");
  const { hashPassword } =
    await import("../artifacts/orbitdesk/server/lib/security.ts");
  const { default: app } = await import("../artifacts/orbitdesk/server/app.ts");
  const { ensureAiWorkers, enqueueAiTicket, processAiJobs } =
    await import("../artifacts/orbitdesk/server/lib/ai-workforce.ts");
  const { writeJsonSetting } =
    await import("../artifacts/orbitdesk/server/lib/workspace-settings.ts");
  const { aiDefaults } =
    await import("../artifacts/orbitdesk/server/lib/ai-provider.ts");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.APP_ORIGIN = origin;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://openrouter.ai/")) {
      return new Response(
        JSON.stringify({
          model: "qwen/qwen3.8-27b:free",
          choices: [{ message: { content: "Synthetic bot reply" } }],
        }),
        { status: 200 },
      );
    }
    return realFetch(url, init);
  };
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
  ) =>
    realFetch(origin + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  const password = randomBytes(20).toString("hex");
  const hash = await hashPassword(password);
  await pool.query("INSERT INTO departments(id,name) VALUES(1,'IT')");
  await pool.query(
    "INSERT INTO users(id,name,email,password_hash,role,department_id,must_change_password) VALUES(1,'SA','sa@example.test',$1,'super_admin',NULL,false),(2,'Agent','ag@example.test',$1,'agent',1,false)",
    [hash],
  );
  async function login(id: number) {
    const r = await request("/auth/login", "POST", {
      email: id === 1 ? "sa@example.test" : "ag@example.test",
      password,
    });
    assert.equal(r.status, 200);
    return r.headers.get("set-cookie")!.split(";")[0];
  }
  const sa = await login(1),
    agent = await login(2);

  await ensureAiWorkers();
  await writeJsonSetting("ai_workforce_v1", {
    ...aiDefaults,
    enabled: true,
    provider: "openrouter",
    model: "qwen/qwen3.8-27b:free",
    dailyLimit: 40,
  });

  // Roster: unauthenticated is rejected, agent sees PA + IT workers.
  assert.equal((await request("/ai/chat/roster")).status, 401);
  let r = await request("/ai/chat/roster", "GET", undefined, agent);
  assert.equal(r.status, 200);
  const roster = (await r.json()).bots;
  const pa = roster.find((b: any) => b.kind === "pa");
  const itBots = roster.filter((b: any) => b.kind !== "pa");
  assert.ok(pa, "PA listed");
  assert.equal(itBots.length, 2, "two IT workers listed");

  // Direct thread: create, chat, unread badge, mark-read.
  r = await request(
    "/ai/chat/threads",
    "POST",
    { workerId: itBots[0].id },
    agent,
  );
  assert.equal(r.status, 200);
  const threadId = (await r.json()).threadId;
  assert.ok(threadId);
  r = await request(
    `/ai/chat/threads/${threadId}/messages`,
    "POST",
    { text: "Hello bot" },
    agent,
  );
  assert.equal(r.status, 200);
  r = await request("/ai/chat/threads", "GET", undefined, agent);
  let threads = (await r.json()).threads;
  let t = threads.find((x: any) => x.id === threadId);
  assert.equal(t.unread, 1, "bot reply shows as unread");
  r = await request(`/ai/chat/threads/${threadId}`, "GET", undefined, agent);
  assert.equal(r.status, 200);
  const msgs = (await r.json()).messages;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].sender, "user");
  assert.equal(msgs[1].sender, "bot");
  assert.equal(msgs[1].content, "Synthetic bot reply");
  r = await request("/ai/chat/threads", "GET", undefined, agent);
  threads = (await r.json()).threads;
  t = threads.find((x: any) => x.id === threadId);
  assert.equal(t.unread, 0, "opening the thread marks it read");

  // Thread isolation: superadmin cannot open the agent's thread.
  assert.equal(
    (await request(`/ai/chat/threads/${threadId}`, "GET", undefined, sa))
      .status,
    404,
  );

  // Huddle: topic + round-robin replies from both bots.
  r = await request(
    "/ai/chat/threads",
    "POST",
    { workerIds: [itBots[0].id, itBots[1].id], topic: "Discuss ticket triage" },
    agent,
  );
  assert.equal(r.status, 200);
  const huddleId = (await r.json()).threadId;
  r = await request(`/ai/chat/threads/${huddleId}`, "GET", undefined, agent);
  const hmsgs = (await r.json()).messages;
  assert.equal(hmsgs.length, 3, "topic + two bot replies");
  assert.equal(hmsgs[0].sender, "user");
  assert.ok(
    hmsgs[1].sender === "bot" && hmsgs[2].sender === "bot",
    "both bots replied",
  );
  assert.notEqual(hmsgs[1].worker_id, hmsgs[2].worker_id);

  // Huddle guards.
  assert.equal(
    (
      await request(
        "/ai/chat/threads",
        "POST",
        { workerIds: [itBots[0].id], topic: "x" },
        agent,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/ai/chat/threads",
        "POST",
        { workerIds: [1, 2, 3, 4, 5, 6, 7], topic: "x" },
        agent,
      )
    ).status,
    400,
  );

  // Proactive messages: job completion notifies the ticket creator's
  // 1:1 thread with the worker, and Mew briefs the superadmin.
  await pool.query(
    "INSERT INTO tickets(id,ticket_number,subject,description,status,priority,department_id,created_by_id) VALUES(1,'DJ-TEST1','subj','desc','open','medium',1,2)",
  );
  await enqueueAiTicket(1);
  const result = await processAiJobs(1);
  assert.ok(result.processed >= 1, "jobs processed");
  const chat = await pool.query(
    `SELECT m.sender,m.content,w.kind AS worker_kind,m.thread_id,t.user_id
     FROM orbit_ai_chat_messages m
     LEFT JOIN orbit_ai_workers w ON w.id=m.worker_id
     JOIN orbit_ai_chat_threads t ON t.id=m.thread_id`,
  );
  assert.ok(
    chat.rows.some(
      (x) =>
        x.sender === "bot" &&
        x.worker_kind !== "pa" &&
        x.user_id === 2 &&
        x.content.includes("DJ-TEST1"),
    ),
    "worker posted a ready-note into the ticket creator's 1:1 thread",
  );
  assert.ok(
    chat.rows.some(
      (x) =>
        x.sender === "bot" &&
        x.worker_kind === "pa" &&
        x.user_id === 1 &&
        x.content.includes("DJ-TEST1"),
    ),
    "Mew briefed the superadmin",
  );

  server.close();
  await socket.stop();
  await pool.end();
});
