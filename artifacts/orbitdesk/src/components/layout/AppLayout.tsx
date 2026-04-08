import React, { useState, useEffect, useRef } from "react";
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
  BookOpen,
  Zap,
  Camera,
  Pencil,
  Loader2,
  UserCircle,
  Briefcase,
  ShieldCheck,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLogout } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
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
  { name: "Employment Verification", href: "/employment-verification", icon: Briefcase, roles: ["super_admin", "admin", "manager", "agent"] },
  { name: "Background Verification", href: "/background-verification", icon: ShieldCheck, roles: ["super_admin", "admin", "manager", "agent"] },
  { name: "Departments", href: "/departments", icon: Building2, roles: ["super_admin", "admin", "manager", "agent", "it"] },
  { name: "Users", href: "/users", icon: Users, roles: ["super_admin", "admin"] },
  { name: "Automation Rules", href: "/automation-rules", icon: Zap, roles: ["super_admin", "admin"] },
  { name: "Training Centre", href: "/training", icon: BookOpen, roles: null },
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
  const { user, logout, updateUser } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<string>("");
  const [profileSaving, setProfileSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

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

  const openProfile = () => {
    setProfileName(user?.name ?? "");
    setProfileAvatar(user?.avatar ?? "");
    setProfileOpen(true);
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please choose an image under 2 MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setProfileAvatar(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleProfileSave = async () => {
    if (!user) return;
    setProfileSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: profileName.trim() || undefined,
          avatar: profileAvatar,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? "Failed to save profile");
      }
      const updated = await res.json();
      updateUser({ name: updated.name, avatar: updated.avatar });
      toast({ title: "Profile updated", description: "Your profile has been saved." });
      setProfileOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message ?? "Failed to save profile", variant: "destructive" });
    } finally {
      setProfileSaving(false);
    }
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
          <div className="relative flex-shrink-0">
            <img src="/dejoiy-logo.jpg" alt="Dejoiy" className="w-8 h-8 rounded-lg object-cover shadow-sm" />
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-gradient-to-br from-blue-600 to-blue-800 rounded-full flex items-center justify-center border border-sidebar">
              <span className="text-[8px] font-black text-white leading-none">D</span>
            </div>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">Dejoiy</span>
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
          const isZap = item.href === "/automation-rules";
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
              <item.icon className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-sidebar-primary" : ""} ${isZap && !isActive ? "text-orange-400" : ""}`} />
              <span className="flex-1 text-sm">{item.name}</span>
              {isZap && !isActive && <span className="text-[9px] font-bold text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded-full">AUTO</span>}
              {isActive && <ChevronRight className="h-3.5 w-3.5 opacity-40" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={openProfile}
            title="Edit profile"
            className="relative group flex-shrink-0"
          >
            <Avatar className="h-9 w-9 border border-sidebar-border">
              <AvatarImage src={user.avatar || ""} />
              <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-sm font-medium">
                {user.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              <Pencil className="h-3 w-3 text-white" />
            </span>
          </button>
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
              <div className="w-4 h-4 bg-gradient-to-br from-blue-600 to-blue-800 rounded flex items-center justify-center">
                <span className="text-[8px] font-black text-white leading-none">D</span>
              </div>
              <span className="text-[11px] font-bold text-sidebar-foreground/70 tracking-wide">Dejoiy</span>
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
                <DropdownMenuItem onClick={openProfile} className="cursor-pointer gap-2">
                  <UserCircle className="h-4 w-4" />
                  My Profile
                </DropdownMenuItem>
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

      {/* Profile Dialog */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarFileChange}
      />
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>My Profile</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-5 py-2">
            <div className="relative group">
              <Avatar className="h-24 w-24 border-4 border-muted shadow-md">
                <AvatarImage src={profileAvatar || ""} />
                <AvatarFallback className="text-3xl font-semibold bg-primary/10 text-primary">
                  {profileName.charAt(0).toUpperCase() || user.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full flex flex-col items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity gap-0.5"
                title="Upload photo"
              >
                <Camera className="h-5 w-5 text-white" />
                <span className="text-[10px] text-white font-medium">Change</span>
              </button>
            </div>
            {profileAvatar && (
              <button
                onClick={() => setProfileAvatar("")}
                className="text-xs text-destructive hover:underline -mt-2"
              >
                Remove photo
              </button>
            )}
            <div className="w-full space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Full Name</Label>
                <Input
                  id="profile-name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Your full name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={user.email} disabled className="bg-muted/50 text-muted-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <div className="flex items-center h-9 px-3 rounded-md border bg-muted/50">
                  <Badge variant="secondary" className="capitalize text-xs">
                    {roleLabels[user.role] ?? user.role}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)} disabled={profileSaving}>
              Cancel
            </Button>
            <Button onClick={handleProfileSave} disabled={profileSaving}>
              {profileSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
