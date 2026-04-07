import { Router } from "express";
import { db, departmentsTable, usersTable, ticketsTable, eq, sql, and } from "@workspace/db";
import { authMiddleware } from "../middlewares/auth.js";

const router = Router();

router.get("/departments", authMiddleware, async (req, res) => {
  try {
    const departments = await db.select().from(departmentsTable).orderBy(departmentsTable.name);

    const result = await Promise.all(
      departments.map(async (dept) => {
        const [agentRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(usersTable)
          .where(and(eq(usersTable.departmentId, dept.id), eq(usersTable.isActive, true)));

        const [ticketRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(ticketsTable)
          .where(
            and(
              eq(ticketsTable.departmentId, dept.id),
              sql`${ticketsTable.status} NOT IN ('resolved', 'closed')`
            )
          );

        return {
          id: dept.id,
          name: dept.name,
          description: dept.description,
          color: dept.color,
          icon: dept.icon,
          slaResponseHours: dept.slaResponseHours,
          slaResolutionHours: dept.slaResolutionHours,
          agentCount: agentRow?.count ?? 0,
          openTicketCount: ticketRow?.count ?? 0,
          createdAt: dept.createdAt.toISOString(),
        };
      })
    );

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List departments error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/departments", authMiddleware, async (req, res) => {
  try {
    const { name, description, color, icon, slaResponseHours = 4, slaResolutionHours = 24 } = req.body;

    if (!name) {
      res.status(400).json({ error: "Bad Request", message: "Name required" });
      return;
    }

    const [dept] = await db
      .insert(departmentsTable)
      .values({ name, description, color, icon, slaResponseHours, slaResolutionHours })
      .returning();

    res.status(201).json({
      ...dept,
      agentCount: 0,
      openTicketCount: 0,
      createdAt: dept.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Create department error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/departments/:departmentId", authMiddleware, async (req, res) => {
  try {
    const deptId = parseInt(req.params.departmentId, 10);
    const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, deptId)).limit(1);

    if (!dept) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    const [agentRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(and(eq(usersTable.departmentId, dept.id), eq(usersTable.isActive, true)));

    const [ticketRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.departmentId, dept.id),
          sql`${ticketsTable.status} NOT IN ('resolved', 'closed')`
        )
      );

    res.json({
      ...dept,
      agentCount: agentRow?.count ?? 0,
      openTicketCount: ticketRow?.count ?? 0,
      createdAt: dept.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Get department error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/departments/bulk", authMiddleware, async (req, res) => {
  try {
    const { rows } = req.body as { rows: Array<Record<string, string>> };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Bad Request", message: "rows array required" });
      return;
    }

    const created: number[] = [];
    const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row.name?.trim();
      if (!name) { errors.push({ row: i + 1, error: "name is required" }); continue; }

      const slaResponseHours = parseInt(row.sla_response_hours ?? "4", 10) || 4;
      const slaResolutionHours = parseInt(row.sla_resolution_hours ?? "24", 10) || 24;
      const color = row.color?.trim() || "#3B82F6";

      try {
        const [dept] = await db.insert(departmentsTable).values({
          name, description: row.description?.trim() ?? null, color,
          slaResponseHours, slaResolutionHours,
        }).returning();
        created.push(dept.id);
      } catch (e) {
        errors.push({ row: i + 1, error: "Insert failed" });
      }
    }

    res.status(201).json({ created: created.length, errors });
  } catch (err) {
    req.log.error({ err }, "Bulk create departments error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
