import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Clock, Lightbulb, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { itApi, send, type Asset, type CatalogItem, type ItRequest, type Ticket } from "./api";
import { PortalLayout, useItSession } from "./ItLayout";
import {
  DynamicField, Empty, ErrorNote, IMPACT, ISSUE_TYPES, ItemIcon, Loading, PageHead, PRIORITY, URGENCY,
  priorityChip, priorityFor, stageChip, statusChip, when,
} from "./ui";

/* ── Data hooks ─────────────────────────────────────────────────────── */

export const useCatalog = (all = false) =>
  useQuery({
    queryKey: ["it", "catalog", all],
    queryFn: () => itApi<{ items: CatalogItem[] }>(`/api/it/catalog${all ? "?all=true" : ""}`).then((d) => d.items),
  });

const useMyRequests = () =>
  useQuery({ queryKey: ["it", "requests", "mine"], queryFn: () => itApi<{ requests: ItRequest[] }>("/api/it/requests").then((d) => d.requests) });

function useMyIssues() {
  const { data: session } = useItSession();
  return useQuery({
    queryKey: ["it", "issues", "mine", session?.itDepartmentId],
    enabled: !!session,
    queryFn: () =>
      itApi<{ tickets: Ticket[] }>(
        `/api/tickets?view=mine&limit=50${session?.itDepartmentId ? `&departmentId=${session.itDepartmentId}` : ""}`,
      ).then((d) => d.tickets),
  });
}

type KbHit = { id: number; title: string; category: string | null; snippet?: string };

function useKbSearch(q: string) {
  const [term, setTerm] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  return useQuery({
    queryKey: ["it", "kb", term],
    enabled: term.length >= 3,
    queryFn: () => itApi<{ results: KbHit[] }>(`/api/knowledge/search?q=${encodeURIComponent(term)}`).then((d) => d.results),
  });
}

const OPEN_TICKET = (t: Ticket) => !["resolved", "closed"].includes(t.status);
const OPEN_REQUEST = (r: ItRequest) => ["awaiting_approval", "queued", "in_progress"].includes(r.stage);

/* ── Home ───────────────────────────────────────────────────────────── */

export function PortalHome() {
  const { data: session } = useItSession();
  const catalog = useCatalog();
  const requests = useMyRequests();
  const issues = useMyIssues();
  const status = useQuery({ queryKey: ["it", "status"], queryFn: () => itApi<{ incidents: { id: number }[] }>("/api/it/status") });
  const [q, setQ] = useState("");
  const kb = useKbSearch(q);
  const [, navigate] = useLocation();

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return (catalog.data ?? [])
      .filter((i) => `${i.name} ${i.description ?? ""} ${i.group}`.toLowerCase().includes(t))
      .slice(0, 6);
  }, [q, catalog.data]);

  const openRequests = (requests.data ?? []).filter(OPEN_REQUEST);
  const openIssues = (issues.data ?? []).filter(OPEN_TICKET);
  const outages = status.data?.incidents.length ?? 0;
  const first = session?.user.name.split(" ")[0];

  return (
    <PortalLayout>
      <section className="it-hero">
        <h1>{first ? `How can IT help, ${first}?` : "How can IT help?"}</h1>
        <p>Order equipment and software, get access, or report a problem. Every request is tracked to done.</p>
        <form
          className="it-hero-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches[0]) navigate(`/it/catalog/${matches[0].id}`);
          }}
        >
          <Search size={20} aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Try “laptop”, “VPN”, “password” or “headset”"
            aria-label="Search IT services and help articles"
          />
        </form>
        {q.trim().length >= 2 && (
          <div className="it-hero-results">
            {matches.length === 0 && !(kb.data?.length) && (
              <p className="it-muted px-4 py-3">
                Nothing matched. <Link href="/it/report" className="it-link">Report it as an issue</Link> and we'll take it from there.
              </p>
            )}
            {matches.map((i) => (
              <Link key={i.id} href={`/it/catalog/${i.id}`} className="it-result">
                <ItemIcon name={i.icon} size={32} />
                <span className="min-w-0 flex-1">
                  <b>{i.name}</b>
                  <span className="it-muted block truncate">{i.description}</span>
                </span>
                <span className="it-muted text-[13px]">{i.kind === "item" ? "Order" : "Request"}</span>
              </Link>
            ))}
            {(kb.data ?? []).slice(0, 3).map((a) => (
              <Link key={`kb-${a.id}`} href={`/it/knowledge/${a.id}`} className="it-result">
                <span className="it-item-icon" style={{ width: 32, height: 32 }} aria-hidden>
                  <Lightbulb size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <b>{a.title}</b>
                  <span className="it-muted block truncate">Help article</span>
                </span>
              </Link>
            ))}
          </div>
        )}
        <div className="it-hero-actions">
          <Link href="/it/report" className="it-btn it-btn-primary">
            Report an issue <ArrowRight size={16} />
          </Link>
          <Link href="/it/catalog" className="it-btn it-btn-quiet">Browse the catalog</Link>
        </div>
      </section>

      <Link href="/it/status" className={`it-statusline ${outages ? "is-down" : ""}`}>
        {outages ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
        {outages ? `${outages} service ${outages === 1 ? "issue is" : "issues are"} being worked on` : "All IT services are running normally"}
        <ArrowRight size={16} className="ml-auto" />
      </Link>

      <div className="it-home-grid">
        <section>
          <div className="it-section-head">
            <h2>Popular requests</h2>
            <Link href="/it/catalog" className="it-link">Full catalog</Link>
          </div>
          {catalog.isLoading ? (
            <Loading rows={6} />
          ) : (
            <div className="it-popular">
              {(catalog.data ?? [])
                .filter((i) => i.featured)
                .map((i) => (
                  <Link key={i.id} href={`/it/catalog/${i.id}`} className="it-popular-row">
                    <ItemIcon name={i.icon} size={44} />
                    <span className="min-w-0">
                      <b>{i.name}</b>
                      <span className="it-muted">{i.delivery}</span>
                    </span>
                  </Link>
                ))}
            </div>
          )}
        </section>

        <section>
          <div className="it-section-head">
            <h2>Your open items</h2>
            <Link href="/it/my" className="it-link">All</Link>
          </div>
          {requests.isLoading || issues.isLoading ? (
            <Loading rows={3} />
          ) : openRequests.length + openIssues.length === 0 ? (
            <Empty title="Nothing open">Requests and issues you raise will show here until they're done.</Empty>
          ) : (
            <ul className="it-list">
              {openRequests.slice(0, 4).map((r) => (
                <li key={`r${r.id}`}>
                  <Link href={`/it/requests/${r.id}`} className="it-list-row">
                    <ItemIcon name={r.itemIcon} size={36} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{r.itemName}</b>
                      <span className="it-muted">{r.requestNumber} · {when(r.createdAt)}</span>
                    </span>
                    {stageChip(r.stage)}
                  </Link>
                </li>
              ))}
              {openIssues.slice(0, 4).map((t) => (
                <li key={`t${t.id}`}>
                  <Link href={`/it/issues/${t.id}`} className="it-list-row">
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{t.subject}</b>
                      <span className="it-muted">{t.ticketNumber.slice(0, 11)} · {when(t.createdAt)}</span>
                    </span>
                    {statusChip(t.status)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PortalLayout>
  );
}

/* ── Catalog ────────────────────────────────────────────────────────── */

export function PortalCatalog() {
  const catalog = useCatalog();
  const search = useSearch();
  const [group, setGroup] = useState(new URLSearchParams(search).get("group") ?? "All");
  const [kind, setKind] = useState<"all" | "item" | "service">("all");
  const [q, setQ] = useState("");
  useEffect(() => setGroup(new URLSearchParams(search).get("group") ?? "All"), [search]);

  const items = catalog.data ?? [];
  const groups = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.group)))], [items]);
  const shown = items.filter(
    (i) =>
      (group === "All" || i.group === group) &&
      (kind === "all" || i.kind === kind) &&
      (!q.trim() || `${i.name} ${i.description ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const byGroup = shown.reduce<Record<string, CatalogItem[]>>((acc, i) => ((acc[i.group] ??= []).push(i), acc), {});

  return (
    <PortalLayout>
      <PageHead title="IT catalog">Equipment, software and services. Pick one, fill a short form, and follow it to done.</PageHead>
      <div className="it-catalog">
        <aside className="it-catalog-side">
          <div className="it-field-search">
            <Search size={16} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog" aria-label="Search the catalog" />
          </div>
          <div className="it-seg" role="tablist" aria-label="Type">
            {(["all", "item", "service"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "All" : k === "item" ? "Things" : "Services"}
              </button>
            ))}
          </div>
          <nav className="it-groups" aria-label="Catalog groups">
            {groups.map((g) => (
              <button key={g} type="button" className={group === g ? "is-active" : ""} onClick={() => setGroup(g)}>
                {g}
                <span>{g === "All" ? items.length : items.filter((i) => i.group === g).length}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="min-w-0">
          <ErrorNote error={catalog.error} />
          {catalog.isLoading ? (
            <Loading rows={8} />
          ) : shown.length === 0 ? (
            <Empty title="Nothing here matches">
              Can't find it? <b>Other software</b> under Software &amp; licences covers anything not listed, or{" "}
              <Link href="/it/report" className="it-link">report an issue</Link>.
            </Empty>
          ) : (
            Object.entries(byGroup).map(([g, list]) => (
              <section key={g} className="it-catalog-group">
                <h2>{g}</h2>
                <ul className="it-list">
                  {list.map((i) => (
                    <li key={i.id}>
                      <Link href={`/it/catalog/${i.id}`} className="it-list-row it-catalog-row">
                        <ItemIcon name={i.icon} size={48} />
                        <span className="min-w-0 flex-1">
                          <b>{i.name}</b>
                          <span className="it-muted block">{i.description}</span>
                        </span>
                        <span className="it-catalog-meta">
                          <span><Clock size={14} /> {i.delivery || "—"}</span>
                          <span>
                            <ShieldCheck size={14} /> {i.approvalSteps === 0 ? "No approval" : i.approvalSteps === 1 ? "1 approval" : `${i.approvalSteps} approvals`}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

const ROLE_LABEL: Record<string, string> = {
  manager: "Your manager",
  admin: "IT administrator",
  super_admin: "IT administrator",
  agent: "IT agent",
};
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r.replace(/_/g, " ");

export function PortalCatalogItem() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const cache = useQueryClient();
  const item = useQuery({
    queryKey: ["it", "catalog-item", id],
    queryFn: () => itApi<{ item: CatalogItem }>(`/api/it/catalog/${id}`).then((d) => d.item),
  });
  const [form, setForm] = useState<Record<string, unknown>>({});
  const submit = useMutation({
    mutationFn: () => send<{ request: { id: number; requestNumber: string } }>(`/api/it/catalog/${id}/request`, "POST", { form_data: form }),
    onSuccess: (d) => {
      cache.invalidateQueries({ queryKey: ["it", "requests"] });
      toast({ title: `${d.request.requestNumber} submitted`, description: "You can follow every step from here." });
      navigate(`/it/requests/${d.request.id}`);
    },
  });

  const i = item.data;
  return (
    <PortalLayout>
      {item.isLoading ? (
        <Loading rows={6} />
      ) : !i ? (
        <Empty title="This catalog entry isn't available">
          <Link href="/it/catalog" className="it-link">Back to the catalog</Link>
        </Empty>
      ) : (
        <div className="it-order">
          <div>
            <Link href={`/it/catalog?group=${encodeURIComponent(i.group)}`} className="it-back">← {i.group}</Link>
            <div className="it-order-head">
              <ItemIcon name={i.icon} size={64} />
              <div>
                <h1>{i.name}</h1>
                <p className="it-muted">{i.kind === "item" ? "Thing you order" : "Service"} · {i.delivery || "Delivery time varies"}</p>
              </div>
            </div>
            <p className="it-lead">{i.description}</p>
            <h2 className="it-h2">What happens after you submit</h2>
            <ol className="it-steps">
              <li>
                <b>You submit</b>
                <span>You get a request number straight away.</span>
              </li>
              {i.approvalChain
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((s) => (
                  <li key={s.order}>
                    <b>{roleLabel(s.role)} approves</b>
                    <span>You'll see when it's approved, or why not.</span>
                  </li>
                ))}
              <li>
                <b>IT fulfils it</b>
                <span>{i.fulfilmentTasks.length ? i.fulfilmentTasks.join(" · ") : "An IT agent picks it up."}</span>
              </li>
              <li>
                <b>Done</b>
                <span>Typical time: {i.delivery || "varies"}.</span>
              </li>
            </ol>
          </div>
          <form
            className="it-panel it-order-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <h2>Your request</h2>
            {i.formSchema.fields.length === 0 && <p className="it-muted">No details needed. Just submit.</p>}
            {i.formSchema.fields.map((f) => (
              <DynamicField key={f.name} field={f} value={form[f.name]} onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))} />
            ))}
            <ErrorNote error={submit.error} />
            <button type="submit" className="it-btn it-btn-primary w-full justify-center" disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : i.approvalSteps ? "Submit for approval" : "Submit request"}
            </button>
          </form>
        </div>
      )}
    </PortalLayout>
  );
}

/* ── Report an issue ────────────────────────────────────────────────── */

export function PortalReport() {
  const { data: session } = useItSession();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const cache = useQueryClient();
  const [type, setType] = useState(-1);
  const [sub, setSub] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState(0);
  const [urgency, setUrgency] = useState(1);
  const kb = useKbSearch(subject);
  const priority = priorityFor(impact, urgency);

  const submit = useMutation({
    mutationFn: () =>
      send<Ticket>("/api/tickets", "POST", {
        subject: subject.trim(),
        description: `${description.trim()}\n\nImpact: ${IMPACT[impact]}\nUrgency: ${URGENCY[urgency]}`,
        priority,
        departmentId: session?.itDepartmentId ?? undefined,
        category: ISSUE_TYPES[type]?.name,
        subcategory: sub || undefined,
        tags: ["it-portal"],
      }),
    onSuccess: (t) => {
      cache.invalidateQueries({ queryKey: ["it", "issues"] });
      toast({ title: "Issue reported", description: "IT has it. You'll see every update here." });
      navigate(`/it/issues/${t.id}`);
    },
  });

  return (
    <PortalLayout>
      <PageHead title="Report an issue">Something broken or not working? Tell us what's happening and how much it's stopping you.</PageHead>
      <div className="it-report">
        <form
          className="space-y-7"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <fieldset>
            <legend className="it-h2">What's it about?</legend>
            <div className="it-tiles">
              {ISSUE_TYPES.map((t, n) => (
                <button key={t.name} type="button" aria-pressed={type === n} onClick={() => { setType(n); setSub(""); }}>
                  {t.name}
                </button>
              ))}
            </div>
          </fieldset>
          {type >= 0 && (
            <fieldset>
              <legend className="it-h2">Which one fits best?</legend>
              <div className="it-tiles it-tiles-sm">
                {ISSUE_TYPES[type].subs.map((s) => (
                  <button key={s} type="button" aria-pressed={sub === s} onClick={() => setSub(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div>
            <label htmlFor="it-subject" className="it-label">In one line, what's wrong? <span className="it-req">*</span></label>
            <input id="it-subject" className="it-input" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. VPN disconnects every 10 minutes" />
          </div>
          {(kb.data?.length ?? 0) > 0 && (
            <div className="it-suggest">
              <p><Lightbulb size={16} /> These help articles might fix it right now</p>
              {kb.data!.slice(0, 3).map((a) => (
                <Link key={a.id} href={`/it/knowledge/${a.id}`} className="it-link block">{a.title}</Link>
              ))}
            </div>
          )}
          <div>
            <label htmlFor="it-desc" className="it-label">Details <span className="it-req">*</span></label>
            <textarea id="it-desc" className="it-input min-h-[140px]" required maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When did it start? What have you tried? Any error message?" />
          </div>
          <fieldset>
            <legend className="it-h2">Who is affected?</legend>
            <div className="it-seg it-seg-wide">
              {IMPACT.map((label, n) => (
                <button key={label} type="button" aria-pressed={impact === n} onClick={() => setImpact(n)}>{label}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="it-h2">How much is it stopping you?</legend>
            <div className="it-seg it-seg-wide">
              {URGENCY.map((label, n) => (
                <button key={label} type="button" aria-pressed={urgency === n} onClick={() => setUrgency(n)}>{label}</button>
              ))}
            </div>
          </fieldset>
          <ErrorNote error={submit.error} />
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className="it-btn it-btn-primary" disabled={submit.isPending || type < 0}>
              {submit.isPending ? "Sending…" : "Send to IT"}
            </button>
            <span className="it-muted text-[14px]">
              It will be logged as {priorityChip(priority)} {PRIORITY[priority].tone === "red" ? "and paged to the on-shift team." : ""}
            </span>
          </div>
        </form>
        <aside className="it-panel it-report-aside">
          <h2>Faster than a ticket</h2>
          <p>Locked out? <Link href="/it/catalog" className="it-link">Password reset</Link> is usually done within the hour.</p>
          <p>Need something new rather than a fix? Use the <Link href="/it/catalog" className="it-link">catalog</Link>.</p>
          <p>Lost a laptop or phone? Report it at once under <b>Security concern</b>: we lock it remotely.</p>
        </aside>
      </div>
    </PortalLayout>
  );
}

/* ── My requests ───────────────────────────────────────────────────── */

export function PortalMy() {
  const [tab, setTab] = useState<"requests" | "issues" | "devices">("requests");
  const requests = useMyRequests();
  const issues = useMyIssues();
  const devices = useQuery({ queryKey: ["it", "assets", "mine"], queryFn: () => itApi<{ assets: Asset[] }>("/api/it/assets").then((d) => d.assets) });
  const counts = { requests: requests.data?.length ?? 0, issues: issues.data?.length ?? 0, devices: devices.data?.length ?? 0 };
  return (
    <PortalLayout>
      <PageHead title="My requests">Everything you've asked IT for, and the equipment registered to you.</PageHead>
      <div className="it-tabs" role="tablist">
        {(["requests", "issues", "devices"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "requests" ? "Requests" : t === "issues" ? "Issues" : "My devices"} <span>{counts[t]}</span>
          </button>
        ))}
      </div>
      {tab === "requests" &&
        (requests.isLoading ? <Loading /> : !requests.data?.length ? (
          <Empty title="No requests yet"><Link href="/it/catalog" className="it-link">Browse the catalog</Link></Empty>
        ) : (
          <ul className="it-list">
            {requests.data.map((r) => (
              <li key={r.id}>
                <Link href={`/it/requests/${r.id}`} className="it-list-row">
                  <ItemIcon name={r.itemIcon} size={40} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{r.itemName}</b>
                    <span className="it-muted">
                      {r.requestNumber} · {when(r.createdAt)}
                      {r.stage === "in_progress" && r.tasksTotal > 0 ? ` · ${r.tasksDone} of ${r.tasksTotal} steps done` : ""}
                    </span>
                  </span>
                  {stageChip(r.stage)}
                </Link>
              </li>
            ))}
          </ul>
        ))}
      {tab === "issues" &&
        (issues.isLoading ? <Loading /> : !issues.data?.length ? (
          <Empty title="No issues reported"><Link href="/it/report" className="it-link">Report an issue</Link></Empty>
        ) : (
          <ul className="it-list">
            {issues.data.map((t) => (
              <li key={t.id}>
                <Link href={`/it/issues/${t.id}`} className="it-list-row">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{t.subject}</b>
                    <span className="it-muted">{t.category ?? "Issue"}{t.subcategory ? ` › ${t.subcategory}` : ""} · {when(t.createdAt)}</span>
                  </span>
                  {priorityChip(t.priority)}
                  {statusChip(t.status)}
                </Link>
              </li>
            ))}
          </ul>
        ))}
      {tab === "devices" &&
        (devices.isLoading ? <Loading /> : !devices.data?.length ? (
          <Empty title="No equipment registered to you">If you have a DEJOIY laptop or headset that isn't listed, tell IT through a request.</Empty>
        ) : (
          <ul className="it-list">
            {devices.data.map((a) => (
              <li key={a.id} className="it-list-row">
                <span className="min-w-0 flex-1">
                  <b className="block">{a.name}</b>
                  <span className="it-muted">
                    {a.attributes.assetTag ?? "—"} · {a.type}
                    {a.attributes.serial ? ` · S/N ${a.attributes.serial}` : ""}
                    {a.attributes.warrantyUntil ? ` · warranty to ${a.attributes.warrantyUntil}` : ""}
                  </span>
                </span>
                <Link href="/it/catalog?group=Hardware" className="it-link text-[14px]">Repair or replace</Link>
              </li>
            ))}
          </ul>
        ))}
    </PortalLayout>
  );
}

/* ── Knowledge ─────────────────────────────────────────────────────── */

type Article = { id: number; title: string; category: string | null; content?: string; updated_at?: string; view_count?: number };

export function PortalKnowledge() {
  const [q, setQ] = useState("");
  const search = useKbSearch(q);
  const list = useQuery({
    queryKey: ["it", "kb", "list"],
    queryFn: () => itApi<{ articles: Article[] }>("/api/knowledge/articles").then((d) => d.articles.filter((a) => (a as { status?: string }).status !== "archived")),
  });
  const rows: Article[] = q.trim().length >= 3 ? search.data ?? [] : list.data ?? [];
  return (
    <PortalLayout>
      <PageHead title="Knowledge">Fixes and how-tos written by the IT team. Most problems are solved here in minutes.</PageHead>
      <div className="it-field-search it-field-search-lg">
        <Search size={18} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search help articles" aria-label="Search help articles" />
      </div>
      {list.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title={q ? "No article matches that" : "No articles published yet"}>
          <Link href="/it/report" className="it-link">Ask IT instead</Link>
        </Empty>
      ) : (
        <ul className="it-list mt-6">
          {rows.map((a) => (
            <li key={a.id}>
              <Link href={`/it/knowledge/${a.id}`} className="it-list-row">
                <Lightbulb size={20} className="it-accent-ink shrink-0" />
                <span className="min-w-0 flex-1">
                  <b className="block">{a.title}</b>
                  <span className="it-muted">{a.category ?? "General"}</span>
                </span>
                <ArrowRight size={16} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PortalLayout>
  );
}

export function PortalArticle() {
  const { id } = useParams<{ id: string }>();
  const a = useQuery({ queryKey: ["it", "kb", "article", id], queryFn: () => itApi<{ article: Article }>(`/api/knowledge/articles/${id}`).then((d) => d.article) });
  return (
    <PortalLayout>
      <Link href="/it/knowledge" className="it-back">← Knowledge</Link>
      {a.isLoading ? <Loading /> : !a.data ? <ErrorNote error={a.error} /> : (
        <article className="it-article">
          <h1>{a.data.title}</h1>
          <p className="it-muted">{a.data.category ?? "General"}{a.data.updated_at ? ` · updated ${when(a.data.updated_at)}` : ""}</p>
          <div className="it-article-body">{a.data.content}</div>
          <div className="it-panel mt-10">
            <b>Didn't fix it?</b>{" "}
            <Link href="/it/report" className="it-link">Report an issue</Link> and mention this article so IT knows what you've tried.
          </div>
        </article>
      )}
    </PortalLayout>
  );
}

/* ── Service status ────────────────────────────────────────────────── */

type StatusData = {
  services: { id: number; name: string; health: string; status: string; updatedAt: string }[];
  incidents: { id: number; number: string; title: string; severity: string; status: string; isMajor: boolean; startedAt: string }[];
};
const HEALTH: Record<string, { label: string; tone: string }> = {
  healthy: { label: "Operational", tone: "green" },
  watch: { label: "Being watched", tone: "blue" },
  at_risk: { label: "Degraded", tone: "amber" },
  critical: { label: "Outage", tone: "red" },
};

export function PortalStatus() {
  const s = useQuery({ queryKey: ["it", "status"], queryFn: () => itApi<StatusData>("/api/it/status"), refetchInterval: 60_000 });
  const incidents = s.data?.incidents ?? [];
  return (
    <PortalLayout>
      <PageHead title="Service status">Live status of DEJOIY systems. Refreshes every minute.</PageHead>
      {s.isLoading ? <Loading /> : (
        <>
          <div className={`it-status-banner ${incidents.length ? "is-down" : ""}`}>
            {incidents.length ? <TriangleAlert size={22} /> : <CheckCircle2 size={22} />}
            <b>{incidents.length ? "Some services have problems right now" : "All systems operational"}</b>
          </div>
          {incidents.length > 0 && (
            <section className="mt-8">
              <h2 className="it-h2">Being worked on</h2>
              <ul className="it-list">
                {incidents.map((i) => (
                  <li key={i.id} className="it-list-row">
                    <span className="min-w-0 flex-1">
                      <b className="block">{i.title}</b>
                      <span className="it-muted">{i.number} · started {when(i.startedAt)} · {i.status}</span>
                    </span>
                    {i.isMajor && priorityChip("urgent")}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="mt-8">
            <h2 className="it-h2">Services</h2>
            {s.data?.services.length ? (
              <ul className="it-list">
                {s.data.services.map((v) => (
                  <li key={v.id} className="it-list-row">
                    <b className="flex-1">{v.name}</b>
                    <span className={`it-chip it-chip-${HEALTH[v.health]?.tone ?? "grey"}`}>{HEALTH[v.health]?.label ?? v.health}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No services are tracked yet">IT adds the systems it monitors here.</Empty>
            )}
          </section>
        </>
      )}
    </PortalLayout>
  );
}
