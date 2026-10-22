import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertOctagon, BookOpen, Boxes, ClipboardCheck, GitBranch, Headset, Inbox, LayoutGrid,
  LogOut, Menu, PackageSearch, Search, ShieldAlert, Store, X,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth";
import { itApi, type Session } from "./api";

export function useItSession() {
  return useQuery({ queryKey: ["it", "session"], queryFn: () => itApi<Session>("/api/it/session"), staleTime: 300_000 });
}

function useSignOut() {
  const [, navigate] = useLocation();
  const cache = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  return async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    cache.clear();
    logout();
    navigate("/");
  };
}

function Wordmark({ to }: { to: string }) {
  return (
    <Link href={to} className="it-wordmark" aria-label="DEJOIY IT home">
      <img src="/dejoiy-official-logo.png" alt="" />
      <span>
        DEJOIY <b>IT</b>
      </span>
    </Link>
  );
}

function Initials({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  return <span className="it-avatar">{(parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")}</span>;
}

const PORTAL_NAV = [
  { href: "/it", label: "Home", exact: true },
  { href: "/it/catalog", label: "Catalog" },
  { href: "/it/report", label: "Report an issue" },
  { href: "/it/my", label: "My requests" },
  { href: "/it/knowledge", label: "Knowledge" },
  { href: "/it/status", label: "Service status" },
];

/** Employee self-service shell: one plain bar, content below. */
export function PortalLayout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { data: session } = useItSession();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const active = (href: string, exact?: boolean) => (exact ? loc === href : loc.startsWith(href));
  return (
    <div className="it-app">
      <a href="#it-main" className="it-skip">Skip to content</a>
      <header className="it-bar">
        <div className="it-bar-inner">
          <Wordmark to="/it" />
          <nav className="it-nav" aria-label="IT portal">
            {PORTAL_NAV.map((n) => (
              <Link key={n.href} href={n.href} className={active(n.href, n.exact) ? "is-active" : ""}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="it-bar-end">
            {session?.isAgent && (
              <Link href="/it/console" className="it-btn it-btn-onnight">
                <Headset size={16} /> IT console
              </Link>
            )}
            {session && (
              <span className="it-user" title={session.user.email}>
                <Initials name={session.user.name} />
              </span>
            )}
            <button type="button" className="it-iconbtn" onClick={signOut} aria-label="Sign out">
              <LogOut size={18} />
            </button>
            <button type="button" className="it-iconbtn it-only-phone" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="it-phone-nav" aria-label="IT portal">
            {PORTAL_NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={active(n.href, n.exact) ? "is-active" : ""}>
                {n.label}
              </Link>
            ))}
            {session?.isAgent && (
              <Link href="/it/console" onClick={() => setOpen(false)}>IT console</Link>
            )}
          </nav>
        )}
      </header>
      <main id="it-main" className="it-main">{children}</main>
      <footer className="it-foot">
        <span>DEJOIY IT · IT services for every DEJOIY team</span>
        <span>
          Urgent and can't work? Report it as <b>"I can't work at all"</b> and it goes to the top of the queue.
        </span>
      </footer>
    </div>
  );
}

const CONSOLE_NAV = [
  { href: "/it/console", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/it/console/queue", label: "Incident queue", icon: Inbox },
  { href: "/it/console/requests", label: "Requests", icon: PackageSearch },
  { href: "/it/console/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/it/console/major", label: "Major incidents", icon: ShieldAlert },
  { href: "/it/console/problems", label: "Problems", icon: AlertOctagon },
  { href: "/it/console/changes", label: "Changes", icon: GitBranch },
  { href: "/it/console/assets", label: "Assets", icon: Boxes },
  { href: "/it/console/catalog", label: "Catalog", icon: Store },
  { href: "/it/console/knowledge", label: "Knowledge", icon: BookOpen },
];

/** IT team shell: dark rail with the ITSM modules. */
export function ConsoleLayout({ children }: { children: ReactNode }) {
  const [loc, navigate] = useLocation();
  const { data: session, isLoading } = useItSession();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const active = (href: string, exact?: boolean) => (exact ? loc === href : loc.startsWith(href));

  if (!isLoading && session && !session.isAgent) {
    return (
      <PortalLayout>
        <div className="it-empty mt-10">
          <p className="it-empty-title">The IT console is for the IT team</p>
          <div className="it-empty-body">
            Need something from IT? <Link href="/it/catalog" className="it-link">Browse the catalog</Link> or{" "}
            <Link href="/it/report" className="it-link">report an issue</Link>.
          </div>
        </div>
      </PortalLayout>
    );
  }

  const rail = (
    <nav className="it-rail-nav" aria-label="IT console">
      {CONSOLE_NAV.map((n) => (
        <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={active(n.href, n.exact) ? "is-active" : ""}>
          <n.icon size={18} strokeWidth={1.75} /> {n.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="it-app it-console">
      <aside className={`it-rail ${open ? "is-open" : ""}`}>
        <div className="it-rail-head">
          <Wordmark to="/it/console" />
        </div>
        {rail}
        <div className="it-rail-foot">
          <Link href="/it" className="it-rail-link">
            <Activity size={16} /> Employee portal
          </Link>
          {session && (
            <div className="it-rail-user">
              <Initials name={session.user.name} />
              <div className="min-w-0">
                <p className="truncate">{session.user.name}</p>
                <p className="truncate it-rail-sub">{session.isAdmin ? "IT administrator" : "IT agent"}</p>
              </div>
              <button type="button" className="it-iconbtn" onClick={signOut} aria-label="Sign out">
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </aside>
      {open && <button type="button" className="it-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <div className="it-console-body">
        <header className="it-console-top">
          <button type="button" className="it-iconbtn it-only-phone" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <form
            className="it-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) navigate(`/it/console/queue?search=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Search size={16} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search incidents by number, subject or person" aria-label="Search incidents" />
          </form>
        </header>
        <main id="it-main" className="it-console-main">{children}</main>
      </div>
    </div>
  );
}
