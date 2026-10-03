// Predictive Operations — risk radar for the support workspace.
// All figures come from GET /api/risks; copy is intentionally probabilistic.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  Radar,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  intelFetch,
  formatDateTime,
  formatRiskType,
  type Risk,
} from "@/lib/intel";

const levelStyles: Record<Risk["risk_level"], string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

function RiskCard({ risk }: { risk: Risk }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dismissOpen, setDismissOpen] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["risks"] });

  const acknowledge = useMutation({
    mutationFn: () =>
      intelFetch(`/risks/${risk.id}/acknowledge`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Risk acknowledged", description: risk.title });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dismiss = useMutation({
    mutationFn: () => intelFetch(`/risks/${risk.id}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      setDismissOpen(false);
      toast({ title: "Risk dismissed", description: risk.title });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createProblem = useMutation({
    mutationFn: () =>
      intelFetch<{ problem_id: number }>(`/risks/${risk.id}/create-problem`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      toast({
        title: "Problem created",
        description: `Problem #${data.problem_id} opened for root-cause analysis.`,
      });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const open = risk.status === "open";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn("border", levelStyles[risk.risk_level])}>
                {risk.risk_level.toUpperCase()}
              </Badge>
              <Badge variant="outline">{formatRiskType(risk.risk_type)}</Badge>
            </div>
            <CardTitle className="text-base leading-snug">{risk.title}</CardTitle>
            <CardDescription className="text-xs">
              Detected {formatDateTime(risk.created_at)} · status: {risk.status}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!!risk.evidence?.length && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Evidence
            </p>
            <div className="space-y-1.5">
              {risk.evidence.map((ev, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 text-sm bg-muted/50 rounded-md px-3 py-1.5"
                >
                  <span className="text-foreground/80">{ev.metric}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    7d avg {ev.current_7d} vs 21d avg {ev.prior_21d_avg}
                    <span
                      className={cn(
                        "ml-2 font-semibold",
                        ev.ratio >= 1.5 ? "text-red-600" : "text-amber-600",
                      )}
                    >
                      {ev.ratio.toFixed(2)}×
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!!risk.suggested_actions?.length && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Suggested actions
            </p>
            <ul className="space-y-1">
              {risk.suggested_actions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <ShieldAlert className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  <span className="text-foreground/85">{a.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {open && (
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => acknowledge.mutate()}
              disabled={acknowledge.isPending}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Acknowledge
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => createProblem.mutate()}
              disabled={createProblem.isPending}
            >
              <FilePlus2 className="h-3.5 w-3.5 mr-1.5" />
              Create problem
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setDismissOpen(true)}
              disabled={dismiss.isPending}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
      <AlertDialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss this risk?</AlertDialogTitle>
            <AlertDialogDescription>
              This risk will be marked as dismissed and will no longer appear in
              the open risk list. You can still see it in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => dismiss.mutate()}
              disabled={dismiss.isPending}
            >
              {dismiss.isPending ? "Dismissing…" : "Dismiss risk"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function RiskDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["risks"],
    queryFn: () => intelFetch<{ risks: Risk[] }>("/risks?status=open"),
  });

  const analyze = useMutation({
    mutationFn: () =>
      intelFetch<{ created: number }>("/risks/analyze", { method: "POST" }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["risks"] });
      toast({
        title: "Risk analysis complete",
        description:
          data.created > 0
            ? `${data.created} new potential risk${data.created === 1 ? "" : "s"} detected.`
            : "No new risks detected. Existing list refreshed.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const risks = query.data?.risks ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">DEJOIY / PREDICTIVE OPERATIONS</p>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Radar className="h-6 w-6 text-primary" />
            Risk Radar
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Statistical signals that may indicate emerging problems across the
            workspace — reviewed by a human before any action is taken.
          </p>
        </div>
        <Button
          onClick={() => analyze.mutate()}
          disabled={analyze.isPending || query.isFetching}
        >
          <RefreshCw
            className={cn("h-4 w-4 mr-2", analyze.isPending && "animate-spin")}
          />
          {analyze.isPending ? "Analyzing…" : "Run risk analysis"}
        </Button>
      </div>

      {query.isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-lg" />
          ))}
        </div>
      ) : query.isError ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">
              {(query.error as Error).message}
            </p>
            <Button variant="outline" onClick={() => query.refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Try again
            </Button>
          </CardContent>
        </Card>
      ) : risks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="font-medium">No open risks right now</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Run an analysis to scan for emerging patterns — spikes in
              incoming volume, SLA pressure, or repeated failure themes.
            </p>
            <Button
              className="mt-2"
              onClick={() => analyze.mutate()}
              disabled={analyze.isPending}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4 mr-2",
                  analyze.isPending && "animate-spin",
                )}
              />
              Run risk analysis
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {risks.map((r) => (
            <RiskCard key={r.id} risk={r} />
          ))}
        </div>
      )}
    </div>
  );
}
