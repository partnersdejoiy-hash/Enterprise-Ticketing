import { Router } from "express";
import { db, ticketsTable, departmentsTable, usersTable, ticketHistoryTable, eq, asc } from "@workspace/db";
import { sendEmail } from "../lib/emailService";
import { autoAssignForDepartment } from "../lib/autoAssign";

const router = Router();

router.get("/public/departments", async (_req, res) => {
  try {
    const depts = await db
      .select({ id: departmentsTable.id, name: departmentsTable.name })
      .from(departmentsTable)
      .orderBy(asc(departmentsTable.name));
    res.json(depts);
  } catch (err) {
    console.error("Public departments error", err);
    res.status(500).json({ error: "Could not load departments" });
  }
});

router.post("/public/request", async (req, res) => {
  try {
    const { name, email, phone, organization, departmentId, subject, message } = req.body;

    if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
      res.status(400).json({ error: "Bad Request", message: "name, email, subject and message are required" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: "Bad Request", message: "Invalid email address" });
      return;
    }

    let resolvedDeptId: number | null = null;
    let deptName = "General";
    let slaDeadline: Date | null = null;

    if (departmentId && !isNaN(Number(departmentId))) {
      const [dept] = await db
        .select()
        .from(departmentsTable)
        .where(eq(departmentsTable.id, Number(departmentId)))
        .limit(1);
      if (dept) {
        resolvedDeptId = dept.id;
        deptName = dept.name;
        slaDeadline = new Date(Date.now() + dept.slaResolutionHours * 3600 * 1000);
      }
    } else {
      const allDepts = await db.select().from(departmentsTable).orderBy(asc(departmentsTable.name));
      const generalDept = allDepts.find(d => /general|support|help/i.test(d.name)) ?? allDepts[0];
      if (generalDept) {
        resolvedDeptId = generalDept.id;
        deptName = generalDept.name;
        slaDeadline = new Date(Date.now() + generalDept.slaResolutionHours * 3600 * 1000);
      }
    }

    const [systemUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, "admin@dejoiy.com"))
      .limit(1);
    const createdById = systemUser?.id ?? 1;

    const ticketNumber = `DJ-${Math.floor(Math.random() * 900000) + 100000}`;

    const description = [
      `Submitted by: ${name}${organization ? ` (${organization})` : ""}`,
      `Contact Email: ${email}`,
      phone ? `Phone: ${phone}` : "",
      `Department: ${deptName}`,
      "",
      message,
    ].filter(v => v !== undefined && v !== null && v !== "").join("\n");

    // Auto-assign to the department member with the fewest open tickets
    let autoAssigneeId: number | null = null;
    if (resolvedDeptId) {
      autoAssigneeId = await autoAssignForDepartment(resolvedDeptId);
    }

    const [ticket] = await db.insert(ticketsTable).values({
      ticketNumber,
      subject: subject.trim(),
      description,
      priority: "medium" as const,
      status: autoAssigneeId ? "assigned" : "open",
      departmentId: resolvedDeptId,
      assigneeId: autoAssigneeId,
      createdById,
      raisedForName: name.trim(),
      raisedForEmail: email.trim().toLowerCase(),
      tags: ["web-request"],
      slaDeadline,
    } as any).returning();

    if (ticket) {
      await db.insert(ticketHistoryTable).values({
        ticketId: ticket.id,
        action: "created",
        newValue: "open",
        changedById: createdById,
      });
    }

    const confirmHtml = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; padding: 32px 16px; }
  .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 28px 32px; text-align: center; }
  .header h1 { color: #fff; font-size: 20px; margin: 0; font-weight: 700; }
  .header p { color: rgba(255,255,255,0.8); font-size: 13px; margin: 6px 0 0; }
  .body { padding: 28px 32px; }
  .ticket-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px 20px; text-align: center; margin: 20px 0; }
  .ticket-box .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #3b82f6; font-weight: 600; }
  .ticket-box .number { font-size: 28px; font-weight: 900; color: #1d4ed8; letter-spacing: 0.05em; margin-top: 4px; }
  .detail { display: flex; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
  .detail .key { color: #94a3b8; min-width: 120px; font-weight: 500; }
  .detail .val { color: #1e293b; font-weight: 500; }
  .footer { background: #f8fafc; padding: 16px 32px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Request Received ✓</h1>
    <p>OrbitDesk by Dejoiy</p>
  </div>
  <div class="body">
    <p style="color:#334155;font-size:15px;">Hi <strong>${name}</strong>,</p>
    <p style="color:#64748b;font-size:14px;line-height:1.6;">
      We've received your request and created a ticket. Our team will review it and get back to you shortly.
    </p>
    <div class="ticket-box">
      <div class="label">Your Ticket Number</div>
      <div class="number">${ticketNumber}</div>
    </div>
    <div class="detail"><span class="key">Subject</span><span class="val">${subject}</span></div>
    <div class="detail"><span class="key">Department</span><span class="val">${deptName}</span></div>
    <div class="detail"><span class="key">Status</span><span class="val">Open — Pending Review</span></div>
    <p style="color:#64748b;font-size:13px;margin-top:20px;">
      Please keep this email for reference. Our team will contact you at <strong>${email}</strong> with updates.
    </p>
  </div>
  <div class="footer">
    Powered by <strong>Dejoiy OrbitDesk</strong> &bull; This is an automated message, please do not reply.<br>
    &copy; ${new Date().getFullYear()} Dejoiy. All rights reserved.
  </div>
</div>
</body>
</html>`;

    await sendEmail(email.trim(), `[OrbitDesk] Request Received — ${ticketNumber}`, confirmHtml);

    res.status(201).json({
      success: true,
      ticketNumber,
      message: "Your request has been submitted. A confirmation email has been sent.",
    });
  } catch (err) {
    console.error("Public request error", err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to submit request. Please try again." });
  }
});

export default router;
