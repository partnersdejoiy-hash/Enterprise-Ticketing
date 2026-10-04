import { db, rolePermissionsTable, usersTable, eq } from "@workspace/db";
type Action =
  | "canAssignTickets"
  | "canCloseTicket"
  | "canDeleteTickets"
  | "canBulkUpload";
export async function allowed(
  user: typeof usersTable.$inferSelect,
  action: Action,
) {
  if (user.role === "super_admin") return true;
  const [row] = await db
    .select()
    .from(rolePermissionsTable)
    .where(eq(rolePermissionsTable.role, user.role))
    .limit(1);
  if (row) return row[action];
  const defaults: Record<Action, string[]> = {
    canAssignTickets: ["admin", "manager"],
    canCloseTicket: ["admin", "manager", "agent"],
    canDeleteTickets: [],
    canBulkUpload: ["admin", "manager"],
  };
  return defaults[action].includes(user.role);
}
