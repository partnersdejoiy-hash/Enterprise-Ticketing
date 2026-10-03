// AI Impact Analysis (#17) — advisory analysis before change approval.
// Shows affected services, risk, rollback concerns with evidence.
// Human approval is always required; this never auto-approves.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScanSearch, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { intelFetch } from "@/lib/intel";

interface ImpactData {
  potential_impact: string;
  risk_level: string;
  affected_services: { name: string; departments: string[] }[];
  affected_customers_estimate: number | null;
  rollback_concerns: string[];
  evidence: { label: string; detail: string }[];
  confidence: number;
}

const RISK_STYLES: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-red-100 text-red-800 border-red-200",
};

export default function ImpactAnalysis({ changeId }: { changeId: number }) {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<{ impact: ImpactData | null }>({
    queryKey: ["change-impact", changeId],
    queryFn: () => intelFetch<{ impact: ImpactData | null }>(`/changes/${changeId}/impact`),
  });

  const analyze = useMutation({
    mutationFn: () => intelFetch<{ impact: ImpactData }>(`/changes/${changeId}/analyze`, { method: "POST" }),
    onSuccess: () => refetch(),
    onError: (e) => toast({ title: "Analysis failed", description: String(e), variant: "destructive" }),
  });

  const impact = data?.impact;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <ScanSearch className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">AI Impact Analysis</CardTitle>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => analyze.mutate()} disabled={analyze.isPending}>
            {analyze.isPending ? "Analyzing…" : impact ? "Re-analyze" : "Analyze Impact"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-32 w-full" />}
        {!isLoading && !impact && (
          <p className="text-sm text-muted-foreground">
            Run impact analysis to see affected services, risk level and rollback concerns before approving this change.
          </p>
        )}
        {impact && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={RISK_STYLES[impact.risk_level] ?? ""}>
                {impact.risk_level.toUpperCase()} RISK
              </Badge>
              <span className="text-xs text-muted-foreground">Confidence {Math.round(impact.confidence)}%</span>
            </div>
            <p className="text-sm">{impact.potential_impact}</p>
            {impact.affected_services.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Affected services</p>
                <ul className="space-y-1">
                  {impact.affected_services.map((s, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{s.name}</span>
                      {s.departments.length > 0 && (
                        <span className="text-muted-foreground"> — {s.departments.join(", ")}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {impact.rollback_concerns.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Rollback concerns
                </p>
                <ul className="list-disc list-inside text-sm space-y-0.5">
                  {impact.rollback_concerns.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {impact.evidence.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Evidence
                </p>
                <ul className="space-y-1">
                  {impact.evidence.map((e, i) => (
                    <li key={i} className="text-xs border rounded p-2">
                      <span className="font-medium">{e.label}:</span> {e.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Advisory only — a human must approve or reject this change. The analysis never executes changes.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
