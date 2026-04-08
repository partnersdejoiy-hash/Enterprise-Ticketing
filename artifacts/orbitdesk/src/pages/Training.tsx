import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Ticket,
  FileText,
  Users,
  Building2,
  Mail,
  CheckCircle2,
  Clock,
  AlertTriangle,
  BookOpen,
  PlayCircle,
  ChevronRight,
  Star,
  Zap,
  HelpCircle,
  Globe,
  Settings,
  ArrowRight,
  MessageSquare,
  Tag,
  Filter,
} from "lucide-react";

const steps = [
  {
    icon: Ticket,
    color: "bg-blue-100 text-blue-600",
    title: "Click 'New Ticket'",
    desc: "In the Tickets section, click the blue 'New Ticket' button in the top right corner.",
  },
  {
    icon: FileText,
    color: "bg-purple-100 text-purple-600",
    title: "Fill in the Details",
    desc: "Enter a clear subject, describe your issue in detail, pick the right department, and set a priority.",
  },
  {
    icon: Users,
    color: "bg-orange-100 text-orange-600",
    title: "Select Department",
    desc: "Choose the department best suited to handle your request (IT, HR, Finance, Legal, etc.).",
  },
  {
    icon: CheckCircle2,
    color: "bg-green-100 text-green-600",
    title: "Submit & Track",
    desc: "Click Submit. Your ticket gets a unique ID and you can track its progress in real-time.",
  },
];

const statusFlow = [
  { status: "Open", color: "bg-blue-100 text-blue-700 border-blue-200", desc: "Ticket just created, waiting to be picked up" },
  { status: "Assigned", color: "bg-purple-100 text-purple-700 border-purple-200", desc: "An agent has been assigned to your ticket" },
  { status: "In Progress", color: "bg-yellow-100 text-yellow-700 border-yellow-200", desc: "The agent is actively working on your issue" },
  { status: "Waiting", color: "bg-orange-100 text-orange-700 border-orange-200", desc: "Waiting for your response or additional info" },
  { status: "Resolved", color: "bg-green-100 text-green-700 border-green-200", desc: "Issue has been resolved — please verify and close" },
  { status: "Closed", color: "bg-gray-100 text-gray-700 border-gray-200", desc: "Ticket is fully closed and archived" },
];

const priorities = [
  { level: "Low", color: "bg-gray-100 text-gray-600", sla: "5 days", icon: "🟢", desc: "Non-urgent, general queries" },
  { level: "Medium", color: "bg-blue-100 text-blue-600", sla: "3 days", icon: "🔵", desc: "Standard issues, moderate impact" },
  { level: "High", color: "bg-orange-100 text-orange-600", sla: "1 day", icon: "🟠", desc: "Business impact, needs prompt attention" },
  { level: "Urgent", color: "bg-red-100 text-red-600", sla: "4 hours", icon: "🔴", desc: "Critical — system down or blocking work" },
];

const departments = [
  { name: "IT Support", icon: "💻", desc: "Hardware, software, network, access issues, password resets" },
  { name: "Human Resources", icon: "👥", desc: "Leave requests, HR policies, payroll queries, onboarding" },
  { name: "Finance", icon: "💰", desc: "Expense claims, invoices, budget approvals, reimbursements" },
  { name: "Legal", icon: "⚖️", desc: "Contracts, compliance queries, NDAs, legal documentation" },
  { name: "Admin", icon: "🏢", desc: "Facilities, office supplies, maintenance, travel bookings" },
  { name: "BGV", icon: "🔍", desc: "Background verification, document collection, checks" },
  { name: "Operations", icon: "⚙️", desc: "Process issues, operational support, cross-team coordination" },
  { name: "Customer Support", icon: "🎧", desc: "External customer queries, complaints, escalations" },
];

const faqs = [
  {
    q: "How do I check the status of my ticket?",
    a: "Go to the Tickets page. Your tickets are listed with their current status shown as a coloured badge. Click on any ticket to see detailed progress, comments, and history.",
  },
  {
    q: "Can I attach files to my ticket?",
    a: "Yes. In the Create Ticket form or when adding a comment in Ticket Detail, you can describe attachments. For large files, upload to your shared drive and paste the link in the description.",
  },
  {
    q: "How long will it take to resolve my ticket?",
    a: "Resolution time depends on priority and department SLA. Urgent tickets are handled within 4 hours; Low priority within 5 business days. You can see the SLA deadline in the Ticket Detail panel.",
  },
  {
    q: "What is an SLA?",
    a: "SLA stands for Service Level Agreement. It's a commitment by the team to respond and resolve your issue within a defined timeframe. If breached, the ticket turns red and managers are notified automatically.",
  },
  {
    q: "Can I request a document via email?",
    a: "Yes. You can send an email to the configured inbound address and OrbitDesk will automatically create a ticket. Alternatively, use the Document Requests portal for standard HR documents.",
  },
  {
    q: "What's the difference between Internal Notes and Comments?",
    a: "Public comments are visible to the requester. Internal Notes (yellow) are only visible to agents and admins — used for team collaboration without notifying the user.",
  },
  {
    q: "How does email-to-ticket work for my website forms?",
    a: "Your admin can configure a 'catch-all' email address. When your website form sends an email there, OrbitDesk automatically reads it via IMAP and creates a ticket — routed to the right department via automation rules.",
  },
  {
    q: "Can I raise a ticket on behalf of someone else?",
    a: "Yes. Use the 'Raised For' field in the Create Ticket form to enter the name and email of the person you're raising the ticket for. This is useful for managers or admins submitting on behalf of employees.",
  },
];

const modules = [
  { id: "intro", icon: BookOpen, label: "Introduction", color: "text-blue-600 bg-blue-50" },
  { id: "raise", icon: Ticket, label: "Raising Tickets", color: "text-purple-600 bg-purple-50" },
  { id: "status", icon: Clock, label: "Status & SLA", color: "text-orange-600 bg-orange-50" },
  { id: "departments", icon: Building2, label: "Departments", color: "text-green-600 bg-green-50" },
  { id: "documents", icon: FileText, label: "Document Portal", color: "text-pink-600 bg-pink-50" },
  { id: "email", icon: Mail, label: "Email → Ticket", color: "text-cyan-600 bg-cyan-50" },
  { id: "admin", icon: Settings, label: "For Admins", color: "text-red-600 bg-red-50" },
  { id: "faq", icon: HelpCircle, label: "FAQ", color: "text-gray-600 bg-gray-50" },
];

export default function Training() {
  const [activeModule, setActiveModule] = useState("intro");

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center shadow-sm">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Training Centre</h1>
            <p className="text-xs text-muted-foreground">Learn how to get the most out of Dejoiy OrbitDesk</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-blue-600 to-blue-800 rounded-md flex items-center justify-center">
              <span className="text-[10px] font-black text-white">D</span>
            </div>
            <Badge variant="secondary" className="text-xs">v1.0 by Dejoiy</Badge>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <aside className="w-56 border-r border-border bg-muted/30 p-3 space-y-1 overflow-y-auto flex-shrink-0 hidden md:block">
            {modules.map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left ${
                  activeModule === m.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <span className={`p-1 rounded-md ${activeModule === m.id ? "bg-white/20" : m.color}`}>
                  <m.icon className="h-3.5 w-3.5" />
                </span>
                {m.label}
              </button>
            ))}
          </aside>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="md:hidden flex gap-2 flex-wrap">
              {modules.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setActiveModule(m.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    activeModule === m.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:bg-accent"
                  }`}
                >
                  <m.icon className="h-3 w-3" />
                  {m.label}
                </button>
              ))}
            </div>

            {activeModule === "intro" && (
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-6 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-8 translate-x-8" />
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-8 -translate-x-8" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                        <span className="text-sm font-black">D</span>
                      </div>
                      <span className="text-sm font-bold opacity-90">Dejoiy OrbitDesk</span>
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Welcome to the Training Centre</h2>
                    <p className="text-blue-100 text-sm leading-relaxed">
                      OrbitDesk is your organisation's enterprise helpdesk system. Use it to raise support tickets,
                      track issues across departments, and get things resolved faster — all in one place.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { icon: Ticket, label: "Raise Tickets", desc: "Submit requests to any department", color: "from-blue-50 to-blue-100 text-blue-700" },
                    { icon: Clock, label: "Track SLAs", desc: "Monitor response & resolution times", color: "from-orange-50 to-orange-100 text-orange-700" },
                    { icon: Mail, label: "Email → Ticket", desc: "Emails auto-convert to tickets", color: "from-cyan-50 to-cyan-100 text-cyan-700" },
                    { icon: FileText, label: "Document Requests", desc: "Request HR documents easily", color: "from-pink-50 to-pink-100 text-pink-700" },
                  ].map((f) => (
                    <Card key={f.label} className={`bg-gradient-to-br ${f.color} border-0`}>
                      <CardContent className="p-4">
                        <f.icon className="h-7 w-7 mb-2" />
                        <p className="font-semibold text-sm">{f.label}</p>
                        <p className="text-xs opacity-80 mt-0.5">{f.desc}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <PlayCircle className="h-5 w-5 text-blue-600" /> Quick Start Guide
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { step: 1, text: "Log in with your company email and password", module: "intro" },
                        { step: 2, text: "Navigate to Tickets and click 'New Ticket'", module: "raise" },
                        { step: 3, text: "Fill in subject, description, department, and priority", module: "raise" },
                        { step: 4, text: "Submit and note your ticket number (e.g. TKT-001)", module: "raise" },
                        { step: 5, text: "Track your ticket status — you'll get email updates automatically", module: "status" },
                      ].map((s) => (
                        <div key={s.step} className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                            {s.step}
                          </div>
                          <p className="text-sm text-muted-foreground">{s.text}</p>
                          <button
                            onClick={() => setActiveModule(s.module)}
                            className="ml-auto text-xs text-blue-600 hover:underline flex items-center gap-0.5 flex-shrink-0"
                          >
                            Learn <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeModule === "raise" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-foreground mb-1">How to Raise a Ticket</h2>
                  <p className="text-sm text-muted-foreground">Follow these steps to submit a support request</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {steps.map((s, i) => (
                    <Card key={i} className="relative overflow-hidden">
                      <div className="absolute top-3 right-3 text-4xl font-black text-gray-100 select-none">{i + 1}</div>
                      <CardContent className="p-5">
                        <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${s.color} mb-3`}>
                          <s.icon className="h-5 w-5" />
                        </div>
                        <h3 className="font-semibold text-foreground mb-1.5">{s.title}</h3>
                        <p className="text-sm text-muted-foreground">{s.desc}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Tag className="h-4 w-4 text-blue-600" /> Tips for a Good Ticket
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {[
                        "Write a clear, specific subject line — not just 'Issue' but 'Unable to access VPN from home office'",
                        "Include error messages, screenshots, or steps to reproduce the problem",
                        "Set priority accurately — overusing 'Urgent' slows down genuinely critical tickets",
                        "Tag your ticket with relevant keywords to help agents find related tickets",
                        "Use 'Raised For' when submitting on behalf of a colleague",
                        "Add the affected user's email if raising via email from a form or automation",
                      ].map((tip, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Filter className="h-4 w-4 text-purple-600" /> Filtering Your Tickets
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-2">
                    <p>On the Tickets page, use the filter bar at the top to narrow results by:</p>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {["Status", "Priority", "Department", "Assigned To", "Date Range", "Search by keyword"].map((f) => (
                        <div key={f} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 text-xs font-medium">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                          {f}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeModule === "status" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-foreground mb-1">Ticket Status & SLA</h2>
                  <p className="text-sm text-muted-foreground">Understanding how tickets move through the system</p>
                </div>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Status Flow</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {statusFlow.map((s, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <Badge className={`${s.color} border text-xs font-semibold min-w-[90px] justify-center`}>
                            {s.status}
                          </Badge>
                          {i < statusFlow.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                          {i === statusFlow.length - 1 && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                          <span className="text-sm text-muted-foreground">{s.desc}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-orange-500" /> Priority & SLA Guide
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {priorities.map((p) => (
                        <div key={p.level} className={`rounded-xl p-4 ${p.color} border`}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-lg">{p.icon}</span>
                            <span className="font-semibold text-sm">{p.level} Priority</span>
                            <Badge variant="outline" className="ml-auto text-xs">SLA: {p.sla}</Badge>
                          </div>
                          <p className="text-xs opacity-80">{p.desc}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
                      SLA timers are set per department and may vary. Check your department's settings for exact targets.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeModule === "departments" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-foreground mb-1">Departments</h2>
                  <p className="text-sm text-muted-foreground">Which department handles what</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {departments.map((d) => (
                    <Card key={d.name} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4 flex items-start gap-3">
                        <div className="text-2xl">{d.icon}</div>
                        <div>
                          <h3 className="font-semibold text-sm text-foreground">{d.name}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">{d.desc}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card className="border-blue-200 bg-blue-50/50">
                  <CardContent className="p-4 text-sm text-blue-700">
                    <strong>Not sure which department?</strong> Select "General" or "IT Support" — agents can re-route your ticket to the right team if needed.
                  </CardContent>
                </Card>
              </div>
            )}

            {activeModule === "documents" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-foreground mb-1">Document Request Portal</h2>
                  <p className="text-sm text-muted-foreground">Request HR documents quickly and easily</p>
                </div>
                <Card>
                  <CardContent className="p-5 space-y-4">
                    <p className="text-sm text-muted-foreground">
                      The Document Requests portal (accessible from the sidebar) lets you request standard HR documents without raising a manual ticket. Each request automatically creates a ticket routed to HR.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {["Experience Letter", "Salary Slip", "NOC / No Objection Certificate", "Tax Certificate", "Bank Statement Letter", "Work From Home Certificate"].map((doc) => (
                        <div key={doc} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 text-xs font-medium">
                          <FileText className="h-3.5 w-3.5 text-pink-500 flex-shrink-0" />
                          {doc}
                        </div>
                      ))}
                    </div>
                    <div className="border-t pt-3">
                      <p className="text-xs font-semibold text-foreground mb-2">How it works:</p>
                      <div className="space-y-2">
                        {[
                          "Navigate to 'Document Requests' in the sidebar",
                          "Select the document type you need",
                          "Fill in required details (e.g. month for salary slip)",
                          "Submit — a ticket is automatically created in HR",
                          "HR processes and delivers your document via email or ticket comment",
                        ].map((step, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <div className="w-5 h-5 rounded-full bg-pink-100 text-pink-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                              {i + 1}
                            </div>
                            {step}
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeModule === "email" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-foreground mb-1">Email → Ticket Automation</h2>
                  <p className="text-sm text-muted-foreground">How incoming emails automatically become support tickets</p>
                </div>
                <Card className="border-cyan-200 bg-gradient-to-br from-cyan-50 to-blue-50">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-cyan-600 rounded-xl flex items-center justify-center">
                        <Mail className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-cyan-900">How Email-to-Ticket Works</p>
                        <p className="text-xs text-cyan-700">Emails sent to the configured address are automatically converted</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {[
                        { from: "Your website contact form", to: "Sends email → OrbitDesk", result: "New ticket in Customer Support" },
                        { from: "Employee sends email to IT inbox", to: "Sends email → OrbitDesk", result: "New ticket in IT Support" },
                        { from: "Invoice received from vendor", to: "Forwards email → OrbitDesk", result: "New ticket in Finance" },
                      ].map((ex, i) => (
                        <div key={i} className="bg-white rounded-lg p-3 border border-cyan-100 text-xs space-y-1">
                          <div className="flex items-center gap-2 text-cyan-700">
                            <Globe className="h-3.5 w-3.5" /> <strong>{ex.from}</strong>
                          </div>
                          <div className="flex items-center gap-1 text-muted-foreground pl-5">
                            <ArrowRight className="h-3 w-3" /> {ex.to}
                          </div>
                          <div className="flex items-center gap-1 text-green-700 pl-5">
                            <CheckCircle2 className="h-3 w-3" /> {ex.result}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">For Admins: Setting Up Email-to-Ticket</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-3">
                    <ol className="space-y-2">
                      {[
                        "Go to Settings → Email Notifications",
                        "Enable IMAP and enter your mailbox credentials (host, port, email, app password)",
                        "Set the poll interval (e.g. every 2 minutes)",
                        "Go to Settings → Automation Rules",
                        "Create rules to route emails from specific addresses or subjects to the right department",
                        "Save — OrbitDesk will now poll the mailbox and create tickets automatically",
                      ].map((s, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="w-5 h-5 rounded-full bg-cyan-100 text-cyan-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          {s}
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeModule === "admin" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-foreground mb-1">Administrator Guide</h2>
                  <p className="text-sm text-muted-foreground">Managing OrbitDesk as an admin or super admin</p>
                </div>
                <div className="grid gap-4">
                  {[
                    {
                      icon: Users,
                      color: "text-blue-600 bg-blue-50",
                      title: "User Management",
                      items: [
                        "Add users manually or import via CSV",
                        "Assign roles: Super Admin, Admin, Manager, Agent, Employee, External",
                        "Activate/deactivate accounts",
                        "Assign users to departments",
                        "Reset passwords on behalf of users",
                      ],
                    },
                    {
                      icon: Building2,
                      color: "text-green-600 bg-green-50",
                      title: "Department Management",
                      items: [
                        "Create and configure departments",
                        "Set SLA targets (response time, resolution time)",
                        "Choose department icon and colour",
                        "Assign department managers",
                      ],
                    },
                    {
                      icon: Zap,
                      color: "text-orange-600 bg-orange-50",
                      title: "Automation Rules",
                      items: [
                        "Create rules triggered by email or ticket creation",
                        "Set conditions: subject contains, from email ends with, etc.",
                        "Set actions: assign department, set priority, assign agent, add tag",
                        "Enable/disable rules without deleting them",
                        "Set rule priority order (lower number = higher priority)",
                      ],
                    },
                    {
                      icon: Settings,
                      color: "text-purple-600 bg-purple-50",
                      title: "System Settings",
                      items: [
                        "Configure SMTP for outbound email notifications",
                        "Configure IMAP for incoming email-to-ticket",
                        "Manage role-level permissions",
                        "Enable/disable SSO (configure redirect URL)",
                        "View system information and API version",
                      ],
                    },
                  ].map((section) => (
                    <Card key={section.title}>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg ${section.color}`}>
                            <section.icon className="h-4 w-4" />
                          </div>
                          {section.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1.5">
                          {section.items.map((item) => (
                            <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {activeModule === "faq" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-foreground mb-1">Frequently Asked Questions</h2>
                  <p className="text-sm text-muted-foreground">Answers to the most common questions</p>
                </div>
                <Accordion type="single" collapsible className="space-y-2">
                  {faqs.map((faq, i) => (
                    <AccordionItem key={i} value={`faq-${i}`} className="border rounded-xl px-4">
                      <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline py-4">
                        <span className="flex items-start gap-2 text-left">
                          <HelpCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          {faq.q}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground pb-4 pl-6">
                        {faq.a}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
                <Card className="border-blue-200 bg-blue-50/50">
                  <CardContent className="p-4 flex items-start gap-3">
                    <MessageSquare className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-blue-700">
                      <strong>Still have questions?</strong> Raise a ticket to the IT Support or Admin department — they'll help you navigate the system.
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
