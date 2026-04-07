import { Router } from "express";
import { db, ticketsTable, departmentsTable, usersTable, eq, sql } from "@workspace/db";

const router = Router();

function generateTicketNumber(): string {
  const prefix = "TKT";
  const num = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}-${num}`;
}

// Universal email parser — handles Mailgun, SendGrid, Postmark, and generic formats
function parseEmailPayload(body: Record<string, unknown>): { from: string; to: string; subject: string; text: string } | null {
  try {
    // SendGrid array format
    if (Array.isArray(body)) {
      const item = body[0] as Record<string, unknown>;
      return {
        from: String(item.from ?? item.sender ?? ""),
        to: String(item.to ?? item.recipient ?? ""),
        subject: String(item.subject ?? "(No Subject)"),
        text: String(item.text ?? item.body ?? item["body-plain"] ?? ""),
      };
    }

    // Postmark — capital field names
    if (body.From || body.To) {
      return {
        from: String(body.From ?? body.from ?? ""),
        to: String(body.To ?? body.to ?? body.recipient ?? ""),
        subject: String(body.Subject ?? body.subject ?? "(No Subject)"),
        text: String(body.TextBody ?? body.text ?? body["body-plain"] ?? body.body ?? ""),
      };
    }

    // Mailgun / generic
    return {
      from: String(body.from ?? body.sender ?? ""),
      to: String(body.to ?? body.recipient ?? ""),
      subject: String(body.subject ?? "(No Subject)"),
      text: String(body["stripped-text"] ?? body["body-plain"] ?? body.text ?? body.body ?? body.message ?? ""),
    };
  } catch {
    return null;
  }
}

function getEmailLocal(address: string): string {
  return address.split("@")[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, "") ?? "";
}

// Map inbound email address to ticket type + department
const EMAIL_ROUTES: { pattern: RegExp; subject: string; department: string; priority: "low" | "medium" | "high" | "urgent"; tags: string[] }[] = [
  {
    pattern: /^employment\.?verification/i,
    subject: "Employment Verification Request",
    department: "bgv",
    priority: "high",
    tags: ["employment-verification", "email-generated"],
  },
  {
    pattern: /^bgv/i,
    subject: "Background Verification Request",
    department: "bgv",
    priority: "high",
    tags: ["background-verification", "email-generated"],
  },
];

// POST /api/webhooks/email — inbound email → ticket
router.post("/webhooks/email", async (req, res) => {
  try {
    const parsed = parseEmailPayload(req.body);
    if (!parsed || !parsed.to) {
      res.status(400).json({ error: "Bad Request", message: "Could not parse email payload" });
      return;
    }

    const toLocal = getEmailLocal(parsed.to);
    const route = EMAIL_ROUTES.find((r) => r.pattern.test(toLocal));

    if (!route) {
      // No matching route — still acknowledge but don't create ticket
      res.json({ received: true, action: "ignored", reason: `No route for recipient: ${parsed.to}` });
      return;
    }

    // Find matching department (BGV, HR, etc.)
    const allDepts = await db.select().from(departmentsTable);
    const dept = allDepts.find((d) =>
      d.name.toLowerCase().includes(route.department) ||
      route.department.includes(d.name.toLowerCase().slice(0, 3))
    ) ?? allDepts.find((d) => d.name.toLowerCase().includes("hr")) ?? null;

    // Find a system user (admin/super_admin) to attach ticket to
    const [systemUser] = await db.select().from(usersTable)
      .where(sql`${usersTable.role} IN ('super_admin', 'admin')`)
      .limit(1);

    if (!systemUser) {
      res.status(500).json({ error: "No system user found to create ticket" });
      return;
    }

    const senderDescription = [
      `Ticket auto-generated from inbound email.`,
      ``,
      `From: ${parsed.from}`,
      `To: ${parsed.to}`,
      ``,
      parsed.text ? `Message:\n${parsed.text.slice(0, 2000)}` : "",
    ].filter(Boolean).join("\n");

    const emailSubject = parsed.subject && parsed.subject !== "(No Subject)"
      ? `${route.subject} — ${parsed.subject}`
      : route.subject;

    const [ticket] = await db.insert(ticketsTable).values({
      ticketNumber: generateTicketNumber(),
      subject: emailSubject.slice(0, 255),
      description: senderDescription,
      status: "open",
      priority: route.priority,
      departmentId: dept?.id ?? null,
      assigneeId: null,
      createdById: systemUser.id,
      tags: route.tags,
    }).returning();

    console.error(`[email-webhook] Created ticket ${ticket.ticketNumber} for ${parsed.to} from ${parsed.from}`);
    res.status(201).json({ received: true, action: "ticket_created", ticketNumber: ticket.ticketNumber, ticketId: ticket.id });
  } catch (err) {
    console.error("Email webhook error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/webhooks/email/simulate — admin-only test endpoint
router.post("/webhooks/email/simulate", async (req, res) => {
  const { to, from, subject, text } = req.body;
  if (!to) { res.status(400).json({ error: "to is required" }); return; }

  // Reuse the email endpoint logic by calling it internally
  req.body = { from: from ?? "test@example.com", to, subject: subject ?? "Test", text: text ?? "" };
  // Find and forward to the actual handler by reconstructing the call
  const parsed = parseEmailPayload(req.body);
  if (!parsed) { res.status(400).json({ error: "Parse failed" }); return; }

  const toLocal = getEmailLocal(parsed.to);
  const route = EMAIL_ROUTES.find((r) => r.pattern.test(toLocal));

  if (!route) {
    res.json({ received: true, action: "ignored", reason: `No route matches "${to}"` });
    return;
  }

  try {
    const allDepts = await db.select().from(departmentsTable);
    const dept = allDepts.find((d) =>
      d.name.toLowerCase().includes(route.department) ||
      route.department.includes(d.name.toLowerCase().slice(0, 3))
    ) ?? allDepts.find((d) => d.name.toLowerCase().includes("hr")) ?? null;

    const [systemUser] = await db.select().from(usersTable)
      .where(sql`${usersTable.role} IN ('super_admin', 'admin')`)
      .limit(1);

    if (!systemUser) { res.status(500).json({ error: "No system user found" }); return; }

    const [ticket] = await db.insert(ticketsTable).values({
      ticketNumber: generateTicketNumber(),
      subject: `${route.subject} — ${parsed.subject}`.slice(0, 255),
      description: `Simulated inbound email.\n\nFrom: ${parsed.from}\nTo: ${parsed.to}\n\n${parsed.text ?? ""}`,
      status: "open",
      priority: route.priority,
      departmentId: dept?.id ?? null,
      assigneeId: null,
      createdById: systemUser.id,
      tags: [...route.tags, "simulated"],
    }).returning();

    res.status(201).json({ received: true, action: "ticket_created", ticketNumber: ticket.ticketNumber, ticketId: ticket.id, department: dept?.name ?? null });
  } catch (err) {
    console.error("Email simulate error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
