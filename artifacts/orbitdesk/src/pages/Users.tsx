import React, { useState } from "react";
import { useListUsers, useCreateUser, useListDepartments } from "@workspace/api-client-react";
import { BulkUploadDialog } from "@/components/BulkUploadDialog";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Search, UserCircle2, ShieldAlert, Shield, UserCog, User, UserCheck, ExternalLink, Plus, Upload, Loader2, MoreHorizontal, ShieldOff, ShieldCheck, Trash2, UserMinus, UserCog2, ChevronDown, CheckSquare } from "lucide-react";

type UserRow = { id: number; name: string; email: string; role: string; departmentId: number | null; departmentName: string | null; isActive: boolean; createdAt: string };

const roleConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  super_admin: { label: "Super Admin", color: "bg-purple-100 text-purple-700 border-purple-200", icon: ShieldAlert },
  admin: { label: "Admin", color: "bg-blue-100 text-blue-700 border-blue-200", icon: Shield },
  manager: { label: "Manager", color: "bg-indigo-100 text-indigo-700 border-indigo-200", icon: UserCog },
  agent: { label: "Agent", color: "bg-green-100 text-green-700 border-green-200", icon: UserCheck },
  employee: { label: "Employee", color: "bg-gray-100 text-gray-700 border-gray-200", icon: User },
  external: { label: "External", color: "bg-orange-100 text-orange-700 border-orange-200", icon: ExternalLink },
};

const avatarColors = [
  "bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500",
  "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-red-500",
];

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createUser = useCreateUser();
  const { data: departments } = useListDepartments();

  const [form, setForm] = useState({
    name: "", email: "", password: "", role: "employee", departmentId: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) {
      toast({ title: "Validation error", description: "Name, email and password are required", variant: "destructive" });
      return;
    }
    createUser.mutate({
      data: {
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role as "employee" | "agent" | "manager" | "admin" | "super_admin" | "external",
        departmentId: form.departmentId && form.departmentId !== "none" ? parseInt(form.departmentId) : undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: "User created", description: `${form.name} has been added` });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        setForm({ name: "", email: "", password: "", role: "employee", departmentId: "" });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: "Failed to create user", description: err?.data?.message ?? "Something went wrong", variant: "destructive" });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Full Name <span className="text-red-500">*</span></Label>
            <Input id="u-name" placeholder="e.g. Jane Smith" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Email <span className="text-red-500">*</span></Label>
            <Input id="u-email" type="email" placeholder="jane@example.com" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-pass">Password <span className="text-red-500">*</span></Label>
            <Input id="u-pass" type="password" placeholder="Minimum 8 characters" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="external">External</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={form.departmentId} onValueChange={(v) => setForm(f => ({ ...f, departmentId: v }))}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(departments ?? []).map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createUser.isPending}>
              {createUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ASSIGNABLE_ROLES: Array<{ value: string; label: string }> = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "agent", label: "Agent" },
  { value: "employee", label: "Employee" },
  { value: "external", label: "External" },
];

export default function Users() {
  const { user } = useAuthStore();
  const [roleFilter, setRoleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [actionUser, setActionUser] = useState<UserRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkRoleDialog, setBulkRoleDialog] = useState(false);
  const [bulkRole, setBulkRole] = useState("employee");
  const [bulkLoading, setBulkLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isSuperAdmin = user?.role === "super_admin";
  const isAdmin = user?.role === "admin";
  const canManage = isSuperAdmin || isAdmin || user?.departmentName?.toLowerCase() === "it";

  const assignableRoles = isSuperAdmin
    ? ASSIGNABLE_ROLES
    : ASSIGNABLE_ROLES.filter((r) => r.value !== "super_admin");

  const canChangeRole = (targetRole: string) => {
    if (isSuperAdmin) return true;
    if (isAdmin) return targetRole !== "super_admin";
    return false;
  };

  const apiCall = async (method: string, path: string, body?: object) => {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message ?? "Request failed");
    }
    return res.status === 204 ? null : res.json();
  };

  const handleToggleAccess = async (u: UserRow) => {
    setActionLoading(true);
    try {
      await apiCall("PATCH", `/api/users/${u.id}`, { isActive: !u.isActive });
      await refetchUsers();
      toast({ title: u.isActive ? "Access revoked" : "Access restored", description: `${u.name}'s access has been ${u.isActive ? "revoked" : "restored"}.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveFromDept = async (u: UserRow) => {
    setActionLoading(true);
    try {
      await apiCall("PATCH", `/api/users/${u.id}`, { departmentId: null });
      await refetchUsers();
      toast({ title: "Removed from department", description: `${u.name} has been removed from ${u.departmentName}.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleChangeRole = async (u: UserRow, newRole: string) => {
    setActionLoading(true);
    try {
      await apiCall("PATCH", `/api/users/${u.id}`, { role: newRole });
      await refetchUsers();
      const newLabel = ASSIGNABLE_ROLES.find((r) => r.value === newRole)?.label ?? newRole;
      toast({ title: "Role updated", description: `${u.name} is now ${newLabel}.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkChangeRole = async () => {
    if (!selected.size) return;
    setBulkLoading(true);
    try {
      const result = await apiCall("PATCH", "/api/users/bulk-role", { userIds: Array.from(selected), role: bulkRole });
      await refetchUsers();
      setSelected(new Set());
      setBulkRoleDialog(false);
      const roleLabel = ASSIGNABLE_ROLES.find((r) => r.value === bulkRole)?.label ?? bulkRole;
      toast({
        title: "Roles updated",
        description: `${result.updated} user(s) changed to ${roleLabel}${result.skipped > 0 ? `, ${result.skipped} skipped (insufficient permissions)` : ""}.`,
      });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkToggleAccess = async (activate: boolean) => {
    setBulkLoading(true);
    try {
      const ids = Array.from(selected);
      await Promise.all(ids.map((id) => apiCall("PATCH", `/api/users/${id}`, { isActive: activate })));
      await refetchUsers();
      setSelected(new Set());
      toast({ title: activate ? "Access restored" : "Access revoked", description: `${ids.length} user(s) updated.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!actionUser) return;
    setActionLoading(true);
    try {
      await apiCall("DELETE", `/api/users/${actionUser.id}`);
      await refetchUsers();
      toast({ title: "User deleted", description: `${actionUser.name} has been permanently deleted.` });
      setConfirmDelete(false);
      setActionUser(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const { data: users, isLoading, refetch: refetchUsers } = useListUsers({
    role: roleFilter as "agent" | "employee" | "manager" | "admin" | "super_admin" | "external" | undefined || undefined,
  });

  const filtered = (users ?? []).filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  const allSelected = filtered.length > 0 && filtered.every((u) => selected.has(u.id));
  const someSelected = selected.size > 0;

  return (
    <AppLayout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Users</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} users</p>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowBulk(true)}>
                <Upload className="h-4 w-4" />
                Bulk Upload
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" />
                Add User
              </Button>
            </div>
          )}
        </div>

        <div className="flex gap-2 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              className="pl-9 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="super_admin">Super Admin</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="employee">Employee</SelectItem>
              <SelectItem value="external">External</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Bulk actions bar */}
        {someSelected && (canManage) && (
          <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-lg">
            <CheckSquare className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground">{selected.size} user{selected.size !== 1 ? "s" : ""} selected</span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {(isSuperAdmin || isAdmin) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => { setBulkRole("employee"); setBulkRoleDialog(true); }}
                  disabled={bulkLoading}
                >
                  <UserCog className="h-3.5 w-3.5" />
                  Change Role
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 text-green-700 hover:bg-green-50"
                onClick={() => handleBulkToggleAccess(true)}
                disabled={bulkLoading}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Restore Access
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 text-orange-600 hover:bg-orange-50"
                onClick={() => handleBulkToggleAccess(false)}
                disabled={bulkLoading}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Revoke Access
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setSelected(new Set())}
                disabled={bulkLoading}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {canManage && (
                  <th className="w-10 px-3 py-2.5">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(c) => {
                        if (c) setSelected(new Set(filtered.map((u) => u.id)));
                        else setSelected(new Set());
                      }}
                    />
                  </th>
                )}
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">User</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Role</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Department</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Joined</th>
                {canManage && <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs uppercase tracking-wide">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {canManage && <td className="px-3 py-3"><Skeleton className="h-4 w-4" /></td>}
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-4 w-32" /></div></td>
                    <td className="px-4 py-3"><Skeleton className="h-5 w-20" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-5 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                    {canManage && <td className="px-4 py-3" />}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 5} className="px-6 py-12 text-center text-muted-foreground">
                    <UserCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No users found</p>
                  </td>
                </tr>
              ) : filtered.map((u) => {
                const roleCfg = roleConfig[u.role] ?? { label: u.role, color: "bg-gray-100 text-gray-600", icon: User };
                const RoleIcon = roleCfg.icon;
                const avatarColor = avatarColors[u.id % avatarColors.length];
                const isSelf = u.id === user?.id;
                const isChecked = selected.has(u.id);

                return (
                  <tr key={u.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${!u.isActive ? "opacity-60" : ""} ${isChecked ? "bg-primary/5" : ""}`}>
                    {canManage && (
                      <td className="px-3 py-3">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(c) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (c) next.add(u.id); else next.delete(u.id);
                              return next;
                            });
                          }}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className={`${avatarColor} text-white text-xs font-medium`}>
                            {u.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-foreground">{u.name}{isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${roleCfg.color}`}>
                        <RoleIcon className="h-3 w-3" />
                        {roleCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-muted-foreground">{u.departmentName ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? "bg-green-100 text-green-700 border border-green-200" : "bg-red-100 text-red-600 border border-red-200"}`}>
                        {u.isActive ? "Active" : "Revoked"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={actionLoading}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {/* Change Role submenu */}
                            {canChangeRole(u.role) && !isSelf && (
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger className="gap-2">
                                  <UserCog className="h-4 w-4" />
                                  Change Role
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-44">
                                  {assignableRoles.map((r) => (
                                    <DropdownMenuItem
                                      key={r.value}
                                      className={`gap-2 ${u.role === r.value ? "font-semibold text-primary" : ""}`}
                                      onClick={() => handleChangeRole(u as UserRow, r.value)}
                                      disabled={u.role === r.value}
                                    >
                                      {u.role === r.value && <span className="text-primary mr-1">✓</span>}
                                      {r.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            )}
                            <DropdownMenuSeparator />
                            {u.isActive ? (
                              <DropdownMenuItem
                                className="text-orange-600 focus:text-orange-700 focus:bg-orange-50 gap-2"
                                onClick={() => handleToggleAccess(u as UserRow)}
                                disabled={isSelf}
                              >
                                <ShieldOff className="h-4 w-4" />
                                Revoke Access
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                className="text-green-600 focus:text-green-700 focus:bg-green-50 gap-2"
                                onClick={() => handleToggleAccess(u as UserRow)}
                              >
                                <ShieldCheck className="h-4 w-4" />
                                Restore Access
                              </DropdownMenuItem>
                            )}
                            {u.departmentName && (
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => handleRemoveFromDept(u as UserRow)}
                              >
                                <UserMinus className="h-4 w-4" />
                                Remove from {u.departmentName}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive focus:bg-destructive/10 gap-2"
                              onClick={() => { setActionUser(u as UserRow); setConfirmDelete(true); }}
                              disabled={isSelf}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <CreateUserDialog open={showCreate} onClose={() => setShowCreate(false)} />
      <BulkUploadDialog open={showBulk} onClose={() => setShowBulk(false)} type="users" onSuccess={refetchUsers} />

      {/* Bulk Change Role Dialog */}
      <Dialog open={bulkRoleDialog} onOpenChange={(v) => !v && setBulkRoleDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Role for {selected.size} User{selected.size !== 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">Select the new role to assign to all selected users. Users you cannot manage (e.g. Super Admins) will be skipped automatically.</p>
            <Select value={bulkRole} onValueChange={setBulkRole}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkRoleDialog(false)} disabled={bulkLoading}>Cancel</Button>
            <Button onClick={handleBulkChangeRole} disabled={bulkLoading}>
              {bulkLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Apply to {selected.size} User{selected.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={(o) => { if (!o) { setConfirmDelete(false); setActionUser(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-semibold">{actionUser?.name}</span> ({actionUser?.email}) and all their associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={actionLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
