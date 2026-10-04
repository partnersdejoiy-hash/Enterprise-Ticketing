import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SlaHealth =
  | "safe"
  | "at_risk"
  | "critical"
  | "breached"
  | "met"
  | "no_policy";

const HEALTH_META: Record<
  SlaHealth,
  { label: string; className: string; dot: string }
> = {
  safe: {
    label: "SAFE",
    className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    dot: "bg-emerald-500",
  },
  at_risk: {
    label: "AT RISK",
    className: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    dot: "bg-amber-500",
  },
  critical: {
    label: "CRITICAL",
    className: "bg-red-500/15 text-red-700 border-red-500/30",
    dot: "bg-red-500",
  },
  breached: {
    label: "BREACHED",
    className: "bg-red-900/20 text-red-900 border-red-900/40",
    dot: "bg-red-900",
  },
  met: {
    label: "MET",
    className: "bg-sky-500/15 text-sky-700 border-sky-500/30",
    dot: "bg-sky-500",
  },
  no_policy: {
    label: "NO POLICY",
    className: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

/**
 * Enterprise SLA health badge. Colors are the whole point — agents must
 * see risk at a glance. Optionally shows the AI breach probability.
 */
export function SlaHealthBadge({
  health,
  probability,
  className,
}: {
  health: SlaHealth;
  probability?: number | null;
  className?: string;
}) {
  const meta = HEALTH_META[health] ?? HEALTH_META.no_policy;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-semibold tracking-wide", meta.className, className)}
    >
      <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
      {meta.label}
      {typeof probability === "number" && (
        <span className="font-normal tabular-nums">
          {Math.round(probability)}%
        </span>
      )}
    </Badge>
  );
}
