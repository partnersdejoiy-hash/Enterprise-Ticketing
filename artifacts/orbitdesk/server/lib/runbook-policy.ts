/**
 * Runbook Policy — the server-side safety gate for Self-Healing (#13).
 *
 * HARD RULES:
 *  - Only allowlisted actions may ever execute. NEVER arbitrary shell/commands.
 *  - Destructive (high/critical risk) actions ALWAYS require human approval,
 *    enforced in code — not just in the UI.
 *  - Every step is logged with actor, timestamp, and result.
 *
 * This module is pure (no DB) so it can be unit-tested in isolation.
 */

export const ALLOWED_ACTIONS = [
  "clear_cache",
  "restart_service",
  "scale_up",
  "notify",
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RunbookStep {
  action: string;
  params?: Record<string, unknown>;
  risk?: RiskLevel;
}

export interface StepValidationError {
  index: number;
  message: string;
}

/**
 * Validate runbook steps against the allowlist. Returns errors (empty = valid).
 * Rejects: unknown actions, missing action, invalid risk values.
 */
export function validateSteps(steps: unknown): {
  valid: boolean;
  errors: StepValidationError[];
  normalized: RunbookStep[];
} {
  const errors: StepValidationError[] = [];
  const normalized: RunbookStep[] = [];
  if (!Array.isArray(steps)) {
    return {
      valid: false,
      errors: [{ index: -1, message: "steps must be an array" }],
      normalized,
    };
  }
  const allowed = new Set<string>(ALLOWED_ACTIONS);
  const risks: RiskLevel[] = ["low", "medium", "high", "critical"];
  steps.forEach((s, i) => {
    if (!s || typeof s !== "object") {
      errors.push({ index: i, message: "step must be an object" });
      return;
    }
    const step = s as Record<string, unknown>;
    if (typeof step.action !== "string" || !step.action.trim()) {
      errors.push({ index: i, message: "step.action is required" });
      return;
    }
    if (!allowed.has(step.action)) {
      errors.push({
        index: i,
        message: `action "${step.action}" is not in the allowlist (${ALLOWED_ACTIONS.join(", ")}). Arbitrary commands are forbidden.`,
      });
      return;
    }
    if (
      step.params !== undefined &&
      (typeof step.params !== "object" || step.params === null)
    ) {
      errors.push({ index: i, message: "step.params must be an object" });
      return;
    }
    const risk =
      typeof step.risk === "string" && risks.includes(step.risk as RiskLevel)
        ? (step.risk as RiskLevel)
        : "low";
    if (step.risk !== undefined && !risks.includes(step.risk as RiskLevel)) {
      errors.push({
        index: i,
        message: `step.risk must be one of ${risks.join(", ")}`,
      });
      return;
    }
    normalized.push({
      action: step.action,
      params: (step.params as Record<string, unknown>) ?? {},
      risk,
    });
  });
  return { valid: errors.length === 0, errors, normalized };
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];

export function riskAtLeast(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b);
}

export function highestRisk(steps: RunbookStep[]): RiskLevel {
  let top: RiskLevel = "low";
  for (const s of steps) {
    if (riskAtLeast(s.risk ?? "low", top)) top = s.risk ?? "low";
  }
  return top;
}

/**
 * Approval gating decision. Destructive risk (high/critical) ALWAYS requires
 * approval regardless of the runbook's requires_approval flag — this is the
 * code-level enforcement that the UI cannot bypass.
 */
export function approvalRequired(
  steps: RunbookStep[],
  runbookRequiresApproval: boolean,
): { required: boolean; reason: string } {
  const top = highestRisk(steps);
  if (riskAtLeast(top, "high")) {
    return {
      required: true,
      reason: `Destructive risk level "${top}" — human approval is mandatory and cannot be disabled.`,
    };
  }
  if (runbookRequiresApproval) {
    return {
      required: true,
      reason: "Runbook policy requires approval before execution.",
    };
  }
  return { required: false, reason: "Low-risk runbook with approval disabled." };
}

/** Swarm message types accepted by the API. */
export const SWARM_MESSAGE_TYPES = [
  "chat",
  "note",
  "decision",
  "status_update",
] as const;

export function isValidSwarmMessageType(t: unknown): t is (typeof SWARM_MESSAGE_TYPES)[number] {
  return (
    typeof t === "string" &&
    (SWARM_MESSAGE_TYPES as readonly string[]).includes(t)
  );
}
