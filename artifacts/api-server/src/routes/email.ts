import { Router } from "express";
import { db, ticketsTable, departmentsTable, usersTable, eq, sql } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router = Router();

function generateTicketNumber(): string {
  const prefix = "TKT";
  const num = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}-${num}`;
}

function parseEmailPayload(body: Record<string, unknown>): { from: string; to: string; subject: string; text: string } | null {
  try {
    if (Array.isArray(body)) {
      const item = body[0] as Record<string, unknown>;
      return {
        from: String(item.from ?? item.sender ?? ""),
        to: String(item.to ?? item.recipient ?? ""),
        subject: String(item.subject ?? "(No Subject)"),
        text: String(item.text ?? item.body ?? item["body-plain"] ?? ""),
      };
    }
    if (body.From || body.To) {
      return {
        from: String(body.From ?? body.from ?? ""),
        to: String(body.To ?? body.to ?? body.recipient ?? ""),
        subject: String(body.Subject ?? body.subject ?? "(No Subject)"),
        text: String(body.TextBody ?? body.text ?? body["body-plain"] ?? body.body ?? ""),
      };
    }
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
      res.json({ received: true, action: "ignored", reason: `No route for recipient: ${parsed.to}` });
      return;
    }

    const allDepts = await db.select().from(departmentsTable);
    const dept = allDepts.find((d) =>
      d.name.toLowerCase().includes(route.department) ||
      route.department.includes(d.name.toLowerCase().slice(0, 3))
    ) ?? allDepts.find((d) => d.name.toLowerCase().includes("hr")) ?? null;

    const [systemUser] = await db.select().from(usersTable)
      .where(sql`${usersTable.role} IN ('super_admin', 'admin')`)
      .limit(1);

    if (!systemUser) {
      res.status(500).json({ error: "No system user found" });
      return;
    }

    const emailSubject = parsed.subject && parsed.subject !== "(No Subject)"
      ? `${route.subject} — ${parsed.subject}`
      : route.subject;

    const [ticket] = await db.insert(ticketsTable).values({
      ticketNumber: generateTicketNumber(),
      subject: emailSubject.slice(0, 255),
      description: `Ticket auto-generated from inbound email.\n\nFrom: ${parsed.from}\nTo: ${parsed.to}\n\n${parsed.text?.slice(0, 2000) ?? ""}`,
      status: "open",
      priority: route.priority,
      departmentId: dept?.id ?? null,
      assigneeId: null,
      createdById: systemUser.id,
      tags: route.tags,
    }).returning();

    logger.info({ ticketNumber: ticket.ticketNumber, from: parsed.from, to: parsed.to }, "Email webhook: ticket created");
    res.status(201).json({ received: true, action: "ticket_created", ticketNumber: ticket.ticketNumber, ticketId: ticket.id });
  } catch (err) {
    logger.error({ err }, "Email webhook error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/webhooks/email/simulate", async (req, res) => {
  const { to, from, subject, text } = req.body;
  if (!to) { res.status(400).json({ error: "to is required" }); return; }

  const parsed = { from: from ?? "test@example.com", to, subject: subject ?? "Test Email", text: text ?? "" };
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
      description: `Simulated inbound email.\n\nFrom: ${parsed.from}\nTo: ${parsed.to}\n\n${parsed.text}`,
      status: "open",
      priority: route.priority,
      departmentId: dept?.id ?? null,
      assigneeId: null,
      createdById: systemUser.id,
      tags: [...route.tags, "simulated"],
    }).returning();

    res.status(201).json({ received: true, action: "ticket_created", ticketNumber: ticket.ticketNumber, ticketId: ticket.id, department: dept?.name ?? null });
  } catch (err) {
    logger.error({ err }, "Email simulate error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
