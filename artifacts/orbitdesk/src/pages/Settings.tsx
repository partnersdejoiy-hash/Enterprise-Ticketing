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
  Zap, Copy, CheckCircle2, Loader2, ShieldCheck, Lock, Info
} from "lucide-react";

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
              {dirty && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={reset} disabled={saving}>
                  Reset
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

// ─── Main Settings page ────────────────────────────────────────────────────────
export default function Settings() {
  const { user } = useAuthStore();
  const { toast } = useToast();

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
      <div className="p-6 max-w-4xl">
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
                <TabsTrigger value="email-integration" className="gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email Integration
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

          {/* ── System ── */}
          {canAdmin && (
            <TabsContent value="system">
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" /> SMTP Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>SMTP Host</Label><Input placeholder="smtp.company.com" /></div>
                      <div className="space-y-1.5"><Label>Port</Label><Input placeholder="587" /></div>
                      <div className="space-y-1.5"><Label>Username</Label><Input placeholder="support@company.com" /></div>
                      <div className="space-y-1.5"><Label>Password</Label><Input type="password" placeholder="••••••••" /></div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm">Test Connection</Button>
                      <Button size="sm">Save</Button>
                    </div>
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
