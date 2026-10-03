import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Loader2,
  Wrench,
  Play,
  CheckCircle2,
  XCircle,
  Trash2,
  ShieldAlert,
} from "lucide-react";

async function api(path: string, init?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const r = await fetch("/api" + path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token && token !== "cookie-session"
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...(init?.headers || {}),
    },
  });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(v.error || "Request failed");
  return v;
}

// Mirrors the server allowlist (server/lib/runbook-policy.ts).
const ALLOWED_ACTIONS = ["clear_cache", "restart_service", "scale_up", "notify"];
const RISKS = ["low", "medium", "high", "critical"];

interface Step {
  action: string;
  params: Record<string, unknown>;
  risk: string;
}
interface Runbook {
  id: number;
  name: string;
  description: string | null;
  steps: Step[];
  maxRisk: string;
  requiresApproval: boolean;
  isActive: boolean;
}
interface Execution {
  id: number;
  runbookId: number;
  runbookName?: string;
  incidentId: number | null;
  status: string;
  stepsLog: { action: string; result: string; at: string; actor: string }[];
  verification: any;
  executedBy: string;
  createdAt: string;
  approvalStatus: string | null;
  approvalComment: string | null;
  approverName: string | null;
  approvalId?: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-sky-100 text-sky-800",
  rejected: "bg-red-100 text-red-800",
  running: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

export default function Runbooks() {
  const { toast } = useToast();
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [pending, setPending] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Runbook | null>(null);
  const [history, setHistory] = useState<Execution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    steps: [{ action: "notify", params: {}, risk: "low" }] as Step[],
    requiresApproval: true,
    isActive: false,
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [rb, pd] = await Promise.all([
        api("/runbooks"),
        api("/runbooks/executions/pending").catch(() => []),
      ]);
      setRunbooks(rb);
      setPending(pd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runbooks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadHistory = async (rb: Runbook) => {
    setSelected(rb);
    setHistoryLoading(true);
    try {
      setHistory(await api(`/runbooks/${rb.id}/executions`));
    } catch (e) {
      toast({ title: "Failed to load history", variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  };

  const addStep = () =>
    setForm({
      ...form,
      steps: [...form.steps, { action: "notify", params: {}, risk: "low" }],
    });

  const updateStep = (i: number, patch: Partial<Step>) =>
    setForm({
      ...form,
      steps: form.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });

  const removeStep = (i: number) =>
    setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) });

  const create = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (form.steps.length === 0) {
      toast({ title: "Add at least one step", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await api("/runbooks", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          steps: form.steps,
          requires_approval: form.requiresApproval,
          is_active: form.isActive,
        }),
      });
      setDialogOpen(false);
      setForm({
        name: "",
        description: "",
        steps: [{ action: "notify", params: {}, risk: "low" }],
        requiresApproval: true,
        isActive: false,
      });
      toast({ title: "Runbook created" });
      load();
    } catch (e) {
      toast({
        title: "Failed to create runbook",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const execute = async (rb: Runbook) => {
    if (!confirm(`Execute runbook "${rb.name}"? High-risk steps require approval.`)) return;
    try {
      const res = await api(`/runbooks/${rb.id}/execute`, { method: "POST" });
      toast({
        title:
          res.status === "pending_approval"
            ? "Approval requested"
            : "Execution completed",
        description: res.reason ?? "",
      });
      load();
      if (selected?.id === rb.id) loadHistory(rb);
    } catch (e) {
      toast({
        title: "Execution failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    }
  };

  const decide = async (execId: number, approve: boolean) => {
    try {
      await api(`/runbooks/executions/${execId}/${approve ? "approve" : "reject"}`, {
        method: "POST",
      });
      toast({ title: approve ? "Execution approved & run" : "Execution rejected" });
      load();
      if (selected) loadHistory(selected);
    } catch (e) {
      toast({
        title: "Decision failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    }
  };

  const remove = async (rb: Runbook) => {
    if (!confirm(`Delete runbook "${rb.name}"?`)) return;
    try {
      await api(`/runbooks/${rb.id}`, { method: "DELETE" });
      toast({ title: "Runbook deleted" });
      if (selected?.id === rb.id) setSelected(null);
      load();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    }
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wrench className="h-6 w-6" /> Self-Healing Runbooks
            </h1>
            <p className="text-sm text-muted-foreground">
              Approved remediation workflows only. Only allowlisted actions can
              run — arbitrary commands are forbidden. High-risk steps always
              require human approval.
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Runbook
          </Button>
        </div>

        {pending.length > 0 && (
          <Card className="border-amber-400">
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                Pending approvals ({pending.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between border rounded-md px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{p.runbookName}</span>
                    <span className="text-muted-foreground ml-2">
                      requested by {p.executedBy} ·{" "}
                      {new Date(p.createdAt).toLocaleString("en-IN")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => decide(p.id, true)}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approve & run
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(p.id, false)}>
                      <XCircle className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading runbooks…
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-destructive mb-4">{error}</p>
              <Button variant="outline" onClick={load}>Try again</Button>
            </CardContent>
          </Card>
        ) : runbooks.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Wrench className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No runbooks yet</p>
              <p className="text-sm">
                Create one to define an approved self-healing workflow.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {runbooks.map((rb) => (
              <Card
                key={rb.id}
                className={selected?.id === rb.id ? "ring-2 ring-primary" : ""}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{rb.name}</span>
                    <Badge variant={rb.isActive ? "default" : "secondary"}>
                      {rb.isActive ? "active" : "inactive"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {rb.description && (
                    <p className="text-sm text-muted-foreground">{rb.description}</p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="outline">max risk: {rb.maxRisk}</Badge>
                    <Badge variant="outline">
                      {rb.requiresApproval ? "approval required" : "no approval"}
                    </Badge>
                    <Badge variant="outline">{rb.steps.length} step(s)</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {rb.steps.map((s, i) => (
                      <span key={i} className="mr-2">
                        {i + 1}. <code>{s.action}</code> ({s.risk})
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => loadHistory(rb)}>
                      History
                    </Button>
                    <Button size="sm" onClick={() => execute(rb)} disabled={!rb.isActive}>
                      <Play className="h-4 w-4 mr-1" /> Execute
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(rb)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {!rb.isActive && (
                    <p className="text-xs text-amber-600">
                      Inactive runbooks cannot execute — activate via edit (admin).
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {selected && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Execution history — {selected.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No executions yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {history.map((h) => (
                    <div key={h.id} className="border rounded-md p-3 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={STATUS_COLORS[h.status] ?? ""}>{h.status}</Badge>
                        {h.approvalStatus && (
                          <Badge variant="outline">
                            approval: {h.approvalStatus}
                            {h.approverName ? ` by ${h.approverName}` : ""}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {h.executedBy} · {new Date(h.createdAt).toLocaleString("en-IN")}
                        </span>
                      </div>
                      {h.stepsLog?.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs">
                          {h.stepsLog.map((s, i) => (
                            <li key={i} className="flex gap-2">
                              <code className="font-mono">{s.action}</code>
                              <span className="text-muted-foreground">{s.result}</span>
                              <span className="text-muted-foreground ml-auto">
                                {new Date(s.at).toLocaleTimeString("en-IN")} · {s.actor}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {h.verification && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Verification: {h.verification.note ?? JSON.stringify(h.verification)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Builder dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Runbook</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Disk usage remediation"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">
                  Steps (allowlisted actions only)
                </label>
                <Button size="sm" variant="outline" onClick={addStep}>
                  <Plus className="h-3 w-3 mr-1" /> Add step
                </Button>
              </div>
              <div className="space-y-2">
                {form.steps.map((s, i) => (
                  <div key={i} className="flex gap-2 items-center border rounded-md p-2">
                    <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                    <Select
                      value={s.action}
                      onValueChange={(v) => updateStep(i, { action: v })}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALLOWED_ACTIONS.map((a) => (
                          <SelectItem key={a} value={a}>
                            {a}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={s.risk}
                      onValueChange={(v) => updateStep(i, { risk: v })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RISKS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => removeStep(i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                high/critical risk steps always require human approval — this is
                enforced server-side and cannot be disabled.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.requiresApproval}
                onCheckedChange={(c) => setForm({ ...form, requiresApproval: !!c })}
              />
              Require approval before execution
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(c) => setForm({ ...form, isActive: !!c })}
              />
              Activate immediately (explicit opt-in)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create runbook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
