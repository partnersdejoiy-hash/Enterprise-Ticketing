import { Router } from "express";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  requireAdmin,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import { canAccessTicket, handlesTicket } from "../lib/ticket-access.js";
import {
  AI_POLICY,
  AiUnavailable,
  completeAi,
  getAiConfig,
  providerConfigured,
  validAiConfig,
} from "../lib/ai-provider.js";
import {
  ensureAiWorkers,
  enqueueAiTicket,
  processAiJobs,
  workforceReport,
} from "../lib/ai-workforce.js";
import {
  readJsonSetting,
  writeJsonSetting,
} from "../lib/workspace-settings.js";
const router = Router();
router.use("/ai", authMiddleware);
const superadmin = (req: AuthenticatedRequest, res: any, next: any) => {
  if (req.user?.role !== "super_admin")
    return res.status(403).json({ error: "Superadmin access required" });
  next();
};
router.get("/ai/status", async (_req, res) => {
  const c = await getAiConfig();
  res.json({
    enabled: c.enabled,
    configured: providerConfigured(c),
    provider: c.provider,
    model: c.model,
  });
});
router.get("/ai/workforce", requireAdmin, async (_req, res) => {
  await ensureAiWorkers();
  const config = await getAiConfig();
  const workers = await pool.query(
    "SELECT w.*,d.name AS department FROM orbit_ai_workers w LEFT JOIN departments d ON d.id=w.department_id ORDER BY d.name NULLS FIRST,w.kind",
  );
  const usage = await pool.query(
    "SELECT count(*)::int AS requests FROM orbit_ai_calls WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
  );
  const report = await workforceReport();
  res.json({
    config,
    configured: providerConfigured(config),
    workers: workers.rows,
    requestsToday: usage.rows[0].requests,
    report,
  });
});
router.post("/ai/test", superadmin, async (req: AuthenticatedRequest, res) => {
  const c = { ...(await getAiConfig()), ...req.body, enabled: false };
  if (!validAiConfig(c))
    return void res.status(400).json({
      error:
        "Choose a free OpenRouter/OpenCode model or an Ollama model; daily limit 1–50.",
    });
  try {
    const result = await completeAi(
      c,
      "Reply with READY only.",
      "Connection test",
      "connection-test",
      req.user!.id,
    );
    await writeJsonSetting("ai_probe_v1", {
      provider: c.provider,
      model: c.model,
      at: Date.now(),
    });
    res.json({ ok: true, model: result.model });
  } catch (e) {
    res.status(503).json({
      error: e instanceof AiUnavailable ? e.message : "Connection test failed",
    });
  }
});
router.put("/ai/config", superadmin, async (req: AuthenticatedRequest, res) => {
  const c = req.body;
  if (!validAiConfig(c))
    return void res.status(400).json({
      error:
        "Invalid configuration. OpenRouter/OpenCode must use an allowed free model; limit 1–50.",
    });
  if (c.enabled) {
    const probe = await readJsonSetting("ai_probe_v1", {
      provider: "",
      model: "",
      at: 0,
    });
    if (
      !providerConfigured(c) ||
      probe.provider !== c.provider ||
      probe.model !== c.model ||
      Date.now() - probe.at > 3600000
    )
      return void res.status(409).json({
        error: "Run a successful connection test before enabling AI.",
      });
  }
  const old = await getAiConfig();
  const config = {
    enabled: c.enabled,
    provider: c.provider,
    model: c.model,
    dailyLimit: c.dailyLimit,
    revision: old.revision + 1,
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(742198)");
    const stored = await client.query(
      "SELECT value FROM system_settings WHERE key='ai_workforce_v1'",
    );
    config.revision =
      Number(stored.rows[0] ? JSON.parse(stored.rows[0].value).revision : 0) +
      1;
    await client.query(
      "INSERT INTO system_settings(key,value) VALUES('ai_workforce_v1',$1) ON CONFLICT(key) DO UPDATE SET value=$1,updated_at=now()",
      [JSON.stringify(config)],
    );
    await client.query(
      "UPDATE orbit_ai_jobs SET status='cancelled',error='Configuration changed',updated_at=now() WHERE status IN ('queued','working')",
    );
    await client.query(
      "INSERT INTO orbit_ai_audit(actor_id,action,details) VALUES($1,'config_saved',$2)",
      [req.user!.id, JSON.stringify(config)],
    );
    await client.query("COMMIT");
    res.json(config);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});
router.put(
  "/ai/workers/:id",
  superadmin,
  async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id),
      { name, enabled } = req.body ?? {};
    if (
      !Number.isSafeInteger(id) ||
      typeof name !== "string" ||
      name.trim().length > 80 ||
      typeof enabled !== "boolean"
    )
      return void res.status(400).json({
        error:
          "A name up to 80 characters and enable/disable value are required.",
      });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        "UPDATE orbit_ai_workers SET name=$1,enabled=$2,revision=revision+1,updated_at=now() WHERE id=$3 RETURNING *",
        [name.trim(), enabled, id],
      );
      if (!r.rowCount) {
        await client.query("ROLLBACK");
        return void res.status(404).json({ error: "Worker not found" });
      }
      await client.query(
        "UPDATE orbit_ai_jobs SET status='cancelled',error='Worker configuration changed',updated_at=now() WHERE worker_id=$1 AND status IN ('queued','working')",
        [id],
      );
      await client.query(
        "INSERT INTO orbit_ai_audit(actor_id,action,details) VALUES($1,'worker_saved',$2)",
        [
          req.user!.id,
          JSON.stringify({ workerId: id, name: name.trim(), enabled }),
        ],
      );
      await client.query("COMMIT");
      res.json(r.rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
);
router.get("/ai/tickets/:id", async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (
    !(await canAccessTicket(req.user!, id)) ||
    !(await handlesTicket(req.user!, id))
  )
    return void res.status(404).json({ error: "Ticket not found" });
  const r = await pool.query(
    "SELECT j.id,j.status,j.output,j.error,j.model,j.created_at,w.name,w.kind FROM orbit_ai_jobs j JOIN orbit_ai_workers w ON w.id=j.worker_id WHERE j.ticket_id=$1 ORDER BY j.id DESC LIMIT 6",
    [id],
  );
  res.json(r.rows);
});
router.post("/ai/tickets/:id/run", async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (
    !(await canAccessTicket(req.user!, id)) ||
    !(await handlesTicket(req.user!, id))
  )
    return void res.status(404).json({ error: "Ticket not found" });
  const c = await getAiConfig();
  if (!c.enabled || !providerConfigured(c))
    return void res.status(503).json({
      error: "Setup required: superadmin must connect and enable server AI.",
    });
  await enqueueAiTicket(id);
  res.json(await processAiJobs(id));
});
router.post(
  "/ai/queue/run",
  superadmin,
  async (req: AuthenticatedRequest, res) => {
    const c = await getAiConfig();
    if (!c.enabled || !providerConfigured(c))
      return void res
        .status(503)
        .json({ error: "AI provider is not enabled." });
    await pool.query(
      "UPDATE orbit_ai_jobs SET status='queued',error=NULL WHERE status='failed' AND attempts<3 AND updated_at<now()-interval '1 minute'",
    );
    const result = await processAiJobs();
    await pool.query(
      "INSERT INTO orbit_ai_audit(actor_id,action,details) VALUES($1,'queue_run',$2)",
      [req.user!.id, JSON.stringify(result)],
    );
    res.json(result);
  },
);
router.post(
  "/ai/pa/report",
  superadmin,
  async (req: AuthenticatedRequest, res) => {
    await ensureAiWorkers();
    const pa = await pool.query(
      "SELECT enabled FROM orbit_ai_workers WHERE kind='pa'",
    );
    if (!pa.rows[0]?.enabled)
      return void res
        .status(409)
        .json({ error: "Personal assistant is disabled." });
    const c = await getAiConfig();
    if (!c.enabled)
      return void res.status(503).json({
        error:
          "Server AI is not enabled. The factual department report remains available.",
      });
    try {
      const data = await workforceReport();
      const result = await completeAi(
        c,
        AI_POLICY,
        "Prepare an executive brief from these aggregate counts: priorities, workload bottlenecks and recommended staff follow-up. Do not invent trends or individual performance. No changes have been executed. " +
          JSON.stringify(data),
        "pa-report",
        req.user!.id,
      );
      await pool.query(
        "INSERT INTO orbit_ai_audit(actor_id,action,details) VALUES($1,'pa_report',$2)",
        [
          req.user!.id,
          JSON.stringify({ model: result.model, report: result.text }),
        ],
      );
      res.json({ ...result, generatedAt: new Date().toISOString() });
    } catch (e) {
      res.status(503).json({
        error: e instanceof AiUnavailable ? e.message : "Report unavailable",
      });
    }
  },
);
router.post("/ai/chat", async (req: AuthenticatedRequest, res) => {
  if (
    typeof req.body?.text !== "string" ||
    req.body.text.trim().length < 1 ||
    req.body.text.length > 2000
  )
    return void res
      .status(400)
      .json({ error: "Enter a question up to 2,000 characters." });
  const c = await getAiConfig();
  if (!c.enabled)
    return void res.status(503).json({
      error:
        "Server AI setup required. Ask the superadmin to connect and enable OpenRouter, OpenCode or Ollama in AI workforce settings.",
    });
  try {
    res.json(
      await completeAi(
        c,
        AI_POLICY +
          " Settings changes require Save. Ticket assignment goes to active agents/managers inside the dedicated department. Explain workflows but do not claim access to ticket records.",
        req.body.text,
        "chat",
        req.user!.id,
      ),
    );
  } catch (e) {
    res.status(503).json({
      error: e instanceof AiUnavailable ? e.message : "AI unavailable",
    });
  }
});
export default router;
