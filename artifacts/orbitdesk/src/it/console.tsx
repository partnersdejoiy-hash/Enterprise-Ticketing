import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { itApi, send, type Asset, type ItRequest, type Person, type Stage, type Ticket } from "./api";
import { ConsoleLayout, useItSession } from "./ItLayout";
import { roleLabel, useCatalog } from "./portal";
import { Chip, Empty, ErrorNote, ItemIcon, Loading, PageHead, PRIORITY, STAGE, TICKET_STATUS, priorityChip, stageChip, statusChip, when } from "./ui";

/* ── Overview ─────────────────────────────────────────────────────── */

type Overview = {
  tickets: { open: number; unassigned: number; breached: number; resolved7d: number; new7d: number };
  byPriority: Record<string, number>;
  requests: Record<string, number>;
  assets: Record<string, number>;
  incidents: { open: number; major: number };
  problems: { open: number };
  changes: { pending: number; upcoming: number };
  pendingApprovals: number;
};

function Figure({ n, label, href, tone }: { n: number | undefined; label: string; href: string; tone?: string }) {
  return (
    <Link href={href} className={`it-figure ${tone && n ? `is-${tone}` : ""}`}>
      <b>{n ?? "–"}</b>
      <span>{label}</span>
    </Link>
  );
}

export function ConsoleOverview() {
  const { data: session } = useItSession();
  const o = useQuery({ queryKey: ["it", "overview"], queryFn: () => itApi<Overview>("/api/it/overview"), refetchInterval: 60_000 });
  const queue = useQueue({ status: "", priority: "", unassignedOnly: false, search: "" }, 6);
  const d = o.data;
  const maxP = Math.max(1, ...Object.values(d?.byPriority ?? {}));
  return (
    <ConsoleLayout>
      <PageHead title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}${session ? `, ${session.user.name.split(" ")[0]}` : ""}`}>
        Where IT stands right now. Refreshes every minute.
      </PageHead>
      <ErrorNote error={o.error} />
      <div className="it-figures">
        <Figure n={d?.tickets.open} label="Open incidents" href="/it/console/queue" />
        <Figure n={d?.tickets.unassigned} label="Unassigned" href="/it/console/queue?unassigned=1" tone="amber" />
        <Figure n={d?.tickets.breached} label="Past their target" href="/it/console/queue" tone="red" />
        <Figure n={d?.pendingApprovals} label="Awaiting approval" href="/it/console/approvals" tone="amber" />
        <Figure n={(d?.requests.queued ?? 0) + (d?.requests.in_progress ?? 0)} label="Requests to fulfil" href="/it/console/requests" />
        <Figure n={d?.incidents.major} label="Major incidents" href="/it/console/major" tone="red" />
      </div>

      <div className="it-overview-grid">
        <section className="it-panel">
          <h2>Open incidents by priority</h2>
          <ul className="it-bars">
            {(["urgent", "high", "medium", "low"] as const).map((p) => (
              <li key={p}>
                <span>{PRIORITY[p].label}</span>
                <span className="it-bar-track">
                  <span className={`it-bar it-bar-${PRIORITY[p].tone}`} style={{ width: `${((d?.byPriority[p] ?? 0) / maxP) * 100}%` }} />
                </span>
                <b>{d?.byPriority[p] ?? 0}</b>
              </li>
            ))}
          </ul>
          <p className="it-muted mt-4 text-[14px]">
            Last 7 days: {d?.tickets.new7d ?? 0} new, {d?.tickets.resolved7d ?? 0} resolved.
          </p>
        </section>
        <section className="it-panel">
          <h2>Service management</h2>
          <dl className="it-dl it-dl-tight">
            <div><dt>Problems under investigation</dt><dd><Link href="/it/console/problems" className="it-link">{d?.problems.open ?? 0}</Link></dd></div>
            <div><dt>Changes waiting for approval</dt><dd><Link href="/it/console/changes" className="it-link">{d?.changes.pending ?? 0}</Link></dd></div>
            <div><dt>Changes approved or scheduled</dt><dd><Link href="/it/console/changes" className="it-link">{d?.changes.upcoming ?? 0}</Link></dd></div>
            <div><dt>Assets assigned</dt><dd><Link href="/it/console/assets" className="it-link">{d?.assets.assigned ?? 0}</Link></dd></div>
            <div><dt>Assets in stock</dt><dd><Link href="/it/console/assets" className="it-link">{d?.assets.in_stock ?? 0}</Link></dd></div>
            <div><dt>Assets in repair</dt><dd><Link href="/it/console/assets" className="it-link">{d?.assets.in_repair ?? 0}</Link></dd></div>
          </dl>
        </section>
      </div>

      <section className="mt-10">
        <div className="it-section-head">
          <h2>Newest incidents</h2>
          <Link href="/it/console/queue" className="it-link">Whole queue</Link>
        </div>
        <QueueTable tickets={queue.data?.tickets} loading={queue.isLoading} />
      </section>
    </ConsoleLayout>
  );
}

/* ── Incident queue ───────────────────────────────────────────────── */

type QueueFilter = { status: string; priority: string; unassignedOnly: boolean; search: string };

function useQueue(f: QueueFilter, limit = 100) {
  const { data: session } = useItSession();
  return useQuery({
    queryKey: ["it", "queue", f, limit, session?.itDepartmentId],
    enabled: !!session,
    queryFn: () => {
      const p = new URLSearchParams({ limit: String(limit) });
      if (session?.itDepartmentId) p.set("departmentId", String(session.itDepartmentId));
      if (f.status) p.set("status", f.status);
      if (f.priority) p.set("priority", f.priority);
      if (f.search) p.set("search", f.search);
      return itApi<{ tickets: Ticket[]; total: number }>(`/api/tickets?${p}`).then((d) => ({
        ...d,
        tickets: f.unassignedOnly ? d.tickets.filter((t) => !t.assigneeId) : d.tickets,
      }));
    },
  });
}

function QueueTable({ tickets, loading }: { tickets?: Ticket[]; loading: boolean }) {
  if (loading) return <Loading rows={6} />;
  if (!tickets?.length) return <Empty title="The queue is clear">Nothing matches right now.</Empty>;
  return (
    <div className="it-table-wrap">
      <table className="it-table">
        <thead>
          <tr>
            <th>Incident</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Raised by</th>
            <th>Assigned</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} className={t.slaBreached && !["resolved", "closed"].includes(t.status) ? "is-breached" : ""}>
              <td>
                <Link href={`/it/console/queue/${t.id}`} className="it-table-main">
                  <b>{t.subject}</b>
                  <span>{t.ticketNumber.slice(0, 11)} · {t.category ?? "Uncategorised"}{t.subcategory ? ` › ${t.subcategory}` : ""}</span>
                </Link>
              </td>
              <td>{priorityChip(t.priority)}</td>
              <td>{statusChip(t.status)}</td>
              <td>{t.createdByName}</td>
              <td>{t.assigneeName ?? <span className="it-muted">Unassigned</span>}</td>
              <td className="whitespace-nowrap">{when(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConsoleQueue() {
  const params = new URLSearchParams(window.location.search);
  const [f, setF] = useState<QueueFilter>({
    status: "",
    priority: "",
    unassignedOnly: params.get("unassigned") === "1",
    search: params.get("search") ?? "",
  });
  const search = useSearch();
  useEffect(() => {
    const s = new URLSearchParams(search).get("search");
    if (s !== null) setF((f) => ({ ...f, search: s }));
  }, [search]);
  const q = useQueue(f);
  return (
    <ConsoleLayout>
      <PageHead title="Incident queue">Everything reported to IT. Red rows are past their target time.</PageHead>
      <div className="it-filters">
        <select className="it-input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(TICKET_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select className="it-input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Priority">
          <option value="">Any priority</option>
          {Object.entries(PRIORITY).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <label className="it-toggle">
          <input type="checkbox" checked={f.unassignedOnly} onChange={(e) => setF({ ...f, unassignedOnly: e.target.checked })} /> Unassigned only
        </label>
        {f.search && (
          <button type="button" className="it-chip it-chip-accent" onClick={() => setF({ ...f, search: "" })}>
            “{f.search}” <X size={12} />
          </button>
        )}
        <span className="it-muted ml-auto text-[14px]">{q.data?.tickets.length ?? 0} shown</span>
      </div>
      <ErrorNote error={q.error} />
      <QueueTable tickets={q.data?.tickets} loading={q.isLoading} />
    </ConsoleLayout>
  );
}

/* ── Requests (fulfilment) ─────────────────────────────────────────── */

const STAGE_ORDER: Stage[] = ["awaiting_approval", "queued", "in_progress", "done", "rejected", "cancelled"];

export function ConsoleRequests() {
  const [stage, setStage] = useState<Stage | "">("in_progress");
  const q = useQuery({
    queryKey: ["it", "requests", "all"],
    queryFn: () => itApi<{ requests: ItRequest[] }>("/api/it/requests?scope=all").then((d) => d.requests),
  });
  const all = q.data ?? [];
  const shown = stage ? all.filter((r) => r.stage === stage) : all;
  return (
    <ConsoleLayout>
      <PageHead title="Requests">Catalog requests from approval to done. Tick the fulfilment steps as you go; the last one closes the request.</PageHead>
      <div className="it-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={stage === ""} onClick={() => setStage("")}>All <span>{all.length}</span></button>
        {STAGE_ORDER.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={stage === s} onClick={() => setStage(s)}>
            {STAGE[s].label} <span>{all.filter((r) => r.stage === s).length}</span>
          </button>
        ))}
      </div>
      <ErrorNote error={q.error} />
      {q.isLoading ? <Loading /> : shown.length === 0 ? <Empty title="Nothing in this stage" /> : (
        <ul className="it-list">
          {shown.map((r) => (
            <li key={r.id}>
              <Link href={`/it/console/requests/${r.id}`} className="it-list-row">
                <ItemIcon name={r.itemIcon} size={40} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{r.itemName} <span className="it-muted font-normal">for {r.requesterName ?? "—"}</span></b>
                  <span className="it-muted">
                    {r.requestNumber} · {when(r.createdAt)}
                    {r.stage === "awaiting_approval" && r.waitingOn ? ` · waiting on ${roleLabel(r.waitingOn).toLowerCase()}` : ""}
                  </span>
                </span>
                {r.tasksTotal > 0 && r.stage !== "awaiting_approval" && (
                  <span className="it-progress" aria-label={`${r.tasksDone} of ${r.tasksTotal} steps`}>
                    <span style={{ width: `${(r.tasksDone / r.tasksTotal) * 100}%` }} />
                  </span>
                )}
                {stageChip(r.stage)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ConsoleLayout>
  );
}

/* ── Approvals inbox ───────────────────────────────────────────────── */

type InboxRow = { approval_id: number; request_id: number; request_number: string; item_name: string; requester_name: string | null; approver_role: string; step_order: number; step_created_at: string };

export function ConsoleApprovals() {
  const q = useQuery({
    queryKey: ["it", "approvals"],
    queryFn: () => itApi<{ inbox: InboxRow[] }>("/api/catalog/approvals/inbox").then((d) => d.inbox),
  });
  return (
    <ConsoleLayout>
      <PageHead title="Approvals">Requests waiting on you or your role. Open one to approve or reject with a note.</PageHead>
      <ErrorNote error={q.error} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty title="Nothing waiting on you" /> : (
        <ul className="it-list">
          {q.data.map((a) => (
            <li key={a.approval_id}>
              <Link href={`/it/console/requests/${a.request_id}`} className="it-list-row">
                <span className="min-w-0 flex-1">
                  <b className="block">{a.item_name} <span className="it-muted font-normal">for {a.requester_name ?? "—"}</span></b>
                  <span className="it-muted">{a.request_number} · step {a.step_order}: {roleLabel(a.approver_role)} · {when(a.step_created_at)}</span>
                </span>
                <ArrowRight size={16} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ConsoleLayout>
  );
}

/* ── Major incidents ───────────────────────────────────────────────── */

type Incident = { id: number; incidentNumber: string; title: string; severity: string; status: string; isMajor: boolean; startedAt: string; resolvedAt: string | null };
const SEV_TONE: Record<string, string> = { critical: "red", high: "amber", medium: "blue", low: "grey" };
const INC_STATUSES = ["open", "investigating", "mitigated", "resolved", "closed"];

export function ConsoleMajor() {
  const cache = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["it", "incidents"], queryFn: () => itApi<Incident[]>("/api/incidents") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", severity: "high", is_major: true });
  const create = useMutation({
    mutationFn: () => send<{ incidentNumber: string }>("/api/incidents", "POST", { ...form, description: form.description || null }),
    onSuccess: (d) => {
      setOpen(false);
      setForm({ title: "", description: "", severity: "high", is_major: true });
      cache.invalidateQueries({ queryKey: ["it", "incidents"] });
      toast({ title: `${d.incidentNumber} declared`, description: "It now shows on the service status page." });
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: number; status: string }) => send(`/api/incidents/${v.id}`, "PATCH", { status: v.status }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["it", "incidents"] }),
  });
  return (
    <ConsoleLayout>
      <PageHead
        title="Major incidents"
        action={<button type="button" className="it-btn it-btn-primary" onClick={() => setOpen((o) => !o)}><Plus size={16} /> Declare an incident</button>}
      >
        Outages and service-wide problems. Open ones appear on the employee status page.
      </PageHead>
      {open && (
        <form className="it-panel it-inline-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <input className="it-input" required placeholder="What's broken, in one line" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className="it-input min-h-[80px]" placeholder="Impact and what's known so far" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="flex flex-wrap items-center gap-4">
            <select className="it-input w-auto" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} aria-label="Severity">
              {["critical", "high", "medium", "low"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
            <label className="it-toggle"><input type="checkbox" checked={form.is_major} onChange={(e) => setForm({ ...form, is_major: e.target.checked })} /> Major incident</label>
            <ErrorNote error={create.error} />
            <button type="submit" className="it-btn it-btn-primary ml-auto" disabled={create.isPending}>Declare</button>
          </div>
        </form>
      )}
      <ErrorNote error={q.error ?? update.error} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty title="No incidents declared" /> : (
        <ul className="it-list">
          {q.data.map((i) => (
            <li key={i.id} className="it-list-row">
              <span className="min-w-0 flex-1">
                <b className="block">{i.title}</b>
                <span className="it-muted">{i.incidentNumber} · started {when(i.startedAt)}{i.resolvedAt ? ` · resolved ${when(i.resolvedAt)}` : ""}</span>
              </span>
              {i.isMajor && <Chip tone="red">Major</Chip>}
              <Chip tone={SEV_TONE[i.severity] ?? "grey"}>{i.severity}</Chip>
              <select className="it-input w-auto" value={i.status} onChange={(e) => update.mutate({ id: i.id, status: e.target.value })} aria-label={`Status of ${i.incidentNumber}`}>
                {INC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </li>
          ))}
        </ul>
      )}
    </ConsoleLayout>
  );
}

/* ── Problems ──────────────────────────────────────────────────────── */

type Problem = { id: number; number: string; title: string; description: string | null; status: string; rootCause: string | null; workaround: string | null; createdAt: string; createdBy: string | null };
const PROBLEM_LABEL: Record<string, string> = { open: "Open", investigating: "Investigating", known_error: "Known error", resolved: "Resolved", closed: "Closed" };

export function ConsoleProblems() {
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ["it", "problems"], queryFn: () => itApi<{ problems: Problem[] }>("/api/it/problems").then((d) => d.problems) });
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [openId, setOpenId] = useState<number | null>(null);
  const refresh = () => cache.invalidateQueries({ queryKey: ["it", "problems"] });
  const create = useMutation({ mutationFn: () => send("/api/it/problems", "POST", draft), onSuccess: () => { setDraft({ title: "", description: "" }); refresh(); } });
  const save = useMutation({ mutationFn: (v: { id: number } & Record<string, string>) => send(`/api/it/problems/${v.id}`, "PATCH", v), onSuccess: refresh });
  return (
    <ConsoleLayout>
      <PageHead title="Problems">The cause behind repeat incidents. Record a workaround for the queue, then the confirmed root cause.</PageHead>
      <form className="it-panel it-inline-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <input className="it-input" required minLength={3} placeholder="New problem, e.g. VPN drops for Noida users after 6 pm" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <div className="flex gap-3">
          <input className="it-input" placeholder="Which incidents point to it (optional)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <button type="submit" className="it-btn it-btn-primary" disabled={create.isPending}><Plus size={16} /> Log</button>
        </div>
        <ErrorNote error={create.error} />
      </form>
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty title="No problems logged" /> : (
        <ul className="it-list mt-6">
          {q.data.map((p) => (
            <li key={p.id} className="it-problem">
              <button type="button" className="it-list-row w-full text-left" onClick={() => setOpenId(openId === p.id ? null : p.id)} aria-expanded={openId === p.id}>
                <span className="min-w-0 flex-1">
                  <b className="block">{p.title}</b>
                  <span className="it-muted">{p.number} · {when(p.createdAt)}{p.createdBy ? ` · ${p.createdBy}` : ""}</span>
                </span>
                <Chip tone={p.status === "known_error" ? "amber" : ["resolved", "closed"].includes(p.status) ? "green" : "blue"}>{PROBLEM_LABEL[p.status] ?? p.status}</Chip>
              </button>
              {openId === p.id && <ProblemEditor p={p} onSave={(v) => save.mutate({ id: p.id, ...v })} busy={save.isPending} />}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={save.error} />
    </ConsoleLayout>
  );
}

function ProblemEditor({ p, onSave, busy }: { p: Problem; onSave: (v: Record<string, string>) => void; busy: boolean }) {
  const [v, setV] = useState({ status: p.status, workaround: p.workaround ?? "", rootCause: p.rootCause ?? "" });
  return (
    <form className="it-problem-edit" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      {p.description && <p className="it-prose">{p.description}</p>}
      <label className="it-label" htmlFor={`ps-${p.id}`}>Status</label>
      <select id={`ps-${p.id}`} className="it-input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
        {Object.entries(PROBLEM_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <label className="it-label" htmlFor={`pw-${p.id}`}>Workaround the queue can give users</label>
      <textarea id={`pw-${p.id}`} className="it-input min-h-[72px]" value={v.workaround} onChange={(e) => setV({ ...v, workaround: e.target.value })} />
      <label className="it-label" htmlFor={`pr-${p.id}`}>Confirmed root cause</label>
      <textarea id={`pr-${p.id}`} className="it-input min-h-[72px]" value={v.rootCause} onChange={(e) => setV({ ...v, rootCause: e.target.value })} />
      <button type="submit" className="it-btn it-btn-primary" disabled={busy}>Save</button>
    </form>
  );
}

/* ── Changes ───────────────────────────────────────────────────────── */

type Change = { id: number; change_number: string; title: string; description: string | null; change_type: string; risk: string; status: string; created_at: string };

export function ConsoleChanges() {
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ["it", "changes"], queryFn: () => itApi<{ changes: Change[] }>("/api/changes").then((d) => d.changes) });
  const [form, setForm] = useState({ title: "", description: "", change_type: "normal", risk: "medium", rollback_plan: "" });
  const [open, setOpen] = useState(false);
  const refresh = () => cache.invalidateQueries({ queryKey: ["it", "changes"] });
  const create = useMutation({ mutationFn: () => send("/api/changes", "POST", form), onSuccess: () => { setOpen(false); setForm({ title: "", description: "", change_type: "normal", risk: "medium", rollback_plan: "" }); refresh(); } });
  const decide = useMutation({ mutationFn: (v: { id: number; d: "approve" | "reject" }) => send(`/api/changes/${v.id}/${v.d}`, "POST"), onSuccess: refresh });
  return (
    <ConsoleLayout>
      <PageHead title="Changes" action={<button type="button" className="it-btn it-btn-primary" onClick={() => setOpen((o) => !o)}><Plus size={16} /> Request a change</button>}>
        Planned changes to systems and infrastructure, with risk and a way back.
      </PageHead>
      {open && (
        <form className="it-panel it-inline-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <input className="it-input" required minLength={3} placeholder="What will change" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className="it-input min-h-[72px]" placeholder="Why, when, and who is affected" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <textarea className="it-input min-h-[60px]" placeholder="Rollback plan" value={form.rollback_plan} onChange={(e) => setForm({ ...form, rollback_plan: e.target.value })} />
          <div className="flex flex-wrap gap-3">
            <select className="it-input w-auto" value={form.change_type} onChange={(e) => setForm({ ...form, change_type: e.target.value })} aria-label="Type">
              <option value="standard">Standard (pre-approved)</option>
              <option value="normal">Normal</option>
              <option value="emergency">Emergency</option>
            </select>
            <select className="it-input w-auto" value={form.risk} onChange={(e) => setForm({ ...form, risk: e.target.value })} aria-label="Risk">
              {["low", "medium", "high"].map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)} risk</option>)}
            </select>
            <ErrorNote error={create.error} />
            <button type="submit" className="it-btn it-btn-primary ml-auto" disabled={create.isPending}>Submit</button>
          </div>
        </form>
      )}
      <ErrorNote error={q.error ?? decide.error} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty title="No changes yet" /> : (
        <ul className="it-list">
          {q.data.map((c) => (
            <li key={c.id} className="it-list-row">
              <span className="min-w-0 flex-1">
                <b className="block">{c.title}</b>
                <span className="it-muted">{c.change_number} · {c.change_type} · {c.risk} risk · {when(c.created_at)}</span>
              </span>
              <Chip tone={c.status === "approved" || c.status === "completed" ? "green" : c.status === "rejected" || c.status === "failed" ? "red" : "amber"}>{c.status.replace(/_/g, " ")}</Chip>
              {(c.status === "draft" || c.status === "pending_approval") && (
                <span className="flex gap-2">
                  <button type="button" className="it-btn it-btn-quiet it-btn-sm" onClick={() => decide.mutate({ id: c.id, d: "approve" })}>Approve</button>
                  <button type="button" className="it-btn it-btn-quiet it-btn-sm" onClick={() => decide.mutate({ id: c.id, d: "reject" })}>Reject</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </ConsoleLayout>
  );
}

/* ── Assets ────────────────────────────────────────────────────────── */

const ASSET_STATUS: Record<string, { label: string; tone: string }> = {
  in_stock: { label: "In stock", tone: "blue" },
  assigned: { label: "Assigned", tone: "green" },
  in_repair: { label: "In repair", tone: "amber" },
  retired: { label: "Retired", tone: "grey" },
  lost: { label: "Lost", tone: "red" },
};
const ATTRS: [string, string][] = [
  ["assetTag", "Asset tag (blank = automatic)"], ["serial", "Serial number"], ["model", "Model"], ["vendor", "Vendor"],
  ["purchasedOn", "Purchased on"], ["warrantyUntil", "Warranty until"], ["location", "Location"], ["notes", "Notes"],
];
type AssetForm = { id?: number; name: string; type: string; status: string; ownerId: number | null; ownerName: string; attributes: Record<string, string> };
const blankAsset: AssetForm = { name: "", type: "laptop", status: "in_stock", ownerId: null, ownerName: "", attributes: {} };

export function ConsoleAssets() {
  const cache = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState({ q: "", type: "", status: "" });
  const q = useQuery({
    queryKey: ["it", "assets", "all", filter],
    queryFn: () => {
      const p = new URLSearchParams({ scope: "all" });
      Object.entries(filter).forEach(([k, v]) => v && p.set(k, v));
      return itApi<{ assets: Asset[]; types: string[] }>(`/api/it/assets?${p}`);
    },
  });
  const [form, setForm] = useState<AssetForm | null>(null);
  const [who, setWho] = useState("");
  const people = useQuery({
    queryKey: ["it", "people", who],
    enabled: !!form && who.trim().length >= 2,
    queryFn: () => itApi<{ people: Person[] }>(`/api/it/people?q=${encodeURIComponent(who.trim())}`).then((d) => d.people),
  });
  const save = useMutation({
    mutationFn: (f: AssetForm) =>
      f.id
        ? send(`/api/it/assets/${f.id}`, "PATCH", { name: f.name, status: f.status, ownerId: f.ownerId, attributes: f.attributes })
        : send("/api/it/assets", "POST", { name: f.name, type: f.type, status: f.status, ownerId: f.ownerId, attributes: f.attributes }),
    onSuccess: () => {
      setForm(null);
      cache.invalidateQueries({ queryKey: ["it", "assets"] });
      cache.invalidateQueries({ queryKey: ["it", "overview"] });
      toast({ title: "Asset saved" });
    },
  });
  const types = q.data?.types ?? [];
  return (
    <ConsoleLayout>
      <PageHead title="Assets" action={<button type="button" className="it-btn it-btn-primary" onClick={() => { setForm(blankAsset); setWho(""); }}><Plus size={16} /> Add asset</button>}>
        Laptops, headsets, phones and licences, and who has them. Employees see their own under My devices.
      </PageHead>
      {form && (
        <form className="it-panel it-asset-form" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
          <div className="flex items-center justify-between">
            <h2>{form.id ? "Edit asset" : "New asset"}</h2>
            <button type="button" className="it-iconbtn" onClick={() => setForm(null)} aria-label="Close"><X size={18} /></button>
          </div>
          <div className="it-form-grid">
            <div>
              <label className="it-label" htmlFor="a-name">Name <span className="it-req">*</span></label>
              <input id="a-name" className="it-input" required placeholder="e.g. Dell Latitude 5440" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="it-label" htmlFor="a-type">Type</label>
              <select id="a-type" className="it-input" value={form.type} disabled={!!form.id} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="it-label" htmlFor="a-status">Status</label>
              <select id="a-status" className="it-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="relative">
              <label className="it-label" htmlFor="a-owner">Assigned to</label>
              <input
                id="a-owner"
                className="it-input"
                placeholder="Search a person"
                value={who || form.ownerName}
                onChange={(e) => { setWho(e.target.value); if (!e.target.value) setForm({ ...form, ownerId: null, ownerName: "" }); }}
              />
              {who.trim().length >= 2 && (people.data?.length ?? 0) > 0 && (
                <ul className="it-picker">
                  {people.data!.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => { setForm({ ...form, ownerId: p.id, ownerName: p.name, status: form.status === "in_stock" ? "assigned" : form.status }); setWho(""); }}>
                        <b>{p.name}</b> <span className="it-muted">{p.departmentName ?? p.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {ATTRS.map(([k, label]) => (
              <div key={k}>
                <label className="it-label" htmlFor={`a-${k}`}>{label}</label>
                <input
                  id={`a-${k}`}
                  className="it-input"
                  type={k === "purchasedOn" || k === "warrantyUntil" ? "date" : "text"}
                  value={form.attributes[k] ?? ""}
                  onChange={(e) => setForm({ ...form, attributes: { ...form.attributes, [k]: e.target.value } })}
                />
              </div>
            ))}
          </div>
          <ErrorNote error={save.error} />
          <button type="submit" className="it-btn it-btn-primary" disabled={save.isPending}>{form.id ? "Save changes" : "Add asset"}</button>
        </form>
      )}
      <div className="it-filters">
        <input className="it-input" placeholder="Search name, tag, serial or person" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} aria-label="Search assets" />
        <select className="it-input" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} aria-label="Type">
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="it-input" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <ErrorNote error={q.error} />
      {q.isLoading ? <Loading /> : !q.data?.assets.length ? (
        <Empty title="No assets yet">Add the laptops and headsets you hand out, so every employee sees their own devices.</Empty>
      ) : (
        <div className="it-table-wrap">
          <table className="it-table">
            <thead>
              <tr><th>Asset</th><th>Type</th><th>Status</th><th>Assigned to</th><th>Warranty</th><th /></tr>
            </thead>
            <tbody>
              {q.data.assets.map((a) => (
                <tr key={a.id}>
                  <td><span className="it-table-main"><b>{a.name}</b><span>{a.attributes.assetTag ?? "—"}{a.attributes.serial ? ` · ${a.attributes.serial}` : ""}</span></span></td>
                  <td>{a.type}</td>
                  <td><Chip tone={ASSET_STATUS[a.status]?.tone ?? "grey"}>{ASSET_STATUS[a.status]?.label ?? a.status}</Chip></td>
                  <td>{a.ownerName ?? <span className="it-muted">—</span>}{a.departmentName ? <span className="it-muted block text-[13px]">{a.departmentName}</span> : null}</td>
                  <td>{a.attributes.warrantyUntil ?? "—"}</td>
                  <td>
                    <button type="button" className="it-link" onClick={() => { setForm({ id: a.id, name: a.name, type: a.type, status: a.status, ownerId: a.ownerId, ownerName: a.ownerName ?? "", attributes: { ...a.attributes } }); setWho(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ConsoleLayout>
  );
}

/* ── Catalog admin ─────────────────────────────────────────────────── */

export function ConsoleCatalog() {
  const cache = useQueryClient();
  const q = useCatalog(true);
  const patch = useMutation({
    mutationFn: (v: { id: number } & Record<string, unknown>) => send(`/api/it/catalog/${v.id}`, "PATCH", v),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["it", "catalog"] }),
  });
  return (
    <ConsoleLayout>
      <PageHead title="Catalog">What employees can order. Hide an entry to take it off the portal; feature it to show it on the portal home.</PageHead>
      <ErrorNote error={q.error ?? patch.error} />
      {q.isLoading ? <Loading rows={8} /> : (
        <div className="it-table-wrap">
          <table className="it-table">
            <thead>
              <tr><th>Entry</th><th>Group</th><th>Approvals</th><th>Delivery</th><th>Featured</th><th>On portal</th></tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((i) => (
                <tr key={i.id} className={i.isActive ? "" : "is-muted"}>
                  <td>
                    <span className="flex items-center gap-3">
                      <ItemIcon name={i.icon} size={32} />
                      <Link href={`/it/catalog/${i.id}`} className="it-table-main"><b>{i.name}</b><span>{i.kind === "item" ? "Thing" : "Service"} · {i.fulfilmentTasks.length} fulfilment steps</span></Link>
                    </span>
                  </td>
                  <td>{i.group}</td>
                  <td>{i.approvalChain.length ? i.approvalChain.map((s) => roleLabel(s.role)).join(" → ") : <span className="it-muted">None</span>}</td>
                  <td>{i.delivery || "—"}</td>
                  <td><input type="checkbox" className="it-check" checked={i.featured} onChange={(e) => patch.mutate({ id: i.id, featured: e.target.checked })} aria-label={`Feature ${i.name}`} /></td>
                  <td><input type="checkbox" className="it-check" checked={i.isActive} onChange={(e) => patch.mutate({ id: i.id, isActive: e.target.checked })} aria-label={`Show ${i.name}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ConsoleLayout>
  );
}

/* ── Knowledge admin ───────────────────────────────────────────────── */

type KbRow = { id: number; title: string; category: string | null; status: string; view_count: number; updated_at: string };

export function ConsoleKnowledge() {
  const cache = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["it", "kb", "admin"], queryFn: () => itApi<{ articles: KbRow[] }>("/api/knowledge/articles").then((d) => d.articles) });
  const [form, setForm] = useState({ title: "", category: "IT", content: "" });
  const [open, setOpen] = useState(false);
  const refresh = () => cache.invalidateQueries({ queryKey: ["it", "kb"] });
  const create = useMutation({
    mutationFn: async () => {
      const d = await send<{ article: { id: number } }>("/api/knowledge/articles", "POST", { ...form, tags: ["it"] });
      await send(`/api/knowledge/articles/${d.article.id}/status`, "POST", { status: "published" }).catch(() => undefined);
    },
    onSuccess: () => { setOpen(false); setForm({ title: "", category: "IT", content: "" }); refresh(); toast({ title: "Article published" }); },
  });
  const setStatus = useMutation({ mutationFn: (v: { id: number; status: string }) => send(`/api/knowledge/articles/${v.id}/status`, "POST", { status: v.status }), onSuccess: refresh });
  return (
    <ConsoleLayout>
      <PageHead title="Knowledge" action={<button type="button" className="it-btn it-btn-primary" onClick={() => setOpen((o) => !o)}><Plus size={16} /> Write an article</button>}>
        Published articles appear in the portal search and on the Report an issue form, so people fix things themselves.
      </PageHead>
      {open && (
        <form className="it-panel it-inline-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <input className="it-input" required placeholder="Title, as a user would search it (e.g. VPN won't connect)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="it-input" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <textarea className="it-input min-h-[200px]" required placeholder="Steps, one per line" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          <ErrorNote error={create.error} />
          <button type="submit" className="it-btn it-btn-primary" disabled={create.isPending}>Publish</button>
        </form>
      )}
      <ErrorNote error={q.error ?? setStatus.error} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty title="No articles yet" /> : (
        <ul className="it-list">
          {q.data.map((a) => (
            <li key={a.id} className="it-list-row">
              <Link href={`/it/knowledge/${a.id}`} className="min-w-0 flex-1">
                <b className="block">{a.title}</b>
                <span className="it-muted">{a.category ?? "General"} · {a.view_count} views · {when(a.updated_at)}</span>
              </Link>
              <select className="it-input w-auto" value={a.status} onChange={(e) => setStatus.mutate({ id: a.id, status: e.target.value })} aria-label={`Status of ${a.title}`}>
                {["draft", "in_review", "published", "archived"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </li>
          ))}
        </ul>
      )}
    </ConsoleLayout>
  );
}
