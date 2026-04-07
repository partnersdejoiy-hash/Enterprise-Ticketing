import React, { useState } from "react";
import { useListUsers } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, UserCircle2, ShieldAlert, Shield, UserCog, User, UserCheck, ExternalLink } from "lucide-react";

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

export default function Users() {
  const [roleFilter, setRoleFilter] = useState("");
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useListUsers({
    role: roleFilter as "agent" | "employee" | "manager" | "admin" | "super_admin" | "external" | undefined || undefined,
  });

  const filtered = (users ?? []).filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Users</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} users</p>
          </div>
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

        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">User</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Role</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Department</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">Joined</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-4 w-32" /></div></td>
                    <td className="px-4 py-3"><Skeleton className="h-5 w-20" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-5 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                    <UserCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p>No users found</p>
                  </td>
                </tr>
              ) : filtered.map((user, idx) => {
                const roleCfg = roleConfig[user.role] ?? { label: user.role, color: "bg-gray-100 text-gray-600", icon: User };
                const RoleIcon = roleCfg.icon;
                const avatarColor = avatarColors[user.id % avatarColors.length];

                return (
                  <tr key={user.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className={`${avatarColor} text-white text-xs font-medium`}>
                            {user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-foreground">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
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
                      <span className="text-muted-foreground">{user.departmentName ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${user.isActive ? "bg-green-100 text-green-700 border border-green-200" : "bg-gray-100 text-gray-600 border border-gray-200"}`}>
                        {user.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
