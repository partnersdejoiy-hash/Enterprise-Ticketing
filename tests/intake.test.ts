import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHmac, randomUUID, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

test("website intake, durable retries, private evidence and authenticated staff operations", async () => {
  const pg = await PGlite.create();
  await pg.exec(
    await readFile(
      new URL("../migrations/000_initial_schema.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.exec(
    await readFile(
      new URL("../migrations/001_secure_intake.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.exec(
    await readFile(
      new URL("../migrations/002_hierarchy.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const file of [
    "003_ai_workforce.sql",
    "004_ticket_deletion.sql",
    "004_ticket_deletion.sql",
  ])
    await pg.exec(
      await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  await pg.exec(
    "ALTER TABLE users ALTER COLUMN must_change_password SET DEFAULT false",
  );
  const socket = new PGLiteSocketServer({
    db: pg,
    port: 5548,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5548/postgres";
  process.env.NODE_ENV = "test";
  process.env.BUSINESS_SITE_INTAKE_SECRET = randomBytes(32).toString("hex");
  process.env.EMPLOYMENT_VERIFICATION_DEPARTMENT_ID = "1";
  process.env.BGV_DEPARTMENT_ID = "2";
  const { hashPassword } =
    await import("../artifacts/orbitdesk/server/lib/security.ts");
  const { pool } = await import("../lib/db/src/index.ts");
  const { default: app } = await import("../artifacts/orbitdesk/server/app.ts");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const origin = `http://127.0.0.1:${port}`;
  process.env.APP_ORIGIN = origin;
  const password = randomBytes(20).toString("base64url");
  const hash = await hashPassword(password);
  await pool.query(
    "INSERT INTO departments(id,name) VALUES(1,'Human Resources'),(2,'BGV'),(3,'IT')",
  );
  for (const [id, role, dept] of [
    [1, "super_admin", null],
    [2, "agent", 1],
    [3, "agent", 2],
    [4, "employee", 1],
    [5, "agent", null],
    [6, "admin", null],
  ] as const)
    await pool.query(
      "INSERT INTO users(id,name,email,password_hash,role,department_id) VALUES($1,$2,$3,$4,$5,$6)",
      [id, `Test ${role}`, `user${id}@example.test`, hash, role, dept],
    );
  let assertions = 0;
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
    extra: Record<string, string> = {},
  ) {
    return fetch(origin + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function expected(response: Response, status: number) {
    assert.equal(response.status, status, await response.clone().text());
    assertions++;
    return response;
  }
  async function login(id: number) {
    const r = await expected(
      await request("/auth/login", "POST", {
        email: `user${id}@example.test`,
        password,
      }),
      200,
    );
    const cookie = r.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal((await r.json()).token, "cookie-session");
    assertions += 3;
    return cookie.split(";")[0];
  }
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
  ).toString("base64");
  function payload(type = "employment-verification") {
    return {
      requestId: randomUUID(),
      verificationType: type,
      company: "Example Test Co",
      email: "requester@example.test",
      employeeName: "Synthetic Employee",
      employeeId: "TEST-001",
      purpose: "Synthetic verification request for isolated test only.",
      consent: true,
      attachment: { type: "application/pdf", content: pdf },
    };
  }
  async function signed(
    body: any,
    timestamp = String(Date.now()),
    override?: string,
  ) {
    const raw = JSON.stringify(body);
    return request(
      "/integrations/business-site/verification",
      "POST",
      body,
      undefined,
      {
        "X-DEJOIY-Timestamp": timestamp,
        "X-DEJOIY-Signature":
          override ??
          createHmac("sha256", process.env.BUSINESS_SITE_INTAKE_SECRET!)
            .update(timestamp + "." + raw)
            .digest("hex"),
      },
    );
  }
  try {
    await expected(await request("/tickets"), 401);
    await expected(
      await request("/tickets", "GET", undefined, undefined, {
        Authorization: `Bearer ${Buffer.from("1:123:fake").toString("base64url")}`,
      }),
      401,
    );
    const admin = await login(1),
      hr = await login(2),
      bgv = await login(3),
      employee = await login(4),
      unassignedAgent = await login(5),
      limitedAdmin = await login(6);
    const b = payload();
    const first = await (await expected(await signed(b), 201)).json();
    assert.match(first.ticketNumber, /^DJ-EV-/);
    assertions++;
    const repeat = await Promise.all([signed(b), signed(b), signed(b)]);
    for (const r of repeat) {
      assert.equal(
        (await (await expected(r, 200)).json()).ticketNumber,
        first.ticketNumber,
      );
      assertions++;
    }
    const id = (
      await pool.query(
        "SELECT ticket_id FROM orbit_intake_receipts WHERE request_id=$1",
        [b.requestId],
      )
    ).rows[0].ticket_id;
    assert.equal(
      Number((await pool.query("SELECT count(*) FROM tickets")).rows[0].count),
      1,
    );
    assertions++;
    await expected(
      await signed({
        ...b,
        purpose: "Different details on an already recorded reference.",
      }),
      409,
    );
    await expected(await signed(payload(), String(Date.now() - 600001)), 401);
    await expected(await signed(payload(), undefined, "bad"), 401);
    await expected(
      await signed({
        ...payload(),
        attachment: {
          type: "application/pdf",
          content: Buffer.from("not a PDF").toString("base64"),
        },
      }),
      400,
    );
    await expected(await signed({ ...payload(), consent: false }), 400);
    await expected(await signed(payload("unknown")), 400);
    const second = await (
      await expected(await signed(payload("background-verification")), 201)
    ).json();
    assert.match(second.ticketNumber, /^DJ-BGV-/);
    assertions++;
    let list = await (
      await expected(
        await request(
          "/tickets?tags=employment-verification",
          "GET",
          undefined,
          admin,
        ),
        200,
      )
    ).json();
    assert.equal(list.total, 1);
    assert.equal(list.tickets[0].id, id);
    assertions += 2;
    list = await (
      await expected(
        await request("/tickets?tags=bgv-request", "GET", undefined, hr),
        200,
      )
    ).json();
    assert.equal(list.total, 0);
    assertions++;
    for (const cookie of [bgv, employee, unassignedAgent]) {
      await expected(
        await request(`/tickets/${id}`, "GET", undefined, cookie),
        404,
      );
      await expected(
        await request(`/tickets/${id}/comments`, "GET", undefined, cookie),
        404,
      );
      await expected(
        await request(`/tickets/${id}/attachments`, "GET", undefined, cookie),
        404,
      );
    }
    assert.equal(
      (await pool.query("SELECT assignee_id FROM tickets WHERE id=$1", [id]))
        .rows[0].assignee_id,
      2,
    );
    assertions++;
    const attachments = await (
      await expected(
        await request(`/tickets/${id}/attachments`, "GET", undefined, hr),
        200,
      )
    ).json();
    assert.equal(attachments.length, 1);
    assertions++;
    const attachment = attachments[0].id;
    const file = await expected(
      await request(
        `/attachments/${attachment}/download`,
        "GET",
        undefined,
        hr,
      ),
      200,
    );
    assert.equal(await file.text(), Buffer.from(pdf, "base64").toString());
    assert.match(file.headers.get("cache-control")!, /no-store/);
    assertions += 2;
    await expected(
      await request(
        `/attachments/${attachment}/download`,
        "GET",
        undefined,
        bgv,
      ),
      404,
    );
    await expected(
      await request(
        `/tickets/${id}/send-attachments`,
        "POST",
        { recipientEmail: "outside@example.test" },
        admin,
      ),
      403,
    );
    await expected(
      await request(`/tickets/${id}`, "DELETE", undefined, hr),
      403,
    );
    await expected(
      await request(`/tickets/${id}`, "PATCH", { departmentId: 2 }, hr),
      403,
    );
    await expected(
      await request(`/tickets/${id}`, "PATCH", { status: "waiting" }, hr),
      200,
    );
    await expected(
      await request(
        `/tickets/${id}/comments`,
        "POST",
        { content: "Authorisation requires review.", isInternal: true },
        hr,
      ),
      201,
    );
    await expected(
      await request(`/tickets/${id}`, "PATCH", { taggedUserIds: [4] }, admin),
      200,
    );
    const employeeView = await (
      await expected(
        await request(`/tickets/${id}`, "GET", undefined, employee),
        200,
      )
    ).json();
    assert.equal(employeeView.comments.length, 0);
    assertions++;
    const privateFiles = await (
      await expected(
        await request(`/tickets/${id}/attachments`, "GET", undefined, employee),
        200,
      )
    ).json();
    assert.equal(privateFiles.length, 0);
    assertions++;
    await expected(
      await request(
        `/attachments/${attachment}/download`,
        "GET",
        undefined,
        employee,
      ),
      403,
    );
    await expected(
      await request(`/attachments/${attachment}`, "DELETE", undefined, admin),
      409,
    );
    await expected(
      await request(
        "/users",
        "POST",
        {
          name: "bad",
          email: "bad@example.test",
          password,
          role: "super_admin",
        },
        employee,
      ),
      403,
    );
    await expected(
      await request(
        "/users",
        "POST",
        {
          name: "bad",
          email: "bad@example.test",
          password,
          role: "super_admin",
        },
        limitedAdmin,
      ),
      403,
    );
    await expected(
      await request(
        "/users/1",
        "PATCH",
        { newPassword: password + "x" },
        limitedAdmin,
      ),
      403,
    );
    const summary = await (
      await expected(await request("/operations", "GET", undefined, hr), 200)
    ).json();
    assert.equal(summary.summary.total, 1);
    assert.equal(summary.summary.bgv, 0);
    assertions += 2;
    await expected(
      await request("/integrations/business-site", "GET", undefined, employee),
      403,
    );
    const config = await (
      await expected(
        await request("/integrations/business-site", "GET", undefined, admin),
        200,
      )
    ).json();
    assert.equal(config.receipts.length, 2);
    assert.ok(
      !JSON.stringify(config).includes(
        process.env.BUSINESS_SITE_INTAKE_SECRET!,
      ),
    );
    assertions += 2;
    await expected(await request("/cron/imap-poll"), 401);
    await expected(
      await request(`/tickets/${id}`, "PATCH", { status: "resolved" }, hr, {
        Origin: "https://evil.example",
      }),
      403,
    );
    await expected(await request("/auth/logout", "POST", {}, hr), 200);
    await expected(await request("/auth/me", "GET", undefined, hr), 401);
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=3", [
      await hashPassword(password + "new"),
    ]);
    await expected(await request("/auth/me", "GET", undefined, bgv), 401);
    if (process.env.BPO_SITE_ROOT) {
      const { createHandler } = await import(
        pathToFileURL(
          path.resolve(process.env.BPO_SITE_ROOT, "lib/form-handler.mjs"),
        ).href
      );
      const body = { ...payload(), startedAt: Date.now() - 5000, website: "" };
      body.attachment = {
        ...body.attachment,
        filename: "authorization-letter.pdf",
      } as any;
      const env = {
        NODE_ENV: "test",
        ORBITDESK_ENABLED: "true",
        ORBITDESK_URL: origin,
        ORBITDESK_INTAKE_SECRET: process.env.BUSINESS_SITE_INTAKE_SECRET,
        RESEND_API_KEY: "test-only",
        FROM_EMAIL: "sender@example.test",
        VERIFICATION_TO_EMAIL: "hr@example.test",
        BGV_TO_EMAIL: "bgv@example.test",
      };
      let mail: any;
      const handler = createHandler("employee-verification", {
        env,
        rateLimit: () => true,
        send: async (payload: any) => {
          mail = payload;
          return { data: { id: "isolated-mail" } };
        },
      });
      async function invoke(fn: any) {
        let status = 200;
        let result: any;
        const res = {
          setHeader() {},
          status(v: number) {
            status = v;
            return this;
          },
          json(v: any) {
            result = v;
            return this;
          },
        };
        await fn(
          {
            method: "POST",
            headers: {
              origin: "https://business.example.test",
              host: "business.example.test",
              "content-type": "application/json",
            },
            body,
          },
          res,
        );
        assert.equal(status, 200, JSON.stringify(result));
        assertions++;
        return result;
      }
      const response = await invoke(handler);
      assert.match(response.ticketNumber, /^DJ-EV-/);
      assert.ok(!mail.attachments);
      assert.ok(!mail.html.includes(body.employeeName));
      assertions += 3;
      const retry = await invoke(handler);
      assert.equal(retry.ticketNumber, response.ticketNumber);
      assertions++;
      const failedNotice = createHandler("employee-verification", {
        env,
        rateLimit: () => true,
        send: async () => ({ error: { name: "simulated" } }),
      });
      const delayed = await invoke(failedNotice);
      assert.equal(delayed.ticketNumber, response.ticketNumber);
      assert.equal(delayed.notificationAccepted, false);
      assertions += 2;
      console.log(
        "BPO website handler → signed HTTP API → PostgreSQL ticket/file/receipt verified.",
      );
    }
    // Configuration failure rolls back all ticket/file/history writes.
    process.env.BGV_DEPARTMENT_ID = "999999";
    await expected(await signed(payload("background-verification")), 503);
    assert.equal(
      Number((await pool.query("SELECT count(*) FROM tickets")).rows[0].count),
      process.env.BPO_SITE_ROOT ? 3 : 2,
    );
    assertions++;
    // Failure must roll back the entire deletion, including the audit write.
    await pool.query(
      `CREATE FUNCTION block_test_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic delete failure'; END $$`,
    );
    await pool.query(
      "CREATE TRIGGER block_test_delete BEFORE DELETE ON tickets FOR EACH ROW EXECUTE FUNCTION block_test_delete()",
    );
    await expected(
      await request(`/tickets/${id}`, "DELETE", undefined, admin),
      500,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM ticket_attachments WHERE ticket_id=$1",
          [id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM orbit_ticket_deletions WHERE ticket_id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
    await pool.query("DROP TRIGGER block_test_delete ON tickets");
    await expected(
      await request(`/tickets/${id}`, "DELETE", undefined, admin),
      204,
    );
    for (const table of [
      "ticket_comments",
      "ticket_history",
      "ticket_attachments",
      "orbit_ai_jobs",
    ])
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int n FROM ${table} WHERE ticket_id=$1`,
            [id],
          )
        ).rows[0].n,
        0,
      );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM orbit_ticket_deletions WHERE ticket_id=$1",
          [id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT ticket_id FROM orbit_intake_receipts WHERE ticket_number=$1",
          [first.ticketNumber],
        )
      ).rows[0].ticket_id,
      null,
    );
    await expected(await signed(b), 410);
    await expected(
      await request(`/tickets/${id}`, "DELETE", undefined, admin),
      404,
    );
    console.log(
      `${assertions} security, intake and operations assertions passed; no real email sent.`,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
    await socket.stop();
    await pg.close();
  }
});
