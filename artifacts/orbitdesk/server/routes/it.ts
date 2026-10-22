/**
 * DEJOIY IT (it.dejoiy.com) API, mounted under /api.
 *
 * Built on the existing OrbitDesk ITSM tables: service catalog + approvals,
 * tickets (incidents raised from the portal), problems, configuration_items
 * (assets and services). Employees get self-service; "IT agents" (admins, or
 * agents/managers in the IT department) get the console endpoints.
 */
import { Router, type Response } from "express";
import { pool } from "@workspace/db";
import { authMiddleware, type AuthenticatedRequest } from "../middlewares/auth.js";
import { CatalogError, createRequestItem } from "../lib/service-catalog.js";
import { ensureItCatalog } from "../lib/it-catalog-seed.js";

const router = Router();
router.use("/it", authMiddleware);

type User = NonNullable<AuthenticatedRequest["user"]>;

let itDeptCache: { id: number | null; at: number } | null = null;
async function itDepartmentId(): Promise<number | null> {
  if (itDeptCache && Date.now() - itDeptCache.at < 60_000) return itDeptCache.id;
  const { rows } = await pool.query(
    `SELECT id FROM departments WHERE lower(name) IN ('it','information technology','it support') ORDER BY id LIMIT 1`,
  );
  itDeptCache = { id: rows[0]?.id ?? null, at: Date.now() };
  return itDeptCache.id;
}

async function isAgent(u: User): Promise<boolean> {
  if (u.role === "super_admin" || u.role === "admin") return true;
  if (u.role !== "agent" && u.role !== "manager") return false;
  const dept = await itDepartmentId();
  return dept != null && u.departmentId === dept;
}

function fail(res: Response, err: unknown) {
  if (err instanceof CatalogError) return res.status(err.status).json({ error: err.message });
  console.error("[it] error", err);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

const agentOnly =
  (handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  async (req: AuthenticatedRequest, res: Response) => {
    if (!(await isAgent(req.user!))) return res.status(403).json({ error: "IT team only" });
    try {
      await handler(req, res);
    } catch (err) {
      fail(res, err);
    }
  };

/* ── Session ─────────────────────────────────────────────────────────── */

router.get("/it/session", async (req: AuthenticatedRequest, res) => {
  try {
    const u = req.user!;
    const dept = await itDepartmentId();
    const { rows } = await pool.query(`SELECT name FROM departments WHERE id = $1`, [u.departmentId ?? null]);
    res.json({
      user: { id: u.id, name: u.name, email: u.email, role: u.role, departmentName: rows[0]?.name ?? null },
      isAgent: await isAgent(u),
      isAdmin: u.role === "super_admin" || u.role === "admin",
      itDepartmentId: dept,
    });
  } catch (err) {
    fail(res, err);
  }
});

/* ── Catalog ─────────────────────────────────────────────────────────── */

const ITEM_COLS = `i.id, i.name, i.kind, i.group_name AS "group", i.icon, i.description, i.delivery,
  i.featured, i.sort_order AS "sortOrder", i.is_active AS "isActive", i.form_schema AS "formSchema",
  jsonb_array_length(i.approval_chain) AS "approvalSteps", i.approval_chain AS "approvalChain",
  i.fulfilment_tasks AS "fulfilmentTasks"`;

async function catalogScope(): Promise<{ where: string; params: unknown[] }> {
  const dept = await itDepartmentId();
  await ensureItCatalog(dept);
  return { where: `(i.category = 'IT' OR i.department_id = $1)`, params: [dept] };
}

router.get("/it/catalog", async (req: AuthenticatedRequest, res) => {
  try {
    const { where, params } = await catalogScope();
    const all = req.query.all === "true" && (await isAgent(req.user!));
    const { rows } = await pool.query(
      `SELECT ${ITEM_COLS} FROM service_catalog_items i
       WHERE ${where} ${all ? "" : "AND i.is_active = true"}
       ORDER BY i.sort_order, i.name`,
      params,
    );
    res.json({ items: rows });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/it/catalog/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const { where, params } = await catalogScope();
    const { rows } = await pool.query(
      `SELECT ${ITEM_COLS} FROM service_catalog_items i WHERE ${where} AND i.id = $2`,
      [...params, Number(req.params.id)],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json({ item: rows[0] });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/it/catalog/:id/request", async (req: AuthenticatedRequest, res) => {
  try {
    const itemId = Number(req.params.id);
    const request = await createRequestItem(itemId, req.user!.id, req.body?.form_data);
    const { rows } = await pool.query(`SELECT fulfilment_tasks FROM service_catalog_items WHERE id = $1`, [itemId]);
    const tasks: unknown = rows[0]?.fulfilment_tasks;
    if (Array.isArray(tasks)) {
      for (const [n, title] of tasks.entries()) {
        if (typeof title === "string" && title.trim()) {
          await pool.query(
            `INSERT INTO it_request_tasks (request_id, title, sort_order) VALUES ($1, $2, $3)`,
            [request.id, title.trim().slice(0, 200), n],
          );
        }
      }
    }
    res.status(201).json({ request: { id: request.id, requestNumber: request.request_number } });
  } catch (err) {
    fail(res, err);
  }
});

/** Agents: show/hide a catalog entry or mark it featured. */
router.patch(
  "/it/catalog/:id",
  agentOnly(async (req, res) => {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [key, col] of [["isActive", "is_active"], ["featured", "featured"]] as const) {
      if (typeof req.body?.[key] === "boolean") {
        vals.push(req.body[key]);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    for (const [key, col, max] of [["delivery", "delivery", 120], ["description", "description", 2000]] as const) {
      if (typeof req.body?.[key] === "string") {
        vals.push(req.body[key].trim().slice(0, max));
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(Number(req.params.id));
    await pool.query(
      `UPDATE service_catalog_items SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`,
      vals,
    );
    res.json({ ok: true });
  }),
);

/* ── Requests ────────────────────────────────────────────────────────── */

const STAGE_SQL = `CASE
    WHEN r.status IN ('rejected','cancelled') THEN r.status
    WHEN r.status IN ('submitted','in_approval') THEN 'awaiting_approval'
    WHEN r.ticket_id IS NULL THEN 'queued'
    WHEN t.status IN ('resolved','closed') THEN 'done'
    ELSE 'in_progress' END`;

const REQUEST_COLS = `r.id, r.request_number AS "requestNumber", r.status, ${STAGE_SQL} AS stage,
  r.form_data AS "formData", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
  i.id AS "itemId", i.name AS "itemName", i.icon AS "itemIcon", i.kind AS "itemKind", i.delivery,
  u.id AS "requesterId", u.name AS "requesterName",
  t.id AS "ticketId", t.ticket_number AS "ticketNumber", t.status AS "ticketStatus",
  (SELECT count(*)::int FROM it_request_tasks k WHERE k.request_id = r.id) AS "tasksTotal",
  (SELECT count(*)::int FROM it_request_tasks k WHERE k.request_id = r.id AND k.done) AS "tasksDone",
  (SELECT a.approver_role FROM approvals a WHERE a.entity_type = 'catalog_request'
     AND a.entity_id = r.id::text AND a.status = 'pending' ORDER BY a.step_order LIMIT 1) AS "waitingOn"`;
const REQUEST_FROM = `FROM service_catalog_requests r
  JOIN service_catalog_items i ON i.id = r.item_id
  LEFT JOIN users u ON u.id = r.requester_id
  LEFT JOIN tickets t ON t.id = r.ticket_id`;

router.get("/it/requests", async (req: AuthenticatedRequest, res) => {
  try {
    const { where, params } = await catalogScope();
    const vals = [...params];
    let cond = where;
    const everyone = req.query.scope === "all" && (await isAgent(req.user!));
    if (!everyone) {
      vals.push(req.user!.id);
      cond += ` AND r.requester_id = $${vals.length}`;
    }
    const stage = String(req.query.stage ?? "");
    if (["awaiting_approval", "queued", "in_progress", "done", "rejected", "cancelled"].includes(stage)) {
      vals.push(stage);
      cond += ` AND ${STAGE_SQL} = $${vals.length}`;
    }
    const { rows } = await pool.query(
      `SELECT ${REQUEST_COLS} ${REQUEST_FROM} WHERE ${cond} ORDER BY r.created_at DESC LIMIT 300`,
      vals,
    );
    res.json({ requests: rows });
  } catch (err) {
    fail(res, err);
  }
});

async function loadRequest(id: number) {
  const { rows } = await pool.query(`SELECT ${REQUEST_COLS}, i.form_schema AS "formSchema" ${REQUEST_FROM} WHERE r.id = $1`, [id]);
  return rows[0] ?? null;
}

router.get("/it/requests/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const request = await loadRequest(id);
    if (!request) return res.status(404).json({ error: "Not found" });
    const agent = await isAgent(req.user!);
    if (!agent && request.requesterId !== req.user!.id) return res.status(404).json({ error: "Not found" });
    const [approvals, tasks] = await Promise.all([
      pool.query(
        `SELECT a.id, a.step_order AS "step", a.approver_role AS "role", a.status, a.decided_at AS "decidedAt",
                a.comment, u.name AS "approverName"
         FROM approvals a LEFT JOIN users u ON u.id = a.approver_id
         WHERE a.entity_type = 'catalog_request' AND a.entity_id = $1 ORDER BY a.step_order`,
        [String(id)],
      ),
      pool.query(
        `SELECT k.id, k.title, k.done, k.done_at AS "doneAt", u.name AS "doneBy"
         FROM it_request_tasks k LEFT JOIN users u ON u.id = k.done_by_id
         WHERE k.request_id = $1 ORDER BY k.sort_order, k.id`,
        [id],
      ),
    ]);
    res.json({ request, approvals: approvals.rows, tasks: tasks.rows, canWork: agent });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/it/requests/:id/cancel", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE service_catalog_requests SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND requester_id = $2 AND status IN ('submitted','in_approval')`,
      [id, req.user!.id],
    );
    if (!rowCount) return res.status(409).json({ error: "Only a request that is still awaiting approval can be cancelled." });
    await pool.query(
      `UPDATE approvals SET status = 'skipped', decided_at = now()
       WHERE entity_type = 'catalog_request' AND entity_id = $1 AND status = 'pending'`,
      [String(id)],
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

/** Agents tick fulfilment tasks; the last one resolves the fulfilment ticket. */
router.patch(
  "/it/requests/:id/tasks/:taskId",
  agentOnly(async (req, res) => {
    const id = Number(req.params.id);
    const done = req.body?.done === true;
    const { rowCount } = await pool.query(
      `UPDATE it_request_tasks
       SET done = $3, done_by_id = CASE WHEN $3 THEN $4::int END, done_at = CASE WHEN $3 THEN now() END
       WHERE id = $1 AND request_id = $2`,
      [Number(req.params.taskId), id, done, req.user!.id],
    );
    if (!rowCount) return res.status(404).json({ error: "Task not found" });
    const request = await loadRequest(id);
    let resolved = false;
    if (request && request.tasksTotal > 0 && request.tasksDone === request.tasksTotal && request.ticketId
        && !["resolved", "closed"].includes(request.ticketStatus)) {
      await pool.query(`UPDATE tickets SET status = 'resolved', updated_at = now() WHERE id = $1`, [request.ticketId]);
      await pool.query(
        `INSERT INTO ticket_history (ticket_id, action, old_value, new_value, changed_by_id)
         VALUES ($1, 'status_changed', $2, 'resolved', $3)`,
        [request.ticketId, request.ticketStatus, req.user!.id],
      );
      await pool.query(
        `INSERT INTO ticket_comments (ticket_id, content, is_internal, author_id)
         VALUES ($1, $2, false, $3)`,
        [request.ticketId, `All fulfilment steps for ${request.itemName} are complete.`, req.user!.id],
      );
      resolved = true;
    }
    res.json({ ok: true, resolved });
  }),
);

/* ── Assets (configuration_items) ───────────────────────────────────── */

export const ASSET_TYPES = ["laptop", "desktop", "monitor", "headset", "phone", "dock", "peripheral", "licence", "network", "server", "other"];
const PREFIX: Record<string, string> = {
  laptop: "LT", desktop: "DT", monitor: "MN", headset: "HS", phone: "PH", dock: "DK",
  peripheral: "PR", licence: "LC", network: "NW", server: "SV", other: "AS",
};
const ASSET_COLS = `c.id, c.name, c.ci_type AS "type", c.status, c.health, c.attributes,
  c.owner_id AS "ownerId", o.name AS "ownerName", o.email AS "ownerEmail",
  c.department_id AS "departmentId", d.name AS "departmentName", c.updated_at AS "updatedAt"`;

router.get("/it/assets", async (req: AuthenticatedRequest, res) => {
  try {
    const agent = await isAgent(req.user!);
    const vals: unknown[] = [ASSET_TYPES];
    let cond = `c.deleted_at IS NULL AND c.ci_type = ANY($1::text[])`;
    if (!(agent && req.query.scope === "all")) {
      vals.push(req.user!.id);
      cond += ` AND c.owner_id = $${vals.length}`;
    }
    if (typeof req.query.type === "string" && ASSET_TYPES.includes(req.query.type)) {
      vals.push(req.query.type);
      cond += ` AND c.ci_type = $${vals.length}`;
    }
    if (typeof req.query.status === "string" && req.query.status) {
      vals.push(req.query.status);
      cond += ` AND c.status = $${vals.length}`;
    }
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      vals.push(`%${req.query.q.trim().toLowerCase()}%`);
      cond += ` AND (lower(c.name) LIKE $${vals.length} OR lower(c.attributes::text) LIKE $${vals.length} OR lower(coalesce(o.name,'')) LIKE $${vals.length})`;
    }
    const { rows } = await pool.query(
      `SELECT ${ASSET_COLS} FROM configuration_items c
       LEFT JOIN users o ON o.id = c.owner_id LEFT JOIN departments d ON d.id = c.department_id
       WHERE ${cond} ORDER BY c.updated_at DESC LIMIT 500`,
      vals,
    );
    res.json({ assets: rows, types: ASSET_TYPES });
  } catch (err) {
    fail(res, err);
  }
});

const ATTR_KEYS = ["assetTag", "serial", "model", "vendor", "purchasedOn", "warrantyUntil", "location", "notes"];
function cleanAttributes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const k of ATTR_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
    }
  }
  return out;
}
const ASSET_STATUSES = ["in_stock", "assigned", "in_repair", "retired", "lost"];

router.post(
  "/it/assets",
  agentOnly(async (req, res) => {
    const b = req.body ?? {};
    const type = String(b.type ?? "");
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 160) : "";
    if (!name || !ASSET_TYPES.includes(type)) return res.status(400).json({ error: "Name and a valid type are required." });
    const ownerId = Number(b.ownerId) || null;
    const status = ASSET_STATUSES.includes(b.status) ? b.status : ownerId ? "assigned" : "in_stock";
    const attrs = cleanAttributes(b.attributes);
    const tenant = await pool.query(`SELECT id FROM tenants WHERE slug = 'default' LIMIT 1`);
    const { rows } = await pool.query(
      `INSERT INTO configuration_items (tenant_id, name, ci_type, status, owner_id, department_id, attributes)
       VALUES ($1,$2,$3,$4,$5,(SELECT department_id FROM users WHERE id = $5),$6::jsonb) RETURNING id`,
      [tenant.rows[0]?.id ?? null, name, type, status, ownerId, JSON.stringify(attrs)],
    );
    const id = rows[0].id as number;
    if (!attrs.assetTag) {
      await pool.query(
        `UPDATE configuration_items SET attributes = attributes || jsonb_build_object('assetTag', $2::text) WHERE id = $1`,
        [id, `DJ-${PREFIX[type]}-${String(id).padStart(4, "0")}`],
      );
    }
    res.status(201).json({ id });
  }),
);

router.patch(
  "/it/assets/:id",
  agentOnly(async (req, res) => {
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (sqlFrag: string, v: unknown) => {
      vals.push(v);
      sets.push(sqlFrag.replace("?", `$${vals.length}`));
    };
    if (typeof b.name === "string" && b.name.trim()) push("name = ?", b.name.trim().slice(0, 160));
    if (ASSET_STATUSES.includes(b.status)) push("status = ?", b.status);
    if (b.ownerId !== undefined) {
      const owner = Number(b.ownerId) || null;
      push("owner_id = ?", owner);
      push("department_id = (SELECT department_id FROM users WHERE id = ?)", owner);
    }
    if (b.attributes !== undefined) push("attributes = attributes || ?::jsonb", JSON.stringify(cleanAttributes(b.attributes)));
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(Number(req.params.id));
    const { rowCount } = await pool.query(
      `UPDATE configuration_items SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${vals.length} AND deleted_at IS NULL`,
      vals,
    );
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  }),
);

/* ── Problems ────────────────────────────────────────────────────────── */

const PROBLEM_STATUSES = ["open", "investigating", "known_error", "resolved", "closed"];

router.get(
  "/it/problems",
  agentOnly(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT p.id, p.problem_number AS "number", p.title, p.description, p.status, p.root_cause AS "rootCause",
              p.workaround, p.created_at AS "createdAt", p.updated_at AS "updatedAt", u.name AS "createdBy"
       FROM problems p LEFT JOIN users u ON u.id = p.created_by_id
       WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 200`,
    );
    res.json({ problems: rows });
  }),
);

router.post(
  "/it/problems",
  agentOnly(async (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : "";
    if (title.length < 3) return res.status(400).json({ error: "Give the problem a title." });
    const description = typeof req.body?.description === "string" ? req.body.description.slice(0, 4000) : null;
    const tenant = await pool.query(`SELECT id FROM tenants WHERE slug = 'default' LIMIT 1`);
    const { rows } = await pool.query(
      `INSERT INTO problems (tenant_id, problem_number, title, description, created_by_id)
       VALUES ($1, 'PRB-' || upper(substr(md5(random()::text), 1, 6)), $2, $3, $4) RETURNING id`,
      [tenant.rows[0]?.id ?? null, title, description, req.user!.id],
    );
    res.status(201).json({ id: rows[0].id });
  }),
);

router.patch(
  "/it/problems/:id",
  agentOnly(async (req, res) => {
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (PROBLEM_STATUSES.includes(b.status)) {
      vals.push(b.status);
      sets.push(`status = $${vals.length}`);
    }
    for (const k of ["workaround", "description"] as const) {
      if (typeof b[k] === "string") {
        vals.push(b[k].slice(0, 4000));
        sets.push(`${k} = $${vals.length}`);
      }
    }
    if (typeof b.rootCause === "string") {
      vals.push(b.rootCause.slice(0, 4000));
      sets.push(`root_cause = $${vals.length}`);
      vals.push(req.user!.id);
      sets.push(`root_cause_confirmed_by_id = $${vals.length}, root_cause_confirmed_at = now()`);
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(Number(req.params.id));
    await pool.query(`UPDATE problems SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
    res.json({ ok: true });
  }),
);

/* ── Status page + overview ─────────────────────────────────────────── */

router.get("/it/status", async (_req: AuthenticatedRequest, res) => {
  try {
    const [services, incidents] = await Promise.all([
      pool.query(
        `SELECT id, name, health, status, updated_at AS "updatedAt" FROM configuration_items
         WHERE deleted_at IS NULL AND ci_type IN ('service','application') ORDER BY name LIMIT 60`,
      ),
      pool.query(
        `SELECT id, incident_number AS "number", title, severity, status, is_major AS "isMajor", started_at AS "startedAt"
         FROM incidents WHERE deleted_at IS NULL AND status NOT IN ('resolved','closed')
         ORDER BY is_major DESC, started_at DESC LIMIT 10`,
      ),
    ]);
    res.json({ services: services.rows, incidents: incidents.rows });
  } catch (err) {
    fail(res, err);
  }
});

router.get(
  "/it/overview",
  agentOnly(async (_req, res) => {
    const dept = await itDepartmentId();
    const { where, params } = await catalogScope();
    const [tickets, byPriority, requests, assets, incidents, problems, changes, approvals] = await Promise.all([
      pool.query(
        `SELECT count(*) FILTER (WHERE status::text NOT IN ('resolved','closed'))::int AS open,
                count(*) FILTER (WHERE status::text NOT IN ('resolved','closed') AND assignee_id IS NULL AND assigned_ai_worker_id IS NULL)::int AS unassigned,
                count(*) FILTER (WHERE status::text NOT IN ('resolved','closed') AND sla_breached)::int AS breached,
                count(*) FILTER (WHERE status::text IN ('resolved','closed') AND updated_at > now() - interval '7 days')::int AS "resolved7d",
                count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS "new7d"
         FROM tickets WHERE department_id = $1`,
        [dept],
      ),
      pool.query(
        `SELECT priority::text AS priority, count(*)::int AS n FROM tickets
         WHERE department_id = $1 AND status::text NOT IN ('resolved','closed') GROUP BY 1`,
        [dept],
      ),
      pool.query(
        `SELECT ${STAGE_SQL} AS stage, count(*)::int AS n ${REQUEST_FROM} WHERE ${where} GROUP BY 1`,
        params,
      ),
      pool.query(
        `SELECT status, count(*)::int AS n FROM configuration_items
         WHERE deleted_at IS NULL AND ci_type = ANY($1::text[]) GROUP BY 1`,
        [ASSET_TYPES],
      ),
      pool.query(
        `SELECT count(*)::int AS open, count(*) FILTER (WHERE is_major)::int AS major FROM incidents
         WHERE deleted_at IS NULL AND status NOT IN ('resolved','closed')`,
      ),
      pool.query(`SELECT count(*)::int AS open FROM problems WHERE deleted_at IS NULL AND status NOT IN ('resolved','closed')`),
      pool.query(
        `SELECT count(*) FILTER (WHERE status IN ('draft','pending_approval'))::int AS pending,
                count(*) FILTER (WHERE status IN ('approved','scheduled','implementing'))::int AS upcoming
         FROM changes WHERE deleted_at IS NULL`,
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM approvals WHERE status = 'pending' AND entity_type = 'catalog_request'`,
      ),
    ]);
    const tally = (rows: { [k: string]: unknown }[], key: string) =>
      Object.fromEntries(rows.map((r) => [String(r[key]), Number(r.n)]));
    res.json({
      tickets: tickets.rows[0],
      byPriority: tally(byPriority.rows, "priority"),
      requests: tally(requests.rows, "stage"),
      assets: tally(assets.rows, "status"),
      incidents: incidents.rows[0],
      problems: problems.rows[0],
      changes: changes.rows[0],
      pendingApprovals: approvals.rows[0].n,
    });
  }),
);

/** People picker for assigning assets (agents only). */
router.get(
  "/it/people",
  agentOnly(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    // ?team=true → the IT team (assignable agents), otherwise anyone (asset owners).
    const team = req.query.team === "true";
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, d.name AS "departmentName" FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.is_active AND ($1 = '' OR lower(u.name) LIKE $2 OR lower(u.email) LIKE $2)
         AND (NOT $3::boolean OR (u.department_id = $4 AND u.role IN ('agent','manager','admin','super_admin'))
              OR u.role IN ('admin','super_admin') AND $3::boolean)
       ORDER BY u.name LIMIT 30`,
      [q, `%${q}%`, team, await itDepartmentId()],
    );
    res.json({ people: rows });
  }),
);

export default router;
