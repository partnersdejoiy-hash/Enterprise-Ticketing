import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  RefreshCw,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { getGetTicketQueryKey } from "@workspace/api-client-react";

async function queueFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
    throw new Error(body.error ?? "Queue request failed");
  return body as T;
}

export interface ScoreBreakdown {
  skill: number;
  workload: number;
  slaRisk: number;
  roundRobin: number;
}

export interface RecommendationCandidate {
  agentId: number;
  agentName: string;
  score: number;
  breakdown?: ScoreBreakdown;
  note?: string;
}

export interface RecommendationPayload {
  recommendationId: number;
  ticketId: number;
  departmentId: number | null;
  policy: string;
  winner: { agentId: number; agentName: string; score?: number; breakdown?: ScoreBreakdown } | null;
  candidates: RecommendationCandidate[];
  weights?: { skill: number; workload: number; sla_risk: number; round_robin: number };
  confidence?: number | null;
  applied?: boolean;
  createdAt?: string;
}

interface RecommendationResponse {
  ok: boolean;
  fresh: boolean;
  recommendation: RecommendationPayload;
}

interface PolicyResponse {
  ok: boolean;
  departmentId: number | null;
  policy: string;
}

const POLICY_LABELS: Record<string, string> = {
  ai_recommended: "AI recommended",
  skill_based: "Skill based",
  least_loaded: "Least loaded",
  round_robin: "Round robin",
};

const BREAKDOWN_META: {
  key: keyof ScoreBreakdown;
  label: string;
  weightLabel: string;
}[] = [
  { key: "skill", label: "Skill", weightLabel: "40%" },
  { key: "workload", label: "Workload", weightLabel: "30%" },
  { key: "slaRisk", label: "SLA risk", weightLabel: "20%" },
  { key: "roundRobin", label: "Round-robin", weightLabel: "10%" },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function ScoreBar({
  label,
  weightLabel,
  value,
}: {
  label: string;
  weightLabel: string;
  value: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {label} <span className="font-medium text-foreground">({weightLabel})</span>
        </span>
        <span className="font-semibold tabular-nums">{Math.round(value)}</span>
      </div>
      <Progress value={value} className="h-1.5" />
    </div>
  );
}

/**
 * AI Queue Optimizer card for the ticket workspace (Superpower #7).
 * Shows the recommended agent with an explainable score breakdown, the
 * active assignment policy, and the top-3 ranked candidates. Applying a
 * recommendation is manager+ only — the server re-enforces this.
 */
export function QueueRecommendation({ ticketId }: { ticketId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const canManage = ["admin", "super_admin", "manager"].includes(user?.role ?? "");

  const recQuery = useQuery({
    queryKey: ["queue-recommendation", ticketId],
    queryFn: () =>
      queueFetch<RecommendationResponse>(`/queue/tickets/${ticketId}/recommendation`),
  });

  const rec = recQuery.data?.recommendation;

  const policyQuery = useQuery({
    queryKey: ["queue-policy", rec?.departmentId ?? "none"],
    queryFn: () =>
      queueFetch<PolicyResponse>(
        `/queue/policy${rec?.departmentId != null ? `?departmentId=${rec.departmentId}` : ""}`,
      ),
    enabled: !!rec,
  });

  const historyQuery = useQuery({
    queryKey: ["queue-history", ticketId],
    queryFn: () =>
      queueFetch<{ ok: boolean; history: RecommendationPayload[] }>(
        `/queue/tickets/${ticketId}/history`,
      ),
  });

  const refreshMutation = useMutation({
    mutationFn: () =>
      queueFetch<RecommendationResponse>(`/queue/tickets/${ticketId}/recommendation`),
    onSuccess: (data) => {
      queryClient.setQueryData(["queue-recommendation", ticketId], data);
    },
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      queueFetch<{ ok: boolean; assigneeId: number; policy: string }>(
        `/queue/tickets/${ticketId}/apply`,
        {
          method: "POST",
          body: JSON.stringify({ recommendationId: rec?.recommendationId }),
        },
      ),
    onSuccess: () => {
      setApplyMsg("Recommendation applied — ticket reassigned.");
      toast({ title: "Reassigned", description: "Ticket assigned to the recommended agent." });
      queryClient.invalidateQueries({ queryKey: ["queue-recommendation", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["queue-history", ticketId] });
      queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
    },
    onError: (e: Error) => setApplyMsg(e.message),
  });

  const policyMutation = useMutation({
    mutationFn: (policy: string) =>
      queueFetch<PolicyResponse>("/queue/policy", {
        method: "PUT",
        body: JSON.stringify({ departmentId: rec?.departmentId ?? null, policy }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["queue-policy", rec?.departmentId ?? "none"], data);
      queryClient.invalidateQueries({ queryKey: ["queue-recommendation", ticketId] });
      toast({ title: "Policy updated", description: `Now using ${POLICY_LABELS[data.policy]}.` });
    },
    onError: (e: Error) =>
      toast({ title: "Policy update failed", description: e.message, variant: "destructive" }),
  });

  if (recQuery.isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-8 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (recQuery.isError) {
    const msg = (recQuery.error as Error | undefined)?.message ?? "Failed to load recommendation";
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">AI Queue Optimizer</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>{msg}</span>
              <Button size="sm" variant="outline" onClick={() => recQuery.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!rec) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">AI Queue Optimizer</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No recommendation available yet.
        </CardContent>
      </Card>
    );
  }

  const winner = rec.winner;
  const winnerBreakdown =
    winner?.breakdown ??
    rec.candidates.find((c) => c.agentId === winner?.agentId)?.breakdown;
  const history = historyQuery.data?.history ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-violet-600" />
            AI Queue Optimizer
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-xs">
              {POLICY_LABELS[rec.policy] ?? rec.policy}
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Refresh recommendation"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshMutation.isPending && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {winner ? (
          <>
            {/* Recommended agent */}
            <div className="flex items-center gap-3 rounded-md border border-violet-200 bg-violet-50/60 p-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-violet-600 text-white">
                  {initials(winner.agentName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-foreground truncate">{winner.agentName}</div>
                <div className="text-xs text-muted-foreground">Recommended assignee</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold tabular-nums text-violet-700">
                  {Math.round(winner.score ?? rec.confidence ?? 0)}
                </div>
                <div className="text-xs text-muted-foreground">score</div>
              </div>
            </div>

            {/* Expandable breakdown */}
            {winnerBreakdown && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1 text-xs text-muted-foreground"
                  onClick={() => setShowBreakdown((v) => !v)}
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 mr-1 transition-transform", showBreakdown && "rotate-180")} />
                  {showBreakdown ? "Hide" : "Show"} score breakdown
                </Button>
                {showBreakdown && (
                  <div className="mt-2 space-y-2.5 rounded-md bg-muted/50 p-3">
                    {BREAKDOWN_META.map((m) => (
                      <ScoreBar
                        key={m.key}
                        label={m.label}
                        weightLabel={m.weightLabel}
                        value={winnerBreakdown[m.key] ?? 0}
                      />
                    ))}
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Scored on work metrics only — skill, current workload, SLA-risk capacity and
                      assignment fairness. No personal attributes are used.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Top-3 candidates */}
            {rec.candidates.length > 1 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> Top candidates
                </div>
                {rec.candidates.map((c, i) => (
                  <div
                    key={c.agentId}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5",
                      i === 0 ? "bg-violet-50/60 border border-violet-200" : "bg-muted/40",
                    )}
                  >
                    <span className="text-xs font-semibold text-muted-foreground w-4">#{i + 1}</span>
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-[10px]">{initials(c.agentName)}</AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate text-sm">{c.agentName}</span>
                    <span className="text-sm font-semibold tabular-nums">{Math.round(c.score)}</span>
                  </div>
                ))}
              </div>
            )}

            {canManage && (
              <div className="space-y-2">
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => applyMutation.mutate()}
                  disabled={applyMutation.isPending || rec.applied}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  {rec.applied ? "Applied" : applyMutation.isPending ? "Applying…" : "Apply recommendation"}
                </Button>
                {applyMsg && (
                  <p className="text-xs text-muted-foreground">{applyMsg}</p>
                )}
              </div>
            )}

            {/* Policy selector (manager+) */}
            {canManage && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block">
                  Assignment policy
                </label>
                <Select
                  value={policyQuery.data?.policy ?? rec.policy}
                  onValueChange={(v) => policyMutation.mutate(v)}
                  disabled={policyMutation.isPending}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(POLICY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* History */}
            {history.length > 1 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Recent recommendations
                </div>
                {history.slice(0, 4).map((h) => (
                  <div key={h.recommendationId} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate">
                      {h.winner?.agentName ?? "—"} · {POLICY_LABELS[h.policy] ?? h.policy}
                    </span>
                    <Badge variant={h.applied ? "default" : "outline"} className="text-[10px]">
                      {h.applied ? "Applied" : "Superseded"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <Alert>
            <AlertDescription>
              No eligible agents found — no active agents or managers available for this ticket.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
