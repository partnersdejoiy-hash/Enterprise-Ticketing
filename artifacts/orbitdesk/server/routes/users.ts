import { Router } from "express";
import { db, pool, usersTable, departmentsTable, eq } from "@workspace/db";
import { hashPassword } from "../lib/security.js";
import {
  authMiddleware,
  AuthenticatedRequest,
  requireAdmin,
} from "../middlewares/auth.js";
const router = Router();
const ROLES = [
  "employee",
  "agent",
  "manager",
  "admin",
  "super_admin",
  "external",
] as const;
const admin = (role: string) => ["admin", "super_admin"].includes(role);
export async function canManagePeople(user: typeof usersTable.$inferSelect) {
  if (admin(user.role)) return true;
  if (!["agent", "manager"].includes(user.role) || !user.departmentId)
    return false;
  const [dept] = await db
    .select()
    .from(departmentsTable)
    .where(eq(departmentsTable.id, user.departmentId));
  return (
    !!dept && /^(it|it support|information technology)$/i.test(dept.name.trim())
  );
}
const format = (u: any) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  departmentId: u.department_id,
  departmentName: u.department_name ?? null,
  managerId: u.manager_id,
  managerName: u.manager_name ?? null,
  teamName: u.team_name,
  mustChangePassword: u.must_change_password,
  avatar: u.avatar,
  isActive: u.is_active,
  employeeId: u.employee_id,
  createdAt: u.created_at.toISOString(),
});
const select =
  "SELECT u.*,d.name department_name,m.name manager_name FROM users u LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN users m ON m.id=u.manager_id";
// Minimal internal directory supports verified employee selection, not public lookup.
router.get(
  "/directory",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    if (req.user!.role === "external") {
      res.json([]);
      return;
    }
    const { role, departmentId, employeeId, name } = req.query;
    const params: any[] = [];
    const filters = ["u.is_active=true", "u.role<>'external'"];
    if (role && ROLES.includes(role as any)) {
      params.push(role);
      filters.push(`u.role=$${params.length}`);
    }
    if (departmentId && Number.isSafeInteger(Number(departmentId))) {
      params.push(Number(departmentId));
      filters.push(`u.department_id=$${params.length}`);
    }
    if (employeeId) {
      params.push(String(employeeId).slice(0, 100));
      filters.push(`u.employee_id=$${params.length}`);
    }
    if (name) {
      params.push("%" + String(name).slice(0, 100) + "%");
      filters.push(`u.name ILIKE $${params.length}`);
    }
    const rows = await pool.query(
      `${select} WHERE ${filters.join(" AND ")} ORDER BY u.name LIMIT 500`,
      params,
    );
    res.json(
      rows.rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        departmentId: u.department_id,
        departmentName: u.department_name,
        employeeId: u.employee_id,
        managerId: u.manager_id,
        teamName: u.team_name,
        isActive: u.is_active,
      })),
    );
  },
);
router.use(
  "/users",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
    if (!(await canManagePeople(req.user!))) {
      res.status(403).json({ error: "User administration forbidden" });
      return;
    }
    next();
  },
);
router.get("/users", async (req, res) => {
  const params: any[] = [];
  const filters: string[] = [];
  if (req.query.role) {
    if (!ROLES.includes(req.query.role as any)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    params.push(req.query.role);
    filters.push(`u.role=$${params.length}`);
  }
  if (req.query.departmentId) {
    params.push(Number(req.query.departmentId));
    filters.push(`u.department_id=$${params.length}`);
  }
  const rows = await pool.query(
    `${select}${filters.length ? " WHERE " + filters.join(" AND ") : ""} ORDER BY u.name`,
    params,
  );
  res.json(rows.rows.map(format));
});
async function createUser(req: AuthenticatedRequest, b: any) {
  const role = b.role ?? "employee";
  if (
    !ROLES.includes(role) ||
    (!admin(req.user!.role) &&
      !["employee", "agent", "manager", "external"].includes(role)) ||
    (req.user!.role !== "super_admin" && role === "super_admin")
  )
    throw Object.assign(new Error("Role assignment forbidden"), {
      status: 403,
    });
  if (
    typeof b.name !== "string" ||
    !b.name.trim() ||
    b.name.length > 150 ||
    typeof b.email !== "string" ||
    b.email.length > 254 ||
    !/^\S+@\S+\.\S+$/.test(b.email) ||
    typeof b.password !== "string" ||
    b.password.length < 12 ||
    b.password.length > 1024
  )
    throw Object.assign(
      new Error(
        "Valid name, email and temporary password (12–1024 characters) required",
      ),
      { status: 400 },
    );
  if (
    b.departmentId != null &&
    (!Number.isSafeInteger(b.departmentId) ||
      !(
        await pool.query("SELECT id FROM departments WHERE id=$1", [
          b.departmentId,
        ])
      ).rowCount)
  )
    throw Object.assign(new Error("Invalid department"), { status: 400 });
  const [u] = await db
    .insert(usersTable)
    .values({
      name: b.name.trim(),
      email: b.email.trim().toLowerCase(),
      passwordHash: await hashPassword(b.password),
      role,
      departmentId: b.departmentId ?? null,
      mustChangePassword: true,
    })
    .returning();
  return format((await pool.query(`${select} WHERE u.id=$1`, [u.id])).rows[0]);
}
function failure(res: any, e: any) {
  const status = e.status ?? (e.code === "23505" ? 409 : 500);
  res
    .status(status)
    .json({
      error:
        status === 500
          ? "Could not save user"
          : e.code === "23505"
            ? "Email or employee ID already exists"
            : e.message,
    });
}
router.post("/users", async (req: AuthenticatedRequest, res) => {
  try {
    res.status(201).json(await createUser(req, req.body));
  } catch (e) {
    failure(res, e);
  }
});
router.post(
  "/users/bulk",
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const rows = req.body.rows;
    if (!Array.isArray(rows) || !rows.length || rows.length > 500) {
      res.status(400).json({ error: "Provide 1–500 rows" });
      return;
    }
    const depts = (await pool.query("SELECT id,name FROM departments")).rows;
    let created = 0;
    const errors: any[] = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i];
        const dept = row.department_name
          ? depts.find(
              (d) =>
                d.name.toLowerCase() ===
                row.department_name.trim().toLowerCase(),
            )
          : null;
        if (row.department_name && !dept)
          throw new Error("Department not found");
        await createUser(req, { ...row, departmentId: dept?.id });
        created++;
      } catch (e: any) {
        errors.push({
          row: i + 1,
          error: e.code === "23505" ? "Email exists" : e.message,
        });
      }
    }
    res.status(201).json({ created, errors });
  },
);
async function updateUser(req: AuthenticatedRequest, id: number, b: any) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(842197)");
    const target = (
      await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!target)
      throw Object.assign(new Error("User not found"), { status: 404 });
    const caller = req.user!;
    const isAdmin = admin(caller.role);
    if (
      (caller.role !== "super_admin" && target.role === "super_admin") ||
      (!isAdmin && admin(target.role))
    )
      throw Object.assign(
        new Error("This account requires a higher administrator"),
        { status: 403 },
      );
    const allowed = isAdmin
      ? [
          "name",
          "role",
          "departmentId",
          "managerId",
          "teamName",
          "isActive",
          "employeeId",
          "newPassword",
        ]
      : ["departmentId", "managerId", "teamName", "newPassword"];
    if (Object.keys(b).some((k) => !allowed.includes(k)))
      throw Object.assign(new Error("You cannot change these account fields"), {
        status: 403,
      });
    if (
      b.role !== undefined &&
      (!ROLES.includes(b.role) ||
        (caller.role !== "super_admin" && b.role === "super_admin"))
    )
      throw Object.assign(new Error("Role assignment forbidden"), {
        status: 403,
      });
    if (
      id === caller.id &&
      (b.isActive === false || (b.role && b.role !== caller.role))
    )
      throw Object.assign(
        new Error("Another administrator must change your own access"),
        { status: 409 },
      );
    if (
      b.departmentId != null &&
      (!Number.isSafeInteger(b.departmentId) ||
        !(
          await client.query("SELECT id FROM departments WHERE id=$1", [
            b.departmentId,
          ])
        ).rowCount)
    )
      throw Object.assign(new Error("Invalid department"), { status: 400 });
    if (b.managerId != null) {
      if (!Number.isSafeInteger(b.managerId) || b.managerId === id)
        throw Object.assign(new Error("Choose a different reporting manager"), {
          status: 400,
        });
      const manager = (
        await client.query(
          "SELECT id FROM users WHERE id=$1 AND is_active AND role NOT IN ('external','employee')",
          [b.managerId],
        )
      ).rows[0];
      const cycle = await client.query(
        "WITH RECURSIVE team(id) AS(SELECT $1::integer UNION SELECT u.id FROM users u JOIN team ON u.manager_id=team.id) SELECT id FROM team WHERE id=$2",
        [id, b.managerId],
      );
      if (!manager || cycle.rowCount)
        throw Object.assign(
          new Error("Invalid manager or circular reporting relationship"),
          { status: 400 },
        );
    }
    if (b.isActive !== undefined && typeof b.isActive !== "boolean")
      throw Object.assign(new Error("Invalid active status"), { status: 400 });
    for (const k of ["name", "employeeId", "teamName"])
      if (
        b[k] !== undefined &&
        b[k] !== null &&
        (typeof b[k] !== "string" ||
          b[k].length > 150 ||
          (k === "name" && !b[k].trim()))
      )
        throw Object.assign(new Error("Invalid user details"), { status: 400 });
    const mapping: Record<string, string> = {
      name: "name",
      role: "role",
      departmentId: "department_id",
      managerId: "manager_id",
      teamName: "team_name",
      isActive: "is_active",
      employeeId: "employee_id",
    };
    const values: any[] = [];
    const sets: string[] = [];
    const changes: Record<string, any> = {};
    for (const [key, column] of Object.entries(mapping))
      if (b[key] !== undefined) {
        const value =
          typeof b[key] === "string" ? b[key].trim() || null : b[key];
        values.push(value);
        sets.push(`${column}=$${values.length}`);
        changes[key] = { from: target[column], to: value };
      }
    if (b.newPassword !== undefined) {
      if (
        typeof b.newPassword !== "string" ||
        b.newPassword.length < 12 ||
        b.newPassword.length > 1024
      )
        throw Object.assign(
          new Error("Use a temporary password of 12–1024 characters"),
          { status: 400 },
        );
      values.push(await hashPassword(b.newPassword));
      sets.push(`password_hash=$${values.length}`, "must_change_password=true");
      changes.passwordReset = true;
    }
    if (!sets.length)
      throw Object.assign(new Error("No changes provided"), { status: 400 });
    values.push(id);
    await client.query(
      `UPDATE users SET ${sets.join(",")},updated_at=now() WHERE id=$${values.length}`,
      values,
    );
    await client.query(
      "INSERT INTO user_access_history(user_id,changed_by_id,changes) VALUES($1,$2,$3)",
      [id, caller.id, JSON.stringify(changes)],
    );
    if (b.newPassword !== undefined || b.isActive === false)
      await client.query("DELETE FROM orbit_sessions WHERE user_id=$1", [id]);
    const result = (await client.query(`${select} WHERE u.id=$1`, [id]))
      .rows[0];
    await client.query("COMMIT");
    return format(result);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
router.patch(
  "/users/bulk-role",
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const { userIds, role } = req.body;
    if (
      !Array.isArray(userIds) ||
      !userIds.length ||
      userIds.length > 500 ||
      !ROLES.includes(role)
    ) {
      res.status(400).json({ error: "Invalid users or role" });
      return;
    }
    let updated = 0;
    let skipped = 0;
    for (const id of userIds) {
      try {
        await updateUser(req, id, { role });
        updated++;
      } catch {
        skipped++;
      }
    }
    res.json({ updated, skipped });
  },
);
router.patch("/users/:userId", async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await updateUser(req, Number(req.params.userId), req.body));
  } catch (e) {
    failure(res, e);
  }
});
router.get("/users/:userId", async (req, res) => {
  const result = await pool.query(`${select} WHERE u.id=$1`, [
    Number(req.params.userId),
  ]);
  if (!result.rowCount) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(format(result.rows[0]));
});
// Keep historical ticket identities and audit records; revoke access instead of deleting people.
router.delete("/users/:userId", requireAdmin, async (_req, res) => {
  res
    .status(409)
    .json({ error: "Deactivate this user to preserve ticket history." });
});
export default router;
