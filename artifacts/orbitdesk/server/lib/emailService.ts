import nodemailer from "nodemailer";
import { db, systemSettingsTable, emailAccountsTable, eq } from "@workspace/db";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

const DEFAULT_FROM_EMAIL = "noreply.notifications@dejoiy.com";
const DEFAULT_FROM_NAME = "OrbitDesk by Dejoiy";

async function getEmailConfig(): Promise<EmailConfig> {
  try {
    // First: try primary account from email_accounts table
    const accounts = await db.select().from(emailAccountsTable);
    const primary = accounts.find(a => a.isPrimarySender && a.smtpEnabled && a.smtpHost && a.smtpUser);
    const anySmtp = accounts.find(a => a.smtpEnabled && a.smtpHost && a.smtpUser);
    const chosen = primary ?? anySmtp;
    if (chosen) {
      return {
        host: chosen.smtpHost ?? "",
        port: chosen.smtpPort ?? 587,
        secure: !!chosen.smtpSecure,
        user: chosen.smtpUser ?? "",
        pass: chosen.smtpPass ?? "",
        fromEmail: chosen.smtpFromEmail || chosen.smtpUser || DEFAULT_FROM_EMAIL,
        fromName: chosen.smtpFromName || DEFAULT_FROM_NAME,
        enabled: true,
      };
    }

    // Fallback: legacy system_settings SMTP config
    const rows = await db.select().from(systemSettingsTable);
    const get = (key: string) => rows.find((r) => r.key === key)?.value ?? "";
    return {
      host: get("smtp_host") || "",
      port: parseInt(get("smtp_port") || "587"),
      secure: get("smtp_secure") === "true",
      user: get("smtp_user") || "",
      pass: get("smtp_pass") || "",
      fromEmail: get("email_from") || DEFAULT_FROM_EMAIL,
      fromName: get("email_from_name") || DEFAULT_FROM_NAME,
      enabled: get("email_enabled") === "true",
    };
  } catch {
    return { host: "", port: 587, secure: false, user: "", pass: "", fromEmail: DEFAULT_FROM_EMAIL, fromName: DEFAULT_FROM_NAME, enabled: false };
  }
}

function createTransporter(cfg: EmailConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
}

function baseTemplate(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;color:#1f2937}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.08)}
  .header{background:#1e40af;padding:24px 32px;display:flex;align-items:center;gap:12px}
  .header-title{color:#fff;font-size:18px;font-weight:700;letter-spacing:-.01em}
  .header-sub{color:rgba(255,255,255,.7);font-size:11px;margin-top:2px}
  .body{padding:32px}.body h2{font-size:17px;font-weight:700;margin-bottom:8px}
  .body p{font-size:14px;color:#374151;line-height:1.6;margin-bottom:12px}
  .card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0}
  .card-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px}
  .card-row:last-child{border-bottom:none}.card-row .label{color:#6b7280;font-weight:500}.card-row .val{font-weight:600;color:#111827}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
  .badge-open{background:#fef3c7;color:#92400e}.badge-resolved{background:#d1fae5;color:#065f46}
  .badge-closed{background:#f3f4f6;color:#374151}.badge-in_progress{background:#dbeafe;color:#1e40af}
  .badge-urgent{background:#fee2e2;color:#991b1b}.badge-high{background:#fef3c7;color:#92400e}
  .footer{background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;font-size:11px;color:#9ca3af}
  </style></head><body><div class="wrap">
  <div class="header"><div><div class="header-title">OrbitDesk</div><div class="header-sub">Powered by Dejoiy &bull; Enterprise Ticketing</div></div></div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">This is an automated message from OrbitDesk by Dejoiy. Please do not reply to this email.<br>&copy; ${new Date().getFullYear()} Dejoiy. All rights reserved.</div>
  </div></body></html>`;
}

function statusBadge(status: string): string {
  return `<span class="badge badge-${status}">${status.replace("_", " ")}</span>`;
}

export interface EmailAttachmentInput {
  filename: string;
  content: string;
  encoding: "base64";
  contentType: string;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  attachments?: EmailAttachmentInput[],
  cc?: string | string[],
): Promise<void> {
  const cfg = await getEmailConfig();
  if (!cfg.enabled || !cfg.host) {
    console.error(`[email] Email not configured/disabled. Would have sent to ${Array.isArray(to) ? to.join(", ") : to}: ${subject}`);
    return;
  }
  try {
    const transporter = createTransporter(cfg);
    const recipients = Array.isArray(to) ? to.join(", ") : to;
    const ccRecipients = cc ? (Array.isArray(cc) ? cc.join(", ") : cc) : undefined;
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${cfg.fromEmail.split("@")[1] || "orbitdesk.app"}>`;
    await transporter.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      replyTo: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to: recipients,
      ...(ccRecipients ? { cc: ccRecipients } : {}),
      subject,
      messageId,
      headers: {
        "X-Mailer": "OrbitDesk by Dejoiy",
        "X-Priority": "3",
        "Precedence": "bulk",
        "List-Unsubscribe": `<mailto:${cfg.fromEmail}?subject=unsubscribe>`,
      },
      text: htmlToText(html),
      html,
      attachments: attachments?.map(a => ({
        filename: a.filename,
        content: Buffer.from(a.content.replace(/^data:[^;]+;base64,/, ""), "base64"),
        contentType: a.contentType,
      })),
    });
    console.error(`[email] Sent "${subject}" to ${recipients}${ccRecipients ? ` (cc: ${ccRecipients})` : ""}`);
  } catch (err) {
    console.error(`[email] Failed to send email:`, err);
  }
}

export async function sendTicketCreatedEmail(opts: {
  ticketNumber: string; subject: string; status: string; priority: string;
  departmentName?: string; createdByName: string;
  raisedForName?: string; raisedForEmail?: string;
  createdByEmail?: string; ccEmails?: string[];
}): Promise<void> {
  const to: string[] = [];
  if (opts.createdByEmail) to.push(opts.createdByEmail);
  if (opts.raisedForEmail && opts.raisedForEmail !== opts.createdByEmail) to.push(opts.raisedForEmail);
  if (!to.length) return;

  const forLine = opts.raisedForName
    ? `<p>This ticket was raised by <strong>${opts.createdByName}</strong> on behalf of <strong>${opts.raisedForName}</strong>.</p>`
    : `<p>Your ticket has been received and assigned a tracking number. Our team will review and respond shortly.</p>`;

  const html = baseTemplate(`Ticket Created: ${opts.ticketNumber}`, `
    <h2>Ticket Created Successfully</h2>
    ${forLine}
    <div class="card">
      <div class="card-row"><span class="label">Ticket #</span><span class="val">${opts.ticketNumber}</span></div>
      <div class="card-row"><span class="label">Subject</span><span class="val">${opts.subject}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val">${statusBadge(opts.status)}</span></div>
      <div class="card-row"><span class="label">Priority</span><span class="val">${statusBadge(opts.priority)}</span></div>
      ${opts.departmentName ? `<div class="card-row"><span class="label">Department</span><span class="val">${opts.departmentName}</span></div>` : ""}
    </div>
    <p>You will be notified when there are updates. Please keep this ticket number for reference.</p>
  `);

  const cc = (opts.ccEmails ?? []).filter(e => !to.includes(e));
  await sendEmail(to, `[OrbitDesk] Ticket Created: ${opts.ticketNumber}`, html, undefined, cc.length ? cc : undefined);
}

export async function sendTicketStatusEmail(opts: {
  ticketNumber: string; subject: string; oldStatus: string; newStatus: string;
  priority: string; departmentName?: string; changedByName: string;
  raisedForEmail?: string; createdByEmail?: string;
}): Promise<void> {
  const to: string[] = [];
  if (opts.createdByEmail) to.push(opts.createdByEmail);
  if (opts.raisedForEmail && opts.raisedForEmail !== opts.createdByEmail) to.push(opts.raisedForEmail);
  if (!to.length) return;

  const actionMap: Record<string, { title: string; msg: string }> = {
    resolved: { title: "Ticket Resolved", msg: `Your ticket has been resolved by <strong>${opts.changedByName}</strong>. If you have further questions, please open a new ticket.` },
    closed: { title: "Ticket Closed", msg: `Your ticket has been closed. Thank you for using OrbitDesk.` },
    in_progress: { title: "Ticket In Progress", msg: `Our team is now actively working on your ticket.` },
    waiting: { title: "Ticket Awaiting Your Response", msg: `Your ticket is waiting for additional information from you.` },
    assigned: { title: "Ticket Assigned", msg: `Your ticket has been assigned and will be attended to shortly.` },
    open: { title: "Ticket Reopened", msg: `Your ticket has been reopened.` },
  };
  const info = actionMap[opts.newStatus] ?? { title: `Ticket Status Updated`, msg: `Your ticket status has been updated to <strong>${opts.newStatus.replace("_", " ")}</strong>.` };

  const html = baseTemplate(`${info.title}: ${opts.ticketNumber}`, `
    <h2>${info.title}</h2>
    <p>${info.msg}</p>
    <div class="card">
      <div class="card-row"><span class="label">Ticket #</span><span class="val">${opts.ticketNumber}</span></div>
      <div class="card-row"><span class="label">Subject</span><span class="val">${opts.subject}</span></div>
      <div class="card-row"><span class="label">Previous Status</span><span class="val">${statusBadge(opts.oldStatus)}</span></div>
      <div class="card-row"><span class="label">New Status</span><span class="val">${statusBadge(opts.newStatus)}</span></div>
      ${opts.departmentName ? `<div class="card-row"><span class="label">Department</span><span class="val">${opts.departmentName}</span></div>` : ""}
    </div>
  `);

  await sendEmail(to, `[OrbitDesk] ${info.title}: ${opts.ticketNumber}`, html);
}

export async function sendDocumentRequestEmail(opts: {
  ticketNumber: string; subject: string; status: string;
  requesterEmail: string; requesterName: string; changedByName?: string;
}): Promise<void> {
  if (!opts.requesterEmail) return;

  const isNew = opts.status === "open";
  const title = isNew ? "Document Request Received" : `Document Request ${opts.status.replace("_", " ")}`;

  const html = baseTemplate(`${title}: ${opts.ticketNumber}`, `
    <h2>${title}</h2>
    <p>Hi <strong>${opts.requesterName}</strong>,</p>
    <p>${isNew
      ? "Your document request has been received and is being processed by the HR team."
      : `Your document request status has been updated${opts.changedByName ? ` by <strong>${opts.changedByName}</strong>` : ""}.`
    }</p>
    <div class="card">
      <div class="card-row"><span class="label">Request #</span><span class="val">${opts.ticketNumber}</span></div>
      <div class="card-row"><span class="label">Document</span><span class="val">${opts.subject.replace("Document Request: ", "")}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val">${statusBadge(opts.status)}</span></div>
    </div>
    <p>${isNew ? "You will receive updates via email as your request progresses." : ""}</p>
  `);

  await sendEmail(opts.requesterEmail, `[OrbitDesk] ${title}: ${opts.ticketNumber}`, html);
}

export async function saveEmailConfig(config: Partial<EmailConfig>): Promise<void> {
  const entries: [string, string][] = [
    ["email_enabled", config.enabled !== undefined ? String(config.enabled) : undefined],
    ["smtp_host", config.host],
    ["smtp_port", config.port !== undefined ? String(config.port) : undefined],
    ["smtp_secure", config.secure !== undefined ? String(config.secure) : undefined],
    ["smtp_user", config.user],
    ["smtp_pass", config.pass],
    ["email_from", config.fromEmail],
    ["email_from_name", config.fromName],
  ].filter(([, v]) => v !== undefined) as [string, string][];

  for (const [key, value] of entries) {
    await db.insert(systemSettingsTable).values({ key, value })
      .onConflictDoUpdate({ target: systemSettingsTable.key, set: { value, updatedAt: new Date() } });
  }
}

export { getEmailConfig };
