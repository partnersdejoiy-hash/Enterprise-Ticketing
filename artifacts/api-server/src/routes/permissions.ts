import { Router } from "express";
import { db, rolePermissionsTable, eq } from "@workspace/db";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

type Role = "super_admin" | "admin" | "manager" | "agent" | "employee" | "external";

const DEFAULTS: Record<Role, Partial<typeof rolePermissionsTable.$inferInsert>> = {
  super_admin: {
    canCreateTicket: true, canViewAllTickets: true, canCloseTicket: true,
    canAssignTickets: true, canDeleteTickets: true, canBulkUpload: true,
    canExportData: true, canViewReports: true, canManageDepartments: true,
    canManageUsers: true, canRequestDocuments: true,
  },
  admin: {
    canCreateTicket: true, canViewAllTickets: true, canCloseTicket: true,
    canAssignTickets: true, canDeleteTickets: false, canBulkUpload: true,
    canExportData: true, canViewReports: true, canManageDepartments: true,
    canManageUsers: true, canRequestDocuments: true,
  },
  manager: {
    canCreateTicket: true, canViewAllTickets: true, canCloseTicket: true,
    canAssignTickets: true, canDeleteTickets: false, canBulkUpload: true,
    canExportData: true, canViewReports: true, canManageDepartments: false,
    canManageUsers: false, canRequestDocuments: true,
  },
  agent: {
    canCreateTicket: true, canViewAllTickets: true, canCloseTicket: true,
    canAssignTickets: false, canDeleteTickets: false, canBulkUpload: false,
    canExportData: false, canViewReports: false, canManageDepartments: false,
    canManageUsers: false, canRequestDocuments: true,
  },
  employee: {
    canCreateTicket: true, canViewAllTickets: false, canCloseTicket: false,
    canAssignTickets: false, canDeleteTickets: false, canBulkUpload: false,
    canExportData: false, canViewReports: false, canManageDepartments: false,
    canManageUsers: false, canRequestDocuments: true,
  },
  external: {
    canCreateTicket: true, canViewAllTickets: false, canCloseTicket: false,
    canAssignTickets: false, canDeleteTickets: false, canBulkUpload: false,
    canExportData: false, canViewReports: false, canManageDepartments: false,
    canManageUsers: false, canRequestDocuments: false,
  },
};

const MANAGEABLE_BY: Record<string, Role[]> = {
  super_admin: ["admin", "manager", "agent", "employee", "external"],
  admin: ["manager", "agent", "employee", "external"],
};

async function ensurePermissionsExist(): Promise<void> {
  const roles: Role[] = ["super_admin", "admin", "manager", "agent", "employee", "external"];
  const existing = await db.select({ role: rolePermissionsTable.role }).from(rolePermissionsTable);
  const existingRoles = new Set(existing.map((r) => r.role));
  const toInsert = roles.filter((r) => !existingRoles.has(r)).map((r) => ({ role: r, ...DEFAULTS[r] }));
  if (toInsert.length > 0) {
    await db.insert(rolePermissionsTable).values(toInsert);
  }
}

router.get("/role-permissions", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    await ensurePermissionsExist();
    const callerRole = req.user!.role as string;
    const manageableRoles = MANAGEABLE_BY[callerRole] ?? [];
    const allowedRoles = callerRole === "super_admin" ? ["super_admin", ...manageableRoles] : manageableRoles;
    if (allowedRoles.length === 0) { res.json([]); return; }
    const rows = await db.select().from(rolePermissionsTable);
    res.json(rows.filter((r) => allowedRoles.includes(r.role as Role)));
  } catch (err) {
    logger.error({ err }, "role-permissions GET error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/role-permissions/my", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    await ensurePermissionsExist();
    const callerRole = req.user!.role as Role;
    const [row] = await db.select().from(rolePermissionsTable).where(eq(rolePermissionsTable.role, callerRole));
    res.json(row ?? { role: callerRole, ...DEFAULTS[callerRole] });
  } catch (err) {
    logger.error({ err }, "role-permissions/my GET error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/role-permissions/:role", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const targetRole = req.params.role as Role;
    const callerRole = req.user!.role as string;
    const manageable = MANAGEABLE_BY[callerRole] ?? [];
    if (!manageable.includes(targetRole)) {
      res.status(403).json({ error: "Forbidden", message: "You cannot modify permissions for this role" });
      return;
    }
    const allowed = [
      "canCreateTicket", "canViewAllTickets", "canCloseTicket", "canAssignTickets",
      "canDeleteTickets", "canBulkUpload", "canExportData", "canViewReports",
      "canManageDepartments", "canManageUsers", "canRequestDocuments",
    ];
    const updates: Record<string, boolean> = {};
    for (const key of allowed) {
      if (typeof req.body[key] === "boolean") updates[key] = req.body[key];
    }
    await ensurePermissionsExist();
    const [existing] = await db.select({ id: rolePermissionsTable.id }).from(rolePermissionsTable).where(eq(rolePermissionsTable.role, targetRole));
    if (existing) {
      await db.update(rolePermissionsTable).set({ ...updates, updatedById: req.user!.id, updatedAt: new Date() }).where(eq(rolePermissionsTable.role, targetRole));
    } else {
      await db.insert(rolePermissionsTable).values({ role: targetRole, ...DEFAULTS[targetRole], ...updates, updatedById: req.user!.id });
    }
    const [updated] = await db.select().from(rolePermissionsTable).where(eq(rolePermissionsTable.role, targetRole));
    logger.info({ targetRole, callerRole: req.user!.role, updates }, "Role permissions updated");
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "role-permissions PUT error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
