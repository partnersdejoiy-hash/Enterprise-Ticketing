import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".vercel/output");
const functionDir = path.join(output, "functions/api.func");
await rm(output, { recursive: true, force: true });
await mkdir(functionDir, { recursive: true });

// Bundle workspace TypeScript and npm dependencies into the function itself.
// Source-file tracing alone misses pnpm's @workspace/db symlink on Vercel.
await build({
  absWorkingDir: root,
  entryPoints: ["api/index.ts"],
  outfile: path.join(functionDir, "index.mjs"),
  platform: "node",
  target: "node24",
  format: "esm",
  bundle: true,
  external: ["pg-native"], // Optional native pg driver; pg's JS driver is bundled.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "info",
});
await writeFile(path.join(functionDir, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs24.x",
  handler: "index.mjs",
  launcherType: "Nodejs",
  maxDuration: 30,
  environment: { NODE_ENV: "production", VERCEL: "1" },
}, null, 2));
await cp(path.join(root, "artifacts/orbitdesk/dist/public"), path.join(output, "static"), { recursive: true });
await writeFile(path.join(output, "config.json"), JSON.stringify({
  version: 3,
  routes: [
    { src: "/api(?:/.*)?", dest: "/api" },
    { handle: "filesystem" },
    { src: "/.*", dest: "/index.html" },
  ],
}, null, 2));
