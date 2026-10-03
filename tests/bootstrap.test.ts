import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

test("deployment scripts migrate, bootstrap once, and reset without changing roles", async () => {
  const pg = await PGlite.create();
  const socket = new PGLiteSocketServer({ db: pg, port: 5551, host: "127.0.0.1", maxConnections: 10 });
  await socket.start();
  const password = randomBytes(24).toString("base64url");
  const env = { ...process.env, DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5551/postgres", BOOTSTRAP_ADMIN_EMAIL: "bootstrap@example.test", BOOTSTRAP_ADMIN_PASSWORD: password, BOOTSTRAP_ADMIN_NAME: "Test admin" };
  const run = (script: string, extra = {}) => promisify(execFile)(process.execPath, ["--import", "tsx", `scripts/src/${script}.ts`], { env: { ...env, ...extra }, timeout: 20000 });
  try {
    await run("migrate");
    await run("migrate");
    await run("seed");
    const first = (await pg.query<any>("SELECT id,role,password_hash,must_change_password FROM users")).rows[0];
    assert.equal(first.role, "super_admin");
    assert.equal(first.must_change_password, true);
    assert.match(first.password_hash, /^scrypt\$/);
    assert.notEqual(first.password_hash, password);
    await assert.rejects(run("seed"), /Account exists/);
    assert.equal((await pg.query<any>("SELECT count(*)::int AS n FROM users")).rows[0].n, 1);
    await pg.exec("INSERT INTO orbit_sessions(token_hash,user_id,password_fingerprint,expires_at) VALUES('test',1,'test',now()+interval '1 hour')");
    await run("reset-password", { RESET_USER_EMAIL: "bootstrap@example.test", RESET_USER_PASSWORD: randomBytes(24).toString("base64url") });
    const reset = (await pg.query<any>("SELECT role,password_hash,must_change_password FROM users")).rows[0];
    assert.equal(reset.role, "super_admin");
    assert.equal(reset.must_change_password, true);
    assert.notEqual(reset.password_hash, first.password_hash);
    assert.equal((await pg.query<any>("SELECT count(*)::int AS n FROM orbit_sessions")).rows[0].n, 0);
  } finally { await socket.stop(); await pg.close(); }
});
