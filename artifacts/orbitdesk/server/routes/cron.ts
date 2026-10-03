import { Router } from "express";
import { pollAll } from "../lib/imapService.js";
import { runSlaPredictionBatch } from "../lib/sla-jobs.js";

const router = Router();

function checkCronSecret(req: {
  headers: Record<string, unknown>;
}): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 32) return false;
  return req.headers.authorization === `Bearer ${cronSecret}`;
}

/**
 * GET /api/cron/imap-poll
 *
 * Called by Vercel Cron (or any external scheduler) to trigger a single IMAP
 * poll cycle across all configured accounts.
 *
 * Vercel automatically sets the CRON_SECRET environment variable and calls
 * this endpoint with  Authorization: Bearer <CRON_SECRET>.
 * An external cron service (e.g. cron-job.org) can pass the same secret via
 * the Authorization header or as ?secret=<CRON_SECRET> query param.
 */
router.get("/cron/imap-poll", async (req, res) => {
  if (!checkCronSecret(req as never)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await pollAll();
    res.json({ ok: true, polledAt: new Date().toISOString() });
  } catch (err: any) {
    console.error("[cron] IMAP poll failed:", err);
    res.status(500).json({ ok: false, error: err?.message ?? "Poll failed" });
  }
});

/**
 * GET /api/cron/sla-predict
 *
 * Runs the bounded SLA prediction batch (Superpower #1): refreshes breach
 * predictions for the most at-risk open tickets (max 20 per run to respect
 * the shared AI quota) and emits ticket.sla_warning / ticket.sla_breached
 * domain events.
 *
 * Same CRON_SECRET protection as imap-poll. Call every 30-60 minutes.
 */
router.get("/cron/sla-predict", async (req, res) => {
  if (!checkCronSecret(req as never)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const max = Math.min(
      50,
      Math.max(1, Number(req.query.max ?? 20) || 20),
    );
    const result = await runSlaPredictionBatch(max);
    res.json({ ok: true, ranAt: new Date().toISOString(), ...result });
  } catch (err: any) {
    console.error("[cron] SLA prediction batch failed:", err);
    res.status(500).json({ ok: false, error: err?.message ?? "Batch failed" });
  }
});

export default router;
