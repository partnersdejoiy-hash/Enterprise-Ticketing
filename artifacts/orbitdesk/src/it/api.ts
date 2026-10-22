/** DEJOIY IT client: cookie-session fetch helpers and the shapes the IT API returns. */

export async function itApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `Request failed (${res.status})`);
  return body as T;
}

export const send = <T,>(url: string, method: string, data?: unknown) =>
  itApi<T>(url, { method, body: data === undefined ? undefined : JSON.stringify(data) });

export type Session = {
  user: { id: number; name: string; email: string; role: string; departmentName: string | null };
  isAgent: boolean;
  isAdmin: boolean;
  itDepartmentId: number | null;
};

export type FormField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  options?: string[];
};

export type CatalogItem = {
  id: number;
  name: string;
  kind: "service" | "item";
  group: string;
  icon: string;
  description: string | null;
  delivery: string;
  featured: boolean;
  isActive: boolean;
  formSchema: { fields: FormField[] };
  approvalSteps: number;
  approvalChain: { role: string; order: number }[];
  fulfilmentTasks: string[];
};

export type Stage = "awaiting_approval" | "queued" | "in_progress" | "done" | "rejected" | "cancelled";

export type ItRequest = {
  id: number;
  requestNumber: string;
  status: string;
  stage: Stage;
  formData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  itemId: number;
  itemName: string;
  itemIcon: string;
  itemKind: string;
  delivery: string;
  requesterId: number | null;
  requesterName: string | null;
  ticketId: number | null;
  ticketNumber: string | null;
  ticketStatus: string | null;
  tasksTotal: number;
  tasksDone: number;
  waitingOn: string | null;
  formSchema?: { fields: FormField[] };
};

export type Approval = {
  id: number;
  step: number;
  role: string;
  status: string;
  decidedAt: string | null;
  comment: string | null;
  approverName: string | null;
};

export type Task = { id: number; title: string; done: boolean; doneAt: string | null; doneBy: string | null };

export type Ticket = {
  id: number;
  ticketNumber: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  departmentId: number | null;
  assigneeId: number | null;
  assigneeName: string | null;
  createdById: number;
  createdByName: string;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  slaBreached: boolean;
  slaDeadline: string | null;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Comment = {
  id: number;
  content: string;
  isInternal: boolean;
  authorId: number;
  authorName: string;
  createdAt: string;
};

export type Asset = {
  id: number;
  name: string;
  type: string;
  status: string;
  health: string;
  attributes: Record<string, string>;
  ownerId: number | null;
  ownerName: string | null;
  ownerEmail: string | null;
  departmentName: string | null;
  updatedAt: string;
};

export type Person = { id: number; name: string; email: string; departmentName: string | null };
