import { Router } from "express";
import { db, usersTable, departmentsTable, eq } from "@workspace/db";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth.js";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";

const router = Router();

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Bad Request", message: "Email and password required" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
      return;
    }

    if (!user.isActive) {
      res.status(401).json({ error: "Unauthorized", message: "Account is inactive" });
      return;
    }

    const token = generateToken(user.id);

    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentName,
        avatar: user.avatar,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ error: "Internal Server Error", message: "Login failed" });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.json({ success: true, message: "Logged out" });
});

router.get("/auth/me", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      departmentName,
      avatar: user.avatar,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Get me error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
