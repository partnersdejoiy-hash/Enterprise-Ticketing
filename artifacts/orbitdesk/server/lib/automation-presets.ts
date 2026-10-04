import type { InsertAutomationRule } from "@workspace/db";
type Preset = Omit<InsertAutomationRule, "createdById">;
const rule = (
  name: string,
  description: string,
  triggerType: string,
  priority: number,
  conditions: any[],
  actions: any[],
  conditionLogic = "AND",
): Preset => ({
  name: `BPO · ${name}`,
  description,
  triggerType,
  priority,
  conditions,
  actions,
  conditionLogic,
  isActive: true,
});
const c = (field: string, value: string, operator = "equals") => ({
  field,
  operator,
  value,
});
const a = (type: string, value: string) => ({ type, value });
export const automationPresets: Preset[] = [
  rule(
    "BGV review queue",
    "Flag background verification requests for staff review. Does not approve documents or change access.",
    "ticket_created",
    10,
    [c("tag", "bgv-request"), c("tag", "background-verification")],
    [a("add_tag", "verification-review")],
    "OR",
  ),
  rule(
    "Employment verification review",
    "Flag employment verification requests for staff review.",
    "ticket_created",
    11,
    [c("tag", "employment-verification")],
    [a("add_tag", "verification-review")],
  ),
  ...["ticket_created", "ticket_updated"].flatMap((event, i) => [
    rule(
      `Department workload assignment${i ? " on update" : ""}`,
      "Assign an unowned ticket to an active agent or manager in its existing department. Leaves it unassigned when no eligible handler exists.",
      event,
      20,
      [
        c("assignee", "unassigned"),
        c("department", "unassigned", "not_equals"),
      ],
      [a("assign_department_agent", "least_loaded")],
    ),
    rule(
      `Urgent review${i ? " on update" : ""}`,
      "Make urgent tickets easy to find using the urgent-review queue tag.",
      event,
      30,
      [c("priority", "urgent")],
      [a("add_tag", "urgent-review")],
    ),
  ]),
  rule(
    "Unrouted intake",
    "Flag tickets with no handling department for admin triage. Keeps their current access unchanged.",
    "ticket_created",
    40,
    [c("department", "unassigned")],
    [a("add_tag", "routing-needed")],
  ),
  rule(
    "Clear routing flag",
    "Remove routing-needed after a handling department is selected.",
    "ticket_updated",
    41,
    [c("department", "unassigned", "not_equals")],
    [a("remove_tag", "routing-needed")],
  ),
  rule(
    "Waiting for information",
    "Label tickets explicitly moved to waiting.",
    "ticket_updated",
    50,
    [c("status", "waiting")],
    [a("add_tag", "awaiting-information")],
  ),
  rule(
    "Clear waiting flag",
    "Remove the waiting label when work resumes. Resolved and closed tickets are not changed.",
    "ticket_updated",
    51,
    [c("status", "waiting", "not_equals")],
    [a("remove_tag", "awaiting-information")],
  ),
  rule(
    "Clear urgent flag",
    "Remove urgent-review if priority is lowered.",
    "ticket_updated",
    52,
    [c("priority", "urgent", "not_equals")],
    [a("remove_tag", "urgent-review")],
  ),
  rule(
    "Overdue ticket escalation",
    "On a ticket update, raise an overdue active ticket to high priority and flag sla-review. Preserves urgent priority. This is event-based, not a scheduled timer.",
    "ticket_updated",
    5,
    [c("sla_breached", "true"), c("priority", "urgent", "not_equals")],
    [a("set_priority", "high"), a("add_tag", "sla-review")],
  ),
];

export async function ensureAutomationPresets() {
  const {
    db,
    automationRulesTable,
    usersTable,
    systemSettingsTable,
    eq,
    and,
    sql,
  } = await import("@workspace/db");
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(928144)`);
    const [marker] = await tx
      .select()
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "automation_pack_v1"));
    if (marker) return;
    const owners = await tx
      .select()
      .from(usersTable)
      .where(
        and(eq(usersTable.isActive, true), eq(usersTable.role, "super_admin")),
      )
      .orderBy(usersTable.id)
      .limit(1);
    if (!owners.length) return;
    const existing = await tx.select().from(automationRulesTable);
    for (const preset of automationPresets)
      if (!existing.some((r) => r.name === preset.name))
        await tx
          .insert(automationRulesTable)
          .values({ ...preset, createdById: owners[0].id });
    await tx
      .insert(systemSettingsTable)
      .values({
        key: "automation_pack_v1",
        value: JSON.stringify({ installedAt: new Date().toISOString() }),
      });
  });
}
