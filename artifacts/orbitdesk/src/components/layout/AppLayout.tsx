import React, { useState, useRef } from "react";
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
  FileText
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

  if (!user) {
    setLocation("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-sidebar border-r border-sidebar-border hidden md:flex flex-col flex-shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <img src="/dejoiy-logo.jpg" alt="Dejoiy" className="w-8 h-8 rounded-lg object-cover shadow-sm flex-shrink-0" />
            <div className="flex flex-col leading-none">
              <span className="text-[9px] font-semibold text-sidebar-foreground/50 uppercase tracking-widest">Dejoiy</span>
              <span className="font-bold text-sm text-sidebar-foreground tracking-tight">OrbitDesk</span>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className={`h-4 w-4 ${isActive ? "text-sidebar-primary" : ""}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-sidebar-border space-y-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9 border border-sidebar-border">
              <AvatarImage src={user.avatar || ""} />
              <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground">
                {user.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</span>
              <span className="text-xs text-sidebar-foreground/60 truncate">{roleLabels[user.role] ?? user.role}</span>
            </div>
          </div>
          <div className="pt-2 border-t border-sidebar-border/50 flex flex-col items-center gap-0.5">
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
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 bg-background border-b border-border flex items-center justify-between px-4 sm:px-6 flex-shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5" />
            </Button>
            <div className="relative w-full max-w-md hidden sm:block">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search tickets… press Enter"
                className="w-full bg-muted/50 pl-9 border-none focus-visible:ring-1 focus-visible:bg-background"
                value={headerSearch}
                onChange={(e) => setHeaderSearch(e.target.value)}
                onKeyDown={handleHeaderSearch}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="text-muted-foreground relative">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-destructive border-2 border-background"></span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full md:hidden">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatar || ""} />
                    <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            {/* Desktop Logout Button */}
            <Button variant="ghost" size="icon" onClick={handleLogout} className="hidden md:flex text-muted-foreground hover:text-destructive">
              <LogOut className="h-5 w-5" />
            </Button>
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
