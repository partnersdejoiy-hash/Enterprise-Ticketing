import React, { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Zap,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Mail,
  Ticket,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth";

type Condition = {
  field: string;
  operator: string;
  value: string;
};

type Action = {
  type: string;
  value: string;
};

type AutomationRule = {
  id: number;
  name: string;
  description?: string;
  isActive: boolean;
  triggerType: string;
  conditions: Condition[];
  actions: Action[];
  conditionLogic: string;
  priority: number;
};

const TRIGGER_OPTIONS = [
  { value: "email_received", label: "Email Received", icon: Mail },
  { value: "ticket_created", label: "Ticket Created", icon: Ticket },
  { value: "ticket_updated", label: "Ticket Updated", icon: Ticket },
];

const CONDITION_FIELDS: Record<string, string> = {
  from_email: "From Email",
  to_email: "To Email",
  subject: "Subject",
  body: "Message Body",
  tag: "Tag",
  department: "Department",
  priority: "Priority",
};

const CONDITION_OPERATORS: Record<string, string> = {
  contains: "Contains",
  not_contains: "Does not contain",
  equals: "Equals",
  not_equals: "Does not equal",
  starts_with: "Starts with",
  ends_with: "Ends with",
  matches_regex: "Matches regex",
};

const ACTION_TYPES: Record<string, string> = {
  set_department: "Set Department",
  set_priority: "Set Priority",
  set_status: "Set Status",
  assign_agent: "Assign Agent (by email)",
  add_tag: "Add Tag",
  send_notification: "Send Notification Email",
  set_raised_for: "Set Raised For Email",
};

const ACTION_VALUE_HINTS: Record<string, string> = {
  set_department: "e.g. IT Support, HR, Finance, Legal",
  set_priority: "low | medium | high | urgent",
  set_status: "open | assigned | in_progress | waiting | resolved | closed",
  assign_agent: "e.g. agent@company.com",
  add_tag: "e.g. website-form, auto-created",
  send_notification: "e.g. manager@company.com",
  set_raised_for: "e.g. {from_email} or john@company.com",
};

const defaultRule = (): Omit<AutomationRule, "id"> => ({
  name: "",
  description: "",
  isActive: true,
  triggerType: "email_received",
  conditions: [{ field: "from_email", operator: "contains", value: "" }],
  actions: [{ type: "set_department", value: "" }],
  conditionLogic: "AND",
  priority: 10,
});

export default function AutomationRules() {
  const { token, user } = useAuthStore();
  const { toast } = useToast();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRule, setEditRule] = useState<AutomationRule | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const isSuperAdmin = user?.role === "super_admin";

  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const fetchRules = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/automation-rules", { headers });
      const data = await res.json();
      setRules(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Failed to load rules", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRules(); }, []);

  const handleToggle = async (rule: AutomationRule) => {
    try {
      const res = await fetch(`/api/automation-rules/${rule.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!res.ok) throw new Error();
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, isActive: !r.isActive } : r));
      toast({ title: rule.isActive ? "Rule disabled" : "Rule enabled" });
    } catch {
      toast({ title: "Failed to update rule", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!editRule) return;
    if (!editRule.name.trim()) {
      toast({ title: "Rule name is required", variant: "destructive" });
      return;
    }
    if (editRule.conditions.some(c => !c.value.trim())) {
      toast({ title: "All condition values are required", variant: "destructive" });
      return;
    }
    if (editRule.actions.some(a => !a.value.trim())) {
      toast({ title: "All action values are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const url = isNew ? "/api/automation-rules" : `/api/automation-rules/${editRule.id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, { method, headers, body: JSON.stringify(editRule) });
      if (!res.ok) throw new Error();
      toast({ title: isNew ? "Rule created" : "Rule updated" });
      setEditRule(null);
      fetchRules();
    } catch {
      toast({ title: "Failed to save rule", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/automation-rules/${deleteId}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error();
      toast({ title: "Rule deleted" });
      setDeleteId(null);
      fetchRules();
    } catch {
      toast({ title: "Failed to delete rule", variant: "destructive" });
    }
  };

  const addCondition = () => {
    if (!editRule) return;
    setEditRule({ ...editRule, conditions: [...editRule.conditions, { field: "from_email", operator: "contains", value: "" }] });
  };

  const removeCondition = (i: number) => {
    if (!editRule || editRule.conditions.length <= 1) return;
    setEditRule({ ...editRule, conditions: editRule.conditions.filter((_, idx) => idx !== i) });
  };

  const updateCondition = (i: number, key: keyof Condition, val: string) => {
    if (!editRule) return;
    const conds = [...editRule.conditions];
    conds[i] = { ...conds[i], [key]: val };
    setEditRule({ ...editRule, conditions: conds });
  };

  const addAction = () => {
    if (!editRule) return;
    setEditRule({ ...editRule, actions: [...editRule.actions, { type: "add_tag", value: "" }] });
  };

  const removeAction = (i: number) => {
    if (!editRule || editRule.actions.length <= 1) return;
    setEditRule({ ...editRule, actions: editRule.actions.filter((_, idx) => idx !== i) });
  };

  const updateAction = (i: number, key: keyof Action, val: string) => {
    if (!editRule) return;
    const acts = [...editRule.actions];
    acts[i] = { ...acts[i], [key]: val };
    setEditRule({ ...editRule, actions: acts });
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background flex-wrap gap-y-2">
          <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-sm">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Automation Rules</h1>
            <p className="text-xs text-muted-foreground">Auto-route, assign, and act on tickets based on rules</p>
          </div>
          {isSuperAdmin && (
            <Button
              className="ml-auto gap-1.5"
              onClick={() => { setEditRule(defaultRule() as AutomationRule); setIsNew(true); }}
            >
              <Plus className="h-4 w-4" /> New Rule
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 mb-5">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-700">
              <strong>How it works:</strong> Rules run automatically when an email is received or a ticket is created/updated.
              Conditions are checked in order. When ALL (or ANY) conditions match, the actions are applied.
              Rules with lower priority numbers run first. Use the "from_email ends with @yoursite.com" pattern to route website form submissions.
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rules.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-14 h-14 bg-orange-100 rounded-2xl flex items-center justify-center">
                  <Zap className="h-7 w-7 text-orange-500" />
                </div>
                <p className="font-semibold text-foreground">No automation rules yet</p>
                <p className="text-sm text-muted-foreground text-center max-w-sm">
                  Create rules to automatically route emails to departments, set priorities, assign agents, and more.
                </p>
                {isSuperAdmin && (
                  <Button onClick={() => { setEditRule(defaultRule() as AutomationRule); setIsNew(true); }} className="mt-1 gap-1.5">
                    <Plus className="h-4 w-4" /> Create Your First Rule
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => {
                const TriggerIcon = TRIGGER_OPTIONS.find(t => t.value === rule.triggerType)?.icon ?? Zap;
                return (
                  <Card key={rule.id} className={`transition-all ${rule.isActive ? "" : "opacity-60"}`}>
                    <CardContent className="p-0">
                      <div className="flex items-center gap-3 px-4 py-3">
                        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <TriggerIcon className="h-4 w-4 text-orange-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm text-foreground truncate">{rule.name}</p>
                            <Badge variant={rule.isActive ? "default" : "secondary"} className="text-xs">
                              {rule.isActive ? "Active" : "Disabled"}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {TRIGGER_OPTIONS.find(t => t.value === rule.triggerType)?.label ?? rule.triggerType}
                            </Badge>
                            <span className="text-xs text-muted-foreground">Priority: {rule.priority}</span>
                          </div>
                          {rule.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{rule.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                          {isSuperAdmin && (
                            <Switch
                              checked={rule.isActive}
                              onCheckedChange={() => handleToggle(rule)}
                              className="scale-90"
                            />
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                          >
                            {expandedId === rule.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                          {isSuperAdmin && (
                            <>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditRule(rule); setIsNew(false); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteId(rule.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {expandedId === rule.id && (
                        <div className="border-t border-border px-4 py-3 bg-muted/20 space-y-3">
                          <div className="flex flex-wrap gap-4">
                            <div className="flex-1 min-w-[200px]">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                Conditions ({rule.conditionLogic})
                              </p>
                              {rule.conditions.map((c, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-xs mb-1.5 flex-wrap">
                                  {i > 0 && (
                                    <span className="text-xs font-bold text-muted-foreground">{rule.conditionLogic}</span>
                                  )}
                                  <Badge variant="outline" className="font-mono">{CONDITION_FIELDS[c.field] ?? c.field}</Badge>
                                  <span className="text-muted-foreground">{CONDITION_OPERATORS[c.operator] ?? c.operator}</span>
                                  <Badge variant="secondary" className="font-mono max-w-[150px] truncate">{c.value}</Badge>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center">
                              <ArrowRight className="h-5 w-5 text-orange-500" />
                            </div>
                            <div className="flex-1 min-w-[200px]">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Actions</p>
                              {rule.actions.map((a, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-xs mb-1.5">
                                  <Badge className="bg-orange-100 text-orange-700 border-orange-200">{ACTION_TYPES[a.type] ?? a.type}</Badge>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-foreground font-medium truncate max-w-[150px]">{a.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!editRule} onOpenChange={(v) => { if (!v) setEditRule(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-orange-500" />
              {isNew ? "Create Automation Rule" : "Edit Rule"}
            </DialogTitle>
          </DialogHeader>

          {editRule && (
            <div className="space-y-5 py-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Rule Name *</Label>
                  <Input placeholder="e.g. Route website forms to IT" value={editRule.name} onChange={e => setEditRule({ ...editRule, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Priority (lower = runs first)</Label>
                  <Input type="number" min={0} max={999} value={editRule.priority} onChange={e => setEditRule({ ...editRule, priority: parseInt(e.target.value) || 0 })} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Textarea placeholder="What does this rule do?" value={editRule.description ?? ""} onChange={e => setEditRule({ ...editRule, description: e.target.value })} rows={2} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Trigger</Label>
                  <Select value={editRule.triggerType} onValueChange={v => setEditRule({ ...editRule, triggerType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIGGER_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Condition Logic</Label>
                  <Select value={editRule.conditionLogic} onValueChange={v => setEditRule({ ...editRule, conditionLogic: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AND">ALL conditions must match (AND)</SelectItem>
                      <SelectItem value="OR">ANY condition must match (OR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Conditions</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addCondition} className="h-7 gap-1 text-xs">
                    <Plus className="h-3 w-3" /> Add Condition
                  </Button>
                </div>
                {editRule.conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    {i > 0 && <span className="text-xs font-bold text-muted-foreground w-8 text-center">{editRule.conditionLogic}</span>}
                    {i === 0 && <span className="w-8" />}
                    <Select value={c.field} onValueChange={v => updateCondition(i, "field", v)}>
                      <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(CONDITION_FIELDS).map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={c.operator} onValueChange={v => updateCondition(i, "operator", v)}>
                      <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(CONDITION_OPERATORS).map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      className="flex-1 h-8 text-xs min-w-[120px]"
                      placeholder="value..."
                      value={c.value}
                      onChange={e => updateCondition(i, "value", e.target.value)}
                    />
                    <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeCondition(i)} disabled={editRule.conditions.length <= 1}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Actions (applied when conditions match)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addAction} className="h-7 gap-1 text-xs">
                    <Plus className="h-3 w-3" /> Add Action
                  </Button>
                </div>
                {editRule.actions.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <ArrowRight className="h-4 w-4 text-orange-500 flex-shrink-0" />
                    <Select value={a.type} onValueChange={v => updateAction(i, "type", v)}>
                      <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(ACTION_TYPES).map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="flex-1 relative min-w-[120px]">
                      <Input
                        className="h-8 text-xs"
                        placeholder={ACTION_VALUE_HINTS[a.type] ?? "value..."}
                        value={a.value}
                        onChange={e => updateAction(i, "value", e.target.value)}
                      />
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeAction(i)} disabled={editRule.actions.length <= 1}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Switch checked={editRule.isActive} onCheckedChange={v => setEditRule({ ...editRule, isActive: v })} />
                <Label>Rule is active</Label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRule(null)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isNew ? "Create Rule" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This automation rule will be permanently deleted and will stop applying to new tickets and emails.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
