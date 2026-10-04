// Change Management page — list, create, detail with impact analysis + approvals.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { intelFetch, formatDateTime } from "@/lib/intel";
import ImpactAnalysis from "@/components/ImpactAnalysis";

interface Change {
  id: number;
  change_number: string;
  title: string;
  description: string | null;
  change_type: string;
  risk: string;
  status: string;
  scheduled_start: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-emerald-100 text-emerald-800",
  scheduled: "bg-blue-100 text-blue-800",
  implementing: "bg-violet-100 text-violet-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  rolled_back: "bg-orange-100 text-orange-800",
};

export default function Changes() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Change | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", change_type: "standard", risk: "medium", rollback_plan: "" });

  const { data, isLoading, refetch } = useQuery<{ changes: Change[] }>({
    queryKey: ["changes"],
    queryFn: () => intelFetch<{ changes: Change[] }>("/changes"),
  });

  const create = useMutation({
    mutationFn: () => intelFetch("/changes", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      setCreateOpen(false);
      setForm({ title: "", description: "", change_type: "standard", risk: "medium", rollback_plan: "" });
      queryClient.invalidateQueries({ queryKey: ["changes"] });
      toast({ title: "Change created" });
    },
    onError: (e) => toast({ title: "Failed", description: String(e), variant: "destructive" }),
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "reject" }) =>
      intelFetch(`/changes/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["changes"] });
      setSelected(null);
      toast({ title: "Decision recorded" });
    },
    onError: (e) => toast({ title: "Failed", description: String(e), variant: "destructive" }),
  });

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Changes</h1>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="ml-auto"><Plus className="h-3.5 w-3.5 mr-1" /> New Change</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>New Change Request</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <Textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                <div className="flex gap-2">
                  <Select value={form.change_type} onValueChange={(v) => setForm({ ...form, change_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="emergency">Emergency</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={form.risk} onValueChange={(v) => setForm({ ...form, risk: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low risk</SelectItem>
                      <SelectItem value="medium">Medium risk</SelectItem>
                      <SelectItem value="high">High risk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Textarea placeholder="Rollback plan" value={form.rollback_plan} onChange={(e) => setForm({ ...form, rollback_plan: e.target.value })} />
                <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending || form.title.trim().length < 3}>
                  {create.isPending ? "Creating…" : "Create Change"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading && <Skeleton className="h-48 w-full" />}
        {data && data.changes.length === 0 && (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No changes yet. Create the first change request to get started.
          </CardContent></Card>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data?.changes.map((c) => (
            <Card key={c.id} className="cursor-pointer hover:shadow-sm" onClick={() => setSelected(c)}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-[11px] text-muted-foreground">{c.change_number}</span>
                  <Badge variant="outline" className={STATUS_STYLES[c.status] ?? ""}>{c.status.replace(/_/g, " ")}</Badge>
                  <Badge variant="outline" className="ml-auto text-[10px]">{c.change_type}</Badge>
                </div>
                <p className="font-medium text-sm">{c.title}</p>
                <p className="text-xs text-muted-foreground mt-1">Created {formatDateTime(c.created_at)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Dialog open={selected != null} onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
            {selected && (
              <>
                <DialogHeader>
                  <DialogTitle className="text-base">{selected.title}</DialogTitle>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="outline" className={STATUS_STYLES[selected.status] ?? ""}>{selected.status.replace(/_/g, " ")}</Badge>
                    <span className="font-mono text-[11px] text-muted-foreground">{selected.change_number}</span>
                  </div>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  {selected.description && <p className="text-sm whitespace-pre-wrap">{selected.description}</p>}
                  <ImpactAnalysis changeId={selected.id} />
                  {(selected.status === "draft" || selected.status === "pending_approval") && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => decide.mutate({ id: selected.id, action: "approve" })} disabled={decide.isPending}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => decide.mutate({ id: selected.id, action: "reject" })} disabled={decide.isPending}>
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">Approval requires a human decision. Impact analysis is advisory only.</p>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
