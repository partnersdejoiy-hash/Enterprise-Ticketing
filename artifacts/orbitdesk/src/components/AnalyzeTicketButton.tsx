/**
 * One-Click Ticket Intelligence (#29) — "Analyze Ticket" button.
 *
 * Triggers the full intelligence pipeline (summary + triage + SLA +
 * similar tickets + knowledge + draft) and shows results in a modal
 * with a progress indicator. Results are also fed back to the
 * AgentAssistPanel via onAnalysis.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";

async function api(path: string, body?: unknown, method = "POST") {
  const r = await fetch("/api/assist/" + path, {
    method: body === undefined ? "GET" : method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || "Request failed");
  return v;
}

const SLA_COLORS: Record<string, string> = {
  safe: "bg-green-100 text-green-700 border-green-200",
  at_risk: "bg-amber-100 text-amber-700 border-amber-200",
  critical: "bg-orange-100 text-orange-700 border-orange-200",
  breached: "bg-red-100 text-red-700 border-red-200",
  met: "bg-blue-100 text-blue-700 border-blue-200",
  no_policy: "bg-muted text-muted-foreground border-border",
};

export function AnalyzeTicketButton({
  ticketId,
  onAnalysis,
}: {
  ticketId: number;
  onAnalysis: (result: any) => void;
}) {
  const [open, setOpen] = useState(false);

  const analyzeM = useMutation({
    mutationFn: () => api(`tickets/${ticketId}/analyze`, {}),
    onSuccess: (data) => {
      onAnalysis(data);
    },
  });

  const start = () => {
    setOpen(true);
    analyzeM.mutate();
  };

  const d = analyzeM.data;

  return (
    <>
      <Button onClick={start} disabled={analyzeM.isPending} size="sm">
        {analyzeM.isPending ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
        )}
        {analyzeM.isPending ? "Analyzing…" : "Analyze Ticket"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Ticket Intelligence
            </DialogTitle>
            <DialogDescription>
              AI analysis grounded in ticket data, similar tickets, knowledge
              base, and SLA status.
            </DialogDescription>
          </DialogHeader>

          {analyzeM.isPending && (
            <div className="space-y-3 py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Running summary, triage, SLA check, similarity search,
                knowledge lookup, and draft…
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {analyzeM.isError && (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                {(analyzeM.error as Error)?.message || "Analysis failed."}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => analyzeM.mutate()}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Retry
              </Button>
            </div>
          )}

          {d && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">
                  {d.confidence}% confidence
                </Badge>
                <Badge
                  variant="outline"
                  className={SLA_COLORS[d.sla_risk?.health] ?? SLA_COLORS.no_policy}
                >
                  SLA: {d.sla_risk?.health?.replace(/_/g, " ").toUpperCase()}
                </Badge>
                <Badge variant="outline">
                  Priority: {d.priority_recommendation?.toUpperCase()}
                </Badge>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide mb-1">
                  Summary
                </h4>
                <p className="text-sm leading-relaxed">{d.summary}</p>
                {d.key_points?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {d.key_points.map((p: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                        <span className="text-primary">•</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-border rounded-lg p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide mb-1">
                    Intent
                  </h4>
                  <p className="text-xs">{d.intent || "—"}</p>
                </div>
                <div className="border border-border rounded-lg p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide mb-1">
                    Next Best Action
                  </h4>
                  <p className="text-xs">{d.recommended_next_action || "—"}</p>
                </div>
              </div>

              {d.possible_root_cause && (
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide mb-1">
                    Possible Root Cause
                  </h4>
                  <p className="text-xs">{d.possible_root_cause}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 italic">
                    Candidate only — confirm before acting.
                  </p>
                </div>
              )}

              {d.similar_tickets?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide mb-1.5">
                    Similar Tickets ({d.similar_tickets.length})
                  </h4>
                  <div className="space-y-1">
                    {d.similar_tickets.map((t: any) => (
                      <div
                        key={t.id}
                        className="text-xs flex items-center justify-between gap-2 border border-border rounded px-2 py-1.5"
                      >
                        <span className="truncate">
                          <span className="font-medium">{t.ticketNumber}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            · {t.subject}
                          </span>
                        </span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {t.similarity}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {d.recommended_knowledge?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide mb-1.5">
                    Recommended Knowledge
                  </h4>
                  <div className="space-y-1">
                    {d.recommended_knowledge.map((k: any) => (
                      <p key={k.id} className="text-xs text-muted-foreground">
                        • {k.title}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {d.security?.highestRisk !== "none" && (
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide mb-1">
                    Security Findings
                  </h4>
                  {d.security.findings.map((f: any, i: number) => (
                    <p key={i} className="text-xs">
                      {f.detectionType.replace(/_/g, " ")} · {f.riskLevel}
                    </p>
                  ))}
                  <p className="text-[10px] text-muted-foreground mt-1 italic">
                    Detection is not proof of malicious intent.
                  </p>
                </div>
              )}

              {d.draft_response && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide mb-1.5">
                    Draft Response
                  </h4>
                  <p className="text-xs leading-relaxed bg-muted/40 border border-border rounded-lg p-3 whitespace-pre-wrap">
                    {d.draft_response}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1 italic">
                    Draft only — use the Assist panel to copy or insert it into
                    your reply.
                  </p>
                </div>
              )}

              {d.sources?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide mb-1">
                    Sources
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {d.sources.map((s: any, i: number) => (
                      <span
                        key={i}
                        className="text-[11px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded"
                      >
                        {s.type} · {String(s.title).slice(0, 40)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
