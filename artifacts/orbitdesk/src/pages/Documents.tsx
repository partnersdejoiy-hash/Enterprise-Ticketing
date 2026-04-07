import React, { useState } from "react";
import { useLocation } from "wouter";
import { useListTickets, useListDepartments } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Clock, CheckCircle2, Send, AlertCircle, ChevronRight,
  FileBadge, FileSpreadsheet, FileCheck, FileX, Loader2, CircleDot, Pause, XCircle
} from "lucide-react";

const DOCUMENT_TYPES = [
  { value: "Experience Letter", icon: FileBadge, description: "Certificate of employment duration and role" },
  { value: "Salary Slip", icon: FileSpreadsheet, description: "Monthly salary/pay slip for any month" },
  { value: "Offer Letter Copy", icon: FileText, description: "Copy of your original offer letter" },
  { value: "Relieving Letter", icon: FileCheck, description: "Official confirmation of exit from organization" },
  { value: "Appointment Letter", icon: FileText, description: "Formal confirmation of your appointment" },
  { value: "Form 16 / Tax Certificate", icon: FileSpreadsheet, description: "Annual tax deduction certificate" },
  { value: "Promotion Letter", icon: FileBadge, description: "Letter confirming promotion and revised designation" },
  { value: "No Objection Certificate (NOC)", icon: FileCheck, description: "NOC for visa, loan, or other purposes" },
  { value: "Salary Certificate", icon: FileSpreadsheet, description: "Certificate stating current CTC/salary" },
  { value: "Increment Letter", icon: FileText, description: "Letter confirming salary increment" },
  { value: "ID / Employee Card Request", icon: FileBadge, description: "Request for employee ID card or replacement" },
  { value: "Other Document", icon: FileText, description: "Any other document not listed above" },
];

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: "Open", color: "bg-blue-100 text-blue-700 border-blue-200", icon: CircleDot },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700 border-amber-200", icon: Clock },
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: Pause },
  resolved: { label: "Resolved", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-600 border-gray-200", icon: XCircle },
};

export default function Documents() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [monthYear, setMonthYear] = useState("");
  const [notes, setNotes] = useState("");
  const [urgency, setUrgency] = useState("medium");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  const { data: departments } = useListDepartments();
  const hrDept = departments?.find((d) => d.name.toLowerCase().includes("hr")) ?? departments?.[0];

  const { data: myTickets, isLoading: loadingTickets, refetch } = useListTickets({
    search: "Document Request:",
    limit: 50,
  });

  const docTickets = (myTickets?.tickets ?? []).filter((t) =>
    t.subject.startsWith("Document Request:") &&
    (user?.role !== "employee" || t.createdById === user?.id)
  );

  const handleSubmit = async () => {
    if (!selectedType) {
      toast({ title: "Select a document type", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem("auth_token");
      const subject = `Document Request: ${selectedType}${monthYear ? ` (${monthYear})` : ""}`;
      const description = [
        `Document Type: ${selectedType}`,
        monthYear ? `Period / Month: ${monthYear}` : null,
        notes ? `\nAdditional Details:\n${notes}` : null,
        `\nRequested by: ${user?.name} (${user?.email})`,
      ].filter(Boolean).join("\n");

      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          subject,
          description,
          priority: urgency,
          status: "open",
          departmentId: hrDept?.id ?? null,
          tags: ["document-request"],
        }),
      });
      if (!res.ok) throw new Error("Failed to submit request");
      const ticket = await res.json();
      setSubmitted(ticket.ticketNumber);
      setSelectedType(null);
      setMonthYear("");
      setNotes("");
      setUrgency("medium");
      await refetch();
      toast({ title: "Request submitted!", description: `Ticket ${ticket.ticketNumber} has been created. HR will process it shortly.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">Document Requests</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Request HR documents and certificates — your request creates a support ticket tracked by the HR team</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Request Form */}
          <div className="lg:col-span-3 space-y-5">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">New Document Request</CardTitle>
                <CardDescription>Select the document you need and provide any relevant details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {submitted && (
                  <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                    <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600" />
                    <div>
                      <p className="font-medium">Request submitted successfully</p>
                      <p className="text-xs text-green-600 mt-0.5">Ticket <span className="font-mono font-bold">{submitted}</span> created — HR will process it soon</p>
                    </div>
                    <button className="ml-auto text-green-500 hover:text-green-700" onClick={() => setSubmitted(null)}>✕</button>
                  </div>
                )}

                {/* Document Type Grid */}
                <div>
                  <Label className="text-sm font-medium mb-3 block">Document Type <span className="text-destructive">*</span></Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {DOCUMENT_TYPES.map((doc) => {
                      const Icon = doc.icon;
                      const isSelected = selectedType === doc.value;
                      return (
                        <button
                          key={doc.value}
                          type="button"
                          onClick={() => setSelectedType(doc.value)}
                          className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all hover:border-primary/50 hover:bg-muted/30 ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border bg-background"}`}
                        >
                          <div className={`mt-0.5 rounded-md p-1.5 ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <p className={`text-xs font-medium leading-tight ${isSelected ? "text-primary" : "text-foreground"}`}>{doc.value}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{doc.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Month/Year - shown for salary-related docs */}
                {selectedType && (selectedType.includes("Salary") || selectedType.includes("Form 16")) && (
                  <div className="space-y-1.5">
                    <Label htmlFor="period">Month / Period <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input
                      id="period"
                      placeholder="e.g. March 2025, FY 2024-25"
                      value={monthYear}
                      onChange={(e) => setMonthYear(e.target.value)}
                    />
                  </div>
                )}

                {/* Urgency */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Urgency</Label>
                    <Select value={urgency} onValueChange={setUrgency}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low — within 5 days</SelectItem>
                        <SelectItem value="medium">Medium — within 3 days</SelectItem>
                        <SelectItem value="high">High — within 1 day</SelectItem>
                        <SelectItem value="urgent">Urgent — same day</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Department</Label>
                    <div className="h-9 flex items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                      {hrDept?.name ?? "HR"}
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Additional Details <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Textarea
                    id="notes"
                    placeholder="Any specific requirements, address to mention on letter, purpose of document, etc."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="resize-none"
                  />
                </div>

                <Button
                  className="w-full gap-2"
                  onClick={handleSubmit}
                  disabled={!selectedType || submitting}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {submitting ? "Submitting…" : "Submit Request"}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar: Info + My Requests */}
          <div className="lg:col-span-2 space-y-4">
            {/* Info card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Important Note
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-2">
                <p>All document requests are processed by the HR team during business hours (Mon–Fri, 9 AM–6 PM).</p>
                <p>Standard processing time is <strong className="text-foreground">1–3 business days</strong> depending on urgency.</p>
                <p>You can track your request status below or in the Tickets section.</p>
              </CardContent>
            </Card>

            {/* My Requests */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">My Requests</CardTitle>
                <CardDescription className="text-xs">{docTickets.length} document request{docTickets.length !== 1 ? "s" : ""}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingTickets ? (
                  <div className="px-4 py-3 space-y-2">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : docTickets.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                    <FileText className="h-6 w-6 mx-auto mb-2 opacity-30" />
                    No requests yet
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {docTickets.slice(0, 8).map((ticket) => {
                      const sc = statusConfig[ticket.status] ?? statusConfig.open;
                      const StatusIcon = sc.icon;
                      return (
                        <button
                          key={ticket.id}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                          onClick={() => setLocation(`/tickets/${ticket.id}`)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{ticket.subject.replace("Document Request: ", "")}</p>
                            <p className="text-[11px] text-muted-foreground font-mono">{ticket.ticketNumber}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border flex-shrink-0 ${sc.color}`}>
                            <StatusIcon className="h-2.5 w-2.5" />
                            {sc.label}
                          </span>
                          <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
