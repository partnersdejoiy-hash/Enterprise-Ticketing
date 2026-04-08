import React, { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateTicket, useListDepartments, useListUsers } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, TicketIcon, Users, User, Search, CheckCircle2, XCircle, Home, Lock } from "lucide-react";

const schema = z.object({
  subject: z.string().min(3, "Subject must be at least 3 characters"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  departmentId: z.string().optional(),
  assigneeId: z.string().optional(),
  tags: z.string().optional(),
  raisedForName: z.string().optional(),
  raisedForEmail: z.string().email("Invalid email address").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof schema>;

export default function CreateTicket() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createTicket = useCreateTicket();

  const { data: departments } = useListDepartments();
  const { data: users } = useListUsers({ role: "agent" });

  const [raisingForOther, setRaisingForOther] = useState(false);
  const [empIdInput, setEmpIdInput] = useState("");
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "found" | "not_found">("idle");

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      subject: "",
      description: "",
      priority: "medium",
      departmentId: "",
      assigneeId: "",
      tags: "",
      raisedForName: "",
      raisedForEmail: "",
    },
  });

  const applyWfhTemplate = useCallback(() => {
    const hrDept = departments?.find(d => /hr|human.?resource/i.test(d.name));
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    form.setValue("subject", `Work From Home Request — ${today}`, { shouldValidate: true });
    form.setValue("description",
      `I am requesting approval to work from home.\n\nDate(s): \nReason: \nWork plan for the day:\n\nI will remain reachable on phone and email during standard working hours and ensure all deliverables are met.\n\nPlease review and approve at your earliest convenience.\n\nThank you.`,
      { shouldValidate: true }
    );
    form.setValue("priority", "low");
    form.setValue("tags", "wfh-request");
    if (hrDept) form.setValue("departmentId", String(hrDept.id));
    toast({ title: "WFH template applied", description: "Fill in the remaining details and submit." });
  }, [departments, form, toast]);

  const applyPasswordResetTemplate = useCallback(() => {
    const itDept = departments?.find(d => /^it$/i.test(d.name.trim()));
    form.setValue("subject", "Password Reset Request", { shouldValidate: true });
    form.setValue("description",
      `I am unable to access my account and require a password reset.\n\nEmployee ID: \nLast successful login: \nAdditional notes: \n\nPlease assist at your earliest convenience.\n\nThank you.`,
      { shouldValidate: true }
    );
    form.setValue("priority", "medium");
    form.setValue("tags", "password-reset");
    if (itDept) form.setValue("departmentId", String(itDept.id));
    toast({ title: "Password reset template applied", description: "Fill in the remaining details and submit." });
  }, [departments, form, toast]);

  const lookupEmployee = useCallback(async () => {
    if (!empIdInput.trim()) return;
    setLookupState("loading");
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/users/lookup?employeeId=${encodeURIComponent(empIdInput.trim())}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const user = await res.json();
        form.setValue("raisedForName", user.name, { shouldValidate: true });
        form.setValue("raisedForEmail", user.email, { shouldValidate: true });
        setLookupState("found");
        toast({ title: "Employee found", description: `${user.name} (${user.email})` });
      } else {
        setLookupState("not_found");
        toast({ title: "Not found", description: "No user found with that employee ID", variant: "destructive" });
      }
    } catch {
      setLookupState("not_found");
    }
  }, [empIdInput, form, toast]);

  const onSubmit = (values: FormValues) => {
    createTicket.mutate({
      data: {
        subject: values.subject,
        description: values.description,
        priority: values.priority,
        departmentId: values.departmentId && values.departmentId !== "none" ? parseInt(values.departmentId) : undefined,
        assigneeId: values.assigneeId && values.assigneeId !== "none" ? parseInt(values.assigneeId) : undefined,
        tags: values.tags ? values.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        ...(raisingForOther && values.raisedForName ? {
          raisedForName: values.raisedForName,
          raisedForEmail: values.raisedForEmail || undefined,
        } : {}),
      } as any
    }, {
      onSuccess: (ticket) => {
        toast({ title: "Ticket created", description: `${ticket.ticketNumber} has been created` });
        setLocation(`/tickets/${ticket.id}`);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to create ticket", variant: "destructive" });
      }
    });
  };

  return (
    <AppLayout>
      <div className="p-3 sm:p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/tickets")} className="h-8 px-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Create Ticket</h1>
            <p className="text-sm text-muted-foreground">Submit a new support request</p>
          </div>
        </div>

        <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Quick Templates */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-medium text-muted-foreground mr-1">Quick templates:</span>
            <button
              type="button"
              onClick={applyWfhTemplate}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Home className="h-3.5 w-3.5 text-blue-500" />
              Work From Home Request
            </button>
            <button
              type="button"
              onClick={applyPasswordResetTemplate}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Lock className="h-3.5 w-3.5 text-orange-500" />
              Password Reset Request
            </button>
          </div>

          {/* Raising For */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Who is this ticket for?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setRaisingForOther(false); form.setValue("raisedForName", ""); form.setValue("raisedForEmail", ""); setEmpIdInput(""); setLookupState("idle"); }}
                  className={`flex-1 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors ${!raisingForOther ? "border-primary bg-primary/5 text-primary font-medium" : "border-border text-muted-foreground hover:border-primary/50"}`}
                >
                  <User className="h-4 w-4 flex-shrink-0" />
                  <div className="text-left">
                    <p className="font-medium">Myself</p>
                    <p className="text-xs opacity-70">Submit on your own behalf</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRaisingForOther(true)}
                  className={`flex-1 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors ${raisingForOther ? "border-primary bg-primary/5 text-primary font-medium" : "border-border text-muted-foreground hover:border-primary/50"}`}
                >
                  <Users className="h-4 w-4 flex-shrink-0" />
                  <div className="text-left">
                    <p className="font-medium">Someone Else</p>
                    <p className="text-xs opacity-70">Submit on behalf of another person</p>
                  </div>
                </button>
              </div>

              {raisingForOther && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Employee ID Lookup</label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter employee ID (e.g. EMP-001)"
                        value={empIdInput}
                        onChange={e => { setEmpIdInput(e.target.value); setLookupState("idle"); }}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); lookupEmployee(); }}}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={lookupEmployee} disabled={lookupState === "loading" || !empIdInput.trim()} className="flex-shrink-0 gap-1">
                        {lookupState === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        Lookup
                      </Button>
                    </div>
                    {lookupState === "found" && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Employee found – details auto-filled below
                      </div>
                    )}
                    {lookupState === "not_found" && (
                      <div className="flex items-center gap-1.5 text-xs text-destructive">
                        <XCircle className="h-3.5 w-3.5" />
                        No employee found with that ID. You can enter details manually.
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Or fill in the details manually below</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="raisedForName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name <span className="text-destructive">*</span></FormLabel>
                          <FormControl>
                            <Input placeholder="John Smith" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="raisedForEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email Address</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="john.smith@company.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {form.watch("raisedForName") && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-xs">CC</Badge>
                      Notification emails will be sent to {form.watch("raisedForEmail") || "the email above"} when this ticket is created or resolved.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <TicketIcon className="h-4 w-4 text-primary" />
                Ticket Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="Brief description of the issue" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Provide detailed information about the issue..."
                            className="min-h-[120px] resize-y"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="priority"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Priority</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="departmentId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Department</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select department" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">No department</SelectItem>
                              {(departments ?? []).map((d) => (
                                <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="assigneeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assignee</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Auto-assign" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">Auto-assign</SelectItem>
                            {(users ?? []).map((u) => (
                              <SelectItem key={u.id} value={String(u.id)}>
                                {u.name} {u.departmentName ? `(${u.departmentName})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="tags"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tags</FormLabel>
                        <FormControl>
                          <Input placeholder="vpn, hardware, software (comma separated)" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-3 pt-2">
                    <Button type="button" variant="outline" onClick={() => setLocation("/tickets")}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createTicket.isPending}>
                      {createTicket.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Create Ticket
                    </Button>
                  </div>
            </CardContent>
          </Card>
        </form>
        </Form>
      </div>
    </AppLayout>
  );
}
