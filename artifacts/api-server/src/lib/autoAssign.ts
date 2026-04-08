import { db, usersTable, ticketsTable, and, inArray, sql } from "@workspace/db";

const ASSIGNABLE_ROLES = ["agent", "manager", "employee"] as const;

/**
 * Auto-assign from a pool of multiple departments.
 * Finds the active member (from any of the given departments) with the fewest open tickets.
 */
export async function autoAssignFromDepartments(departmentIds: number[]): Promise<number | null> {
  if (departmentIds.length === 0) return null;

  const agents = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.departmentId, departmentIds),
        inArray(usersTable.isActive, [true] as any),
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
    if (c < minCount) { minCount = c; minAgent = id; }
  }
  return minAgent;
}

/** Convenience wrapper for a single department */
export async function autoAssignForDepartment(departmentId: number): Promise<number | null> {
  return autoAssignFromDepartments([departmentId]);
}
