// Shared client helpers + types for the Intelligence features
// (Root Cause Intelligence, Predictive Operations, AI Resolution Agent).
export async function intelFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.assign("/");
    throw new Error("Session expired. Please sign in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false)
    throw new Error(body.error ?? body.message ?? "Intelligence request failed");
  return body as T;
}

export interface RiskEvidence {
  metric: string;
  current_7d: number;
  prior_21d_avg: number;
  ratio: number;
}

export interface Risk {
  id: number;
  risk_type: string;
  risk_level: "low" | "medium" | "high" | "critical";
  title: string;
  evidence: RiskEvidence[];
  suggested_actions: { action: string; label: string }[];
  status: string;
  created_at: string;
}

export interface ClusterTicket {
  id: number;
  ticket_number: string;
  subject: string;
}

export interface Cluster {
  key: string;
  keywords: string[];
  ticket_count: number;
  tickets: ClusterTicket[];
}

export interface Hypothesis {
  id: number;
  hypothesis: string;
  confidence: number;
  evidence: string[];
  status: string;
  entity_id?: number;
}

export interface PlanStep {
  step: string;
  detail: string;
  source_refs?: string[];
}

export interface PlanSource {
  type: string;
  id: number;
  title: string;
}

export interface ResolutionPlanData {
  id: number;
  ticket_id: number;
  steps: PlanStep[];
  actions: unknown;
  confidence: number;
  sources: PlanSource[];
  recommended_action: string;
  requires_approval: boolean;
  risk_level: string;
  status: "proposed" | "approved" | "rejected" | "executed";
  created_at?: string;
  updated_at?: string;
}

export function formatRiskType(rt: string): string {
  return rt
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
