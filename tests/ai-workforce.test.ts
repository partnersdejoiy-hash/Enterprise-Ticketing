import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
test("AI workforce: access, persistence, private context, jobs, cancellation and caps", async () => {
  const pg = await PGlite.create();
  for (const f of [
    "000_initial_schema.sql",
    "001_secure_intake.sql",
    "002_hierarchy.sql",
    "003_ai_workforce.sql",
  ])
    await pg.exec(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
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
  const { pool } = await import("../lib/db/src/index.ts");
  const { hashPassword } =
    await import("../artifacts/orbitdesk/server/lib/security.ts");
  const { default: app } = await import("../artifacts/orbitdesk/server/app.ts");
  const { ensureAiWorkers, enqueueAiTicket, processAiJobs, workflowContext } =
    await import("../artifacts/orbitdesk/server/lib/ai-workforce.ts");
  const { writeJsonSetting } =
    await import("../artifacts/orbitdesk/server/lib/workspace-settings.ts");
  const { aiDefaults, completeAi } =
    await import("../artifacts/orbitdesk/server/lib/ai-provider.ts");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.APP_ORIGIN = origin;
  const realFetch = globalThis.fetch;
  let calls: any[] = [];
  let intercept: (() => Promise<void>) | undefined;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://openrouter.ai/")) {
      calls.push(JSON.parse(String(init?.body)));
      if (intercept) await intercept();
      return new Response(
        JSON.stringify({
          model: "test-open-model:free",
          choices: [
            { message: { content: "Synthetic draft for review only" } },
          ],
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
  try {
    await pool.query(
      "INSERT INTO departments(id,name) VALUES(1,'IT'),(2,'Background Verification')",
    );
    for (const [id, role, dept] of [
      [1, "super_admin", null],
      [2, "admin", null],
      [3, "agent", 1],
      [4, "employee", 1],
      [5, "agent", 2],
    ] as const)
      await pool.query(
        "INSERT INTO users(id,name,email,password_hash,role,department_id,must_change_password) VALUES($1,$2,$3,$4,$5,$6,false)",
        [id, `Synthetic ${id}`, `u${id}@example.test`, hash, role, dept],
      );
    async function login(id: number) {
      const r = await request("/auth/login", "POST", {
        email: `u${id}@example.test`,
        password,
      });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie")!.split(";")[0];
    }
    const sa = await login(1),
      admin = await login(2),
      agent = await login(3),
      employee = await login(4),
      other = await login(5);
    assert.equal((await request("/ai/workforce")).status, 401);
    assert.equal(
      (await request("/ai/workforce", "GET", undefined, employee)).status,
      403,
    );
    assert.equal(
      (await request("/ai/config", "PUT", aiDefaults, admin)).status,
      403,
    );
    assert.equal(
      (await request("/ai/pa/report", "POST", {}, admin)).status,
      403,
    );
    await ensureAiWorkers();
    await ensureAiWorkers();
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM orbit_ai_workers")).rows[0]
        .n,
      5,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM users")).rows[0].n,
      5,
      "AI workers are not login users",
    );
    let workforce = await (
      await request("/ai/workforce", "GET", undefined, sa)
    ).json();
    assert.equal(workforce.configured, false);
    const worker = workforce.workers.find(
      (w: any) => w.department_id === 1 && w.kind === "triage",
    );
    assert.equal(
      (
        await request(
          "/ai/workers/" + worker.id,
          "PUT",
          { name: "Chosen by owner", enabled: false },
          sa,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT enabled,name FROM orbit_ai_workers WHERE id=$1",
          [worker.id],
        )
      ).rows[0].name,
      "Chosen by owner",
    );
    assert.equal(
      (await request("/ai/config", "PUT", { ...aiDefaults, enabled: true }, sa))
        .status,
      409,
    );
    assert.equal(
      (
        await request(
          "/ai/config",
          "PUT",
          { ...aiDefaults, model: "paid/model" },
          sa,
        )
      ).status,
      400,
    );
    process.env.OPENROUTER_API_KEY = "synthetic-test-only";
    assert.equal(
      (await request("/ai/test", "POST", aiDefaults, sa)).status,
      200,
    );
    assert.equal(
      (await request("/ai/config", "PUT", { ...aiDefaults, enabled: true }, sa))
        .status,
      200,
    );
    assert.equal(
      (
        await request(
          "/ai/workers/" + worker.id,
          "PUT",
          { name: "Chosen by owner", enabled: true },
          sa,
        )
      ).status,
      200,
    );
    await pool.query(
      "INSERT INTO tickets(id,ticket_number,subject,description,department_id,created_by_id) VALUES(100,'SYNTHETIC-100','SECRET HR NAME','SECRET PASSPORT',1,4)",
    );
    await enqueueAiTicket(100);
    await enqueueAiTicket(100);
    assert.equal(
      (await pool.query("SELECT count(*)::int n FROM orbit_ai_jobs")).rows[0].n,
      2,
    );
    await Promise.all([processAiJobs(100), processAiJobs(100)]);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM orbit_ai_jobs WHERE status='ready'",
        )
      ).rows[0].n,
      2,
    );
    assert.equal(calls.length, 3, "one probe, two deduplicated jobs");
    assert.ok(!JSON.stringify(calls).includes("SECRET"));
    assert.deepEqual(calls[1].provider, {
      max_price: { prompt: 0, completion: 0 },
      allow_fallbacks: false,
    });
    assert.deepEqual(
      Object.keys(
        workflowContext({
          department: "IT",
          status: "open",
          priority: "medium",
          sla_breached: false,
        }),
      ),
      ["department", "status", "priority", "slaBreached"],
    );
    assert.equal(
      (await request("/ai/tickets/100", "GET", undefined, employee)).status,
      404,
      "requester cannot read internal drafts",
    );
    assert.equal(
      (await request("/ai/tickets/100", "GET", undefined, other)).status,
      404,
      "unrelated handler blocked",
    );
    assert.equal(
      (await request("/ai/tickets/100", "GET", undefined, agent)).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/ai/workers/" + worker.id,
          "PUT",
          { name: "Chosen by owner", enabled: false },
          sa,
        )
      ).status,
      200,
    );
    await pool.query("UPDATE tickets SET priority='high' WHERE id=100");
    await enqueueAiTicket(100);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM orbit_ai_jobs WHERE status='queued'",
        )
      ).rows[0].n,
      1,
      "disabled worker does not enqueue",
    );
    intercept = async () => {
      await pool.query(
        "UPDATE orbit_ai_workers SET enabled=false WHERE kind='draft'",
      );
    };
    await processAiJobs(100);
    intercept = undefined;
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM orbit_ai_jobs WHERE status='cancelled'",
        )
      ).rows[0].n,
      1,
      "disabled in-flight output not published",
    );
    await writeJsonSetting("ai_workforce_v1", {
      ...aiDefaults,
      enabled: true,
      dailyLimit: 1,
    });
    await assert.rejects(
      () =>
        completeAi({ ...aiDefaults, dailyLimit: 1 }, "test", "test", "test"),
      /limit reached/,
    );
    assert.ok(
      (await pool.query("SELECT count(*)::int n FROM orbit_ai_audit")).rows[0]
        .n >= 3,
    );
    assert.equal(
      (
        await request(
          "/ai/workers/" + worker.id,
          "PUT",
          { name: "No rights", enabled: true },
          employee,
        )
      ).status,
      403,
    );
    await writeJsonSetting("ai_workforce_v1", aiDefaults);
    assert.equal(
      (await request("/ai/chat", "POST", { text: "Help me" }, employee)).status,
      503,
    );
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OPENROUTER_API_KEY;
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
    await socket.stop();
    await pg.close();
  }
});
