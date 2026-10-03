import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Info,
  Ban,
  Trash2,
  Link2,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

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

interface MonitoringEvent {
  id: number;
  source: string;
  fingerprint: string;
  severity: "critical" | "high" | "warning" | "info";
  title: string;
  message: string | null;
  serviceName: string | null;
  host: string | null;
  status: string;
  incidentId: number | null;
  ticketId: number | null;
  dedupCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  incidentNumber: string | null;
  ticketNumber: string | null;
}

interface ApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

const severityConfig: Record<string, { label: string; color: string }> = {
  critical: { label: "Critical", color: "bg-red-100 text-red-700 border-red-200" },
  high: { label: "High", color: "bg-orange-100 text-orange-700 border-orange-200" },
  warning: { label: "Warning", color: "bg-amber-100 text-amber-700 border-amber-200" },
  info: { label: "Info", color: "bg-blue-100 text-blue-700 border-blue-200" },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "bg-blue-50 text-blue-600 border-blue-200" },
  correlated: { label: "Correlated", color: "bg-purple-50 text-purple-600 border-purple-200" },
  incident_created: { label: "Incident created", color: "bg-red-50 text-red-600 border-red-200" },
  suppressed: { label: "Suppressed", color: "bg-gray-100 text-gray-500 border-gray-200" },
  resolved: { label: "Resolved", color: "bg-green-50 text-green-600 border-green-200" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const c = severityConfig[severity] ?? { label: severity, color: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${c.color}`}>
      {c.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c = statusConfig[status] ?? { label: status, color: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c.color}`}>
      {c.label}
    </span>
  );
}

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ADMIN_ROLES = ["super_admin", "admin"];

export default function Monitoring() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = ADMIN_ROLES.includes(user?.role ?? "");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [suppressing, setSuppressing] = useState<number | null>(null);

  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (severityFilter !== "all") params.set("severity", severityFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  params.set("limit", "100");

  const eventsQuery = useQuery({
    queryKey: ["monitoring-events", severityFilter, statusFilter],
    queryFn: () =>
      api(`/monitoring/events?${params.toString()}`).then(
        (v) => (v.events ?? []) as MonitoringEvent[],
      ),
  });

  const keysQuery = useQuery({
    queryKey: ["monitoring-keys"],
    queryFn: () => api("/monitoring/keys").then((v) => (v.keys ?? []) as ApiKey[]),
    enabled: isAdmin,
  });

  async function suppress(id: number) {
    setSuppressing(id);
    try {
      await api(`/monitoring/events/${id}/suppress`, { method: "POST" });
      toast({ title: "Event suppressed", description: `Event #${id} will no longer trigger correlation.` });
      queryClient.invalidateQueries({ queryKey: ["monitoring-events"] });
    } catch (e) {
      toast({ title: "Suppress failed", description: String(e), variant: "destructive" });
    } finally {
      setSuppressing(null);
    }
  }

  async function createKey() {
    const name = newKeyName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Give the key a name (e.g. \"zabbix-prod\").", variant: "destructive" });
      return;
    }
    setCreatingKey(true);
    try {
      const v = await api("/monitoring/keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setFreshKey(v.key);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["monitoring-keys"] });
    } catch (e) {
      toast({ title: "Key creation failed", description: String(e), variant: "destructive" });
    } finally {
      setCreatingKey(false);
    }
  }

  async function revokeKey(id: number) {
    setRevoking(id);
    try {
      await api(`/monitoring/keys/${id}/revoke`, { method: "POST" });
      toast({ title: "Key revoked" });
      queryClient.invalidateQueries({ queryKey: ["monitoring-keys"] });
    } catch (e) {
      toast({ title: "Revoke failed", description: String(e), variant: "destructive" });
    } finally {
      setRevoking(null);
    }
  }

  function copyKey() {
    if (!freshKey) return;
    navigator.clipboard.writeText(freshKey).then(
      () => toast({ title: "Copied to clipboard" }),
      () => toast({ title: "Copy failed", description: "Select the key text and copy manually.", variant: "destructive" }),
    );
  }

  const events = eventsQuery.data ?? [];

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Event intelligence</p>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6" /> Monitoring events
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Deduped alerts, incident correlation, and auto-created incidents &amp; tickets.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              eventsQuery.refetch();
              keysQuery.refetch();
            }}
            className="h-9 px-2.5 text-muted-foreground"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${eventsQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1.5">
            <Label>Severity</Label>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="All severities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="correlated">Correlated</SelectItem>
                <SelectItem value="incident_created">Incident created</SelectItem>
                <SelectItem value="suppressed">Suppressed</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Events table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Events</CardTitle>
            <CardDescription>
              Same fingerprint within 15 minutes is deduped (shown as ×N) instead of creating noise.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {eventsQuery.isError ? (
              <div className="p-6 text-sm text-red-600 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Unable to load monitoring events. The 010 migration may not be applied yet.
              </div>
            ) : eventsQuery.isLoading ? (
              <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading events…
              </div>
            ) : events.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No monitoring events yet. Ingest alerts via{" "}
                <code className="bg-muted px-1 rounded">POST /api/monitoring/events</code>.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Severity</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Event</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide hidden md:table-cell">Source</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide hidden lg:table-cell">Host / Service</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Linked</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide hidden md:table-cell">Last seen</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-3 py-2.5"><SeverityBadge severity={e.severity} /></td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{e.title}</span>
                            {e.dedupCount > 1 && (
                              <Badge variant="outline" title={`${e.dedupCount} occurrences deduped`}>
                                ×{e.dedupCount}
                              </Badge>
                            )}
                          </div>
                          {e.message && (
                            <div className="text-xs text-muted-foreground truncate max-w-[320px]">{e.message}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell text-muted-foreground">{e.source}</td>
                        <td className="px-3 py-2.5 hidden lg:table-cell text-muted-foreground">
                          {[e.host, e.serviceName].filter(Boolean).join(" / ") || "—"}
                        </td>
                        <td className="px-3 py-2.5"><StatusBadge status={e.status} /></td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-1 text-xs">
                            {e.incidentNumber ? (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <ShieldAlert className="h-3 w-3" /> {e.incidentNumber}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                            {e.ticketId && e.ticketNumber ? (
                              <Link href={`/tickets/${e.ticketId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                                <Link2 className="h-3 w-3" /> {e.ticketNumber}
                              </Link>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell text-muted-foreground whitespace-nowrap">
                          {timeAgo(e.lastSeenAt)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {e.status !== "suppressed" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              disabled={suppressing === e.id}
                              onClick={() => suppress(e.id)}
                              title="Suppress this event"
                            >
                              {suppressing === e.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Ban className="h-3.5 w-3.5" />
                              )}
                              Suppress
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* API key management (admin only) */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Ingest API keys
              </CardTitle>
              <CardDescription>
                Monitoring systems use these keys to <code className="bg-muted px-1 rounded">POST /api/monitoring/events</code>.
                Only the key hash is stored — the plaintext key is shown once at creation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {freshKey && (
                <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2 text-amber-800">
                    <AlertTriangle className="h-4 w-4" />
                    Copy this key now — it will never be shown again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-white border rounded px-3 py-2 text-sm font-mono break-all">
                      {freshKey}
                    </code>
                    <Button size="sm" variant="outline" onClick={copyKey}>
                      <Copy className="h-4 w-4 mr-1" /> Copy
                    </Button>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setFreshKey(null)}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> I saved it
                  </Button>
                </div>
              )}

              <div className="flex gap-2 items-end">
                <div className="space-y-1.5 flex-1 max-w-sm">
                  <Label htmlFor="key-name">New key name</Label>
                  <Input
                    id="key-name"
                    placeholder='e.g. "zabbix-prod"'
                    value={newKeyName}
                    onChange={(ev) => setNewKeyName(ev.target.value)}
                    onKeyDown={(ev) => ev.key === "Enter" && createKey()}
                  />
                </div>
                <Button onClick={createKey} disabled={creatingKey}>
                  {creatingKey ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                  Generate key
                </Button>
              </div>

              {keysQuery.isLoading ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading keys…
                </div>
              ) : keysQuery.isError ? (
                <div className="text-sm text-red-600">Unable to load keys — is the 010 migration applied?</div>
              ) : (keysQuery.data ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Info className="h-4 w-4" /> No API keys yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Name</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Prefix</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Last used</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {(keysQuery.data ?? []).map((k) => (
                        <tr key={k.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{k.name}</td>
                          <td className="px-3 py-2"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{k.keyPrefix}…</code></td>
                          <td className="px-3 py-2">
                            {k.isActive ? (
                              <Badge className="bg-green-100 text-green-700 border-green-200">Active</Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">Revoked</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {k.lastUsedAt ? timeAgo(k.lastUsedAt) : "never"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {k.isActive && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                                disabled={revoking === k.id}
                                onClick={() => revokeKey(k.id)}
                              >
                                {revoking === k.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                                Revoke
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
