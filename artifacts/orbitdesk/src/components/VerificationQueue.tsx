import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ShieldCheck,
  BriefcaseBusiness,
  Search,
  RefreshCw,
  ArrowUpRight,
  Plus,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  AlertCircle,
} from "lucide-react";
import { AppLayout } from "./layout/AppLayout";
import { readApi, statusText, type WorkTicket } from "@/lib/operations";
import { useAuthStore } from "@/lib/auth";
export default function VerificationQueue({ bgv = false }: { bgv?: boolean }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const user = useAuthStore((s) => s.user);
  const tag = bgv ? "bgv-request" : "employment-verification";
  const title = bgv ? "Background verification" : "Employment verification";
  const Icon = bgv ? ShieldCheck : BriefcaseBusiness;
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const query = useQuery({
    queryKey: ["verification", tag, term, status, page, user?.id],
    queryFn: () =>
      readApi<{ tickets: WorkTicket[]; total: number; totalPages: number }>(
        `/api/tickets?${new URLSearchParams({ tags: tag, search: term, status, page: String(page), limit: "20" })}`,
      ),
  });
  return (
    <AppLayout>
      <div className="workspace-page">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">DEJOIY / VERIFICATION DESK</p>
            <h1>{title}</h1>
            <p>
              Every request, its authorisation and the next step. In one place.
            </p>
          </div>
          <Link className="primary-action" href={`/tickets/new?queue=${tag}`}>
            <Plus size={17} /> New request
          </Link>
        </div>
        <section className="verification-banner">
          <span className="queue-icon">
            <Icon size={28} />
          </span>
          <div>
            <h2>
              {bgv
                ? "Thoughtful checks. Clear accountability."
                : "Employment requests, handled with care."}
            </h2>
            <p>
              Website submissions are marked “Website”. Review the authorisation
              before sharing any employee information.
            </p>
          </div>
          <LockKeyhole size={22} />
        </section>
        <section className="workspace-panel">
          <div className="queue-toolbar">
            <label className="queue-search">
              <Search size={18} />
              <input
                aria-label="Search verification requests"
                placeholder="Search name, ticket or subject…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {Object.entries(statusText).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button
              className="quiet-button"
              aria-label="Refresh requests"
              disabled={query.isFetching}
              onClick={() => query.refetch()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          {query.isError ? (
            <div className="workspace-error" role="alert">
              <AlertCircle />
              {query.error.message}
              <button onClick={() => query.refetch()}>Try again</button>
            </div>
          ) : query.isLoading ? (
            <div className="workspace-empty" role="status">
              Loading requests…
            </div>
          ) : (
            <>
              <div className="work-table-wrap">
                <table className="work-table">
                  <thead>
                    <tr>
                      <th>Request / employee</th>
                      <th>Status</th>
                      <th>Owner</th>
                      <th>Received</th>
                      <th>Source</th>
                      <th>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data?.tickets.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <Link href={`/tickets/${t.id}`}>
                            <small>{t.ticketNumber}</small>
                            <strong>{t.subject}</strong>
                            <span>{t.raisedForName}</span>
                          </Link>
                        </td>
                        <td>
                          <span className={`work-status status-${t.status}`}>
                            {statusText[t.status]}
                          </span>
                        </td>
                        <td>
                          {t.assigneeName || (
                            <span className="unassigned">Unassigned</span>
                          )}
                        </td>
                        <td>
                          {new Date(t.createdAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td>
                          <span className="source-badge">
                            {t.tags.includes("business-website")
                              ? "Website"
                              : "Internal"}
                          </span>
                        </td>
                        <td>
                          <Link
                            href={`/tickets/${t.id}`}
                            aria-label={`Open ${t.ticketNumber}`}
                          >
                            <ArrowUpRight size={18} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!query.data?.tickets.length && (
                <div className="workspace-empty">
                  <Icon size={38} />
                  <h3>
                    {term || status
                      ? "No matching requests"
                      : "Ready for your first request"}
                  </h3>
                  <p>
                    {term || status
                      ? "Try another search or status."
                      : "Requests will appear here after they are saved to this queue."}
                  </p>
                </div>
              )}
              <div className="queue-pagination">
                <span>{query.data?.total ?? 0} matching requests</span>
                <div>
                  <button
                    aria-label="Previous page"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>
                    Page {page} of {Math.max(1, query.data?.totalPages ?? 1)}
                  </span>
                  <button
                    aria-label="Next page"
                    disabled={page >= (query.data?.totalPages ?? 1)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
        <p className="workspace-timestamp">
          Resolved and closed describe workflow status. They do not certify an
          employee or background-check outcome.
        </p>
      </div>
    </AppLayout>
  );
}
