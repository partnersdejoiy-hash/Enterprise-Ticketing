import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SlaHealthBadge, type SlaHealth } from "@/components/SlaHealthBadge";
import {
  RefreshCw,
  AlertTriangle,
  Lightbulb,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

async function slaFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
    throw new Error(body.error ?? "SLA request failed");
  return body as T;
}

interface SlaStatusPayload {
  status: {
    policyName: string | null;
    firstResponseDueAt: string | null;
    resolutionDueAt: string | null;
    elapsedBusinessMinutes: number;
    remainingBusinessMinutes: number | null;
    health: SlaHealth;
    percentElapsed: number | null;
  };
}

interface SlaPredictionPayload {
  prediction: {
    id: number;
    ticketId: number;
    breachProbability: number;
    predictedBreachAt: string | null;
    health: SlaHealth;
    confidence: number;
    factors: { factor: string; weight: number; detail: string }[];
    recommendedActions: string[];
    createdAt: string;
  } | null;
  hasPrediction: boolean;
}

function formatMinutes(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Full SLA intelligence card for the ticket workspace.
 * Shows deterministic status + latest AI breach prediction with
 * explainable factors and human-owned recommendations.
 * Never auto-executes anything.
 */
export function SlaPredictionCard({ ticketId }: { ticketId: number }) {
  const queryClient = useQueryClient();
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["sla-status", ticketId],
    queryFn: () => slaFetch<SlaStatusPayload>(`/sla/tickets/${ticketId}/status`),
  });
  const predictionQuery = useQuery({
    queryKey: ["sla-prediction", ticketId],
    queryFn: () =>
      slaFetch<SlaPredictionPayload>(`/sla/tickets/${ticketId}/prediction`),
  });

  const predictMutation = useMutation({
    mutationFn: () =>
      slaFetch<SlaPredictionPayload>(`/sla/tickets/${ticketId}/predict`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["sla-prediction", ticketId], data);
      setRefreshMsg("Prediction refreshed.");
    },
    onError: (e: Error) => setRefreshMsg(e.message),
  });

  const status = statusQuery.data?.status;
  const prediction = predictionQuery.data?.prediction;

  if (statusQuery.isLoading || predictionQuery.isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-8 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (statusQuery.isError || predictionQuery.isError) {
    const msg =
      (statusQuery.error as Error | undefined)?.message ??
      (predictionQuery.error as Error | undefined)?.message ??
      "Failed to load SLA data";
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">SLA Intelligence</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>{msg}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  statusQuery.refetch();
                  predictionQuery.refetch();
                }}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const displayHealth: SlaHealth = prediction?.health ?? status?.health ?? "no_policy";
  const probability = prediction?.breachProbability ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">SLA Intelligence</CardTitle>
          <SlaHealthBadge health={displayHealth} probability={probability} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Deterministic status */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-muted/60 p-2">
            <div className="text-muted-foreground">Elapsed</div>
            <div className="font-semibold tabular-nums">
              {formatMinutes(status?.elapsedBusinessMinutes ?? null)}
            </div>
          </div>
          <div className="rounded-md bg-muted/60 p-2">
            <div className="text-muted-foreground">Remaining</div>
            <div className="font-semibold tabular-nums">
              {formatMinutes(status?.remainingBusinessMinutes ?? null)}
            </div>
          </div>
          <div className="rounded-md bg-muted/60 p-2 col-span-2">
            <div className="text-muted-foreground">Resolution due</div>
            <div className="font-semibold">
              {formatDateTime(status?.resolutionDueAt ?? null)}
              {status?.policyName ? ` · ${status.policyName}` : ""}
            </div>
          </div>
        </div>

        {status && status.percentElapsed != null && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>SLA elapsed</span>
              <span className="tabular-nums">{status.percentElapsed}%</span>
            </div>
            <Progress value={status.percentElapsed} className="h-2" />
          </div>
        )}

        {/* AI prediction */}
        {prediction ? (
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                AI breach prediction
              </span>
              <span className="text-muted-foreground tabular-nums">
                confidence {Math.round(prediction.confidence)}%
              </span>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Breach probability</span>
                <span className="tabular-nums font-semibold text-foreground">
                  {Math.round(prediction.breachProbability)}%
                </span>
              </div>
              <Progress
                value={prediction.breachProbability}
                className={cn(
                  "h-2",
                  prediction.breachProbability >= 70 && "[&>div]:bg-red-600",
                  prediction.breachProbability >= 40 &&
                    prediction.breachProbability < 70 &&
                    "[&>div]:bg-amber-500",
                )}
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Predicted breach:{" "}
              <span className="font-medium text-foreground">
                {formatDateTime(prediction.predictedBreachAt)}
              </span>
            </div>

            {prediction.factors.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Contributing factors
                </div>
                <ul className="space-y-1.5">
                  {prediction.factors.map((f, i) => (
                    <li key={i} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{f.factor}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {f.weight}%
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-muted">
                        <div
                          className="h-1 rounded-full bg-amber-500"
                          style={{ width: `${Math.min(100, f.weight)}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-muted-foreground">{f.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {prediction.recommendedActions.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5" />
                  Recommended actions
                  <span className="font-normal">(suggestions — you decide)</span>
                </div>
                <ul className="space-y-1">
                  {prediction.recommendedActions.map((a, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-dashed border-border bg-muted/40 px-2 py-1.5 text-xs"
                    >
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Predicted {formatDateTime(prediction.createdAt)} · probabilistic
              estimate, not a guarantee.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-3 text-center">
            <ShieldAlert className="mx-auto mb-1 h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No AI prediction yet. Run one to get breach probability,
              contributing factors and recommended actions.
            </p>
          </div>
        )}

        {refreshMsg && (
          <p className="text-xs text-muted-foreground">{refreshMsg}</p>
        )}
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={predictMutation.isPending}
          onClick={() => {
            setRefreshMsg(null);
            predictMutation.mutate();
          }}
        >
          <RefreshCw
            className={cn("mr-2 h-3.5 w-3.5", predictMutation.isPending && "animate-spin")}
          />
          {predictMutation.isPending
            ? "Analyzing…"
            : prediction
              ? "Refresh prediction"
              : "Run SLA prediction"}
        </Button>
      </CardContent>
    </Card>
  );
}
