// Root Cause Intelligence — recurring-ticket clustering and AI-generated
// root-cause hypotheses with human confirm/reject. Copy is probabilistic:
// "may", "potential", never "definitely".
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  GitBranch,
  Lightbulb,
  Loader2,
  RefreshCw,
  Ticket,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  intelFetch,
  type Cluster,
  type Hypothesis,
} from "@/lib/intel";

const hypothesisStatusStyles: Record<string, string> = {
  proposed: "bg-blue-100 text-blue-700 border-blue-200",
  confirmed: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-gray-100 text-gray-600 border-gray-200",
};

function HypothesisCard({
  hypothesis,
  onDecision,
}: {
  hypothesis: Hypothesis;
  onDecision: (h: Hypothesis, confirmed: boolean, authoredText?: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [authored, setAuthored] = useState("");
  const [busy, setBusy] = useState(false);

  const decided = hypothesis.status !== "proposed";

  const handleConfirm = () => {
    setBusy(true);
    onDecision(hypothesis, true, authored.trim() || undefined);
    setBusy(false);
    setConfirmOpen(false);
    setAuthored("");
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">
          <Lightbulb className="h-4 w-4 inline mr-1.5 text-amber-500 -mt-0.5" />
          {hypothesis.hypothesis}
        </p>
        <Badge
          className={cn(
            "border shrink-0 capitalize",
            hypothesisStatusStyles[hypothesis.status] ?? "bg-slate-100",
          )}
        >
          {hypothesis.status}
        </Badge>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>Potential cause likelihood</span>
          <span className="font-semibold text-foreground">
            {Math.round((hypothesis.confidence ?? 0) * 100)}%
          </span>
        </div>
        <Progress value={(hypothesis.confidence ?? 0) * 100} className="h-2" />
      </div>
      {!!hypothesis.evidence?.length && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Supporting evidence
          </p>
          <ul className="space-y-1">
            {hypothesis.evidence.map((e, i) => (
              <li key={i} className="text-sm text-foreground/80 flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!decided && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Confirm
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => onDecision(hypothesis, false)}
          >
            <XCircle className="h-3.5 w-3.5 mr-1.5" />
            Reject
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm root cause</DialogTitle>
            <DialogDescription>
              Marking this hypothesis confirmed records it as the likely root
              cause for the problem. Optionally add your own authored root-cause
              note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor={`authored-${hypothesis.id}`}
              className="text-sm font-medium"
            >
              Authored root cause (optional)
            </label>
            <Textarea
              id={`authored-${hypothesis.id}`}
              placeholder="e.g. Caused by the June 28 config deploy — verified in the change log."
              value={authored}
              onChange={(e) => setAuthored(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm root cause
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClusterCard({ cluster }: { cluster: Cluster }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [hypotheses, setHypotheses] = useState<Hypothesis[] | null>(null);
  const [problemNumber, setProblemNumber] = useState<string | null>(null);

  const analyze = useMutation({
    mutationFn: () =>
      intelFetch<{
        problem_id: number;
        problem_number: string;
        hypotheses: Hypothesis[];
      }>("/root-cause/analyze", {
        method: "POST",
        body: JSON.stringify({ ticket_ids: cluster.tickets.map((t) => t.id) }),
      }),
    onSuccess: (data) => {
      setHypotheses(data.hypotheses);
      setProblemNumber(data.problem_number ?? `Problem ${data.problem_id}`);
      toast({
        title: "Root-cause analysis proposed",
        description: `${data.hypotheses.length} potential cause${data.hypotheses.length === 1 ? "" : "s"} suggested — review required.`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const decide = async (
    h: Hypothesis,
    confirmed: boolean,
    authoredText?: string,
  ) => {
    try {
      await intelFetch(`/root-cause/hypotheses/${h.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ confirmed, authored_text: authoredText }),
      });
      setHypotheses((prev) =>
        prev?.map((p) =>
          p.id === h.id
            ? { ...p, status: confirmed ? "confirmed" : "rejected" }
            : p,
        ) ?? null,
      );
      queryClient.invalidateQueries({ queryKey: ["root-cause-clusters"] });
      toast({
        title: confirmed ? "Hypothesis confirmed" : "Hypothesis rejected",
        description: confirmed
          ? "Recorded as the likely root cause."
          : "The hypothesis has been rejected.",
      });
    } catch (e: any) {
      toast({
        title: "Error",
        description: e.message ?? "Failed to record decision",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {cluster.keywords.map((k) => (
                <Badge key={k} variant="secondary">
                  {k}
                </Badge>
              ))}
            </div>
            <CardDescription>
              <span className="font-semibold text-foreground">
                {cluster.ticket_count}
              </span>{" "}
              potentially related ticket{cluster.ticket_count === 1 ? "" : "s"}
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => analyze.mutate()}
            disabled={analyze.isPending || !cluster.tickets.length}
          >
            {analyze.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <FileSearch className="h-3.5 w-3.5 mr-1.5" />
            )}
            {analyze.isPending ? "Analyzing…" : "Propose root cause"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  expanded && "rotate-180",
                )}
              />
              {expanded ? "Hide" : "Show"} tickets in this cluster
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <ul className="space-y-1">
              {cluster.tickets.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tickets/${t.id}`}
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Ticket className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono text-xs">{t.ticket_number}</span>
                    <span className="truncate text-foreground/80">
                      {t.subject}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>

        {!!hypotheses?.length && (
          <div className="space-y-3 pt-2 border-t border-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-3">
              Potential root causes{" "}
              {problemNumber && (
                <span className="normal-case font-normal">
                  · {problemNumber}
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground -mt-2">
              Suggestions only — confirm or reject each hypothesis.
            </p>
            {hypotheses.map((h) => (
              <HypothesisCard key={h.id} hypothesis={h} onDecision={decide} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function RootCausePanel() {
  const query = useQuery({
    queryKey: ["root-cause-clusters"],
    queryFn: () => intelFetch<{ clusters: Cluster[] }>("/root-cause/clusters"),
    enabled: false,
  });

  const clusters = query.data?.clusters ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">DEJOIY / ROOT CAUSE INTELLIGENCE</p>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" />
            Root Cause
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Recurring tickets are grouped by theme; the assistant proposes
            possible root causes, and your team confirms which one is right.
          </p>
        </div>
        <Button
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw
            className={cn("h-4 w-4 mr-2", query.isFetching && "animate-spin")}
          />
          {query.isFetching
            ? "Detecting…"
            : query.data
              ? "Re-run detection"
              : "Detect clusters"}
        </Button>
      </div>

      {query.isFetching ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-lg" />
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
      ) : !query.data ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <GitBranch className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="font-medium">No clusters yet</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Run detection to group potentially related tickets by theme, then
              propose and review root-cause hypotheses per cluster.
            </p>
          </CardContent>
        </Card>
      ) : clusters.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
            <p className="font-medium">No recurring themes detected</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Tickets do not currently form any notable clusters. Re-run
              detection later as more requests arrive.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {clusters.map((c) => (
            <ClusterCard key={c.key} cluster={c} />
          ))}
        </div>
      )}
    </div>
  );
}
