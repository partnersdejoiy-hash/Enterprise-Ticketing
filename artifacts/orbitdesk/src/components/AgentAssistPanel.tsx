/**
 * AI Agent Assist panel (#28) — sidebar for the ticket workspace.
 *
 * Sections: SUMMARY, CUSTOMER, SIMILAR TICKETS, KNOWLEDGE,
 * RECOMMENDED ACTION, DRAFT RESPONSE, SLA RISK, SECURITY, NEXT ACTION.
 *
 * - Each section loads independently via React Query (no AI quota burned
 *   until the agent opens a section).
 * - Every AI output shows confidence + sources.
 * - Customer section shows only ticket facts — never inferred traits.
 * - Drafts are drafts: Copy / Insert-into-reply only. Never auto-sent.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  User,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  FileText,
  TicketIcon,
  Lightbulb,
  MessageSquare,
  AlertTriangle,
  Clock,
  RefreshCw,
} from "lucide-react";

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

interface Source {
  type: string;
  id: string;
  title: string;
}

function Confidence({ value }: { value: number }) {
  const color =
    value >= 75
      ? "bg-green-100 text-green-700 border-green-200"
      : value >= 50
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : "bg-red-100 text-red-700 border-red-200";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${color}`}>
      {value}% confidence
    </span>
  );
}

function Sources({ sources }: { sources: Source[] }) {
  if (!sources?.length) return null;
  return (
    <div className="mt-2">
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
        Sources
      </div>
      <div className="flex flex-wrap gap-1">
        {sources.map((s, i) => (
          <span
            key={i}
            className="text-[11px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded"
          >
            {s.type} · {s.title?.slice(0, 40)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 py-2.5 text-left hover:bg-muted/40 px-1 rounded"
      >
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide flex-1">
          {title}
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {open && <div className="pb-3 px-1">{children}</div>}
    </div>
  );
}

function QueryState({
  isLoading,
  isError,
  error,
  isEmpty,
  emptyText,
  onRetry,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isEmpty?: boolean;
  emptyText: string;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (isLoading)
    return (
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    );
  if (isError)
    return (
      <div className="text-xs text-muted-foreground">
        <p className="mb-2">
          {(error as Error)?.message || "Failed to load."}
        </p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="h-3 w-3 mr-1" /> Retry
        </Button>
      </div>
    );
  if (isEmpty) return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  return <>{children}</>;
}

const SLA_COLORS: Record<string, string> = {
  safe: "bg-green-100 text-green-700 border-green-200",
  at_risk: "bg-amber-100 text-amber-700 border-amber-200",
  critical: "bg-orange-100 text-orange-700 border-orange-200",
  breached: "bg-red-100 text-red-700 border-red-200",
  met: "bg-blue-100 text-blue-700 border-blue-200",
  no_policy: "bg-muted text-muted-foreground border-border",
};

export function AgentAssistPanel({
  ticketId,
  onInsertDraft,
  analysis, // result of one-click Analyze (optional, enriches panel)
}: {
  ticketId: number;
  onInsertDraft: (text: string) => void;
  analysis?: any;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [tone, setTone] = useState("professional");
  const [copied, setCopied] = useState(false);
  const [expandedKb, setExpandedKb] = useState<number | null>(null);

  const summaryQ = useQuery({
    queryKey: ["assist", "summary", ticketId],
    queryFn: () => api(`tickets/${ticketId}/summary`),
  });
  const customerQ = useQuery({
    queryKey: ["assist", "customer", ticketId],
    queryFn: () => api(`tickets/${ticketId}/customer`),
  });
  const similarQ = useQuery({
    queryKey: ["assist", "similar", ticketId],
    queryFn: () => api(`tickets/${ticketId}/similar`),
  });
  const knowledgeQ = useQuery({
    queryKey: ["assist", "knowledge", ticketId],
    queryFn: () => api(`tickets/${ticketId}/knowledge`),
  });

  const draftM = useMutation({
    mutationFn: () => api(`tickets/${ticketId}/draft`, { tone }),
  });

  const copyDraft = async () => {
    const text = draftM.data?.draft;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({ title: "Copied", description: "Draft copied to clipboard." });
  };

  const insertDraft = () => {
    const text = draftM.data?.draft;
    if (!text) return;
    onInsertDraft(text);
    toast({
      title: "Inserted",
      description: "Draft inserted into the reply box. Review before sending.",
    });
  };

  const sla = analysis?.sla_risk;
  const security = analysis?.security;

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">AI Agent Assist</h3>
        {analysis && <Confidence value={analysis.confidence} />}
      </div>
      <div className="px-3">
        {/* SUMMARY */}
        <Section icon={<FileText className="h-3.5 w-3.5" />} title="Summary">
          <QueryState
            isLoading={summaryQ.isLoading}
            isError={summaryQ.isError}
            error={summaryQ.error}
            onRetry={() => summaryQ.refetch()}
            isEmpty={!summaryQ.data?.summary}
            emptyText="No summary available."
          >
            <p className="text-xs leading-relaxed">{summaryQ.data?.summary}</p>
            {summaryQ.data?.key_points?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {summaryQ.data.key_points.map((p: string, i: number) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Confidence value={summaryQ.data?.confidence ?? 0} />
            </div>
            <Sources sources={summaryQ.data?.sources} />
          </QueryState>
        </Section>

        {/* CUSTOMER */}
        <Section
          icon={<User className="h-3.5 w-3.5" />}
          title="Customer"
          defaultOpen={false}
        >
          <QueryState
            isLoading={customerQ.isLoading}
            isError={customerQ.isError}
            error={customerQ.error}
            onRetry={() => customerQ.refetch()}
            isEmpty={!customerQ.data}
            emptyText="No customer info."
          >
            <dl className="text-xs space-y-1.5">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{customerQ.data?.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium break-all text-right">
                  {customerQ.data?.email ?? "—"}
                </dd>
              </div>
            </dl>
            <p className="text-[10px] text-muted-foreground mt-2 italic">
              Facts from the ticket only. Nothing inferred.
            </p>
          </QueryState>
        </Section>

        {/* SIMILAR TICKETS */}
        <Section
          icon={<TicketIcon className="h-3.5 w-3.5" />}
          title="Similar Tickets"
          defaultOpen={false}
        >
          <QueryState
            isLoading={similarQ.isLoading}
            isError={similarQ.isError}
            error={similarQ.error}
            onRetry={() => similarQ.refetch()}
            isEmpty={!similarQ.data?.similar_tickets?.length}
            emptyText="No similar tickets found."
          >
            <div className="space-y-1.5">
              {similarQ.data?.similar_tickets?.map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => setLocation(`/tickets/${t.id}`)}
                  className="w-full text-left p-2 rounded border border-border hover:border-primary hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">
                      {t.ticketNumber}
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {t.similarity}% match
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {t.subject}
                  </p>
                </button>
              ))}
            </div>
          </QueryState>
        </Section>

        {/* KNOWLEDGE */}
        <Section
          icon={<Lightbulb className="h-3.5 w-3.5" />}
          title="Knowledge"
          defaultOpen={false}
        >
          <QueryState
            isLoading={knowledgeQ.isLoading}
            isError={knowledgeQ.isError}
            error={knowledgeQ.error}
            onRetry={() => knowledgeQ.refetch()}
            isEmpty={!knowledgeQ.data?.knowledge?.length}
            emptyText="No relevant articles found."
          >
            <div className="space-y-1.5">
              {knowledgeQ.data?.knowledge?.map((k: any) => (
                <div
                  key={k.id}
                  className="p-2 rounded border border-border"
                >
                  <button
                    onClick={() =>
                      setExpandedKb(expandedKb === k.id ? null : k.id)
                    }
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium leading-snug">
                        {k.title}
                      </span>
                      {expandedKb === k.id ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                    </div>
                  </button>
                  {expandedKb === k.id && (
                    <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                      {k.excerpt}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </QueryState>
        </Section>

        {/* SLA RISK (from one-click analysis) */}
        {sla && (
          <Section icon={<Clock className="h-3.5 w-3.5" />} title="SLA Risk">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={SLA_COLORS[sla.health] ?? SLA_COLORS.no_policy}
              >
                {sla.health.replace(/_/g, " ").toUpperCase()}
              </Badge>
              {sla.policyName && (
                <span className="text-[11px] text-muted-foreground">
                  {sla.policyName}
                </span>
              )}
            </div>
            {sla.percentElapsed != null && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {sla.percentElapsed}% of resolution time elapsed
                {sla.remainingBusinessMinutes != null &&
                  ` · ~${sla.remainingBusinessMinutes}m remaining`}
              </p>
            )}
          </Section>
        )}

        {/* SECURITY (from one-click analysis) */}
        {security && security.highestRisk !== "none" && (
          <Section
            icon={<ShieldAlert className="h-3.5 w-3.5" />}
            title="Security"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-xs font-medium">
                {security.highestRisk.toUpperCase()} risk detected
              </span>
            </div>
            <div className="space-y-1">
              {security.findings.map((f: any, i: number) => (
                <p key={i} className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {f.detectionType.replace(/_/g, " ")}
                  </span>{" "}
                  · {f.riskLevel}
                </p>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 italic">
              Detection is not proof of malicious intent. Review before acting.
            </p>
          </Section>
        )}

        {/* RECOMMENDED ACTION (from one-click analysis) */}
        {analysis?.recommended_next_action && (
          <Section
            icon={<Lightbulb className="h-3.5 w-3.5" />}
            title="Recommended Action"
          >
            <p className="text-xs leading-relaxed">
              {analysis.recommended_next_action}
            </p>
            {analysis.intent && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                <span className="font-medium">Intent:</span> {analysis.intent}
              </p>
            )}
            {analysis.possible_root_cause && (
              <p className="text-[11px] text-muted-foreground mt-1">
                <span className="font-medium">Possible root cause:</span>{" "}
                {analysis.possible_root_cause}
              </p>
            )}
            <Sources sources={analysis.sources} />
          </Section>
        )}

        {/* DRAFT RESPONSE */}
        <Section
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          title="Draft Response"
          defaultOpen={false}
        >
          <div className="space-y-2">
            <div className="flex gap-2">
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="friendly">Friendly</SelectItem>
                  <SelectItem value="formal">Formal</SelectItem>
                  <SelectItem value="concise">Concise</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8"
                onClick={() => draftM.mutate()}
                disabled={draftM.isPending}
              >
                {draftM.isPending ? "Drafting…" : "Generate"}
              </Button>
            </div>
            {draftM.isPending && (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            )}
            {draftM.isError && (
              <div className="text-xs text-muted-foreground">
                <p className="mb-2">
                  {(draftM.error as Error)?.message || "Failed to draft."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => draftM.mutate()}
                >
                  <RefreshCw className="h-3 w-3 mr-1" /> Retry
                </Button>
              </div>
            )}
            {draftM.data?.draft && (
              <>
                <Textarea
                  value={draftM.data.draft}
                  readOnly
                  className="text-xs min-h-[140px] bg-muted/30"
                />
                <div className="flex items-center gap-2">
                  <Confidence value={draftM.data.confidence} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyDraft}>
                    {copied ? (
                      <Check className="h-3 w-3 mr-1" />
                    ) : (
                      <Copy className="h-3 w-3 mr-1" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button size="sm" onClick={insertDraft}>
                    Insert into reply
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  Draft only — review before sending. Never auto-sent.
                </p>
                <Sources sources={draftM.data.sources} />
              </>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
