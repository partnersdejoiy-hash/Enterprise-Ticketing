// AI Resolution Agent — generate, review, approve, and execute
// AI-proposed resolution plans on a ticket. Every action stays human-gated:
// plans never execute without explicit approval, and risky plans require
// confirmation before execution.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Ticket,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  formatDateTime,
  type ResolutionPlanData,
  type PlanStep,
} from "@/lib/intel";

const statusStyles: Record<ResolutionPlanData["status"], string> = {
  proposed: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-gray-100 text-gray-600 border-gray-200",
  executed: "bg-purple-100 text-purple-700 border-purple-200",
};

const riskStyles: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-200",
  medium: "bg-orange-100 text-orange-800 border-orange-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

function StepList({
  steps,
  editing,
  editedSteps,
  onEditStep,
}: {
  steps: PlanStep[];
  editing: boolean;
  editedSteps: PlanStep[];
  onEditStep: (i: number, field: "step" | "detail", value: string) => void;
}) {
  return (
    <ol className="space-y-3">
      {(editing ? editedSteps : steps).map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {i + 1}
          </span>
          <div className="flex-1 space-y-1 min-w-0">
            {editing ? (
              <>
                <Textarea
                  value={s.step}
                  onChange={(e) => onEditStep(i, "step", e.target.value)}
                  rows={1}
                  className="text-sm font-medium"
                />
                <Textarea
                  value={s.detail}
                  onChange={(e) => onEditStep(i, "detail", e.target.value)}
                  rows={2}
                  className="text-sm"
                />
              </>
            ) : (
              <>
                <p className="text-sm font-medium">{s.step}</p>
                {s.detail && (
                  <p className="text-sm text-muted-foreground">{s.detail}</p>
                )}
                {!!s.source_refs?.length && (
                  <p className="text-xs text-muted-foreground">
                    Sources: {s.source_refs.join(", ")}
                  </p>
                )}
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function ResolutionPlan({ ticketId }: { ticketId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editedSteps, setEditedSteps] = useState<PlanStep[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [executeOpen, setExecuteOpen] = useState(false);

  const key = ["resolution-plan", ticketId];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      intelFetch<{ plan: ResolutionPlanData | null }>(
        `/resolution/tickets/${ticketId}/plan`,
      ),
  });
  const plan = query.data?.plan ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const generate = useMutation({
    mutationFn: () =>
      intelFetch<{ plan: ResolutionPlanData }>(
        `/resolution/tickets/${ticketId}/plan`,
        { method: "POST" },
      ),
    onSuccess: () => {
      setEditing(false);
      invalidate();
      toast({
        title: "Resolution plan generated",
        description:
          "Review the proposed steps before approving — nothing was applied.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: (steps?: PlanStep[]) =>
      intelFetch(`/resolution/plan/${plan!.id}/approve`, {
        method: "POST",
        body: JSON.stringify(steps ? { steps } : {}),
      }),
    onSuccess: () => {
      setEditing(false);
      invalidate();
      toast({
        title: "Plan approved",
        description: "The plan is ready to execute when you are.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: () =>
      intelFetch(`/resolution/plan/${plan!.id}/reject`, {
        method: "POST",
        body: JSON.stringify(rejectNote.trim() ? { note: rejectNote.trim() } : {}),
      }),
    onSuccess: () => {
      setRejectOpen(false);
      setRejectNote("");
      invalidate();
      toast({ title: "Plan rejected", description: "No actions were applied." });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const execute = useMutation({
    mutationFn: () =>
      intelFetch<{ ok: boolean; execution_log?: string }>(
        `/resolution/plan/${plan!.id}/execute`,
        { method: "POST" },
      ),
    onSuccess: () => {
      setExecuteOpen(false);
      invalidate();
      toast({
        title: "Plan executed",
        description: "Approved actions have been applied to the ticket.",
      });
    },
    onError: (e: Error) => {
      setExecuteOpen(false);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const onEditStep = (i: number, field: "step" | "detail", value: string) => {
    setEditedSteps((prev) =>
      prev.map((s, j) => (j === i ? { ...s, [field]: value } : s)),
    );
  };

  const startEditing = () => {
    if (plan) setEditedSteps(plan.steps.map((s) => ({ ...s })));
    setEditing(true);
  };

  const highRisk = plan?.requires_approval || plan?.risk_level === "high";
  const canExecute = plan?.status === "approved";
  const needsApprovalDialog = highRisk && canExecute;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Resolution Plan
            </CardTitle>
            <CardDescription className="text-xs">
              AI-proposed steps for this ticket — always human-approved.
            </CardDescription>
          </div>
          {plan && (
            <div className="flex gap-1.5 flex-wrap">
              <Badge className={cn("border capitalize", statusStyles[plan.status])}>
                {plan.status}
              </Badge>
              {plan.risk_level && (
                <Badge
                  className={cn(
                    "border capitalize",
                    riskStyles[plan.risk_level] ?? riskStyles.low,
                  )}
                >
                  {plan.risk_level} risk
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : query.isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {(query.error as Error).message}
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
            </Button>
          </div>
        ) : !plan ? (
          <div className="text-center py-4 space-y-3">
            <FileText className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">
              No resolution plan yet. Generate one to get AI-suggested steps
              based on this ticket and similar past resolutions.
            </p>
            <Button
              size="sm"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {generate.isPending ? "Generating…" : "Generate plan"}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                Confidence{" "}
                <strong className="text-foreground">
                  {Math.round((plan.confidence ?? 0) * 100)}%
                </strong>
              </span>
              {plan.recommended_action && (
                <span className="truncate">
                  · Recommended:{" "}
                  <span className="text-foreground font-medium">
                    {plan.recommended_action}
                  </span>
                </span>
              )}
            </div>

            <StepList
              steps={plan.steps ?? []}
              editing={editing}
              editedSteps={editedSteps}
              onEditStep={onEditStep}
            />

            {!!plan.sources?.length && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Sources
                </p>
                <ul className="space-y-1">
                  {plan.sources.map((src, i) => (
                    <li key={i} className="text-sm flex items-center gap-2">
                      <Ticket className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {src.type === "ticket" ? (
                        <Link
                          href={`/tickets/${src.id}`}
                          className="text-primary hover:underline truncate"
                        >
                          {src.title || `Ticket #${src.id}`}
                        </Link>
                      ) : (
                        <span className="truncate text-foreground/80">
                          {src.title}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {plan.status === "proposed" && (
                <>
                  {editing ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => approve.mutate(editedSteps)}
                        disabled={approve.isPending}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                        {approve.isPending ? "Approving…" : "Approve edited plan"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(false)}
                      >
                        Cancel edit
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        onClick={() => approve.mutate(undefined)}
                        disabled={approve.isPending}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                        {approve.isPending ? "Approving…" : "Approve"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={startEditing}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => setRejectOpen(true)}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1.5" />
                        Reject
                      </Button>
                    </>
                  )}
                </>
              )}
              {plan.status === "approved" && (
                <Button
                  size="sm"
                  onClick={() =>
                    needsApprovalDialog ? setExecuteOpen(true) : execute.mutate()
                  }
                  disabled={execute.isPending}
                >
                  {execute.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {execute.isPending ? "Executing…" : "Execute plan"}
                </Button>
              )}
              {plan.status === "approved" && highRisk && (
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  High-risk plan — execution will ask for confirmation.
                </span>
              )}
              {(plan.status === "rejected" || plan.status === "executed") && (
                <span className="text-xs text-muted-foreground">
                  {plan.status === "rejected"
                    ? "This plan was rejected — no actions were applied."
                    : `Executed${plan.updated_at ? ` ${formatDateTime(plan.updated_at)}` : ""}.`}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-muted-foreground"
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                title="Generate a fresh plan"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Regenerate
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Created {formatDateTime(plan.created_at)}
              {plan.updated_at ? ` · updated ${formatDateTime(plan.updated_at)}` : ""}
            </p>
          </>
        )}
      </CardContent>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject this plan?</DialogTitle>
            <DialogDescription>
              The plan will be discarded and no actions will be applied.
              Optionally leave a note for the record.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection (optional)"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => reject.mutate()}
              disabled={reject.isPending}
            >
              {reject.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Reject plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* High-risk execute confirmation */}
      <AlertDialog open={executeOpen} onOpenChange={setExecuteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              Execute this plan?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will apply{" "}
              <strong>{plan?.steps?.length ?? 0} actions</strong> to the ticket.
              This plan is flagged{" "}
              {plan?.requires_approval ? "as requiring approval" : "as high risk"}
              — continue only if you have reviewed every step.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => execute.mutate()}
              disabled={execute.isPending}
            >
              {execute.isPending ? "Executing…" : "Yes, execute"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
