import React, { useState, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useListTickets, useListDepartments } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { BulkUploadDialog } from "@/components/BulkUploadDialog";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useAuthStore } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Plus, Upload, Search, Filter, RefreshCw, AlertCircle, Clock, CheckCircle2, 
  CircleDot, Pause, XCircle, ChevronLeft, ChevronRight, MoreHorizontal, Trash2
} from "lucide-react";

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: "Open", color: "bg-blue-100 text-blue-700 border-blue-200", icon: CircleDot },
  assigned: { label: "Assigned", color: "bg-orange-100 text-orange-700 border-orange-200", icon: AlertCircle },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700 border-amber-200", icon: Clock },
  waiting: { label: "Waiting", color: "bg-purple-100 text-purple-700 border-purple-200", icon: Pause },
  resolved: { label: "Resolved", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-600 border-gray-200", icon: XCircle },
};

const priorityConfig: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "bg-slate-100 text-slate-600 border-slate-200" },
  medium: { label: "Medium", color: "bg-blue-50 text-blue-600 border-blue-200" },
  high: { label: "High", color: "bg-orange-100 text-orange-700 border-orange-200" },
  urgent: { label: "Urgent", color: "bg-red-100 text-red-700 border-red-200" },
};

function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? { label: status, color: "bg-gray-100 text-gray-600 border-gray-200", icon: CircleDot };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${config.color}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const config = priorityConfig[priority] ?? { label: priority, color: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${config.color}`}>
      {config.label}
    </span>
  );
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Tickets() {
  const { perms } = useMyPermissions();
  const { user } = useAuthStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const canDelete = user?.role === "super_admin" || user?.role === "admin";
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; ticketNumber: string; subject: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteTicket = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/tickets/${deleteTarget.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to delete ticket");
      await queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      toast({ title: "Ticket deleted", description: `${deleteTarget.ticketNumber} has been permanently deleted` });
      setDeleteTarget(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };
  const queryString = useSearch();
  const initialSearch = new URLSearchParams(queryString).get("q") ?? "";

  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showBulk, setShowBulk] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(queryString).get("q") ?? "";
    if (q) {
      setSearch(q);
      setPage(1);
    }
  }, [queryString]);

  const { data, isLoading, refetch } = useListTickets({
    status: status || undefined,
    priority: priority || undefined,
    departmentId: departmentId ? parseInt(departmentId) : undefined,
    search: search || undefined,
    page,
    limit: 20,
  });

  const { data: departments } = useListDepartments();

  const tickets = data?.tickets ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = tickets.length > 0 && tickets.every(t => selected.has(t.id));

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Tickets</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{total} total tickets</p>
          </div>
          <div className="flex items-center gap-2">
            {perms.canBulkUpload && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowBulk(true)}>
                <Upload className="h-4 w-4" />
                Bulk Upload
              </Button>
            )}
            {perms.canCreateTicket && (
              <Button onClick={() => setLocation("/tickets/new")} size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                New Ticket
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tickets..."
              className="pl-9 h-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="waiting">Waiting</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={(v) => { setPriority(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-32 h-9">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <Select value={departmentId} onValueChange={(v) => { setDepartmentId(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {(departments ?? []).map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-9 px-2.5 text-muted-foreground">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Table */}
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="w-10 px-3 py-2.5 text-left">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(c) => {
                      if (c) setSelected(new Set(tickets.map(t => t.id)));
                      else setSelected(new Set());
                    }}
                  />
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Ticket</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Subject</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Department</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Priority</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Assignee</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Created</th>
                {canDelete && <th className="w-10 px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-3 py-2.5"><Skeleton className="h-4 w-4" /></td>
                    <td className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></td>
                    <td className="px-3 py-2.5"><Skeleton className="h-4 w-48" /></td>
                    <td className="px-3 py-2.5"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-3 py-2.5"><Skeleton className="h-5 w-20" /></td>
                    <td className="px-3 py-2.5"><Skeleton className="h-5 w-16" /></td>
                    <td className="px-3 py-2.5"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-3 py-2.5"><Skeleton className="h-4 w-24" /></td>
                  </tr>
                ))
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                    <Filter className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="font-medium">No tickets found</p>
                    <p className="text-xs mt-1">Try adjusting your filters or create a new ticket</p>
                  </td>
                </tr>
              ) : tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  onClick={() => setLocation(`/tickets/${ticket.id}`)}
                  className={`border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors ${selected.has(ticket.id) ? "bg-primary/5" : ""} ${ticket.slaBreached ? "border-l-2 border-l-red-400" : ""}`}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(ticket.id)} onCheckedChange={() => toggleSelect(ticket.id)} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
                  </td>
                  <td className="px-3 py-2.5 max-w-xs">
                    <div className="flex items-start gap-1.5">
                      <span className="font-medium text-foreground line-clamp-1">{ticket.subject}</span>
                      {ticket.slaBreached && (
                        <span className="inline-flex items-center px-1.5 py-0 rounded text-xs bg-red-100 text-red-700 border border-red-200 shrink-0">SLA</span>
                      )}
                    </div>
                    {ticket.tags.length > 0 && (
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {ticket.tags.slice(0, 2).map(tag => (
                          <span key={tag} className="text-xs text-muted-foreground bg-muted px-1.5 py-0 rounded">{tag}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-muted-foreground text-sm">{ticket.departmentName ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-sm text-muted-foreground">{ticket.assigneeName ?? <span className="italic">Unassigned</span>}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</span>
                  </td>
                  {canDelete && (
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive gap-2"
                            onClick={() => setDeleteTarget({ id: ticket.id, ticketNumber: ticket.ticketNumber, subject: ticket.subject })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete Ticket
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages} · {total} tickets
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="h-8 w-8 p-0">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="h-8 w-8 p-0">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
      <BulkUploadDialog open={showBulk} onClose={() => setShowBulk(false)} type="tickets" onSuccess={refetch} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{deleteTarget?.ticketNumber}</strong>: "{deleteTarget?.subject}"? This will also remove all comments and history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteTicket}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete Ticket"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
