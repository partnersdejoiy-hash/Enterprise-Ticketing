/**
 * Service Catalog API (#10) — mounted under /api via routes/index.ts.
 * Final paths: /api/catalog/items, /api/catalog/requests, /api/catalog/approvals/inbox
 */

import { Router } from "express";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  AuthenticatedRequest,
  requireAdmin,
} from "../middlewares/auth.js";
import {
  CatalogError,
  CATALOG_CATEGORIES,
  validateFormSchema,
  validateApprovalChain,
  createRequestItem,
  decideApproval,
} from "../lib/service-catalog.js";

const router = Router();
// Scoped to this router's own paths: a bare router.use(authMiddleware) here
// would gate EVERY /api/* request (this router is mounted at "/"), breaking
// public routes like /api/auth/login.
router.use("/catalog", authMiddleware);

const ADMIN_ROLES = ["super_admin", "admin"];
const PRIVILEGED_ROLES = ["super_admin", "admin", "manager"];

function sendCatalogError(res: any, err: unknown): void {
  if (err instanceof CatalogError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("Catalog API error", err);
  res.status(500).json({ error: "Internal Server Error" });
}

function itemRow(r: Record<string, any>) {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    name: r.name,
    category: r.category,
    description: r.description,
    form_schema: r.form_schema,
    approval_chain: r.approval_chain,
    sla_policy_id: r.sla_policy_id,
    department_id: r.department_id,
    department_name: r.department_name ?? null,
    is_active: r.is_active,
    open_requests: Number(r.open_requests ?? 0),
    created_by_id: r.created_by_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const ITEM_SELECT = `
  SELECT i.*, d.name AS department_name,
         (SELECT count(*) FROM service_catalog_requests r
           WHERE r.item_id = i.id AND r.status NOT IN ('completed','rejected','cancelled')) AS open_requests
  FROM service_catalog_items i
  LEFT JOIN departments d ON d.id = i.department_id
`;

function validateItemBody(body: any, partial = false): {
  name?: string;
  category?: string;
  description?: string | null;
  form_schema?: unknown;
  approval_chain?: unknown;
  sla_policy_id?: number | null;
  department_id?: number | null;
  is_active?: boolean;
} {
  const out: Record<string, unknown> = {};
  const has = (k: string) => body[k] !== undefined;

  if (has("name") || !partial) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200) {
      throw new CatalogError(400, "name must be a non-empty string (max 200 chars)");
    }
    out.name = body.name.trim();
  }
  if (has("category") || !partial) {
    if (
      typeof body.category !== "string" ||
      !(CATALOG_CATEGORIES as readonly string[]).includes(body.category)
    ) {
      throw new CatalogError(
        400,
        `category must be one of: ${CATALOG_CATEGORIES.join(", ")}`,
      );
    }
    out.category = body.category;
  }
  if (has("description")) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new CatalogError(400, "description must be a string or null");
    }
    out.description = body.description;
  }
  if (has("form_schema") || !partial) {
    validateFormSchema(body.form_schema);
    out.form_schema = body.form_schema;
  }
  if (has("approval_chain") || !partial) {
    out.approval_chain = validateApprovalChain(body.approval_chain ?? []);
  }
  if (has("sla_policy_id")) {
    if (body.sla_policy_id !== null && !Number.isInteger(body.sla_policy_id)) {
      throw new CatalogError(400, "sla_policy_id must be an integer or null");
    }
    out.sla_policy_id = body.sla_policy_id;
  }
  if (has("department_id")) {
    if (body.department_id !== null && !Number.isInteger(body.department_id)) {
      throw new CatalogError(400, "department_id must be an integer or null");
    }
    out.department_id = body.department_id;
  }
  if (has("is_active")) {
    if (typeof body.is_active !== "boolean") {
      throw new CatalogError(400, "is_active must be a boolean");
    }
    out.is_active = body.is_active;
  }
  return out as any;
}

async function assertDepartmentAndSla(
  department_id: number | null | undefined,
  sla_policy_id: number | null | undefined,
): Promise<void> {
  if (department_id != null) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM departments WHERE id = $1`,
      [department_id],
    );
    if (!rowCount) throw new CatalogError(400, "department_id does not exist");
  }
  if (sla_policy_id != null) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM sla_policies WHERE id = $1`,
      [sla_policy_id],
    );
    if (!rowCount) throw new CatalogError(400, "sla_policy_id does not exist");
  }
}

// ---------------------------------------------------------------------------
// Catalog items
// ---------------------------------------------------------------------------

router.get("/catalog/items", async (req: AuthenticatedRequest, res) => {
  try {
    const { category, active } = req.query as Record<string, string | undefined>;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (category) {
      if (!(CATALOG_CATEGORIES as readonly string[]).includes(category)) {
        res.status(400).json({
          error: `category must be one of: ${CATALOG_CATEGORIES.join(", ")}`,
        });
        return;
      }
      params.push(category);
      conds.push(`i.category = $${params.length}`);
    }
    // active defaults to true; "all" disables the filter.
    if (active !== "all") {
      const wantActive = active === undefined || active === "true";
      params.push(wantActive);
      conds.push(`i.is_active = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${ITEM_SELECT} ${where} ORDER BY i.category, i.name`,
      params,
    );
    res.json({ items: rows.map(itemRow) });
  } catch (err) {
    sendCatalogError(res, err);
  }
});

router.get("/catalog/items/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const { rows } = await pool.query(`${ITEM_SELECT} WHERE i.id = $1`, [
      req.params.id,
    ]);
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "Catalog item not found" });
      return;
    }
    const isAdmin = ADMIN_ROLES.includes(req.user!.role as string);
    if (!row.is_active && !isAdmin) {
      res.status(404).json({ error: "Catalog item not found" });
      return;
    }
    res.json({ item: itemRow(row) });
  } catch (err) {
    sendCatalogError(res, err);
  }
});

router.post("/catalog/items", requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const v = validateItemBody(req.body);
    await assertDepartmentAndSla(v.department_id, v.sla_policy_id);
    const { rows } = await pool.query(
      `INSERT INTO service_catalog_items
         (name, category, description, form_schema, approval_chain,
          sla_policy_id, department_id, created_by_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)
       RETURNING *`,
      [
        v.name,
        v.category,
        v.description ?? null,
        JSON.stringify(v.form_schema ?? { fields: [] }),
        JSON.stringify(v.approval_chain ?? []),
        v.sla_policy_id ?? null,
        v.department_id ?? null,
        req.user!.id,
      ],
    );
    const { rows: full } = await pool.query(`${ITEM_SELECT} WHERE i.id = $1`, [
      rows[0].id,
    ]);
    res.status(201).json({ item: itemRow(full[0]) });
  } catch (err) {
    sendCatalogError(res, err);
  }
});

router.put("/catalog/items/:id", requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const v = validateItemBody(req.body, true);
    await assertDepartmentAndSla(v.department_id, v.sla_policy_id);
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown, json = false) => {
      params.push(json ? JSON.stringify(val) : val);
      sets.push(`${col} = $${params.length}${json ? "::jsonb" : ""}`);
    };
    if (v.name !== undefined) push("name", v.name);
    if (v.category !== undefined) push("category", v.category);
    if (v.description !== undefined) push("description", v.description);
    if (v.form_schema !== undefined) push("form_schema", v.form_schema, true);
    if (v.approval_chain !== undefined) push("approval_chain", v.approval_chain, true);
    if (v.sla_policy_id !== undefined) push("sla_policy_id", v.sla_policy_id);
    if (v.department_id !== undefined) push("department_id", v.department_id);
    if (v.is_active !== undefined) push("is_active", v.is_active);
    if (!sets.length) {
      res.status(400).json({ error: "No updatable fields provided" });
      return;
    }
    sets.push("updated_at = now()");
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE service_catalog_items SET ${sets.join(", ")}
       WHERE id = $${params.length} RETURNING id`,
      params,
    );
    if (!rows.length) {
      res.status(404).json({ error: "Catalog item not found" });
      return;
    }
    const { rows: full } = await pool.query(`${ITEM_SELECT} WHERE i.id = $1`, [
      rows[0].id,
    ]);
    res.json({ item: itemRow(full[0]) });
  } catch (err) {
    sendCatalogError(res, err);
  }
});

// Soft delete only — existing requests keep working (ON DELETE RESTRICT).
router.delete("/catalog/items/:id", requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE service_catalog_items
       SET is_active = false, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!rows.length) {
      res.status(404).json({ error: "Catalog item not found" });
      return;
    }
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    sendCatalogError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

router.post("/catalog/items/:id/request", async (req: AuthenticatedRequest, res) => {
  try {
    const request = await createRequestItem(
      Number(req.params.id),
      req.user!.id,
      req.body?.form_data,
    );
    res.status(201).json({ request });
  } catch (err) {
    sendCatalogError(res, err);
  }
});

const REQUEST_SELECT = `
  SELECT r.*,
         i.name AS item_name, i.category AS item_category,
         u.name AS requester_name,
         t.ticket_number,
         (SELECT a.approver_role FROM approvals a
           WHERE a.entity_type = 'catalog_request' AND a.entity_id = r.id::text
             AND a.status = 'pending'
           ORDER BY a.step_order ASC LIMIT 1) AS pending_role,
         (SELECT count(*) FROM approvals a
           WHERE a.entity_type = 'catalog_request' AND a.entity_id = r.id::text
             AND a.status = 'pending') AS pending_steps,
         (SELECT count(*) FROM approvals a
           WHERE a.entity_type = 'catalog_request' AND a.entity_id = r.id::text) AS total_steps
  FROM service_catalog_requests r
  JOIN service_catalog_items i ON i.id = r.item_id
  LEFT JOIN users u ON u.id = r.requester_id
  LEFT JOIN tickets t ON t.id = r.ticket_id
`;

router.get("/catalog/requests", async (req: AuthenticatedRequest, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const role = req.user!.role as string;
    const isPrivileged = PRIVILEGED_ROLES.includes(role);
    const conds: string[] = [];
    const params: unknown[] = [];
    if (!(q.mine === "false" && isPrivileged)) {
      params.push(req.user!.id);
      conds.push(`r.requester_id = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      conds.push(`r.status = $${params.length}`);
    }
    if (q.item_id) {
      params.push(Number(q.item_id));
      conds.push(`r.item_id = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${REQUEST_SELECT} ${where} ORDER BY r.created_at DESC LIMIT 200`,
      params,
    );
    res.json({ requests: rows });
  } catch (err) {
    sendCatalogError(res, err);
  }
});

async function canViewRequest(
  requestRow: Record<string, any>,
  user: { id: number; role: string },
): Promise<boolean> {
  if (requestRow.requester_id === user.id) return true;
  if (ADMIN_ROLES.includes(user.role)) return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM approvals
     WHERE entity_type = 'catalog_request' AND entity_id = $1
       AND status = 'pending' AND approver_role = $2 LIMIT 1`,
    [String(requestRow.id), user.role],
  );
  return rows.length > 0;
}

router.get("/catalog/requests/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const { rows } = await pool.query(`${REQUEST_SELECT} WHERE r.id = $1`, [
      req.params.id,
    ]);
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "Catalog request not found" });
      return;
    }
    if (!(await canViewRequest(row, req.user! as { id: number; role: string }))) {
      res.status(403).json({ error: "You do not have access to this request" });
      return;
    }
    const { rows: steps } = await pool.query(
      `SELECT a.*, u.name AS approver_name
       FROM approvals a LEFT JOIN users u ON u.id = a.approver_id
       WHERE a.entity_type = 'catalog_request' AND a.entity_id = $1
       ORDER BY a.step_order ASC`,
      [String(row.id)],
    );
    res.json({ request: row, steps });
  } catch (err) {
    sendCatalogError(res, err);
  }
});

async function decide(
  req: AuthenticatedRequest,
  res: any,
  decision: "approved" | "rejected",
) {
  try {
    const comment =
      typeof req.body?.comment === "string" ? req.body.comment.slice(0, 2000) : undefined;
    const request = await decideApproval(
      Number(req.params.id),
      { id: req.user!.id, role: req.user!.role as string },
      decision,
      comment,
    );
    res.json({ request });
  } catch (err) {
    sendCatalogError(res, err);
  }
}

router.post("/catalog/requests/:id/approve", async (req: AuthenticatedRequest, res) => {
  await decide(req, res, "approved");
});

router.post("/catalog/requests/:id/reject", async (req: AuthenticatedRequest, res) => {
  await decide(req, res, "rejected");
});

// ---------------------------------------------------------------------------
// Approval inbox
// ---------------------------------------------------------------------------

router.get("/catalog/approvals/inbox", async (req: AuthenticatedRequest, res) => {
  try {
    const role = req.user!.role as string;
    const isAdmin = ADMIN_ROLES.includes(role);
    const { rows } = await pool.query(
      `SELECT a.id AS approval_id, a.step_order, a.approver_role,
              a.created_at AS step_created_at,
              r.id, r.request_number, r.status, r.form_data, r.created_at,
              r.current_step, r.requester_id,
              i.name AS item_name, i.category AS item_category,
              u.name AS requester_name
       FROM approvals a
       JOIN service_catalog_requests r ON r.id::text = a.entity_id
       JOIN service_catalog_items i ON i.id = r.item_id
       LEFT JOIN users u ON u.id = r.requester_id
       WHERE a.entity_type = 'catalog_request'
         AND a.status = 'pending'
         AND ($1 OR a.approver_role = $2)
       ORDER BY a.created_at ASC
       LIMIT 200`,
      [isAdmin, role],
    );
    res.json({ inbox: rows });
  } catch (err) {
    sendCatalogError(res, err);
  }
});

export default router;
