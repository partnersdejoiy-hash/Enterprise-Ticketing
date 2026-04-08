import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Ticket, 
  Building2, 
  Users, 
  Settings, 
  LogOut,
  Bell,
  Search,
  Menu,
  FileText,
  X,
  ChevronRight,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useLogout } from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const allNavItems = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: null },
  { name: "Tickets", href: "/tickets", icon: Ticket, roles: null },
  { name: "Document Requests", href: "/documents", icon: FileText, roles: null },
  { name: "Departments", href: "/departments", icon: Building2, roles: ["super_admin", "admin", "manager", "agent", "it"] },
  { name: "Users", href: "/users", icon: Users, roles: ["super_admin", "admin"] },
  { name: "Settings", href: "/settings", icon: Settings, roles: ["super_admin", "admin"] },
];

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
  employee: "Employee",
  external: "External",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState("");

  const isPrivileged = user?.role === "super_admin" || user?.role === "admin" ||
    user?.departmentName?.toLowerCase() === "it";

  const handleHeaderSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && headerSearch.trim()) {
      setLocation(`/tickets?q=${encodeURIComponent(headerSearch.trim())}`);
      setHeaderSearch("");
    }
  };

  const navItems = allNavItems.filter((item) => {
    if (!item.roles) return true;
    if (item.roles.includes(user?.role ?? "")) return true;
    if (isPrivileged) return true;
    return false;
  });

  const logoutMutation = useLogout();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        logout();
        setLocation("/");
      }
    });
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  if (!user) {
    setLocation("/");
    return null;
  }

  const SidebarContent = () => (
    <>
      <div className="h-14 flex items-center px-4 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-2.5 flex-1">
          <img src="/dejoiy-logo.jpg" alt="Dejoiy" className="w-8 h-8 rounded-lg object-cover shadow-sm flex-shrink-0" />
          <div className="flex flex-col leading-none">
            <span className="text-[9px] font-semibold text-sidebar-foreground/50 uppercase tracking-widest">Dejoiy</span>
            <span className="font-bold text-sm text-sidebar-foreground tracking-tight">OrbitDesk</span>
          </div>
        </div>
        <button
          className="md:hidden p-1.5 rounded-md hover:bg-sidebar-accent/50 text-sidebar-foreground/60 transition-colors"
          onClick={() => setMobileOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
            >
              <item.icon className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-sidebar-primary" : ""}`} />
              <span className="flex-1 text-sm">{item.name}</span>
              {isActive && <ChevronRight className="h-3.5 w-3.5 opacity-40" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-9 w-9 border border-sidebar-border flex-shrink-0">
            <AvatarImage src={user.avatar || ""} />
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-sm font-medium">
              {user.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col overflow-hidden flex-1">
            <span className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</span>
            <span className="text-xs text-sidebar-foreground/60 truncate">{roleLabels[user.role] ?? user.role}</span>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-1.5 rounded-md hover:bg-sidebar-accent/50 text-sidebar-foreground/50 hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <div className="pt-2.5 border-t border-sidebar-border/50 flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-sidebar-foreground/40">Powered by</span>
            <div className="flex items-center gap-1">
              <img src="/dejoiy-logo.jpg" alt="Dejoiy" className="w-3.5 h-3.5 rounded object-cover" />
              <span className="text-[11px] font-semibold text-sidebar-foreground/70 tracking-wide">Dejoiy</span>
            </div>
          </div>
          <span className="text-[9px] text-sidebar-foreground/30">&copy; {new Date().getFullYear()} Dejoiy. All rights reserved.</span>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
          style={{ animation: "fadeIn 0.2s ease" }}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-sidebar-border flex flex-col md:hidden transition-transform duration-300 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContent />
      </aside>

      {/* Desktop sidebar */}
      <aside className="w-64 bg-sidebar border-r border-sidebar-border hidden md:flex flex-col flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 bg-background border-b border-border flex items-center justify-between px-3 sm:px-6 flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
            <button
              className="md:hidden p-2 rounded-md hover:bg-muted transition-colors flex-shrink-0"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5 text-foreground/70" />
            </button>
            <div className="relative w-full max-w-md hidden sm:block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search tickets… press Enter"
                className="w-full bg-muted/50 pl-9 border-none focus-visible:ring-1 focus-visible:bg-background transition-colors"
                value={headerSearch}
                onChange={(e) => setHeaderSearch(e.target.value)}
                onKeyDown={handleHeaderSearch}
              />
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="icon" className="text-muted-foreground relative h-9 w-9">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-destructive border-2 border-background"></span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatar || ""} />
                    <AvatarFallback className="text-sm font-medium">{user.name.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    <p className="text-xs leading-none text-muted-foreground capitalize mt-0.5">{roleLabels[user.role] ?? user.role}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer gap-2">
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto bg-muted/30">
          {children}
        </div>
      </main>
    </div>
  );
}
