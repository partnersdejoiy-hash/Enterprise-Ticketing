import { db, usersTable, ticketsTable, eq, and, inArray, sql } from "@workspace/db";

const ASSIGNABLE_ROLES = ["agent", "manager", "employee"] as const;

/**
 * Round-robin auto-assignment.
 * Finds the active department member with the fewest open/assigned tickets
 * and returns their user ID, or null if the department has no eligible staff.
 */
export async function autoAssignForDepartment(departmentId: number): Promise<number | null> {
  const agents = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.departmentId, departmentId),
        eq(usersTable.isActive, true),
        inArray(usersTable.role, ASSIGNABLE_ROLES as unknown as string[]),
      ),
    );

  if (agents.length === 0) return null;

  if (agents.length === 1) return agents[0].id;

  const agentIds = agents.map((a) => a.id);

  const openTicketCounts = await db
    .select({
      assigneeId: ticketsTable.assigneeId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(ticketsTable)
    .where(
      and(
        inArray(ticketsTable.assigneeId, agentIds),
        inArray(ticketsTable.status, ["open", "assigned", "in_progress"] as any),
      ),
    )
    .groupBy(ticketsTable.assigneeId);

  const countMap = new Map<number, number>();
  for (const row of openTicketCounts) {
    if (row.assigneeId !== null) countMap.set(row.assigneeId, row.count);
  }

  let minAgent = agentIds[0];
  let minCount = countMap.get(minAgent) ?? 0;

  for (const id of agentIds.slice(1)) {
    const c = countMap.get(id) ?? 0;
    if (c < minCount) {
      minCount = c;
      minAgent = id;
    }
  }

  return minAgent;
}
