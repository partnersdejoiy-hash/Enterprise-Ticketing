import React, { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuthStore } from "@/lib/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAllPermissions, type RolePermissions } from "@/hooks/usePermissions";
import {
  User, Bell, Settings as SettingsIcon, Shield, Mail, Globe,
  Zap, Copy, CheckCircle2, Loader2, ShieldCheck, Lock, Info,
  Eye, EyeOff, Send, RefreshCw, ToggleLeft, ToggleRight, Inbox, Wifi,
  Plus, Trash2, Pencil, Star, StarOff, ServerCog, FlaskConical, X, Building2,
  Webhook, Link2, RotateCcw, AlertTriangle, ExternalLink
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose
} from "@/components/ui/dialog";

// ─── Role hierarchy ────────────────────────────────────────────────────────────
const HIERARCHY: Record<string, string[]> = {
  super_admin: ["admin", "manager", "agent", "employee", "external"],
  admin: ["manager", "agent", "employee", "external"],
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
  employee: "Employee",
  external: "External",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-700 border-purple-200",
  admin: "bg-blue-100 text-blue-700 border-blue-200",
  manager: "bg-indigo-100 text-indigo-700 border-indigo-200",
  agent: "bg-cyan-100 text-cyan-700 border-cyan-200",
  employee: "bg-emerald-100 text-emerald-700 border-emerald-200",
  external: "bg-gray-100 text-gray-600 border-gray-200",
};

const PERMISSION_GROUPS = [
  {
    label: "Ticket Management",
    perms: [
      { key: "canCreateTicket", label: "Create Tickets", desc: "Can raise new support tickets" },
      { key: "canViewAllTickets", label: "View All Tickets", desc: "Can see tickets across all departments (not just own)" },
      { key: "canCloseTicket", label: "Close / Resolve Tickets", desc: "Can mark tickets as resolved or closed" },
      { key: "canAssignTickets", label: "Assign Tickets", desc: "Can reassign tickets to other agents or departments" },
      { key: "canDeleteTickets", label: "Delete Tickets", desc: "Can permanently delete tickets" },
    ],
  },
  {
    label: "Data & Reports",
    perms: [
      { key: "canViewReports", label: "View Reports & Analytics", desc: "Access to dashboard analytics and reports" },
      { key: "canBulkUpload", label: "Bulk Upload (CSV)", desc: "Can upload data in bulk via CSV files" },
      { key: "canExportData", label: "Export Data", desc: "Can export tickets and reports to CSV/Excel" },
    ],
  },
  {
    label: "Administration",
    perms: [
      { key: "canManageDepartments", label: "Manage Departments", desc: "Can create, edit and manage departments" },
      { key: "canManageUsers", label: "Manage Users", desc: "Can add, edit, revoke and delete users" },
    ],
  },
  {
    label: "Self-Service",
    perms: [
      { key: "canRequestDocuments", label: "Request HR Documents", desc: "Can use the Document Request portal" },
    ],
  },
];

// ─── Single role card ──────────────────────────────────────────────────────────
function RolePermissionCard({
  initial,
  isReadonly,
  callerRole,
}: {
  initial: RolePermissions;
  isReadonly: boolean;
  callerRole: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [perms, setPerms] = useState<RolePermissions>(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setPerms(initial);
    setDirty(false);
  }, [initial]);

  const toggle = (key: keyof RolePermissions, val: boolean) => {
    setPerms((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/role-permissions/${perms.role}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(perms),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message ?? "Failed to save");
      }
      await queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      setDirty(false);
      toast({ title: "Saved!", description: `${ROLE_LABELS[perms.role]} permissions updated` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setPerms(initial);
    setDirty(false);
  };

  const resetToDefaults = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/role-permissions/${perms.role}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message ?? "Failed to reset");
      }
      await queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      setDirty(false);
      toast({ title: "Reset to defaults", description: `${ROLE_LABELS[perms.role]} permissions restored to system defaults` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={isReadonly ? "opacity-75" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[perms.role] ?? "bg-gray-100 text-gray-600"}`}>
              {ROLE_LABELS[perms.role] ?? perms.role}
            </span>
            {isReadonly && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> Read-only
              </span>
            )}
          </div>
          {!isReadonly && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={resetToDefaults} disabled={saving}>
                Reset to Defaults
              </Button>
              {dirty && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={reset} disabled={saving}>
                  Discard
                </Button>
              )}
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={save}
                disabled={!dirty || saving}
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{group.label}</p>
            <div className="space-y-2.5">
              {group.perms.map((perm) => {
                const val = perms[perm.key as keyof RolePermissions] as boolean;
                return (
                  <div key={perm.key} className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground leading-none">{perm.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{perm.desc}</p>
                    </div>
                    <Switch
                      checked={val}
                      onCheckedChange={(v) => toggle(perm.key as keyof RolePermissions, v)}
                      disabled={isReadonly}
                      className="flex-shrink-0"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Email Config form ─────────────────────────────────────────────────────────
interface EmailConfig {
  host: string; port: number; secure: boolean; user: string; pass: string;
  fromEmail: string; fromName: string; enabled: boolean;
}

function EmailConfigSection({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<EmailConfig>({ host: "", port: 587, secure: false, user: "", pass: "", fromEmail: "noreply.notifications@dejoiy.com", fromName: "OrbitDesk by Dejoiy", enabled: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [dirty, setDirty] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{ ok: boolean; message: string; via?: string; hint?: string } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch("/api/settings/email", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) { setCfg(data); setTestTo(data.fromEmail || ""); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const upd = (k: keyof EmailConfig, v: string | boolean | number) => { setCfg(p => ({ ...p, [k]: v })); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/settings/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Save failed");
      setDirty(false);
      toast({ title: "Settings saved", description: "Email configuration updated successfully" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const testEmail = async () => {
    setTesting(true);
    setEmailTestResult(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/settings/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ to: testTo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailTestResult({ ok: false, message: data.details ?? data.error ?? "Test failed", hint: data.hint });
        toast({ title: "Test failed", description: data.details ?? data.error, variant: "destructive" });
      } else {
        setEmailTestResult({ ok: true, message: data.message, via: data.via });
        toast({ title: "Test email sent!", description: data.message });
      }
    } catch (e: any) {
      setEmailTestResult({ ok: false, message: e.message });
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally { setTesting(false); }
  };

  if (loading) return <Card><CardContent className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></CardContent></Card>;

  const isReadonly = !isSuperAdmin;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" /> Outbound Email (SMTP)
            </CardTitle>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => upd("enabled", !cfg.enabled)}
                className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full transition-colors ${cfg.enabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
              >
                {cfg.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                {cfg.enabled ? "Enabled" : "Disabled"}
              </button>
            )}
          </div>
          {!isSuperAdmin && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
              <Lock className="h-3 w-3" /> Only Super Admins can modify email configuration
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {!cfg.enabled && isSuperAdmin && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <Info className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-700">Auto-email notifications are currently disabled. Enable above and configure SMTP to send ticket notifications.</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">SMTP Server</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>SMTP Host</Label>
                <Input placeholder="smtp.gmail.com" value={cfg.host} onChange={e => upd("host", e.target.value)} disabled={isReadonly} />
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input type="number" placeholder="587" value={cfg.port} onChange={e => upd("port", parseInt(e.target.value) || 587)} disabled={isReadonly} />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Switch checked={cfg.secure} onCheckedChange={v => upd("secure", v)} disabled={isReadonly} />
              <Label className="text-sm font-normal cursor-pointer">Use TLS/SSL (port 465)</Label>
            </div>
          </div>
          <Separator />
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Authentication</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>SMTP Username</Label>
                <Input placeholder="your@email.com" value={cfg.user} onChange={e => upd("user", e.target.value)} disabled={isReadonly} />
              </div>
              <div className="space-y-1.5">
                <Label>SMTP Password</Label>
                <div className="relative">
                  <Input type={showPass ? "text" : "password"} placeholder="••••••••" value={cfg.pass} onChange={e => upd("pass", e.target.value)} disabled={isReadonly} className="pr-9" />
                  <button type="button" className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => setShowPass(p => !p)}>
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <Separator />
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Sender Identity</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From Email</Label>
                <Input type="email" placeholder="noreply.notifications@dejoiy.com" value={cfg.fromEmail} onChange={e => upd("fromEmail", e.target.value)} disabled={isReadonly} />
              </div>
              <div className="space-y-1.5">
                <Label>From Name</Label>
                <Input placeholder="OrbitDesk by Dejoiy" value={cfg.fromName} onChange={e => upd("fromName", e.target.value)} disabled={isReadonly} />
              </div>
            </div>
          </div>
          {isSuperAdmin && (
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => { setCfg(c => ({ ...c })); setDirty(false); }} disabled={saving || !dirty}>
                Discard
              </Button>
              <Button size="sm" onClick={save} disabled={saving || !dirty} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : "Save Settings"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card className="border-blue-100">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4 text-blue-500" /> Send Test Email
            </CardTitle>
            <CardDescription>
              Send a real email to confirm your SMTP is working. OrbitDesk will use the primary configured account — either from <strong>Email Accounts</strong> or the legacy SMTP settings above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="recipient@example.com"
                value={testTo}
                onChange={e => { setTestTo(e.target.value); setEmailTestResult(null); }}
                className="flex-1"
              />
              <Button size="sm" onClick={testEmail} disabled={testing || !testTo.trim()} className="gap-1.5 flex-shrink-0">
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {testing ? "Sending…" : "Send Test"}
              </Button>
            </div>

            {emailTestResult && (
              <div className={`rounded-lg border px-4 py-3 space-y-1.5 ${emailTestResult.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                <div className="flex items-center gap-2">
                  {emailTestResult.ok
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    : <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />}
                  <p className={`text-sm font-medium ${emailTestResult.ok ? "text-emerald-800" : "text-red-800"}`}>
                    {emailTestResult.ok ? "Email sent successfully!" : "Sending failed"}
                  </p>
                </div>
                {emailTestResult.via && (
                  <p className="text-xs text-emerald-700 pl-6">Sent via: {emailTestResult.via}</p>
                )}
                {!emailTestResult.ok && (
                  <p className="text-xs text-red-700 pl-6">{emailTestResult.message}</p>
                )}
                {emailTestResult.hint && (
                  <p className="text-xs text-red-600 pl-6 font-medium">{emailTestResult.hint}</p>
                )}
              </div>
            )}

            {!emailTestResult && !cfg.host && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>No legacy SMTP configured. Make sure you have an account set up in <strong>Settings → Email Accounts</strong> with SMTP enabled, or fill in the SMTP fields above.</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" /> Notification Triggers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            {[
              { trigger: "Ticket Created", recipients: "Submitter + CC'd (raised for)", desc: "Sent when a new ticket is opened" },
              { trigger: "Ticket Resolved", recipients: "Submitter + CC'd (raised for)", desc: "Sent when status changes to Resolved" },
              { trigger: "Ticket Closed", recipients: "Submitter + CC'd (raised for)", desc: "Sent when status changes to Closed" },
              { trigger: "Status Changed", recipients: "Submitter + CC'd", desc: "Sent on any status change" },
              { trigger: "Document Request Created", recipients: "Requester", desc: "Sent when a document request ticket opens" },
              { trigger: "Document Request Updated", recipients: "Requester", desc: "Sent when a document request status changes" },
            ].map((item) => (
              <div key={item.trigger} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-foreground">{item.trigger}</p>
                    <Badge variant="outline" className="text-[10px]">{item.recipients}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── IMAP Config form ──────────────────────────────────────────────────────────
interface ImapConfig {
  enabled: boolean; host: string; port: number; secure: boolean;
  user: string; pass: string; mailbox: string; pollInterval: number; toAddress: string;
}

function ImapConfigSection({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<ImapConfig>({ enabled: false, host: "", port: 993, secure: true, user: "", pass: "", mailbox: "INBOX", pollInterval: 5, toAddress: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch("/api/settings/imap", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCfg(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const upd = (k: keyof ImapConfig, v: string | boolean | number) => { setCfg(p => ({ ...p, [k]: v })); setDirty(true); setTestResult(null); };

  const save = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/settings/imap", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Save failed");
      setDirty(false);
      toast({ title: "IMAP settings saved", description: "Incoming email configuration updated successfully." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/settings/imap/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ ok: false, message: data.error ?? "Test failed" });
        toast({ title: "Connection failed", description: data.error, variant: "destructive" });
      } else {
        setTestResult({ ok: true, message: data.message });
        toast({ title: "Connected!", description: data.message });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message });
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally { setTesting(false); }
  };

  if (loading) return <Card><CardContent className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></CardContent></Card>;

  const isReadonly = !isSuperAdmin;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4 text-muted-foreground" /> Incoming Email (IMAP)
          </CardTitle>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => upd("enabled", !cfg.enabled)}
              className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full transition-colors ${cfg.enabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
            >
              {cfg.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
              {cfg.enabled ? "Enabled" : "Disabled"}
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Emails sent to your support inbox will be automatically converted to tickets. OrbitDesk polls this mailbox every few minutes.
        </p>
        {!isSuperAdmin && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
            <Lock className="h-3 w-3" /> Only Super Admins can modify incoming email settings.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {!cfg.enabled && isSuperAdmin && (
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-blue-700">IMAP polling is disabled. Enable it above and configure your mailbox to start receiving tickets from email.</p>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">IMAP Server</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>IMAP Host</Label>
              <Input placeholder="imap.gmail.com" value={cfg.host} onChange={e => upd("host", e.target.value)} disabled={isReadonly} />
            </div>
            <div className="space-y-1.5">
              <Label>Port</Label>
              <Input type="number" placeholder="993" value={cfg.port} onChange={e => upd("port", parseInt(e.target.value) || 993)} disabled={isReadonly} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Switch checked={cfg.secure} onCheckedChange={v => upd("secure", v)} disabled={isReadonly} />
            <Label className="text-sm font-normal cursor-pointer">Use TLS/SSL (recommended — port 993)</Label>
          </div>
        </div>
        <Separator />
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Mailbox Credentials</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>IMAP Username</Label>
              <Input placeholder="support@yourcompany.com" value={cfg.user} onChange={e => upd("user", e.target.value)} disabled={isReadonly} />
            </div>
            <div className="space-y-1.5">
              <Label>IMAP Password / App Password</Label>
              <div className="relative">
                <Input type={showPass ? "text" : "password"} placeholder="••••••••" value={cfg.pass} onChange={e => upd("pass", e.target.value)} disabled={isReadonly} className="pr-9" />
                <button type="button" className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => setShowPass(p => !p)}>
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">For Gmail, use an App Password (not your account password).</p>
            </div>
          </div>
        </div>
        <Separator />
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Polling Settings</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Mailbox / Folder</Label>
              <Input placeholder="INBOX" value={cfg.mailbox} onChange={e => upd("mailbox", e.target.value)} disabled={isReadonly} />
            </div>
            <div className="space-y-1.5">
              <Label>Poll Interval (minutes)</Label>
              <Input type="number" min={1} max={60} placeholder="5" value={cfg.pollInterval} onChange={e => upd("pollInterval", Math.max(1, parseInt(e.target.value) || 5))} disabled={isReadonly} />
            </div>
            <div className="space-y-1.5">
              <Label>Support Inbox Address <span className="text-muted-foreground text-[10px]">(display only)</span></Label>
              <Input type="email" placeholder="support@yourcompany.com" value={cfg.toAddress} onChange={e => upd("toAddress", e.target.value)} disabled={isReadonly} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Unread emails are fetched and converted to tickets automatically. Processed emails are marked as read in the mailbox.
          </p>
        </div>

        {testResult && (
          <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${testResult.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
            {testResult.ok ? <Wifi className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" /> : <Info className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />}
            <p className={`text-sm ${testResult.ok ? "text-emerald-700" : "text-red-700"}`}>{testResult.message}</p>
          </div>
        )}

        {isSuperAdmin && (
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={testConnection} disabled={testing || !cfg.host || !cfg.user} className="gap-1.5">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
              {testing ? "Testing…" : "Test Connection"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setDirty(false); setTestResult(null); }} disabled={saving || !dirty}>
              Discard
            </Button>
            <Button size="sm" onClick={save} disabled={saving || !dirty} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : "Save Settings"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Email Accounts section ────────────────────────────────────────────────────
interface EmailAccount {
  id: number; name: string; isPrimarySender: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  smtpUser: string; smtpPass: string; smtpFromEmail: string; smtpFromName: string; smtpEnabled: boolean;
  imapHost: string; imapPort: number; imapSecure: boolean;
  imapUser: string; imapPass: string; imapMailbox: string; imapPollInterval: number; imapEnabled: boolean;
  departmentId: number | null; departmentName?: string | null;
}

const BLANK_ACCOUNT: Omit<EmailAccount, "id"> = {
  name: "", isPrimarySender: false,
  smtpHost: "", smtpPort: 587, smtpSecure: false,
  smtpUser: "", smtpPass: "", smtpFromEmail: "", smtpFromName: "OrbitDesk by Dejoiy", smtpEnabled: false,
  imapHost: "", imapPort: 993, imapSecure: true,
  imapUser: "", imapPass: "", imapMailbox: "INBOX", imapPollInterval: 5, imapEnabled: false,
  departmentId: null,
};

// ─── Webhook types ─────────────────────────────────────────────────────────────
const WEBHOOK_EVENTS = [
  { value: "ticket.created", label: "Ticket Created" },
  { value: "ticket.updated", label: "Ticket Updated" },
  { value: "ticket.closed", label: "Ticket Closed" },
  { value: "comment.added", label: "Comment Added" },
  { value: "ticket.assigned", label: "Ticket Assigned" },
  { value: "*", label: "All Events" },
];

interface WEndpoint {
  id: number;
  name: string;
  url: string;
  events: string[];
  secretHeader: string;
  enabled: boolean;
}

const BLANK_WEP: Omit<WEndpoint, "id"> = {
  name: "", url: "", events: [], secretHeader: "", enabled: true,
};

function WebhooksSection({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const [inboundSecret, setInboundSecret] = useState("");
  const [endpoints, setEndpoints] = useState<WEndpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WEndpoint | null>(null);
  const [form, setForm] = useState<Omit<WEndpoint, "id">>(BLANK_WEP);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [customSecretOpen, setCustomSecretOpen] = useState(false);
  const [customSecretValue, setCustomSecretValue] = useState("");
  const [customSecretSaving, setCustomSecretSaving] = useState(false);
  const [customSecretError, setCustomSecretError] = useState("");

  const token = () => localStorage.getItem("auth_token");
  const hdrs = (json = true) => ({
    Authorization: `Bearer ${token()}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  });

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const inboundUrl = inboundSecret ? `${baseUrl}/api/webhooks/inbound/${inboundSecret}` : "";

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/webhooks/config", { headers: hdrs(false) });
      if (res.ok) {
        const data = await res.json();
        setInboundSecret(data.inboundSecret ?? "");
        setEndpoints(data.endpoints ?? []);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const copyUrl = () => {
    navigator.clipboard.writeText(inboundUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch("/api/webhooks/config/regenerate-secret", { method: "POST", headers: hdrs(false) });
      if (!res.ok) throw new Error("Regenerate failed");
      const data = await res.json();
      setInboundSecret(data.inboundSecret);
      toast({ title: "Secret regenerated", description: "Update your webhook integrations with the new URL." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setRegenerating(false); setConfirmRegen(false); }
  };

  const openCustomSecret = () => {
    setCustomSecretValue(inboundSecret);
    setCustomSecretError("");
    setCustomSecretOpen(true);
    setConfirmRegen(false);
  };

  const saveCustomSecret = async () => {
    const val = customSecretValue.trim();
    if (val.length < 8) { setCustomSecretError("Must be at least 8 characters"); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(val)) { setCustomSecretError("Only letters, numbers, hyphens and underscores allowed"); return; }
    setCustomSecretSaving(true);
    setCustomSecretError("");
    try {
      const res = await fetch("/api/webhooks/config/set-secret", {
        method: "POST", headers: hdrs(),
        body: JSON.stringify({ secret: val }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setInboundSecret(data.inboundSecret);
      setCustomSecretOpen(false);
      toast({ title: "Inbound URL updated", description: "Update your integrations with the new URL." });
    } catch (e: any) {
      setCustomSecretError(e.message);
    } finally { setCustomSecretSaving(false); }
  };

  const upd = (k: keyof typeof form, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const toggleEvent = (ev: string) => {
    setForm(p => ({
      ...p,
      events: p.events.includes(ev) ? p.events.filter(e => e !== ev) : [...p.events, ev],
    }));
  };

  const openAdd = () => { setEditing(null); setForm(BLANK_WEP); setOpen(true); };
  const openEdit = (ep: WEndpoint) => { setEditing(ep); setForm({ ...ep }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (!form.url.trim()) { toast({ title: "URL required", variant: "destructive" }); return; }
    try { new URL(form.url); } catch { toast({ title: "Invalid URL", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editing ? `/api/webhooks/endpoints/${editing.id}` : "/api/webhooks/endpoints";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: hdrs(), body: JSON.stringify(form) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Save failed"); }
      toast({ title: editing ? "Webhook updated" : "Webhook created" });
      setOpen(false);
      await load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    try {
      const res = await fetch(`/api/webhooks/endpoints/${id}`, { method: "DELETE", headers: hdrs(false) });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Webhook deleted" });
      setEndpoints(p => p.filter(e => e.id !== id));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const testEp = async (id: number) => {
    setTesting(id);
    try {
      const res = await fetch(`/api/webhooks/endpoints/${id}/test`, { method: "POST", headers: hdrs(false) });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Test successful", description: `Responded with HTTP ${data.status}` });
      } else {
        toast({ title: "Test failed", description: data.error ?? "No response", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally { setTesting(null); }
  };

  const toggleEnabled = async (ep: WEndpoint) => {
    try {
      const res = await fetch(`/api/webhooks/endpoints/${ep.id}`, {
        method: "PUT", headers: hdrs(),
        body: JSON.stringify({ ...ep, enabled: !ep.enabled }),
      });
      if (!res.ok) throw new Error();
      setEndpoints(p => p.map(e => e.id === ep.id ? { ...e, enabled: !ep.enabled } : e));
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Webhooks</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Receive ticket events via inbound webhooks or push events to external systems.
        </p>
      </div>

      {/* ── Inbound Webhook ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4 text-blue-500" /> Inbound Webhook URL
          </CardTitle>
          <CardDescription>
            POST email payloads to this URL to auto-create tickets. The secret in the URL keeps your endpoint private.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input readOnly value={inboundUrl} className="font-mono text-xs bg-muted flex-1" />
                <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={copyUrl}>
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              {isSuperAdmin && (
                <>
                  {customSecretOpen ? (
                    <div className="space-y-2 p-3 rounded-md border border-border bg-muted/40">
                      <p className="text-xs font-medium text-foreground">Set custom URL secret</p>
                      <p className="text-xs text-muted-foreground">
                        Letters, numbers, hyphens and underscores only — minimum 8 characters.
                      </p>
                      <div className="flex gap-2">
                        <Input
                          className="font-mono text-xs flex-1"
                          placeholder="my-custom-secret-key"
                          value={customSecretValue}
                          onChange={e => { setCustomSecretValue(e.target.value); setCustomSecretError(""); }}
                          onKeyDown={e => { if (e.key === "Enter") saveCustomSecret(); if (e.key === "Escape") setCustomSecretOpen(false); }}
                          autoFocus
                        />
                        <Button size="sm" disabled={customSecretSaving} onClick={saveCustomSecret} className="gap-1 shrink-0">
                          {customSecretSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setCustomSecretOpen(false)} className="shrink-0">Cancel</Button>
                      </div>
                      {customSecretError && <p className="text-xs text-destructive">{customSecretError}</p>}
                    </div>
                  ) : confirmRegen ? (
                    <div className="flex items-center gap-2 p-3 rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span className="flex-1">This will break existing integrations using the old URL. Continue?</span>
                      <Button size="sm" variant="destructive" disabled={regenerating} onClick={regenerate} className="gap-1">
                        {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        Regenerate
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmRegen(false)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50"
                        onClick={() => setConfirmRegen(true)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Regenerate Secret
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={openCustomSecret}>
                        <Pencil className="h-3.5 w-3.5" /> Set Custom Secret
                      </Button>
                    </div>
                  )}
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Supported by Mailgun, SendGrid Inbound Parse, and any service that POSTs JSON email payloads.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Outgoing Webhooks ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ExternalLink className="h-4 w-4 text-purple-500" /> Outgoing Webhooks
              </CardTitle>
              <CardDescription className="mt-1">
                Push ticket events to Slack, Jira, Zapier, or any custom endpoint.
              </CardDescription>
            </div>
            {isSuperAdmin && (
              <Button size="sm" className="gap-1.5 shrink-0" onClick={openAdd}>
                <Plus className="h-3.5 w-3.5" /> Add Webhook
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : endpoints.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Webhook className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              No outgoing webhooks configured yet.
            </div>
          ) : (
            <div className="space-y-3">
              {endpoints.map(ep => (
                <div key={ep.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                  <div className="mt-0.5">
                    <Webhook className={`h-4 w-4 ${ep.enabled ? "text-purple-500" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{ep.name}</span>
                      {!ep.enabled && <Badge variant="secondary" className="text-xs">Disabled</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{ep.url}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ep.events.length === 0 || ep.events.includes("*") ? (
                        <Badge variant="outline" className="text-xs">All Events</Badge>
                      ) : ep.events.map(ev => (
                        <Badge key={ev} variant="outline" className="text-xs">
                          {WEBHOOK_EVENTS.find(e => e.value === ev)?.label ?? ev}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
                      disabled={testing === ep.id}
                      onClick={() => testEp(ep.id)}>
                      {testing === ep.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      Test
                    </Button>
                    {isSuperAdmin && (
                      <>
                        <Switch checked={ep.enabled} onCheckedChange={() => toggleEnabled(ep)} className="scale-75" />
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(ep)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => del(ep.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add/Edit Dialog ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Webhook" : "Add Outgoing Webhook"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="e.g. Slack Notifications" value={form.name}
                onChange={e => upd("name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Endpoint URL</Label>
              <Input placeholder="https://hooks.slack.com/services/…" value={form.url}
                onChange={e => upd("url", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Events to trigger on</Label>
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENTS.map(ev => {
                  const active = form.events.includes(ev.value);
                  return (
                    <button key={ev.value} type="button"
                      onClick={() => toggleEvent(ev.value)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/50"
                      }`}>
                      {ev.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Leave empty to receive all events.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Secret Header Value <span className="text-muted-foreground">(optional)</span></Label>
              <Input placeholder="Sent as X-OrbitDesk-Secret header" value={form.secretHeader}
                onChange={e => upd("secretHeader", e.target.value)} />
              <p className="text-xs text-muted-foreground">Your receiving server can verify this value to confirm the request is from OrbitDesk.</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.enabled} onCheckedChange={v => upd("enabled", v)} id="ep-enabled" />
              <Label htmlFor="ep-enabled">Enabled</Label>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmailAccountsSection({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmailAccount | null>(null);
  const [form, setForm] = useState<Omit<EmailAccount, "id">>(BLANK_ACCOUNT);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<{ id: number; type: "smtp" | "imap" } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [showImapPass, setShowImapPass] = useState(false);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);

  const token = () => localStorage.getItem("auth_token");
  const hdrs = (json = true) => ({
    Authorization: `Bearer ${token()}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  });

  const load = async () => {
    setLoading(true);
    try {
      const [accsRes, deptsRes] = await Promise.all([
        fetch("/api/email-accounts", { headers: hdrs(false) }),
        fetch("/api/departments", { headers: hdrs(false) }),
      ]);
      if (accsRes.ok) setAccounts(await accsRes.json());
      if (deptsRes.ok) setDepartments(await deptsRes.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const upd = (k: keyof typeof form, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const openAdd = () => { setEditing(null); setForm(BLANK_ACCOUNT); setShowSmtpPass(false); setShowImapPass(false); setOpen(true); };
  const openEdit = (a: EmailAccount) => { setEditing(a); setForm({ ...a }); setShowSmtpPass(false); setShowImapPass(false); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editing ? `/api/email-accounts/${editing.id}` : "/api/email-accounts";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: hdrs(), body: JSON.stringify(form) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Save failed"); }
      toast({ title: editing ? "Account updated" : "Account created" });
      setOpen(false);
      await load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const del = async (id: number) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/email-accounts/${id}`, { method: "DELETE", headers: hdrs(false) });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Account deleted" });
      setAccounts(p => p.filter(a => a.id !== id));
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setDeleting(null); }
  };

  const setPrimary = async (id: number) => {
    try {
      const res = await fetch(`/api/email-accounts/${id}/set-primary`, { method: "POST", headers: hdrs(false) });
      if (!res.ok) throw new Error();
      toast({ title: "Primary sender set" });
      setAccounts(p => p.map(a => ({ ...a, isPrimarySender: a.id === id })));
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const testConn = async (id: number, type: "smtp" | "imap") => {
    setTesting({ id, type });
    try {
      const res = await fetch(`/api/email-accounts/${id}/test-${type}`, { method: "POST", headers: hdrs() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.details ?? "Test failed");
      toast({ title: `${type.toUpperCase()} test passed`, description: data.message });
    } catch (e: any) {
      toast({ title: `${type.toUpperCase()} test failed`, description: e.message, variant: "destructive" });
    } finally { setTesting(null); }
  };

  const isTesting = (id: number, type: "smtp" | "imap") => testing?.id === id && testing?.type === type;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Email Accounts</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure multiple SMTP/IMAP accounts for sending notifications and receiving tickets via email.
          </p>
        </div>
        {isSuperAdmin && (
          <Button size="sm" onClick={openAdd} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> Add Account
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
        </div>
      )}

      {!loading && accounts.length === 0 && (
        <div className="border border-dashed rounded-lg p-10 text-center">
          <ServerCog className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No email accounts configured</p>
          <p className="text-xs text-muted-foreground mt-1">Add an account to enable email sending and receiving.</p>
          {isSuperAdmin && <Button size="sm" className="mt-4 gap-1.5" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add First Account</Button>}
        </div>
      )}

      <div className="grid gap-4">
        {accounts.map(acc => (
          <Card key={acc.id} className={`border ${acc.isPrimarySender ? "border-primary/50 bg-primary/5" : ""}`}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">{acc.name}</span>
                      {acc.isPrimarySender && (
                        <Badge variant="default" className="text-[10px] py-0 px-1.5 shrink-0">Primary Sender</Badge>
                      )}
                      {acc.smtpEnabled && <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0 text-blue-600 border-blue-200">SMTP</Badge>}
                      {acc.imapEnabled && <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0 text-green-600 border-green-200">IMAP</Badge>}
                    </div>
                    {acc.departmentName && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Building2 className="h-3 w-3" /> Routes to {acc.departmentName}
                      </p>
                    )}
                  </div>
                </div>
                {isSuperAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    {!acc.isPrimarySender && acc.smtpEnabled && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => setPrimary(acc.id)}>
                        <Star className="h-3 w-3" /> Set Primary
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(acc)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => del(acc.id)}
                      disabled={deleting === acc.id}
                    >
                      {deleting === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid sm:grid-cols-2 gap-4">
                {/* SMTP */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Send className="h-3 w-3" /> Outgoing (SMTP)
                  </p>
                  {acc.smtpHost ? (
                    <div className="text-xs space-y-0.5 text-foreground">
                      <p><span className="text-muted-foreground">Host:</span> {acc.smtpHost}:{acc.smtpPort} {acc.smtpSecure ? "(TLS)" : "(STARTTLS)"}</p>
                      <p><span className="text-muted-foreground">From:</span> {acc.smtpFromEmail || acc.smtpUser}</p>
                      <p><span className="text-muted-foreground">Status:</span> <span className={acc.smtpEnabled ? "text-green-600 font-medium" : "text-muted-foreground"}>{acc.smtpEnabled ? "Enabled" : "Disabled"}</span></p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Not configured</p>
                  )}
                  {isSuperAdmin && acc.smtpHost && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 mt-1" onClick={() => testConn(acc.id, "smtp")} disabled={isTesting(acc.id, "smtp")}>
                      {isTesting(acc.id, "smtp") ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />} Test SMTP
                    </Button>
                  )}
                </div>

                {/* IMAP */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Inbox className="h-3 w-3" /> Incoming (IMAP)
                  </p>
                  {acc.imapHost ? (
                    <div className="text-xs space-y-0.5 text-foreground">
                      <p><span className="text-muted-foreground">Host:</span> {acc.imapHost}:{acc.imapPort} {acc.imapSecure ? "(SSL)" : "(plain)"}</p>
                      <p><span className="text-muted-foreground">Mailbox:</span> {acc.imapMailbox} · Poll every {acc.imapPollInterval}m</p>
                      <p><span className="text-muted-foreground">Status:</span> <span className={acc.imapEnabled ? "text-green-600 font-medium" : "text-muted-foreground"}>{acc.imapEnabled ? "Enabled" : "Disabled"}</span></p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Not configured</p>
                  )}
                  {isSuperAdmin && acc.imapHost && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 mt-1" onClick={() => testConn(acc.id, "imap")} disabled={isTesting(acc.id, "imap")}>
                      {isTesting(acc.id, "imap") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />} Test IMAP
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Email Account" : "Add Email Account"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Name & Department */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Account Name <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. HR Support, Main IT Helpdesk" value={form.name} onChange={e => upd("name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Route Incoming Emails To Department</Label>
                <Select
                  value={form.departmentId ? String(form.departmentId) : "__none__"}
                  onValueChange={v => upd("departmentId", v === "__none__" ? null : parseInt(v))}
                >
                  <SelectTrigger><SelectValue placeholder="Auto-detect (keyword routing)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Auto-detect (keyword routing)</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch id="primary-sender" checked={!!form.isPrimarySender} onCheckedChange={v => upd("isPrimarySender", v)} />
              <Label htmlFor="primary-sender" className="cursor-pointer">Set as primary outgoing sender (overrides legacy SMTP config)</Label>
            </div>

            <Separator />

            {/* SMTP */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold flex items-center gap-2"><Send className="h-4 w-4 text-blue-500" /> Outgoing Email (SMTP)</p>
                <div className="flex items-center gap-2">
                  <Switch id="smtp-enabled" checked={!!form.smtpEnabled} onCheckedChange={v => upd("smtpEnabled", v)} />
                  <Label htmlFor="smtp-enabled" className="cursor-pointer text-xs">Enable</Label>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">SMTP Host</Label>
                  <Input placeholder="smtp.gmail.com" value={form.smtpHost} onChange={e => upd("smtpHost", e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Port</Label>
                    <Input type="number" placeholder="587" value={form.smtpPort} onChange={e => upd("smtpPort", parseInt(e.target.value) || 587)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">SSL/TLS</Label>
                    <div className="flex items-center gap-2 h-9">
                      <Switch checked={!!form.smtpSecure} onCheckedChange={v => upd("smtpSecure", v)} />
                      <span className="text-xs text-muted-foreground">{form.smtpSecure ? "TLS" : "STARTTLS"}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Username / Email</Label>
                  <Input placeholder="user@example.com" value={form.smtpUser} onChange={e => upd("smtpUser", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password / App Password</Label>
                  <div className="relative">
                    <Input type={showSmtpPass ? "text" : "password"} placeholder="••••••••" value={form.smtpPass} onChange={e => upd("smtpPass", e.target.value)} className="pr-9" />
                    <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowSmtpPass(p => !p)}>
                      {showSmtpPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">From Email Address</Label>
                  <Input type="email" placeholder="noreply@example.com" value={form.smtpFromEmail} onChange={e => upd("smtpFromEmail", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">From Display Name</Label>
                  <Input placeholder="OrbitDesk by Dejoiy" value={form.smtpFromName} onChange={e => upd("smtpFromName", e.target.value)} />
                </div>
              </div>
            </div>

            <Separator />

            {/* IMAP */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold flex items-center gap-2"><Inbox className="h-4 w-4 text-green-500" /> Incoming Email (IMAP) — Ticket Generation</p>
                <div className="flex items-center gap-2">
                  <Switch id="imap-enabled" checked={!!form.imapEnabled} onCheckedChange={v => upd("imapEnabled", v)} />
                  <Label htmlFor="imap-enabled" className="cursor-pointer text-xs">Enable</Label>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">IMAP Host</Label>
                  <Input placeholder="imap.gmail.com" value={form.imapHost} onChange={e => upd("imapHost", e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Port</Label>
                    <Input type="number" placeholder="993" value={form.imapPort} onChange={e => upd("imapPort", parseInt(e.target.value) || 993)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">SSL</Label>
                    <div className="flex items-center gap-2 h-9">
                      <Switch checked={form.imapSecure !== false} onCheckedChange={v => upd("imapSecure", v)} />
                      <span className="text-xs text-muted-foreground">{form.imapSecure ? "SSL" : "Plain"}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Username</Label>
                  <Input placeholder="user@example.com" value={form.imapUser} onChange={e => upd("imapUser", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Password / App Password</Label>
                  <div className="relative">
                    <Input type={showImapPass ? "text" : "password"} placeholder="••••••••" value={form.imapPass} onChange={e => upd("imapPass", e.target.value)} className="pr-9" />
                    <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowImapPass(p => !p)}>
                      {showImapPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Mailbox / Folder</Label>
                  <Input placeholder="INBOX" value={form.imapMailbox} onChange={e => upd("imapMailbox", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Poll Interval (minutes)</Label>
                  <Input type="number" min={1} max={60} placeholder="5" value={form.imapPollInterval} onChange={e => upd("imapPollInterval", Math.max(1, parseInt(e.target.value) || 5))} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {editing ? "Save Changes" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Settings page ────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuthStore();
  const { toast } = useToast();

  const isSuperAdmin = user?.role === "super_admin";
  const canAdmin = user?.role === "super_admin" || user?.role === "admin";
  const canManagePerms = user?.role === "super_admin" || user?.role === "admin";
  const manageableRoles = HIERARCHY[user?.role ?? ""] ?? [];

  const { data: allPermissions, isLoading: loadingPerms } = useAllPermissions();

  // Email simulation state
  const [simTo, setSimTo] = useState("bgv@dejoiy.com");
  const [simFrom, setSimFrom] = useState("hr@acmecorp.com");
  const [simSubject, setSimSubject] = useState("Background check for John Doe");
  const [simText, setSimText] = useState("Please verify the employment history of John Doe (DOJ: Jan 2020 - Mar 2023) at Acme Corp.");
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ ticketNumber: string; department: string | null } | null>(null);

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/email` : "/api/webhooks/email";

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => toast({ title: "Copied!", description: "Webhook URL copied to clipboard" }));
  };

  const runSimulation = async () => {
    setSimulating(true);
    setSimResult(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/webhooks/email/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ to: simTo, from: simFrom, subject: simSubject, text: simText }),
      });
      const data = await res.json();
      if (data.action === "ticket_created") {
        setSimResult({ ticketNumber: data.ticketNumber, department: data.department ?? null });
        toast({ title: "Simulation success!", description: `Ticket ${data.ticketNumber} created in ${data.department ?? "system"} department` });
      } else {
        toast({ title: "No route matched", description: data.reason ?? "The 'to' address didn't match any configured email route", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSimulating(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-3 sm:p-6 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your account and system preferences</p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="profile" className="gap-1.5">
              <User className="h-3.5 w-3.5" /> Profile
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5">
              <Bell className="h-3.5 w-3.5" /> Notifications
            </TabsTrigger>
            {canManagePerms && (
              <TabsTrigger value="permissions" className="gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Role Permissions
              </TabsTrigger>
            )}
            {canAdmin && (
              <>
                <TabsTrigger value="email-accounts" className="gap-1.5">
                  <ServerCog className="h-3.5 w-3.5" /> Email Accounts
                </TabsTrigger>
                {isSuperAdmin && (
                  <TabsTrigger value="webhooks" className="gap-1.5">
                    <Webhook className="h-3.5 w-3.5" /> Webhooks
                  </TabsTrigger>
                )}
                <TabsTrigger value="email-integration" className="gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email Routing
                </TabsTrigger>
                <TabsTrigger value="email-notifications" className="gap-1.5">
                  <Send className="h-3.5 w-3.5" /> Email Notifications
                </TabsTrigger>
                <TabsTrigger value="system" className="gap-1.5">
                  <SettingsIcon className="h-3.5 w-3.5" /> System
                </TabsTrigger>
              </>
            )}
          </TabsList>

          {/* ── Profile ── */}
          <TabsContent value="profile">
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Profile Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-16 w-16">
                      <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                        {user?.name?.charAt(0).toUpperCase() ?? "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-foreground">{user?.name}</p>
                      <p className="text-sm text-muted-foreground">{user?.email}</p>
                      <Badge variant="outline" className="mt-1 text-xs capitalize">{user?.role?.replace(/_/g, " ")}</Badge>
                    </div>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Full Name</Label>
                      <Input defaultValue={user?.name} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input type="email" defaultValue={user?.email} />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm">Save Changes</Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" /> Security
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Current Password</Label>
                      <Input type="password" placeholder="••••••••" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>New Password</Label>
                      <Input type="password" placeholder="••••••••" />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm">Update Password</Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Notifications ── */}
          <TabsContent value="notifications">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notification Preferences</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Ticket assigned to me", desc: "Get notified when a ticket is assigned to you" },
                  { label: "Ticket updates", desc: "Status changes and updates on your tickets" },
                  { label: "New comments", desc: "When someone replies on your tickets" },
                  { label: "SLA warnings", desc: "Alerts when SLA deadline is approaching" },
                  { label: "Daily digest", desc: "Daily summary of open and pending tickets" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                    <Switch defaultChecked={i < 3} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Role Permissions ── */}
          {canManagePerms && (
            <TabsContent value="permissions">
              <div className="space-y-4">
                {/* Header info */}
                <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                  <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-700 space-y-0.5">
                    <p className="font-medium">Role-based permission control</p>
                    <p className="text-xs text-blue-600">
                      {user?.role === "super_admin"
                        ? "As Super Admin, you can configure permissions for all roles. Super Admin permissions are locked and cannot be changed."
                        : "As Admin, you can configure permissions for Manager, Agent, Employee, and External roles."}
                      {" "}Changes take effect immediately for all users with that role.
                    </p>
                  </div>
                </div>

                {/* Super admin's own row (readonly) */}
                {user?.role === "super_admin" && (() => {
                  const superPerms = allPermissions?.find((p) => p.role === "super_admin");
                  if (!superPerms) return null;
                  return <RolePermissionCard key="super_admin" initial={superPerms} isReadonly={true} callerRole={user.role} />;
                })()}

                {/* Manageable roles */}
                {loadingPerms ? (
                  Array.from({ length: manageableRoles.length || 2 }).map((_, i) => (
                    <Card key={i} className="animate-pulse">
                      <CardHeader><div className="h-5 bg-muted rounded w-24" /></CardHeader>
                      <CardContent><div className="h-32 bg-muted rounded" /></CardContent>
                    </Card>
                  ))
                ) : manageableRoles.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">No roles available to manage</div>
                ) : (
                  manageableRoles.map((role) => {
                    const p = allPermissions?.find((x) => x.role === role);
                    if (!p) return null;
                    return (
                      <RolePermissionCard
                        key={role}
                        initial={p}
                        isReadonly={false}
                        callerRole={user?.role ?? ""}
                      />
                    );
                  })
                )}
              </div>
            </TabsContent>
          )}

          {/* ── Email Accounts ── */}
          {canAdmin && (
            <TabsContent value="email-accounts">
              <EmailAccountsSection isSuperAdmin={isSuperAdmin} />
            </TabsContent>
          )}

          {/* ── Webhooks ── */}
          {isSuperAdmin && (
            <TabsContent value="webhooks">
              <WebhooksSection isSuperAdmin={isSuperAdmin} />
            </TabsContent>
          )}

          {/* ── Email Integration ── */}
          {canAdmin && (
            <TabsContent value="email-integration">
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" /> Email-to-Ticket Routing
                    </CardTitle>
                    <CardDescription>Inbound emails to these addresses are automatically converted to support tickets</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border border-border divide-y divide-border text-sm">
                      {[
                        { email: "employment.verification@dejoiy.com", alt: "employment.verification@corp.dejoiy.com", label: "Employment Verification", dept: "BGV / HR", priority: "High" },
                        { email: "bgv@dejoiy.com", alt: "bgv@corp.dejoiy.com", label: "Background Verification", dept: "BGV", priority: "High" },
                      ].map((route) => (
                        <div key={route.email} className="px-4 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">{route.label}</p>
                              <p className="font-mono text-xs text-primary">{route.email}</p>
                              <p className="font-mono text-xs text-muted-foreground">{route.alt}</p>
                            </div>
                            <div className="text-right space-y-1 flex-shrink-0">
                              <Badge variant="outline" className="text-[10px]">{route.dept}</Badge>
                              <p className="text-xs text-muted-foreground">{route.priority} priority</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" /> Inbound Webhook URL
                    </CardTitle>
                    <CardDescription>Configure your email provider (Mailgun, SendGrid, Postmark) to POST parsed emails to this URL</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Input readOnly value={webhookUrl} className="font-mono text-xs bg-muted" />
                      <Button variant="outline" size="sm" className="flex-shrink-0 gap-1" onClick={copyWebhook}>
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </Button>
                    </div>
                    <div className="rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground space-y-2">
                      <p className="font-medium text-foreground text-xs">Setup instructions</p>
                      <ol className="list-decimal list-inside space-y-1.5">
                        <li>Log in to your email provider (Mailgun, SendGrid, Postmark, or Zoho)</li>
                        <li>Set up inbound email routing / inbound parse for your domain</li>
                        <li>Configure the webhook URL above as the POST destination</li>
                        <li>Route: <span className="font-mono text-foreground">employment.verification@dejoiy.com</span>, <span className="font-mono text-foreground">bgv@dejoiy.com</span></li>
                        <li>The system will auto-create tickets from all matching inbound emails</li>
                      </ol>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-blue-500" /> Test Email Simulation
                    </CardTitle>
                    <CardDescription>Simulate an inbound email to verify ticket creation</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {simResult && (
                      <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600" />
                        <div>
                          <p className="font-medium">Ticket created successfully</p>
                          <p className="text-xs text-green-600 mt-0.5">
                            <span className="font-mono font-bold">{simResult.ticketNumber}</span>
                            {simResult.department ? ` → ${simResult.department} department` : ""}
                          </p>
                        </div>
                        <button className="ml-auto text-green-500 hover:text-green-700" onClick={() => setSimResult(null)}>✕</button>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">To (recipient)</Label>
                        <Select value={simTo} onValueChange={setSimTo}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bgv@dejoiy.com">bgv@dejoiy.com</SelectItem>
                            <SelectItem value="bgv@corp.dejoiy.com">bgv@corp.dejoiy.com</SelectItem>
                            <SelectItem value="employment.verification@dejoiy.com">employment.verification@dejoiy.com</SelectItem>
                            <SelectItem value="employment.verification@corp.dejoiy.com">employment.verification@corp.dejoiy.com</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">From (sender)</Label>
                        <Input value={simFrom} onChange={(e) => setSimFrom(e.target.value)} placeholder="sender@company.com" className="h-8 text-xs" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Subject</Label>
                      <Input value={simSubject} onChange={(e) => setSimSubject(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Email Body</Label>
                      <Textarea value={simText} onChange={(e) => setSimText(e.target.value)} rows={3} className="text-xs resize-none" />
                    </div>
                    <Button size="sm" className="gap-2" onClick={runSimulation} disabled={simulating}>
                      {simulating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      {simulating ? "Running…" : "Run Simulation"}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          )}

          {/* ── Email Notifications ── */}
          {canAdmin && (
            <TabsContent value="email-notifications">
              <div className="space-y-4">
                <EmailConfigSection isSuperAdmin={user?.role === "super_admin"} />
                <ImapConfigSection isSuperAdmin={user?.role === "super_admin"} />
              </div>
            </TabsContent>
          )}

          {/* ── System ── */}
          {canAdmin && (
            <TabsContent value="system">
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" /> SMTP / Outbound Email
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Configure outbound email from the <strong>Email Notifications</strong> tab above.</p>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" size="sm" onClick={() => { const el = document.querySelector('[data-value="email-notifications"]') as HTMLElement; el?.click(); }}>
                      Go to Email Notifications
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Globe className="h-4 w-4 text-muted-foreground" /> System Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 text-sm">
                      {[
                        { label: "Platform", value: "OrbitDesk Enterprise v1.0 by Dejoiy" },
                        { label: "Environment", value: "Production" },
                        { label: "Database", value: "PostgreSQL" },
                        { label: "API Version", value: "v0.1.0" },
                      ].map((item) => (
                        <div key={item.label} className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
                          <span className="text-muted-foreground">{item.label}</span>
                          <span className="font-medium text-foreground">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}
