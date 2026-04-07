import { Router } from "express";
import { db, usersTable, departmentsTable, eq, and } from "@workspace/db";
import { hashPassword } from "../lib/auth.js";
import { authMiddleware } from "../middlewares/auth.js";

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
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/users", authMiddleware, async (req, res) => {
  try {
    const { role, departmentId } = req.query;
    const conditions = [];

    if (role) conditions.push(eq(usersTable.role, role as string));
    if (departmentId) conditions.push(eq(usersTable.departmentId, parseInt(departmentId as string, 10)));

    const users = conditions.length > 0
      ? await db.select().from(usersTable).where(and(...conditions)).orderBy(usersTable.name)
      : await db.select().from(usersTable).orderBy(usersTable.name);

    const departments = await db.select().from(departmentsTable);
    const deptMap = new Map(departments.map((d) => [d.id, d.name]));

    res.json(users.map((u) => formatUser(u, u.departmentId ? deptMap.get(u.departmentId) : null)));
  } catch (err) {
    console.error("List users error", err);
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
    const [user] = await db.insert(usersTable).values({ name, email, passwordHash, role, departmentId: departmentId ?? null }).returning();

    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }

    res.status(201).json(formatUser(user, departmentName));
  } catch (err) {
    console.error("Create user error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/users/:userId", authMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not Found" }); return; }

    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }

    res.json(formatUser(user, departmentName));
  } catch (err) {
    console.error("Get user error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/users/:userId", authMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const { name, role, departmentId, isActive } = req.body;

    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (departmentId !== undefined) updates.departmentId = departmentId;
    if (isActive !== undefined) updates.isActive = isActive;

    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
    if (!user) { res.status(404).json({ error: "Not Found" }); return; }

    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }

    res.json(formatUser(user, departmentName));
  } catch (err) {
    console.error("Update user error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
