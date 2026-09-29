import { notifyTicket } from "./ticket-notifications.js";
import { getRoutingSettings } from "./workspace-settings.js";
import { ensureAutomationPresets } from "./automation-presets.js";
import {
  db,
  ticketsTable,
  departmentsTable,
  usersTable,
  automationRulesTable,
  ticketHistoryTable,
  eq,
  and,
  sql,
} from "@workspace/db";

type Ticket = typeof ticketsTable.$inferSelect;
type Rule = typeof automationRulesTable.$inferSelect;
export const triggers = ["email_received", "ticket_created", "ticket_updated"];
const fields = [
  "from_email",
  "to_email",
  "subject",
  "body",
  "tag",
  "department",
  "priority",
  "status",
  "assignee",
  "sla_breached",
];
const operators = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "starts_with",
  "ends_with",
];
const actions = [
  "set_priority",
  "add_tag",
  "remove_tag",
  "assign_department_agent",
];
const priorities = ["low", "medium", "high", "urgent"];
const reservedTags = new Set([
  "business-website",
  "bgv-request",
  "background-verification",
  "employment-verification",
  "authorisation-review-required",
  "web-request",
  "email-generated",
  "document-request",
]);

// Only classification and assignment within an existing handling department are supported.
// No rule can grant access by moving a ticket or changing its employee links.
export function validateRule(input: any): string | null {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 120
  )
    return "Use a rule name of 1–120 characters";
  if (
    input.description != null &&
    (typeof input.description !== "string" || input.description.length > 1000)
  )
    return "Description is too long";
  if (!triggers.includes(input.triggerType)) return "Unsupported trigger";
  if (!["AND", "OR"].includes(input.conditionLogic)) return "Choose AND or OR";
  if (
    !Number.isInteger(input.priority) ||
    input.priority < 0 ||
    input.priority > 1000
  )
    return "Rule order must be between 0 and 1000";
  if (typeof input.isActive !== "boolean") return "Choose an active state";
  if (
    !Array.isArray(input.conditions) ||
    input.conditions.length < 1 ||
    input.conditions.length > 12
  )
    return "Add 1–12 conditions";
  for (const c of input.conditions) {
    if (
      !c ||
      !fields.includes(c.field) ||
      !operators.includes(c.operator) ||
      typeof c.value !== "string" ||
      !c.value.trim() ||
      c.value.length > 300
    )
      return "Invalid condition. Regex conditions are not supported";
  }
  if (
    !Array.isArray(input.actions) ||
    input.actions.length < 1 ||
    input.actions.length > 8
  )
    return "Add 1–8 actions";
  for (const a of input.actions) {
    if (
      !a ||
      !actions.includes(a.type) ||
      typeof a.value !== "string" ||
      !a.value.trim()
    )
      return "Unsupported action. Use priority, queue tags or department workload assignment";
    if (a.type === "set_priority" && !priorities.includes(a.value))
      return "Invalid ticket priority";
    if (a.type === "assign_department_agent" && a.value !== "least_loaded")
      return "Use least_loaded for department assignment";
    if (
      ["add_tag", "remove_tag"].includes(a.type) &&
      (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(a.value) || reservedTags.has(a.value))
    )
      return "Use a custom lowercase queue tag. Source and authorisation tags are protected";
  }
  return null;
}

function compare(actual: string, operator: string, wanted: string) {
  const a = actual.toLowerCase(),
    b = wanted.trim().toLowerCase();
  switch (operator) {
    case "equals":
      return a === b;
    case "not_equals":
      return a !== b;
    case "contains":
      return a.includes(b);
    case "not_contains":
      return !a.includes(b);
    case "starts_with":
      return a.startsWith(b);
    case "ends_with":
      return a.endsWith(b);
    default:
      return false;
  }
}
export function ruleMatches(
  rule: Rule,
  context: Record<string, string | string[]>,
) {
  const matches = rule.conditions.map((c) => {
    const values = context[c.field];
    // Missing email context must never satisfy a negative email condition.
    if (values === undefined) return false;
    if (Array.isArray(values))
      return ["not_equals", "not_contains"].includes(c.operator)
        ? values.every((v) => compare(v, c.operator, c.value))
        : values.some((v) => compare(v, c.operator, c.value));
    return compare(values, c.operator, c.value);
  });
  return rule.conditionLogic === "OR"
    ? matches.some(Boolean)
    : matches.every(Boolean);
}

export async function runAutomations(
  ticketId: number,
  events: string[],
  email: { from?: string; to?: string } = {},
): Promise<Ticket | undefined> {
  try {
    const settings = await getRoutingSettings();
    if (!settings.automationEnabled && !settings.autoAssign) return undefined;
    await ensureAutomationPresets();
    let assignmentChanged = false,
      slaAdded = false;
    const result = await db.transaction(async (tx) => {
      const [original] = await tx
        .select()
        .from(ticketsTable)
        .where(eq(ticketsTable.id, ticketId))
        .for("update");
      if (!original || ["resolved", "closed"].includes(original.status))
        return original;
      const [department] = original.departmentId
        ? await tx
            .select()
            .from(departmentsTable)
            .where(eq(departmentsTable.id, original.departmentId))
        : [];
      const candidates = await tx
        .select({ rule: automationRulesTable, owner: usersTable })
        .from(automationRulesTable)
        .innerJoin(
          usersTable,
          eq(automationRulesTable.createdById, usersTable.id),
        )
        .where(
          and(
            eq(automationRulesTable.isActive, true),
            eq(usersTable.isActive, true),
          ),
        )
        .orderBy(automationRulesTable.priority, automationRulesTable.id)
        .limit(500);
      const context: Record<string, string | string[]> = {
        subject: original.subject,
        body: original.description,
        tag: original.tags,
        department: department?.name ?? "unassigned",
        priority: original.priority,
        status: original.status,
        assignee: original.assigneeId ? "assigned" : "unassigned",
        sla_breached: String(
          original.slaBreached ||
            !!(
              original.slaDeadline &&
              original.slaDeadline.getTime() < Date.now()
            ),
        ),
      };
      if (email.from) context.from_email = email.from;
      if (email.to) context.to_email = email.to;
      let current = { ...original, tags: [...original.tags] };
      let priorityClaimed = false;
      const tagsClaimed = new Set<string>();
      for (const { rule, owner } of candidates) {
        if (
          !["super_admin", "admin"].includes(owner.role) ||
          !events.includes(rule.triggerType) ||
          (!settings.automationEnabled &&
            !rule.name.startsWith("BPO · Department workload assignment")) ||
          validateRule(rule) ||
          !ruleMatches(rule, context)
        )
          continue;
        const changes: Record<string, unknown> = {};
        for (const action of rule.actions) {
          if (action.type === "set_priority" && !priorityClaimed) {
            priorityClaimed = true;
            if (current.priority !== action.value) {
              changes.priority = { from: current.priority, to: action.value };
              current.priority = action.value as Ticket["priority"];
            }
          }
          if (
            ["add_tag", "remove_tag"].includes(action.type) &&
            !tagsClaimed.has(action.value)
          ) {
            tagsClaimed.add(action.value);
            const has = current.tags.includes(action.value);
            if (action.type === "add_tag" && !has && current.tags.length < 40) {
              current.tags.push(action.value);
              changes.add_tag = action.value;
            }
            if (action.type === "remove_tag" && has) {
              current.tags = current.tags.filter((t) => t !== action.value);
              changes.remove_tag = action.value;
            }
          }
          if (
            action.type === "assign_department_agent" &&
            settings.autoAssign &&
            !current.assigneeId &&
            department
          ) {
            // Serialise workload selection per department to avoid concurrent assignment races.
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(842198, ${department.id})`,
            );
            const agent =
              await tx.execute(sql`SELECT u.id FROM users u LEFT JOIN tickets t ON t.assignee_id=u.id AND t.status NOT IN ('resolved','closed')
              WHERE u.department_id=${department.id} AND u.is_active AND u.role IN ('agent','manager')
              GROUP BY u.id ORDER BY count(t.id),u.id LIMIT 1`);
            if (agent.rows[0]) {
              current.assigneeId = Number(agent.rows[0].id);
              if (current.status === "open") current.status = "assigned";
              changes.assigneeId = current.assigneeId;
            }
          }
        }
        if (Object.keys(changes).length) {
          await tx
            .insert(ticketHistoryTable)
            .values({
              ticketId,
              action: "automation_applied",
              changedById: rule.createdById,
              newValue: JSON.stringify({
                ruleId: rule.id,
                ruleName: rule.name,
                changes,
              }),
            });
        }
      }
      if (
        current.priority === original.priority &&
        current.assigneeId === original.assigneeId &&
        JSON.stringify(current.tags) === JSON.stringify(original.tags)
      )
        return original;
      assignmentChanged = current.assigneeId !== original.assigneeId;
      slaAdded =
        !original.tags.includes("sla-review") &&
        current.tags.includes("sla-review");
      const [updated] = await tx
        .update(ticketsTable)
        .set({
          priority: current.priority,
          tags: current.tags,
          assigneeId: current.assigneeId,
          status: current.status,
          updatedAt: new Date(),
        })
        .where(eq(ticketsTable.id, ticketId))
        .returning();
      return updated;
    });
    if (assignmentChanged) await notifyTicket(ticketId, "assigned");
    if (slaAdded) await notifyTicket(ticketId, "sla");
    return result;
  } catch {
    // The originating ticket remains saved. Do not turn a post-save failure into a duplicate-producing retry.
    console.error("[automation] Execution failed", { ticketId });
    return undefined;
  }
}
