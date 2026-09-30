import { notifyTicket } from "../lib/ticket-notifications.js";
import { getRoutingSettings } from "../lib/workspace-settings.js";
import { runAutomations } from "../lib/automation.js";
import { Router } from "express";
import { createHmac, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { constantEqual, digest, rateLimit } from "../lib/security.js";
import { authMiddleware, requireAdmin } from "../middlewares/auth.js";
import {
  businessSiteOidcEnabled,
  verifyBusinessSiteIdentity,
} from "../lib/business-site-identity.js";

const router = Router();
const types = ["employment-verification", "background-verification"];
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function validateIntake(body: any) {
  if (
    !body ||
    !UUID.test(body.requestId || "") ||
    !types.includes(body.verificationType) ||
    body.consent !== true
  )
    return false;
  for (const [key, max, min] of [
    ["company", 150, 1],
    ["email", 254, 3],
    ["employeeName", 150, 1],
    ["purpose", 4000, 10],
    ["employeeId", 150, 0],
  ] as const) {
    if (
      typeof body[key] !== "string" ||
      body[key].trim().length < min ||
      body[key].length > max ||
      (key !== "purpose" && /[\r\n]/.test(body[key]))
    )
      return false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return false;
  const a = body.attachment;
  if (
    !a ||
    a.type !== "application/pdf" ||
    typeof a.content !== "string" ||
    a.content.length > 2796204 ||
    a.content.length % 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(a.content)
  )
    return false;
  const bytes = Buffer.from(a.content, "base64");
  return (
    bytes.length <= 2097152 &&
    bytes.subarray(0, 5).toString() === "%PDF-" &&
    bytes.subarray(-1024).toString().includes("%%EOF")
  );
}
router.get(
  "/integrations/business-site",
  authMiddleware,
  requireAdmin,
  async (_req, res) => {
    const rows = await pool.query(
      "SELECT request_type,count(*)::int as received,max(created_at) as last_received FROM orbit_intake_receipts GROUP BY request_type",
    );
    res.json({
      configured:
        businessSiteOidcEnabled() ||
        (process.env.BUSINESS_SITE_INTAKE_SECRET?.length ?? 0) >= 32,
      source: "business.dejoiy.com",
      routes: [
        {
          type: types[0],
          tag: "employment-verification",
          inbox: "employment-verification@dejoiy.com",
        },
        { type: types[1], tag: "bgv-request", inbox: "bgv@dejoiy.com" },
      ],
      receipts: rows.rows,
    });
  },
);
router.post("/integrations/business-site/verification", async (req, res) => {
  const secret = process.env.BUSINESS_SITE_INTAKE_SECRET;
  const oidcEnabled = businessSiteOidcEnabled();
  if ((!secret || secret.length < 32) && !oidcEnabled) {
    res.status(503).json({ error: "Intake is not configured" });
    return;
  }
  const timestamp = req.get("X-DEJOIY-Timestamp") || "";
  const signature = req.get("X-DEJOIY-Signature") || "";
  const raw = (req as any).rawBody as Buffer | undefined;
  const authorization = req.get("Authorization") || "";
  let authenticated = false;
  if (authorization) {
    // A failed bearer token never downgrades to another authentication method.
    if (
      oidcEnabled &&
      authorization.startsWith("Bearer ") &&
      authorization.length <= 16384
    ) {
      try {
        await verifyBusinessSiteIdentity(authorization.slice(7));
        authenticated = true;
      } catch (error: any) {
        // Diagnostic codes only: no token, claim values or private request body.
        console.warn("Business intake identity rejected", {
          code:
            typeof error?.code === "string"
              ? error.code
              : "IDENTITY_UNAVAILABLE",
          claim: typeof error?.claim === "string" ? error.claim : undefined,
        });
      }
    }
  } else if (
    secret &&
    secret.length >= 32 &&
    !(
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 300000 ||
      !raw ||
      !constantEqual(
        signature,
        createHmac("sha256", secret)
          .update(timestamp + ".")
          .update(raw)
          .digest("hex"),
      )
    )
  )
    authenticated = true;
  if (!authenticated) {
    res.status(401).json({ error: "Invalid service authentication" });
    return;
  }
  if (!(await rateLimit("business-intake", 120, 3600))) {
    res.status(429).json({ error: "Intake rate limit reached" });
    return;
  }
  const b = req.body;
  if (!validateIntake(b)) {
    res
      .status(400)
      .json({ error: "Invalid verification request or authorisation PDF" });
    return;
  }
  const hash = digest(
    JSON.stringify({
      type: b.verificationType,
      company: b.company,
      email: b.email,
      employeeName: b.employeeName,
      employeeId: b.employeeId,
      purpose: b.purpose,
      consent: true,
      pdf: digest(b.attachment.content),
    }),
  );
  const routing = await getRoutingSettings();
  const client = await pool.connect();
  let released = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      b.requestId,
    ]);
    const existing = await client.query(
      "SELECT * FROM orbit_intake_receipts WHERE request_id=$1",
      [b.requestId],
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      if (existing.rows[0].payload_hash !== hash) {
        res.status(409).json({
          error: "Request reference already used with different details",
        });
        return;
      }
      if (existing.rows[0].ticket_id === null) {
        res
          .status(410)
          .json({
            error:
              "This request was deleted by an administrator. Submit a new request if needed.",
            code: "REQUEST_DELETED",
          });
        return;
      }
      res.json({
        success: true,
        ticketNumber: existing.rows[0].ticket_number,
        duplicate: true,
      });
      return;
    }
    const bgv = b.verificationType === "background-verification";
    const configuredId = Number(
      bgv ? routing.bgvDepartmentId : routing.employmentDepartmentId,
    );
    // Routing grants no new permissions. Until an existing department is explicitly configured,
    // only existing administrators can triage these sensitive website tickets.
    const dept =
      Number.isSafeInteger(configuredId) && configuredId > 0
        ? (
            await client.query(
              "SELECT id,sla_resolution_hours FROM departments WHERE id=$1",
              [configuredId],
            )
          ).rows[0]
        : undefined;
    if (configuredId && !dept) throw new Error("Invalid configured department");
    let assigneeId: number | null = null;
    if (dept && routing.autoAssign) {
      await client.query("SELECT pg_advisory_xact_lock(842198,$1)", [dept.id]);
      const owner = await client.query(
        `SELECT u.id FROM users u LEFT JOIN tickets t ON t.assignee_id=u.id AND t.status NOT IN ('resolved','closed')
        WHERE u.department_id=$1 AND u.is_active AND u.role IN ('agent','manager') GROUP BY u.id ORDER BY count(t.id),u.id LIMIT 1`,
        [dept.id],
      );
      assigneeId = owner.rows[0]?.id ?? null;
    }
    const number = `DJ-${bgv ? "BGV" : "EV"}-${randomBytes(8).toString("hex").toUpperCase()}`;
    const description = `Source: business.dejoiy.com\nRequesting company: ${b.company}\nBusiness email: ${b.email}\nEmployee name: ${b.employeeName}\nEmployee ID: ${b.employeeId || "Not provided"}\n\nPurpose and scope:\n${b.purpose}\n\nSubmission permission and privacy notice acknowledged. Authorisation requires staff review.`;
    const ticket = (
      await client.query(
        `INSERT INTO tickets(ticket_number,subject,description,status,priority,department_id,created_by_id,tags,raised_for_name,raised_for_email,sla_deadline)
      VALUES($1,$2,$3,'open','medium',$4,0,$5,$6,$7,$8) RETURNING id`,
        [
          number,
          `${bgv ? "BGV" : "Employment verification"} — ${b.employeeName}`,
          description,
          dept?.id ?? null,
          [
            bgv ? "bgv-request" : "employment-verification",
            "business-website",
            "authorisation-review-required",
          ],
          b.employeeName,
          b.email,
          dept
            ? new Date(Date.now() + dept.sla_resolution_hours * 3600000)
            : null,
        ],
      )
    ).rows[0];
    if (assigneeId) {
      await client.query(
        "UPDATE tickets SET assignee_id=$1,status='assigned' WHERE id=$2",
        [assigneeId, ticket.id],
      );
      await client.query(
        "INSERT INTO ticket_history(ticket_id,action,new_value,changed_by_id) VALUES($1,'department_auto_assigned',$2,0)",
        [ticket.id, String(assigneeId)],
      );
    }
    const bytes = Buffer.from(b.attachment.content, "base64");
    await client.query(
      "INSERT INTO ticket_attachments(ticket_id,file_name,file_type,file_size,file_data,uploaded_by_id) VALUES($1,'authorization-letter.pdf','application/pdf',$2,$3,0)",
      [ticket.id, bytes.length, b.attachment.content],
    );
    await client.query(
      "INSERT INTO ticket_history(ticket_id,action,new_value,changed_by_id) VALUES($1,'website_request_received','Authorisation review required',0)",
      [ticket.id],
    );
    await client.query(
      "INSERT INTO orbit_intake_receipts(request_id,payload_hash,ticket_id,ticket_number,request_type) VALUES($1,$2,$3,$4,$5)",
      [b.requestId, hash, ticket.id, number, b.verificationType],
    );
    await client.query("COMMIT");
    client.release();
    released = true;
    await runAutomations(ticket.id, ["ticket_created"]);
    if (assigneeId) await notifyTicket(ticket.id, "assigned");
    res
      .status(201)
      .json({ success: true, ticketNumber: number, duplicate: false });
  } catch {
    if (!released) await client.query("ROLLBACK");
    res.status(503).json({
      error: "Could not save request. Retry with the same reference.",
    });
  } finally {
    if (!released) client.release();
  }
});
export default router;
