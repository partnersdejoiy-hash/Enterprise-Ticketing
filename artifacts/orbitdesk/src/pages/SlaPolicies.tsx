import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/lib/auth";
import { useListDepartments } from "@workspace/api-client-react";
import { Plus, ShieldAlert } from "lucide-react";

async function slaApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.assign("/");
    throw new Error("Session expired. Please sign in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false)
    throw new Error(body.error ?? "SLA request failed");
  return body as T;
}

interface SlaPolicy {
  id: number;
  name: string;
  departmentId: number | null;
  departmentName: string | null;
  priority: string | null;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  businessHoursOnly: boolean;
  isActive: boolean;
}

function fmtMin(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * SLA Policies admin page. Lists active policies and allows admins to
 * create new ones (name, department, priority, first-response + resolution
 * targets, business-hours toggle). New policies apply to subsequently
 * created tickets via the SLA engine's findPolicy matching.
 */
export default function SlaPolicies() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("any");
  const [priority, setPriority] = useState("any");
  const [firstResponseMinutes, setFirstResponseMinutes] = useState("60");
  const [resolutionMinutes, setResolutionMinutes] = useState("240");
  const [businessHoursOnly, setBusinessHoursOnly] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const policiesQuery = useQuery({
    queryKey: ["sla-policies"],
    queryFn: () => slaApi<{ policies: SlaPolicy[] }>("/sla/policies"),
    enabled: isAdmin,
  });
  const { data: departments } = useListDepartments();

  const createMutation = useMutation({
    mutationFn: () =>
      slaApi<{ policy: { id: number } }>("/sla/policies", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          departmentId: departmentId === "any" ? null : Number(departmentId),
          priority: priority === "any" ? null : priority,
          firstResponseMinutes: Number(firstResponseMinutes),
          resolutionMinutes: Number(resolutionMinutes),
          businessHoursOnly,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sla-policies"] });
      setShowForm(false);
      setName("");
      setFormError(null);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="p-6">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              SLA policies are managed by workspace administrators.
            </AlertDescription>
          </Alert>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">SLA Policies</h1>
            <p className="text-sm text-muted-foreground">
              First-response and resolution targets per department and
              priority. The most specific matching policy applies to each
              ticket.
            </p>
          </div>
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-2 h-4 w-4" />
            New policy
          </Button>
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create SLA policy</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label htmlFor="pol-name">Policy name</Label>
                <Input
                  id="pol-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Finance urgent — 2h resolution"
                />
              </div>
              <div>
                <Label>Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any department</SelectItem>
                    {(departments ?? []).map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any priority</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pol-fr">First response (minutes)</Label>
                <Input
                  id="pol-fr"
                  type="number"
                  min={1}
                  value={firstResponseMinutes}
                  onChange={(e) => setFirstResponseMinutes(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="pol-res">Resolution (minutes)</Label>
                <Input
                  id="pol-res"
                  type="number"
                  min={1}
                  value={resolutionMinutes}
                  onChange={(e) => setResolutionMinutes(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 md:col-span-2">
                <Switch
                  checked={businessHoursOnly}
                  onCheckedChange={setBusinessHoursOnly}
                />
                <Label>Count business hours only (calendar-aware)</Label>
              </div>
              {formError && (
                <Alert variant="destructive" className="md:col-span-2">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              <div className="md:col-span-2">
                <Button
                  disabled={createMutation.isPending || !name.trim()}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? "Creating…" : "Create policy"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {policiesQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : policiesQuery.isError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>
                {(policiesQuery.error as Error).message ?? "Failed to load policies"}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => policiesQuery.refetch()}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (policiesQuery.data?.policies.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No SLA policies yet. Create one to enable SLA tracking and
              breach predictions.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {policiesQuery.data!.policies.map((p) => (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <Badge variant={p.isActive ? "default" : "secondary"}>
                      {p.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Department</span>
                    <span>{p.departmentName ?? "Any"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Priority</span>
                    <span className="capitalize">{p.priority ?? "Any"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">First response</span>
                    <span className="tabular-nums">
                      {fmtMin(p.firstResponseMinutes)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Resolution</span>
                    <span className="tabular-nums">
                      {fmtMin(p.resolutionMinutes)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Clock</span>
                    <span>
                      {p.businessHoursOnly ? "Business hours" : "24×7"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
