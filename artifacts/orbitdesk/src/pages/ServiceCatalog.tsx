import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuthStore } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListDepartments } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LayoutGrid,
  Plus,
  Check,
  X,
  Pencil,
  Ban,
  RotateCcw,
  Inbox,
  ClipboardList,
  Loader2,
  ExternalLink,
  Trash2,
  ListPlus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types + API helper
// ---------------------------------------------------------------------------

interface CatalogFormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  options?: string[];
}

interface CatalogItem {
  id: number;
  name: string;
  category: string;
  description: string | null;
  form_schema: { fields: CatalogFormField[] };
  approval_chain: { role: string; order: number }[];
  sla_policy_id: number | null;
  department_id: number | null;
  department_name: string | null;
  is_active: boolean;
  open_requests: number;
  created_at: string;
}

interface CatalogRequest {
  id: number;
  request_number: string;
  item_id: number;
  item_name: string;
  item_category: string;
  requester_name: string | null;
  form_data: Record<string, unknown>;
  status: string;
  ticket_id: number | null;
  ticket_number: string | null;
  current_step: number;
  pending_role: string | null;
  pending_steps: number | string;
  total_steps: number | string;
  created_at: string;
  completed_at: string | null;
}

interface InboxEntry {
  approval_id: number;
  step_order: number;
  approver_role: string;
  step_created_at: string;
  id: number;
  request_number: string;
  status: string;
  form_data: Record<string, unknown>;
  created_at: string;
  current_step: number;
  item_name: string;
  item_category: string;
  requester_name: string | null;
}

const CATEGORIES = ["IT", "HR", "Finance", "Facilities", "Security", "Legal", "Procurement", "Admin"];
const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "checkbox"] as const;
const PLATFORM_ROLES = ["super_admin", "admin", "manager", "agent", "employee", "external"];

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  }
  return data;
}

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-800",
  in_approval: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  fulfilling: "bg-purple-100 text-purple-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-100 text-gray-600",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600"}>
      {status.replace("_", " ")}
    </Badge>
  );
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Dynamic request form
// ---------------------------------------------------------------------------

function DynamicField({
  field,
  value,
  onChange,
  error,
}: {
  field: CatalogFormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const id = `cf-${field.name}`;
  const common = "mt-1";
  return (
    <div>
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      {field.type === "text" && (
        <Input id={id} className={common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.type === "textarea" && (
        <Textarea id={id} className={common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={3} />
      )}
      {field.type === "number" && (
        <Input id={id} className={common} type="number" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.type === "date" && (
        <Input id={id} className={common} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.type === "select" && (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger id={id} className={common}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {field.type === "checkbox" && (
        <div className="mt-2 flex items-center gap-2">
          <Checkbox
            id={id}
            checked={value === true || value === "true"}
            onCheckedChange={(c) => onChange(c === true)}
          />
          <span className="text-sm text-muted-foreground">Yes</span>
        </div>
      )}
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function validateValues(
  fields: CatalogFormField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.name];
    const empty = v === undefined || v === null || v === "";
    if (f.required && empty) {
      errors[f.name] = `${f.label} is required`;
      continue;
    }
    if (empty) continue;
    if (f.type === "number" && !Number.isFinite(Number(v))) errors[f.name] = `${f.label} must be a number`;
    if (f.type === "select" && !(f.options ?? []).includes(String(v)))
      errors[f.name] = `${f.label} must be one of the options`;
    if (f.type === "date" && Number.isNaN(Date.parse(String(v)))) errors[f.name] = `${f.label} must be a valid date`;
  }
  return errors;
}

function RequestDialog({
  item,
  onClose,
  onCreated,
}: {
  item: CatalogItem | null;
  onClose: () => void;
  onCreated: (requestNumber: string) => void;
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [createdNumber, setCreatedNumber] = useState<string | null>(null);

  const fields = item?.form_schema?.fields ?? [];

  const close = () => {
    setValues({});
    setErrors({});
    setCreatedNumber(null);
    onClose();
  };

  const submit = async () => {
    if (!item) return;
    const errs = validateValues(fields, values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSubmitting(true);
    try {
      const data = await api(`/api/catalog/items/${item.id}/request`, {
        method: "POST",
        body: JSON.stringify({ form_data: values }),
      });
      setCreatedNumber(data.request.request_number);
      onCreated(data.request.request_number);
    } catch (e: any) {
      toast({ title: "Request failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {createdNumber ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-600" /> Request submitted
              </DialogTitle>
              <DialogDescription>
                Your request <span className="font-mono font-semibold">{createdNumber}</span> has
                been created{item && item.approval_chain.length > 0 ? " and sent for approval" : ""}.
                {item && item.approval_chain.length === 0 && " It will be fulfilled automatically."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          item && (
            <>
              <DialogHeader>
                <DialogTitle>{item.name}</DialogTitle>
                <DialogDescription>
                  {item.description || "Fill in the details below to submit your request."}
                  {item.approval_chain.length > 0 && (
                    <span className="block mt-1 text-xs">
                      Requires approval: {item.approval_chain.map((s) => s.role).join(" → ")}
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {fields.length === 0 && (
                  <p className="text-sm text-muted-foreground">No additional details needed — just submit.</p>
                )}
                {fields.map((f) => (
                  <DynamicField
                    key={f.name}
                    field={f}
                    value={values[f.name]}
                    error={errors[f.name]}
                    onChange={(v) => setValues((p) => ({ ...p, [f.name]: v }))}
                  />
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={close}>Cancel</Button>
                <Button onClick={submit} disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Submit request
                </Button>
              </DialogFooter>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Catalog browse tab
// ---------------------------------------------------------------------------

function CatalogTab({ onRequest }: { onRequest: (item: CatalogItem) => void }) {
  const [category, setCategory] = useState<string>("All");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/catalog/items"],
    queryFn: () => api("/api/catalog/items"),
  });
  const items: CatalogItem[] = data?.items ?? [];

  const grouped = useMemo(() => {
    const filtered = category === "All" ? items : items.filter((i) => i.category === category);
    const map = new Map<string, CatalogItem[]>();
    for (const item of filtered) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items, category]);

  if (isLoading)
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading catalog…
      </div>
    );
  if (isError)
    return <p className="py-16 text-center text-red-600">Could not load the service catalog.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {["All", ...CATEGORIES].map((c) => (
          <Button
            key={c}
            size="sm"
            variant={category === c ? "default" : "outline"}
            onClick={() => setCategory(c)}
          >
            {c}
          </Button>
        ))}
      </div>
      {grouped.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <LayoutGrid className="h-8 w-8 mx-auto mb-3 opacity-40" />
            No services published yet. Check back soon.
          </CardContent>
        </Card>
      )}
      {grouped.map(([cat, list]) => (
        <div key={cat}>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{cat}</h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((item) => (
              <Card key={item.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{item.name}</CardTitle>
                    <Badge variant="secondary">{item.category}</Badge>
                  </div>
                  {item.department_name && (
                    <CardDescription>{item.department_name}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <p className="text-sm text-muted-foreground flex-1">
                    {item.description || "No description provided."}
                  </p>
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-xs text-muted-foreground">
                      {item.approval_chain.length === 0
                        ? "Auto-approved"
                        : `${item.approval_chain.length} approval step${item.approval_chain.length > 1 ? "s" : ""}`}
                    </span>
                    <Button size="sm" onClick={() => onRequest(item)}>Request</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My requests tab
// ---------------------------------------------------------------------------

function RequestsTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/catalog/requests"],
    queryFn: () => api("/api/catalog/requests"),
  });
  const requests: CatalogRequest[] = data?.requests ?? [];

  if (isLoading)
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading requests…
      </div>
    );
  if (isError)
    return <p className="py-16 text-center text-red-600">Could not load your requests.</p>;
  if (!requests.length)
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <ClipboardList className="h-8 w-8 mx-auto mb-3 opacity-40" />
          You haven't submitted any catalog requests yet.
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Request</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Approval</TableHead>
            <TableHead>Ticket</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-sm">{r.request_number}</TableCell>
              <TableCell>
                <div className="font-medium">{r.item_name}</div>
                <div className="text-xs text-muted-foreground">{r.item_category}</div>
              </TableCell>
              <TableCell><StatusBadge status={r.status} /></TableCell>
              <TableCell className="text-sm">
                {r.status === "in_approval" || r.status === "submitted" ? (
                  <span>
                    Step {r.current_step}/{Number(r.total_steps) || "?"}
                    {r.pending_role && <span className="text-muted-foreground"> · {r.pending_role}</span>}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {r.ticket_id ? (
                  <Link href={`/tickets/${r.ticket_id}`} className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
                    {r.ticket_number} <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(r.created_at).toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Approval inbox tab
// ---------------------------------------------------------------------------

function InboxTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [comments, setComments] = useState<Record<number, string>>({});
  const [acting, setActing] = useState<number | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/catalog/approvals/inbox"],
    queryFn: () => api("/api/catalog/approvals/inbox"),
  });
  const inbox: InboxEntry[] = data?.inbox ?? [];

  const decide = async (entry: InboxEntry, decision: "approve" | "reject") => {
    setActing(entry.approval_id);
    try {
      await api(`/api/catalog/requests/${entry.id}/${decision}`, {
        method: "POST",
        body: JSON.stringify({ comment: comments[entry.approval_id] || undefined }),
      });
      toast({
        title: decision === "approve" ? "Approved" : "Rejected",
        description: `${entry.request_number} — ${entry.item_name}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/catalog/approvals/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/catalog/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/catalog/items"] });
    } catch (e: any) {
      toast({ title: "Decision failed", description: e.message, variant: "destructive" });
    } finally {
      setActing(null);
    }
  };

  if (isLoading)
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading inbox…
      </div>
    );
  if (isError)
    return <p className="py-16 text-center text-red-600">Could not load the approval inbox.</p>;
  if (!inbox.length)
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Inbox className="h-8 w-8 mx-auto mb-3 opacity-40" />
          Nothing waiting for your approval.
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-4">
      {inbox.map((e) => (
        <Card key={e.approval_id}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{e.item_name}</CardTitle>
                <CardDescription>
                  <span className="font-mono">{e.request_number}</span> · requested by{" "}
                  {e.requester_name ?? "unknown"} · {new Date(e.created_at).toLocaleString()}
                </CardDescription>
              </div>
              <Badge variant="outline">
                Step {e.step_order} · {e.approver_role}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {Object.entries(e.form_data ?? {}).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}:</dt>
                  <dd className="font-medium">{formatValue(v)}</dd>
                </div>
              ))}
            </dl>
            <div>
              <Label htmlFor={`comment-${e.approval_id}`}>Comment (optional)</Label>
              <Input
                id={`comment-${e.approval_id}`}
                className="mt-1"
                placeholder="Reason for your decision…"
                value={comments[e.approval_id] ?? ""}
                onChange={(ev) => setComments((p) => ({ ...p, [e.approval_id]: ev.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => decide(e, "approve")}
                disabled={acting === e.approval_id}
              >
                {acting === e.approval_id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => decide(e, "reject")}
                disabled={acting === e.approval_id}
              >
                <X className="h-4 w-4 mr-1" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: schema + chain builders
// ---------------------------------------------------------------------------

interface BuilderField extends CatalogFormField {
  optionsText: string;
}

function SchemaBuilder({
  fields,
  setFields,
}: {
  fields: BuilderField[];
  setFields: (f: BuilderField[]) => void;
}) {
  const update = (i: number, patch: Partial<BuilderField>) =>
    setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Request form fields</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setFields([
              ...fields,
              { name: `field_${fields.length + 1}`, label: "", type: "text", required: false, optionsText: "" },
            ])
          }
        >
          <ListPlus className="h-4 w-4 mr-1" /> Add field
        </Button>
      </div>
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">No fields — requesters just hit submit.</p>
      )}
      {fields.map((f, i) => (
        <div key={i} className="rounded-md border p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Label</Label>
              <Input
                value={f.label}
                placeholder="e.g. Laptop model"
                onChange={(e) => {
                  const label = e.target.value;
                  update(i, {
                    label,
                    name: fields[i].name.startsWith("field_") || !fields[i].name ? slugify(label) || fields[i].name : fields[i].name,
                  });
                }}
              />
            </div>
            <div>
              <Label>Field name</Label>
              <Input
                value={f.name}
                placeholder="laptop_model"
                onChange={(e) => update(i, { name: slugify(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Type</Label>
              <Select value={f.type} onValueChange={(v) => update(i, { type: v as BuilderField["type"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Checkbox
                id={`req-${i}`}
                checked={!!f.required}
                onCheckedChange={(c) => update(i, { required: c === true })}
              />
              <Label htmlFor={`req-${i}`}>Required</Label>
            </div>
          </div>
          {f.type === "select" && (
            <div>
              <Label>Options (comma separated)</Label>
              <Input
                value={f.optionsText}
                placeholder="MacBook Pro, ThinkPad, Dell XPS"
                onChange={(e) => update(i, { optionsText: e.target.value })}
              />
            </div>
          )}
          <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => setFields(fields.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4 mr-1" /> Remove field
          </Button>
        </div>
      ))}
    </div>
  );
}

function ChainBuilder({
  steps,
  setSteps,
}: {
  steps: { role: string; order: number }[];
  setSteps: (s: { role: string; order: number }[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Approval chain (sequential)</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSteps([...steps, { role: "manager", order: steps.length + 1 }])}
        >
          <Plus className="h-4 w-4 mr-1" /> Add step
        </Button>
      </div>
      {steps.length === 0 && (
        <p className="text-sm text-muted-foreground">No steps — requests are auto-approved and fulfilled.</p>
      )}
      {steps.map((s, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1">
            <Label>Role</Label>
            <Select value={s.role} onValueChange={(v) => setSteps(steps.map((x, j) => (j === i ? { ...x, role: v } : x)))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORM_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-24">
            <Label>Order</Label>
            <Input
              type="number"
              min={1}
              value={s.order}
              onChange={(e) =>
                setSteps(steps.map((x, j) => (j === i ? { ...x, order: Math.max(1, parseInt(e.target.value) || 1) } : x)))
              }
            />
          </div>
          <Button type="button" size="icon" variant="ghost" className="text-red-600" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: manage items
// ---------------------------------------------------------------------------

function ItemDialog({
  item,
  onClose,
}: {
  item: CatalogItem | null | undefined; // undefined = closed, null = create
  onClose: (refresh: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: departments } = useListDepartments();
  const { data: slaData } = useQuery({
    queryKey: ["/api/sla/policies"],
    queryFn: () => api("/api/sla/policies"),
  });

  const [name, setName] = useState("");
  const [category, setCategory] = useState("IT");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [slaPolicyId, setSlaPolicyId] = useState<string>("");
  const [fields, setFields] = useState<BuilderField[]>([]);
  const [steps, setSteps] = useState<{ role: string; order: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [initializedFor, setInitializedFor] = useState<number | "new" | undefined>(undefined);

  const editing = item !== null && item !== undefined;
  const open = item !== undefined;

  // (Re)initialize when a different item is opened.
  if (open && initializedFor !== (item?.id ?? "new")) {
    setInitializedFor(item?.id ?? "new");
    setName(item?.name ?? "");
    setCategory(item?.category ?? "IT");
    setDescription(item?.description ?? "");
    setDepartmentId(item?.department_id ? String(item.department_id) : "");
    setSlaPolicyId(item?.sla_policy_id ? String(item.sla_policy_id) : "");
    setFields(
      (item?.form_schema?.fields ?? []).map((f) => ({
        ...f,
        optionsText: (f.options ?? []).join(", "),
      })),
    );
    setSteps((item?.approval_chain ?? []).map((s) => ({ ...s })));
  }

  const close = (refresh: boolean) => {
    setInitializedFor(undefined);
    if (refresh) {
      queryClient.invalidateQueries({ queryKey: ["/api/catalog/items"] });
    }
    onClose(refresh);
  };

  const save = async () => {
    // Client-side validation mirrors the backend.
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Name is required", variant: "destructive" });
      return;
    }
    const seen = new Set<string>();
    for (const f of fields) {
      if (!f.label.trim()) {
        toast({ title: "Validation error", description: "Every field needs a label", variant: "destructive" });
        return;
      }
      const nm = f.name || slugify(f.label);
      if (!/^[a-z0-9_]+$/.test(nm)) {
        toast({ title: "Validation error", description: `Field name "${nm}" is invalid`, variant: "destructive" });
        return;
      }
      if (seen.has(nm)) {
        toast({ title: "Validation error", description: `Duplicate field name "${nm}"`, variant: "destructive" });
        return;
      }
      seen.add(nm);
      if (f.type === "select") {
        const opts = f.optionsText.split(",").map((o) => o.trim()).filter(Boolean);
        if (!opts.length) {
          toast({ title: "Validation error", description: `Select field "${f.label}" needs options`, variant: "destructive" });
          return;
        }
      }
    }
    const orders = steps.map((s) => s.order);
    if (new Set(orders).size !== orders.length) {
      toast({ title: "Validation error", description: "Approval step orders must be unique", variant: "destructive" });
      return;
    }

    const payload = {
      name: name.trim(),
      category,
      description: description.trim() || null,
      department_id: departmentId ? parseInt(departmentId) : null,
      sla_policy_id: slaPolicyId ? parseInt(slaPolicyId) : null,
      form_schema: {
        fields: fields.map((f) => ({
          name: f.name || slugify(f.label),
          label: f.label.trim(),
          type: f.type,
          required: !!f.required,
          ...(f.type === "select"
            ? { options: f.optionsText.split(",").map((o) => o.trim()).filter(Boolean) }
            : {}),
        })),
      },
      approval_chain: [...steps]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ role: s.role, order: s.order })),
    };

    setSaving(true);
    try {
      if (editing && item) {
        await api(`/api/catalog/items/${item.id}`, { method: "PUT", body: JSON.stringify(payload) });
        toast({ title: "Item updated", description: name });
      } else {
        await api("/api/catalog/items", { method: "POST", body: JSON.stringify(payload) });
        toast({ title: "Item created", description: name });
      }
      close(true);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit catalog item" : "New catalog item"}</DialogTitle>
          <DialogDescription>
            Define the service, its request form, and who must approve requests.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New laptop request" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What is this service for?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fulfilling department</Label>
              <Select value={departmentId || "__none"} onValueChange={(v) => setDepartmentId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {(departments ?? []).map((d: any) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>SLA policy (optional)</Label>
              <Select value={slaPolicyId || "__none"} onValueChange={(v) => setSlaPolicyId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {(slaData?.policies ?? []).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <SchemaBuilder fields={fields} setFields={setFields} />
          <ChainBuilder steps={steps} setSteps={setSteps} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? "Save changes" : "Create item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogItem, setDialogItem] = useState<CatalogItem | null | undefined>(undefined);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/catalog/items", "all"],
    queryFn: () => api("/api/catalog/items?active=all"),
  });
  const items: CatalogItem[] = data?.items ?? [];

  const toggleActive = async (item: CatalogItem) => {
    try {
      if (item.is_active) {
        await api(`/api/catalog/items/${item.id}`, { method: "DELETE" });
        toast({ title: "Item deactivated", description: item.name });
      } else {
        await api(`/api/catalog/items/${item.id}`, {
          method: "PUT",
          body: JSON.stringify({ is_active: true }),
        });
        toast({ title: "Item reactivated", description: item.name });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/catalog/items"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogItem(null)}>
          <Plus className="h-4 w-4 mr-1" /> New item
        </Button>
      </div>
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading items…
        </div>
      )}
      {isError && <p className="py-16 text-center text-red-600">Could not load catalog items.</p>}
      {!isLoading && !isError && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Form</TableHead>
                <TableHead>Approvals</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Open req.</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.department_name ?? "No department"}</div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{item.category}</Badge></TableCell>
                  <TableCell className="text-sm">{item.form_schema?.fields?.length ?? 0} fields</TableCell>
                  <TableCell className="text-sm">
                    {item.approval_chain.length === 0
                      ? <span className="text-muted-foreground">Auto</span>
                      : item.approval_chain.map((s) => s.role).join(" → ")}
                  </TableCell>
                  <TableCell>
                    <Badge className={item.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}>
                      {item.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{item.open_requests}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Edit" onClick={() => setDialogItem(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={item.is_active ? "Deactivate" : "Reactivate"}
                        className={item.is_active ? "text-red-600" : "text-green-600"}
                        onClick={() => toggleActive(item)}
                      >
                        {item.is_active ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No catalog items yet — create the first one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
      <ItemDialog item={dialogItem} onClose={() => setDialogItem(undefined)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ServiceCatalog() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("catalog");
  const [requestItem, setRequestItem] = useState<CatalogItem | null>(null);

  const isAdmin = user?.role === "super_admin" || user?.role === "admin";

  const { data: inboxData } = useQuery({
    queryKey: ["/api/catalog/approvals/inbox"],
    queryFn: () => api("/api/catalog/approvals/inbox"),
  });
  const inboxCount: number = inboxData?.inbox?.length ?? 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <LayoutGrid className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">Service Catalog</h1>
            <p className="text-sm text-muted-foreground">
              Request IT, HR, facilities and other services — approvals and fulfillment handled automatically.
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
            <TabsTrigger value="requests">My requests</TabsTrigger>
            <TabsTrigger value="inbox" className="relative">
              Approval inbox
              {inboxCount > 0 && (
                <Badge className="ml-2 bg-amber-500 text-white">{inboxCount}</Badge>
              )}
            </TabsTrigger>
            {isAdmin && <TabsTrigger value="manage">Manage</TabsTrigger>}
          </TabsList>
          <TabsContent value="catalog" className="mt-6">
            <CatalogTab onRequest={setRequestItem} />
          </TabsContent>
          <TabsContent value="requests" className="mt-6">
            <RequestsTab />
          </TabsContent>
          <TabsContent value="inbox" className="mt-6">
            <InboxTab />
          </TabsContent>
          {isAdmin && (
            <TabsContent value="manage" className="mt-6">
              <ManageTab />
            </TabsContent>
          )}
        </Tabs>

        <RequestDialog
          item={requestItem}
          onClose={() => setRequestItem(null)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/catalog/requests"] });
          }}
        />
      </div>
    </AppLayout>
  );
}
