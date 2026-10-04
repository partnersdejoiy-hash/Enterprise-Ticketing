// Orbit Superpower Command Center (#30).
// One aggregated view over live operations — every number from real tables
// via GET /api/command-center/summary. Auto-refreshes every 30s.
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  Bot,
  Clock,
  Radar,
  ShieldAlert,
  Zap,
  HeartPulse,
  Users,
  FileText,
  TrendingUp,
  RefreshCw,
  Flame,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { intelFetch, formatDateTime } from "@/lib/intel";

interface CommandSummary {
  generated_at: string;
  live_ops: { open_tickets: number; unassigned: number; major_incidents_open: number };
  sla_intelligence: { safe: number; at_risk: number; critical: number; breached: number };
  ai_triage: { pending: number; today: number };
  major_incidents: { id: number; incident_number: string; title: string; severity: string }[];
  service_health: Record<string, number>;
  queue_health: { department: string; unassigned: number }[];
  predictive_risks: { id: number; title: string; risk_level: string }[];
  security_alerts: { id: number; detection_type: string; risk_level: string }[];
  automation_health: { total_24h: number; success_rate: number };
  ai_activity: { feature: string; count: number }[];
  knowledge_gaps: { id: number; suggested_title: string; occurrence_count: number }[];
  workload_forecast: { predicted_volume: number; confidence: string } | null;
  executive_brief: { id: number; briefDate: string } | null;
}

function Section({
  title,
  icon,
  link,
  linkLabel,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  link?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <CardTitle className="text-sm">{title}</CardTitle>
          {link && (
            <Link href={link} className="ml-auto text-xs text-primary hover:underline">
              {linkLabel ?? "Open →"}
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className={`text-2xl font-bold ${tone ?? ""}`}>{value}</span>
      <span className="text-[11px] text-muted-foreground uppercase">{label}</span>
    </div>
  );
}

export default function CommandCenter() {
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery<CommandSummary>({
    queryKey: ["command-center"],
    queryFn: () => intelFetch<CommandSummary>("/command-center/summary"),
    refetchInterval: 30_000,
  });

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Command Center</h1>
          <Badge variant="outline" className="text-[11px]">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1 animate-pulse" />
            LIVE
          </Badge>
          <span className="text-xs text-muted-foreground ml-auto">
            {data ? `Updated ${formatDateTime(data.generated_at)}` : ""}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        )}
        {isError && (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-sm text-muted-foreground">Could not load command center.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
            </CardContent>
          </Card>
        )}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Section title="Live Operations" icon={<Activity className="h-4 w-4" />} link="/tickets" linkLabel="Tickets →">
              <div className="flex gap-6">
                <Stat label="Open" value={data.live_ops.open_tickets} />
                <Stat label="Unassigned" value={data.live_ops.unassigned} tone={data.live_ops.unassigned > 0 ? "text-amber-600" : ""} />
                <Stat label="Major incidents" value={data.live_ops.major_incidents_open} tone={data.live_ops.major_incidents_open > 0 ? "text-red-600" : ""} />
              </div>
            </Section>

            <Section title="SLA Intelligence" icon={<Clock className="h-4 w-4" />} link="/sla-policies" linkLabel="Policies →">
              <div className="flex gap-5">
                <Stat label="Safe" value={data.sla_intelligence.safe} tone="text-emerald-600" />
                <Stat label="At risk" value={data.sla_intelligence.at_risk} tone="text-amber-600" />
                <Stat label="Critical" value={data.sla_intelligence.critical} tone="text-orange-600" />
                <Stat label="Breached" value={data.sla_intelligence.breached} tone="text-red-600" />
              </div>
            </Section>

            <Section title="Major Incidents" icon={<Flame className="h-4 w-4" />} link="/incidents" linkLabel="Incidents →">
              {data.major_incidents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active major incidents.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.major_incidents.slice(0, 4).map((m) => (
                    <li key={m.id} className="text-sm flex items-center gap-2">
                      <Badge variant="destructive" className="text-[10px]">{m.severity}</Badge>
                      <Link href={`/incidents`} className="hover:underline truncate">{m.title}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Service Health" icon={<HeartPulse className="h-4 w-4" />}>
              <div className="flex gap-5">
                {Object.entries(data.service_health).map(([level, count]) => (
                  <Stat key={level} label={level.replace("_", " ")} value={count} />
                ))}
                {Object.keys(data.service_health).length === 0 && (
                  <p className="text-sm text-muted-foreground">No services tracked yet.</p>
                )}
              </div>
            </Section>

            <Section title="Queue Health" icon={<Users className="h-4 w-4" />} link="/tickets" linkLabel="Tickets →">
              {data.queue_health.length === 0 ? (
                <p className="text-sm text-muted-foreground">All queues assigned.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.queue_health.slice(0, 5).map((q) => (
                    <li key={q.department} className="flex justify-between">
                      <span className="truncate">{q.department}</span>
                      <Badge variant="outline">{q.unassigned} unassigned</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Predictive Risks" icon={<Radar className="h-4 w-4" />} link="/risks" linkLabel="Risks →">
              {data.predictive_risks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No elevated risks detected.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.predictive_risks.slice(0, 4).map((r) => (
                    <li key={r.id} className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span className="truncate">{r.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Security Alerts" icon={<ShieldAlert className="h-4 w-4" />}>
              {data.security_alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open detections.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.security_alerts.slice(0, 4).map((s) => (
                    <li key={s.id} className="text-sm flex items-center gap-2">
                      <Badge variant={s.risk_level === "critical" ? "destructive" : "outline"} className="text-[10px]">
                        {s.risk_level}
                      </Badge>
                      <span className="truncate">{s.detection_type.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Automation Health" icon={<Zap className="h-4 w-4" />} link="/automation-rules" linkLabel="Rules →">
              <div className="flex gap-6">
                <Stat label="Runs (24h)" value={data.automation_health.total_24h} />
                <Stat label="Success" value={`${Math.round(data.automation_health.success_rate * 100)}%`} />
              </div>
            </Section>

            <Section title="AI Activity" icon={<Bot className="h-4 w-4" />}>
              {data.ai_activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No AI analyses yet today.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.ai_activity.slice(0, 5).map((a) => (
                    <li key={a.feature} className="flex justify-between">
                      <span className="truncate">{a.feature.replace(/_/g, " ")}</span>
                      <Badge variant="outline">{a.count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Knowledge Gaps" icon={<FileText className="h-4 w-4" />} link="/knowledge" linkLabel="Knowledge →">
              {data.knowledge_gaps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No gaps detected.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.knowledge_gaps.slice(0, 4).map((g) => (
                    <li key={g.id} className="text-sm truncate">{g.suggested_title}</li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Workload Forecast" icon={<TrendingUp className="h-4 w-4" />}>
              {data.workload_forecast ? (
                <div className="flex gap-6 items-center">
                  <Stat label="Expected today" value={data.workload_forecast.predicted_volume} />
                  <Badge variant="outline">{data.workload_forecast.confidence} confidence</Badge>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No forecast available.</p>
              )}
            </Section>

            <Section title="Executive Brief" icon={<FileText className="h-4 w-4" />} link="/briefs" linkLabel="Briefs →">
              {data.executive_brief ? (
                <p className="text-sm">Latest daily brief ready.</p>
              ) : (
                <p className="text-sm text-muted-foreground">No brief generated yet.</p>
              )}
            </Section>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Last refreshed {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN") : "—"} · All figures from live database queries.
        </p>
      </div>
    </AppLayout>
  );
}
