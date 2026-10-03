/**
 * Orbit Admin Copilot (#15) — Natural Language Admin.
 *
 * Admin types: "Change Finance first-response SLA from 4 hours to 2 hours."
 * AI parses intent → generates proposed change → shows exact config diff →
 * admin confirms → validates RBAC → applies transactionally → audits.
 *
 * HARD RULES:
 *  - NEVER executes without explicit confirmation token + RBAC check.
 *  - Parse is read-only. Execute requires: valid signed token + admin role.
 *  - Confirmation tokens are HMAC-signed and expire in 10 minutes.
 *  - Every execution lands in ai_audit_logs.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { runAnalysis } from "./orbit-ai.js";

const CONFIRM_SECRET =
  process.env.ADMIN_COPILOT_SECRET || process.env.CRON_SECRET || "dev-admin-copilot";
const TOKEN_TTL_MS = 10 * 60 * 1000;

export type AdminIntent =
  | "change_sla_policy"
  | "list_sla_breaches"
  | "disable_automation"
  | "create_department"
  | "list_high_workload_agents"
  | "tickets_waiting_customer"
  | "who_has_export_access"
  | "unknown";

export interface ProposedChange {
  description: string;
  /** Field-level diff: { field: { before, after } } */
  diff: Record<string, { before: unknown; after: unknown }>;
  /** Serializable payload the execute endpoint applies. */
  payload: Record<string, unknown>;
}

export interface ParseResult {
  intent: AdminIntent;
  entities: Record<string, string>;
  confidence: number;
  isReadOnly: boolean;
  /** Present only when the intent mutates state. */
  proposedChange?: ProposedChange;
  confirmationToken?: string;
  /** For read-only intents: the query result rows. */
  data?: unknown[];
  message: string;
}

/**
 * Sign a confirmation token binding the exact proposed payload.
 */
export function signConfirmation(payload: Record<string, unknown>): string {
  const body = JSON.stringify({
    payload,
    exp: Date.now() + TOKEN_TTL_MS,
  });
  const sig = createHmac("sha256", CONFIRM_SECRET).update(body).digest("hex");
  return Buffer.from(JSON.stringify({ body, sig })).toString("base64url");
}

/**
 * Verify a confirmation token. Returns the payload or null.
 */
export function verifyConfirmation(
  token: string,
): Record<string, unknown> | null {
  try {
    const { body, sig } = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    ) as { body: string; sig: string };
    const expected = createHmac("sha256", CONFIRM_SECRET)
      .update(body)
      .digest("hex");
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    )
      return null;
    const parsed = JSON.parse(body) as {
      payload: Record<string, unknown>;
      exp: number;
    };
    if (Date.now() > parsed.exp) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

async function getUser(
  actorId: number,
): Promise<{ id: number; role: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, role FROM users WHERE id = $1 LIMIT 1`,
    [actorId],
  );
  return rows[0] ?? null;
}

function isAdminRole(role: string): boolean {
  return ["super_admin", "admin"].includes(role);
}

/* ------------------------------------------------------------------ */
/* Intent detection — deterministic layer first, AI as interpreter.    */
/* ------------------------------------------------------------------ */

const INTENT_PATTERNS: { intent: AdminIntent; patterns: RegExp[] }[] = [
  {
    intent: "change_sla_policy",
    patterns: [
      /sla/i,
      /first.?response/i,
      /resolution/i,
      /\b\d+\s*hours?\b/i,
    ],
  },
  {
    intent: "list_sla_breaches",
    patterns: [/sla breach/i, /breaches/i],
  },
  {
    intent: "disable_automation",
    patterns: [/disable.*automation/i, /turn off.*rule/i, /deactivate.*rule/i],
  },
  {
    intent: "create_department",
    patterns: [/create.*department/i, /new department/i, /add department/i],
  },
  {
    intent: "list_high_workload_agents",
    patterns: [/high workload/i, /overloaded/i, /agents with.*workload/i],
  },
  {
    intent: "tickets_waiting_customer",
    patterns: [/waiting for customer/i, /waiting on customer/i],
  },
  {
    intent: "who_has_export_access",
    patterns: [/who has access/i, /export access/i, /export permission/i],
  },
];

function detectIntent(text: string): AdminIntent {
  const t = text.toLowerCase();
  // Order matters: specific before general.
  if (/sla breach/.test(t) || /breaches/.test(t)) return "list_sla_breaches";
  if (/disable|turn off|deactivate/.test(t) && /automation|rule/.test(t))
    return "disable_automation";
  if (/create|new|add/.test(t) && /department/.test(t))
    return "create_department";
  if (/workload|overloaded/.test(t)) return "list_high_workload_agents";
  if (/waiting for customer|waiting on customer/.test(t))
    return "tickets_waiting_customer";
  if (/who has access|export access|export permission/.test(t))
    return "who_has_export_access";
  if (/sla|first.response|resolution/.test(t)) return "change_sla_policy";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* Entity extraction helpers.                                          */
/* ------------------------------------------------------------------ */

async function findDepartment(
  name: string,
): Promise<{ id: number; name: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, name FROM departments WHERE lower(name) LIKE $1 AND deleted_at IS NULL LIMIT 1`,
    [`%${name.toLowerCase()}%`],
  );
  return rows[0] ?? null;
}

function extractHours(text: string): number | null {
  const m = text.match(/(\d+)\s*hours?/i);
  if (m) return parseInt(m[1], 10);
  const mMin = text.match(/(\d+)\s*min/i);
  if (mMin) return parseInt(mMin[1], 10) / 60;
  return null;
}

function extractQuoted(text: string): string | null {
  const m = text.match(/["']([^"']+)["']/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Main entry: parse.                                                  */
/* ------------------------------------------------------------------ */

export async function parseAdminCommand(
  text: string,
  actorId: number,
): Promise<ParseResult> {
  const user = await getUser(actorId);
  if (!user || !isAdminRole(user.role)) {
    throw new Error("Admin access required for Admin Copilot");
  }

  const intent = detectIntent(text);

  // AI interpretation layer — grounded, shield-scanned, audited.
  let aiIntent: AdminIntent = intent;
  let confidence = intent === "unknown" ? 20 : 75;
  try {
    const analysis = await runAnalysis({
      feature: "admin_command",
      entityType: "admin_command",
      entityId: `cmd-${Date.now()}`,
      actorId,
      canAccess: async () => {
        const u = await getUser(actorId);
        return !!u && isAdminRole(u.role);
      },
      systemPrompt: `Parse this admin command into JSON.
Supported intents: change_sla_policy, list_sla_breaches, disable_automation, create_department, list_high_workload_agents, tickets_waiting_customer, who_has_export_access, unknown.
Schema: {"intent": "...", "entities": {"department": "...", "hours": "...", "rule": "..."}, "confidence": 0-100, "sources": []}`.trim(),
      untrustedInputs: [{ label: "admin_command", text }],
      maxTokens: 400,
    });
    const r = analysis.result as { intent?: string; entities?: Record<string, string>; confidence?: number };
    if (r.intent && typeof r.intent === "string") {
      const valid: AdminIntent[] = [
        "change_sla_policy", "list_sla_breaches", "disable_automation",
        "create_department", "list_high_workload_agents",
        "tickets_waiting_customer", "who_has_export_access", "unknown",
      ];
      if ((valid as string[]).includes(r.intent)) aiIntent = r.intent as AdminIntent;
    }
    if (typeof r.confidence === "number") confidence = r.confidence;
  } catch (err) {
    console.error("[admin-copilot] AI parse failed, using local detection:", err);
  }

  const finalIntent = aiIntent !== "unknown" ? aiIntent : intent;
  if (finalIntent === "unknown") {
    return {
      intent: "unknown",
      entities: {},
      confidence,
      isReadOnly: true,
      message:
        "I couldn't understand that command. Try: 'Change Finance first-response SLA to 2 hours', 'Show SLA breaches today', 'Disable automation rule X', or 'Show agents with high workload'.",
    };
  }

  // Read-only intents: execute immediately, no confirmation needed.
  switch (finalIntent) {
    case "list_sla_breaches": {
      const { rows } = await pool.query(
        `SELECT t.ticket_number, t.subject, t.priority, t.sla_deadline,
                d.name AS department
         FROM tickets t
         LEFT JOIN departments d ON d.id = t.department_id
         WHERE t.sla_breached = true
            OR (t.sla_deadline IS NOT NULL AND t.sla_deadline < now()
                AND t.status NOT IN ('resolved','closed'))
         ORDER BY t.sla_deadline ASC NULLS LAST
         LIMIT 100`,
      );
      return {
        intent: finalIntent,
        entities: {},
        confidence,
        isReadOnly: true,
        data: rows,
        message: `Found ${rows.length} breached SLA ticket(s).`,
      };
    }
    case "list_high_workload_agents": {
      const { rows } = await pool.query(
        `SELECT u.id, u.name, u.email, d.name AS department,
                COUNT(t.id) AS open_tickets
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN tickets t ON t.assignee_id = u.id
            AND t.status NOT IN ('resolved','closed')
         WHERE u.role IN ('agent','manager') AND u.is_active
         GROUP BY u.id, u.name, u.email, d.name
         HAVING COUNT(t.id) >= 5
         ORDER BY open_tickets DESC
         LIMIT 50`,
      );
      return {
        intent: finalIntent,
        entities: {},
        confidence,
        isReadOnly: true,
        data: rows,
        message: `Found ${rows.length} agent(s) with 5+ open tickets.`,
      };
    }
    case "tickets_waiting_customer": {
      const { rows } = await pool.query(
        `SELECT t.ticket_number, t.subject, t.status, t.updated_at,
                d.name AS department
         FROM tickets t
         LEFT JOIN departments d ON d.id = t.department_id
         WHERE t.status = 'waiting'
         ORDER BY t.updated_at ASC
         LIMIT 100`,
      );
      return {
        intent: finalIntent,
        entities: {},
        confidence,
        isReadOnly: true,
        data: rows,
        message: `Found ${rows.length} ticket(s) waiting for customer response.`,
      };
    }
    case "who_has_export_access": {
      const { rows } = await pool.query(
        `SELECT u.id, u.name, u.email, u.role, d.name AS department
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE u.role IN ('super_admin','admin')
           AND u.is_active
         ORDER BY u.role, u.name
         LIMIT 100`,
      );
      return {
        intent: finalIntent,
        entities: {},
        confidence,
        isReadOnly: true,
        data: rows,
        message: `${rows.length} user(s) with export-capable roles (super_admin/admin).`,
      };
    }
  }

  // Mutating intents: build proposed change + signed confirmation token.
  switch (finalIntent) {
    case "change_sla_policy": {
      const deptName = extractQuoted(text) ?? inferDepartmentName(text);
      if (!deptName) {
        return {
          intent: finalIntent,
          entities: {},
          confidence,
          isReadOnly: true,
          message: "Which department? Try: 'Change \"Finance\" first-response SLA to 2 hours'.",
        };
      }
      const dept = await findDepartment(deptName);
      if (!dept) {
        return {
          intent: finalIntent,
          entities: { department: deptName },
          confidence,
          isReadOnly: true,
          message: `Department "${deptName}" not found.`,
        };
      }
      const hours = extractHours(text);
      if (hours == null) {
        return {
          intent: finalIntent,
          entities: { department: dept.name },
          confidence,
          isReadOnly: true,
          message: "What should the new SLA be? Include hours, e.g. 'to 2 hours'.",
        };
      }
      const isFirstResponse = /first.?response/i.test(text);
      const field = isFirstResponse ? "first_response_minutes" : "resolution_minutes";
      const { rows } = await pool.query(
        `SELECT id, name, first_response_minutes, resolution_minutes, is_active
         FROM sla_policies
         WHERE department_id = $1 AND is_active = true
         ORDER BY id LIMIT 5`,
        [dept.id],
      );
      if (!rows.length) {
        return {
          intent: finalIntent,
          entities: { department: dept.name },
          confidence,
          isReadOnly: true,
          message: `No active SLA policy found for ${dept.name}.`,
        };
      }
      const policy = rows[0];
      const newMinutes = Math.round(hours * 60);
      const payload = {
        action: "change_sla_policy",
        policyId: policy.id,
        field,
        newMinutes,
      };
      const proposedChange: ProposedChange = {
        description: `Change ${dept.name} ${isFirstResponse ? "first-response" : "resolution"} SLA`,
        diff: {
          department: { before: dept.name, after: dept.name },
          policy: { before: policy.name, after: policy.name },
          [field]: { before: policy[field], after: newMinutes },
        },
        payload,
      };
      return {
        intent: finalIntent,
        entities: { department: dept.name, field, newMinutes: String(newMinutes) },
        confidence,
        isReadOnly: false,
        proposedChange,
        confirmationToken: signConfirmation(payload),
        message: `Proposed: ${dept.name} ${field} ${policy[field]} → ${newMinutes} minutes. Review the diff and confirm.`,
      };
    }
    case "disable_automation": {
      const ruleName = extractQuoted(text) ?? inferRuleName(text);
      if (!ruleName) {
        return {
          intent: finalIntent,
          entities: {},
          confidence,
          isReadOnly: true,
          message: "Which automation rule? Try: 'Disable automation rule \"Urgent Finance\"'.",
        };
      }
      const { rows } = await pool.query(
        `SELECT id, name, is_active FROM automation_rules
         WHERE lower(name) LIKE $1 ORDER BY id LIMIT 5`,
        [`%${ruleName.toLowerCase()}%`],
      );
      if (!rows.length) {
        return {
          intent: finalIntent,
          entities: { rule: ruleName },
          confidence,
          isReadOnly: true,
          message: `No automation rule matching "${ruleName}" found.`,
        };
      }
      const rule = rows[0];
      const payload = { action: "disable_automation", ruleId: rule.id };
      const proposedChange: ProposedChange = {
        description: `Disable automation rule "${rule.name}"`,
        diff: { is_active: { before: rule.is_active, after: false } },
        payload,
      };
      return {
        intent: finalIntent,
        entities: { rule: rule.name },
        confidence,
        isReadOnly: false,
        proposedChange,
        confirmationToken: signConfirmation(payload),
        message: `Proposed: disable rule "${rule.name}". Review and confirm.`,
      };
    }
    case "create_department": {
      const deptName = extractQuoted(text) ?? inferDepartmentName(text);
      if (!deptName) {
        return {
          intent: finalIntent,
          entities: {},
          confidence,
          isReadOnly: true,
          message: "What should the new department be called? Try: 'Create department \"Vendor Management\"'.",
        };
      }
      const existing = await findDepartment(deptName);
      if (existing) {
        return {
          intent: finalIntent,
          entities: { department: deptName },
          confidence,
          isReadOnly: true,
          message: `Department "${existing.name}" already exists.`,
        };
      }
      const payload = { action: "create_department", name: deptName };
      const proposedChange: ProposedChange = {
        description: `Create department "${deptName}"`,
        diff: { name: { before: null, after: deptName } },
        payload,
      };
      return {
        intent: finalIntent,
        entities: { department: deptName },
        confidence,
        isReadOnly: false,
        proposedChange,
        confirmationToken: signConfirmation(payload),
        message: `Proposed: create department "${deptName}". Review and confirm.`,
      };
    }
    default:
      return {
        intent: finalIntent,
        entities: {},
        confidence,
        isReadOnly: true,
        message: "Intent recognized but not yet supported.",
      };
  }
}

function inferDepartmentName(text: string): string | null {
  // Try "Change X first-response" pattern.
  const m = text.match(/(?:change|for|the)\s+([A-Za-z &]+?)\s+(?:first-response|first response|sla|resolution)/i);
  return m ? m[1].trim() : null;
}

function inferRuleName(text: string): string | null {
  const m = text.match(/(?:rule|automation)\s+["']?([^"']+)["']?$/i);
  return m ? m[1].trim() : null;
}

/* ------------------------------------------------------------------ */
/* Execute — token + RBAC + transactional + audited.                   */
/* ------------------------------------------------------------------ */

export async function executeAdminCommand(
  token: string,
  actorId: number,
): Promise<{ success: boolean; message: string; applied?: Record<string, unknown> }> {
  const user = await getUser(actorId);
  if (!user || !isAdminRole(user.role)) {
    throw new Error("Admin access required to execute admin commands");
  }

  const payload = verifyConfirmation(token);
  if (!payload) {
    throw new Error("Invalid or expired confirmation token");
  }

  const action = payload.action as string;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let applied: Record<string, unknown> = {};
    let auditDetail: Record<string, unknown> = { action };

    switch (action) {
      case "change_sla_policy": {
        const { policyId, field, newMinutes } = payload as {
          policyId: number; field: string; newMinutes: number;
        };
        if (!["first_response_minutes", "resolution_minutes"].includes(field)) {
          throw new Error("Invalid SLA field");
        }
        if (!Number.isInteger(newMinutes) || newMinutes < 5 || newMinutes > 10080) {
          throw new Error("SLA minutes must be 5–10080");
        }
        const { rows } = await client.query(
          `UPDATE sla_policies SET ${field} = $1, updated_at = now()
           WHERE id = $2 RETURNING id, name, ${field}`,
          [newMinutes, policyId],
        );
        if (!rows.length) throw new Error("SLA policy not found");
        applied = rows[0];
        auditDetail = { ...auditDetail, policyId, field, newMinutes };
        break;
      }
      case "disable_automation": {
        const { ruleId } = payload as { ruleId: number };
        const { rows } = await client.query(
          `UPDATE automation_rules SET is_active = false, updated_at = now()
           WHERE id = $1 RETURNING id, name, is_active`,
          [ruleId],
        );
        if (!rows.length) throw new Error("Automation rule not found");
        applied = rows[0];
        auditDetail = { ...auditDetail, ruleId };
        break;
      }
      case "create_department": {
        const { name } = payload as { name: string };
        if (!name || name.length > 120) throw new Error("Invalid department name");
        const { rows } = await client.query(
          `INSERT INTO departments (name) VALUES ($1) RETURNING id, name`,
          [name],
        );
        applied = rows[0];
        auditDetail = { ...auditDetail, name };
        break;
      }
      default:
        throw new Error(`Unsupported action: ${action}`);
    }

    await client.query("COMMIT");

    // Audit log.
    await pool.query(
      `INSERT INTO ai_audit_logs (actor_id, actor_type, action, entity_type, entity_id, detail)
       VALUES ($1, 'human', 'admin_copilot.execute', 'admin_command', $2, $3::jsonb)`,
      [actorId, String(applied.id ?? action), JSON.stringify(auditDetail)],
    );

    return { success: true, message: `Applied: ${action}`, applied };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
