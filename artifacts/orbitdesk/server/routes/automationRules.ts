import { validateRule, runAutomations } from "../lib/automation.js";
import { ensureAutomationPresets } from "../lib/automation-presets.js";
import { Router } from "express";
import {
  authMiddleware,
  AuthenticatedRequest,
  requireAdmin,
} from "../middlewares/auth.js";
import { db, automationRulesTable, ticketsTable, eq, sql } from "@workspace/db";

const router = Router();
router.use("/automation-rules", authMiddleware, requireAdmin);

router.post("/automation-rules/run-unassigned", async (_req, res) => {
  const tickets = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(
      sql`${ticketsTable.assigneeId} IS NULL AND ${ticketsTable.departmentId} IS NOT NULL AND ${ticketsTable.status} NOT IN ('resolved','closed') AND EXISTS(SELECT 1 FROM users u WHERE u.department_id=${ticketsTable.departmentId} AND u.is_active AND u.role IN ('agent','manager'))`,
    )
    .orderBy(ticketsTable.createdAt)
    .limit(100);
  let assigned = 0, checked = 0;
  const deadline=Date.now()+5000;
  for (const ticket of tickets) {
    if(Date.now()>deadline)break;
    checked++;
    const result = await runAutomations(ticket.id, ["ticket_updated"]);
    if (result?.assigneeId) assigned++;
  }
  res.json({ checked, assigned, limit: 100 });
});

router.get(
  "/automation-rules",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      await ensureAutomationPresets();
      const rules = await db
        .select()
        .from(automationRulesTable)
        .orderBy(automationRulesTable.priority, automationRulesTable.id);
      res.json(rules);
    } catch (err) {
      console.error("List automation rules error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.post(
  "/automation-rules",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const role = req.user!.role;
    if (role !== "super_admin" && role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      const {
        name,
        description,
        isActive,
        triggerType,
        conditions,
        actions,
        conditionLogic,
        priority,
      } = req.body;
      const validation = validateRule(req.body);
      if (validation) {
        res.status(400).json({ error: validation });
        return;
      }
      const [rule] = await db
        .insert(automationRulesTable)
        .values({
          name: name.trim(),
          description: description?.trim() || null,
          isActive: isActive !== false,
          triggerType: triggerType || "email_received",
          conditions: Array.isArray(conditions) ? conditions : [],
          actions: Array.isArray(actions) ? actions : [],
          conditionLogic: conditionLogic === "OR" ? "OR" : "AND",
          priority: typeof priority === "number" ? priority : 10,
          createdById: req.user!.id,
        })
        .returning();
      res.status(201).json(rule);
    } catch (err) {
      console.error("Create automation rule error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.put(
  "/automation-rules/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const role = req.user!.role;
    if (role !== "super_admin" && role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid rule ID" });
      return;
    }
    try {
      const {
        name,
        description,
        isActive,
        triggerType,
        conditions,
        actions,
        conditionLogic,
        priority,
      } = req.body;
      const validation = validateRule(req.body);
      if (validation) {
        res.status(400).json({ error: validation });
        return;
      }
      const [updated] = await db
        .update(automationRulesTable)
        .set({
          name: name?.trim(),
          description: description?.trim() || null,
          isActive: isActive !== false,
          triggerType: triggerType || "email_received",
          conditions: Array.isArray(conditions) ? conditions : [],
          actions: Array.isArray(actions) ? actions : [],
          conditionLogic: conditionLogic === "OR" ? "OR" : "AND",
          priority: typeof priority === "number" ? priority : 10,
          updatedAt: new Date(),
        })
        .where(eq(automationRulesTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      res.json(updated);
    } catch (err) {
      console.error("Update automation rule error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.patch(
  "/automation-rules/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const role = req.user!.role;
    if (role !== "super_admin" && role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid rule ID" });
      return;
    }
    try {
      const updates: Partial<typeof automationRulesTable.$inferInsert> = {};
      if (typeof req.body.isActive === "boolean")
        updates.isActive = req.body.isActive;
      if (typeof req.body.priority === "number")
        updates.priority = req.body.priority;
      const [existing] = await db
        .select()
        .from(automationRulesTable)
        .where(eq(automationRulesTable.id, id));
      if (!existing) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      const validation = validateRule({ ...existing, ...updates });
      if (validation && updates.isActive !== false) {
        res.status(400).json({ error: validation });
        return;
      }
      updates.updatedAt = new Date();

      const [updated] = await db
        .update(automationRulesTable)
        .set(updates)
        .where(eq(automationRulesTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      res.json(updated);
    } catch (err) {
      console.error("Patch automation rule error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

router.delete(
  "/automation-rules/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const role = req.user!.role;
    if (role !== "super_admin" && role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid rule ID" });
      return;
    }
    try {
      await db
        .delete(automationRulesTable)
        .where(eq(automationRulesTable.id, id));
      res.json({ message: "Rule deleted" });
    } catch (err) {
      console.error("Delete automation rule error", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

export default router;
