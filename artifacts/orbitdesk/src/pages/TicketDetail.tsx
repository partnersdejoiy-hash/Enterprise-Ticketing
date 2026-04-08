import React, { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetTicket, useListComments, useCreateComment, useUpdateTicket, useListUsers, useListDepartments } from "@workspace/api-client-react";
import { getGetTicketQueryKey, getListCommentsQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  ArrowLeft, Clock, User, Building2, Tag, AlertCircle, 
  CheckCircle2, MessageSquare, Lock, Globe, Send, History,
  TicketIcon, Trash2
} from "lucide-react";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";

const statusConfig: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "bg-blue-100 text-blue-700 border-blue-200" },
  assigned: { label: "Assigned", color: "bg-orange-100 text-orange-700 border-orange-200" },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700 border-amber-200" },
  waiting: { label: "Waiting", color: "bg-purple-100 text-purple-700 border-purple-200" },
  resolved: { label: "Resolved", color: "bg-green-100 text-green-700 border-green-200" },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-600 border-gray-200" },
};

const priorityConfig: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "bg-slate-100 text-slate-600" },
  medium: { label: "Medium", color: "bg-blue-50 text-blue-600" },
  high: { label: "High", color: "bg-orange-100 text-orange-700" },
  urgent: { label: "Urgent", color: "bg-red-100 text-red-700" },
};

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true
  });
}

export default function TicketDetail() {
  const params = useParams<{ id: string }>();
  const ticketId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { user } = useAuthStore();
  const canDelete = user?.role === "super_admin" || user?.role === "admin";
  const [comment, setComment] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [activeTab, setActiveTab] = useState<"conversation" | "history">("conversation");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingTicket, setDeletingTicket] = useState(false);

  const handleDeleteTicket = async () => {
    setDeletingTicket(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to delete ticket");
      await queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      toast({ title: "Ticket deleted", description: "The ticket has been permanently deleted" });
      setLocation("/tickets");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setDeletingTicket(false);
    }
  };

  const { data: ticket, isLoading } = useGetTicket(ticketId, {
    query: { enabled: !!ticketId, queryKey: getGetTicketQueryKey(ticketId) }
  });

  const { data: comments } = useListComments(ticketId, {
    query: { enabled: !!ticketId, queryKey: getListCommentsQueryKey(ticketId) }
  });

  const { data: users } = useListUsers({ role: "agent" });
  const { data: departments } = useListDepartments();

  const createComment = useCreateComment();
  const updateTicket = useUpdateTicket();

  const handleSendComment = () => {
    if (!comment.trim()) return;
    createComment.mutate({
      ticketId,
      data: { content: comment, isInternal }
    }, {
      onSuccess: () => {
        setComment("");
        queryClient.invalidateQueries({ queryKey: getListCommentsQueryKey(ticketId) });
        queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
      },
      onError: () => toast({ title: "Error", description: "Failed to send comment", variant: "destructive" })
    });
  };

  const handleUpdateField = (field: string, value: string | number | null) => {
    updateTicket.mutate({
      ticketId,
      data: { [field]: value }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
        toast({ title: "Updated", description: `Ticket ${field.replace(/_/g, " ")} updated` });
      },
      onError: () => toast({ title: "Error", description: "Update failed", variant: "destructive" })
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-3 sm:p-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!ticket) {
    return (
      <AppLayout>
        <div className="p-3 sm:p-6 text-center text-muted-foreground">
          <p>Ticket not found</p>
          <Button variant="link" onClick={() => setLocation("/tickets")}>Back to Tickets</Button>
        </div>
      </AppLayout>
    );
  }

  const statusCfg = statusConfig[ticket.status] ?? { label: ticket.status, color: "bg-gray-100 text-gray-600" };
  const priorityCfg = priorityConfig[ticket.priority] ?? { label: ticket.priority, color: "bg-gray-100 text-gray-600" };
  const publicComments = (comments ?? []).filter(c => !c.isInternal);
  const allComments = comments ?? [];

  return (
    <AppLayout>
      <div className="p-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-5 text-sm text-muted-foreground">
          <button onClick={() => setLocation("/tickets")} className="hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Tickets
          </button>
          <span>/</span>
          <span className="font-mono text-xs">{ticket.ticketNumber}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-4">
            {/* Ticket Header */}
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{ticket.ticketNumber}</span>
                    {ticket.slaBreached && (
                      <span className="text-xs bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> SLA Breached
                      </span>
                    )}
                  </div>
                  <h1 className="text-lg font-bold text-foreground leading-tight">{ticket.subject}</h1>
                </div>
                <div className="flex gap-2 shrink-0">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${statusCfg.color}`}>{statusCfg.label}</span>
                  <span className={`px-2.5 py-1 rounded text-xs font-medium ${priorityCfg.color}`}>{priorityCfg.label}</span>
                </div>
              </div>

              <div className="mt-4 text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                {ticket.description}
              </div>

              {ticket.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {ticket.tags.map(tag => (
                    <span key={tag} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Tag className="h-2.5 w-2.5" />{tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {ticket.createdByName}</span>
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatDateTime(ticket.createdAt)}</span>
                <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> {ticket.commentCount} comments</span>
              </div>
            </div>

            {/* Conversation / History tabs */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="flex border-b border-border">
                <button
                  onClick={() => setActiveTab("conversation")}
                  className={`px-4 py-3 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === "conversation" ? "text-primary border-b-2 border-primary -mb-px" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <MessageSquare className="h-4 w-4" /> Conversation ({publicComments.length})
                </button>
                <button
                  onClick={() => setActiveTab("history")}
                  className={`px-4 py-3 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === "history" ? "text-primary border-b-2 border-primary -mb-px" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <History className="h-4 w-4" /> History
                </button>
              </div>

              <div className="p-4 space-y-4">
                {activeTab === "conversation" ? (
                  <>
                    {allComments.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No comments yet. Start the conversation.</p>
                    ) : (
                      allComments.map((c) => (
                        <div key={c.id} className={`flex gap-3 ${c.isInternal ? "opacity-80" : ""}`}>
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                              {c.authorName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-foreground">{c.authorName}</span>
                              {c.isInternal && (
                                <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0 rounded">
                                  <Lock className="h-2.5 w-2.5" /> Internal
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                            </div>
                            <div className={`text-sm text-foreground/80 whitespace-pre-wrap bg-muted/40 rounded-lg p-3 ${c.isInternal ? "border-l-2 border-amber-400" : ""}`}>
                              {c.content}
                            </div>
                          </div>
                        </div>
                      ))
                    )}

                    {/* Reply Box */}
                    <div className="pt-4 border-t border-border space-y-3">
                      <Textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder={isInternal ? "Add an internal note..." : "Write a reply..."}
                        className={`min-h-[100px] resize-y ${isInternal ? "border-amber-300 bg-amber-50/30" : ""}`}
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Switch id="internal" checked={isInternal} onCheckedChange={setIsInternal} />
                          <Label htmlFor="internal" className="text-sm text-muted-foreground flex items-center gap-1 cursor-pointer">
                            {isInternal ? <Lock className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                            {isInternal ? "Internal note" : "Public reply"}
                          </Label>
                        </div>
                        <Button size="sm" onClick={handleSendComment} disabled={!comment.trim() || createComment.isPending} className="gap-1.5">
                          <Send className="h-3.5 w-3.5" /> Send
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    {(!ticket.history || ticket.history.length === 0) ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No history recorded</p>
                    ) : (
                      ticket.history.map((h) => (
                        <div key={h.id} className="flex items-start gap-3 text-sm">
                          <div className="w-2 h-2 rounded-full bg-primary/50 mt-1.5 shrink-0" />
                          <div className="flex-1">
                            <span className="font-medium text-foreground">{h.changedByName}</span>
                            <span className="text-muted-foreground"> {h.action.replace(/_/g, " ")}</span>
                            {h.oldValue && h.newValue && (
                              <span className="text-muted-foreground"> from <span className="font-medium text-foreground">{h.oldValue}</span> to <span className="font-medium text-foreground">{h.newValue}</span></span>
                            )}
                            <span className="ml-2 text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Attachments */}
          <AttachmentsPanel ticketId={ticketId} ticketNumber={ticket.ticketNumber} />

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Ticket Properties</h3>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Status</label>
                  <Select value={ticket.status} onValueChange={(v) => handleUpdateField("status", v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="assigned">Assigned</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="waiting">Waiting</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Priority</label>
                  <Select value={ticket.priority} onValueChange={(v) => handleUpdateField("priority", v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Department</label>
                  <Select
                    value={ticket.departmentId ? String(ticket.departmentId) : "none"}
                    onValueChange={(v) => handleUpdateField("departmentId", v === "none" ? null : parseInt(v))}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {(departments ?? []).map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Assignee</label>
                  <Select
                    value={ticket.assigneeId ? String(ticket.assigneeId) : "none"}
                    onValueChange={(v) => handleUpdateField("assigneeId", v === "none" ? null : parseInt(v))}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {(users ?? []).map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created by</span>
                  <span className="font-medium text-foreground">{ticket.createdByName}</span>
                </div>
                {(ticket as any).raisedForName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Raised for</span>
                    <div className="text-right">
                      <span className="font-medium text-foreground block">{(ticket as any).raisedForName}</span>
                      {(ticket as any).raisedForEmail && (
                        <span className="text-xs text-muted-foreground">{(ticket as any).raisedForEmail}</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-foreground">{formatDateTime(ticket.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="text-foreground">{formatDateTime(ticket.updatedAt)}</span>
                </div>
                {ticket.slaDeadline && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SLA Deadline</span>
                    <span className={ticket.slaBreached ? "text-red-600 font-medium" : "text-foreground"}>
                      {formatDateTime(ticket.slaDeadline)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Quick Actions</h3>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 text-green-700 hover:bg-green-50"
                  onClick={() => handleUpdateField("status", "resolved")}
                  disabled={ticket.status === "resolved" || ticket.status === "closed"}
                >
                  <CheckCircle2 className="h-4 w-4" /> Mark Resolved
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 text-red-700 hover:bg-red-50"
                  onClick={() => handleUpdateField("priority", "urgent")}
                  disabled={ticket.priority === "urgent"}
                >
                  <AlertCircle className="h-4 w-4" /> Escalate to Urgent
                </Button>
                {canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 mt-3"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="h-4 w-4" /> Delete Ticket
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{ticket?.ticketNumber}</strong>? This will remove all comments and history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingTicket}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteTicket}
              disabled={deletingTicket}
            >
              {deletingTicket ? "Deleting…" : "Delete Ticket"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
