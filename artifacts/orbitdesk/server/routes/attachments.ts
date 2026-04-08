import { Router } from "express";
import { db, ticketAttachmentsTable, ticketsTable, usersTable, eq, and, inArray } from "@workspace/db";
import { authMiddleware, AuthenticatedRequest } from "../middlewares/auth.js";
import { sendEmail } from "../lib/emailService.js";

const router = Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/zip": "zip",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// GET /api/tickets/:id/attachments
router.get("/tickets/:id/attachments", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const ticketId = parseInt(req.params.id as string, 10);
    const rows = await db
      .select({
        id: ticketAttachmentsTable.id,
        ticketId: ticketAttachmentsTable.ticketId,
        fileName: ticketAttachmentsTable.fileName,
        fileType: ticketAttachmentsTable.fileType,
        fileSize: ticketAttachmentsTable.fileSize,
        uploadedById: ticketAttachmentsTable.uploadedById,
        createdAt: ticketAttachmentsTable.createdAt,
      })
      .from(ticketAttachmentsTable)
      .where(eq(ticketAttachmentsTable.ticketId, ticketId));

    const uploaderIds = [...new Set(rows.map(r => r.uploadedById))];
    const uploaders = uploaderIds.length > 0
      ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, uploaderIds))
      : [];
    const uploaderMap = new Map(uploaders.map(u => [u.id, u.name]));

    res.json(rows.map(r => ({
      ...r,
      uploadedByName: uploaderMap.get(r.uploadedById) ?? "Unknown",
      fileSizeFormatted: formatBytes(r.fileSize),
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    console.error("List attachments error", err);
    res.status(500).json({ error: "Failed to load attachments" });
  }
});

// POST /api/tickets/:id/attachments
router.post("/tickets/:id/attachments", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const ticketId = parseInt(req.params.id as string, 10);
    const { fileName, fileType, fileData } = req.body;

    if (!fileName || !fileType || !fileData) {
      res.status(400).json({ error: "fileName, fileType and fileData are required" });
      return;
    }

    if (!ALLOWED_TYPES[fileType]) {
      res.status(400).json({ error: "File type not allowed" });
      return;
    }

    const base64Data = fileData.replace(/^data:[^;]+;base64,/, "");
    const fileSize = Math.ceil((base64Data.length * 3) / 4);

    if (fileSize > MAX_FILE_SIZE) {
      res.status(400).json({ error: `File too large. Maximum size is ${formatBytes(MAX_FILE_SIZE)}` });
      return;
    }

    const [attachment] = await db.insert(ticketAttachmentsTable).values({
      ticketId,
      fileName: fileName.trim(),
      fileType,
      fileSize,
      fileData,
      uploadedById: req.user!.id,
    }).returning();

    res.status(201).json({
      id: attachment.id,
      ticketId: attachment.ticketId,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      fileSize: attachment.fileSize,
      fileSizeFormatted: formatBytes(attachment.fileSize),
      uploadedById: attachment.uploadedById,
      uploadedByName: req.user!.name,
      createdAt: attachment.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("Upload attachment error", err);
    res.status(500).json({ error: "Failed to upload attachment" });
  }
});

// GET /api/attachments/:id/download
router.get("/attachments/:id/download", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const [row] = await db.select().from(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    const base64Data = row.fileData.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    res.setHeader("Content-Type", row.fileType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error("Download attachment error", err);
    res.status(500).json({ error: "Failed to download attachment" });
  }
});

// DELETE /api/attachments/:id
router.delete("/attachments/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const [row] = await db.select({ uploadedById: ticketAttachmentsTable.uploadedById })
      .from(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    const role = req.user!.role as string;
    const canDelete = role === "super_admin" || role === "admin" || row.uploadedById === req.user!.id;
    if (!canDelete) {
      res.status(403).json({ error: "Not authorized to delete this attachment" });
      return;
    }

    await db.delete(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete attachment error", err);
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

// POST /api/tickets/:id/send-attachments — email attachments to a recipient
router.post("/tickets/:id/send-attachments", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const ticketId = parseInt(req.params.id as string, 10);
    const { recipientEmail, recipientName, message, attachmentIds } = req.body;

    if (!recipientEmail) {
      res.status(400).json({ error: "recipientEmail is required" });
      return;
    }

    const [ticket] = await db.select({ ticketNumber: ticketsTable.ticketNumber, subject: ticketsTable.subject })
      .from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    let attachmentQuery = db.select().from(ticketAttachmentsTable).where(eq(ticketAttachmentsTable.ticketId, ticketId));
    const rows = await (Array.isArray(attachmentIds) && attachmentIds.length > 0
      ? db.select().from(ticketAttachmentsTable).where(
          and(eq(ticketAttachmentsTable.ticketId, ticketId), inArray(ticketAttachmentsTable.id, attachmentIds))
        )
      : attachmentQuery);

    if (rows.length === 0) {
      res.status(400).json({ error: "No attachments found to send" });
      return;
    }

    const senderName = req.user!.name;
    const customMessage = message?.trim() || "Please find the attached document(s) related to your ticket.";

    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:32px 16px;}
  .container{max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
  .header{background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:24px 32px;}
  .header h1{color:#fff;font-size:18px;margin:0;font-weight:700;}
  .header p{color:rgba(255,255,255,0.8);font-size:13px;margin:6px 0 0;}
  .body{padding:24px 32px;}
  .msg{color:#334155;font-size:14px;line-height:1.6;background:#f1f5f9;border-radius:8px;padding:14px;}
  .files{margin-top:16px;}
  .file{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;font-size:13px;}
  .file-icon{width:32px;height:32px;background:#eff6ff;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#2563eb;}
  .footer{background:#f8fafc;padding:14px 32px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;}
</style></head><body>
<div class="container">
  <div class="header">
    <h1>Document(s) from OrbitDesk</h1>
    <p>Ticket: ${ticket.ticketNumber} — ${ticket.subject}</p>
  </div>
  <div class="body">
    <p style="color:#334155;font-size:15px;">Hi${recipientName ? ` <strong>${recipientName}</strong>` : ""},</p>
    <p style="color:#64748b;font-size:14px;">
      <strong>${senderName}</strong> has shared the following document(s) with you via OrbitDesk:
    </p>
    <div class="msg">${customMessage.replace(/\n/g, "<br>")}</div>
    <div class="files">
      ${rows.map(r => `
        <div class="file">
          <div class="file-icon">${r.fileName.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE"}</div>
          <div>
            <div style="font-weight:600;color:#1e293b;">${r.fileName}</div>
            <div style="font-size:11px;color:#94a3b8;">${formatBytes(r.fileSize)}</div>
          </div>
        </div>`).join("")}
    </div>
    <p style="color:#64748b;font-size:12px;margin-top:16px;">
      This document was sent from OrbitDesk in reference to ticket <strong>${ticket.ticketNumber}</strong>.
    </p>
  </div>
  <div class="footer">Powered by <strong>Dejoiy OrbitDesk</strong> &bull; This is an automated message.<br>&copy; ${new Date().getFullYear()} Dejoiy. All rights reserved.</div>
</div></body></html>`;

    const emailAttachments = rows.map(r => ({
      filename: r.fileName,
      content: r.fileData,
      encoding: "base64" as const,
      contentType: r.fileType,
    }));

    await sendEmail(recipientEmail, `[OrbitDesk] Documents — ${ticket.ticketNumber}`, html, emailAttachments);

    res.json({ success: true, sent: rows.length, to: recipientEmail });
  } catch (err) {
    console.error("Send attachments error", err);
    res.status(500).json({ error: "Failed to send attachments" });
  }
});

export default router;
