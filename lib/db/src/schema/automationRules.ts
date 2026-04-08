import { pgTable, serial, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export type AutomationCondition = {
  field: "from_email" | "subject" | "body" | "to_email" | "tag" | "department" | "priority";
  operator: "contains" | "not_contains" | "equals" | "not_equals" | "starts_with" | "ends_with" | "matches_regex";
  value: string;
};

export type AutomationAction = {
  type: "set_department" | "set_priority" | "set_status" | "assign_agent" | "add_tag" | "send_notification" | "set_raised_for";
  value: string;
};

export const automationRulesTable = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  triggerType: text("trigger_type").notNull().default("email_received"),
  conditions: jsonb("conditions").$type<AutomationCondition[]>().notNull().default([]),
  actions: jsonb("actions").$type<AutomationAction[]>().notNull().default([]),
  conditionLogic: text("condition_logic").notNull().default("AND"),
  priority: integer("priority").notNull().default(0),
  createdById: integer("created_by_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AutomationRule = typeof automationRulesTable.$inferSelect;
export type InsertAutomationRule = typeof automationRulesTable.$inferInsert;
