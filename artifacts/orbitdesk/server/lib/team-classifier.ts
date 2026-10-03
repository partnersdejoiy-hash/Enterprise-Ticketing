// Open-source local TF-IDF classifier. No network, inference API or employee data training.
// Only classifies new, unrouted requests; never moves existing tickets or changes access rules.
export type Team = { id: number; name: string; description?: string | null };
const vocabulary: [RegExp, string][] = [
  [
    /background verification|\bbgv\b/i,
    "bgv background verification screening reference check criminal education address check",
  ],
  [
    /employment verification/i,
    "employment verification employment letter verification tenure employer employment history",
  ],
  [
    /^it$|information technology|it support/i,
    "password reset login vpn laptop computer printer software hardware network wifi email access system error device",
  ],
  [
    /payroll|benefits/i,
    "salary payroll payslip pf epf esic provident fund deduction benefits reimbursement salary arrears",
  ],
  [
    /^hr$|human resources/i,
    "leave attendance joining onboarding resignation experience letter relieving letter employee documents hr human resources",
  ],
  [
    /finance|accounts/i,
    "invoice payment vendor expense finance tax budget purchase order billing accounts",
  ],
  [
    /security|compliance/i,
    "phishing security incident data breach malware suspicious compliance information security",
  ],
  [
    /administration|facilities/i,
    "office supplies stationery pantry housekeeping facility parking cab transport travel hotel booking",
  ],
  [
    /workforce/i,
    "roster shift schedule staffing forecast workforce shrinkage adherence",
  ],
  [
    /quality/i,
    "quality assurance scorecard call quality monitoring calibration audit feedback",
  ],
  [
    /training/i,
    "training learning course certification trainer induction upskilling coaching",
  ],
  [
    /operations/i,
    "operations process workflow sop procedure delivery escalation operations support",
  ],
];
const stop = new Set(
  "a an the and or for to of is my me i please help with on in it this that not can need request issue regarding".split(
    " ",
  ),
);
function tokens(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/wi-fi/g, "wifi")
      .match(/[a-z0-9]+/g)
      ?.filter((w) => w.length > 1 && !stop.has(w)) ?? []
  );
}
export function classifyTeam(text: string, teams: Team[]) {
  const docs = teams.map((t) =>
    tokens(
      `${t.name} ${t.description ?? ""} ${vocabulary
        .filter(([rx]) => rx.test(t.name))
        .map(([, s]) => s)
        .join(" ")}`,
    ),
  );
  const query = tokens(text.slice(0, 6000));
  if (!query.length || !teams.length)
    return {
      departmentId: null,
      confidence: 0,
      reason: "Not enough information; admin triage required",
    };
  const idf = (w: string) =>
    Math.log(1 + teams.length / (1 + docs.filter((d) => d.includes(w)).length));
  const vector = (ws: string[]) =>
    new Map(
      [...new Set(ws)].map((w) => [
        w,
        (1 + Math.log(ws.filter((x) => x === w).length)) * idf(w),
      ]),
    );
  const q = vector(query),
    norm = (v: Map<string, number>) =>
      Math.sqrt([...v.values()].reduce((s, n) => s + n * n, 0));
  const ranked = docs
    .map((d, i) => {
      const v = vector(d);
      return {
        team: teams[i],
        score:
          [...q].reduce((s, [w, n]) => s + n * (v.get(w) ?? 0), 0) /
          (norm(q) * norm(v) || 1),
        matches: [...new Set(query.filter((w) => d.includes(w)))],
      };
    })
    .sort((a, b) => b.score - a.score || a.team.id - b.team.id);
  const first = ranked[0],
    margin = first.score - (ranked[1]?.score ?? 0);
  const accepted =
    first.score >= 0.18 && margin >= 0.07 && first.matches.length >= 2;
  return {
    departmentId: accepted ? first.team.id : null,
    confidence: Math.round(first.score * 100),
    reason: accepted
      ? `Matched ${first.matches.slice(0, 4).join(", ")} to ${first.team.name}`
      : "Ambiguous request; admin triage required",
  };
}
