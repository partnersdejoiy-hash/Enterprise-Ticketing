import { useEffect, useState } from "react";
import { Bot, Activity, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuthStore } from "@/lib/auth";
type Worker = {
  id: number;
  department: string | null;
  kind: "pa" | "triage" | "draft";
  name: string;
  enabled: boolean;
};
type Config = {
  enabled: boolean;
  provider: "openrouter" | "ollama";
  model: string;
  dailyLimit: number;
};
type Report = {
  id: number;
  name: string;
  open_tickets: number;
  unassigned: number;
  sla_breached: number;
  enabled_workers: number;
  drafts: number;
  failed_jobs: number;
};
type Workforce = {
  config: Config;
  configured: boolean;
  workers: Worker[];
  requestsToday: number;
  report: Report[];
};
async function api(path: string, body?: unknown, method = "POST") {
  const r = await fetch("/api/ai/" + path, {
    method: body === undefined ? "GET" : method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error || "Request failed");
  return v;
}
const roles = {
  triage: "Triage & review",
  draft: "Response drafting",
  pa: "Your personal assistant",
};
function WorkerCard({
  worker,
  editable,
  configured,
  onSaved,
}: {
  worker: Worker;
  editable: boolean;
  configured: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(worker.name),
    [enabled, setEnabled] = useState(worker.enabled),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    setName(worker.name);
    setEnabled(worker.enabled);
  }, [worker.name, worker.enabled]);
  const dirty = name !== worker.name || enabled !== worker.enabled;
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex gap-3 items-start">
        <Bot className="h-5 w-5 text-primary mt-1" />
        <div className="flex-1">
          <h4 className="font-semibold">
            {worker.name || "Name awaiting your choice"}
          </h4>
          <p className="text-xs text-muted-foreground">
            {roles[worker.kind]} · AI worker
          </p>
        </div>
        <span className="text-xs rounded-full border px-2 py-1">
          {!worker.enabled
            ? "Disabled"
            : configured
              ? "Enabled"
              : "Setup required"}
        </span>
      </div>
      <label className="block text-sm space-y-2">
        <span>Name</span>
        <Input
          aria-label={`${roles[worker.kind]} name for ${worker.department || "superadmin"}`}
          placeholder="Choose a name"
          value={name}
          maxLength={80}
          disabled={!editable || busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex justify-between text-sm">
        <span>Enable this AI worker</span>
        <Switch
          checked={enabled}
          disabled={!editable || busy}
          onCheckedChange={setEnabled}
          aria-label={`Enable ${roles[worker.kind]} for ${worker.department || "superadmin"}`}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!editable || !dirty || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("workers/" + worker.id, { name, enabled }, "PUT");
              setMessage("Saved");
              onSaved();
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save worker
        </Button>
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setName(worker.name);
              setEnabled(worker.enabled);
            }}
          >
            Discard
          </Button>
        )}
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
export function AiWorkforcePanel() {
  const editable = useAuthStore((s) => s.user?.role) === "super_admin";
  const [data, setData] = useState<Workforce | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [brief, setBrief] = useState("");
  async function load(resetConfig = false) {
    try {
      const v = await api("workforce");
      setData(v);
      setConfig((previous) => (resetConfig || !previous ? v.config : previous));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data || !config)
    return <p role="status">{message || "Loading AI workforce…"}</p>;
  const active = data.config.enabled && data.configured,
    dirty = JSON.stringify(config) !== JSON.stringify(data.config);
  const departments = [
    ...new Set(
      data.workers.filter((w) => w.kind !== "pa").map((w) => w.department),
    ),
  ];
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-6 space-y-3">
        <span className="text-xs uppercase tracking-widest text-primary">
          OrbitDesk AI workforce
        </span>
        <h2 className="text-2xl font-semibold">
          Your team. Your names. Your control.
        </h2>
        <p className="text-sm text-muted-foreground">
          Two AI workers per department, coordinated through your personal
          assistant's workload report. Drafts stay in a private review queue.
          Human owners retain approvals and outgoing replies.
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="flex gap-2 items-center">
            <Activity className="w-4 h-4" />
            {active ? "Server AI enabled" : "Setup required / paused"}
          </span>
          <span>
            {data.workers.filter((w) => w.kind !== "pa").length} department
            workers + 1 PA
          </span>
          <span>
            {data.requestsToday}/{data.config.dailyLimit} requests today (UTC)
          </span>
        </div>
      </div>
      <section className="rounded-xl border p-5 space-y-4">
        <h3 className="font-semibold">Provider & spending protection</h3>
        <p className="text-sm text-muted-foreground">
          OpenRouter uses free variants only, with no paid fallback. Free
          capacity is shared and can be rate limited. Ollama needs your own
          continuously running HTTPS server. This app does not host an LLM on
          Vercel.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm space-y-2">
            <span>Provider</span>
            <select
              className="w-full rounded-md border bg-background p-2"
              value={config.provider}
              disabled={!editable || busy}
              onChange={(e) =>
                setConfig({
                  ...config,
                  provider: e.target.value as Config["provider"],
                  model:
                    e.target.value === "openrouter"
                      ? "qwen/qwen3.8-27b:free"
                      : "qwen3:8b",
                  enabled: false,
                })
              }
            >
              <option value="openrouter">OpenRouter · free models only</option>
              <option value="ollama">Self-hosted Ollama</option>
            </select>
          </label>
          <label className="text-sm space-y-2">
            <span>Model ID</span>
            <Input
              value={config.model}
              disabled={!editable || busy}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-2">
            <span>Daily request cap (shared by all workers)</span>
            <Input
              type="number"
              min={1}
              max={50}
              value={config.dailyLimit}
              disabled={!editable || busy}
              onChange={(e) =>
                setConfig({ ...config, dailyLimit: Number(e.target.value) })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>Enable server AI</span>
            <Switch
              checked={config.enabled}
              disabled={!editable || busy}
              onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {config.provider === "openrouter"
            ? "Set OPENROUTER_API_KEY as a sensitive server environment variable in Vercel, then redeploy."
            : "Set ORBIT_OLLAMA_URL (ending /v1) and ORBIT_OLLAMA_TOKEN in Vercel, then redeploy."}{" "}
          Never enter keys into chat. Run a connection test before enabling.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            disabled={!editable || busy}
            onClick={() =>
              action(async () => {
                await api("test", config);
                setMessage("Connection verified. You can enable AI and save.");
              })
            }
          >
            Test connection
          </Button>
          <Button
            disabled={!editable || busy || !dirty}
            onClick={() =>
              action(async () => {
                await api("config", config, "PUT");
                await load(true);
                setMessage(
                  "Configuration saved. Pending jobs from the previous configuration were cancelled.",
                );
              })
            }
          >
            Save AI settings
          </Button>
          <Button
            variant="ghost"
            disabled={!dirty || busy}
            onClick={() => setConfig(data.config)}
          >
            Discard
          </Button>
        </div>
        <p role="status" className="text-sm">
          {message}
        </p>
      </section>
      <section className="space-y-4">
        <h3 className="text-lg font-semibold">
          Personal assistant · reports to superadmin
        </h3>
        {data.workers
          .filter((w) => w.kind === "pa")
          .map((w) => (
            <WorkerCard
              key={w.id}
              worker={w}
              editable={editable}
              configured={active}
              onSaved={() => void load()}
            />
          ))}
        <div className="flex gap-2">
          <Button
            disabled={!editable || busy || !active}
            onClick={() =>
              action(async () => {
                const r = await api("pa/report", {});
                setBrief(r.text);
              })
            }
          >
            Generate PA briefing
          </Button>
          <Button
            variant="outline"
            disabled={!editable || busy || !active}
            onClick={() =>
              action(async () => {
                const r = await api("queue/run", {});
                await load();
                setMessage(`Processed ${r.processed} pending jobs.`);
              })
            }
          >
            Process pending work
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void load()}>
            Refresh report
          </Button>
        </div>
        {brief && (
          <div className="rounded-xl border p-5 whitespace-pre-wrap text-sm">
            <p className="font-semibold mb-3">
              AI briefing · review recommended
            </p>
            {brief}
          </div>
        )}
        <div className="overflow-x-auto border rounded-xl">
          <table className="w-full text-sm">
            <caption className="text-left p-3 text-muted-foreground">
              Live counts from OrbitDesk. This factual report works without an
              LLM.
            </caption>
            <thead>
              <tr className="bg-muted/40">
                {[
                  "Department",
                  "Open",
                  "Unassigned",
                  "SLA breached",
                  "AI drafts",
                  "AI failures",
                ].map((h) => (
                  <th key={h} className="p-3 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.report.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{r.name}</td>
                  {[
                    r.open_tickets,
                    r.unassigned,
                    r.sla_breached,
                    r.drafts,
                    r.failed_jobs,
                  ].map((n, i) => (
                    <td className="p-3" key={i}>
                      {n}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {departments.map((dept) => (
        <section key={dept} className="space-y-3">
          <h3 className="text-lg font-semibold">{dept}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {data.workers
              .filter((w) => w.department === dept)
              .map((w) => (
                <WorkerCard
                  key={w.id}
                  worker={w}
                  editable={editable}
                  configured={active}
                  onSaved={() => void load()}
                />
              ))}
          </div>
        </section>
      ))}
      <p className="text-xs flex gap-2 text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        Workers have no employee login or independent approval authority.
        Automatic drafts use department, status, priority and SLA flags only.
        Queue execution runs on ticket events; paused/failed work can be retried
        here. No scheduled background service is configured.
      </p>
    </div>
  );
}
export function TicketAiDrafts({ ticketId }: { ticketId: number }) {
  const [rows, setRows] = useState<
      Array<{
        id: number;
        name: string;
        kind: string;
        status: string;
        output: string;
        error: string;
        created_at: string;
      }>
    >([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setRows(await api("tickets/" + ticketId));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [ticketId]);
  return (
    <section className="rounded-xl border p-4 space-y-3">
      <div className="flex gap-3 justify-between items-center">
        <h3 className="font-semibold flex gap-2 items-center">
          <Bot className="h-4 w-4" />
          AI review workspace
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              await api(`tickets/${ticketId}/run`, {});
              await load();
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : "Run assistants"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Private staff drafts based on workflow metadata. Review against the
        actual request before using. Nothing is sent automatically.
      </p>
      <p role="status" className="text-sm">
        {message}
      </p>
      {rows.map((r) => (
        <div key={r.id} className="border rounded-lg p-3 text-sm">
          <div className="font-medium">
            {r.name || r.kind} · {r.status}
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(r.created_at).toLocaleString()}
          </p>
          <p className="whitespace-pre-wrap mt-2">
            {r.output || r.error || "Waiting for a worker."}
          </p>
        </div>
      ))}
    </section>
  );
}
