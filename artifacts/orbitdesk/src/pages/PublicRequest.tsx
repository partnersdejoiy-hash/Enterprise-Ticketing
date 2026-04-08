import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2, Send, Building2 } from "lucide-react";

interface Department { id: number; name: string; }

export default function PublicRequest() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [ticketNumber, setTicketNumber] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", email: "", phone: "", organization: "",
    departmentId: "", subject: "", message: "",
  });

  useEffect(() => {
    fetch("/api/public/departments")
      .then(r => r.json())
      .then(data => setDepartments(Array.isArray(data) ? data : []))
      .catch(() => setDepartments([]))
      .finally(() => setLoadingDepts(false));
  }, []);

  const f = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      setError("Please fill in all required fields.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || undefined,
          organization: form.organization.trim() || undefined,
          departmentId: form.departmentId ? parseInt(form.departmentId) : undefined,
          subject: form.subject.trim(),
          message: form.message.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Submission failed");
      setTicketNumber(data.ticketNumber ?? "");
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3.5 flex items-center gap-3 shadow-sm">
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow">
            <img src="/dejoiy-logo.jpg" alt="Dejoiy" className="w-6 h-6 rounded-lg object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-orange-500 rounded-full flex items-center justify-center border border-white">
            <span className="text-[6px] font-black text-white">D</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 leading-none">
            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Dejoiy</span>
            <span className="font-black text-base tracking-tight text-gray-900">OrbitDesk</span>
          </div>
          <span className="text-[11px] text-gray-500">Enterprise Ticketing System</span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          {submitted ? (
            <Card className="shadow-lg border-0">
              <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4 text-center">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 mb-1">Request Submitted!</h2>
                  <p className="text-gray-500 text-sm">
                    Thank you. Your request has been received and a ticket has been created.
                    The relevant team will reach out to you shortly.
                  </p>
                </div>
                {ticketNumber && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-3 text-center">
                    <p className="text-xs text-blue-600 font-medium uppercase tracking-wider mb-0.5">Your Ticket Number</p>
                    <p className="text-2xl font-black text-blue-700 tracking-wider">{ticketNumber}</p>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  A confirmation email has been sent to <strong>{form.email}</strong>
                </p>
                <Button
                  variant="outline"
                  onClick={() => { setSubmitted(false); setForm({ name: "", email: "", phone: "", organization: "", departmentId: "", subject: "", message: "" }); }}
                  className="mt-2"
                >
                  Submit Another Request
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="shadow-lg border-0">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Send className="h-5 w-5 text-blue-600" />
                  Submit a Request
                </CardTitle>
                <CardDescription>
                  Fill in the form below and we'll route your request to the right team. You'll receive a confirmation email once submitted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Full Name <span className="text-red-500">*</span></Label>
                      <Input id="name" placeholder="Your full name" value={form.name} onChange={e => f("name", e.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email Address <span className="text-red-500">*</span></Label>
                      <Input id="email" type="email" placeholder="you@example.com" value={form.email} onChange={e => f("email", e.target.value)} required />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input id="phone" placeholder="+91 00000 00000" value={form.phone} onChange={e => f("phone", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="org">Company / Organization</Label>
                      <Input id="org" placeholder="Your company name" value={form.organization} onChange={e => f("organization", e.target.value)} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="dept">Department</Label>
                    {loadingDepts ? (
                      <div className="h-10 rounded-md border bg-muted/40 flex items-center px-3 gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Loading departments…</span>
                      </div>
                    ) : (
                      <Select value={form.departmentId} onValueChange={v => f("departmentId", v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select the relevant department" />
                        </SelectTrigger>
                        <SelectContent>
                          {departments.map(d => (
                            <SelectItem key={d.id} value={String(d.id)}>
                              <div className="flex items-center gap-2">
                                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                                {d.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="subject">Subject <span className="text-red-500">*</span></Label>
                    <Input id="subject" placeholder="Brief description of your request" value={form.subject} onChange={e => f("subject", e.target.value)} required />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="message">Message <span className="text-red-500">*</span></Label>
                    <Textarea
                      id="message"
                      placeholder="Please describe your request in detail..."
                      rows={5}
                      value={form.message}
                      onChange={e => f("message", e.target.value)}
                      required
                    />
                  </div>

                  {error && (
                    <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <Button type="submit" className="w-full h-11 gap-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 font-semibold" disabled={submitting}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {submitting ? "Submitting…" : "Submit Request"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <footer className="py-5 text-center border-t border-gray-200 bg-white">
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-xs text-gray-400">Powered by</span>
          <div className="w-4 h-4 bg-gradient-to-br from-blue-600 to-blue-800 rounded flex items-center justify-center">
            <span className="text-[8px] font-black text-white">D</span>
          </div>
          <span className="text-xs font-bold text-gray-600">Dejoiy</span>
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">&copy; {new Date().getFullYear()} Dejoiy. All rights reserved.</p>
      </footer>
    </div>
  );
}
