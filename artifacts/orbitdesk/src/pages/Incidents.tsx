import { useEffect, useState } from "react";
import { useLocation } from "wouter";
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
  AlertTriangle,
  Radio,
  CheckCircle2,
  Clock,
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

interface Incident {
  id: number;
  incidentNumber: string;
  title: string;
  severity: string;
  status: string;
  isMajor: boolean;
  startedAt: string;
  resolvedAt: string | null;
  postmortemStatus: string;
  commanderName: string | null;
  activeRooms: number;
}

const SEV_COLORS: Record<string, string> = {
  critical: "bg-red-600",
  high: "bg-orange-500",
  medium: "bg-amber-400",
  low: "bg-sky-500",
};
const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-800",
  investigating: "bg-amber-100 text-amber-800",
  mitigated: "bg-sky-100 text-sky-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-zinc-100 text-zinc-600",
};

export default function Incidents() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    severity: "medium",
    isMajor: false,
  });
  const [checklist, setChecklist] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const q = filter === "major" ? "?is_major=true" : filter === "open" ? "?status=open" : "";
      const data = await api("/incidents" + q);
      setIncidents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const create = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await api("/incidents", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          severity: form.severity,
          is_major: form.isMajor,
        }),
      });
      setDialogOpen(false);
      setForm({ title: "", description: "", severity: "medium", isMajor: false });
      if (res.autoCommand) setChecklist(res.autoCommand);
      toast({ title: `Incident ${res.incidentNumber} created` });
      load();
    } catch (e) {
      toast({
        title: "Failed to create incident",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="h-6 w-6" /> Incidents
            </h1>
            <p className="text-sm text-muted-foreground">
              Major incident management, swarm command rooms, and post-incident reviews.
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Incident
          </Button>
        </div>

        <div className="flex gap-2">
          {["all", "open", "major"].map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "open" ? "Open" : "Major only"}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading incidents…
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-destructive mb-4">{error}</p>
              <Button variant="outline" onClick={load}>Try again</Button>
            </CardContent>
          </Card>
        ) : incidents.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <AlertTriangle className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No incidents found</p>
              <p className="text-sm">Create one to start an incident command room.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {incidents.map((inc) => (
              <Card key={inc.id} className="hover:shadow-md transition-shadow">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">
                          {inc.incidentNumber}
                        </span>
                        {inc.isMajor && (
                          <Badge variant="destructive">
                            <Radio className="h-3 w-3 mr-1" /> MAJOR
                          </Badge>
                        )}
                        <Badge className={SEV_COLORS[inc.severity] ?? "bg-zinc-400"}>
                          {inc.severity}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={STATUS_COLORS[inc.status] ?? ""}
                        >
                          {inc.status}
                        </Badge>
                        {inc.postmortemStatus === "draft" && (
                          <Badge variant="outline" className="border-amber-400 text-amber-700">
                            <Clock className="h-3 w-3 mr-1" /> Postmortem draft
                          </Badge>
                        )}
                        {inc.postmortemStatus === "approved" && (
                          <Badge variant="outline" className="border-emerald-400 text-emerald-700">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Postmortem done
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-semibold mt-1 truncate">{inc.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {inc.commanderName ? `Commander: ${inc.commanderName} · ` : ""}
                        Started {new Date(inc.startedAt).toLocaleString("en-IN")}
                        {inc.activeRooms > 0 && ` · ${inc.activeRooms} active swarm room(s)`}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation(`/incidents/${inc.id}`)}
                    >
                      Open
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Incident</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. VPN outage — Mumbai office"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder="What is happening? Who is affected?"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Severity</label>
              <Select
                value={form.severity}
                onValueChange={(v) => setForm({ ...form, severity: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isMajor}
                onCheckedChange={(c) => setForm({ ...form, isMajor: !!c })}
              />
              <span className="font-medium">Major incident</span>
              <span className="text-muted-foreground">
                — auto-prepares command room, commander, stakeholders
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create incident
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auto-command checklist dialog */}
      <Dialog open={!!checklist} onOpenChange={() => setChecklist(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Major Incident Auto-Command Checklist
            </DialogTitle>
          </DialogHeader>
          {checklist && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-medium mb-1">Incident Commander</p>
                <p className="text-muted-foreground">
                  {checklist.commander
                    ? `${checklist.commander.name} (${checklist.commander.email})`
                    : "No manager found — assign manually"}
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">
                  Stakeholders ({checklist.stakeholders?.length ?? 0})
                </p>
                <p className="text-muted-foreground">
                  {checklist.stakeholders?.slice(0, 8).map((s: any) => s.name).join(", ")}
                  {(checklist.stakeholders?.length ?? 0) > 8 && "…"}
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">
                  Related tickets ({checklist.relatedTickets?.length ?? 0})
                </p>
                <ul className="list-disc list-inside text-muted-foreground">
                  {checklist.relatedTickets?.slice(0, 5).map((t: any) => (
                    <li key={t.id}>
                      <span className="font-mono">{t.ticketNumber}</span> — {t.subject}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium mb-1">Communication templates</p>
                {checklist.commsTemplates?.map((c: any, i: number) => (
                  <Card key={i} className="mb-2">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-sm">{c.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      <p className="font-medium text-xs">{c.subject}</p>
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap mt-1">
                        {c.body}
                      </pre>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                const roomId = checklist?.roomId;
                setChecklist(null);
                if (roomId) setLocation(`/swarm/${roomId}`);
              }}
            >
              Open Swarm Room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
