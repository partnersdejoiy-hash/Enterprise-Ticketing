import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { classifyTeam } from "../artifacts/orbitdesk/server/lib/team-classifier.ts";

test("local classifier routes clear issues and abstains on ambiguity", () => {
  const teams = [
    { id: 1, name: "IT" },
    { id: 2, name: "HR" },
    { id: 3, name: "Background Verification" },
    { id: 4, name: "Employment Verification" },
    { id: 5, name: "Payroll & Benefits" },
  ];
  assert.equal(
    classifyTeam("Laptop wifi network is broken", teams).departmentId,
    1,
  );
  assert.equal(
    classifyTeam("Employment verification tenure letter", teams).departmentId,
    4,
  );
  assert.equal(
    classifyTeam("BGV background criminal screening", teams).departmentId,
    3,
  );
  assert.equal(
    classifyTeam("Salary payslip payroll deduction", teams).departmentId,
    5,
  );
  assert.equal(classifyTeam("Help please", teams).departmentId, null);
  assert.equal(classifyTeam("password salary", teams).departmentId, null);
});

test("saved preferences, routing authorization and real event automation", async () => {
  const pg = await PGlite.create();
  for (const f of [
    "000_initial_schema.sql",
    "001_secure_intake.sql",
    "002_hierarchy.sql",
  ])
    await pg.exec(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  const socket = new PGLiteSocketServer({
    db: pg,
    port: 5553,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5553/postgres";
  process.env.NODE_ENV = "test";
  const { pool } = await import("../lib/db/src/index.ts");
  const { hashPassword } =
    await import("../artifacts/orbitdesk/server/lib/security.ts");
  const { default: app } = await import("../artifacts/orbitdesk/server/app.ts");
  const { runAutomations, validateRule, ruleMatches } =
    await import("../artifacts/orbitdesk/server/lib/automation.ts");
  const { automationPresets, ensureAutomationPresets } =
    await import("../artifacts/orbitdesk/server/lib/automation-presets.ts");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.APP_ORIGIN = origin;
  const password = randomBytes(20).toString("hex");
  const hash = await hashPassword(password);
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
  ) =>
    fetch(origin + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const login = async (id: number) => {
    const r = await request("/auth/login", "POST", {
      email: `u${id}@example.test`,
      password,
    });
    assert.equal(r.status, 200);
    return r.headers.get("set-cookie")!.split(";")[0];
  };
  try {
    await pool.query(
      "INSERT INTO departments(id,name) VALUES(1,'IT'),(2,'Background Verification'),(3,'Employment Verification')",
    );
    for (const [id, role, dept, active] of [
      [1, "super_admin", null, true],
      [2, "agent", 1, true],
      [3, "agent", 1, true],
      [4, "employee", 1, true],
      [5, "agent", 1, false],
      [6, "manager", 2, true],
    ] as const)
      await pool.query(
        "INSERT INTO users(id,name,email,password_hash,role,department_id,is_active,must_change_password) VALUES($1,$2,$3,$4,$5,$6,$7,false)",
        [
          id,
          `Synthetic ${id}`,
          `u${id}@example.test`,
          hash,
          role,
          dept,
          active,
        ],
      );
    const admin = await login(1),
      employee = await login(4);
    assert.equal((await request("/settings/workspace/me")).status, 401);
    assert.equal(
      (await request("/settings/workspace/routing", "GET", undefined, employee))
        .status,
      403,
    );
    const prefs = {
      assigned: false,
      updates: false,
      comments: false,
      sla: true,
      digest: false,
    };
    assert.equal(
      (
        await request(
          "/settings/workspace/me",
          "PUT",
          { notifications: prefs },
          employee,
        )
      ).status,
      200,
    );
    assert.deepEqual(
      (
        await (
          await request("/settings/workspace/me", "GET", undefined, employee)
        ).json()
      ).notifications,
      prefs,
    );
    assert.equal(
      (
        await (
          await request("/settings/workspace/me", "GET", undefined, admin)
        ).json()
      ).notifications.assigned,
      true,
    );
    assert.equal(
      (
        await request(
          "/settings/workspace/me",
          "PUT",
          { name: "Updated Employee" },
          employee,
        )
      ).status,
      200,
    );
    const own = await (
      await request("/settings/workspace/me", "GET", undefined, employee)
    ).json();
    assert.equal(own.name, "Updated Employee");
    assert.deepEqual(own.notifications, prefs);
    assert.equal(
      (
        await request(
          "/settings/workspace/me",
          "PUT",
          { notifications: { ...prefs, digest: true } },
          employee,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/settings/workspace/routing",
          "PUT",
          {
            autoAssign: true,
            automationEnabled: true,
            bgvDepartmentId: 999,
            employmentDepartmentId: null,
          },
          admin,
        )
      ).status,
      400,
    );
    const routing = {
      autoAssign: true,
      automationEnabled: true,
      bgvDepartmentId: 2,
      employmentDepartmentId: 3,
    };
    assert.equal(
      (await request("/settings/workspace/routing", "PUT", routing, employee))
        .status,
      403,
    );
    assert.equal(
      (await request("/settings/workspace/routing", "PUT", routing, admin))
        .status,
      200,
    );
    assert.deepEqual(
      await (
        await request("/settings/workspace/routing", "GET", undefined, admin)
      ).json(),
      routing,
    );
    await ensureAutomationPresets();
    await ensureAutomationPresets();
    assert.equal(
      Number(
        (await pool.query("SELECT count(*) FROM automation_rules")).rows[0]
          .count,
      ),
      automationPresets.length,
    );
    for (const r of automationPresets) assert.equal(validateRule(r), null);
    assert.ok(
      validateRule({
        ...automationPresets[0],
        actions: [{ type: "add_tag", value: "business-website" }],
      }),
    );
    assert.ok(
      validateRule({
        ...automationPresets[0],
        actions: [{ type: "assign_department", value: "HR" }],
      }),
    );
    assert.ok(
      validateRule({
        ...automationPresets[0],
        conditions: [
          { field: "subject", operator: "matches_regex", value: "(a+)+" },
        ],
      }),
    );
    assert.equal(
      ruleMatches(
        {
          ...automationPresets[0],
          conditions: [
            { field: "from_email", operator: "not_equals", value: "x" },
          ],
        } as any,
        {},
      ),
      false,
    );
    async function ticket(dept: number | null = 1, tags: string[] = []) {
      return (
        await pool.query(
          "INSERT INTO tickets(ticket_number,subject,description,created_by_id,department_id,tags) VALUES($1,'Synthetic request','Testing only',1,$2,$3) RETURNING id",
          ["TEST-" + randomBytes(8).toString("hex"), dept, tags],
        )
      ).rows[0].id as number;
    }
    const a = await ticket();
    await runAutomations(a, ["ticket_created"]);
    assert.equal(
      (
        await pool.query("SELECT assignee_id,status FROM tickets WHERE id=$1", [
          a,
        ])
      ).rows[0].assignee_id,
      2,
    );
    const b = await ticket();
    await runAutomations(b, ["ticket_created"]);
    assert.equal(
      (await pool.query("SELECT assignee_id FROM tickets WHERE id=$1", [b]))
        .rows[0].assignee_id,
      3,
    );
    const auditBefore = Number(
      (
        await pool.query(
          "SELECT count(*) FROM ticket_history WHERE ticket_id=$1",
          [a],
        )
      ).rows[0].count,
    );
    await runAutomations(a, ["ticket_created"]);
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM ticket_history WHERE ticket_id=$1",
            [a],
          )
        ).rows[0].count,
      ),
      auditBefore,
    );
    const bgv = await ticket(2, ["bgv-request"]);
    await runAutomations(bgv, ["ticket_created"]);
    const bgvRow = (
      await pool.query("SELECT * FROM tickets WHERE id=$1", [bgv])
    ).rows[0];
    assert.equal(bgvRow.assignee_id, 6);
    assert.ok(bgvRow.tags.includes("verification-review"));
    assert.ok(bgvRow.tags.includes("bgv-request"));
    const noAgent = await ticket(3);
    await runAutomations(noAgent, ["ticket_created"]);
    assert.equal(
      (
        await pool.query("SELECT assignee_id FROM tickets WHERE id=$1", [
          noAgent,
        ])
      ).rows[0].assignee_id,
      null,
    );
    const unrouted = await ticket(null);
    await runAutomations(unrouted, ["ticket_created"]);
    assert.ok(
      (
        await pool.query("SELECT tags FROM tickets WHERE id=$1", [unrouted])
      ).rows[0].tags.includes("routing-needed"),
    );
    await pool.query(
      "UPDATE tickets SET status='waiting',sla_deadline=now()-interval '1 hour' WHERE id=$1",
      [a],
    );
    await runAutomations(a, ["ticket_updated"]);
    let row = (await pool.query("SELECT * FROM tickets WHERE id=$1", [a]))
      .rows[0];
    assert.equal(row.priority, "high");
    assert.ok(row.tags.includes("sla-review"));
    assert.ok(row.tags.includes("awaiting-information"));
    await pool.query(
      "UPDATE tickets SET status='in_progress',priority='urgent' WHERE id=$1",
      [a],
    );
    await runAutomations(a, ["ticket_updated"]);
    row = (await pool.query("SELECT * FROM tickets WHERE id=$1", [a])).rows[0];
    assert.equal(row.priority, "urgent");
    assert.ok(!row.tags.includes("awaiting-information"));
    await request(
      "/settings/workspace/routing",
      "PUT",
      { ...routing, autoAssign: false, automationEnabled: false },
      admin,
    );
    const disabled = await ticket();
    await runAutomations(disabled, ["ticket_created"]);
    assert.equal(
      (
        await pool.query("SELECT assignee_id FROM tickets WHERE id=$1", [
          disabled,
        ])
      ).rows[0].assignee_id,
      null,
    );
    await request("/settings/workspace/routing", "PUT", routing, admin);
    await pool.query("UPDATE tickets SET status='closed' WHERE id=$1", [
      disabled,
    ]);
    await runAutomations(disabled, ["ticket_updated"]);
    assert.equal(
      (
        await pool.query("SELECT assignee_id FROM tickets WHERE id=$1", [
          disabled,
        ])
      ).rows[0].assignee_id,
      null,
    );
    const suggested = await request(
      "/assistant/team-suggestion",
      "POST",
      { text: "Laptop wifi network not working" },
      employee,
    );
    assert.equal(suggested.status, 200);
    assert.equal((await suggested.json()).departmentId, 1);
    assert.equal(
      (
        await request("/assistant/team-suggestion", "POST", {
          text: "Laptop wifi",
        })
      ).status,
      401,
    );
    const created = await request(
      "/tickets",
      "POST",
      {
        subject: "Laptop wifi network failure",
        description: "Synthetic connection issue",
        priority: "medium",
        tags: [],
      },
      employee,
    );
    assert.equal(created.status, 201, await created.clone().text());
    assert.equal((await created.json()).departmentId, 1);
    await pool.query("DELETE FROM automation_rules WHERE name=$1", [
      automationPresets[0].name,
    ]);
    await ensureAutomationPresets();
    assert.equal(
      Number(
        (await pool.query("SELECT count(*) FROM automation_rules")).rows[0]
          .count,
      ),
      automationPresets.length - 1,
    );
    console.log(
      "Preferences persist and isolate; dedicated routing, workload fairness, inactive-user exclusion, event rules, safe abstention and preset lifecycle verified.",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
    await socket.stop();
    await pg.close();
  }
});
