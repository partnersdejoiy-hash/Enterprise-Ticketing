import { pool } from "@workspace/db";
import { randomUUID, createHash } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import {
  AI_POLICY,
  completeAi,
  getAiConfig,
  providerConfigured,
} from "./ai-provider.js";
import { notifyJobReady, notifyMewBriefing } from "./ai-team-chat.js";
export async function ensureAiWorkers() {
  await pool.query(
    "INSERT INTO orbit_ai_workers(department_id,kind) SELECT d.id,k.kind FROM departments d CROSS JOIN (VALUES ('triage'),('draft')) k(kind) ON CONFLICT DO NOTHING",
  );
  await pool.query(
    "INSERT INTO orbit_ai_workers(kind) VALUES('pa') ON CONFLICT DO NOTHING",
  );
}
export function workflowContext(ticket: {
  department: string;
  status: string;
  priority: string;
  sla_breached: boolean;
}) {
  // Deliberately exclude subject, description, identities, tags, comments and attachments.
  return {
    department: ticket.department,
    status: ticket.status,
    priority: ticket.priority,
    slaBreached: ticket.sla_breached,
  };
}
export async function enqueueAiTicket(ticketId: number) {
  const c = await getAiConfig();
  if (!c.enabled || !providerConfigured(c)) return;
  await ensureAiWorkers();
  const { rows } = await pool.query(
    "SELECT t.department_id,t.status,t.priority,t.sla_breached,d.name AS department FROM tickets t JOIN departments d ON d.id=t.department_id WHERE t.id=$1 AND t.status NOT IN ('resolved','closed')",
    [ticketId],
  );
  if (!rows[0]) return;
  const context = workflowContext(rows[0]);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(context))
    .digest("hex")
    .slice(0, 24);
  await pool.query(
    "INSERT INTO orbit_ai_jobs(worker_id,ticket_id,revision) SELECT id,$1,$2||':'||revision::text FROM orbit_ai_workers WHERE department_id=$3 AND enabled=true ON CONFLICT DO NOTHING",
    [ticketId, `${c.revision}:${fingerprint}`, rows[0].department_id],
  );
}
export async function processAiJobs(ticketId?: number) {
  const c = await getAiConfig();
  if (!c.enabled || !providerConfigured(c)) return { processed: 0 };
  await pool.query(
    "UPDATE orbit_ai_jobs SET status='failed',error='Worker timed out after three attempts. Superadmin review required.',updated_at=now() WHERE status='working' AND lease_until<now() AND attempts>=3",
  );
  const token = randomUUID();
  // Claim at most two jobs atomically. Expired leases may retry, but at most three times.
  const claimed = await pool.query(
    `WITH picked AS (
 SELECT j.id FROM orbit_ai_jobs j JOIN orbit_ai_workers w ON w.id=j.worker_id JOIN tickets t ON t.id=j.ticket_id
 WHERE w.enabled AND w.department_id=t.department_id AND t.status NOT IN ('resolved','closed') AND j.attempts<3
 AND (j.status='queued' OR (j.status='working' AND j.lease_until<now()))
 AND ($1::integer IS NULL OR j.ticket_id=$1) ORDER BY j.id FOR UPDATE OF j SKIP LOCKED LIMIT 2
 ) UPDATE orbit_ai_jobs j SET status='working',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '1 minute',updated_at=now()
 FROM picked WHERE j.id=picked.id RETURNING j.*`,
    [ticketId ?? null, token],
  );
  const readies: {
    workerName: string;
    department: string;
    ticketNumber: string;
  }[] = [];
  await Promise.all(
    claimed.rows.map(async (job) => {
      const { rows } = await pool.query(
        "SELECT w.kind,w.revision,w.enabled,t.status,t.priority,t.sla_breached,d.name AS department FROM orbit_ai_workers w JOIN tickets t ON t.id=$2 JOIN departments d ON d.id=t.department_id WHERE w.id=$1 AND w.department_id=t.department_id",
        [job.worker_id, job.ticket_id],
      );
      const w = rows[0];
      try {
        if (
          !w?.enabled ||
          !job.revision.startsWith(`${c.revision}:`) ||
          !job.revision.endsWith(`:${w.revision}`)
        )
          throw Error("cancelled");
        const instruction =
          w.kind === "triage"
            ? "Write a short review checklist for this department queue. Point out urgent/SLA review where indicated."
            : "Write a neutral acknowledgement draft with placeholders, followed by next-step questions for the staff reviewer. Do not invent investigation results or deadlines.";
        const output = await completeAi(
          c,
          AI_POLICY,
          `${instruction}\nWorkflow metadata: ${JSON.stringify(workflowContext(w))}`,
          "worker",
        );
        const latest = await getAiConfig();
        const check = await pool.query(
          "SELECT w.enabled,w.revision,t.status,t.department_id,w.department_id AS worker_department FROM orbit_ai_workers w JOIN tickets t ON t.id=$2 WHERE w.id=$1",
          [job.worker_id, job.ticket_id],
        );
        const current = check.rows[0];
        if (
          !latest.enabled ||
          latest.revision !== c.revision ||
          !current?.enabled ||
          current.revision !== w.revision ||
          current.department_id !== current.worker_department ||
          ["resolved", "closed"].includes(current.status)
        )
          throw Error("cancelled");
        await pool.query(
          "UPDATE orbit_ai_jobs SET status='ready',output=$1,model=$2,error=NULL,lease_until=NULL,updated_at=now() WHERE id=$3 AND lease_token=$4 AND status='working'",
          [output.text, output.model, job.id, token],
        );
        try {
          const info = await pool.query(
            `SELECT w.name,w.kind,d.name AS department, t.ticket_number AS "ticketNumber"
             FROM orbit_ai_workers w LEFT JOIN departments d ON d.id=w.department_id
             JOIN tickets t ON t.id=$2 WHERE w.id=$1`,
            [job.worker_id, job.ticket_id],
          );
          const row = info.rows[0];
          if (row?.ticketNumber)
            readies.push({
              workerName:
                row.name?.trim() ||
                (row.kind === "pa" ? "PA" : String(row.kind)),
              department: row.department ?? "",
              ticketNumber: row.ticketNumber,
            });
          await notifyJobReady(job.worker_id, job.ticket_id);
        } catch {
          /* Chat notifications are best-effort; never break job processing. */
        }
      } catch (e) {
        const cancelled = e instanceof Error && e.message === "cancelled";
        await pool.query(
          "UPDATE orbit_ai_jobs SET status=$1,error=$2,lease_until=NULL,updated_at=now() WHERE id=$3 AND lease_token=$4 AND status='working'",
          [
            cancelled ? "cancelled" : "failed",
            cancelled
              ? "Worker, ticket or configuration changed."
              : e instanceof Error
                ? e.message
                : "AI unavailable",
            job.id,
            token,
          ],
        );
      }
    }),
  );
  if (readies.length) {
    try {
      await notifyMewBriefing(readies);
    } catch {
      /* Chat notifications are best-effort; never break job processing. */
    }
  }
  return { processed: claimed.rowCount };
}
export function scheduleAiTicket(ticketId: number) {
  const work = enqueueAiTicket(ticketId)
    .then(() => processAiJobs(ticketId))
    .catch(() => console.error("[ai] Work queue unavailable", { ticketId }));
  if (process.env.VERCEL) waitUntil(work);
  return work;
}
export async function workforceReport() {
  const summary = await pool.query(`SELECT d.id,d.name,
 (SELECT count(*)::int FROM tickets t WHERE t.department_id=d.id AND t.status NOT IN ('resolved','closed')) AS open_tickets,
 (SELECT count(*)::int FROM tickets t WHERE t.department_id=d.id AND t.assignee_id IS NULL AND t.status NOT IN ('resolved','closed')) AS unassigned,
 (SELECT count(*)::int FROM tickets t WHERE t.department_id=d.id AND t.sla_breached AND t.status NOT IN ('resolved','closed')) AS sla_breached,
 (SELECT count(*)::int FROM orbit_ai_workers w WHERE w.department_id=d.id AND w.enabled) AS enabled_workers,
 (SELECT count(*)::int FROM orbit_ai_jobs j JOIN orbit_ai_workers w ON w.id=j.worker_id WHERE w.department_id=d.id AND j.status='ready') AS drafts,
 (SELECT count(*)::int FROM orbit_ai_jobs j JOIN orbit_ai_workers w ON w.id=j.worker_id WHERE w.department_id=d.id AND j.status='failed') AS failed_jobs
 FROM departments d ORDER BY d.name`);
  return summary.rows;
}
