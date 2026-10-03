import { pool } from "@workspace/db";
import { AI_POLICY, completeAi, type AiConfig } from "./ai-provider.js";

export interface ChatWorker {
  id: number;
  kind: "triage" | "draft" | "pa";
  name: string;
  enabled: boolean;
  department: string | null;
}

export async function chatRoster(): Promise<ChatWorker[]> {
  const { rows } = await pool.query(
    `SELECT w.id,w.kind,w.name,w.enabled,d.name AS department
     FROM orbit_ai_workers w LEFT JOIN departments d ON d.id=w.department_id
     ORDER BY CASE WHEN w.kind='pa' THEN 0 ELSE 1 END, d.name NULLS LAST, w.kind`,
  );
  return rows;
}

export function botDisplayName(w: Pick<ChatWorker, "name" | "kind">): string {
  return w.name?.trim() ? w.name : w.kind === "pa" ? "PA" : w.kind;
}

function personaFor(w: ChatWorker): string {
  const name = botDisplayName(w);
  if (w.kind === "pa")
    return `You are ${name}, the personal AI assistant to the workspace superadmin of DEJOIY OrbitDesk, and the MANAGER of the entire AI workforce (all worker bots across every department). You are helpful, concise and proactive. You have live read access to ticket data scoped to the person you're chatting with — when they ask about tickets, use the ticket list provided in your context to answer directly with real ticket IDs, titles, statuses and departments. Never say you lack access to ticket data. Never reveal tickets outside the provided list.`;
  const role =
    w.kind === "draft"
      ? "response-drafting specialist"
      : "triage and review specialist";
  const dept = w.department ?? "the workspace";
  return `You are ${name}, the ${dept} ${role} AI worker in the DEJOIY OrbitDesk AI workforce. You speak with the practical voice of that role.`;
}

function historyText(
  messages: { sender: string; author: string; content: string }[],
): string {
  return messages
    .map((m) => `${m.author}: ${m.content}`)
    .join("\n")
    .slice(-8000);
}

/**
 * Live ticket context for AI chat. Scoped by the CHATTING USER's permissions
 * (via ticketScope logic), not just the bot:
 * - admin/super_admin chatting with Mew: all open tickets platform-wide
 * - agent/manager: their department's tickets (+ personal)
 * - external: only their own tickets
 * Department workers are further restricted to their own department.
 * This prevents cross-department PII disclosure via AI chat.
 */
async function ticketContextFor(
  w: ChatWorker,
  actorId?: number,
): Promise<string> {
  try {
    // Fetch the chatting user for permission scoping.
    let user: { id: number; role: string; departmentId: number | null } | null =
      null;
    if (actorId) {
      const { rows } = await pool.query(
        `SELECT id, role, department_id AS "departmentId" FROM users WHERE id = $1 LIMIT 1`,
        [actorId],
      );
      user = rows[0] ?? null;
    }
    const isAdmin = !!user && ["admin", "super_admin"].includes(user.role);
    const isPa = w.kind === "pa";

    // Build the user-scoped ticket filter.
    // Admins: no filter (all tickets). Others: personal + department scope.
    let scopeFilter = "TRUE";
    const params: unknown[] = [];
    if (!isAdmin && user) {
      const conds: string[] = [];
      // Personal: created by, raised for, tagged, or assigned to the user.
      conds.push(
        `(t.created_by_id = $1 OR t.raised_for_user_id = $1 OR t.assignee_id = $1 OR $1 = ANY(t.tagged_user_ids))`,
      );
      params.push(user.id);
      // Department scope for agents/managers.
      if (
        ["agent", "manager"].includes(user.role) &&
        user.departmentId
      ) {
        conds.push(`(t.department_id = $${params.length + 1})`);
        params.push(user.departmentId);
      }
      scopeFilter = `(${conds.join(" OR ")})`;
    } else if (!isAdmin) {
      // No user context (shouldn't happen) — show nothing.
      scopeFilter = "FALSE";
    }

    // Department workers are additionally restricted to their own department.
    let deptFilter = "TRUE";
    if (!isPa) {
      deptFilter = `t.department_id = (SELECT department_id FROM orbit_ai_workers WHERE id = $${params.length + 1})`;
      params.push(w.id);
    }

    const { rows } = await pool.query(
      `SELECT t.ticket_number, t.subject, t.status, d.name AS department,
              COALESCE(u.name, 'unassigned') AS assignee
       FROM tickets t
       LEFT JOIN departments d ON d.id = t.department_id
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.status IN ('open','assigned','in_progress','waiting')
         AND ${scopeFilter} AND ${deptFilter}
       ORDER BY t.created_at DESC LIMIT ${isPa ? 60 : 40}`,
      params,
    );
    let ctx: string;
    if (!rows.length)
      ctx = isPa
        ? "\nLive ticket data: there are currently no open tickets on the platform."
        : `\nLive ticket data: there are currently no open tickets in ${w.department ?? "your department"}.`;
    else {
      const lines = rows.map(
        (r) =>
          `- ${r.ticket_number}: "${r.subject}" [${r.status}]` +
          (isPa && r.department ? ` (${r.department})` : "") +
          ` — ${r.assignee}`,
      );
      ctx =
        `\nLive ticket data (${rows.length} open tickets` +
        (isPa
          ? " across all departments"
          : ` in ${w.department ?? "your department"}`) +
        `, most recent first):\n` +
        lines.join("\n");
    }
    // Mew also gets the AI workforce roster as their manager.
    if (isPa) {
      const roster = await chatRoster();
      const workers = roster.filter((r) => r.kind !== "pa");
      const enabled = workers.filter((r) => r.enabled).length;
      ctx +=
        `\n\nAI workforce you manage: ${enabled}/${workers.length} workers enabled. ` +
        workers
          .map(
            (r) =>
              `${botDisplayName(r)} (${r.department ?? "?"}, ${r.kind}${r.enabled ? "" : ", DISABLED"})`,
          )
          .join("; ") +
        ".";
    }
    return ctx;
  } catch {
    return "";
  }
}

export async function replyAsBot(
  config: AiConfig,
  worker: ChatWorker,
  messages: { sender: string; author: string; content: string }[],
  huddleMates: string[],
  actorId?: number,
): Promise<string> {
  const ticketCtx = await ticketContextFor(worker, actorId);
  const system =
    AI_POLICY +
    "\n" +
    personaFor(worker) +
    ticketCtx +
    "\nYou are chatting in the OrbitDesk AI team chat. Keep replies short and conversational (under 120 words). Answer in the user's language." +
    (huddleMates.length
      ? `\nYou are in a group huddle with: ${huddleMates.join(", ")}. Read the discussion so far and add your perspective briefly — agree, disagree, or ask a question.`
      : "");
  const input =
    "Conversation so far:\n" +
    historyText(messages) +
    `\n\nNow reply as ${botDisplayName(worker)}.`;
  const result = await completeAi(config, system, input, "team-chat", actorId);
  return result.text;
}

export async function getOrCreateDirectThread(
  userId: number,
  workerId: number,
): Promise<number> {
  await pool.query(
    `INSERT INTO orbit_ai_chat_threads(user_id,kind,worker_id) VALUES($1,'direct',$2)
     ON CONFLICT DO NOTHING`,
    [userId, workerId],
  );
  const { rows } = await pool.query(
    `SELECT id FROM orbit_ai_chat_threads WHERE user_id=$1 AND kind='direct' AND worker_id=$2`,
    [userId, workerId],
  );
  return rows[0].id;
}

export async function createHuddle(
  userId: number,
  workerIds: number[],
  topic: string,
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO orbit_ai_chat_threads(user_id,kind,title) VALUES($1,'huddle',$2) RETURNING id`,
    [userId, topic.slice(0, 120)],
  );
  const threadId = rows[0].id;
  for (const wid of workerIds)
    await pool.query(
      `INSERT INTO orbit_ai_chat_participants(thread_id,worker_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [threadId, wid],
    );
  return threadId;
}

export async function threadOwnedBy(
  threadId: number,
  userId: number,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM orbit_ai_chat_threads WHERE id=$1 AND user_id=$2`,
    [threadId, userId],
  );
  return rows.length > 0;
}

export async function postMessage(opts: {
  threadId: number;
  sender: "user" | "bot";
  workerId?: number;
  userId?: number;
  content: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO orbit_ai_chat_messages(thread_id,sender,worker_id,user_id,content)
     VALUES($1,$2,$3,$4,$5)`,
    [
      opts.threadId,
      opts.sender,
      opts.workerId ?? null,
      opts.userId ?? null,
      opts.content,
    ],
  );
  await pool.query(
    `UPDATE orbit_ai_chat_threads SET updated_at=now() WHERE id=$1`,
    [opts.threadId],
  );
}

export async function markRead(threadId: number): Promise<void> {
  await pool.query(
    `UPDATE orbit_ai_chat_threads SET last_read_at=now() WHERE id=$1`,
    [threadId],
  );
}

export interface ThreadSummary {
  id: number;
  kind: "direct" | "huddle";
  title: string;
  worker_id: number | null;
  worker_name: string | null;
  worker_kind: string | null;
  department: string | null;
  participants: { id: number; name: string; kind: string }[];
  unread: number;
  last_message: string | null;
  last_message_at: string | null;
  updated_at: string;
}

export async function listThreads(userId: number): Promise<ThreadSummary[]> {
  const { rows } = await pool.query(
    `SELECT t.id,t.kind,t.title,t.worker_id,t.updated_at,
            w.name AS worker_name,w.kind AS worker_kind,d.name AS department,
            (SELECT count(*)::int FROM orbit_ai_chat_messages m
              WHERE m.thread_id=t.id AND m.sender='bot'
              AND (t.last_read_at IS NULL OR m.created_at>t.last_read_at)) AS unread,
            (SELECT m.content FROM orbit_ai_chat_messages m
              WHERE m.thread_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_message,
            (SELECT m.created_at FROM orbit_ai_chat_messages m
              WHERE m.thread_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_message_at
     FROM orbit_ai_chat_threads t
     LEFT JOIN orbit_ai_workers w ON w.id=t.worker_id
     LEFT JOIN departments d ON d.id=w.department_id
     WHERE t.user_id=$1 ORDER BY t.updated_at DESC`,
    [userId],
  );
  const parts = await pool.query(
    `SELECT p.thread_id,w.id,w.kind,w.name FROM orbit_ai_chat_participants p
     JOIN orbit_ai_workers w ON w.id=p.worker_id
     WHERE p.thread_id=ANY($1::int[]) ORDER BY w.id`,
    [rows.map((r: any) => r.id)],
  );
  const byThread = new Map<
    number,
    { id: number; name: string; kind: string }[]
  >();
  for (const p of parts.rows) {
    const list = byThread.get(p.thread_id) ?? [];
    list.push({ id: p.id, name: p.name, kind: p.kind });
    byThread.set(p.thread_id, list);
  }
  return rows.map((r: any) => ({
    ...r,
    participants: byThread.get(r.id) ?? [],
  }));
}

export interface ChatMessage {
  id: number;
  sender: "user" | "bot";
  author: string;
  worker_id: number | null;
  content: string;
  created_at: string;
}

export async function getMessages(
  threadId: number,
  userName: string,
): Promise<ChatMessage[]> {
  const { rows } = await pool.query(
    `SELECT m.id,m.sender,m.worker_id,m.user_id,m.content,m.created_at,w.name AS worker_name
     FROM orbit_ai_chat_messages m LEFT JOIN orbit_ai_workers w ON w.id=m.worker_id
     WHERE m.thread_id=$1 ORDER BY m.id ASC LIMIT 200`,
    [threadId],
  );
  return rows.map((m: any) => ({
    id: m.id,
    sender: m.sender,
    author:
      m.sender === "user"
        ? userName
        : m.worker_name?.trim()
          ? m.worker_name
          : "Bot",
    worker_id: m.worker_id,
    content: m.content,
    created_at: m.created_at,
  }));
}

export async function threadParticipants(
  threadId: number,
): Promise<ChatWorker[]> {
  const { rows } = await pool.query(
    `SELECT w.id,w.kind,w.name,w.enabled,d.name AS department
     FROM orbit_ai_chat_participants p
     JOIN orbit_ai_workers w ON w.id=p.worker_id
     LEFT JOIN departments d ON d.id=w.department_id
     WHERE p.thread_id=$1 ORDER BY w.id`,
    [threadId],
  );
  return rows;
}

/** Lightweight template message — no AI call, saves quota. */
export async function notifyJobReady(
  workerId: number,
  ticketId: number,
): Promise<void> {
  const w = await pool.query(
    `SELECT kind,name FROM orbit_ai_workers WHERE id=$1`,
    [workerId],
  );
  if (!w.rows[0]) return;
  const t = await pool.query(
    `SELECT ticket_number,created_by_id FROM tickets WHERE id=$1`,
    [ticketId],
  );
  if (!t.rows[0]?.created_by_id) return;
  const role = w.rows[0].kind === "triage" ? "triage review" : "response draft";
  const name = w.rows[0].name?.trim() || "Worker";
  const threadId = await getOrCreateDirectThread(
    t.rows[0].created_by_id,
    workerId,
  );
  await postMessage({
    threadId,
    sender: "bot",
    workerId,
    content: `Hi, ${name} here — my ${role} for ticket ${t.rows[0].ticket_number} is ready. Open the ticket's AI review workspace to review it.`,
  });
}

/** Mew's proactive briefing to superadmins — template based, no AI call. */
export async function notifyMewBriefing(
  readies: { workerName: string; department: string; ticketNumber: string }[],
): Promise<void> {
  if (!readies.length) return;
  const mew = await pool.query(
    `SELECT id FROM orbit_ai_workers WHERE kind='pa'`,
  );
  if (!mew.rows[0]) return;
  const mewId = mew.rows[0].id;
  const admins = await pool.query(
    `SELECT id FROM users WHERE role='super_admin' AND is_active=true`,
  );
  const bits = readies
    .slice(0, 6)
    .map((r) => `${r.workerName} (${r.department}) on ${r.ticketNumber}`);
  const extra = readies.length > 6 ? ` +${readies.length - 6} more` : "";
  const content = `Quick briefing: ${readies.length} AI output${readies.length > 1 ? "s" : ""} finished — ${bits.join("; ")}${extra}. Review them in the tickets' AI review workspace.`;
  for (const a of admins.rows) {
    const threadId = await getOrCreateDirectThread(a.id, mewId);
    await postMessage({ threadId, sender: "bot", workerId: mewId, content });
  }
}
