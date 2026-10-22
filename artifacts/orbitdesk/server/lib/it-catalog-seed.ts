/**
 * Starter catalog for DEJOIY IT (it.dejoiy.com). Inserted once, only when the
 * catalog has no IT items yet, so admin edits are never overwritten.
 */
import { pool } from "@workspace/db";

type Field = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  options?: string[];
};
type Seed = {
  name: string;
  kind: "service" | "item";
  group: string;
  icon: string;
  description: string;
  delivery: string;
  approvals: string[]; // approver roles, in order
  fields: Field[];
  tasks: string[];
  featured?: boolean;
};

const DEPARTMENTS = [
  "Operations", "IT", "HR", "Finance", "Background Verification", "Employment Verification",
  "Payroll & Benefits", "Workforce Management", "Quality Assurance", "Training & Development",
  "Administration & Facilities", "Information Security & Compliance",
];
const neededBy: Field = { name: "needed_by", label: "Needed by", type: "date" };
const notes: Field = { name: "notes", label: "Anything else IT should know", type: "textarea" };
const reason = (opts: string[]): Field => ({ name: "reason", label: "Reason", type: "select", required: true, options: opts });
const handover = ["Allocate from stock and record the asset tag", "Image, encrypt and enrol in device management", "Hand over and get the asset form signed"];

const SEEDS: Seed[] = [
  // Get started
  {
    name: "New joiner IT setup", kind: "service", group: "Get started", icon: "user-plus", featured: true,
    description: "Everything a new team member needs on day one: accounts, laptop, headset, DMail, VPN and app access.",
    delivery: "Ready before the start date (raise 3 working days ahead)",
    approvals: ["manager"],
    fields: [
      { name: "joiner_name", label: "Joiner's full name", type: "text", required: true },
      { name: "employee_id", label: "Employee ID", type: "text", required: true },
      { name: "department", label: "Department", type: "select", required: true, options: DEPARTMENTS },
      { name: "role_title", label: "Role / designation", type: "text", required: true },
      { name: "start_date", label: "Start date", type: "date", required: true },
      { name: "location", label: "Location", type: "select", required: true, options: ["Delhi", "Noida", "Remote"] },
      { name: "device", label: "Device", type: "select", required: true, options: ["Standard laptop", "Developer laptop", "Desktop at the site"] },
      { name: "apps", label: "Apps and shared folders they need", type: "textarea" },
    ],
    tasks: [
      "Create directory account and DMail mailbox",
      "Assign laptop and headset, record asset tags",
      "Add to Chronix, OrbitDesk and magistick",
      "Set up VPN and multi-factor sign-in",
      "Add to team groups and shared folders",
      "Day-one welcome call and password change",
    ],
  },
  {
    name: "Leaver IT offboarding", kind: "service", group: "Get started", icon: "user-minus",
    description: "Close accounts on the last day, collect equipment and hand files to the manager.",
    delivery: "On the last working day",
    approvals: ["manager"],
    fields: [
      { name: "leaver_name", label: "Leaver's full name", type: "text", required: true },
      { name: "employee_id", label: "Employee ID", type: "text", required: true },
      { name: "last_day", label: "Last working day", type: "date", required: true },
      { name: "files_to", label: "Hand mailbox and files to", type: "text", required: true },
      notes,
    ],
    tasks: [
      "Disable accounts at the end of the last shift",
      "Collect laptop, headset and ID card",
      "Transfer mailbox and files to the named person",
      "Revoke VPN, multi-factor and app access",
      "Wipe device and return it to stock",
    ],
  },
  // Hardware
  {
    name: "Standard laptop", kind: "item", group: "Hardware", icon: "laptop", featured: true,
    description: "Business laptop for operations and support roles. Encrypted, managed and ready for Chronix, OrbitDesk and DMail.",
    delivery: "3–5 working days", approvals: ["manager"],
    fields: [reason(["New joiner", "Replacement – damaged", "Replacement – old or slow", "Additional device"]), neededBy, notes],
    tasks: handover,
  },
  {
    name: "Developer laptop", kind: "item", group: "Hardware", icon: "laptop",
    description: "High-spec laptop for engineering, analytics and automation work.",
    delivery: "5–8 working days", approvals: ["manager", "admin"],
    fields: [
      { name: "justification", label: "Why a high-spec machine is needed", type: "textarea", required: true },
      { name: "os", label: "Operating system", type: "select", required: true, options: ["Windows 11", "Ubuntu 22.04"] },
      neededBy,
    ],
    tasks: handover,
  },
  {
    name: "USB headset", kind: "item", group: "Hardware", icon: "headphones", featured: true,
    description: "Noise-cancelling headset certified for our dialler and Shine calls.",
    delivery: "1–2 working days", approvals: ["manager"],
    fields: [
      { name: "type", label: "Type", type: "select", required: true, options: ["Wired USB", "Wireless"] },
      reason(["New joiner", "Damaged", "Lost", "Poor audio quality"]),
    ],
    tasks: ["Allocate from stock and record the asset tag", "Test with the dialler and hand over"],
  },
  {
    name: "Monitor", kind: "item", group: "Hardware", icon: "monitor",
    description: "24-inch full-HD monitor with cables.",
    delivery: "2–3 working days", approvals: ["manager"],
    fields: [
      { name: "quantity", label: "How many", type: "select", required: true, options: ["1", "2"] },
      { name: "desk", label: "Desk / seat number", type: "text", required: true },
    ],
    tasks: ["Allocate from stock", "Install at the desk"],
  },
  {
    name: "Keyboard and mouse", kind: "item", group: "Hardware", icon: "keyboard",
    description: "Wired keyboard and mouse set. No approval needed.",
    delivery: "Same day", approvals: [],
    fields: [{ name: "desk", label: "Desk / seat number", type: "text", required: true }],
    tasks: ["Hand over at the desk"],
  },
  {
    name: "Docking station", kind: "item", group: "Hardware", icon: "cable",
    description: "USB-C dock for one-cable desk setup.",
    delivery: "2–3 working days", approvals: ["manager"],
    fields: [{ name: "desk", label: "Desk / seat number", type: "text", required: true }],
    tasks: ["Allocate from stock", "Install and test at the desk"],
  },
  {
    name: "Company mobile phone", kind: "item", group: "Hardware", icon: "smartphone",
    description: "Managed smartphone with optional company SIM, for on-call and field roles.",
    delivery: "5–7 working days", approvals: ["manager", "admin"],
    fields: [
      { name: "justification", label: "Business reason", type: "textarea", required: true },
      { name: "sim", label: "Needs a company SIM", type: "select", required: true, options: ["Yes", "No"] },
    ],
    tasks: ["Allocate device and SIM", "Enrol in device management", "Hand over and get the asset form signed"],
  },
  {
    name: "Hardware repair", kind: "service", group: "Hardware", icon: "wrench",
    description: "Something physically wrong with your laptop, headset or monitor.",
    delivery: "1–3 working days", approvals: [],
    fields: [
      { name: "asset_tag", label: "Asset tag (sticker on the device)", type: "text" },
      { name: "problem", label: "What's wrong", type: "textarea", required: true },
      { name: "spare", label: "Need a loan device meanwhile", type: "select", required: true, options: ["Yes", "No"] },
    ],
    tasks: ["Diagnose", "Repair or replace", "Return to the user"],
  },
  // Software
  {
    name: "Microsoft 365 licence", kind: "item", group: "Software & licences", icon: "package",
    description: "Word, Excel, PowerPoint and Teams. Choose web-only or desktop apps.",
    delivery: "1 working day", approvals: ["manager"],
    fields: [{ name: "plan", label: "Plan", type: "select", required: true, options: ["Business Basic (web apps)", "Business Standard (desktop apps)"] }],
    tasks: ["Assign licence", "Confirm sign-in with the user"],
  },
  {
    name: "Adobe Acrobat Pro", kind: "item", group: "Software & licences", icon: "package",
    description: "Edit, sign and redact PDFs.",
    delivery: "1–2 working days", approvals: ["manager"],
    fields: [{ name: "justification", label: "What you'll use it for", type: "textarea", required: true }],
    tasks: ["Assign licence", "Install and confirm"],
  },
  {
    name: "Other software", kind: "service", group: "Software & licences", icon: "download",
    description: "Any approved software not listed here. IT checks licensing and security first.",
    delivery: "2–5 working days", approvals: ["manager"],
    fields: [
      { name: "software", label: "Software name", type: "text", required: true },
      { name: "link", label: "Vendor link", type: "text" },
      { name: "justification", label: "Business reason", type: "textarea", required: true },
      { name: "asset_tag", label: "Install on (asset tag)", type: "text" },
    ],
    tasks: ["Security and licence review", "Install or deploy", "Confirm with the user"],
  },
  // Access & accounts
  {
    name: "Application access", kind: "service", group: "Access & accounts", icon: "app-window", featured: true,
    description: "Get access to a DEJOIY or client application, or change your access level.",
    delivery: "1 working day after approval", approvals: ["manager"],
    fields: [
      { name: "application", label: "Application", type: "select", required: true, options: ["Chronix", "OrbitDesk", "DMail", "Shine", "magistick admin", "Client CRM / dialler", "Other"] },
      { name: "level", label: "Access level", type: "select", required: true, options: ["View only", "Standard", "Admin"] },
      { name: "justification", label: "Why you need it", type: "textarea", required: true },
    ],
    tasks: ["Check the approval", "Grant access", "Confirm with the requester"],
  },
  {
    name: "Password reset or account unlock", kind: "service", group: "Access & accounts", icon: "key-round", featured: true,
    description: "Locked out? We verify it's you by call-back, then reset.",
    delivery: "Within 1 hour in shift", approvals: [],
    fields: [
      { name: "account", label: "Which account", type: "select", required: true, options: ["Windows / directory", "DMail", "VPN", "Chronix", "OrbitDesk", "Other"] },
      { name: "callback", label: "Call-back number", type: "text", required: true },
    ],
    tasks: ["Verify identity by call-back", "Reset and share through a secure channel"],
  },
  {
    name: "Shared folder access", kind: "service", group: "Access & accounts", icon: "folder-lock",
    description: "Read or edit access to a team or client shared folder.",
    delivery: "1 working day", approvals: ["manager"],
    fields: [
      { name: "folder", label: "Folder path or name", type: "text", required: true },
      { name: "access", label: "Access", type: "select", required: true, options: ["Read", "Read and write"] },
    ],
    tasks: ["Check with the folder owner", "Grant access"],
  },
  {
    name: "Distribution list or shared mailbox", kind: "service", group: "Access & accounts", icon: "mail",
    description: "Join or create a DMail distribution list, or get shared mailbox access.",
    delivery: "1 working day", approvals: ["manager"],
    fields: [
      { name: "type", label: "What you need", type: "select", required: true, options: ["Join a distribution list", "Create a distribution list", "Shared mailbox access"] },
      { name: "name", label: "List or mailbox name", type: "text", required: true },
    ],
    tasks: ["Set up in DMail", "Confirm with the requester"],
  },
  // Network
  {
    name: "VPN / remote access", kind: "service", group: "Network & remote work", icon: "shield-check", featured: true,
    description: "Secure access to DEJOIY systems from home or while travelling.",
    delivery: "1 working day after approval", approvals: ["manager"],
    fields: [
      reason(["Work from home", "Travel", "Business continuity"]),
      { name: "from", label: "From", type: "date", required: true },
      { name: "to", label: "Until", type: "date" },
    ],
    tasks: ["Create VPN profile", "Enrol multi-factor sign-in", "Test connection with the user"],
  },
  {
    name: "Guest Wi-Fi", kind: "service", group: "Network & remote work", icon: "wifi",
    description: "Time-limited Wi-Fi for a visitor or client.",
    delivery: "Same day", approvals: ["manager"],
    fields: [
      { name: "guest", label: "Guest name and company", type: "text", required: true },
      { name: "date", label: "Visit date", type: "date", required: true },
    ],
    tasks: ["Create a time-limited voucher", "Share with the host"],
  },
  // Workplace
  {
    name: "Printer or scanner setup", kind: "service", group: "Workplace", icon: "printer",
    description: "Add a printer to your laptop or fix scanning to email.",
    delivery: "Same day", approvals: [],
    fields: [{ name: "location", label: "Floor and printer name", type: "text", required: true }],
    tasks: ["Set up and test a print"],
  },
  {
    name: "Desk or seat move", kind: "service", group: "Workplace", icon: "move",
    description: "Move your equipment and network to a new seat.",
    delivery: "2 working days", approvals: ["manager"],
    fields: [
      { name: "from_desk", label: "From desk", type: "text", required: true },
      { name: "to_desk", label: "To desk", type: "text", required: true },
      { name: "date", label: "Move date", type: "date", required: true },
    ],
    tasks: ["Move equipment", "Patch network and test"],
  },
  // Security
  {
    name: "Report a lost or stolen device", kind: "service", group: "Security", icon: "siren",
    description: "Tell us straight away. We lock and wipe the device and protect your accounts.",
    delivery: "Acted on immediately", approvals: [],
    fields: [
      { name: "device", label: "Device", type: "select", required: true, options: ["Laptop", "Mobile phone", "Headset", "ID card", "Other"] },
      { name: "when", label: "When did you notice", type: "date", required: true },
      { name: "details", label: "Where and how", type: "textarea", required: true },
    ],
    tasks: ["Remote lock and wipe", "Sign out sessions and reset passwords", "Record the incident with Information Security", "Raise a replacement"],
  },
  {
    name: "Multi-factor sign-in reset", kind: "service", group: "Security", icon: "smartphone",
    description: "New phone or lost your authenticator app.",
    delivery: "Within 1 hour in shift", approvals: [],
    fields: [{ name: "callback", label: "Call-back number", type: "text", required: true }],
    tasks: ["Verify identity by call-back", "Reset multi-factor and re-enrol"],
  },
];

let seeded: Promise<void> | null = null;

/** Seeds the IT catalog once per process if there is none yet. */
export function ensureItCatalog(itDepartmentId: number | null): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      const { rows } = await pool.query(`SELECT 1 FROM service_catalog_items WHERE category = 'IT' LIMIT 1`);
      if (rows.length) return;
      const tenant = await pool.query(`SELECT id FROM tenants WHERE slug = 'default' LIMIT 1`);
      const tenantId = tenant.rows[0]?.id ?? null;
      for (const [i, s] of SEEDS.entries()) {
        await pool.query(
          `INSERT INTO service_catalog_items
             (tenant_id, name, category, description, form_schema, approval_chain, department_id,
              kind, group_name, icon, delivery, featured, sort_order, fulfilment_tasks)
           VALUES ($1,$2,'IT',$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
          [
            tenantId, s.name, s.description,
            JSON.stringify({ fields: s.fields }),
            JSON.stringify(s.approvals.map((role, n) => ({ role, order: n + 1 }))),
            itDepartmentId, s.kind, s.group, s.icon, s.delivery, !!s.featured, i + 1,
            JSON.stringify(s.tasks),
          ],
        );
      }
    })().catch((err) => {
      seeded = null;
      throw err;
    });
  }
  return seeded;
}
