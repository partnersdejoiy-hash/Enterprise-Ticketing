import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth";

export interface RolePermissions {
  id?: number;
  role: string;
  canCreateTicket: boolean;
  canViewAllTickets: boolean;
  canCloseTicket: boolean;
  canAssignTickets: boolean;
  canDeleteTickets: boolean;
  canBulkUpload: boolean;
  canExportData: boolean;
  canViewReports: boolean;
  canManageDepartments: boolean;
  canManageUsers: boolean;
  canRequestDocuments: boolean;
}

const SUPER_ADMIN_DEFAULTS: RolePermissions = {
  role: "super_admin",
  canCreateTicket: true, canViewAllTickets: true, canCloseTicket: true,
  canAssignTickets: true, canDeleteTickets: true, canBulkUpload: true,
  canExportData: true, canViewReports: true, canManageDepartments: true,
  canManageUsers: true, canRequestDocuments: true,
};

async function fetchMyPermissions(token: string | null): Promise<RolePermissions> {
  const res = await fetch("/api/role-permissions/my", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch permissions");
  return res.json();
}

export function useMyPermissions(): { perms: RolePermissions; isLoading: boolean } {
  const { token, user } = useAuthStore();

  const { data, isLoading } = useQuery<RolePermissions>({
    queryKey: ["role-permissions", "my", user?.role],
    queryFn: () => fetchMyPermissions(token),
    enabled: !!token && !!user,
    staleTime: 60_000,
    placeholderData: SUPER_ADMIN_DEFAULTS,
  });

  // Super admins always have all permissions regardless of DB
  if (user?.role === "super_admin") {
    return { perms: SUPER_ADMIN_DEFAULTS, isLoading: false };
  }

  return { perms: data ?? SUPER_ADMIN_DEFAULTS, isLoading };
}

async function fetchAllPermissions(token: string | null): Promise<RolePermissions[]> {
  const res = await fetch("/api/role-permissions", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch permissions");
  return res.json();
}

export function useAllPermissions() {
  const { token, user } = useAuthStore();
  const canManage = user?.role === "super_admin" || user?.role === "admin";

  return useQuery<RolePermissions[]>({
    queryKey: ["role-permissions", "all"],
    queryFn: () => fetchAllPermissions(token),
    enabled: !!token && canManage,
    staleTime: 30_000,
  });
}
