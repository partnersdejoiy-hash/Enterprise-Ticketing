import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
test("first login, reporting hierarchy, employee links and IT boundaries", async () => {
  const pg = await PGlite.create();
  for (const name of [
    "000_initial_schema",
    "001_secure_intake",
    "002_hierarchy",
  ])
    await pg.exec(await readFile(`migrations/${name}.sql`, "utf8"));
  const socket = new PGLiteSocketServer({
    db: pg,
    port: 5550,
    host: "127.0.0.1",
    maxConnections: 30,
  });
  await socket.start();
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:5550/postgres";
  process.env.NODE_ENV = "test";
  const { pool } = await import("../lib/db/src/index.ts");
  const { hashPassword } =
    await import("../artifacts/orbitdesk/server/lib/security.ts");
  const { default: app } = await import("../artifacts/orbitdesk/server/app.ts");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.APP_ORIGIN = origin;
  const password = randomBytes(20).toString("base64url");
  const hash = await hashPassword(password);
  let assertions = 0;
  const req = async (
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
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const expect = async (response: Response, status: number) => {
    assert.equal(response.status, status, await response.clone().text());
    assertions++;
    return response;
  };
  const login = async (id: number, p = password) => {
    const r = await expect(
      await req("/auth/login", "POST", {
        email: `person${id}@example.test`,
        password: p,
      }),
      200,
    );
    return {
      cookie: r.headers.get("set-cookie")!.split(";")[0],
      data: await r.json(),
    };
  };
  try {
    await pool.query(
      "INSERT INTO departments(id,name) VALUES(1,'Operations'),(2,'BGV'),(3,'IT'),(4,'Finance')",
    );
    for (const [id, role, dept, manager] of [
      [1, "super_admin", null, null],
      [2, "manager", 1, null],
      [3, "agent", 1, 2],
      [4, "employee", 1, 3],
      [5, "employee", 1, null],
      [6, "agent", 2, null],
      [7, "agent", 3, null],
      [8, "admin", null, null],
      [9, "employee", 2, 6],
    ] as const)
      await pool.query(
        "INSERT INTO users(id,name,email,password_hash,role,department_id,manager_id,must_change_password) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          `Person ${id}`,
          `person${id}@example.test`,
          hash,
          role,
          dept,
          manager,
          id === 4,
        ],
      );
    await pool.query("SELECT setval(pg_get_serial_sequence('users','id'),9)");
    const first = await login(4);
    assert.equal(first.data.user.mustChangePassword, true);
    assertions++;
    await expect(await req("/auth/me", "GET", undefined, first.cookie), 200);
    for (const path of ["/tickets", "/operations", "/directory"])
      await expect(await req(path, "GET", undefined, first.cookie), 428);
    await expect(
      await req(
        "/tickets",
        "POST",
        {
          subject: "Blocked before password change",
          description: "Must not create",
        },
        first.cookie,
      ),
      428,
    );
    await expect(
      await req(
        "/auth/change-password",
        "POST",
        { currentPassword: "wrong", newPassword: password + "new" },
        first.cookie,
      ),
      403,
    );
    await expect(
      await req(
        "/auth/change-password",
        "POST",
        { currentPassword: password, newPassword: password },
        first.cookie,
      ),
      400,
    );
    await expect(
      await req(
        "/auth/change-password",
        "POST",
        { currentPassword: password, newPassword: "short" },
        first.cookie,
      ),
      400,
    );
    const newPassword = randomBytes(24).toString("base64url");
    await expect(
      await req(
        "/auth/change-password",
        "POST",
        { currentPassword: password, newPassword: newPassword },
        first.cookie,
      ),
      200,
    );
    await expect(await req("/auth/me", "GET", undefined, first.cookie), 401);
    await expect(
      await req("/auth/login", "POST", {
        email: "person4@example.test",
        password,
      }),
      401,
    );
    const employee = (await login(4, newPassword)).cookie;
    const admin = (await login(1)).cookie;
    const manager = (await login(2)).cookie;
    const supervisor = (await login(3)).cookie;
    const peer = (await login(5)).cookie;
    const bgv = (await login(6)).cookie;
    const it = (await login(7)).cookie;
    const limitedAdmin = (await login(8)).cookie;
    const created = await (
      await expect(
        await req(
          "/tickets",
          "POST",
          {
            subject: "Payroll question",
            description: "Synthetic team ticket",
            departmentId: 4,
          },
          employee,
        ),
        201,
      )
    ).json();
    for (const cookie of [employee, admin, manager, supervisor, limitedAdmin])
      await expect(
        await req(`/tickets/${created.id}`, "GET", undefined, cookie),
        200,
      );
    for (const cookie of [peer, bgv, it])
      await expect(
        await req(`/tickets/${created.id}`, "GET", undefined, cookie),
        404,
      );
    await expect(
      await req(
        `/tickets/${created.id}`,
        "PATCH",
        { status: "closed" },
        supervisor,
      ),
      403,
    );
    await expect(
      await req(
        `/tickets/${created.id}/comments`,
        "POST",
        { content: "Team follow-up" },
        manager,
      ),
      201,
    );
    await expect(
      await req(
        `/tickets/${created.id}/comments`,
        "POST",
        { content: "Internal secret", isInternal: true },
        manager,
      ),
      400,
    );
    const linked = await (
      await expect(
        await req(
          "/tickets",
          "POST",
          {
            subject: "For an operations colleague",
            description: "Linked employee and tagged BGV teammate",
            departmentId: 4,
            raisedForUserId: 4,
            taggedUserIds: [9],
          },
          admin,
        ),
        201,
      )
    ).json();
    for (const cookie of [employee, supervisor, manager, bgv])
      await expect(
        await req(`/tickets/${linked.id}`, "GET", undefined, cookie),
        200,
      );
    await expect(
      await req(`/tickets/${linked.id}`, "GET", undefined, peer),
      404,
    );
    const list = await (
      await expect(await req("/tickets", "GET", undefined, manager), 200)
    ).json();
    assert.equal(list.total, 2);
    assertions++;
    const mine = await (
      await expect(
        await req("/tickets?view=mine", "GET", undefined, admin),
        200,
      )
    ).json();
    assert.equal(mine.total, 1);
    assertions++;
    await expect(await req("/users", "GET", undefined, it), 200);
    await expect(await req("/users", "GET", undefined, employee), 403);
    await expect(
      await req(
        "/users/4",
        "PATCH",
        { managerId: 6, departmentId: 2, teamName: "BGV review" },
        it,
      ),
      200,
    );
    await expect(
      await req(`/tickets/${created.id}`, "GET", undefined, manager),
      404,
    );
    await expect(
      await req(`/tickets/${created.id}`, "GET", undefined, bgv),
      200,
    );
    await expect(
      await req("/users/4", "PATCH", { managerId: 3, departmentId: 1 }, it),
      200,
    );
    await expect(await req("/users/2", "PATCH", { managerId: 3 }, admin), 400);
    await expect(await req("/users/3", "PATCH", { managerId: 3 }, admin), 400);
    await expect(await req("/users/4", "PATCH", { managerId: 9999 }, it), 400);
    await expect(
      await req("/users/4", "PATCH", { departmentId: 9999 }, it),
      400,
    );
    await expect(
      await req("/users/4", "PATCH", { role: "super_admin" }, it),
      403,
    );
    await expect(
      await req("/users/1", "PATCH", { newPassword: password + "reset" }, it),
      403,
    );
    await expect(
      await req("/users/1", "PATCH", { departmentId: 3 }, limitedAdmin),
      403,
    );
    await expect(
      await req("/users/4", "PATCH", { managerId: 5 }, employee),
      403,
    );
    const fresh = await (
      await expect(
        await req(
          "/users",
          "POST",
          {
            name: "New starter",
            email: "new@example.test",
            password,
            role: "employee",
            departmentId: 1,
          },
          admin,
        ),
        201,
      )
    ).json();
    assert.equal(fresh.mustChangePassword, true);
    assertions++;
    await expect(
      await req(
        "/tickets",
        "POST",
        {
          subject: "Invalid links",
          description: "Must fail",
          taggedUserIds: [99999],
        },
        employee,
      ),
      400,
    );
    await expect(
      await req(
        "/tickets",
        "POST",
        {
          subject: "Invalid assignment",
          description: "Must fail",
          departmentId: 2,
          assigneeId: 7,
        },
        admin,
      ),
      400,
    );
    await expect(
      await req(
        `/tickets/${linked.id}`,
        "PATCH",
        { raisedForUserId: 5, taggedUserIds: [] },
        admin,
      ),
      200,
    );
    await expect(
      await req(`/tickets/${linked.id}`, "GET", undefined, employee),
      404,
    );
    await expect(
      await req(`/tickets/${linked.id}`, "GET", undefined, peer),
      200,
    );
    await expect(
      await req(`/tickets/${linked.id}`, "PATCH", { taggedUserIds: [4] }, peer),
      403,
    );
    await expect(
      await req("/users/4", "PATCH", { newPassword: password + "reset" }, it),
      200,
    );
    await expect(await req("/auth/me", "GET", undefined, employee), 401);
    const reset = await login(4, password + "reset");
    assert.equal(reset.data.user.mustChangePassword, true);
    assertions++;
    await expect(await req("/tickets", "GET", undefined, reset.cookie), 428);
    const history = (
      await pool.query(
        "SELECT changes FROM user_access_history WHERE user_id=4",
      )
    ).rows;
    assert.ok(history.length >= 3);
    assert.ok(!JSON.stringify(history).includes(password));
    assertions += 2;
    await expect(await req("/users/5", "DELETE", undefined, admin), 409);
    console.log(
      `${assertions} first-login, hierarchy and role-boundary assertions passed.`,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
    await socket.stop();
    await pg.close();
  }
});
