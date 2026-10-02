import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// Redirect `nodemailer` to a stub before the app is imported, so no real
// SMTP connection is ever attempted in this test file's process.
register("./email-stub-hooks.mjs", import.meta.url);
(globalThis as any).__testSentEmails = [];
const sentEmails = (): any[] => (globalThis as any).__testSentEmails;

test("send email as AI agent: per-agent from addresses", async () => {
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
    port: 5557,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5557/postgres";
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "test-key";
  const { pool } = await import("../lib/db/src/index.ts");
  const { hashPassword } =
    await import("../artifacts/orbitdesk/server/lib/security.ts");
  const { getAgentFromAddress } =
    await import("../artifacts/orbitdesk/server/lib/emailService.ts");
  const { default: app } = await import("../artifacts/orbitdesk/server/app.ts");
  const { ensureAiWorkers } =
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
  await pool.query("UPDATE orbit_ai_workers SET name='Mew' WHERE kind='pa'");
  await pool.query(
    "UPDATE orbit_ai_workers SET name=CASE kind WHEN 'triage' THEN 'Buzz' WHEN 'draft' THEN 'Rocky' END WHERE department_id=1",
  );
  await writeJsonSetting("ai_workforce_v1", {
    ...aiDefaults,
    enabled: true,
    provider: "openrouter",
    model: "qwen/qwen3.8-27b:free",
    dailyLimit: 40,
  });

  // From-address format: slug = lowercase, non-alphanumeric stripped.
  assert.deepEqual(getAgentFromAddress("Mew"), {
    email: "agent-mew@dejoiy.com",
    name: "Mew · OrbitDesk AI",
  });
  assert.equal(
    getAgentFromAddress("Dark Volt").email,
    "agent-darkvolt@dejoiy.com",
  );
  assert.equal(getAgentFromAddress("BUZZ").email, "agent-buzz@dejoiy.com");
  assert.equal(getAgentFromAddress("R2-D2!").email, "agent-r2d2@dejoiy.com");
  assert.equal(getAgentFromAddress("").email, "agent-agent@dejoiy.com");

  // Endpoint requires auth.
  assert.equal(
    (
      await request("/ai/chat/threads/1/email", "POST", {
        to: "a@b.com",
        subject: "s",
        body: "b",
      })
    ).status,
    401,
  );

  // Direct 1:1 thread with Buzz for the agent user.
  let r = await request("/ai/chat/roster", "GET", undefined, agent);
  const roster = (await r.json()).bots;
  const buzz = roster.find((b: any) => b.name === "Buzz");
  const rocky = roster.find((b: any) => b.name === "Rocky");
  assert.ok(buzz && rocky, "named workers on roster");
  r = await request("/ai/chat/threads", "POST", { workerId: buzz.id }, agent);
  assert.equal(r.status, 200);
  const threadId = (await r.json()).threadId;
  const emailPath = `/ai/chat/threads/${threadId}/email`;
  const valid = {
    to: "client@example.com",
    subject: "Hello",
    body: "Hi there",
  };

  // Thread isolation: another user gets 404.
  assert.equal((await request(emailPath, "POST", valid, sa)).status, 404);

  // Huddle threads are rejected.
  r = await request(
    "/ai/chat/threads",
    "POST",
    { workerIds: [buzz.id, rocky.id], topic: "Discuss email" },
    agent,
  );
  assert.equal(r.status, 200);
  const huddleId = (await r.json()).threadId;
  r = await request(`/ai/chat/threads/${huddleId}/email`, "POST", valid, agent);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /1:1/i);

  // Input validation.
  const bad = [
    { ...valid, to: "not-an-email" },
    { ...valid, to: "" },
    { ...valid, to: "a@b@c@d.com" },
    { ...valid, subject: "" },
    { ...valid, subject: "   " },
    { ...valid, subject: "x".repeat(201) },
    { ...valid, body: "" },
    { ...valid, body: "   \n  " },
    { ...valid, body: "x".repeat(20001) },
  ];
  for (const b of bad) {
    r = await request(emailPath, "POST", b, agent);
    assert.equal(
      r.status,
      400,
      `expected 400 for ${JSON.stringify(b).slice(0, 60)}`,
    );
  }

  // Email not configured -> 503 with the exact message.
  r = await request(emailPath, "POST", valid, agent);
  assert.equal(r.status, 503);
  assert.equal(
    (await r.json()).error,
    "Email is not configured yet. Connect an SMTP account in Settings → Email Accounts.",
  );
  assert.equal(sentEmails().length, 0, "nothing sent while unconfigured");

  // Configure email (SMTP settings only; delivery is stubbed).
  await pool.query(
    `INSERT INTO system_settings(key,value) VALUES
      ('email_enabled','true'),('smtp_host','127.0.0.1'),('smtp_port','2525')
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
  );

  // Success: per-agent from override + confirmation bot message.
  r = await request(emailPath, "POST", valid, agent);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.equal(sentEmails().length, 1);
  const sent = sentEmails()[0];
  assert.equal(sent.to, "client@example.com");
  assert.equal(sent.subject, "Hello");
  assert.equal(sent.from, '"Buzz · OrbitDesk AI" <agent-buzz@dejoiy.com>');
  assert.equal(sent.replyTo, '"Buzz · OrbitDesk AI" <agent-buzz@dejoiy.com>');
  r = await request(`/ai/chat/threads/${threadId}`, "GET", undefined, agent);
  const msgs = (await r.json()).messages;
  const last = msgs[msgs.length - 1];
  assert.equal(last.sender, "bot");
  assert.equal(last.worker_id, buzz.id);
  assert.equal(last.content, 'Email sent to client@example.com — "Hello"');

  // Body is escaped to safe HTML with line breaks preserved.
  r = await request(
    emailPath,
    "POST",
    { to: "x@y.com", subject: "esc", body: "<b>hi</b>\nbye & bye" },
    agent,
  );
  assert.equal(r.status, 200);
  const sent2 = sentEmails()[sentEmails().length - 1];
  assert.equal(sent2.html, "&lt;b&gt;hi&lt;/b&gt;<br>bye &amp; bye");

  server.close();
  await socket.stop();
  await pool.end();
});
