import { Router } from "express";
import { db, usersTable, departmentsTable, ticketsTable, ticketHistoryTable, systemSettingsTable, eq, ilike } from "@workspace/db";
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

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Bad Request", message: "Email required" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);

    if (user) {
      const [itDept] = await db.select().from(departmentsTable).where(ilike(departmentsTable.name, "IT%")).limit(1);
      const ticketNumber = `DJ-${Math.floor(Math.random() * 900000) + 100000}`;
      const slaDeadline = itDept ? new Date(Date.now() + itDept.slaResolutionHours * 3600 * 1000) : null;

      const [ticket] = await db.insert(ticketsTable).values({
        ticketNumber,
        subject: `Password Reset Request — ${user.name}`,
        description: `User ${user.name} (${user.email}) has requested a password reset via the login page.\n\nPlease verify their identity and reset their password from the Users management page.`,
        priority: "medium",
        status: "open",
        departmentId: itDept?.id ?? null,
        assigneeId: null,
        createdById: user.id,
        tags: ["password-reset"],
        slaDeadline,
      } as any).returning();

      if (ticket) {
        await db.insert(ticketHistoryTable).values({ ticketId: ticket.id, action: "created", newValue: "open", changedById: user.id });
      }
    }

    res.json({ message: "If an account with this email exists, a password reset ticket has been raised. IT will contact you shortly." });
  } catch (err) {
    req.log.error({ err }, "Forgot password error");
    res.status(500).json({ error: "Internal Server Error" });
  }
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

router.put("/auth/profile", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { name, avatar } = req.body;

    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (typeof name === "string" && name.trim()) {
      updates.name = name.trim();
    }
    if (typeof avatar === "string") {
      if (avatar === "" || avatar.startsWith("data:image/")) {
        updates.avatar = avatar || null;
      } else {
        res.status(400).json({ error: "Invalid avatar format. Must be a data URL." });
        return;
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let departmentName: string | null = null;
    if (updated.departmentId) {
      const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, updated.departmentId)).limit(1);
      departmentName = dept?.name ?? null;
    }

    res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      departmentId: updated.departmentId,
      departmentName,
      avatar: updated.avatar,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Update profile error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/auth/sso/init", async (_req, res) => {
  try {
    const rows = await db.select().from(systemSettingsTable);
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const ssoEnabled = settings["sso_enabled"] === "true";
    const ssoUrl = settings["sso_redirect_url"] ?? null;
    if (ssoEnabled && ssoUrl) {
      res.json({ url: ssoUrl });
    } else {
      res.json({ url: null });
    }
  } catch {
    res.json({ url: null });
  }
});

export default router;
