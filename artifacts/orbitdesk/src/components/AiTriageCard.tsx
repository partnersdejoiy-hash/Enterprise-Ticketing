/**
 * AI Triage Card (Superpower #20).
 * Shows the autonomous triage result: intent, category, priority
 * RECOMMENDATION (never auto-applied), confidence, security risk.
 * Staff can override via the edit dialog — the human decision is recorded.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  fetchTriage,
  runTriage,
  overrideTriageApi,
  type Triage,
} from "@/lib/intelligence";
import { Sparkles, ShieldAlert, Pencil, Play } from "lucide-react";

const PRIORITIES = ["low", "medium", "high", "urgent"];
const URGENCIES = ["low", "medium", "high", "critical"];
const IMPACTS = ["individual", "team", "department", "organization"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right">{children}</span>
    </div>
  );
}

export function AiTriageCard({
  ticketId,
  canHandle,
}: {
  ticketId: number;
  canHandle: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["triage", ticketId],
    queryFn: () => fetchTriage(ticketId),
    retry: false,
  });
  const triage: Triage | null = query.data?.triage ?? null;

  const runMutation = useMutation({
    mutationFn: () => runTriage(ticketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["triage", ticketId] });
      toast({ title: "Triage complete" });
    },
    onError: (e: Error) =>
      toast({ title: "Triage failed", description: e.message, variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: () =>
      overrideTriageApi(
        triage!.id,
        Object.fromEntries(
          Object.entries(form).filter(([, v]) => v !== ""),
        ),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["triage", ticketId] });
      setOverrideOpen(false);
      toast({ title: "Triage overridden — your decision recorded" });
    },
    onError: (e: Error) =>
      toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  const openOverride = () => {
    setForm({
      category: triage?.category ?? "",
      priority_recommendation: triage?.priorityRecommendation ?? "",
      urgency: triage?.urgency ?? "",
      impact: triage?.impact ?? "",
      sentiment: triage?.sentiment ?? "",
    });
    setOverrideOpen(true);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-violet-600" /> AI Triage
        </h3>
        {triage?.overridden && (
          <Badge variant="outline" className="text-xs">
            Human override
          </Badge>
        )}
      </div>

      {query.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-2 w-full" />
        </div>
      )}

      {query.isError && (
        <div className="text-sm text-muted-foreground space-y-3">
          <p>No triage yet for this ticket.</p>
          {canHandle && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={runMutation.isPending}
              onClick={() => runMutation.mutate()}
            >
              <Play className="h-3.5 w-3.5 mr-1.5" />
              {runMutation.isPending ? "Analyzing…" : "Run AI Triage"}
            </Button>
          )}
        </div>
      )}

      {triage && (
        <div className="space-y-1">
          <Field label="Intent">
            {triage.intent ?? <span className="text-muted-foreground">—</span>}
          </Field>
          <Field label="Category">
            {triage.category ?? <span className="text-muted-foreground">—</span>}
            {triage.subcategory ? ` · ${triage.subcategory}` : ""}
          </Field>
          <Field label="Priority (recommended)">
            {triage.priorityRecommendation ? (
              <Badge
                variant="outline"
                className={
                  triage.priorityRecommendation === "urgent"
                    ? "border-red-300 text-red-700"
                    : triage.priorityRecommendation === "high"
                      ? "border-orange-300 text-orange-700"
                      : ""
                }
              >
                {triage.priorityRecommendation}
              </Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <div className="pt-1">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Confidence</span>
              <span>{triage.confidence ?? "?"}%</span>
            </div>
            <Progress value={triage.confidence ?? 0} className="h-1.5" />
          </div>
          {triage.securityRisk && triage.securityRisk !== "none" && (
            <div className="flex items-center gap-1.5 pt-1 text-xs text-amber-700">
              <ShieldAlert className="h-3.5 w-3.5" />
              Security risk: {triage.securityRisk}
            </div>
          )}
          {triage.skillsRequired.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {triage.skillsRequired.map((s) => (
                <Badge key={s} variant="secondary" className="text-xs">
                  {s}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground pt-2">
            Recommendation only — nothing was changed automatically.
          </p>
          {canHandle && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full mt-1"
              onClick={openOverride}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Override triage
            </Button>
          )}
        </div>
      )}

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override AI triage</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Category</Label>
              <Input
                value={form.category ?? ""}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. network"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Priority recommendation</Label>
                <Select
                  value={form.priority_recommendation ?? ""}
                  onValueChange={(v) =>
                    setForm({ ...form, priority_recommendation: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Urgency</Label>
                <Select
                  value={form.urgency ?? ""}
                  onValueChange={(v) => setForm({ ...form, urgency: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {URGENCIES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Impact</Label>
              <Select
                value={form.impact ?? ""}
                onValueChange={(v) => setForm({ ...form, impact: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {IMPACTS.map((i) => (
                    <SelectItem key={i} value={i}>
                      {i}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={overrideMutation.isPending}
              onClick={() => overrideMutation.mutate()}
            >
              {overrideMutation.isPending ? "Saving…" : "Save override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
