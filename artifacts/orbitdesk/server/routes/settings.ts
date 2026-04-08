import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth";
import { getEmailConfig, saveEmailConfig, sendEmail } from "../lib/emailService";
import { getImapConfig, saveImapConfig, testImapConnection, restartImapPoller } from "../lib/imapService";

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

    const { db, systemSettingsTable } = await import("@workspace/db");
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
    if (!testTo) { res.status(400).json({ error: "Recipient email is required" }); return; }

    // Determine which SMTP source will be used
    const { db, emailAccountsTable } = await import("@workspace/db");
    const accounts = await db.select().from(emailAccountsTable);
    const primary = accounts.find((a: any) => a.isPrimarySender && a.smtpEnabled && a.smtpHost && a.smtpUser);
    const anySmtp = accounts.find((a: any) => a.smtpEnabled && a.smtpHost && a.smtpUser);
    const chosen = primary ?? anySmtp;
    const smtpSource = chosen
      ? `Email Account: "${chosen.name}" (${chosen.smtpFromEmail || chosen.smtpUser})`
      : "Legacy SMTP (Email Notifications settings)";

    const sentAt = new Date().toISOString();
    await sendEmail(testTo, "[OrbitDesk] SMTP Test Email", `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#1e40af;margin-top:0">✅ OrbitDesk SMTP Test</h2>
        <p style="color:#374151">Your SMTP configuration is working correctly. This test email was sent successfully.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px">
          <tr><td style="padding:6px 0;color:#6b7280;width:120px">Sent to</td><td style="padding:6px 0;color:#111827;font-weight:600">${testTo}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Sent via</td><td style="padding:6px 0;color:#111827">${smtpSource}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Sent at</td><td style="padding:6px 0;color:#111827">${sentAt}</td></tr>
        </table>
        <p style="margin-top:20px;font-size:12px;color:#9ca3af">Powered by Dejoiy OrbitDesk</p>
      </div>
    `);
    res.json({ message: `Test email sent to ${testTo}`, via: smtpSource });
  } catch (err: any) {
    const msg = err.message ?? String(err);
    let hint = "";
    if (/ECONNREFUSED/.test(msg)) hint = "The SMTP server refused the connection — check the host and port.";
    else if (/ENOTFOUND|getaddrinfo/.test(msg)) hint = "Cannot resolve the SMTP host — check for typos in the hostname.";
    else if (/auth|535|534|Invalid credentials/i.test(msg)) hint = "Authentication failed — verify your SMTP username and password. For Gmail use an App Password.";
    else if (/timeout|ETIMEDOUT/i.test(msg)) hint = "Connection timed out — the SMTP server is not reachable. Check firewall or port settings.";
    else if (/no smtp configured|not configured/i.test(msg)) hint = "No SMTP account is configured. Add one in Settings → Email Accounts or configure the legacy SMTP in Email Notifications.";
    res.status(500).json({ error: "Failed to send test email", details: msg, hint });
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
    await restartImapPoller();
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
