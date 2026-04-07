import React, { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Bell, Settings as SettingsIcon, Shield, Mail, Globe, Database, CheckCircle2, Loader2, Copy, ExternalLink, Zap } from "lucide-react";

export default function Settings() {
  const { user } = useAuthStore();
  const { toast } = useToast();

  const [simTo, setSimTo] = useState("bgv@dejoiy.com");
  const [simFrom, setSimFrom] = useState("hr@acmecorp.com");
  const [simSubject, setSimSubject] = useState("Background check for John Doe");
  const [simText, setSimText] = useState("Please verify the employment history of John Doe (DOJ: Jan 2020 - Mar 2023) at Acme Corp.");
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ ticketNumber: string; department: string | null } | null>(null);

  const canAdmin = user?.role === "super_admin" || user?.role === "admin";

  const webhookPath = `/api/webhooks/email`;
  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}${webhookPath}` : webhookPath;

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      toast({ title: "Copied!", description: "Webhook URL copied to clipboard" });
    });
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
      <div className="p-6 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your account and system preferences</p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4" /> Profile
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="h-4 w-4" /> Notifications
            </TabsTrigger>
            {canAdmin && (
              <>
                <TabsTrigger value="email-integration" className="gap-2">
                  <Mail className="h-4 w-4" /> Email Integration
                </TabsTrigger>
                <TabsTrigger value="system" className="gap-2">
                  <SettingsIcon className="h-4 w-4" /> System
                </TabsTrigger>
              </>
            )}
          </TabsList>

          {/* ── Profile Tab ── */}
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
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    Security
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

          {/* ── Notifications Tab ── */}
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

          {/* ── Email Integration Tab ── */}
          {canAdmin && (
            <TabsContent value="email-integration">
              <div className="space-y-4">
                {/* Configured routes */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      Email-to-Ticket Routing
                    </CardTitle>
                    <CardDescription>Inbound emails to these addresses are automatically converted to support tickets</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border border-border divide-y divide-border text-sm">
                      {[
                        {
                          email: "employment.verification@dejoiy.com",
                          alt: "employment.verification@corp.dejoiy.com",
                          label: "Employment Verification",
                          dept: "BGV / HR",
                          priority: "High",
                        },
                        {
                          email: "bgv@dejoiy.com",
                          alt: "bgv@corp.dejoiy.com",
                          label: "Background Verification",
                          dept: "BGV",
                          priority: "High",
                        },
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

                {/* Webhook URL */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Inbound Webhook URL
                    </CardTitle>
                    <CardDescription>
                      Configure your email provider (Mailgun, SendGrid, Postmark) to POST parsed emails to this URL
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={webhookUrl}
                        className="font-mono text-xs bg-muted"
                      />
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
                        <li>Route the following addresses to the webhook: <span className="font-mono text-foreground">employment.verification@dejoiy.com</span>, <span className="font-mono text-foreground">bgv@dejoiy.com</span></li>
                        <li>The system will auto-create tickets from all matching inbound emails</li>
                      </ol>
                    </div>
                  </CardContent>
                </Card>

                {/* Simulation */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-blue-500" />
                      Test Email Simulation
                    </CardTitle>
                    <CardDescription>Simulate an inbound email to verify ticket creation without sending a real email</CardDescription>
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
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
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
                        <Input
                          value={simFrom}
                          onChange={(e) => setSimFrom(e.target.value)}
                          placeholder="sender@company.com"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Subject</Label>
                      <Input
                        value={simSubject}
                        onChange={(e) => setSimSubject(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Email Body</Label>
                      <Textarea
                        value={simText}
                        onChange={(e) => setSimText(e.target.value)}
                        rows={3}
                        className="text-xs resize-none"
                      />
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

          {/* ── System Tab ── */}
          {canAdmin && (
            <TabsContent value="system">
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      SMTP Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>SMTP Host</Label>
                        <Input placeholder="smtp.company.com" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Port</Label>
                        <Input placeholder="587" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Username</Label>
                        <Input placeholder="support@company.com" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Password</Label>
                        <Input type="password" placeholder="••••••••" />
                      </div>
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
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      System Information
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
