import { Router } from "express";
import { db, usersTable, departmentsTable, eq, and } from "@workspace/db";
import { hashPassword } from "../lib/auth.js";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";

const ROLES = ["employee", "agent", "manager", "admin", "super_admin", "external"] as const;
type Role = typeof ROLES[number];

function canAssignRole(callerRole: string, targetCurrentRole: string, newRole: string): boolean {
  if (callerRole === "super_admin") return true;
  if (callerRole === "admin") {
    return targetCurrentRole !== "super_admin" && newRole !== "super_admin";
  }
  return false;
}

const router = Router();

function formatUser(user: typeof usersTable.$inferSelect, departmentName?: string | null) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
    departmentName: departmentName ?? null,
    avatar: user.avatar,
    isActive: user.isActive,
    employeeId: (user as any).employeeId ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/users", authMiddleware, async (req, res) => {
  try {
    const { role, departmentId } = req.query;

    let query = db.select().from(usersTable);
    const conditions = [];

    if (role) {
      conditions.push(eq(usersTable.role, role as string));
    }
    if (departmentId) {
      conditions.push(eq(usersTable.departmentId, parseInt(departmentId as string, 10)));
    }

    const users = conditions.length > 0
      ? await db.select().from(usersTable).where(and(...conditions)).orderBy(usersTable.name)
      : await db.select().from(usersTable).orderBy(usersTable.name);

    const departments = await db.select().from(departmentsTable);
    const deptMap = new Map(departments.map((d) => [d.id, d.name]));

    res.json(
      users.map((u) => formatUser(u, u.departmentId ? deptMap.get(u.departmentId) : null))
    );
  } catch (err) {
    req.log.error({ err }, "List users error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/users", authMiddleware, async (req, res) => {
  try {
    const { name, email, password, role = "employee", departmentId } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: "Bad Request", message: "Name, email, and password required" });
      return;
    }

    const passwordHash = hashPassword(password);

    const [user] = await db
      .insert(usersTable)
      .values({ name, email, passwordHash, role, departmentId: departmentId ?? null })
      .returning();

    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }

    res.status(201).json(formatUser(user, departmentName));
  } catch (err) {
    req.log.error({ err }, "Create user error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/users/lookup", authMiddleware, async (req, res) => {
  try {
    const { employeeId } = req.query;
    if (!employeeId) { res.status(400).json({ error: "employeeId query param required" }); return; }
    const [user] = await db.select().from(usersTable).where(eq((usersTable as any).employeeId, employeeId as string)).limit(1);
    if (!user) { res.status(404).json({ error: "Not Found", message: "No user found with that employee ID" }); return; }
    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }
    res.json(formatUser(user, departmentName));
  } catch (err) {
    req.log.error({ err }, "Lookup user error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/users/:userId", authMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (!user) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }

    res.json(formatUser(user, departmentName));
  } catch (err) {
    req.log.error({ err }, "Get user error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/users/bulk-role", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const callerRole = req.user!.role;
    if (callerRole !== "super_admin" && callerRole !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const { userIds, role } = req.body as { userIds: number[]; role: string };
    if (!Array.isArray(userIds) || !userIds.length || !ROLES.includes(role as Role)) {
      res.status(400).json({ error: "Bad Request", message: "userIds array and valid role required" });
      return;
    }
    const targets = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable);
    const targetMap = new Map(targets.map((t) => [t.id, t.role]));

    let updated = 0;
    const skipped: number[] = [];

    for (const uid of userIds) {
      const currentRole = targetMap.get(uid);
      if (currentRole === undefined) continue;
      if (!canAssignRole(callerRole, currentRole, role)) { skipped.push(uid); continue; }
      await db.update(usersTable).set({ role }).where(eq(usersTable.id, uid));
      updated++;
    }

    res.json({ updated, skipped: skipped.length, message: `${updated} user(s) updated, ${skipped.length} skipped due to insufficient permissions` });
  } catch (err) {
    req.log.error({ err }, "Bulk role error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/users/:userId", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const callerRole = req.user!.role;
    const userId = parseInt(req.params.userId, 10);
    const { name, role, departmentId, isActive, employeeId } = req.body;

    if (role !== undefined) {
      const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!target) { res.status(404).json({ error: "Not Found" }); return; }
      if (!canAssignRole(callerRole, target.role, role)) {
        res.status(403).json({ error: "Forbidden", message: "You cannot assign this role" });
        return;
      }
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (departmentId !== undefined) updates.departmentId = departmentId;
    if (isActive !== undefined) updates.isActive = isActive;
    if (employeeId !== undefined) updates.employeeId = employeeId || null;

    const [user] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, userId))
      .returning();

    if (!user) { res.status(404).json({ error: "Not Found" }); return; }

    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }

    res.json(formatUser(user, departmentName));
  } catch (err) {
    req.log.error({ err }, "Update user error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/users/:userId", authMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const deleted = await db.delete(usersTable).where(eq(usersTable.id, userId)).returning();
    if (!deleted.length) { res.status(404).json({ error: "Not Found" }); return; }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Delete user error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/users/bulk", authMiddleware, async (req, res) => {
  try {
    const { rows } = req.body as { rows: Array<Record<string, string>> };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Bad Request", message: "rows array required" });
      return;
    }

    const departments = await db.select().from(departmentsTable);
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));

    const created: number[] = [];
    const errors: { row: number; error: string }[] = [];
    const validRoles = ["employee", "agent", "manager", "admin", "super_admin", "external"];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row.name?.trim();
      const email = row.email?.trim().toLowerCase();
      const password = row.password?.trim();

      if (!name || !email || !password) {
        errors.push({ row: i + 1, error: "name, email, and password are required" });
        continue;
      }

      const role = validRoles.includes(row.role?.trim().toLowerCase()) ? row.role.trim().toLowerCase() : "employee";

      let departmentId: number | null = null;
      if (row.department_name?.trim()) {
        const dept = deptByName.get(row.department_name.trim().toLowerCase());
        if (dept) departmentId = dept.id;
        else { errors.push({ row: i + 1, error: `Department "${row.department_name}" not found` }); continue; }
      }

      try {
        const passwordHash = hashPassword(password);
        const [user] = await db.insert(usersTable).values({ name, email, passwordHash, role, departmentId }).returning();
        created.push(user.id);
      } catch (e: any) {
        if (e?.code === "23505") errors.push({ row: i + 1, error: `Email "${email}" already exists` });
        else errors.push({ row: i + 1, error: "Insert failed" });
      }
    }

    res.status(201).json({ created: created.length, errors });
  } catch (err) {
    req.log.error({ err }, "Bulk create users error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
