import React, { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Plus, Briefcase, User, Mail, Phone, Calendar, Search, RefreshCw, Loader2 } from "lucide-react";

const statusColors: Record<string, string> = {
  open:        "bg-blue-100 text-blue-700 border-blue-200",
  in_progress: "bg-yellow-100 text-yellow-700 border-yellow-200",
  resolved:    "bg-green-100 text-green-700 border-green-200",
  closed:      "bg-gray-100 text-gray-600 border-gray-200",
  waiting:     "bg-purple-100 text-purple-700 border-purple-200",
};

const statusLabel: Record<string, string> = {
  open: "Pending", in_progress: "In Progress", resolved: "Verified",
  closed: "Closed", waiting: "Waiting",
};

const priorityColors: Record<string, string> = {
  low: "bg-gray-100 text-gray-600", medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700", urgent: "bg-red-100 text-red-700",
};

interface Ticket {
  id: number; ticketNumber: string; subject: string; description: string;
  status: string; priority: string; createdAt: string; raisedForName?: string;
  raisedForEmail?: string; departmentName?: string; assigneeName?: string; tags?: string[];
}

export default function EmploymentVerification() {
  const { token } = useAuthStore();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employeeName: "", employeeEmail: "", phone: "", company: "",
    jobTitle: "", employmentPeriod: "", subject: "", description: "", priority: "medium",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tickets?tags=employment-verification&limit=100", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setTickets(data.tickets ?? []);
    } catch {
      toast({ title: "Error", description: "Could not load employment verification requests.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = tickets.filter(t =>
    !search || t.subject.toLowerCase().includes(search.toLowerCase()) ||
    t.ticketNumber.toLowerCase().includes(search.toLowerCase()) ||
    (t.raisedForName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!form.employeeName.trim() || !form.subject.trim()) {
      toast({ title: "Required fields missing", description: "Employee name and subject are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const description = [
        `Employee Name: ${form.employeeName}`,
        form.employeeEmail ? `Employee Email: ${form.employeeEmail}` : "",
        form.phone ? `Phone: ${form.phone}` : "",
        form.company ? `Previous Company: ${form.company}` : "",
        form.jobTitle ? `Job Title: ${form.jobTitle}` : "",
        form.employmentPeriod ? `Employment Period: ${form.employmentPeriod}` : "",
        "",
        form.description || "Employment verification request submitted.",
      ].filter(Boolean).join("\n");

      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          subject: form.subject || `Employment Verification — ${form.employeeName}`,
          description,
          priority: form.priority,
          tags: ["employment-verification"],
          raisedForName: form.employeeName,
          raisedForEmail: form.employeeEmail || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create request");
      toast({ title: "Request created", description: "Employment verification request has been submitted." });
      setOpen(false);
      setForm({ employeeName: "", employeeEmail: "", phone: "", company: "", jobTitle: "", employmentPeriod: "", subject: "", description: "", priority: "medium" });
      load();
    } catch {
      toast({ title: "Error", description: "Failed to submit request.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Briefcase className="h-6 w-6 text-blue-600" />
              Employment Verification
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Track and manage employment verification requests</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={() => setOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> New Request
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "Total Requests", count: tickets.length, color: "text-blue-600" },
            { label: "In Progress", count: tickets.filter(t => t.status === "in_progress" || t.status === "open").length, color: "text-yellow-600" },
            { label: "Verified", count: tickets.filter(t => t.status === "resolved" || t.status === "closed").length, color: "text-green-600" },
          ].map(({ label, count, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className={`text-3xl font-bold ${color} mt-1`}>{count}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, subject, ticket..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <Briefcase className="h-12 w-12 text-muted-foreground/40" />
              <p className="text-muted-foreground font-medium">No verification requests yet</p>
              <Button size="sm" onClick={() => setOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Create First Request
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((ticket) => (
              <Card key={ticket.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{ticket.ticketNumber}</span>
                        <Badge variant="outline" className={`text-xs border ${statusColors[ticket.status] ?? ""}`}>
                          {statusLabel[ticket.status] ?? ticket.status}
                        </Badge>
                        <Badge variant="outline" className={`text-xs ${priorityColors[ticket.priority] ?? ""}`}>
                          {ticket.priority}
                        </Badge>
                      </div>
                      <h3 className="font-semibold text-foreground truncate">{ticket.subject}</h3>
                      <div className="flex items-center gap-4 mt-1.5 flex-wrap text-xs text-muted-foreground">
                        {ticket.raisedForName && (
                          <span className="flex items-center gap-1"><User className="h-3 w-3" />{ticket.raisedForName}</span>
                        )}
                        {ticket.raisedForEmail && (
                          <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{ticket.raisedForEmail}</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(ticket.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                        {ticket.assigneeName && <span>Assigned to: {ticket.assigneeName}</span>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Employment Verification Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Employee Name <span className="text-destructive">*</span></Label>
                <Input placeholder="Full name" value={form.employeeName} onChange={e => setForm(f => ({ ...f, employeeName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Employee Email</Label>
                <Input type="email" placeholder="email@example.com" value={form.employeeEmail} onChange={e => setForm(f => ({ ...f, employeeEmail: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone Number</Label>
                <Input placeholder="+91 00000 00000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Previous Company</Label>
                <Input placeholder="Company name" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Job Title / Role</Label>
                <Input placeholder="e.g. Software Engineer" value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Employment Period</Label>
                <Input placeholder="Jan 2020 – Dec 2022" value={form.employmentPeriod} onChange={e => setForm(f => ({ ...f, employmentPeriod: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Request Subject <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. Employment Verification — John Doe" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Additional Notes</Label>
              <Textarea placeholder="Any additional context or requirements..." rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
