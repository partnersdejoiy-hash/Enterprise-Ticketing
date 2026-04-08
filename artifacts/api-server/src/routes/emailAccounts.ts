import { Router } from "express";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { db, emailAccountsTable, departmentsTable, eq } from "@workspace/db";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";
import { restartImapPoller } from "../lib/imapService.js";

const router = Router();

function maskPass(acc: Record<string, unknown>) {
  return {
    ...acc,
    smtpPass: acc.smtpPass ? "••••••••" : "",
    imapPass: acc.imapPass ? "••••••••" : "",
  };
}

function adminOnly(req: AuthenticatedRequest, res: any): boolean {
  if (req.user!.role !== "super_admin" && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// GET /api/email-accounts
router.get("/email-accounts", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const accounts = await db.select().from(emailAccountsTable).orderBy(emailAccountsTable.id);
    const depts = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable);
    const deptMap = new Map(depts.map(d => [d.id, d.name]));
    res.json(accounts.map(a => ({
      ...maskPass(a as unknown as Record<string, unknown>),
      departmentName: a.departmentId ? deptMap.get(a.departmentId) ?? null : null,
    })));
  } catch (err) {
    console.error("List email accounts error", err);
    res.status(500).json({ error: "Failed to load email accounts" });
  }
});

// POST /api/email-accounts
router.post("/email-accounts", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const {
      name, departmentId, isPrimarySender,
      smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFromEmail, smtpFromName, smtpEnabled,
      imapHost, imapPort, imapSecure, imapUser, imapPass, imapMailbox, imapPollInterval, imapEnabled,
    } = req.body;

    if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }

    if (isPrimarySender) {
      await db.update(emailAccountsTable).set({ isPrimarySender: false });
    }

    const [account] = await db.insert(emailAccountsTable).values({
      name: name.trim(),
      departmentId: departmentId ?? null,
      isPrimarySender: !!isPrimarySender,
      smtpHost: smtpHost ?? "", smtpPort: smtpPort ?? 587, smtpSecure: !!smtpSecure,
      smtpUser: smtpUser ?? "", smtpPass: smtpPass ?? "",
      smtpFromEmail: smtpFromEmail ?? "", smtpFromName: smtpFromName ?? "OrbitDesk",
      smtpEnabled: !!smtpEnabled,
      imapHost: imapHost ?? "", imapPort: imapPort ?? 993, imapSecure: imapSecure !== false,
      imapUser: imapUser ?? "", imapPass: imapPass ?? "",
      imapMailbox: imapMailbox ?? "INBOX", imapPollInterval: imapPollInterval ?? 5,
      imapEnabled: !!imapEnabled,
    }).returning();

    if (imapEnabled) await restartImapPoller().catch(() => null);
    res.status(201).json(maskPass(account as unknown as Record<string, unknown>));
  } catch (err) {
    console.error("Create email account error", err);
    res.status(500).json({ error: "Failed to create email account" });
  }
});

// PUT /api/email-accounts/:id
router.put("/email-accounts/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const id = parseInt(req.params.id, 10);
    const {
      name, departmentId, isPrimarySender,
      smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFromEmail, smtpFromName, smtpEnabled,
      imapHost, imapPort, imapSecure, imapUser, imapPass, imapMailbox, imapPollInterval, imapEnabled,
    } = req.body;

    const [existing] = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Account not found" }); return; }

    if (isPrimarySender) {
      await db.update(emailAccountsTable).set({ isPrimarySender: false });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name.trim();
    if (departmentId !== undefined) update.departmentId = departmentId ?? null;
    if (isPrimarySender !== undefined) update.isPrimarySender = !!isPrimarySender;
    if (smtpHost !== undefined) update.smtpHost = smtpHost;
    if (smtpPort !== undefined) update.smtpPort = smtpPort;
    if (smtpSecure !== undefined) update.smtpSecure = !!smtpSecure;
    if (smtpUser !== undefined) update.smtpUser = smtpUser;
    if (smtpPass !== undefined && smtpPass !== "••••••••") update.smtpPass = smtpPass;
    if (smtpFromEmail !== undefined) update.smtpFromEmail = smtpFromEmail;
    if (smtpFromName !== undefined) update.smtpFromName = smtpFromName;
    if (smtpEnabled !== undefined) update.smtpEnabled = !!smtpEnabled;
    if (imapHost !== undefined) update.imapHost = imapHost;
    if (imapPort !== undefined) update.imapPort = imapPort;
    if (imapSecure !== undefined) update.imapSecure = !!imapSecure;
    if (imapUser !== undefined) update.imapUser = imapUser;
    if (imapPass !== undefined && imapPass !== "••••••••") update.imapPass = imapPass;
    if (imapMailbox !== undefined) update.imapMailbox = imapMailbox;
    if (imapPollInterval !== undefined) update.imapPollInterval = imapPollInterval;
    if (imapEnabled !== undefined) update.imapEnabled = !!imapEnabled;

    const [updated] = await db.update(emailAccountsTable).set(update as any).where(eq(emailAccountsTable.id, id)).returning();
    await restartImapPoller().catch(() => null);
    res.json(maskPass(updated as unknown as Record<string, unknown>));
  } catch (err) {
    console.error("Update email account error", err);
    res.status(500).json({ error: "Failed to update email account" });
  }
});

// DELETE /api/email-accounts/:id
router.delete("/email-accounts/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(emailAccountsTable).where(eq(emailAccountsTable.id, id));
    await restartImapPoller().catch(() => null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete email account" });
  }
});

// POST /api/email-accounts/:id/set-primary
router.post("/email-accounts/:id/set-primary", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const id = parseInt(req.params.id, 10);
    await db.update(emailAccountsTable).set({ isPrimarySender: false });
    await db.update(emailAccountsTable).set({ isPrimarySender: true }).where(eq(emailAccountsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to set primary sender" });
  }
});

// POST /api/email-accounts/:id/test-smtp
router.post("/email-accounts/:id/test-smtp", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const id = parseInt(req.params.id, 10);
    const [acc] = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, id)).limit(1);
    if (!acc) { res.status(404).json({ error: "Account not found" }); return; }

    if (!acc.smtpHost || !acc.smtpUser) {
      res.status(400).json({ error: "SMTP host and user are required" }); return;
    }

    const testTo = req.body.to || req.user!.email;
    const transporter = nodemailer.createTransport({
      host: acc.smtpHost, port: acc.smtpPort ?? 587, secure: !!acc.smtpSecure,
      auth: { user: acc.smtpUser, pass: acc.smtpPass ?? "" },
    });
    await transporter.sendMail({
      from: `"${acc.smtpFromName || "OrbitDesk"}" <${acc.smtpFromEmail || acc.smtpUser}>`,
      to: testTo,
      subject: `[OrbitDesk] Test Email — ${acc.name}`,
      text: `Test email from OrbitDesk account "${acc.name}".`,
      html: `<p>Test email from OrbitDesk account <strong>${acc.name}</strong>. SMTP is working correctly.</p>`,
    });
    res.json({ message: `Test email sent to ${testTo}` });
  } catch (err: any) {
    res.status(500).json({ error: "SMTP test failed", details: err.message });
  }
});

// POST /api/email-accounts/:id/test-imap
router.post("/email-accounts/:id/test-imap", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== "super_admin") { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const id = parseInt(req.params.id, 10);
    const [acc] = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, id)).limit(1);
    if (!acc) { res.status(404).json({ error: "Account not found" }); return; }

    if (!acc.imapHost || !acc.imapUser) {
      res.status(400).json({ error: "IMAP host and user are required" }); return;
    }

    const client = new ImapFlow({
      host: acc.imapHost, port: acc.imapPort ?? 993, secure: acc.imapSecure !== false,
      auth: { user: acc.imapUser, pass: acc.imapPass ?? "" },
      logger: false, tls: { rejectUnauthorized: false },
    });

    await client.connect();
    const mailbox = acc.imapMailbox || "INBOX";
    const status = await client.status(mailbox, { messages: true, unseen: true });
    await client.logout();
    res.json({ message: `Connected. Mailbox "${mailbox}" has ${status.messages} messages (${status.unseen ?? 0} unread).`, unseen: status.unseen ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: "IMAP test failed", details: err.message });
  }
});

export default router;
