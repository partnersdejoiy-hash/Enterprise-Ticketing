import { Router } from "express";
import { pollAll } from "../lib/imapService.js";

const router = Router();

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
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = req.headers.authorization ?? "";
    const querySecret = (req.query.secret as string) ?? "";
    const provided = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : querySecret;

    if (provided !== cronSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  try {
    await pollAll();
    res.json({ ok: true, polledAt: new Date().toISOString() });
  } catch (err: any) {
    console.error("[cron] IMAP poll failed:", err);
    res.status(500).json({ ok: false, error: err?.message ?? "Poll failed" });
  }
});

export default router;
