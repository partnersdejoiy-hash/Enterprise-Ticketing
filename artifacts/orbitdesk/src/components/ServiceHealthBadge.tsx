// Service Health badge (#26) with explainable breakdown modal.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { intelFetch } from "@/lib/intel";
import { cn } from "@/lib/utils";

const LEVEL_STYLES: Record<string, string> = {
  healthy: "bg-emerald-100 text-emerald-800 border-emerald-200",
  watch: "bg-yellow-100 text-yellow-800 border-yellow-200",
  at_risk: "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-red-100 text-red-800 border-red-200",
};

interface HealthDetail {
  id: number;
  name: string;
  health: string;
  health_score: number | null;
  breakdown: { factor: string; value: string | number; weight: number; detail?: string }[];
  health_computed_at: string | null;
}

export default function ServiceHealthBadge({ ciId, compact }: { ciId: number; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<HealthDetail>({
    queryKey: ["service-health", ciId],
    queryFn: () => intelFetch<HealthDetail>(`/service-health/${ciId}`),
    enabled: open, // fetch breakdown only when opened
  });
  const { data: summary } = useQuery<{ health: string; health_score: number | null }>({
    queryKey: ["service-health-summary", ciId],
    queryFn: () => intelFetch(`/service-health/${ciId}/summary`),
  });

  if (isLoading || !summary) {
    return compact ? <Skeleton className="h-5 w-16" /> : <Skeleton className="h-6 w-24" />;
  }
  const level = summary.health ?? "healthy";
  return (
    <>
      <Badge
        variant="outline"
        className={cn("cursor-pointer", LEVEL_STYLES[level] ?? "")}
        onClick={() => setOpen(true)}
        title="Click for health breakdown"
      >
        {level.replace("_", " ").toUpperCase()}
        {summary.health_score != null && ` · ${Math.round(summary.health_score)}`}
      </Badge>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Service Health — {data?.name ?? "…"}</DialogTitle>
          </DialogHeader>
          {!data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={LEVEL_STYLES[data.health]}>
                  {data.health.replace("_", " ").toUpperCase()}
                </Badge>
                {data.health_score != null && (
                  <div className="flex-1">
                    <Progress value={data.health_score} className="h-2" />
                  </div>
                )}
                <span className="text-sm font-semibold">{data.health_score != null ? Math.round(data.health_score) : "—"}</span>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Why this score</p>
                {data.breakdown.map((b, i) => (
                  <div key={i} className="text-sm border rounded-md p-2.5">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{b.factor.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">{b.value}</span>
                    </div>
                    {b.detail && <p className="text-xs text-muted-foreground mt-1">{b.detail}</p>}
                    <p className="text-[11px] text-muted-foreground mt-0.5">Weight: {Math.round(b.weight * 100)}%</p>
                  </div>
                ))}
                {data.breakdown.length === 0 && (
                  <p className="text-sm text-muted-foreground">No contributing signals yet.</p>
                )}
              </div>
              {data.health_computed_at && (
                <p className="text-[11px] text-muted-foreground">Computed {new Date(data.health_computed_at).toLocaleString("en-IN")}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
