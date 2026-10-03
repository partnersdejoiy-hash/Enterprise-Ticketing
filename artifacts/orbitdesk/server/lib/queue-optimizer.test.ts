import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  POLICY_WEIGHTS,
  weightedFinalScore,
  pickWinner,
  type ScoreBreakdown,
  type CandidateScore,
} from "./queue-optimizer.ts";

const here = fileURLToPath(new URL("queue-optimizer.ts", import.meta.url));

function makeCandidate(
  agentId: number,
  breakdown: ScoreBreakdown,
  score?: number,
): CandidateScore {
  return {
    agentId,
    agentName: `Agent ${agentId}`,
    score: score ?? weightedFinalScore(breakdown),
    breakdown,
  };
}

test("POLICY_WEIGHTS sums to 1", () => {
  const total = Object.values(POLICY_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
  assert.equal(POLICY_WEIGHTS.skill, 0.4);
  assert.equal(POLICY_WEIGHTS.workload, 0.3);
  assert.equal(POLICY_WEIGHTS.sla_risk, 0.2);
  assert.equal(POLICY_WEIGHTS.round_robin, 0.1);
});

test("weightedFinalScore applies the documented weights", () => {
  const b: ScoreBreakdown = { skill: 100, workload: 50, slaRisk: 25, roundRobin: 0 };
  // 0.4*100 + 0.3*50 + 0.2*25 + 0.1*0 = 40 + 15 + 5 + 0 = 60
  assert.equal(weightedFinalScore(b), 60);
});

test("least_loaded policy picks the lowest-workload (highest workloadScore) agent", () => {
  const candidates = [
    makeCandidate(1, { skill: 100, workload: 10, slaRisk: 100, roundRobin: 100 }),
    makeCandidate(2, { skill: 0, workload: 90, slaRisk: 0, roundRobin: 0 }),
    makeCandidate(3, { skill: 100, workload: 40, slaRisk: 100, roundRobin: 100 }),
  ];
  // Agent 2 has the worst final score but the best (lowest) workload.
  assert.ok(candidates[0].score > candidates[1].score);
  assert.equal(pickWinner(candidates, "least_loaded").agentId, 2);
});

test("round_robin policy picks the longest-idle (highest roundRobinScore) agent", () => {
  const candidates = [
    makeCandidate(1, { skill: 100, workload: 100, slaRisk: 100, roundRobin: 5 }),
    makeCandidate(2, { skill: 0, workload: 0, slaRisk: 0, roundRobin: 95 }),
    makeCandidate(3, { skill: 100, workload: 100, slaRisk: 100, roundRobin: 40 }),
  ];
  assert.equal(pickWinner(candidates, "round_robin").agentId, 2);
});

test("skill_based and ai_recommended policies pick their respective maxima", () => {
  const candidates = [
    makeCandidate(1, { skill: 20, workload: 100, slaRisk: 100, roundRobin: 100 }),
    makeCandidate(2, { skill: 90, workload: 0, slaRisk: 0, roundRobin: 0 }),
  ];
  assert.equal(pickWinner(candidates, "skill_based").agentId, 2);
  // Agent 1: 0.4*20 + 0.3*100 + 0.2*100 + 0.1*100 = 68
  // Agent 2: 0.4*90 = 36  → ai_recommended picks agent 1
  assert.equal(pickWinner(candidates, "ai_recommended").agentId, 1);
});

test("pickWinner breaks ties by lowest agentId", () => {
  const candidates = [
    makeCandidate(9, { skill: 50, workload: 50, slaRisk: 50, roundRobin: 50 }),
    makeCandidate(4, { skill: 50, workload: 50, slaRisk: 50, roundRobin: 50 }),
  ];
  assert.equal(pickWinner(candidates, "ai_recommended").agentId, 4);
});

test("pickWinner throws when there are no candidates", () => {
  assert.throws(() => pickWinner([], "ai_recommended"));
});

test("candidate queries select only work-identity columns and no personal attributes", async () => {
  const src = await readFile(here, "utf8");

  // Extract every candidate SELECT statement.
  const queries = [
    ...src.matchAll(
      /SELECT\s+id,\s*name,\s*department_id,\s*role\s+FROM\s+users[\s\S]*?ORDER BY id ASC/g,
    ),
  ].map((m) => m[0]);
  assert.ok(queries.length >= 2, "expected department + fallback candidate queries");

  for (const q of queries) {
    const selectList = q
      .slice(0, q.indexOf("FROM"))
      .replace(/^SELECT\s+/i, "")
      .split(",")
      .map((c) => c.trim().toLowerCase());
    assert.deepEqual(selectList, ["id", "name", "department_id", "role"]);
  }

  // Personal attributes must never appear in the candidate query blocks.
  const forbidden = [
    "age",
    "gender",
    "sex",
    "location",
    "city",
    "dob",
    "birth",
    "race",
    "religion",
    "ethnicity",
    "marital",
    "address",
    "phone",
    "nationality",
    "caste",
  ];
  for (const q of queries) {
    for (const word of forbidden) {
      assert.ok(
        !new RegExp(`\\b${word}\\b`, "i").test(q),
        `candidate query references personal attribute "${word}"`,
      );
    }
  }
});
