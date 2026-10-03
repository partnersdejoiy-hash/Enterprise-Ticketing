/**
 * Service Catalog (#10) — Enterprise Service Catalog with multi-step approvals.
 *
 * Flow: a requester picks an active catalog item, fills its dynamic form
 * (form_schema), and submits a request. The request walks the item's
 * approval_chain sequentially (one pending step at a time); when the last
 * step approves (or the chain is empty), the request is auto-fulfilled by
 * creating a ticket in the item's department.
 *
 * Domain events emitted (string literals, see orbit-events.ts):
 *   "catalog.request_created" | "catalog.request_approved"
 *   | "catalog.request_rejected" | "catalog.fulfilled" | "ticket.created"
 */

import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { emitEvent } from "./orbit-events.js";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export class CatalogError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CatalogError";
    this.status = status;
  }
}

export const CATALOG_CATEGORIES = [
  "IT",
  "HR",
  "Finance",
  "Facilities",
  "Security",
  "Legal",
  "Procurement",
  "Admin",
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
] as const;
export type CatalogFieldType = (typeof FIELD_TYPES)[number];

export interface CatalogFormField {
  name: string;
  label: string;
  type: CatalogFieldType;
  required?: boolean;
  options?: string[];
}

export interface CatalogFormSchema {
  fields: CatalogFormField[];
}

export interface ApprovalChainStep {
  role: string;
  order: number;
}

export interface ApproverUser {
  id: number;
  role: string;
}

/** Minimal query surface we need (pg Pool / Client / test doubles). */
export interface DbQueryable {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, any>[]; rowCount: number | null }>;
}

const FIELD_NAME_RE = /^[a-z0-9_]+$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a catalog item's form schema. Throws CatalogError(400) on invalid. */
export function validateFormSchema(schema: unknown): asserts schema is CatalogFormSchema {
  if (!isRecord(schema) || !Array.isArray(schema.fields)) {
    throw new CatalogError(400, "form_schema must be an object with a 'fields' array");
  }
  const seen = new Set<string>();
  for (const [i, raw] of schema.fields.entries()) {
    const where = `form_schema.fields[${i}]`;
    if (!isRecord(raw)) throw new CatalogError(400, `${where} must be an object`);
    const { name, label, type, required, options } = raw as Record<string, unknown>;
    if (typeof name !== "string" || !FIELD_NAME_RE.test(name)) {
      throw new CatalogError(
        400,
        `${where}.name must match /^[a-z0-9_]+$/ (lowercase letters, digits, underscores)`,
      );
    }
    if (seen.has(name)) throw new CatalogError(400, `${where}.name "${name}" is duplicated`);
    seen.add(name);
    if (typeof label !== "string" || !label.trim()) {
      throw new CatalogError(400, `${where}.label must be a non-empty string`);
    }
    if (typeof type !== "string" || !(FIELD_TYPES as readonly string[]).includes(type)) {
      throw new CatalogError(
        400,
        `${where}.type must be one of: ${FIELD_TYPES.join(", ")}`,
      );
    }
    if (required !== undefined && typeof required !== "boolean") {
      throw new CatalogError(400, `${where}.required must be a boolean`);
    }
    if (options !== undefined) {
      if (!Array.isArray(options) || options.some((o) => typeof o !== "string" || !o.trim())) {
        throw new CatalogError(400, `${where}.options must be an array of non-empty strings`);
      }
    }
    if (type === "select" && (!Array.isArray(options) || options.length === 0)) {
      throw new CatalogError(400, `${where}: select fields require a non-empty 'options' array`);
    }
  }
}

/** Validate a submitted approval chain. Returns a copy sorted by order. */
export function validateApprovalChain(chain: unknown): ApprovalChainStep[] {
  if (!Array.isArray(chain)) {
    throw new CatalogError(400, "approval_chain must be an array of {role, order}");
  }
  const steps: ApprovalChainStep[] = chain.map((raw, i) => {
    const where = `approval_chain[${i}]`;
    if (!isRecord(raw)) throw new CatalogError(400, `${where} must be an object`);
    const { role, order } = raw as Record<string, unknown>;
    if (typeof role !== "string" || !role.trim()) {
      throw new CatalogError(400, `${where}.role must be a non-empty string`);
    }
    if (typeof order !== "number" || !Number.isInteger(order) || order < 1) {
      throw new CatalogError(400, `${where}.order must be a positive integer`);
    }
    return { role: role.trim(), order };
  });
  const orders = steps.map((s) => s.order);
  if (new Set(orders).size !== orders.length) {
    throw new CatalogError(400, "approval_chain orders must be unique");
  }
  return steps.sort((a, b) => a.order - b.order);
}

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** Validate submitted form data against a schema. Never throws. */
export function validateFormData(
  schema: CatalogFormSchema,
  data: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const values: Record<string, unknown> = isRecord(data) ? data : {};
  for (const field of schema.fields) {
    const value = values[field.name];
    if (field.required && isEmptyValue(value)) {
      errors.push(`"${field.label}" is required`);
      continue;
    }
    if (isEmptyValue(value)) continue;
    switch (field.type) {
      case "number": {
        const n = typeof value === "number" ? value : Number(value);
        if (typeof value === "boolean" || !Number.isFinite(n)) {
          errors.push(`"${field.label}" must be a number`);
        }
        break;
      }
      case "select": {
        if (!field.options || !field.options.includes(String(value))) {
          errors.push(
            `"${field.label}" must be one of: ${(field.options ?? []).join(", ")}`,
          );
        }
        break;
      }
      case "checkbox": {
        if (
          typeof value !== "boolean" &&
          value !== "true" &&
          value !== "false"
        ) {
          errors.push(`"${field.label}" must be true or false`);
        }
        break;
      }
      case "date": {
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
          errors.push(`"${field.label}" must be a valid date`);
        }
        break;
      }
      case "text":
      case "textarea": {
        if (typeof value !== "string") {
          errors.push(`"${field.label}" must be text`);
        }
        break;
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

async function withTransaction<T>(
  db: DbQueryable,
  fn: (client: DbQueryable) => Promise<T>,
): Promise<T> {
  // Production passes the pg Pool (has connect()); tests may pass a single
  // client. Either way, all multi-row mutations run inside BEGIN/COMMIT.
  const maybePool = db as unknown as {
    connect?: () => Promise<DbQueryable & { release(): void }>;
  };
  if (typeof maybePool.connect === "function") {
    const client = await maybePool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    } finally {
      client.release();
    }
  }
  await db.query("BEGIN");
  try {
    const out = await fn(db);
    await db.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  }
}

function generateRequestNumber(): string {
  return `REQ-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function generateTicketNumber(): string {
  return `DJ-${randomBytes(8).toString("hex").toUpperCase()}`;
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function renderFulfillmentDescription(args: {
  itemName: string;
  requestNumber: string;
  requesterName: string | null;
  schema: CatalogFormSchema | null;
  formData: Record<string, unknown>;
}): string {
  const lines = [
    "Service catalog request — fulfilled automatically after approvals.",
    `Item: ${args.itemName}`,
    `Request: ${args.requestNumber}`,
    `Requested by: ${args.requesterName ?? "Unknown"}`,
    "",
    "Request details:",
  ];
  const fields: Pick<CatalogFormField, "name" | "label">[] =
    args.schema?.fields ??
    Object.keys(args.formData).map((k) => ({ name: k, label: k }));
  for (const f of fields) {
    lines.push(`- ${f.label}: ${formatValue(args.formData[f.name])}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Request lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a catalog request for an active item.
 * Empty approval chain -> auto-approved and fulfilled immediately.
 */
export async function createRequestItem(
  itemId: number,
  requesterId: number,
  formData: unknown,
  db: DbQueryable = pool,
): Promise<Record<string, any>> {
  const data: Record<string, unknown> = isRecord(formData) ? formData : {};
  const { request, autoFulfill, itemName, tenantId } = await withTransaction(
    db,
    async (client) => {
      const { rows } = await client.query(
        `SELECT id, tenant_id, name, form_schema, approval_chain
         FROM service_catalog_items
         WHERE id = $1 AND is_active = true`,
        [itemId],
      );
      const item = rows[0];
      if (!item) {
        throw new CatalogError(404, "Catalog item not found or inactive");
      }
      validateFormSchema(item.form_schema);
      const { valid, errors } = validateFormData(item.form_schema, data);
      if (!valid) {
        throw new CatalogError(400, `Invalid form data: ${errors.join("; ")}`);
      }
      const chain = validateApprovalChain(item.approval_chain ?? []);

      // Unique request number (retry once on the astronomically unlikely collision).
      let request: Record<string, any> | null = null;
      for (let attempt = 0; attempt < 3 && !request; attempt++) {
        const requestNumber = generateRequestNumber();
        try {
          const res = await client.query(
            `INSERT INTO service_catalog_requests
               (tenant_id, item_id, request_number, requester_id, form_data, status, current_step)
             VALUES ($1, $2, $3, $4, $5::jsonb, 'submitted', 0)
             RETURNING *`,
            [
              item.tenant_id ?? null,
              item.id,
              requestNumber,
              requesterId,
              JSON.stringify(data),
            ],
          );
          request = res.rows[0];
        } catch (err: any) {
          if (err?.code === "23505" && attempt < 2) continue;
          throw err;
        }
      }
      if (!request) throw new CatalogError(500, "Could not generate a request number");

      if (chain.length === 0) {
        await client.query(
          `UPDATE service_catalog_requests
           SET status = 'approved', updated_at = now() WHERE id = $1`,
          [request.id],
        );
        request.status = "approved";
      } else {
        // Sequential step_order 1..n (sorted by the chain's order values).
        for (const [i, step] of chain.entries()) {
          await client.query(
            `INSERT INTO approvals
               (tenant_id, entity_type, entity_id, step_order, approver_role, status)
             VALUES ($1, 'catalog_request', $2, $3, $4, 'pending')`,
            [item.tenant_id ?? null, String(request.id), i + 1, step.role],
          );
        }
        await client.query(
          `UPDATE service_catalog_requests
           SET status = 'in_approval', current_step = 1, updated_at = now()
           WHERE id = $1`,
          [request.id],
        );
        request.status = "in_approval";
        request.current_step = 1;
      }
      return {
        request,
        autoFulfill: chain.length === 0,
        itemName: item.name as string,
        tenantId: (item.tenant_id ?? null) as number | null,
      };
    },
  );

  await emitEvent({
    type: "catalog.request_created",
    entityType: "catalog_request",
    entityId: String(request.id),
    actorId: requesterId,
    tenantId,
    payload: {
      requestNumber: request.request_number,
      itemId: request.item_id,
      itemName,
      autoApproved: autoFulfill,
    },
  });

  if (autoFulfill) {
    await fulfillRequest(request.id, requesterId, db);
  }
  return request;
}

/**
 * Decide the current pending approval step. Only the lowest-order pending
 * step can be decided (sequential chain). The approver's role must match the
 * step's approver_role, unless the approver is an admin/super_admin.
 */
export async function decideApproval(
  requestId: number,
  approverUser: ApproverUser,
  decision: "approved" | "rejected",
  comment?: string,
  db: DbQueryable = pool,
): Promise<Record<string, any>> {
  if (decision !== "approved" && decision !== "rejected") {
    throw new CatalogError(400, "Decision must be 'approved' or 'rejected'");
  }
  const { request, fulfill, tenantId } = await withTransaction(
    db,
    async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM service_catalog_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      const request = rows[0];
      if (!request) throw new CatalogError(404, "Catalog request not found");
      if (!["submitted", "in_approval"].includes(request.status)) {
        throw new CatalogError(
          409,
          `Request is ${request.status}; there is no pending approval to decide`,
        );
      }

      const { rows: stepRows } = await client.query(
        `SELECT * FROM approvals
         WHERE entity_type = 'catalog_request' AND entity_id = $1 AND status = 'pending'
         ORDER BY step_order ASC LIMIT 1 FOR UPDATE`,
        [String(requestId)],
      );
      const step = stepRows[0];
      if (!step) {
        throw new CatalogError(409, "No pending approval step for this request");
      }

      const role = approverUser.role ?? "";
      const isAdmin = role === "admin" || role === "super_admin";
      if (step.approver_role !== role && !isAdmin) {
        throw new CatalogError(
          403,
          `This approval step requires role "${step.approver_role}"`,
        );
      }

      await client.query(
        `UPDATE approvals
         SET status = $1, approver_id = $2, decided_at = now(), comment = $3
         WHERE id = $4`,
        [decision, approverUser.id, comment ?? null, step.id],
      );

      if (decision === "rejected") {
        await client.query(
          `UPDATE service_catalog_requests
           SET status = 'rejected', completed_at = now(), updated_at = now()
           WHERE id = $1`,
          [requestId],
        );
        return {
          request: { ...request, status: "rejected" },
          fulfill: false,
          tenantId: (request.tenant_id ?? null) as number | null,
        };
      }

      const { rows: nextRows } = await client.query(
        `SELECT * FROM approvals
         WHERE entity_type = 'catalog_request' AND entity_id = $1 AND status = 'pending'
         ORDER BY step_order ASC LIMIT 1`,
        [String(requestId)],
      );
      const next = nextRows[0];
      if (next) {
        await client.query(
          `UPDATE service_catalog_requests
           SET status = 'in_approval', current_step = $2, updated_at = now()
           WHERE id = $1`,
          [requestId, next.step_order],
        );
        return {
          request: { ...request, status: "in_approval", current_step: next.step_order },
          fulfill: false,
          tenantId: (request.tenant_id ?? null) as number | null,
        };
      }

      await client.query(
        `UPDATE service_catalog_requests
         SET status = 'approved', updated_at = now() WHERE id = $1`,
        [requestId],
      );
      return {
        request: { ...request, status: "approved" },
        fulfill: true,
        tenantId: (request.tenant_id ?? null) as number | null,
      };
    },
  );

  await emitEvent({
    type: decision === "rejected" ? "catalog.request_rejected" : "catalog.request_approved",
    entityType: "catalog_request",
    entityId: String(requestId),
    actorId: approverUser.id,
    tenantId,
    payload: {
      requestNumber: request.request_number,
      decision,
      comment: comment ?? null,
    },
  });

  if (fulfill) {
    await fulfillRequest(requestId, approverUser.id, db);
  }
  return request;
}

/**
 * Fulfill an approved request: create the ticket and mark the request
 * completed. Idempotent — returns the existing ticket if already fulfilled.
 */
export async function fulfillRequest(
  requestId: number,
  actorId?: number | null,
  db: DbQueryable = pool,
): Promise<{ id: number; ticket_number: string }> {
  const ticket = await withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_id, item_id, request_number, requester_id, form_data,
              status, ticket_id
       FROM service_catalog_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const request = rows[0];
    if (!request) throw new CatalogError(404, "Catalog request not found");
    if (request.ticket_id) {
      const { rows: tRows } = await client.query(
        `SELECT id, ticket_number FROM tickets WHERE id = $1`,
        [request.ticket_id],
      );
      if (tRows[0]) return { id: tRows[0].id, ticket_number: tRows[0].ticket_number };
    }
    if (request.status !== "approved") {
      throw new CatalogError(
        409,
        `Cannot fulfill a request in status "${request.status}"`,
      );
    }

    const { rows: itemRows } = await client.query(
      `SELECT id, tenant_id, name, department_id, form_schema
       FROM service_catalog_items WHERE id = $1`,
      [request.item_id],
    );
    const item = itemRows[0];
    if (!item) throw new CatalogError(404, "Catalog item not found");

    let requesterName: string | null = null;
    if (request.requester_id) {
      const { rows: uRows } = await client.query(
        `SELECT name FROM users WHERE id = $1`,
        [request.requester_id],
      );
      requesterName = uRows[0]?.name ?? null;
    }

    let schema: CatalogFormSchema | null = null;
    try {
      validateFormSchema(item.form_schema);
      schema = item.form_schema as CatalogFormSchema;
    } catch {
      schema = null;
    }
    const formData: Record<string, unknown> = isRecord(request.form_data)
      ? request.form_data
      : {};

    await client.query(
      `UPDATE service_catalog_requests
       SET status = 'fulfilling', updated_at = now() WHERE id = $1`,
      [requestId],
    );

    const subject = `[Catalog] ${item.name} — ${request.request_number}`;
    const description = renderFulfillmentDescription({
      itemName: item.name,
      requestNumber: request.request_number,
      requesterName,
      schema,
      formData,
    });

    let ticketRow: { id: number; ticket_number: string } | null = null;
    for (let attempt = 0; attempt < 3 && !ticketRow; attempt++) {
      const ticketNumber = generateTicketNumber();
      try {
        const { rows: ins } = await client.query(
          `INSERT INTO tickets
             (ticket_number, subject, description, priority, status,
              department_id, created_by_id, tags)
           VALUES ($1, $2, $3, 'medium', 'open', $4, $5, $6)
           RETURNING id, ticket_number`,
          [
            ticketNumber,
            subject,
            description,
            item.department_id ?? null,
            request.requester_id,
            ["catalog-request"],
          ],
        );
        ticketRow = ins[0];
      } catch (err: any) {
        if (err?.code === "23505" && attempt < 2) continue;
        throw err;
      }
    }
    if (!ticketRow) throw new CatalogError(500, "Could not generate a ticket number");

    await client.query(
      `UPDATE service_catalog_requests
       SET ticket_id = $2, status = 'completed', completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [requestId, ticketRow.id],
    );
    return ticketRow;
  });

  await emitEvent({
    type: "catalog.fulfilled",
    entityType: "catalog_request",
    entityId: String(requestId),
    actorId: actorId ?? null,
    payload: { ticketId: ticket.id, ticketNumber: ticket.ticket_number },
  });
  await emitEvent({
    type: "ticket.created",
    entityType: "ticket",
    entityId: String(ticket.id),
    actorId: actorId ?? null,
    payload: {
      ticketNumber: ticket.ticket_number,
      source: "service_catalog",
      catalogRequestId: requestId,
    },
  });
  return ticket;
}
