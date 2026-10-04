import type { IncomingMessage, ServerResponse } from "node:http";

let application: Promise<typeof import("../artifacts/orbitdesk/server/app.js")> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!process.env.DATABASE_URL) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Workspace setup is incomplete. Please contact your administrator." }));
    return;
  }
  try {
    application ??= import("../artifacts/orbitdesk/server/app.js");
    const { default: app } = await application;
    app(req, res);
  } catch (error) {
    // Do not log request bodies, passwords, or connection strings.
    const code = error && typeof error === "object" && "code" in error ? error.code : "STARTUP_ERROR";
    console.error("[api] Application startup failed", { code });
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Service unavailable. Please try again later." }));
    }
  }
}
