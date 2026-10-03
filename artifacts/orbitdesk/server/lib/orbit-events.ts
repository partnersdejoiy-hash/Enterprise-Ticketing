/**
 * OrbitDesk Domain Event Bus — the backbone of the Maha Kaali Superpowers Engine.
 *
 * Every significant domain change emits a typed event into `domain_events`.
 * AI features, automation, notifications, SLA evaluation and analytics all
 * consume from this log. Events are persistent (not in-memory pub/sub) so
 * background workers and future consumers never miss anything.
 *
 * Usage:
 *   import { emitEvent } from "./orbit-events.js";
 *   await emitEvent({ type: "ticket.created", entityType: "ticket",
 *                    entityId: String(ticket.id), actorId: user.id, payload: {...} });
 *
 * Handlers register via onEvent() and are invoked by processEventQueue()
 * (called from the cron worker). Handlers must be idempotent.
 */

import { pool } from "@workspace/db";

export type ActorType = "user" | "ai" | "automation" | "system";

export interface DomainEventInput {
  type: string; // e.g. "ticket.created"
  entityType: string; // ticket | incident | change | ...
  entityId: string;
  actorId?: number | null;
  actorType?: ActorType;
  tenantId?: number | null;
  payload?: Record<string, unknown>;
}

type EventHandler = (event: DomainEventInput & { id: number }) => Promise<void>;

const handlers = new Map<string, EventHandler[]>();

/** Register a handler for an event type. Handlers must be idempotent. */
export function onEvent(type: string, handler: EventHandler): void {
  const list = handlers.get(type) ?? [];
  list.push(handler);
  handlers.set(type, list);
}

/** Persist an event. Delivery to handlers happens via processEventQueue. */
export async function emitEvent(input: DomainEventInput): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO domain_events
       (tenant_id, event_type, entity_type, entity_id, actor_id, actor_type, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
    [
      input.tenantId ?? null,
      input.type,
      input.entityType,
      input.entityId,
      input.actorId ?? null,
      input.actorType ?? "user",
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return rows[0].id as number;
}

/**
 * Process unprocessed events. The cron worker calls this periodically.
 * Tracks progress via a watermark in system_settings (orbit_event_watermark).
 * Each handler runs in try/catch so one failure never blocks the rest.
 */
export async function processEventQueue(batchSize = 100): Promise<number> {
  const { rows: wmRows } = await pool.query(
    `SELECT value FROM system_settings WHERE key = 'orbit_event_watermark' LIMIT 1`,
  );
  const watermark = wmRows[0] ? Number(wmRows[0].value) : 0;

  const { rows } = await pool.query(
    `SELECT id, tenant_id AS "tenantId", event_type AS type,
            entity_type AS "entityType", entity_id AS "entityId",
            actor_id AS "actorId", actor_type AS "actorType", payload
     FROM domain_events WHERE id > $1 ORDER BY id ASC LIMIT $2`,
    [watermark, batchSize],
  );

  let processed = 0;
  let maxId = watermark;
  for (const row of rows) {
    const eventHandlers = handlers.get(row.type) ?? [];
    for (const handler of eventHandlers) {
      try {
        await handler(row);
      } catch (err) {
        console.error(
          `[orbit-events] handler failed for ${row.type}#${row.id}:`,
          err,
        );
      }
    }
    maxId = Math.max(maxId, row.id);
    processed++;
  }

  if (processed > 0) {
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ('orbit_event_watermark', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(maxId)],
    );
  }
  return processed;
}

/** Convenience: the canonical event types emitted across the platform. */
export const EventTypes = {
  TICKET_CREATED: "ticket.created",
  TICKET_UPDATED: "ticket.updated",
  TICKET_ASSIGNED: "ticket.assigned",
  TICKET_STATUS_CHANGED: "ticket.status_changed",
  TICKET_PRIORITY_CHANGED: "ticket.priority_changed",
  TICKET_SLA_WARNING: "ticket.sla_warning",
  TICKET_SLA_BREACHED: "ticket.sla_breached",
  INCIDENT_CREATED: "incident.created",
  INCIDENT_UPDATED: "incident.updated",
  INCIDENT_RESOLVED: "incident.resolved",
  PROBLEM_CREATED: "problem.created",
  CHANGE_CREATED: "change.created",
  CHANGE_APPROVED: "change.approved",
  CHANGE_COMPLETED: "change.completed",
  MONITORING_ALERT: "monitoring.alert",
  AUTOMATION_EXECUTED: "automation.executed",
  AI_ANALYSIS_COMPLETED: "ai.analysis_completed",
  TRIAGE_COMPLETED: "ai.triage_completed",
  RCA_HYPOTHESIS_PROPOSED: "rca.hypothesis_proposed",
  RISK_PREDICTED: "risk.predicted",
  RESOLUTION_PLAN_PROPOSED: "resolution.plan_proposed",
  RESOLUTION_PLAN_EXECUTED: "resolution.plan_executed",
} as const;
