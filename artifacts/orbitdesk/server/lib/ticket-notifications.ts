import { db, ticketsTable, usersTable, eq, inArray } from "@workspace/db";
import { readJsonSetting, preferenceDefaults } from "./workspace-settings.js";
import { canAccessTicket, handlesTicket } from "./ticket-access.js";
import { sendEmail } from "./emailService.js";
import { escapeHtml } from "./security.js";
export async function notifyTicket(
  ticketId: number,
  event: "assigned" | "comments" | "sla",
  actorId?: number,
  internal = false,
) {
  try {
    const [ticket] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId));
    if (!ticket) return;
    const ids = [
      ...new Set(
        (event === "assigned"
          ? [ticket.assigneeId]
          : [
              ticket.assigneeId,
              ticket.createdById,
              ticket.raisedForUserId,
              ...ticket.taggedUserIds,
            ]
        ).filter((x): x is number => !!x && x !== actorId),
      ),
    ];
    if (!ids.length) return;
    const users = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
    const label = {
      assigned: "Ticket assigned to you",
      comments: "New ticket reply",
      sla: "Ticket requires SLA review",
    }[event];
    await Promise.allSettled(
      users.map(async (user) => {
        if (
          !user.isActive ||
          !(await canAccessTicket(user, ticketId)) ||
          (internal && !(await handlesTicket(user, ticketId)))
        )
          return;
        const prefs = await readJsonSetting(
          `preferences:${user.id}`,
          preferenceDefaults,
        );
        if (!prefs[event]) return;
        // Do not email HR evidence, private comments or attachments; access is checked again on opening.
        await sendEmail(
          user.email,
          `[OrbitDesk] ${label}: ${ticket.ticketNumber}`,
          `<p>${label}: <strong>${escapeHtml(ticket.ticketNumber)}</strong>.</p><p><a href="https://orbitdesk.dejoiy.com/tickets/${ticket.id}">Open the ticket securely</a></p>`,
        );
      }),
    );
  } catch {
    console.error("[notifications] Notification unavailable", {
      ticketId,
      event,
    });
  }
}
export async function acceptsStatusEmail(email: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));
  return (
    !user ||
    (user.isActive &&
      (await readJsonSetting(`preferences:${user.id}`, preferenceDefaults))
        .updates)
  );
}
