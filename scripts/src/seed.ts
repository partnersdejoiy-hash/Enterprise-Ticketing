import { db, departmentsTable, usersTable, ticketsTable, commentsTable, ticketHistoryTable } from "@workspace/db";
import crypto from "crypto";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "orbitdesk_salt").digest("hex");
}

function generateTicketNumber(idx: number): string {
  return `TKT-${String(100000 + idx).padStart(6, "0")}`;
}

async function seed() {
  console.log("Seeding OrbitDesk database...");

  // Departments
  const depts = await db.insert(departmentsTable).values([
    { name: "IT Support", description: "Information Technology support and infrastructure", color: "#3B82F6", icon: "Monitor", slaResponseHours: 2, slaResolutionHours: 8 },
    { name: "Human Resources", description: "HR operations, payroll, and employee welfare", color: "#8B5CF6", icon: "Users", slaResponseHours: 4, slaResolutionHours: 24 },
    { name: "Background Verification", description: "Pre-employment background checks and verification", color: "#F59E0B", icon: "ShieldCheck", slaResponseHours: 8, slaResolutionHours: 48 },
    { name: "Admin", description: "Office administration and facilities", color: "#10B981", icon: "Building2", slaResponseHours: 4, slaResolutionHours: 24 },
    { name: "Legal", description: "Legal compliance, contracts, and advisory", color: "#EF4444", icon: "Scale", slaResponseHours: 8, slaResolutionHours: 72 },
    { name: "Finance", description: "Payroll, reimbursements, and financial operations", color: "#06B6D4", icon: "DollarSign", slaResponseHours: 4, slaResolutionHours: 48 },
    { name: "Operations", description: "Business operations and process management", color: "#F97316", icon: "Cog", slaResponseHours: 4, slaResolutionHours: 24 },
    { name: "Customer Support", description: "External customer support and satisfaction", color: "#EC4899", icon: "HeadphonesIcon", slaResponseHours: 1, slaResolutionHours: 4 },
  ]).returning();

  console.log(`Created ${depts.length} departments`);

  const itDept = depts.find(d => d.name === "IT Support")!;
  const hrDept = depts.find(d => d.name === "Human Resources")!;
  const bgvDept = depts.find(d => d.name === "Background Verification")!;
  const supportDept = depts.find(d => d.name === "Customer Support")!;
  const financeDept = depts.find(d => d.name === "Finance")!;
  const legalDept = depts.find(d => d.name === "Legal")!;

  // Users
  const pw = hashPassword("password");
  const users = await db.insert(usersTable).values([
    { name: "Sarah Mitchell", email: "admin@orbitdesk.com", passwordHash: pw, role: "super_admin", isActive: true },
    { name: "James Rodriguez", email: "james.r@company.com", passwordHash: pw, role: "admin", isActive: true },
    { name: "Priya Sharma", email: "priya.s@company.com", passwordHash: pw, role: "manager", departmentId: itDept.id, isActive: true },
    { name: "Alex Chen", email: "alex.c@company.com", passwordHash: pw, role: "agent", departmentId: itDept.id, isActive: true },
    { name: "Marcus Johnson", email: "marcus.j@company.com", passwordHash: pw, role: "agent", departmentId: itDept.id, isActive: true },
    { name: "Fatima Al-Hassan", email: "fatima.h@company.com", passwordHash: pw, role: "manager", departmentId: hrDept.id, isActive: true },
    { name: "Elena Volkov", email: "elena.v@company.com", passwordHash: pw, role: "agent", departmentId: hrDept.id, isActive: true },
    { name: "David Kim", email: "david.k@company.com", passwordHash: pw, role: "agent", departmentId: bgvDept.id, isActive: true },
    { name: "Rachel Torres", email: "rachel.t@company.com", passwordHash: pw, role: "agent", departmentId: supportDept.id, isActive: true },
    { name: "Michael Brown", email: "michael.b@company.com", passwordHash: pw, role: "agent", departmentId: financeDept.id, isActive: true },
    { name: "Emma Wilson", email: "emma.w@company.com", passwordHash: pw, role: "employee", departmentId: itDept.id, isActive: true },
    { name: "Carlos Mendez", email: "carlos.m@company.com", passwordHash: pw, role: "employee", isActive: true },
    { name: "Nina Patel", email: "nina.p@company.com", passwordHash: pw, role: "employee", isActive: true },
    { name: "Thomas Hayes", email: "thomas.h@company.com", passwordHash: pw, role: "agent", departmentId: legalDept.id, isActive: true },
  ]).returning();

  console.log(`Created ${users.length} users`);

  const admin = users.find(u => u.email === "admin@orbitdesk.com")!;
  const alexChen = users.find(u => u.name === "Alex Chen")!;
  const marcusJ = users.find(u => u.name === "Marcus Johnson")!;
  const elenaV = users.find(u => u.name === "Elena Volkov")!;
  const davidK = users.find(u => u.name === "David Kim")!;
  const rachelT = users.find(u => u.name === "Rachel Torres")!;
  const michaelB = users.find(u => u.name === "Michael Brown")!;
  const emmaw = users.find(u => u.name === "Emma Wilson")!;
  const carlosM = users.find(u => u.name === "Carlos Mendez")!;
  const ninaP = users.find(u => u.name === "Nina Patel")!;
  const thomasH = users.find(u => u.name === "Thomas Hayes")!;

  // Tickets
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86400 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 86400 * 1000);

  const ticketData = [
    { ticketNumber: generateTicketNumber(1), subject: "VPN connection failing after Windows update", description: "Since the Windows security update last night, VPN drops every 15 minutes. Affecting all remote employees.", status: "in_progress" as const, priority: "urgent" as const, departmentId: itDept.id, assigneeId: alexChen.id, createdById: emmaw.id, tags: ["vpn", "windows", "remote-work"], slaBreached: false, slaDeadline: new Date(now.getTime() + 2 * 3600 * 1000), createdAt: dayAgo, updatedAt: dayAgo },
    { ticketNumber: generateTicketNumber(2), subject: "Laptop won't boot - blue screen of death", description: "My Dell XPS 15 shows a blue screen with error KERNEL_SECURITY_CHECK_FAILURE. Cannot access work files.", status: "assigned" as const, priority: "high" as const, departmentId: itDept.id, assigneeId: marcusJ.id, createdById: carlosM.id, tags: ["hardware", "laptop", "bsod"], slaBreached: false, slaDeadline: new Date(now.getTime() + 4 * 3600 * 1000), createdAt: dayAgo, updatedAt: dayAgo },
    { ticketNumber: generateTicketNumber(3), subject: "Request for maternity leave documentation", description: "I need the official maternity leave policy documents and application forms for my upcoming leave starting next month.", status: "resolved" as const, priority: "medium" as const, departmentId: hrDept.id, assigneeId: elenaV.id, createdById: ninaP.id, tags: ["maternity", "leave", "documentation"], slaBreached: false, slaDeadline: null, createdAt: threeDaysAgo, updatedAt: dayAgo },
    { ticketNumber: generateTicketNumber(4), subject: "BGV check for new hire - Rahul Gupta", description: "Please initiate background verification for our new hire joining the engineering team on April 15. Employee ID: EMP-8821.", status: "in_progress" as const, priority: "high" as const, departmentId: bgvDept.id, assigneeId: davidK.id, createdById: admin.id, tags: ["bgv", "new-hire", "engineering"], slaBreached: false, slaDeadline: new Date(now.getTime() + 36 * 3600 * 1000), createdAt: twoDaysAgo, updatedAt: twoDaysAgo },
    { ticketNumber: generateTicketNumber(5), subject: "Software license renewal for Adobe Creative Cloud", description: "15 licenses for Adobe CC expire on April 20. Need approval and procurement initiated to avoid workflow disruption for the design team.", status: "waiting" as const, priority: "medium" as const, departmentId: itDept.id, assigneeId: alexChen.id, createdById: carlosM.id, tags: ["license", "adobe", "software"], slaBreached: false, slaDeadline: null, createdAt: weekAgo, updatedAt: threeDaysAgo },
    { ticketNumber: generateTicketNumber(6), subject: "Expense reimbursement - Client meeting Mumbai", description: "Submitting receipts for client entertainment expenses: INR 12,450 for dinner at Trident, Mumbai on April 3rd. Manager approval obtained.", status: "open" as const, priority: "low" as const, departmentId: financeDept.id, assigneeId: michaelB.id, createdById: carlosM.id, tags: ["reimbursement", "expense", "travel"], slaBreached: false, slaDeadline: null, createdAt: now, updatedAt: now },
    { ticketNumber: generateTicketNumber(7), subject: "Customer unable to access billing portal", description: "Enterprise customer TechCorp (account #TC-4892) reports 403 errors when accessing their billing dashboard since yesterday 2 PM.", status: "in_progress" as const, priority: "urgent" as const, departmentId: supportDept.id, assigneeId: rachelT.id, createdById: admin.id, tags: ["customer", "billing", "access"], slaBreached: true, slaDeadline: new Date(now.getTime() - 1 * 3600 * 1000), createdAt: twoDaysAgo, updatedAt: dayAgo },
    { ticketNumber: generateTicketNumber(8), subject: "Non-disclosure agreement review for vendor", description: "Need legal review of NDA with CloudBase Solutions before signing. Vendor is requesting urgent turnaround.", status: "open" as const, priority: "high" as const, departmentId: legalDept.id, assigneeId: thomasH.id, createdById: admin.id, tags: ["nda", "vendor", "legal-review"], slaBreached: false, slaDeadline: new Date(now.getTime() + 48 * 3600 * 1000), createdAt: now, updatedAt: now },
    { ticketNumber: generateTicketNumber(9), subject: "New employee onboarding IT setup", description: "Setup required for 3 new engineers joining Monday. MacBook Pro, access cards, Slack, GitHub, AWS SSO access needed.", status: "open" as const, priority: "medium" as const, departmentId: itDept.id, assigneeId: null, createdById: admin.id, tags: ["onboarding", "setup", "access"], slaBreached: false, slaDeadline: new Date(now.getTime() + 24 * 3600 * 1000), createdAt: now, updatedAt: now },
    { ticketNumber: generateTicketNumber(10), subject: "Payroll discrepancy - March salary", description: "My March salary was credited INR 8,200 less than expected. The deduction does not match the salary slip provided.", status: "assigned" as const, priority: "high" as const, departmentId: financeDept.id, assigneeId: michaelB.id, createdById: emmaw.id, tags: ["payroll", "salary", "discrepancy"], slaBreached: false, slaDeadline: new Date(now.getTime() + 12 * 3600 * 1000), createdAt: dayAgo, updatedAt: dayAgo },
    { ticketNumber: generateTicketNumber(11), subject: "BGV - Negative reference check for Anjali Verma", description: "Reference check for candidate Anjali Verma (EMP-8850) returned a negative response from previous employer. Escalation needed.", status: "waiting" as const, priority: "urgent" as const, departmentId: bgvDept.id, assigneeId: davidK.id, createdById: davidK.id, tags: ["bgv", "reference-check", "escalation"], slaBreached: true, slaDeadline: new Date(now.getTime() - 12 * 3600 * 1000), createdAt: threeDaysAgo, updatedAt: dayAgo },
    { ticketNumber: generateTicketNumber(12), subject: "Office HVAC system temperature issues", description: "4th floor is consistently 5 degrees warmer than the rest of the building. Multiple team members reporting discomfort.", status: "resolved" as const, priority: "low" as const, departmentId: depts.find(d => d.name === "Admin")!.id, assigneeId: null, createdById: ninaP.id, tags: ["hvac", "office", "facilities"], slaBreached: false, slaDeadline: null, createdAt: weekAgo, updatedAt: threeDaysAgo },
  ];

  const tickets = await db.insert(ticketsTable).values(
    ticketData.map(t => ({ ...t }))
  ).returning();

  console.log(`Created ${tickets.length} tickets`);

  // Comments
  await db.insert(commentsTable).values([
    { ticketId: tickets[0].id, content: "Investigating the VPN issue. Looks like the recent Windows update changed some network adapter settings. Working on a fix now.", isInternal: false, authorId: alexChen.id },
    { ticketId: tickets[0].id, content: "Internal note: The issue is with the TAP adapter. Rolling out GPO fix.", isInternal: true, authorId: alexChen.id },
    { ticketId: tickets[1].id, content: "Assigned to Marcus for on-site diagnosis. Please bring your laptop to IT room 204 today.", isInternal: false, authorId: marcusJ.id },
    { ticketId: tickets[2].id, content: "Documents have been emailed to your HR registered email. Please confirm receipt.", isInternal: false, authorId: elenaV.id },
    { ticketId: tickets[3].id, content: "BGV initiated. Documents received from HR. Starting criminal and employment verification.", isInternal: false, authorId: davidK.id },
    { ticketId: tickets[6].id, content: "Escalated to engineering. The 403 is due to an expired SSL certificate on the billing subdomain. Fix in progress.", isInternal: false, authorId: rachelT.id },
    { ticketId: tickets[6].id, content: "Customer notified about the issue and ETA of 2 hours for resolution.", isInternal: false, authorId: rachelT.id },
    { ticketId: tickets[9].id, content: "Finance team reviewing the payslip. Discrepancy found in overtime calculation. Will correct in April cycle.", isInternal: false, authorId: michaelB.id },
  ]);

  // History
  await db.insert(ticketHistoryTable).values([
    { ticketId: tickets[0].id, action: "created", newValue: "open", changedById: emmaw.id },
    { ticketId: tickets[0].id, action: "status_changed", oldValue: "open", newValue: "assigned", changedById: admin.id },
    { ticketId: tickets[0].id, action: "status_changed", oldValue: "assigned", newValue: "in_progress", changedById: alexChen.id },
    { ticketId: tickets[1].id, action: "created", newValue: "open", changedById: carlosM.id },
    { ticketId: tickets[1].id, action: "status_changed", oldValue: "open", newValue: "assigned", changedById: admin.id },
    { ticketId: tickets[2].id, action: "created", newValue: "open", changedById: ninaP.id },
    { ticketId: tickets[2].id, action: "status_changed", oldValue: "open", newValue: "assigned", changedById: admin.id },
    { ticketId: tickets[2].id, action: "status_changed", oldValue: "assigned", newValue: "resolved", changedById: elenaV.id },
    { ticketId: tickets[6].id, action: "created", newValue: "open", changedById: admin.id },
    { ticketId: tickets[6].id, action: "priority_changed", oldValue: "high", newValue: "urgent", changedById: admin.id },
  ]);

  console.log("Seed completed successfully!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
