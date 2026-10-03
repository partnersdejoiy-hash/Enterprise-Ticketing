/**
 * Orbit SLA Engine.
 *
 * Real SLA computation over business hours:
 *  - SLA policies per department + priority (sla_policies)
 *  - Business calendars with work days/hours + holidays
 *  - Per-ticket SLA tracking (ticket_sla) with pause support
 *  - Deadline computation, breach detection, warning thresholds
 *
 * Predictive breach probability (#1) is computed by sla-predict.ts
 * (AI layer) using the signals this engine exposes.
 */

import { pool } from "@workspace/db";

export interface SlaPolicy {
  id: number;
  name: string;
  departmentId: number | null;
  priority: string | null;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  businessHoursOnly: boolean;
}

export interface BusinessCalendar {
  id: number;
  timezone: string;
  workDays: number[]; // 0=Sun..6=Sat
  workStart: string; // "09:00"
  workEnd: string; // "18:00"
  holidays: string[]; // YYYY-MM-DD
}

/** Find the best matching active policy for a ticket. */
export async function findPolicy(
  departmentId: number | null,
  priority: string,
): Promise<SlaPolicy | null> {
  const { rows } = await pool.query(
    `SELECT id, name, department_id AS "departmentId", priority,
            first_response_minutes AS "firstResponseMinutes",
            resolution_minutes AS "resolutionMinutes",
            business_hours_only AS "businessHoursOnly"
     FROM sla_policies
     WHERE is_active AND (department_id IS NULL OR department_id = $1)
       AND (priority IS NULL OR priority = $2)
     ORDER BY (department_id IS NOT NULL) DESC, (priority IS NOT NULL) DESC
     LIMIT 1`,
    [departmentId, priority],
  );
  return (rows[0] as SlaPolicy) ?? null;
}

/** Default calendar (or first). Seeds a sensible default if none exists. */
export async function getCalendar(): Promise<BusinessCalendar> {
  let { rows } = await pool.query(
    `SELECT c.id, c.timezone, c.work_days AS "workDays",
            c.work_start::text AS "workStart", c.work_end::text AS "workEnd",
            COALESCE(array_agg(h.holiday_date::text) FILTER (WHERE h.id IS NOT NULL), '{}') AS holidays
     FROM business_calendars c
     LEFT JOIN holidays h ON h.calendar_id = c.id
     GROUP BY c.id ORDER BY c.is_default DESC, c.id ASC LIMIT 1`,
  );
  if (!rows[0]) {
    const ins = await pool.query(
      `INSERT INTO business_calendars (name, timezone, is_default)
       VALUES ('Default (IST Mon-Fri 9-6)', 'Asia/Kolkata', true) RETURNING id`,
    );
    rows = [
      {
        id: ins.rows[0].id, timezone: "Asia/Kolkata",
        workDays: [1, 2, 3, 4, 5], workStart: "09:00:00", workEnd: "18:00:00",
        holidays: [],
      },
    ];
  }
  return rows[0] as BusinessCalendar;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Add N business minutes to a date, skipping non-work days/hours/holidays.
 * All math in the calendar's timezone is approximated in UTC using the
 * Asia/Kolkata default; for other timezones the caller should convert.
 * (Keeps the engine dependency-free; precise tz via Luxon can replace later.)
 */
export function addBusinessMinutes(
  from: Date, minutes: number, cal: BusinessCalendar,
): Date {
  if (minutes <= 0) return new Date(from);
  const workStart = toMinutes(cal.workStart);
  const workEnd = toMinutes(cal.workEnd);
  const holidaySet = new Set(cal.holidays);
  // Work in IST wall-clock for the default calendar.
  const offsetMs = 5.5 * 60 * 60 * 1000;
  let cursor = new Date(from.getTime());
  let remaining = minutes;

  const pad = (n: number) => String(n).padStart(2, "0");
  const dayKey = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  // Safety bound: 365 days.
  for (let i = 0; i < 365 && remaining > 0; i++) {
    const ist = new Date(cursor.getTime() + offsetMs);
    const dow = ist.getUTCDay();
    const key = dayKey(ist);
    const isWorkDay = cal.workDays.includes(dow) && !holidaySet.has(key);
    if (isWorkDay) {
      const dayStart = new Date(ist);
      dayStart.setUTCHours(0, 0, 0, 0);
      const windowStart = new Date(dayStart.getTime() - offsetMs + workStart * 60000);
      const windowEnd = new Date(dayStart.getTime() - offsetMs + workEnd * 60000);
      if (cursor < windowStart) cursor = new Date(windowStart);
      if (cursor < windowEnd) {
        const availMin = Math.floor((windowEnd.getTime() - cursor.getTime()) / 60000);
        const use = Math.min(availMin, remaining);
        cursor = new Date(cursor.getTime() + use * 60000);
        remaining -= use;
      }
    }
    if (remaining > 0) {
      // Jump to next day 00:00 IST.
      const istNow = new Date(cursor.getTime() + offsetMs);
      istNow.setUTCHours(0, 0, 0, 0);
      cursor = new Date(istNow.getTime() - offsetMs + 24 * 60 * 60000);
    }
  }
  return cursor;
}

/** Business minutes elapsed between two timestamps (for elapsed calc). */
export function businessMinutesBetween(
  from: Date, to: Date, cal: BusinessCalendar,
): number {
  if (to <= from) return 0;
  const workStart = toMinutes(cal.workStart);
  const workEnd = toMinutes(cal.workEnd);
  const holidaySet = new Set(cal.holidays);
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const pad = (n: number) => String(n).padStart(2, "0");
  let total = 0;
  let day = new Date(from.getTime() + offsetMs);
  day.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(to.getTime() + offsetMs);

  for (let i = 0; i < 370; i++) {
    const dow = day.getUTCDay();
    const key = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
    if (cal.workDays.includes(dow) && !holidaySet.has(key)) {
      const ws = new Date(day.getTime() - offsetMs + workStart * 60000);
      const we = new Date(day.getTime() - offsetMs + workEnd * 60000);
      const s = new Date(Math.max(ws.getTime(), from.getTime()));
      const e = new Date(Math.min(we.getTime(), to.getTime()));
      if (e > s) total += (e.getTime() - s.getTime()) / 60000;
    }
    day = new Date(day.getTime() + 24 * 60 * 60000);
    if (day.getTime() - offsetMs > endDay.getTime()) break;
  }
  return Math.round(total);
}

/**
 * Ensure a ticket_sla row exists for a ticket (idempotent).
 * Called on ticket creation and policy changes.
 */
export async function ensureTicketSla(
  ticketId: number,
  departmentId: number | null,
  priority: string,
  createdAt: Date,
): Promise<void> {
  const policy = await findPolicy(departmentId, priority);
  if (!policy) return;
  const cal = await getCalendar();
  const base = policy.businessHoursOnly
    ? { from: createdAt, cal }
    : null;
  const firstDue = base
    ? addBusinessMinutes(base.from, policy.firstResponseMinutes, base.cal)
    : new Date(createdAt.getTime() + policy.firstResponseMinutes * 60000);
  const resDue = base
    ? addBusinessMinutes(base.from, policy.resolutionMinutes, base.cal)
    : new Date(createdAt.getTime() + policy.resolutionMinutes * 60000);

  await pool.query(
    `INSERT INTO ticket_sla (ticket_id, policy_id, first_response_due_at, resolution_due_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (ticket_id) DO UPDATE SET
       policy_id = EXCLUDED.policy_id,
       first_response_due_at = EXCLUDED.first_response_due_at,
       resolution_due_at = EXCLUDED.resolution_due_at,
       updated_at = now()`,
    [ticketId, policy.id, firstDue.toISOString(), resDue.toISOString()],
  );
}

export interface SlaStatus {
  ticketId: number;
  policyName: string | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  elapsedBusinessMinutes: number;
  remainingBusinessMinutes: number | null;
  health: "safe" | "at_risk" | "critical" | "breached" | "met" | "no_policy";
  percentElapsed: number | null;
}

/** Compute live SLA status for a ticket. */
export async function getSlaStatus(ticketId: number): Promise<SlaStatus> {
  const { rows } = await pool.query(
    `SELECT s.first_response_due_at AS "firstResponseDueAt",
            s.resolution_due_at AS "resolutionDueAt",
            s.first_response_at AS "firstResponseAt",
            s.resolved_at AS "resolvedAt",
            s.paused_seconds AS "pausedSeconds",
            p.name AS "policyName", p.resolution_minutes AS "resolutionMinutes",
            p.business_hours_only AS "businessHoursOnly",
            t.created_at AS "createdAt", t.status
     FROM ticket_sla s
     JOIN tickets t ON t.id = s.ticket_id
     LEFT JOIN sla_policies p ON p.id = s.policy_id
     WHERE s.ticket_id = $1`,
    [ticketId],
  );
  const row = rows[0];
  if (!row) {
    return {
      ticketId, policyName: null, firstResponseDueAt: null,
      resolutionDueAt: null, elapsedBusinessMinutes: 0,
      remainingBusinessMinutes: null, health: "no_policy", percentElapsed: null,
    };
  }
  if (row.resolvedAt) {
    return {
      ticketId, policyName: row.policyName,
      firstResponseDueAt: row.firstResponseDueAt,
      resolutionDueAt: row.resolutionDueAt,
      elapsedBusinessMinutes: 0, remainingBusinessMinutes: 0,
      health: "met", percentElapsed: 100,
    };
  }
  const now = new Date();
  const due = row.resolutionDueAt ? new Date(row.resolutionDueAt) : null;
  const created = new Date(row.createdAt);
  const cal = await getCalendar();

  let elapsed: number;
  let total: number | null = null;
  if (row.businessHoursOnly) {
    elapsed = businessMinutesBetween(created, now, cal);
    total = row.resolutionMinutes ?? null;
  } else {
    elapsed = Math.round((now.getTime() - created.getTime()) / 60000);
    total = due ? Math.round((due.getTime() - created.getTime()) / 60000) : null;
  }
  // Subtract paused time.
  elapsed = Math.max(0, elapsed - Math.round((row.pausedSeconds ?? 0) / 60));

  if (due && now > due) {
    return {
      ticketId, policyName: row.policyName,
      firstResponseDueAt: row.firstResponseDueAt, resolutionDueAt: row.resolutionDueAt,
      elapsedBusinessMinutes: elapsed,
      remainingBusinessMinutes: 0, health: "breached", percentElapsed: 100,
    };
  }
  const percent = total ? Math.min(100, (elapsed / total) * 100) : null;
  const health =
    percent == null ? "safe"
    : percent >= 90 ? "critical"
    : percent >= 70 ? "at_risk" : "safe";
  let remaining: number | null = null;
  if (due) {
    remaining = row.businessHoursOnly
      ? businessMinutesBetween(now, due, cal)
      : Math.max(0, Math.round((due.getTime() - now.getTime()) / 60000));
  }
  return {
    ticketId, policyName: row.policyName,
    firstResponseDueAt: row.firstResponseDueAt, resolutionDueAt: row.resolutionDueAt,
    elapsedBusinessMinutes: elapsed, remainingBusinessMinutes: remaining,
    health, percentElapsed: percent != null ? Math.round(percent) : null,
  };
}

/** Pause SLA clock (e.g. waiting on customer). */
export async function pauseSla(ticketId: number): Promise<void> {
  await pool.query(
    `UPDATE ticket_sla SET pause_started_at = now(), updated_at = now()
     WHERE ticket_id = $1 AND pause_started_at IS NULL`,
    [ticketId],
  );
}

/** Resume SLA clock, accumulating paused seconds. */
export async function resumeSla(ticketId: number): Promise<void> {
  await pool.query(
    `UPDATE ticket_sla
     SET paused_seconds = paused_seconds +
           EXTRACT(EPOCH FROM (now() - pause_started_at))::integer,
         pause_started_at = NULL, updated_at = now()
     WHERE ticket_id = $1 AND pause_started_at IS NOT NULL`,
    [ticketId],
  );
}
