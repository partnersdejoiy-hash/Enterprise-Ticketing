import { ImapFlow } from "imapflow";
import { db, systemSettingsTable, emailAccountsTable, ticketsTable, usersTable, departmentsTable, eq, and } from "@workspace/db";

export interface ImapConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
  pollInterval: number;
  toAddress: string;
}

export async function getImapConfig(): Promise<ImapConfig> {
  try {
    const rows = await db.select().from(systemSettingsTable);
    const get = (k: string) => rows.find(r => r.key === k)?.value ?? "";
    return {
      enabled: get("imap_enabled") === "true",
      host: get("imap_host") || "",
      port: parseInt(get("imap_port") || "993"),
      secure: get("imap_secure") !== "false",
      user: get("imap_user") || "",
      pass: get("imap_pass") || "",
      mailbox: get("imap_mailbox") || "INBOX",
      pollInterval: Math.max(1, parseInt(get("imap_poll_interval") || "5")),
      toAddress: get("imap_to_address") || "",
    };
  } catch {
    return { enabled: false, host: "", port: 993, secure: true, user: "", pass: "", mailbox: "INBOX", pollInterval: 5, toAddress: "" };
  }
}

export async function saveImapConfig(config: Partial<ImapConfig>): Promise<void> {
  const entries: [string, string][] = ([
    ["imap_enabled", config.enabled !== undefined ? String(config.enabled) : undefined],
    ["imap_host", config.host],
    ["imap_port", config.port !== undefined ? String(config.port) : undefined],
    ["imap_secure", config.secure !== undefined ? String(config.secure) : undefined],
    ["imap_user", config.user],
    ["imap_pass", config.pass && config.pass !== "••••••••" ? config.pass : undefined],
    ["imap_mailbox", config.mailbox],
    ["imap_poll_interval", config.pollInterval !== undefined ? String(config.pollInterval) : undefined],
    ["imap_to_address", config.toAddress],
  ] as [string, string | undefined][]).filter(([, v]) => v !== undefined) as [string, string][];

  for (const [key, value] of entries) {
    await db.insert(systemSettingsTable).values({ key, value })
      .onConflictDoUpdate({ target: systemSettingsTable.key, set: { value, updatedAt: new Date() } });
  }
}

export async function testImapConnection(): Promise<{ ok: boolean; message: string; unseen?: number }> {
  const cfg = await getImapConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    return { ok: false, message: "IMAP not fully configured (host, username and password are required)." };
  }
  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false, tls: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const status = await client.status(cfg.mailbox || "INBOX", { messages: true, unseen: true });
    await client.logout();
    return { ok: true, message: `Connected successfully. Mailbox "${cfg.mailbox || "INBOX"}" has ${status.messages} messages (${status.unseen ?? 0} unread).`, unseen: status.unseen ?? 0 };
  } catch (err: any) {
    try { await client.logout(); } catch {}
    const msg = err.message ?? String(err);
    let friendly = `Connection failed: ${msg}`;
    if (/AUTHENTICATIONFAILED|Invalid credentials|auth.*fail/i.test(msg)) {
      friendly = "Authentication failed — the username or password is incorrect. For Gmail, use an App Password instead of your account password.";
    } else if (/Command failed/i.test(msg)) {
      friendly = "Command failed — the server rejected the IMAP command. Check your username/password, and ensure IMAP access is enabled in your mail provider settings (e.g. Gmail → Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP).";
    } else if (/ECONNREFUSED/i.test(msg)) {
      friendly = `Connection refused on port ${cfg.port} — the IMAP server is not accepting connections. Check the host name and port number.`;
    } else if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
      friendly = `Cannot resolve host "${cfg.host}" — check the IMAP host name for typos.`;
    } else if (/ETIMEDOUT|timeout/i.test(msg)) {
      friendly = `Connection timed out — the server at "${cfg.host}:${cfg.port}" is not responding. Check your firewall or VPN settings.`;
    } else if (/SELF_SIGNED|certificate/i.test(msg)) {
      friendly = "TLS certificate error — try disabling TLS/SSL if your server uses a self-signed certificate.";
    }
    return { ok: false, message: friendly };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function extractBody(source: string): string {
  const boundaryMatch = source.match(/boundary="?([^"\r\n;]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim();
    const parts = source.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"));
    for (const part of parts) {
      if (/content-type:\s*text\/plain/i.test(part)) {
        const m = part.match(/\r\n\r\n([\s\S]*)/);
        if (m) return m[1].replace(/\r\n/g, "\n").trim();
      }
    }
    for (const part of parts) {
      if (/content-type:\s*text\/html/i.test(part)) {
        const m = part.match(/\r\n\r\n([\s\S]*)/);
        if (m) return stripHtml(m[1].replace(/\r\n/g, "\n"));
      }
    }
  }
  const bodyMatch = source.match(/\r\n\r\n([\s\S]*)/);
  if (bodyMatch) {
    const body = bodyMatch[1].replace(/\r\n/g, "\n").trim();
    return /content-type.*text\/html/i.test(source) ? stripHtml(body) : body;
  }
  return "";
}

function genTicketNum(): string {
  return `TKT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

async function autoRouteDept(subject: string, body: string): Promise<number | undefined> {
  try {
    const depts = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable);
    const text = `${subject} ${body}`.toLowerCase();
    const find = (rx: RegExp) => depts.find(d => rx.test(d.name));
    const it    = find(/\bit\b|it support|information.?tech/i);
    const hr    = find(/hr|human.?resource/i);
    const fin   = find(/financ|accounts/i);
    const legal = find(/legal/i);
    const admin = find(/\badmin\b/i);
    if (/password|reset.*password|cannot.*login|account.*lock|vpn|laptop|computer|printer|software|hardware|network|wifi|wi-fi|it support|email.*setup|email.*access|system.*error|access.*denied|two.?factor|2fa|antivirus|malware|virus/.test(text)) return it?.id;
    if (/wfh|work.?from.?home|leave|salary|payroll|attendance|appraisal|performance.?review|joining|onboarding|resignation|offer.?letter|increment|promotion|transfer|pf\b|epf|esic|health.?insurance|id.?card|employee.?id|document.?request/.test(text)) return hr?.id;
    if (/invoic|payment|reimburs|expense|budget|finance|tax|audit|accounts|petty.?cash|purchase.?order|vendor.?payment/.test(text)) return fin?.id;
    if (/legal|contract|nda|compliance|agreement|clause|policy.?review|litigation/.test(text)) return legal?.id;
    if (/admin|office.?supply|stationary|stationery|pantry|housekeep|facility|parking|cab|transport|travel.?request|hotel.?booking|flight/.test(text)) return admin?.id;
  } catch {}
  return undefined;
}

async function pollAccount(cfg: {
  id?: number; host: string; port: number; secure: boolean;
  user: string; pass: string; mailbox: string; departmentId?: number | null;
}, creatorId: number): Promise<void> {
  const client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false, tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.mailbox || "INBOX");
    try {
      const unseen: { seq: number; envelope: any; source: string }[] = [];
      for await (const msg of client.fetch("1:*", { envelope: true, source: true, flags: true })) {
        if (!msg.flags?.has("\\Seen")) {
          unseen.push({ seq: msg.seq, envelope: msg.envelope, source: msg.source?.toString() ?? "" });
        }
      }
      console.error(`[imap] Account ${cfg.user}: ${unseen.length} unseen message(s) in ${cfg.mailbox}`);
      for (const msg of unseen) {
        try {
          const fromName = msg.envelope?.from?.[0]?.name || msg.envelope?.from?.[0]?.address || "Unknown Sender";
          const fromEmail = msg.envelope?.from?.[0]?.address || "";
          const subject = (msg.envelope?.subject || "(No Subject)").slice(0, 255);
          const body = extractBody(msg.source);
          const description = `${body || "(Empty body)"}\n\n---\nReceived from: ${fromName} <${fromEmail}>`;

          const [dup] = await db
            .select({ id: ticketsTable.id })
            .from(ticketsTable)
            .where(and(eq(ticketsTable.subject, subject), eq(ticketsTable.raisedForEmail as any, fromEmail)))
            .limit(1);

          if (dup) {
            await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
            continue;
          }

          const departmentId = cfg.departmentId ?? await autoRouteDept(subject, description);
          let slaDeadline: Date | null = null;
          if (departmentId) {
            const [dept] = await db.select({ slaResolutionHours: departmentsTable.slaResolutionHours }).from(departmentsTable).where(eq(departmentsTable.id, departmentId)).limit(1);
            if (dept) slaDeadline = new Date(Date.now() + dept.slaResolutionHours * 3600 * 1000);
          }

          await db.insert(ticketsTable).values({
            ticketNumber: genTicketNum(), subject, description,
            status: "open", priority: "medium",
            departmentId: departmentId ?? null,
            createdById: creatorId,
            raisedForName: fromName, raisedForEmail: fromEmail,
            tags: ["email-generated"], slaDeadline,
          } as any);

          await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
          console.error(`[imap] Created ticket from "${subject}" (${fromEmail}) via ${cfg.user}`);
        } catch (e) { console.error("[imap] Error processing message:", e); }
      }
    } finally { lock.release(); }
  } catch (err: any) {
    console.error(`[imap] Poll failed for ${cfg.user}: ${err.message}`);
  } finally {
    try { await client.logout(); } catch {}
  }
}

export async function pollAll(): Promise<void> {
  const [systemUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "super_admin" as any))
    .limit(1);
  const creatorId = systemUser?.id;
  if (!creatorId) return;

  // Poll accounts from the new email_accounts table
  const emailAccounts = await db.select().from(emailAccountsTable);
  const activeEmailAccounts = emailAccounts.filter(a => a.imapEnabled && a.imapHost && a.imapUser && a.imapPass);
  for (const acc of activeEmailAccounts) {
    await pollAccount({
      id: acc.id,
      host: acc.imapHost!, port: acc.imapPort ?? 993, secure: acc.imapSecure !== false,
      user: acc.imapUser!, pass: acc.imapPass!,
      mailbox: acc.imapMailbox || "INBOX",
      departmentId: acc.departmentId,
    }, creatorId).catch(e => console.error(`[imap] Error polling account ${acc.imapUser}:`, e));
  }

  // Also poll the legacy system_settings IMAP config (backward compat)
  const cfg = await getImapConfig();
  if (cfg.enabled && cfg.host && cfg.user && cfg.pass) {
    await pollAccount({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      user: cfg.user, pass: cfg.pass, mailbox: cfg.mailbox || "INBOX",
    }, creatorId).catch(e => console.error(`[imap] Error polling legacy account:`, e));
  }
}

let _timer: ReturnType<typeof setTimeout> | null = null;

async function getMinPollInterval(): Promise<number> {
  try {
    const accounts = await db.select({ imapEnabled: emailAccountsTable.imapEnabled, imapPollInterval: emailAccountsTable.imapPollInterval }).from(emailAccountsTable);
    const active = accounts.filter(a => a.imapEnabled);
    if (active.length > 0) {
      return Math.min(...active.map(a => Math.max(1, a.imapPollInterval ?? 5)));
    }
  } catch {}
  const cfg = await getImapConfig().catch(() => null);
  return cfg?.enabled ? (cfg.pollInterval || 5) : 5;
}

export async function startImapPoller(): Promise<void> {
  const emailAccounts = await db.select({ imapEnabled: emailAccountsTable.imapEnabled, imapHost: emailAccountsTable.imapHost }).from(emailAccountsTable).catch(() => []);
  const anyAccountEnabled = emailAccounts.some(a => a.imapEnabled && a.imapHost);

  const cfg = await getImapConfig().catch(() => null);
  const legacyEnabled = cfg?.enabled && !!cfg.host;

  if (!anyAccountEnabled && !legacyEnabled) {
    console.error("[imap] Poller not started (no enabled IMAP accounts).");
    return;
  }

  const intervalMin = await getMinPollInterval();
  const intervalMs = intervalMin * 60_000;

  const tick = async () => {
    try { await pollAll(); } catch (e) { console.error("[imap] tick error:", e); }
    _timer = setTimeout(tick, intervalMs);
  };
  _timer = setTimeout(tick, 30_000);
  console.error(`[imap] Poller started — polling ${activeAccountCount(emailAccounts, legacyEnabled)} account(s) every ${intervalMin} min`);
}

function activeAccountCount(accounts: { imapEnabled: boolean | null; imapHost: string | null }[], legacyEnabled: boolean): number {
  return accounts.filter(a => a.imapEnabled && a.imapHost).length + (legacyEnabled ? 1 : 0);
}

export async function restartImapPoller(): Promise<void> {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  await startImapPoller();
}
