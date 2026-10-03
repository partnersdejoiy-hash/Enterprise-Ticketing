/**
 * Automation Copilot (#24) — Natural language → automation rule draft.
 *
 * Admin describes: "When an urgent Finance ticket is created, assign it to
 * Finance Support, notify the manager and start the 2-hour SLA."
 *
 * AI generates trigger/conditions/actions → visual preview JSON →
 * admin reviews → creates rule as DRAFT (is_active=false).
 *
 * NEVER silently creates active rules. Generated rules are always drafts
 * until an admin explicitly enables them.
 */

import { pool } from "@workspace/db";
import { runAnalysis } from "./orbit-ai.js";
import { validateRule, triggers } from "./automation.js";

export interface GeneratedCondition {
  field: string;
  operator: string;
  value: string;
}

export interface GeneratedAction {
  type: string;
  value: string;
}

export interface GeneratedAutomation {
  name: string;
  description: string;
  triggerType: string;
  conditionLogic: "AND" | "OR";
  priority: number;
  conditions: GeneratedCondition[];
  actions: GeneratedAction[];
  /** Copilot-only metadata (not stored on the rule). */
  notifications: string[];
  slaNote: string | null;
}

const COPILOT_SYSTEM_PROMPT = `
You generate OrbitDesk automation rules from natural-language descriptions.
Output ONLY valid JSON matching this schema:
{
  "name": "short rule name, max 120 chars",
  "description": "one sentence, max 200 chars",
  "triggerType": "one of: email_received | ticket_created | ticket_updated",
  "conditionLogic": "AND or OR",
  "priority": 100,
  "conditions": [
    {"field": "one of: from_email|to_email|subject|body|tag|department|priority|status|assignee|sla_breached",
     "operator": "one of: contains|not_contains|equals|not_equals|starts_with|ends_with",
     "value": "match value, max 300 chars"}
  ],
  "actions": [
    {"type": "one of: set_priority|add_tag|remove_tag|assign_department_agent",
     "value": "for set_priority: low|medium|high|urgent; for add_tag/remove_tag: lowercase-hyphen tag; for assign_department_agent: least_loaded"}
  ],
  "notifications": ["human-readable notification suggestions, e.g. 'notify the manager'"],
  "slaNote": "any SLA intent from the description, or null",
  "confidence": 0-100,
  "sources": []
}
Rules:
- Map departments to the "department" field with operator "equals".
- Map urgency words to "priority" field (urgent|high|medium|low).
- 1-12 conditions, 1-8 actions. Do not invent fields or actions outside the lists.
- If the description asks for SLA timing, put it in slaNote (SLA is configured separately, not as an automation action).
- If the description asks for notifications, put them in notifications (notifications are not automation actions).
- Never execute anything. You only propose.
`.trim();

async function getUser(
  actorId: number,
): Promise<{ id: number; role: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, role FROM users WHERE id = $1 LIMIT 1`,
    [actorId],
  );
  return rows[0] ?? null;
}

/**
 * Generate an automation rule draft from natural language.
 * Does NOT persist anything — returns a preview for admin review.
 */
export async function generateAutomation(
  nlDescription: string,
  actorId: number,
): Promise<GeneratedAutomation> {
  const user = await getUser(actorId);
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    throw new Error("Admin access required for Automation Copilot");
  }

  const analysis = await runAnalysis({
    feature: "automation_builder",
    entityType: "automation_draft",
    entityId: `draft-${Date.now()}`,
    actorId,
    canAccess: async () => {
      const u = await getUser(actorId);
      return !!u && ["super_admin", "admin"].includes(u.role);
    },
    systemPrompt: COPILOT_SYSTEM_PROMPT,
    untrustedInputs: [{ label: "automation_description", text: nlDescription }],
    maxTokens: 1500,
  });

  const r = analysis.result as Record<string, unknown>;
  const generated: GeneratedAutomation = {
    name: String(r.name ?? "Untitled rule").slice(0, 120),
    description: String(r.description ?? "").slice(0, 1000),
    triggerType: triggers.includes(String(r.triggerType))
      ? String(r.triggerType)
      : "ticket_created",
    conditionLogic: r.conditionLogic === "OR" ? "OR" : "AND",
    priority: Number.isInteger(r.priority) ? Number(r.priority) : 100,
    conditions: Array.isArray(r.conditions)
      ? (r.conditions as GeneratedCondition[]).slice(0, 12)
      : [],
    actions: Array.isArray(r.actions)
      ? (r.actions as GeneratedAction[]).slice(0, 8)
      : [],
    notifications: Array.isArray(r.notifications)
      ? (r.notifications as string[]).slice(0, 8)
      : [],
    slaNote: typeof r.slaNote === "string" ? r.slaNote : null,
  };

  // Validate against the real rule schema; surface problems in preview.
  const validationError = validateRule({
    ...generated,
    isActive: false,
  });
  if (validationError) {
    throw new Error(`Generated rule failed validation: ${validationError}`);
  }

  return generated;
}

/**
 * Persist a generated rule as a DRAFT (is_active=false). The admin must
 * explicitly enable it from the Automation Rules UI.
 */
export async function createAutomationDraft(
  generated: GeneratedAutomation,
  actorId: number,
): Promise<{ id: number; name: string }> {
  const user = await getUser(actorId);
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    throw new Error("Admin access required to create automation rules");
  }

  const validationError = validateRule({ ...generated, isActive: false });
  if (validationError) {
    throw new Error(`Invalid rule: ${validationError}`);
  }

  const { rows } = await pool.query(
    `INSERT INTO automation_rules
       (name, description, is_active, trigger_type, conditions, actions,
        condition_logic, priority, created_by_id)
     VALUES ($1,$2,false,$3,$4::jsonb,$5::jsonb,$6,$7,$8)
     RETURNING id, name`,
    [
      generated.name,
      generated.description || null,
      generated.triggerType,
      JSON.stringify(generated.conditions),
      JSON.stringify(generated.actions),
      generated.conditionLogic,
      Math.max(0, Math.min(1000, generated.priority)),
      actorId,
    ],
  );

  const ruleId = rows[0].id as number;

  await pool.query(
    `INSERT INTO ai_audit_logs (actor_id, actor_type, action, entity_type, entity_id, detail)
     VALUES ($1, 'human', 'automation_copilot.create_draft', 'automation_rule', $2, $3::jsonb)`,
    [actorId, String(ruleId), JSON.stringify({ name: generated.name, is_active: false })],
  );

  return { id: ruleId, name: rows[0].name as string };
}
