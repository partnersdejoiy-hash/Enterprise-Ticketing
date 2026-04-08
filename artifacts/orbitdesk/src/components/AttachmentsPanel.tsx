import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  Paperclip, Upload, Download, Trash2, Send, FileText,
  Image, File, FileSpreadsheet, Loader2, X, CheckSquare
} from "lucide-react";

interface Attachment {
  id: number;
  ticketId: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileSizeFormatted: string;
  uploadedById: number;
  uploadedByName: string;
  createdAt: string;
}

interface AttachmentsPanelProps {
  ticketId: number;
  ticketNumber?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/zip",
];

function getFileIcon(fileType: string) {
  if (fileType.startsWith("image/")) return <Image className="h-4 w-4 text-blue-500" />;
  if (fileType === "application/pdf") return <FileText className="h-4 w-4 text-red-500" />;
  if (fileType.includes("spreadsheet") || fileType.includes("excel") || fileType === "text/csv")
    return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
  return <File className="h-4 w-4 text-slate-500" />;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export function AttachmentsPanel({ ticketId, ticketNumber }: AttachmentsPanelProps) {
  const { toast } = useToast();
  const { user } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendName, setSendName] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sending, setSending] = useState(false);

  const token = () => localStorage.getItem("auth_token");
  const headers = () => ({ Authorization: `Bearer ${token()}`, "Content-Type": "application/json" });

  const fetchAttachments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/attachments`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (res.ok) setAttachments(await res.json());
    } catch (e) {
      toast({ title: "Error", description: "Failed to load attachments", variant: "destructive" });
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  // Lazy-load on first expand
  const [expanded, setExpanded] = useState(false);
  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) fetchAttachments();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    for (const file of files) {
      if (!ALLOWED_MIME.includes(file.type)) {
        toast({ title: "Unsupported file type", description: `${file.name} is not supported.`, variant: "destructive" });
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast({ title: "File too large", description: `${file.name} exceeds the 10 MB limit.`, variant: "destructive" });
        continue;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        setUploading(true);
        try {
          const res = await fetch(`/api/tickets/${ticketId}/attachments`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
              fileName: file.name,
              fileType: file.type,
              fileData: reader.result as string,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error ?? "Upload failed");
          }
          const newAttachment = await res.json();
          setAttachments(prev => [...prev, newAttachment]);
          toast({ title: "Uploaded", description: `${file.name} uploaded successfully` });
        } catch (err: any) {
          toast({ title: "Upload failed", description: err.message, variant: "destructive" });
        } finally {
          setUploading(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDownload = async (att: Attachment) => {
    const res = await fetch(`/api/attachments/${att.id}/download`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = att.fileName; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/attachments/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error("Delete failed");
      setAttachments(prev => prev.filter(a => a.id !== id));
      setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      toast({ title: "Deleted", description: "Attachment removed" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const handleSend = async () => {
    if (!sendEmail.trim()) {
      toast({ title: "Email required", description: "Please enter a recipient email", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const idsToSend = selectedIds.size > 0 ? Array.from(selectedIds) : attachments.map(a => a.id);
      const res = await fetch(`/api/tickets/${ticketId}/send-attachments`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          recipientEmail: sendEmail.trim(),
          recipientName: sendName.trim() || undefined,
          message: sendMessage.trim() || undefined,
          attachmentIds: idsToSend,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      toast({ title: "Sent!", description: `${data.sent} file(s) emailed to ${data.to}` });
      setSendDialogOpen(false);
      setSendEmail(""); setSendName(""); setSendMessage("");
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const canDelete = (att: Attachment) =>
    user?.role === "super_admin" || user?.role === "admin" || att.uploadedById === user?.id;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Paperclip className="h-4 w-4 text-primary" />
          Attachments
          {loaded && (
            <span className="text-xs font-normal bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
              {attachments.length}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{expanded ? "▲ hide" : "▼ show"}</span>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-3">
          {/* Upload area */}
          <div
            className="border-2 border-dashed border-border rounded-lg p-4 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept={ALLOWED_MIME.join(",")}
              onChange={handleFileSelect}
            />
            {uploading ? (
              <div className="flex flex-col items-center gap-1">
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
                <span className="text-sm text-muted-foreground">Uploading…</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Click to upload files</span>
                <span className="text-xs text-muted-foreground">PDF, Word, Excel, images, ZIP — max 10 MB each</span>
              </div>
            )}
          </div>

          {/* File list */}
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">No attachments yet</p>
          ) : (
            <>
              {/* Select all / Send */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <button
                  className="hover:text-foreground flex items-center gap-1"
                  onClick={() =>
                    setSelectedIds(
                      selectedIds.size === attachments.length
                        ? new Set()
                        : new Set(attachments.map(a => a.id))
                    )
                  }
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  {selectedIds.size === attachments.length ? "Deselect all" : "Select all"}
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setSendDialogOpen(true)}
                >
                  <Send className="h-3 w-3" />
                  Send{selectedIds.size > 0 ? ` (${selectedIds.size})` : " all"} to Employee
                </Button>
              </div>

              <div className="space-y-2">
                {attachments.map(att => (
                  <div
                    key={att.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      selectedIds.has(att.id) ? "border-primary bg-primary/5" : "border-border bg-muted/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(att.id)}
                      onChange={() => toggleSelect(att.id)}
                      className="shrink-0 cursor-pointer"
                    />
                    <div className="shrink-0">{getFileIcon(att.fileType)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{att.fileName}</div>
                      <div className="text-xs text-muted-foreground">
                        {att.fileSizeFormatted} · {att.uploadedByName} · {formatDate(att.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={() => handleDownload(att)}
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      {canDelete(att) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(att.id)}
                          disabled={deletingId === att.id}
                          title="Delete"
                        >
                          {deletingId === att.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Send to Employee Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              Send Attachments to Employee
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                Recipient Email <span className="text-destructive">*</span>
              </label>
              <Input
                type="email"
                placeholder="employee@company.com"
                value={sendEmail}
                onChange={e => setSendEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                Recipient Name
              </label>
              <Input
                placeholder="Full name (optional)"
                value={sendName}
                onChange={e => setSendName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                Message
              </label>
              <Textarea
                placeholder="Add a personal message (optional)…"
                value={sendMessage}
                onChange={e => setSendMessage(e.target.value)}
                className="min-h-[80px] resize-none"
              />
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                {selectedIds.size > 0 ? `Sending ${selectedIds.size} selected file(s):` : `Sending all ${attachments.length} file(s):`}
              </div>
              <div className="space-y-1">
                {(selectedIds.size > 0
                  ? attachments.filter(a => selectedIds.has(a.id))
                  : attachments
                ).map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-xs text-foreground">
                    {getFileIcon(a.fileType)}
                    <span className="truncate">{a.fileName}</span>
                    <span className="text-muted-foreground shrink-0">({a.fileSizeFormatted})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sending || !sendEmail.trim()} className="gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Sending…" : "Send Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
