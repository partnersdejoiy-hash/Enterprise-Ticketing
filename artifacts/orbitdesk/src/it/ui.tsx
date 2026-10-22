import type { ReactNode } from "react";
import {
  AppWindow, Box, Cable, Download, FolderLock, Headphones, KeyRound, Keyboard, Laptop, Mail, Monitor,
  Move, Package, Printer, ShieldCheck, Siren, Smartphone, UserMinus, UserPlus, Wifi, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { FormField, Stage } from "./api";

export const CATALOG_ICONS: Record<string, LucideIcon> = {
  "user-plus": UserPlus, "user-minus": UserMinus, laptop: Laptop, headphones: Headphones,
  monitor: Monitor, keyboard: Keyboard, cable: Cable, smartphone: Smartphone, wrench: Wrench,
  package: Package, download: Download, "app-window": AppWindow, "key-round": KeyRound,
  "folder-lock": FolderLock, mail: Mail, "shield-check": ShieldCheck, wifi: Wifi, printer: Printer,
  move: Move, siren: Siren, box: Box,
};

export function ItemIcon({ name, size = 40 }: { name: string; size?: number }) {
  const Icon = CATALOG_ICONS[name] ?? Box;
  return (
    <span className="it-item-icon" style={{ width: size, height: size }} aria-hidden>
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} />
    </span>
  );
}

export const STAGE: Record<Stage, { label: string; tone: string }> = {
  awaiting_approval: { label: "Awaiting approval", tone: "amber" },
  queued: { label: "Approved, queued", tone: "blue" },
  in_progress: { label: "Being fulfilled", tone: "accent" },
  done: { label: "Completed", tone: "green" },
  rejected: { label: "Not approved", tone: "red" },
  cancelled: { label: "Cancelled", tone: "grey" },
};

export const TICKET_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "New", tone: "blue" },
  assigned: { label: "Assigned", tone: "accent" },
  in_progress: { label: "In progress", tone: "accent" },
  waiting: { label: "Waiting on you", tone: "amber" },
  resolved: { label: "Resolved", tone: "green" },
  closed: { label: "Closed", tone: "grey" },
};

export const PRIORITY: Record<string, { label: string; tone: string }> = {
  urgent: { label: "P1 Critical", tone: "red" },
  high: { label: "P2 High", tone: "amber" },
  medium: { label: "P3 Moderate", tone: "blue" },
  low: { label: "P4 Low", tone: "grey" },
};

export function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`it-chip it-chip-${tone}`}>{children}</span>;
}

export const stageChip = (s: Stage) => <Chip tone={STAGE[s]?.tone ?? "grey"}>{STAGE[s]?.label ?? s}</Chip>;
export const statusChip = (s: string) => (
  <Chip tone={TICKET_STATUS[s]?.tone ?? "grey"}>{TICKET_STATUS[s]?.label ?? s.replace(/_/g, " ")}</Chip>
);
export const priorityChip = (p: string) => <Chip tone={PRIORITY[p]?.tone ?? "grey"}>{PRIORITY[p]?.label ?? p}</Chip>;

export function PageHead({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className="it-pagehead">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="it-empty">
      <p className="it-empty-title">{title}</p>
      {children && <div className="it-empty-body">{children}</div>}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="it-skeleton" />
      ))}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="it-error">{error instanceof Error ? error.message : String(error)}</p>;
}

export function when(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)} d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function stamp(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** One field of a catalog order form. */
export function DynamicField({
  field, value, onChange,
}: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  const id = `f-${field.name}`;
  const label = (
    <label htmlFor={id} className="it-label">
      {field.label}
      {field.required && <span className="it-req" aria-hidden> *</span>}
    </label>
  );
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2.5 text-[15px]">
        <input id={id} type="checkbox" className="it-check" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <div>
        {label}
        <select id={id} className="it-input" required={field.required} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
    );
  }
  if (field.type === "textarea") {
    return (
      <div>
        {label}
        <textarea id={id} className="it-input min-h-[104px]" required={field.required} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  return (
    <div>
      {label}
      <input
        id={id}
        className="it-input"
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        required={field.required}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
      />
    </div>
  );
}

/** What employees can report; becomes the ticket's category / subcategory. */
export const ISSUE_TYPES: { name: string; subs: string[] }[] = [
  { name: "Laptop or desktop", subs: ["Won't start", "Very slow", "Blue screen or crash", "Battery or charger", "Screen, keyboard or touchpad", "Other"] },
  { name: "Headset or audio", subs: ["No sound", "Mic not working", "Echo or noise", "Physically broken"] },
  { name: "Network and Wi-Fi", subs: ["No internet", "Wi-Fi keeps dropping", "VPN won't connect", "Very slow connection"] },
  { name: "Email and DMail", subs: ["Can't sign in", "Not receiving mail", "Can't send", "Calendar or contacts"] },
  { name: "Sign-in and access", subs: ["Account locked", "Forgot password", "Multi-factor problem", "Missing app access"] },
  { name: "Business apps", subs: ["Chronix", "OrbitDesk", "Shine", "magistick", "Client CRM / dialler", "Other app"] },
  { name: "Printer or scanner", subs: ["Won't print", "Paper jam", "Scan to email"] },
  { name: "Security concern", subs: ["Suspicious email (phishing)", "Virus or pop-ups", "Lost or stolen device", "Data shared by mistake"] },
  { name: "Something else", subs: ["Other"] },
];

export const IMPACT = ["Just me", "My team or process", "A whole site or a client"] as const;
export const URGENCY = ["It can wait", "It's slowing me down", "I can't work at all"] as const;

/** ITIL-style impact × urgency → ticket priority. */
export function priorityFor(impact: number, urgency: number): "low" | "medium" | "high" | "urgent" {
  const score = impact + urgency; // 0..4
  if (score >= 4) return "urgent";
  if (score === 3) return "high";
  if (score === 2) return "medium";
  return "low";
}
