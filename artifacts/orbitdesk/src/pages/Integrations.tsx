import { useQuery } from "@tanstack/react-query";
import {
  Globe2,
  ArrowRight,
  Link2,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { readApi } from "@/lib/operations";
import { useAuthStore } from "@/lib/auth";
type State = {
  configured: boolean;
  source: string;
  routes: { type: string; tag: string; inbox: string }[];
  receipts: { request_type: string; received: number; last_received: string }[];
};
export default function Integrations() {
  const id = useAuthStore((s) => s.user?.id);
  const query = useQuery({
    queryKey: ["business-integration", id],
    queryFn: () => readApi<State>("/api/integrations/business-site"),
  });
  return (
    <AppLayout>
      <div className="workspace-page">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">DEJOIY / CONNECTIONS</p>
            <h1>One connected service journey.</h1>
            <p>See how website requests enter your team's workspace.</p>
          </div>
        </div>
        <section className="operations-banner">
          <div>
            <span className="banner-label">
              <Globe2 size={14} /> BUSINESS.DEJOIY.COM
            </span>
            <h2>From form to ownership.</h2>
            <p>A direct, signed connection. No polling service required.</p>
          </div>
          <div className="banner-visual" aria-hidden="true">
            <div />
            <div />
            <span>
              <Link2 size={35} />
            </span>
          </div>
        </section>
        {query.isError ? (
          <div className="workspace-error" role="alert">
            <AlertCircle />
            {query.error.message}
          </div>
        ) : query.isLoading ? (
          <div className="workspace-empty">Loading connection details…</div>
        ) : (
          <>
            <section className="workspace-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">WEBSITE INTAKE</p>
                  <h2>
                    {query.data?.configured
                      ? "Intake key configured"
                      : "Setup required"}
                  </h2>
                </div>
                <span
                  className={`work-status ${query.data?.configured ? "status-resolved" : "status-waiting"}`}
                >
                  {query.data?.configured
                    ? "Ready to receive signed requests"
                    : "Not connected"}
                </span>
              </div>
              <div
                className="verification-banner"
                style={{ margin: "0 24px 24px" }}
              >
                <ShieldCheck />
                <div>
                  <h2>Authorisation stays private.</h2>
                  <p>
                    Tickets, source PDFs and history are saved together.
                    Successful intake means the request is recorded; staff still
                    need to review the authorisation.
                  </p>
                </div>
              </div>
              <div className="work-table-wrap">
                <table className="work-table">
                  <thead>
                    <tr>
                      <th>Request type</th>
                      <th>Notification inbox</th>
                      <th>Recorded</th>
                      <th>Last received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data?.routes.map((r) => {
                      const record = query.data?.receipts.find(
                        (x) => x.request_type === r.type,
                      );
                      return (
                        <tr key={r.type}>
                          <td>
                            {r.type === "background-verification"
                              ? "Background verification"
                              : "Employment verification"}
                          </td>
                          <td>{r.inbox}</td>
                          <td>{record?.received ?? 0}</td>
                          <td>
                            {record
                              ? new Date(record.last_received).toLocaleString(
                                  "en-IN",
                                )
                              : "No requests yet"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="panel-footnote">
                Key configuration alone does not prove the website is connected.
                A recorded receipt confirms that a request reached this
                database.
              </p>
            </section>
            <section
              className="workspace-panel"
              style={{ marginTop: 24, padding: 24 }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>
                Connection checklist
              </h2>
              <ol
                style={{
                  fontSize: 13,
                  color: "#748098",
                  lineHeight: 2,
                  paddingLeft: 20,
                  listStyle: "decimal",
                  marginTop: 12,
                }}
              >
                <li>
                  Apply the database migration and configure the same intake key
                  on both servers.
                </li>
                <li>
                  Confirm the approved HR and BGV department IDs and their
                  existing members.
                </li>
                <li>
                  Set the website's OrbitDesk HTTPS origin, then enable its
                  integration.
                </li>
                <li>
                  Submit an approved test request and match its ticket number in
                  the correct queue.
                </li>
              </ol>
              <p
                className="panel-footnote"
                style={{ paddingLeft: 0, marginTop: 18 }}
              >
                Detailed setup: DEPLOYMENT.md in the repository. Secrets are
                never displayed here.
              </p>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
