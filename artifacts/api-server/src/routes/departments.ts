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

export default router;
