// Global Operations Map (#11) — SVG schematic with clustered severity markers.
// Map abstraction: markers are data-driven; swap the renderer without
// touching data logic. Coordinates rounded for non-admin viewers (privacy).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin, RefreshCw, Users, Ticket, Flame, HeartPulse } from "lucide-react";
import { intelFetch } from "@/lib/intel";
import { cn } from "@/lib/utils";

interface OpsMarker {
  id: number;
  name: string;
  location_name: string | null;
  lat: number;
  lng: number;
  open_tickets: number;
  sla_risks: number;
  assets: number;
  active_agents: number;
  incidents: number;
  max_severity: string | null;
}

interface MarkerDetail {
  open_tickets: { id: number; ticket_number: string; subject: string; status: string }[];
  incidents: { id: number; title: string; severity: string; status: string }[];
  assets: { id: number; name: string; ci_type: string; health: string }[];
  sla_risks: { id: number; ticket_number: string; subject: string }[];
  agents: { id: number; name: string; open_count: number }[];
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#65a30d",
};

// Project lat/lng (India bounds approx) into the SVG viewBox.
function project(lat: number, lng: number): { x: number; y: number } {
  const W = 800;
  const H = 520;
  // India approx bounds: lat 8–37, lng 68–97.
  const x = ((lng - 68) / (97 - 68)) * W;
  const y = H - ((lat - 8) / (37 - 8)) * H;
  return { x: Math.max(20, Math.min(W - 20, x)), y: Math.max(20, Math.min(H - 20, y)) };
}

export default function OperationsMap() {
  const [severity, setSeverity] = useState<string>("all");
  const [selected, setSelected] = useState<OpsMarker | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ markers: OpsMarker[] }>({
    queryKey: ["ops-map", severity],
    queryFn: () =>
      intelFetch<{ markers: OpsMarker[] }>(
        `/ops-map/markers${severity !== "all" ? `?severity=${severity}` : ""}`,
      ),
  });

  const { data: detail } = useQuery<{ detail: MarkerDetail }>({
    queryKey: ["ops-marker", selected?.id],
    queryFn: () => intelFetch<{ detail: MarkerDetail }>(`/ops-map/markers/${selected!.id}`),
    enabled: selected != null,
  });

  const markers = data?.markers ?? [];

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Operations Map</h1>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        {isLoading && <Skeleton className="h-[520px] w-full" />}
        {isError && (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
            Could not load the operations map. <Button variant="outline" size="sm" className="ml-2" onClick={() => refetch()}>Retry</Button>
          </CardContent></Card>
        )}
        {data && (
          <div className="flex gap-4">
            <Card className="flex-1">
              <CardContent className="p-2">
                <svg viewBox="0 0 800 520" className="w-full h-[520px] bg-slate-50 rounded-md border">
                  {/* Schematic India outline hint */}
                  <text x={400} y={30} textAnchor="middle" fontSize={12} fill="#94a3b8">
                    Service locations · marker size = open tickets
                  </text>
                  {markers.map((m) => {
                    const { x, y } = project(m.lat, m.lng);
                    const r = 10 + Math.min(22, m.open_tickets * 1.5);
                    const color = m.max_severity ? SEVERITY_COLOR[m.max_severity] ?? "#3b82f6" : "#3b82f6";
                    const isSel = selected?.id === m.id;
                    return (
                      <g key={m.id} transform={`translate(${x},${y})`} className="cursor-pointer"
                        onClick={() => setSelected(isSel ? null : m)}>
                        <circle r={r} fill={color} opacity={0.25} />
                        <circle r={r * 0.55} fill={color} opacity={0.9}
                          stroke={isSel ? "#0f172a" : "#fff"} strokeWidth={isSel ? 3 : 2} />
                        <text y={4} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={700} pointerEvents="none">
                          {m.open_tickets}
                        </text>
                        <text y={r + 14} textAnchor="middle" fontSize={10} fill="#334155" pointerEvents="none">
                          {m.location_name ?? m.name}
                        </text>
                      </g>
                    );
                  })}
                  {markers.length === 0 && (
                    <text x={400} y={260} textAnchor="middle" fontSize={14} fill="#94a3b8">
                      No locations with coordinates yet. Add lat/lng to departments.
                    </text>
                  )}
                </svg>
                <div className="flex gap-3 px-2 py-1.5 text-[11px] text-muted-foreground">
                  {Object.entries(SEVERITY_COLOR).map(([s, c]) => (
                    <span key={s} className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: c }} />
                      {s}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className={cn("w-80 shrink-0 h-fit", !selected && "hidden")}>
              {selected && (
                <>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {selected.location_name ?? selected.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="border rounded p-2"><Ticket className="h-3.5 w-3.5 mb-1 text-muted-foreground" /><div className="font-bold">{selected.open_tickets}</div><div className="text-[11px] text-muted-foreground">Open tickets</div></div>
                      <div className="border rounded p-2"><Flame className="h-3.5 w-3.5 mb-1 text-muted-foreground" /><div className="font-bold">{selected.incidents}</div><div className="text-[11px] text-muted-foreground">Incidents</div></div>
                      <div className="border rounded p-2"><HeartPulse className="h-3.5 w-3.5 mb-1 text-muted-foreground" /><div className="font-bold">{selected.assets}</div><div className="text-[11px] text-muted-foreground">Assets</div></div>
                      <div className="border rounded p-2"><Users className="h-3.5 w-3.5 mb-1 text-muted-foreground" /><div className="font-bold">{selected.active_agents}</div><div className="text-[11px] text-muted-foreground">Agents</div></div>
                    </div>
                    {selected.sla_risks > 0 && (
                      <Badge variant="destructive">{selected.sla_risks} SLA at risk</Badge>
                    )}
                    {!detail ? (
                      <Skeleton className="h-24 w-full" />
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-auto">
                        {detail.detail.open_tickets.slice(0, 5).map((t) => (
                          <div key={t.id} className="text-xs border-b pb-1">
                            <span className="font-mono text-[11px]">{t.ticket_number}</span> {t.subject}
                          </div>
                        ))}
                        {detail.detail.agents.slice(0, 5).map((a) => (
                          <div key={a.id} className="text-xs flex justify-between">
                            <span>{a.name}</span>
                            <Badge variant="outline" className="text-[10px]">{a.open_count} open</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button size="sm" variant="ghost" className="w-full" onClick={() => setSelected(null)}>Close</Button>
                  </CardContent>
                </>
              )}
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
