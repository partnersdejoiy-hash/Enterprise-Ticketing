import { Router } from "express";
import {
  authMiddleware,
  requireAdmin,
  type AuthenticatedRequest,
} from "../middlewares/auth.js";
import { db, usersTable, departmentsTable, eq } from "@workspace/db";
import {
  readJsonSetting,
  writeJsonSetting,
  preferenceDefaults,
  getRoutingSettings,
} from "../lib/workspace-settings.js";
const router = Router();
router.use("/settings/workspace", authMiddleware);
router.get("/settings/workspace/me", async (req: AuthenticatedRequest, res) => {
  res.json({
    name: req.user!.name,
    email: req.user!.email,
    notifications: await readJsonSetting(
      `preferences:${req.user!.id}`,
      preferenceDefaults,
    ),
  });
});
router.put("/settings/workspace/me", async (req: AuthenticatedRequest, res) => {
  const { name, notifications } = req.body;
  if (
    (name !== undefined &&
      (typeof name !== "string" || !name.trim() || name.length > 150)) ||
    (notifications !== undefined &&
      (!notifications ||
        Object.keys(preferenceDefaults).some(
          (k) => typeof notifications[k] !== "boolean",
        ) ||
        notifications.digest === true)) ||
    (name === undefined && notifications === undefined)
  ) {
    res
      .status(400)
      .json({
        error:
          "Provide valid profile or notification settings. Scheduled digests are not enabled.",
      });
    return;
  }
  if (name !== undefined)
    await db
      .update(usersTable)
      .set({ name: name.trim() })
      .where(eq(usersTable.id, req.user!.id));
  if (notifications !== undefined)
    await writeJsonSetting(
      `preferences:${req.user!.id}`,
      Object.fromEntries(
        Object.keys(preferenceDefaults).map((k) => [k, notifications[k]]),
      ),
    );
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.id));
  res.json({
    name: user.name,
    email: user.email,
    notifications: await readJsonSetting(
      `preferences:${req.user!.id}`,
      preferenceDefaults,
    ),
  });
});
router.get("/settings/workspace/routing", requireAdmin, async (_req, res) =>
  res.json(await getRoutingSettings()),
);
router.put(
  "/settings/workspace/routing",
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const b = req.body;
    if (
      typeof b.autoAssign !== "boolean" ||
      typeof b.automationEnabled !== "boolean"
    ) {
      res.status(400).json({ error: "Invalid routing settings" });
      return;
    }
    for (const k of ["bgvDepartmentId", "employmentDepartmentId"]) {
      if (
        b[k] !== null &&
        (!Number.isSafeInteger(b[k]) ||
          b[k] < 1 ||
          !(
            await db
              .select()
              .from(departmentsTable)
              .where(eq(departmentsTable.id, b[k]))
          ).length)
      ) {
        res.status(400).json({ error: "Select an existing department" });
        return;
      }
    }
    const data = {
      autoAssign: b.autoAssign,
      automationEnabled: b.automationEnabled,
      bgvDepartmentId: b.bgvDepartmentId,
      employmentDepartmentId: b.employmentDepartmentId,
    };
    await writeJsonSetting("routing_v1", data);
    await writeJsonSetting("routing_last_editor", {
      userId: req.user!.id,
      at: new Date().toISOString(),
    });
    res.json(data);
  },
);
export default router;
