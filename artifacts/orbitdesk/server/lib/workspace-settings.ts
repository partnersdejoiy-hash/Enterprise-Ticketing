import { db, systemSettingsTable, departmentsTable, eq } from "@workspace/db";
export const preferenceDefaults = {
  assigned: true,
  updates: true,
  comments: true,
  sla: false,
  digest: false,
};
export async function readJsonSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key));
  if (!row) return fallback;
  try {
    return { ...fallback, ...JSON.parse(row.value) };
  } catch {
    return fallback;
  }
}
export async function writeJsonSetting(key: string, value: unknown) {
  await db
    .insert(systemSettingsTable)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({
      target: systemSettingsTable.key,
      set: { value: JSON.stringify(value), updatedAt: new Date() },
    });
}
export type RoutingSettings = {
  autoAssign: boolean;
  automationEnabled: boolean;
  bgvDepartmentId: number | null;
  employmentDepartmentId: number | null;
};
export async function getRoutingSettings(): Promise<RoutingSettings> {
  const departments = await db.select().from(departmentsTable);
  const find = (names: string[]) => {
    const rows = departments.filter((d) =>
      names.includes(d.name.trim().toLowerCase()),
    );
    return rows.length === 1 ? rows[0].id : null;
  };
  return readJsonSetting("routing_v1", {
    autoAssign: true,
    automationEnabled: true,
    bgvDepartmentId:
      Number(process.env.BGV_DEPARTMENT_ID) ||
      find(["bgv", "background verification", "background verification (bgv)"]),
    employmentDepartmentId:
      Number(process.env.EMPLOYMENT_VERIFICATION_DEPARTMENT_ID) ||
      find(["employment verification", "employment-verification"]),
  });
}
