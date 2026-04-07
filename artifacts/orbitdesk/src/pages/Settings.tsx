import React from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuthStore } from "@/lib/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { User, Bell, Settings as SettingsIcon, Shield, Mail, Globe, Database } from "lucide-react";

export default function Settings() {
  const { user } = useAuthStore();

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your account and system preferences</p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="mb-6">
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4" /> Profile
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="h-4 w-4" /> Notifications
            </TabsTrigger>
            <TabsTrigger value="system" className="gap-2">
              <SettingsIcon className="h-4 w-4" /> System
            </TabsTrigger>
          </TabsList>

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
                      { label: "Platform", value: "OrbitDesk Enterprise v1.0" },
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
        </Tabs>
      </div>
    </AppLayout>
  );
}
