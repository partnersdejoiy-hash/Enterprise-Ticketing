/**
 * Orbit Intelligence API client (Superpowers #18, #19, #20).
 * GET helpers use readApi (cookie session); write helpers attach the Bearer
 * token like the rest of the app's mutation paths.
 */
import { readApi } from "@/lib/operations";
import { useAuthStore } from "@/lib/auth";

export interface Triage {
  id: number;
  ticketId: number;
  intent: string | null;
  category: string | null;
  subcategory: string | null;
  priorityRecommendation: string | null;
  urgency: string | null;
  impact: string | null;
  departmentId: number | null;
  skillsRequired: string[];
  sentiment: string | null;
  language: string | null;
  duplicateOfTicketId: number | null;
  securityRisk: string | null;
  confidence: number | null;
  overridden: boolean;
  overrideNote: string | null;
  createdAt: string;
}

export interface DuplicateCandidate {
  relationshipId: number | null;
  ticketId: number;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  similarity: number;
  aiConfidence: number | null;
  relationshipStatus: string | null;
}

export interface NextAction {
  action: string;
  title: string;
  reason: string;
  confidence: number;
  evidence: { fact: string; value: string }[];
  recommendationId: number | null;
}

async function writeApi<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const token = useAuthStore.getState().token;
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.assign("/");
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error || "Request failed. Try again.",
    );
  }
  return res.json() as Promise<T>;
}

export const fetchTriage = (ticketId: number) =>
  readApi<{ triage: Triage }>(`/api/intelligence/tickets/${ticketId}/triage`);

export const runTriage = (ticketId: number) =>
  writeApi<{ triage: Triage }>(
    `/api/intelligence/tickets/${ticketId}/triage`,
    "POST",
  );

export const overrideTriageApi = (
  triageId: number,
  corrections: Record<string, unknown>,
  note?: string,
) =>
  writeApi<{ triage: Triage }>(
    `/api/intelligence/triage/${triageId}/override`,
    "POST",
    { corrections, note },
  );

export const fetchNextAction = (ticketId: number) =>
  readApi<{ nextAction: NextAction }>(
    `/api/intelligence/tickets/${ticketId}/next-action`,
  );

export const fetchDuplicates = (ticketId: number) =>
  readApi<{ duplicates: DuplicateCandidate[] }>(
    `/api/intelligence/tickets/${ticketId}/duplicates`,
  );

export const mergeDuplicate = (relationshipId: number) =>
  writeApi<{ merged: boolean; keptTicket: string; closedTicket: string }>(
    `/api/intelligence/duplicates/${relationshipId}/merge`,
    "POST",
  );

export const linkDuplicate = (relationshipId: number) =>
  writeApi<{ linked: boolean }>(
    `/api/intelligence/duplicates/${relationshipId}/link`,
    "POST",
  );

export const dismissDuplicate = (relationshipId: number) =>
  writeApi<{ dismissed: boolean }>(
    `/api/intelligence/duplicates/${relationshipId}/dismiss`,
    "POST",
  );
