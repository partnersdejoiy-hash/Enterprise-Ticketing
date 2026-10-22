import { useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Circle, Lock, Send, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { itApi, send, type Approval, type Comment, type ItRequest, type Person, type Task, type Ticket } from "./api";
import { ConsoleLayout, PortalLayout, useItSession } from "./ItLayout";
import { roleLabel } from "./portal";
import { ErrorNote, ItemIcon, Loading, PRIORITY, TICKET_STATUS, priorityChip, stageChip, stamp, statusChip, when } from "./ui";

type Mode = { console?: boolean };
const Shell = ({ console: inConsole, children }: Mode & { children: ReactNode }) =>
  inConsole ? <ConsoleLayout>{children}</ConsoleLayout> : <PortalLayout>{children}</PortalLayout>;

/* ── Catalog request ───────────────────────────────────────────────── */

type RequestData = { request: ItRequest; approvals: Approval[]; tasks: Task[]; canWork: boolean };

const TRACK = ["Submitted", "Approval", "Fulfilment", "Done"];
function trackIndex(r: ItRequest) {
  if (r.stage === "awaiting_approval") return 1;
  if (r.stage === "queued" || r.stage === "in_progress") return 2;
  if (r.stage === "done") return 4;
  return 1;
}

export function RequestDetail({ console: inConsole }: Mode) {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const cache = useQueryClient();
  const { data: session } = useItSession();
  const q = useQuery({ queryKey: ["it", "request", id], queryFn: () => itApi<RequestData>(`/api/it/requests/${id}`) });
  const refresh = () => {
    cache.invalidateQueries({ queryKey: ["it", "request", id] });
    cache.invalidateQueries({ queryKey: ["it", "requests"] });
    cache.invalidateQueries({ queryKey: ["it", "overview"] });
  };
  const toggle = useMutation({
    mutationFn: (t: Task) => send<{ resolved: boolean }>(`/api/it/requests/${id}/tasks/${t.id}`, "PATCH", { done: !t.done }),
    onSuccess: (d) => {
      refresh();
      if (d.resolved) toast({ title: "Request fulfilled", description: "All steps done; the requester has been told." });
    },
  });
  const cancel = useMutation({ mutationFn: () => send(`/api/it/requests/${id}/cancel`, "POST"), onSuccess: refresh });
  const [comment, setComment] = useState("");
  const decide = useMutation({
    mutationFn: (d: "approve" | "reject") => send(`/api/catalog/requests/${id}/${d}`, "POST", { comment: comment || undefined }),
    onSuccess: (_d, v) => {
      setComment("");
      refresh();
      toast({ title: v === "approve" ? "Approved" : "Rejected" });
    },
  });

  const back = inConsole ? <Link href="/it/console/requests" className="it-back">← Requests</Link> : <Link href="/it/my" className="it-back">← My requests</Link>;
  if (q.isLoading) return <Shell console={inConsole}>{back}<Loading rows={6} /></Shell>;
  if (!q.data) return <Shell console={inConsole}>{back}<ErrorNote error={q.error ?? "Request not found"} /></Shell>;

  const { request: r, approvals, tasks, canWork } = q.data;
  const at = trackIndex(r);
  const fields = r.formSchema?.fields ?? [];
  const pending = approvals.find((a) => a.status === "pending");
  const canDecide = !!pending && !!session && (session.isAdmin || session.user.role === pending.role);
  const ended = r.stage === "rejected" || r.stage === "cancelled";

  return (
    <Shell console={inConsole}>
      {back}
      <div className="it-detail-head">
        <ItemIcon name={r.itemIcon} size={56} />
        <div className="min-w-0 flex-1">
          <h1>{r.itemName}</h1>
          <p className="it-muted">
            {r.requestNumber} · raised by {r.requesterName ?? "—"} · {stamp(r.createdAt)}
          </p>
        </div>
        {stageChip(r.stage)}
      </div>

      {!ended && (
        <ol className="it-track" aria-label="Progress">
          {TRACK.map((label, n) => (
            <li key={label} className={n < at ? "is-done" : n === at ? "is-now" : ""}>
              <span aria-hidden>{n < at ? <Check size={14} /> : n + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      )}

      <div className="it-detail-grid">
        <div className="space-y-8">
          {canDecide && (
            <section className="it-panel it-decide">
              <h2>Your approval is needed</h2>
              <p className="it-muted">Step {pending!.step}: {roleLabel(pending!.role)}.</p>
              <textarea className="it-input min-h-[72px]" placeholder="Note for the requester (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <ErrorNote error={decide.error} />
              <div className="flex gap-3">
                <button type="button" className="it-btn it-btn-primary" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
                  <CheckCircle2 size={16} /> Approve
                </button>
                <button type="button" className="it-btn it-btn-quiet" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
                  <XCircle size={16} /> Reject
                </button>
              </div>
            </section>
          )}

          <section>
            <h2 className="it-h2">Details</h2>
            <dl className="it-dl">
              {fields.length === 0 && Object.keys(r.formData ?? {}).length === 0 && <p className="it-muted">No details were needed.</p>}
              {(fields.length ? fields.map((f) => [f.label, r.formData?.[f.name]] as const) : Object.entries(r.formData ?? {})).map(([label, v]) => (
                <div key={String(label)}>
                  <dt>{String(label)}</dt>
                  <dd>{v === undefined || v === null || v === "" ? "—" : v === true ? "Yes" : v === false ? "No" : String(v)}</dd>
                </div>
              ))}
            </dl>
          </section>

          {tasks.length > 0 && (
            <section>
              <h2 className="it-h2">
                Fulfilment steps <span className="it-muted text-[15px] font-normal">{r.tasksDone} of {r.tasksTotal} done</span>
              </h2>
              <ul className="it-tasks">
                {tasks.map((t) => {
                  const locked = !canWork || r.stage === "awaiting_approval" || ended;
                  return (
                    <li key={t.id} className={t.done ? "is-done" : ""}>
                      <button type="button" disabled={locked || toggle.isPending} onClick={() => toggle.mutate(t)} aria-pressed={t.done} aria-label={`${t.done ? "Reopen" : "Complete"}: ${t.title}`}>
                        {t.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                      </button>
                      <span className="flex-1">{t.title}</span>
                      {t.done && <span className="it-muted text-[13px]">{t.doneBy} · {when(t.doneAt)}</span>}
                    </li>
                  );
                })}
              </ul>
              {canWork && r.stage === "awaiting_approval" && <p className="it-muted mt-2 text-[14px]">Steps unlock once the request is approved.</p>}
              <ErrorNote error={toggle.error} />
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="it-panel">
            <h2>Approvals</h2>
            {approvals.length === 0 ? (
              <p className="it-muted">This doesn't need approval.</p>
            ) : (
              <ul className="it-approvals">
                {approvals.map((a) => (
                  <li key={a.id} className={`is-${a.status}`}>
                    <b>{roleLabel(a.role)}</b>
                    <span>
                      {a.status === "pending" ? "Waiting" : a.status === "approved" ? `Approved${a.approverName ? ` by ${a.approverName}` : ""}` : a.status === "rejected" ? `Rejected${a.approverName ? ` by ${a.approverName}` : ""}` : "Skipped"}
                      {a.decidedAt ? ` · ${when(a.decidedAt)}` : ""}
                    </span>
                    {a.comment && <q>{a.comment}</q>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="it-panel">
            <h2>Delivery</h2>
            <p>{r.delivery || "Varies"}</p>
            {r.ticketId && (
              <p className="mt-2">
                Work ticket:{" "}
                <Link href={inConsole ? `/it/console/queue/${r.ticketId}` : `/it/issues/${r.ticketId}`} className="it-link">
                  {r.ticketNumber?.slice(0, 11)}
                </Link>
              </p>
            )}
          </section>
          {!inConsole && r.stage === "awaiting_approval" && r.requesterId === session?.user.id && (
            <button type="button" className="it-btn it-btn-quiet w-full justify-center" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel this request
            </button>
          )}
        </aside>
      </div>
    </Shell>
  );
}

/* ── Incident / issue (an IT ticket) ───────────────────────────────── */

type TicketData = Ticket & { comments: Comment[] };

export function IssueDetail({ console: inConsole }: Mode) {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const cache = useQueryClient();
  const { data: session } = useItSession();
  const q = useQuery({ queryKey: ["it", "ticket", id], queryFn: () => itApi<TicketData>(`/api/tickets/${id}`) });
  const team = useQuery({
    queryKey: ["it", "team"],
    enabled: !!inConsole,
    queryFn: () => itApi<{ people: Person[] }>("/api/it/people?team=true").then((d) => d.people),
  });
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const refresh = () => {
    cache.invalidateQueries({ queryKey: ["it", "ticket", id] });
    cache.invalidateQueries({ queryKey: ["it", "queue"] });
    cache.invalidateQueries({ queryKey: ["it", "issues"] });
    cache.invalidateQueries({ queryKey: ["it", "overview"] });
  };
  const post = useMutation({
    mutationFn: () => send(`/api/tickets/${id}/comments`, "POST", { content: reply.trim(), isInternal: inConsole ? internal : false }),
    onSuccess: () => {
      setReply("");
      refresh();
    },
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => send(`/api/tickets/${id}`, "PATCH", body),
    onSuccess: () => {
      refresh();
      toast({ title: "Updated" });
    },
  });

  const back = inConsole ? <Link href="/it/console/queue" className="it-back">← Incident queue</Link> : <Link href="/it/my" className="it-back">← My requests</Link>;
  if (q.isLoading) return <Shell console={inConsole}>{back}<Loading rows={6} /></Shell>;
  if (!q.data) return <Shell console={inConsole}>{back}<ErrorNote error={q.error ?? "Issue not found"} /></Shell>;
  const t = q.data;
  const closed = ["resolved", "closed"].includes(t.status);
  const canAssign = session?.isAdmin || session?.user.role === "manager";

  return (
    <Shell console={inConsole}>
      {back}
      <div className="it-detail-head">
        <div className="min-w-0 flex-1">
          <h1>{t.subject}</h1>
          <p className="it-muted">
            {t.ticketNumber.slice(0, 11)} · {t.category ?? "Issue"}{t.subcategory ? ` › ${t.subcategory}` : ""} · raised by {t.createdByName} · {stamp(t.createdAt)}
          </p>
        </div>
        {priorityChip(t.priority)}
        {statusChip(t.status)}
      </div>

      <div className="it-detail-grid">
        <div className="space-y-8">
          <section>
            <h2 className="it-h2">Description</h2>
            <p className="it-prose">{t.description}</p>
          </section>
          <section>
            <h2 className="it-h2">Conversation</h2>
            {t.comments.length === 0 ? (
              <p className="it-muted">No updates yet. {inConsole ? "Reply to let the person know it's being handled." : "IT will reply here."}</p>
            ) : (
              <ol className="it-thread">
                {t.comments.map((c) => (
                  <li key={c.id} className={c.isInternal ? "is-internal" : c.authorId === t.createdById ? "is-requester" : ""}>
                    <p className="it-thread-meta">
                      <b>{c.authorName}</b> · {stamp(c.createdAt)}
                      {c.isInternal && <span className="it-chip it-chip-grey ml-2"><Lock size={12} /> Internal note</span>}
                    </p>
                    <p className="it-prose">{c.content}</p>
                  </li>
                ))}
              </ol>
            )}
            <form
              className="it-reply"
              onSubmit={(e) => {
                e.preventDefault();
                if (reply.trim()) post.mutate();
              }}
            >
              <textarea
                className="it-input min-h-[96px]"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={inConsole ? (internal ? "Note for the IT team only" : "Reply to the person") : closed ? "Reply to reopen the conversation" : "Add information or reply to IT"}
                aria-label="Reply"
              />
              <div className="flex flex-wrap items-center gap-4">
                {inConsole && (
                  <label className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" className="it-check" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
                  </label>
                )}
                <ErrorNote error={post.error} />
                <button type="submit" className="it-btn it-btn-primary ml-auto" disabled={post.isPending || !reply.trim()}>
                  <Send size={15} /> {internal && inConsole ? "Add note" : "Send"}
                </button>
              </div>
            </form>
          </section>
        </div>

        <aside className="space-y-6">
          {inConsole ? (
            <section className="it-panel space-y-4">
              <h2>Work this incident</h2>
              <div>
                <label className="it-label" htmlFor="st">Status</label>
                <select id="st" className="it-input" value={t.status} onChange={(e) => patch.mutate({ status: e.target.value })} disabled={patch.isPending}>
                  {Object.entries(TICKET_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="it-label" htmlFor="pr">Priority</label>
                <select id="pr" className="it-input" value={t.priority} onChange={(e) => patch.mutate({ priority: e.target.value })} disabled={patch.isPending}>
                  {Object.entries(PRIORITY).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="it-label" htmlFor="as">Assigned to</label>
                {canAssign ? (
                  <select id="as" className="it-input" value={t.assigneeId ?? ""} onChange={(e) => patch.mutate({ assigneeId: e.target.value ? Number(e.target.value) : null })} disabled={patch.isPending}>
                    <option value="">Unassigned</option>
                    {(team.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <p>{t.assigneeName ?? "Unassigned"}</p>
                )}
              </div>
              <ErrorNote error={patch.error} />
              {!closed && (
                <button type="button" className="it-btn it-btn-primary w-full justify-center" disabled={patch.isPending} onClick={() => patch.mutate({ status: "resolved" })}>
                  <CheckCircle2 size={16} /> Resolve
                </button>
              )}
              <Link href={`/tickets/${t.id}`} className="it-link block text-[14px]">Open in OrbitDesk for AI analysis and history</Link>
            </section>
          ) : (
            <section className="it-panel space-y-2">
              <h2>Status</h2>
              <p>{TICKET_STATUS[t.status]?.label ?? t.status}</p>
              <p className="it-muted">Handled by {t.assigneeName ?? "the IT team"}. Updated {when(t.updatedAt)}.</p>
              {t.slaDeadline && !closed && <p className="it-muted">Target: {stamp(t.slaDeadline)}</p>}
            </section>
          )}
        </aside>
      </div>
    </Shell>
  );
}
