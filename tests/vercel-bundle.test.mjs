import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Run the actual deployment bundle away from the repository and node_modules.
// This catches missing traced workspace files even when the frontend builds.
test("Vercel function is self-contained and returns JSON before database setup", async () => {
  const isolated = await mkdtemp(path.join(tmpdir(), "orbit-vercel-"));
  try {
    await cp(".vercel/output/functions/api.func", isolated, { recursive: true });
    await writeFile(path.join(isolated, "check.mjs"), `
      import assert from 'node:assert/strict';
      import { createServer } from 'node:http';
      import handler from './index.mjs';
      const server = createServer(handler);
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      try {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/auth/me');
        assert.equal(response.status, Number(process.env.EXPECT_STATUS));
        assert.match(response.headers.get('content-type'), /application\\/json/);
        const body = await response.json();
        assert.ok(body.error);
        if (response.status === 503) assert.match(body.error, /setup is incomplete/);
      } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    `);
    for (const configured of [false, true]) {
      const env = { ...process.env, VERCEL: "1", NODE_ENV: "production", EXPECT_STATUS: configured ? "401" : "503" };
      delete env.NODE_PATH;
      delete env.NODE_OPTIONS;
      // A placeholder is sufficient: unauthenticated /me never queries the DB.
      if (configured) env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
      else delete env.DATABASE_URL;
      const result = spawnSync(process.execPath, ["check.mjs"], { cwd: isolated, env, encoding: "utf8", timeout: 20000 });
      assert.equal(result.status, 0, result.stderr || String(result.error));
    }
  } finally { await rm(isolated, { recursive: true, force: true }); }
});
