/**
 * Event Intelligence (#9) — Monitoring → Ticket → Incident correlation.
 *
 * Ingest pipeline for monitoring events (Zabbix, Datadog, Prometheus, …):
 *   1. Validate + normalize the incoming event.
 *   2. Dedup: same fingerprint within the last 15 minutes → bump dedup_count,
 *      refresh last_seen_at, do not re-create incidents/tickets.
 *   3. Correlate: same service_name or host as an event already linked to an
 *      OPEN incident (incident started within the last 2 hours) → attach to
 *      that incident via event_correlations.
 *   4. Otherwise, if severity is critical/high → create an incident +
 *      linked ticket, and record a fingerprint correlation at 100% confidence.
 *   5. Emit MONITORING_ALERT (always), INCIDENT_CREATED / TICKET_CREATED
 *      when applicable, on the domain event bus.
 *
 * Pure helpers (computeFingerprint, withinDedupWindow, pickCorrelation,
 * validateIngestInput) are exported for unit testing.
 */

import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { emitEvent, EventTypes } from "./orbit-events.js";
import { digest, constantEqual } from "./security.js";

export const MONITORING_SEVERITIES = [
  "critical",
  "high",
  "warning",
  "info",
] as const;
export type MonitoringSeverity = (typeof MONITORING_SEVERITIES)[number];

const DEDUP_WINDOW_MINUTES = 15;
const CORRELATION_WINDOW_HOURS = 2;

const MAX_LENGTHS = {
  source: 64,
  title: 300,
  message: 4000,
  serviceName: 160,
  host: 160,
} as const;

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export interface ApiKeyInfo {
  id: number;
  tenant_id: number | null;
  name: string;
  created_by_id: number | null;
}

/** Generate an `odm_<32 random hex>` key; only the SHA-256 hash is stored. */
export function generateApiKey(): {
  key: string;
  keyHash: string;
  keyPrefix: string;
} {
  const key = "odm_" + randomBytes(32).toString("hex");
  return { key, keyHash: digest(key), keyPrefix: key.slice(0, 8) };
}

/**
 * Verify an ingest API key. Returns key info on success, null when the key
 * is missing/invalid/revoked or the key table does not exist yet (fail
 * closed — callers respond 401). Updates last_used_at on success.
 */
export async function verifyApiKey(
  key: string,
): Promise<ApiKeyInfo | null> {
  if (!key || typeof key !== "string") return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, tenant_id, name, key_hash, created_by_id
       FROM monitoring_api_keys
       WHERE is_active = true AND key_hash = $1
       LIMIT 1`,
      [digest(key)],
    );
    const row = rows[0];
    if (!row) return null;
    // Timing-safe comparison on the hash (defense in depth: the lookup
    // above is already exact, but a leak-through of the WHERE clause into a
    // partial row should not authenticate).
    if (!constantEqual(row.key_hash, digest(key))) return null;
    await pool.query(
      `UPDATE monitoring_api_keys SET last_used_at = now() WHERE id = $1`,
      [row.id],
    );
    return {
      id: row.id as number,
      tenant_id: (row.tenant_id ?? null) as number | null,
      name: row.name as string,
      created_by_id: (row.created_by_id ?? null) as number | null,
    };
  } catch {
    // Fail closed: missing table, DB error → key is not usable.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation + normalization (pure)
// ---------------------------------------------------------------------------

export interface IngestInput {
  source?: unknown;
  severity?: unknown;
  title?: unknown;
  message?: unknown;
  service_name?: unknown;
  host?: unknown;
  ci_id?: unknown;
  raw_payload?: unknown;
}

export interface NormalizedEvent {
  source: string;
  severity: MonitoringSeverity;
  title: string;
  message: string | null;
  service_name: string | null; // trimmed + lowercased
  host: string | null; // trimmed + lowercased
  ci_id: number | null;
  raw_payload: Record<string, unknown>;
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required and must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed === "" ? null : trimmed;
}

/** Validate + normalize a raw ingest payload. Throws on invalid input. */
export function validateIngestInput(input: IngestInput): NormalizedEvent {
  if (!input || typeof input !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  const source = requiredString(input.source, "source", MAX_LENGTHS.source);
  const title = requiredString(input.title, "title", MAX_LENGTHS.title);
  const severityRaw = requiredString(
    input.severity,
    "severity",
    16,
  ).toLowerCase();
  if (
    !(MONITORING_SEVERITIES as readonly string[]).includes(severityRaw)
  ) {
    throw new Error(
      `severity must be one of ${MONITORING_SEVERITIES.join(", ")}`,
    );
  }
  const message = optionalString(input.message, "message", MAX_LENGTHS.message);
  const serviceRaw = optionalString(
    input.service_name,
    "service_name",
    MAX_LENGTHS.serviceName,
  );
  const hostRaw = optionalString(input.host, "host", MAX_LENGTHS.host);
  let ciId: number | null = null;
  if (input.ci_id !== undefined && input.ci_id !== null) {
    const n =
      typeof input.ci_id === "number"
        ? input.ci_id
        : typeof input.ci_id === "string" && /^\d+$/.test(input.ci_id.trim())
          ? Number(input.ci_id.trim())
          : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new Error("ci_id must be a positive integer");
    }
    ciId = n;
  }
  let rawPayload: Record<string, unknown> = {};
  if (input.raw_payload !== undefined && input.raw_payload !== null) {
    if (
      typeof input.raw_payload !== "object" ||
      Array.isArray(input.raw_payload)
    ) {
      throw new Error("raw_payload must be a JSON object");
    }
    rawPayload = input.raw_payload as Record<string, unknown>;
  }
  return {
    source,
    severity: severityRaw as MonitoringSeverity,
    title,
    message,
    service_name: serviceRaw ? serviceRaw.toLowerCase() : null,
    host: hostRaw ? hostRaw.toLowerCase() : null,
    ci_id: ciId,
    raw_payload: rawPayload,
  };
}

/** Stable dedup/correlation key. service_name/host are normalized by the caller. */
export function computeFingerprint(event: {
  source: string;
  title: string;
  host?: string | null;
  service_name?: string | null;
}): string {
  const source = event.source.trim();
  const title = event.title.trim();
  const host = (event.host ?? "").trim().toLowerCase();
  const svc = (event.service_name ?? "").trim().toLowerCase();
  return createHash("sha256")
    .update(`${source}|${title}|${host}|${svc}`)
    .digest("hex");
}

/** Pure check for the dedup window (injectable `now` for tests). */
export function withinDedupWindow(
  lastSeenAt: Date | string,
  windowMinutes = DEDUP_WINDOW_MINUTES,
  now: Date = new Date(),
): boolean {
  const last = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  return now.getTime() - last.getTime() < windowMinutes * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Correlation matching (pure)
// ---------------------------------------------------------------------------

export interface CorrelationCandidate {
  incidentId: number;
  serviceName: string | null;
  host: string | null;
}

export type CorrelationType = "fingerprint" | "service" | "host";

/**
 * Pick the best correlation for an event among candidates. A same-service
 * match wins over a same-host match (services are more specific). Returns
 * null when nothing matches.
 */
export function pickCorrelation(
  event: { service_name: string | null; host: string | null },
  candidates: CorrelationCandidate[],
): { incidentId: number; correlationType: "service" | "host" } | null {
  const svc = event.service_name?.trim().toLowerCase();
  const host = event.host?.trim().toLowerCase();
  if (svc) {
    const match = candidates.find(
      (c) => (c.serviceName ?? "").trim().toLowerCase() === svc,
    );
    if (match) return { incidentId: match.incidentId, correlationType: "service" };
  }
  if (host) {
    const match = candidates.find(
      (c) => (c.host ?? "").trim().toLowerCase() === host,
    );
    if (match) return { incidentId: match.incidentId, correlationType: "host" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ingest pipeline
// ---------------------------------------------------------------------------

export interface IngestResult {
  deduplicated: boolean;
  correlated: boolean;
  eventId: number;
  fingerprint: string;
  incidentId: number | null;
  ticketId: number | null;
}

function generateIncidentNumber(): string {
  return `INC-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** tickets.created_by_id is NOT NULL; fall back through key creator → super_admin → admin. */
async function resolveSystemAuthorId(
  keyInfo: ApiKeyInfo,
): Promise<number | null> {
  if (keyInfo.created_by_id) {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND is_active = true LIMIT 1`,
      [keyInfo.created_by_id],
    );
    if (rows[0]) return rows[0].id as number;
  }
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE is_active = true
     AND role IN ('super_admin','admin') ORDER BY id ASC LIMIT 1`,
  );
  return rows[0] ? (rows[0].id as number) : null;
}

/**
 * Full ingest pipeline. Throws on invalid input or when no system author is
 * available for ticket creation.
 */
export async function ingestEvent(
  input: IngestInput,
  keyInfo: ApiKeyInfo,
): Promise<IngestResult> {
  const event = validateIngestInput(input);
  const fingerprint = computeFingerprint(event);
  const tenantId = keyInfo.tenant_id;

  // --- Dedup ------------------------------------------------------------
  const dup = await pool.query(
    `SELECT id FROM monitoring_events
     WHERE tenant_id IS NOT DISTINCT FROM $1
       AND fingerprint = $2
       AND last_seen_at > now() - ($3 * interval '1 minute')
     ORDER BY last_seen_at DESC LIMIT 1`,
    [tenantId, fingerprint, DEDUP_WINDOW_MINUTES],
  );
  if (dup.rows[0]) {
    const eventId = dup.rows[0].id as number;
    await pool.query(
      `UPDATE monitoring_events
       SET dedup_count = dedup_count + 1, last_seen_at = now(),
           raw_payload = $2::jsonb
       WHERE id = $1`,
      [eventId, JSON.stringify(event.raw_payload)],
    );
    await emitEvent({
      type: EventTypes.MONITORING_ALERT,
      entityType: "monitoring_event",
      entityId: String(eventId),
      actorType: "automation",
      tenantId,
      payload: {
        eventId,
        fingerprint,
        severity: event.severity,
        deduplicated: true,
      },
    });
    return {
      deduplicated: true,
      correlated: false,
      eventId,
      fingerprint,
      incidentId: null,
      ticketId: null,
    };
  }

  // --- Insert the new event ---------------------------------------------
  const { rows: evRows } = await pool.query(
    `INSERT INTO monitoring_events
       (tenant_id, source, fingerprint, severity, title, message,
        service_name, host, ci_id, raw_payload, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'new')
     RETURNING id`,
    [
      tenantId,
      event.source,
      fingerprint,
      event.severity,
      event.title,
      event.message,
      event.service_name,
      event.host,
      event.ci_id,
      JSON.stringify(event.raw_payload),
    ],
  );
  const eventId = evRows[0].id as number;

  // --- Correlate to an open incident -------------------------------------
  // Look for events already correlated to an OPEN incident (started in the
  // last 2h) sharing the same service_name or host.
  const corrRows = await pool.query(
    `SELECT DISTINCT i.id AS "incidentId",
            me.service_name AS "serviceName",
            me.host AS host
     FROM monitoring_events me
     JOIN event_correlations ec ON ec.event_id = me.id
     JOIN incidents i ON i.id = ec.incident_id
     WHERE i.tenant_id IS NOT DISTINCT FROM $1
       AND i.deleted_at IS NULL
       AND i.status NOT IN ('resolved','closed')
       AND i.started_at > now() - ($4 * interval '1 hour')
       AND (($2 IS NOT NULL AND me.service_name = $2)
         OR ($3 IS NOT NULL AND me.host = $3))
     ORDER BY i.id DESC
     LIMIT 50`,
    [tenantId, event.service_name, event.host, CORRELATION_WINDOW_HOURS],
  );
  const match = pickCorrelation(
    { service_name: event.service_name, host: event.host },
    corrRows.rows as CorrelationCandidate[],
  );
  if (match) {
    await pool.query(
      `INSERT INTO event_correlations
         (tenant_id, incident_id, event_id, correlation_type, confidence)
       VALUES ($1,$2,$3,$4,75)
       ON CONFLICT (incident_id, event_id) DO NOTHING`,
      [tenantId, match.incidentId, eventId, match.correlationType],
    );
    await pool.query(
      `UPDATE monitoring_events
       SET status = 'correlated', incident_id = $2 WHERE id = $1`,
      [eventId, match.incidentId],
    );
    await emitEvent({
      type: EventTypes.MONITORING_ALERT,
      entityType: "monitoring_event",
      entityId: String(eventId),
      actorType: "automation",
      tenantId,
      payload: {
        eventId,
        fingerprint,
        severity: event.severity,
        correlated: true,
        correlationType: match.correlationType,
        incidentId: match.incidentId,
      },
    });
    return {
      deduplicated: false,
      correlated: true,
      eventId,
      fingerprint,
      incidentId: match.incidentId,
      ticketId: null,
    };
  }

  // --- Create incident + ticket for critical/high -------------------------
  let incidentId: number | null = null;
  let ticketId: number | null = null;
  if (event.severity === "critical" || event.severity === "high") {
    const createdById = await resolveSystemAuthorId(keyInfo);
    if (!createdById) {
      throw new Error(
        "Cannot create monitoring tickets: no active admin user found to attribute them to",
      );
    }
    // Retry on the tiny chance of a generated-number collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows: incRows } = await pool.query(
          `INSERT INTO incidents
             (tenant_id, incident_number, title, description, severity,
              status, is_major, started_at, created_by_id)
           VALUES ($1,$2,$3,$4,$5,'open',$6,now(),$7)
           RETURNING id`,
          [
            tenantId,
            generateIncidentNumber(),
            event.title,
            event.message,
            event.severity,
            event.severity === "critical",
            createdById,
          ],
        );
        incidentId = incRows[0].id as number;
        break;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "23505" && attempt < 4) continue;
        throw err;
      }
    }
    if (!incidentId) {
      throw new Error("Could not generate a unique incident number");
    }

    const priority = event.severity === "critical" ? "urgent" : "high";
    const description = [
      `Source: ${event.source}`,
      event.service_name ? `Service: ${event.service_name}` : null,
      event.host ? `Host: ${event.host}` : null,
      event.message ? `Message: ${event.message}` : null,
      `Fingerprint: ${fingerprint}`,
    ]
      .filter(Boolean)
      .join("\n");
    const ticketNumber = `DJ-${randomBytes(8).toString("hex").toUpperCase()}`;
    const { rows: tRows } = await pool.query(
      `INSERT INTO tickets
         (ticket_number, subject, description, status, priority,
          department_id, created_by_id, tags)
       VALUES ($1,$2,$3,'open',$4,NULL,$5,$6)
       RETURNING id`,
      [
        ticketNumber,
        `[Monitoring] ${event.title}`,
        description,
        priority,
        createdById,
        ["monitoring-event"],
      ],
    );
    ticketId = tRows[0].id as number;

    // Link ticket ↔ incident (join table from 008).
    await pool.query(
      `INSERT INTO incident_tickets (incident_id, ticket_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [incidentId, ticketId],
    );
    await pool.query(
      `INSERT INTO event_correlations
         (tenant_id, incident_id, event_id, correlation_type, confidence)
       VALUES ($1,$2,$3,'fingerprint',100)
       ON CONFLICT (incident_id, event_id) DO NOTHING`,
      [tenantId, incidentId, eventId],
    );
    await pool.query(
      `UPDATE monitoring_events
       SET status = 'incident_created', incident_id = $2, ticket_id = $3
       WHERE id = $1`,
      [eventId, incidentId, ticketId],
    );

    await emitEvent({
      type: EventTypes.INCIDENT_CREATED,
      entityType: "incident",
      entityId: String(incidentId),
      actorType: "automation",
      tenantId,
      payload: { incidentId, eventId, fingerprint, severity: event.severity },
    });
    await emitEvent({
      type: EventTypes.TICKET_CREATED,
      entityType: "ticket",
      entityId: String(ticketId),
      actorType: "automation",
      tenantId,
      payload: { ticketId, eventId, incidentId, fingerprint },
    });
  }

  await emitEvent({
    type: EventTypes.MONITORING_ALERT,
    entityType: "monitoring_event",
    entityId: String(eventId),
    actorType: "automation",
    tenantId,
    payload: {
      eventId,
      fingerprint,
      severity: event.severity,
      ...(incidentId ? { incidentId } : {}),
      ...(ticketId ? { ticketId } : {}),
    },
  });

  return {
    deduplicated: false,
    correlated: false,
    eventId,
    fingerprint,
    incidentId,
    ticketId,
  };
}
