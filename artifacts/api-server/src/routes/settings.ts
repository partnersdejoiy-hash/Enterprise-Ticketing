import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth";
import { getEmailConfig, sendEmail } from "../lib/emailService";
import { getImapConfig, saveImapConfig, testImapConnection } from "../lib/imapService";
import { db, systemSettingsTable } from "@workspace/db";

const router = Router();

router.get("/settings/email", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin" && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const cfg = await getEmailConfig();
    res.json({ ...cfg, pass: cfg.pass ? "••••••••" : "" });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/settings/email", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden", message: "Only Super Admins can update email settings" });
    return;
  }
  try {
    const { host, port, secure, user, pass, fromEmail, fromName, enabled } = req.body;
    const toSave: Record<string, string> = {};
    if (enabled !== undefined) toSave["email_enabled"] = String(enabled);
    if (host !== undefined) toSave["smtp_host"] = host;
    if (port !== undefined) toSave["smtp_port"] = String(port);
    if (secure !== undefined) toSave["smtp_secure"] = String(secure);
    if (user !== undefined) toSave["smtp_user"] = user;
    if (pass !== undefined && pass !== "••••••••") toSave["smtp_pass"] = pass;
    if (fromEmail !== undefined) toSave["email_from"] = fromEmail;
    if (fromName !== undefined) toSave["email_from_name"] = fromName;

    for (const [key, value] of Object.entries(toSave)) {
      await db.insert(systemSettingsTable).values({ key, value })
        .onConflictDoUpdate({ target: systemSettingsTable.key, set: { value, updatedAt: new Date() } });
    }
    res.json({ message: "Email settings updated" });
  } catch (err) {
    console.error("Update email settings error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/settings/email/test", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const testTo = req.body.to || req.user!.email;
    await sendEmail(testTo, "[OrbitDesk] Test Email", `
      <h2>Test Email from OrbitDesk</h2>
      <p>This is a test email sent from OrbitDesk to verify your SMTP configuration.</p>
      <p>If you received this, your email settings are working correctly.</p>
      <p>Sent at: ${new Date().toISOString()}</p>
    `);
    res.json({ message: `Test email sent to ${testTo}` });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to send test email", details: err.message });
  }
});

// ─── IMAP (Incoming Email) ──────────────────────────────────────────────────────

router.get("/settings/imap", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin" && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    const cfg = await getImapConfig();
    res.json({ ...cfg, pass: cfg.pass ? "••••••••" : "" });
  } catch { res.status(500).json({ error: "Internal Server Error" }); }
});

router.put("/settings/imap", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden", message: "Only Super Admins can update IMAP settings" }); return;
  }
  try {
    const { enabled, host, port, secure, user, pass, mailbox, pollInterval, toAddress } = req.body;
    await saveImapConfig({ enabled, host, port, secure, user, pass, mailbox, pollInterval, toAddress });
    res.json({ message: "IMAP settings updated" });
  } catch (err) {
    console.error("Update IMAP settings error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/settings/imap/test", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  try {
    const result = await testImapConnection();
    if (!result.ok) {
      res.status(400).json({ error: result.message });
    } else {
      res.json({ message: result.message, unseen: result.unseen });
    }
  } catch (err: any) {
    res.status(500).json({ error: "Test failed", details: err.message });
  }
});

export default router;
