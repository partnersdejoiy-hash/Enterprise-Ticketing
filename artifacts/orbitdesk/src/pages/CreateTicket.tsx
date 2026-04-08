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
import { ArrowLeft, Loader2, TicketIcon, Users, User, Search, CheckCircle2, XCircle, Home, Lock, Paperclip, X as XIcon, File, FileText, Image, FileSpreadsheet } from "lucide-react";

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
  const [lookupTab, setLookupTab] = useState<"id" | "name">("id");
  const [nameInput, setNameInput] = useState("");
  const [nameResults, setNameResults] = useState<Array<{ id: number; name: string; email: string; departmentName: string | null; employeeId?: string | null }>>([]);
  const [ccManagers, setCcManagers] = useState(false);
  const [ccEmails, setCcEmails] = useState<string[]>([]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const ALLOWED_MIME = [
    "application/pdf","application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain","text/csv","image/png","image/jpeg","image/gif","image/webp","application/zip",
  ];

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const valid = files.filter(f => {
      if (!ALLOWED_MIME.includes(f.type)) {
        toast({ title: "Unsupported type", description: `${f.name} cannot be attached.`, variant: "destructive" });
        return false;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast({ title: "File too large", description: `${f.name} exceeds 10 MB.`, variant: "destructive" });
        return false;
      }
      return true;
    });
    setPendingFiles(prev => [...prev, ...valid]);
  };

  const removePendingFile = (idx: number) =>
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return <Image className="h-3.5 w-3.5 text-blue-500" />;
    if (type === "application/pdf") return <FileText className="h-3.5 w-3.5 text-red-500" />;
    if (type.includes("spreadsheet") || type.includes("excel") || type === "text/csv")
      return <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" />;
    return <File className="h-3.5 w-3.5 text-slate-500" />;
  };

  const uploadFiles = async (ticketId: number) => {
    const token = localStorage.getItem("auth_token");
    let uploaded = 0;
    for (const file of pendingFiles) {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const res = await fetch(`/api/tickets/${ticketId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ fileName: file.name, fileType: file.type, fileData: dataUrl }),
        });
        if (res.ok) uploaded++;
      } catch {}
    }
    return uploaded;
  };

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
    setNameResults([]);
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

  const lookupByName = useCallback(async () => {
    if (!nameInput.trim()) return;
    setLookupState("loading");
    setNameResults([]);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/users/lookup?name=${encodeURIComponent(nameInput.trim())}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        const results = Array.isArray(data) ? data : [data];
        setNameResults(results);
        setLookupState(results.length > 0 ? "found" : "not_found");
        if (results.length === 0) toast({ title: "Not found", description: "No users found with that name", variant: "destructive" });
      } else {
        setLookupState("not_found");
        toast({ title: "Not found", description: "No users found with that name", variant: "destructive" });
      }
    } catch {
      setLookupState("not_found");
    }
  }, [nameInput, toast]);

  const applyNameResult = useCallback((user: { name: string; email: string }) => {
    form.setValue("raisedForName", user.name, { shouldValidate: true });
    form.setValue("raisedForEmail", user.email, { shouldValidate: true });
    setNameResults([]);
    setLookupState("found");
  }, [form]);

  const fetchDeptManagers = useCallback(async (deptId: string) => {
    if (!deptId || deptId === "none") { setCcEmails([]); return; }
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/users?departmentId=${deptId}&role=manager`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        const managers = Array.isArray(data) ? data : (data.users ?? []);
        setCcEmails(managers.map((m: any) => m.email).filter(Boolean));
      }
    } catch { setCcEmails([]); }
  }, []);

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
        ccEmails: ccManagers ? ccEmails : [],
      } as any
    }, {
      onSuccess: async (ticket) => {
        if (pendingFiles.length > 0) {
          setUploadingFiles(true);
          const uploaded = await uploadFiles((ticket as any).id);
          setUploadingFiles(false);
          toast({
            title: "Ticket created",
            description: `${(ticket as any).ticketNumber} created with ${uploaded} attachment(s)`,
          });
        } else {
          toast({ title: "Ticket created", description: `${(ticket as any).ticketNumber} has been created` });
        }
        setLocation(`/tickets/${(ticket as any).id}`);
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
                    <label className="text-sm font-medium text-foreground">Employee Lookup</label>
                    {/* Lookup mode tabs */}
                    <div className="flex gap-1 p-0.5 bg-muted rounded-md w-fit">
                      <button
                        type="button"
                        onClick={() => { setLookupTab("id"); setLookupState("idle"); setNameResults([]); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${lookupTab === "id" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        By Employee ID
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLookupTab("name"); setLookupState("idle"); setNameResults([]); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${lookupTab === "name" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        By Employee Name
                      </button>
                    </div>
                    {lookupTab === "id" ? (
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
                    ) : (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input
                            placeholder="Enter employee name (partial match)"
                            value={nameInput}
                            onChange={e => { setNameInput(e.target.value); setLookupState("idle"); setNameResults([]); }}
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); lookupByName(); }}}
                            className="flex-1"
                          />
                          <Button type="button" variant="outline" size="sm" onClick={lookupByName} disabled={lookupState === "loading" || !nameInput.trim()} className="flex-shrink-0 gap-1">
                            {lookupState === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                            Search
                          </Button>
                        </div>
                        {nameResults.length > 0 && (
                          <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                            {nameResults.map(u => (
                              <button
                                key={u.id}
                                type="button"
                                onClick={() => applyNameResult(u)}
                                className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors flex items-center justify-between gap-2"
                              >
                                <div>
                                  <p className="text-sm font-medium text-foreground">{u.name}</p>
                                  <p className="text-xs text-muted-foreground">{u.email}{u.departmentName ? ` · ${u.departmentName}` : ""}{u.employeeId ? ` · ${u.employeeId}` : ""}</p>
                                </div>
                                <span className="text-xs text-primary flex-shrink-0">Select</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {lookupState === "found" && nameResults.length === 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Employee found – details auto-filled below
                      </div>
                    )}
                    {lookupState === "not_found" && (
                      <div className="flex items-center gap-1.5 text-xs text-destructive">
                        <XCircle className="h-3.5 w-3.5" />
                        No employee found. You can enter details manually below.
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
                          <Select
                            onValueChange={(val) => {
                              field.onChange(val);
                              if (ccManagers) fetchDeptManagers(val);
                            }}
                            value={field.value}
                          >
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

                  {/* CC Managers Toggle */}
                  <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20">
                    <input
                      type="checkbox"
                      id="cc-managers"
                      checked={ccManagers}
                      onChange={e => {
                        setCcManagers(e.target.checked);
                        if (e.target.checked) {
                          const deptId = form.getValues("departmentId");
                          if (deptId && deptId !== "none") fetchDeptManagers(deptId);
                        } else {
                          setCcEmails([]);
                        }
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <label htmlFor="cc-managers" className="text-sm font-medium text-foreground cursor-pointer select-none">
                        CC department managers
                      </label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Managers of the selected department will receive a copy of ticket notifications.
                      </p>
                      {ccManagers && ccEmails.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {ccEmails.map(email => (
                            <span key={email} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">CC</Badge>
                              {email}
                            </span>
                          ))}
                        </div>
                      )}
                      {ccManagers && ccEmails.length === 0 && (
                        <p className="text-xs text-muted-foreground mt-1">Select a department above to load managers.</p>
                      )}
                    </div>
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

                  {/* Attachments */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        <Paperclip className="h-4 w-4 text-muted-foreground" /> Attachments
                      </label>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        + Add files
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      accept={ALLOWED_MIME.join(",")}
                      onChange={handleFileAdd}
                    />
                    {pendingFiles.length === 0 ? (
                      <div
                        className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip className="h-5 w-5 text-muted-foreground mx-auto mb-1" />
                        <span className="text-xs text-muted-foreground">Click to attach files (PDF, Word, Excel, images — max 10 MB each)</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {pendingFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2 text-sm">
                            {getFileIcon(f.type)}
                            <span className="flex-1 truncate text-foreground">{f.name}</span>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(0)} KB` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                            </span>
                            <button type="button" onClick={() => removePendingFile(i)} className="text-muted-foreground hover:text-destructive">
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-xs text-primary hover:underline"
                        >
                          + Add more files
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <Button type="button" variant="outline" onClick={() => setLocation("/tickets")}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createTicket.isPending || uploadingFiles}>
                      {(createTicket.isPending || uploadingFiles) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      {uploadingFiles ? "Uploading files…" : "Create Ticket"}
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
