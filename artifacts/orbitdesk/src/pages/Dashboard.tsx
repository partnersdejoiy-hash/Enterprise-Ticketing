import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  RefreshCw,
  Layers3,
  Clock3,
  ShieldCheck,
  BriefcaseBusiness,
  Globe2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuthStore } from "@/lib/auth";
import { readApi, type Operations, statusText } from "@/lib/operations";
export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const query = useQuery({
    queryKey: ["operations", user?.id],
    queryFn: () => readApi<Operations>("/api/operations"),
  });
  const s = query.data?.summary;
  const max = Math.max(1, ...(query.data?.daily.map((d) => d.count) || []));
  return (
    <AppLayout>
      <div className="workspace-page">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">DEJOIY / SERVICE OPERATIONS</p>
            <h1>A clear view. A better day.</h1>
            <p>
              Welcome back, {user?.name.split(" ")[0]}. Here’s the work that
              needs your team.
            </p>
          </div>
          <Link href="/tickets/new" className="primary-action">
            <Plus size={17} /> New ticket
          </Link>
        </div>
        <section className="operations-banner">
          <div>
            <span className="banner-label">
              <span /> YOUR OPERATIONS, CONNECTED
            </span>
            <h2>
              Great service starts
              <br />
              with clear ownership.
            </h2>
            <p>
              One workspace for requests, evidence and the next right action.
            </p>
            <Link href="/tickets">
              Open your work queue <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="banner-visual" aria-hidden="true">
            <div />
            <div />
            <div />
            <span>
              <Layers3 size={37} />
            </span>
          </div>
        </section>
        {query.isError ? (
          <div className="workspace-error" role="alert">
            <AlertCircle />
            {query.error.message}
            <button onClick={() => query.refetch()}>Try again</button>
          </div>
        ) : (
          <>
            <div className="metrics-grid">
              {[
                {
                  label: "Active requests",
                  value: s?.active,
                  icon: Layers3,
                  note: "Open, assigned and in progress",
                },
                {
                  label: "Awaiting owner",
                  value: s?.unassigned,
                  icon: Clock3,
                  note: "Ready for your team to pick up",
                },
                {
                  label: "Past target",
                  value: s?.overdue,
                  icon: AlertCircle,
                  note: "Active requests past their deadline",
                },
                {
                  label: "Resolved & closed",
                  value: s?.resolved,
                  icon: CheckCircle2,
                  note: "Completed across your visible queue",
                },
              ].map((m) => (
                <article className="metric-card" key={m.label}>
                  <div>
                    <span>{m.label}</span>
                    <m.icon size={17} />
                  </div>
                  <strong>{query.isLoading ? "—" : (m.value ?? 0)}</strong>
                  <p>{m.note}</p>
                </article>
              ))}
            </div>
            <div className="operations-columns">
              <section className="workspace-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">THE WORKSPACE</p>
                    <h2>Specialist queues</h2>
                  </div>
                  <ShieldCheck size={20} />
                </div>
                <Link className="queue-link" href="/employment-verification">
                  <span className="queue-icon">
                    <BriefcaseBusiness size={22} />
                  </span>
                  <div>
                    <h3>Employment verification</h3>
                    <p>Requests, authorisations and review history</p>
                  </div>
                  <strong>{s?.employment ?? "—"}</strong>
                  <ArrowUpRight size={18} />
                </Link>
                <Link className="queue-link" href="/background-verification">
                  <span className="queue-icon mint">
                    <ShieldCheck size={22} />
                  </span>
                  <div>
                    <h3>Background verification</h3>
                    <p>A dedicated workspace for BGV requests</p>
                  </div>
                  <strong>{s?.bgv ?? "—"}</strong>
                  <ArrowUpRight size={18} />
                </Link>
                <div className="panel-footnote">
                  <Globe2 size={15} />
                  {s?.website ?? 0} website requests recorded in your visible
                  queue
                </div>
              </section>
              <section className="workspace-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">LAST 7 DAYS</p>
                    <h2>Incoming requests</h2>
                  </div>
                  <span className="small-label">Recorded activity</span>
                </div>
                <div
                  className="activity-chart"
                  aria-label="Requests received over the last seven days"
                >
                  {query.data?.daily.length ? (
                    query.data.daily.map((d) => (
                      <div className="chart-column" key={d.day}>
                        <span>{d.count}</span>
                        <div
                          style={{
                            height: `${Math.max(5, (d.count / max) * 100)}px`,
                          }}
                        />
                        <small>
                          {new Date(d.day + "T12:00:00").toLocaleDateString(
                            "en-IN",
                            { day: "numeric", month: "short" },
                          )}
                        </small>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">
                      Your activity will appear here when requests arrive.
                    </p>
                  )}
                </div>
                <div className="panel-footnote">
                  Counts follow your access permissions.
                </div>
              </section>
            </div>
            {!!query.data?.departments.length && (
              <section className="workspace-panel department-overview">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">DEPARTMENT VIEW</p>
                    <h2>Clear routes. Shared accountability.</h2>
                  </div>
                </div>
                <div className="department-chips">
                  {query.data.departments.map((d) => (
                    <Link
                      key={d.id ?? 0}
                      href={
                        d.id
                          ? `/tickets?departmentId=${d.id}`
                          : "/tickets?unassignedDepartment=true"
                      }
                    >
                      <span>{d.name || "Admin triage"}</span>
                      <strong>{d.count}</strong>
                      <ArrowUpRight size={15} />
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <section className="workspace-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">KEEP THINGS MOVING</p>
                  <h2>Latest requests</h2>
                </div>
                <button
                  className="quiet-button"
                  onClick={() => query.refetch()}
                  disabled={query.isFetching}
                >
                  <RefreshCw
                    size={15}
                    className={query.isFetching ? "animate-spin" : ""}
                  />{" "}
                  Refresh
                </button>
              </div>
              <div className="work-table-wrap">
                <table className="work-table">
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Queue</th>
                      <th>Status</th>
                      <th>Received</th>
                      <th>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data?.recent.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <Link href={`/tickets/${t.id}`}>
                            <small>{t.ticketNumber}</small>
                            <strong>{t.subject}</strong>
                          </Link>
                        </td>
                        <td>
                          {t.tags.includes("bgv-request")
                            ? "BGV"
                            : t.tags.includes("employment-verification")
                              ? "Employment"
                              : "Service desk"}
                        </td>
                        <td>
                          <span className={`work-status status-${t.status}`}>
                            {statusText[t.status]}
                          </span>
                        </td>
                        <td>
                          {new Date(t.createdAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                        </td>
                        <td>
                          <Link
                            href={`/tickets/${t.id}`}
                            aria-label={`Open ${t.ticketNumber}`}
                          >
                            <ArrowUpRight size={17} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!query.isLoading && !query.data?.recent.length && (
                  <div className="workspace-empty">
                    <Layers3 />
                    <h3>Your workspace is ready.</h3>
                    <p>
                      New requests will appear here, with their owner and next
                      step.
                    </p>
                    <Link href="/tickets/new">
                      Create a ticket <ArrowRight size={15} />
                    </Link>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
        <p className="workspace-timestamp">
          {query.data
            ? `Updated ${new Date(query.data.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · Only requests you can access are shown.`
            : "Loading your workspace…"}
        </p>
      </div>
    </AppLayout>
  );
}
