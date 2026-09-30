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
  getAiProviders,
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
  botDisplayName,
  chatRoster,
  createHuddle,
  getMessages,
  getOrCreateDirectThread,
  listThreads,
  markRead,
  postMessage,
  replyAsBot,
  threadOwnedBy,
  threadParticipants,
  type ChatWorker,
} from "../lib/ai-team-chat.js";
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
    providers: await getAiProviders(config),
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
    await writeJsonSetting(`ai_probe_v1_${c.provider}`, {
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
    const legacyProbe = await readJsonSetting("ai_probe_v1", {
      provider: "",
      model: "",
      at: 0,
    });
    const probe = await readJsonSetting(
      `ai_probe_v1_${c.provider}`,
      legacyProbe,
    );
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
      "INSERT INTO system_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=now()",
      [
        `ai_provider_model_${config.provider}`,
        JSON.stringify({ model: config.model }),
      ],
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
const MAX_HUDDLE_BOTS = 6;

async function requireChatReady(res: any) {
  const c = await getAiConfig();
  if (!c.enabled || !providerConfigured(c)) {
    res.status(503).json({
      error:
        "Server AI is not enabled. Ask the superadmin to connect and enable it in Settings → AI workforce.",
    });
    return null;
  }
  return c;
}

router.get("/ai/chat/roster", async (req: AuthenticatedRequest, res) => {
  await ensureAiWorkers();
  const roster = await chatRoster();
  res.json({
    bots: roster.map((w) => ({
      id: w.id,
      kind: w.kind,
      name: botDisplayName(w),
      enabled: w.enabled,
      department: w.department,
      role:
        w.kind === "pa"
          ? "Personal assistant"
          : w.kind === "draft"
            ? "Response drafting"
            : "Triage & review",
    })),
  });
});

router.get("/ai/chat/threads", async (req: AuthenticatedRequest, res) => {
  res.json({ threads: await listThreads(req.user!.id) });
});

async function runHuddleRound(
  config: any,
  threadId: number,
  userName: string,
  actorId: number,
) {
  const bots = (await threadParticipants(threadId)).filter((b) => b.enabled);
  const replies: { bot: string; text: string }[] = [];
  for (const bot of bots) {
    const history = await getMessages(threadId, userName);
    const mates = bots
      .filter((b) => b.id !== bot.id)
      .map((b) => botDisplayName(b));
    try {
      const text = await replyAsBot(config, bot, history, mates, actorId);
      await postMessage({
        threadId,
        sender: "bot",
        workerId: bot.id,
        content: text,
      });
      replies.push({ bot: botDisplayName(bot), text });
    } catch (e) {
      const msg =
        e instanceof AiUnavailable ? e.message : "AI unavailable right now";
      await postMessage({
        threadId,
        sender: "bot",
        workerId: bot.id,
        content: `${botDisplayName(bot)} could not reply: ${msg}`,
      });
      replies.push({ bot: botDisplayName(bot), text: msg });
      if (e instanceof AiUnavailable) break;
    }
  }
  return replies;
}

router.post("/ai/chat/threads", async (req: AuthenticatedRequest, res) => {
  const config = await requireChatReady(res);
  if (!config) return;
  await ensureAiWorkers();
  const userId = req.user!.id;
  const userName = req.user!.name ?? "You";
  if (typeof req.body?.workerId === "number") {
    const roster = await chatRoster();
    const bot = roster.find((w) => w.id === req.body.workerId);
    if (!bot) return void res.status(404).json({ error: "Bot not found." });
    if (!bot.enabled)
      return void res.status(409).json({ error: "This bot is disabled." });
    const threadId = await getOrCreateDirectThread(userId, bot.id);
    return void res.json({ threadId });
  }
  const workerIds = Array.isArray(req.body?.workerIds)
    ? [...new Set(req.body.workerIds)].filter((n) => Number.isInteger(n))
    : [];
  const topic =
    typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
  if (workerIds.length < 2)
    return void res.status(400).json({ error: "Pick at least 2 bots." });
  if (workerIds.length > MAX_HUDDLE_BOTS)
    return void res
      .status(400)
      .json({ error: `Pick at most ${MAX_HUDDLE_BOTS} bots per huddle.` });
  if (!topic || topic.length > 500)
    return void res.status(400).json({ error: "Give the huddle a topic." });
  const roster = await chatRoster();
  const bots = workerIds
    .map((id) => roster.find((w) => w.id === id))
    .filter((w): w is ChatWorker => !!w && w.enabled);
  if (bots.length < 2)
    return void res
      .status(409)
      .json({ error: "Pick at least 2 enabled bots." });
  const threadId = await createHuddle(
    userId,
    bots.map((b) => b.id),
    topic,
  );
  await postMessage({ threadId, sender: "user", userId, content: topic });
  await runHuddleRound(config, threadId, userName, userId);
  res.json({ threadId });
});

router.get("/ai/chat/threads/:id", async (req: AuthenticatedRequest, res) => {
  const threadId = Number(req.params.id);
  if (
    !Number.isInteger(threadId) ||
    !(await threadOwnedBy(threadId, req.user!.id))
  )
    return void res.status(404).json({ error: "Thread not found." });
  const threads = await listThreads(req.user!.id);
  const thread = threads.find((t) => t.id === threadId);
  const messages = await getMessages(threadId, req.user!.name ?? "You");
  await markRead(threadId);
  res.json({ thread, messages });
});

router.post(
  "/ai/chat/threads/:id/messages",
  async (req: AuthenticatedRequest, res) => {
    const config = await requireChatReady(res);
    if (!config) return;
    const threadId = Number(req.params.id);
    if (
      !Number.isInteger(threadId) ||
      !(await threadOwnedBy(threadId, req.user!.id))
    )
      return void res.status(404).json({ error: "Thread not found." });
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 2000)
      return void res
        .status(400)
        .json({ error: "Enter a message up to 2,000 characters." });
    const userId = req.user!.id;
    const userName = req.user!.name ?? "You";
    const threads = await listThreads(userId);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread)
      return void res.status(404).json({ error: "Thread not found." });
    await postMessage({ threadId, sender: "user", userId, content: text });
    if (thread.kind === "direct" && thread.worker_id) {
      const roster = await chatRoster();
      const bot = roster.find((w) => w.id === thread.worker_id);
      if (!bot?.enabled)
        return void res.status(409).json({ error: "This bot is disabled." });
      try {
        const history = await getMessages(threadId, userName);
        const reply = await replyAsBot(config, bot, history, [], userId);
        await postMessage({
          threadId,
          sender: "bot",
          workerId: bot.id,
          content: reply,
        });
        return void res.json({ ok: true });
      } catch (e) {
        return void res.status(503).json({
          error: e instanceof AiUnavailable ? e.message : "AI unavailable",
        });
      }
    }
    await runHuddleRound(config, threadId, userName, userId);
    res.json({ ok: true });
  },
);

router.delete(
  "/ai/chat/threads/:id",
  async (req: AuthenticatedRequest, res) => {
    const threadId = Number(req.params.id);
    if (
      !Number.isInteger(threadId) ||
      !(await threadOwnedBy(threadId, req.user!.id))
    )
      return void res.status(404).json({ error: "Thread not found." });
    await pool.query(`DELETE FROM orbit_ai_chat_threads WHERE id=$1`, [
      threadId,
    ]);
    res.json({ ok: true });
  },
);

export default router;
