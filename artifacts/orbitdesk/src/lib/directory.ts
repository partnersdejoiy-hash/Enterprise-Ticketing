import { useQuery } from "@tanstack/react-query";
import { readApi } from "./operations";
import { useAuthStore } from "./auth";
export interface DirectoryUser {
  id: number;
  name: string;
  email: string;
  role: string;
  departmentId: number | null;
  departmentName: string | null;
  employeeId: string | null;
  managerId: number | null;
  teamName: string | null;
  isActive: boolean;
}
export function useDirectory(
  params: { role?: string; departmentId?: number } = {},
) {
  const user = useAuthStore((s) => s.user);
  const query = new URLSearchParams();
  if (params.role) query.set("role", params.role);
  if (params.departmentId)
    query.set("departmentId", String(params.departmentId));
  return useQuery({
    queryKey: ["directory", user?.id, params],
    queryFn: () => readApi<DirectoryUser[]>("/api/directory?" + query),
  });
}
