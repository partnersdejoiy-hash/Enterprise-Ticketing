// Orbit Executive Brief (#12) — daily/weekly operations summary.
// Every metric originates from database analytics; AI summary is labeled.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Sparkles, CalendarDays } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { intelFetch, formatDateTime } from "@/lib/intel";

interface Brief {
  id: number;
  period: string;
  brief_date: string;
  metrics: Record<string, number | string>;
  ai_summary: string | null;
  created_at: string;
}

const METRIC_LABELS: Record<string, string> = {
  major_incidents: "Major Incidents",
  sla_at_risk: "SLA At Risk",
  sla_breaches: "SLA Breaches",
  backlog: "Backlog",
  resolved: "Resolved",
  avg_resolution_hours: "Avg Resolution (h)",
  open_tickets: "Open Tickets",
  unassigned: "Unassigned",
};

export default function ExecutiveBrief() {
  const [period, setPeriod] = useState<"daily" | "weekly">("daily");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<{ brief: Brief | null }>({
    queryKey: ["brief", period],
    queryFn: () => intelFetch<{ brief: Brief | null }>(`/briefs/latest?period=${period}`),
  });

  const generate = useMutation({
    mutationFn: () => intelFetch<{ brief: Brief }>("/briefs/generate", {
      method: "POST",
      body: JSON.stringify({ period }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brief", period] });
      toast({ title: "Brief generated", description: "The executive brief is ready." });
    },
    onError: (e) => toast({ title: "Generation failed", description: String(e), variant: "destructive" }),
  });

  const brief = data?.brief;

  return (
    <AppLayout>
      <div className="p-6 space-y-4 max-w-5xl">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Executive Brief</h1>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as "daily" | "weekly")}>
            <TabsList>
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="weekly">Weekly</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="ml-auto" />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            {generate.isPending ? "Generating…" : "Generate Brief"}
          </Button>
        </div>

        {isLoading && <Skeleton className="h-64 w-full" />}
        {isError && (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
            Could not load the brief. <Button variant="outline" size="sm" className="ml-2" onClick={() => refetch()}>Retry</Button>
          </CardContent></Card>
        )}
        {data && !brief && (
          <Card><CardContent className="p-8 text-center">
            <CalendarDays className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No {period} brief generated yet.</p>
            <Button size="sm" className="mt-3" onClick={() => generate.mutate()} disabled={generate.isPending}>
              Generate the first brief
            </Button>
          </CardContent></Card>
        )}
        {brief && (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>OrbitDesk {period === "daily" ? "Daily" : "Weekly"} Operations Brief</span>
              <Badge variant="outline">{brief.brief_date}</Badge>
              <span className="text-xs">Generated {formatDateTime(brief.created_at)}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(brief.metrics).map(([k, v]) => (
                <Card key={k}>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">{v}</div>
                    <div className="text-[11px] uppercase text-muted-foreground">
                      {METRIC_LABELS[k] ?? k.replace(/_/g, " ")}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-500" /> AI Summary
                  <Badge variant="outline" className="text-[10px] font-normal">AI-generated</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {brief.ai_summary ? (
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{brief.ai_summary}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">No AI summary for this brief.</p>
                )}
              </CardContent>
            </Card>
            <p className="text-[11px] text-muted-foreground">
              All figures are computed from live database analytics. The narrative summary is AI-generated and should be verified before external sharing.
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
