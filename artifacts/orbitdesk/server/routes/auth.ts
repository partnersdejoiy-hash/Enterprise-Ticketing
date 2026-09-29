import { Router } from "express";
import {
  db,
  usersTable,
  departmentsTable,
  ticketsTable,
  ticketHistoryTable,
  systemSettingsTable,
  eq,
  ilike,
} from "@workspace/db";
import {
  hashPassword,
  verifyPassword,
  digest,
  rateLimit,
} from "../lib/security.js";
import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import {
  authMiddleware,
  AuthenticatedRequest,
  cookieName,
  sessionToken,
} from "../middlewares/auth.js";

const router = Router();

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!(await rateLimit(`login:${req.ip}`, 20, 900))) {
      res
        .status(429)
        .json({ error: "Too many login attempts. Try again later." });
      return;
    }

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email ||
      !password ||
      email.length > 254 ||
      password.length > 1024
    ) {
      res
        .status(400)
        .json({ error: "Bad Request", message: "Email and password required" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.trim().toLowerCase()))
      .limit(1);

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res
        .status(401)
        .json({ error: "Unauthorized", message: "Invalid credentials" });
      return;
    }

    if (!user.isActive) {
      res
        .status(403)
        .json({
          error: "AccessRevoked",
          message:
            "You are not authorised to utilise this tool. Please contact your supervisor or administration.",
        });
      return;
    }

    if (!user.passwordHash.startsWith("scrypt$")) {
      user.passwordHash = await hashPassword(password);
      await db
        .update(usersTable)
        .set({ passwordHash: user.passwordHash })
        .where(eq(usersTable.id, user.id));
    }
    const token = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO orbit_sessions(token_hash,user_id,password_fingerprint,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
      [digest(token), user.id, digest(user.passwordHash)],
    );
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 3600 * 1000,
    });

    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db
        .select()
        .from(departmentsTable)
        .where(eq(departmentsTable.id, user.departmentId))
        .limit(1);
      departmentName = dept?.name ?? null;
    }

    res.json({
      token: "cookie-session",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentName,
        avatar: user.avatar,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
        managerId: user.managerId,
        teamName: user.teamName,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("Login error", err);
    res
      .status(500)
      .json({ error: "Internal Server Error", message: "Login failed" });
  }
});

router.post(
  "/auth/change-password",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    if (!(await rateLimit(`password-change:${req.user!.id}`, 10, 900))) {
      res.status(429).json({ error: "Too many attempts. Try again later." });
      return;
    }
    const { currentPassword, newPassword } = req.body;
    if (
      typeof currentPassword !== "string" ||
      currentPassword.length > 1024 ||
      typeof newPassword !== "string" ||
      newPassword.length < 12 ||
      newPassword.length > 1024 ||
      currentPassword === newPassword
    ) {
      res
        .status(400)
        .json({ error: "Choose a different password of 12–1024 characters." });
      return;
    }
    if (!(await verifyPassword(currentPassword, req.user!.passwordHash))) {
      res.status(403).json({ error: "Current password is incorrect." });
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2 AND password_hash=$3 RETURNING id",
        [passwordHash, req.user!.id, req.user!.passwordHash],
      );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        res
          .status(409)
          .json({ error: "Your password changed. Sign in again." });
        return;
      }
      await client.query("DELETE FROM orbit_sessions WHERE user_id=$1", [
        req.user!.id,
      ]);
      await client.query("COMMIT");
      res.clearCookie(cookieName, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      });
      res.json({
        success: true,
        message: "Password changed. Sign in with your new password.",
      });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Could not change password." });
    } finally {
      client.release();
    }
  },
);

router.post("/auth/logout", async (req, res) => {
  const token = sessionToken(req);
  if (token)
    await pool.query("DELETE FROM orbit_sessions WHERE token_hash=$1", [
      digest(token),
    ]);
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  res.json({ success: true, message: "Logged out" });
});

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!(await rateLimit(`reset:${req.ip}`, 3, 3600))) {
      res.status(429).json({ error: "Please try later." });
      return;
    }
    if (typeof email !== "string" || email.length > 254 || !email) {
      res.status(400).json({ error: "Bad Request", message: "Email required" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()))
      .limit(1);

    if (user) {
      const [itDept] = await db
        .select()
        .from(departmentsTable)
        .where(ilike(departmentsTable.name, "IT%"))
        .limit(1);
      const ticketNumber = `DJ-${Math.floor(Math.random() * 900000) + 100000}`;
      const slaDeadline = itDept
        ? new Date(Date.now() + itDept.slaResolutionHours * 3600 * 1000)
        : null;

      const [ticket] = await db
        .insert(ticketsTable)
        .values({
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
        } as any)
        .returning();

      if (ticket) {
        await db
          .insert(ticketHistoryTable)
          .values({
            ticketId: ticket.id,
            action: "created",
            newValue: "open",
            changedById: user.id,
          });
      }
    }

    res.json({
      message:
        "If an account with this email exists, a password reset ticket has been raised. IT will contact you shortly.",
    });
  } catch (err) {
    console.error("Forgot password error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get(
  "/auth/me",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      let departmentName: string | null = null;
      if (user.departmentId) {
        const [dept] = await db
          .select()
          .from(departmentsTable)
          .where(eq(departmentsTable.id, user.departmentId))
          .limit(1);
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
        mustChangePassword: user.mustChangePassword,
        managerId: user.managerId,
        teamName: user.teamName,
        createdAt: user.createdAt.toISOString(),
      });
    } catch (err) {
      console.error("Get me error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.put(
  "/auth/profile",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
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
          res
            .status(400)
            .json({ error: "Invalid avatar format. Must be a data URL." });
          return;
        }
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }

      const [updated] = await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.id, userId))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      let departmentName: string | null = null;
      if (updated.departmentId) {
        const [dept] = await db
          .select()
          .from(departmentsTable)
          .where(eq(departmentsTable.id, updated.departmentId))
          .limit(1);
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
        mustChangePassword: updated.mustChangePassword,
        managerId: updated.managerId,
        teamName: updated.teamName,
        createdAt: updated.createdAt.toISOString(),
      });
    } catch (err) {
      console.error("Update profile error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

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
