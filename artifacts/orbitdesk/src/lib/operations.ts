export async function readApi<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.assign("/");
    throw new Error("Session expired. Please sign in again.");
  }
  if (res.status === 428) {
    window.location.assign("/change-password");
    throw new Error("Change your temporary password first.");
  }
  if (!res.ok)
    throw new Error(
      res.status === 403
        ? "You do not have access to this workspace."
        : "Unable to load this view. Please try again.",
    );
  return res.json();
}
export interface WorkTicket {
  id: number;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  tags: string[];
  createdAt: string;
  slaDeadline?: string;
  assigneeName?: string;
  raisedForName?: string;
}
export interface Operations {
  departments: { id: number | null; name: string | null; count: number }[];
  summary: {
    total: number;
    active: number;
    unassigned: number;
    waiting: number;
    resolved: number;
    overdue: number;
    website: number;
    employment: number;
    bgv: number;
  };
  recent: WorkTicket[];
  daily: { day: string; count: number }[];
  asOf: string;
}
export const statusText: Record<string, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  waiting: "Awaiting information",
  resolved: "Resolved",
  closed: "Closed",
};
