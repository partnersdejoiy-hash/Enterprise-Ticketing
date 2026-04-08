import { ImapFlow } from "imapflow";
import { db, systemSettingsTable, ticketsTable, usersTable, departmentsTable, automationRulesTable, eq, and } from "@workspace/db";
import type { AutomationCondition, AutomationAction } from "@workspace/db";

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
    return { ok: false, message: `Connection failed: ${err.message}` };
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

function matchesCondition(cond: AutomationCondition, ctx: Record<string, string>): boolean {
  const fieldVal = (ctx[cond.field] ?? "").toLowerCase();
  const val = cond.value.toLowerCase();
  switch (cond.operator) {
    case "contains": return fieldVal.includes(val);
    case "not_contains": return !fieldVal.includes(val);
    case "equals": return fieldVal === val;
    case "not_equals": return fieldVal !== val;
    case "starts_with": return fieldVal.startsWith(val);
    case "ends_with": return fieldVal.endsWith(val);
    case "matches_regex": try { return new RegExp(cond.value, "i").test(ctx[cond.field] ?? ""); } catch { return false; }
    default: return false;
  }
}

type TicketPatch = {
  departmentId?: number | null;
  priority?: string;
  status?: string;
  assignedToId?: number | null;
  tags?: string[];
  raisedForEmail?: string;
};

async function applyAutomationRules(emailCtx: {
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
}, current: TicketPatch): Promise<TicketPatch> {
  try {
    const rules = await db
      .select()
      .from(automationRulesTable)
      .where(eq(automationRulesTable.isActive, true))
      .orderBy(automationRulesTable.priority, automationRulesTable.id);

    const emailRules = rules.filter(r => r.triggerType === "email_received");
    const patch: TicketPatch = { ...current };

    for (const rule of emailRules) {
      const conditions = (rule.conditions ?? []) as AutomationCondition[];
      const actions = (rule.actions ?? []) as AutomationAction[];
      const logic = rule.conditionLogic ?? "AND";

      const results = conditions.map(c => matchesCondition(c, emailCtx as Record<string, string>));
      const matched = logic === "OR" ? results.some(Boolean) : results.every(Boolean);

      if (!matched) continue;

      console.error(`[automation] Rule "${rule.name}" matched for email from ${emailCtx.from_email}`);

      for (const action of actions) {
        switch (action.type) {
          case "set_department": {
            const depts = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable);
            const dept = depts.find(d => d.name.toLowerCase() === action.value.toLowerCase());
            if (dept) patch.departmentId = dept.id;
            break;
          }
          case "set_priority": {
            const validPriorities = ["low", "medium", "high", "urgent"];
            if (validPriorities.includes(action.value.toLowerCase())) {
              patch.priority = action.value.toLowerCase();
            }
            break;
          }
          case "set_status": {
            const validStatuses = ["open", "assigned", "in_progress", "waiting", "resolved", "closed"];
            if (validStatuses.includes(action.value.toLowerCase())) {
              patch.status = action.value.toLowerCase();
            }
            break;
          }
          case "assign_agent": {
            const [agent] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, action.value)).limit(1);
            if (agent) patch.assignedToId = agent.id;
            break;
          }
          case "add_tag": {
            if (!patch.tags) patch.tags = [];
            if (!patch.tags.includes(action.value)) patch.tags.push(action.value);
            break;
          }
          case "set_raised_for": {
            const resolvedVal = action.value.includes("{from_email}") ? action.value.replace("{from_email}", emailCtx.from_email) : action.value;
            patch.raisedForEmail = resolvedVal;
            break;
          }
        }
      }
    }
    return patch;
  } catch (err) {
    console.error("[automation] Error applying rules:", err);
    return current;
  }
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

async function pollOnce(): Promise<void> {
  const cfg = await getImapConfig();
  if (!cfg.enabled || !cfg.host || !cfg.user || !cfg.pass) return;

  const [systemUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "super_admin" as any))
    .limit(1);
  const creatorId = systemUser?.id;
  if (!creatorId) return;

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
      console.error(`[imap] Found ${unseen.length} unseen message(s) in ${cfg.mailbox}`);
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

          const keywordDeptId = await autoRouteDept(subject, description);
          const toEmail = cfg.user || "";
          const emailCtx = { from_email: fromEmail, to_email: toEmail, subject, body: description };
          const initialPatch: TicketPatch = {
            departmentId: keywordDeptId ?? null,
            priority: "medium",
            tags: ["email-generated"],
          };
          const patch = await applyAutomationRules(emailCtx, initialPatch);

          const finalDeptId = patch.departmentId ?? null;
          let slaDeadline: Date | null = null;
          if (finalDeptId) {
            const [dept] = await db.select({ slaResolutionHours: departmentsTable.slaResolutionHours }).from(departmentsTable).where(eq(departmentsTable.id, finalDeptId)).limit(1);
            if (dept) slaDeadline = new Date(Date.now() + dept.slaResolutionHours * 3600 * 1000);
          }

          await db.insert(ticketsTable).values({
            ticketNumber: genTicketNum(), subject, description,
            status: (patch.status as any) ?? "open",
            priority: (patch.priority as any) ?? "medium",
            departmentId: finalDeptId,
            createdById: creatorId,
            assignedToId: patch.assignedToId ?? null,
            raisedForName: fromName,
            raisedForEmail: patch.raisedForEmail ?? fromEmail,
            tags: patch.tags ?? ["email-generated"],
            slaDeadline,
          } as any);

          await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
          console.error(`[imap] Created ticket from "${subject}" (${fromEmail})`);
        } catch (e) { console.error("[imap] Error processing message:", e); }
      }
    } finally { lock.release(); }
  } catch (err: any) {
    console.error(`[imap] Poll failed: ${err.message}`);
  } finally {
    try { await client.logout(); } catch {}
  }
}

let _timer: ReturnType<typeof setTimeout> | null = null;

export async function startImapPoller(): Promise<void> {
  const cfg = await getImapConfig().catch(() => null);
  if (!cfg?.enabled || !cfg.host) {
    console.error("[imap] Poller not started (disabled or not configured).");
    return;
  }
  const intervalMs = (cfg.pollInterval || 5) * 60_000;
  const tick = async () => {
    try { await pollOnce(); } catch (e) { console.error("[imap] tick error:", e); }
    _timer = setTimeout(tick, intervalMs);
  };
  _timer = setTimeout(tick, 30_000);
  console.error(`[imap] Poller scheduled — interval: ${cfg.pollInterval} min, mailbox: ${cfg.mailbox}`);
}

export async function restartImapPoller(): Promise<void> {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  await startImapPoller();
}
