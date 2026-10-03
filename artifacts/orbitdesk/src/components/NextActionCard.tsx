/**
 * Next-Best-Action Card (Superpower #19).
 * Deterministic, explainable recommendation: what to do next, why,
 * and the evidence behind it. Advisory only — the agent decides.
 */
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchNextAction } from "@/lib/intelligence";
import { Compass, CheckCircle2 } from "lucide-react";

export function NextActionCard({ ticketId }: { ticketId: number }) {
  const query = useQuery({
    queryKey: ["next-action", ticketId],
    queryFn: () => fetchNextAction(ticketId),
  });
  const na = query.data?.nextAction;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
        <Compass className="h-4 w-4 text-emerald-600" /> Next Best Action
      </h3>

      {query.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      )}

      {query.isError && (
        <div className="text-sm text-muted-foreground">
          Couldn't compute a recommendation.{" "}
          <button className="underline" onClick={() => query.refetch()}>
            Try again
          </button>
        </div>
      )}

      {query.isSuccess && na && (
        <div>
          {na.action === "none" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {na.title} — {na.reason}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {na.title}
                </span>
                <Badge variant="outline" className="text-xs shrink-0">
                  {na.confidence}%
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {na.reason}
              </p>
              {na.evidence.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {na.evidence.map((e) => (
                    <Badge
                      key={e.fact}
                      variant="secondary"
                      className="text-[11px]"
                      title={e.fact}
                    >
                      {e.fact}: {e.value}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
