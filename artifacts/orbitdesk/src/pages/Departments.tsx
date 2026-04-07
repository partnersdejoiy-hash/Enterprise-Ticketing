import React, { useState } from "react";
import { useListDepartments, useCreateDepartment } from "@workspace/api-client-react";
import { BulkUploadDialog } from "@/components/BulkUploadDialog";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Monitor, Users, ShieldCheck, Building2, Scale,
  DollarSign, Cog, Headphones, Clock, TicketIcon, UserCheck, Plus, Upload, Loader2, Trash2
} from "lucide-react";

const iconMap: Record<string, React.ElementType> = {
  Monitor, Users, ShieldCheck, Building2, Scale,
  DollarSign, Cog, Headphones, HeadphonesIcon: Headphones,
};

const defaultColors = [
  "#3B82F6", "#8B5CF6", "#F59E0B", "#10B981",
  "#EF4444", "#06B6D4", "#F97316", "#EC4899",
];

const colorPalette = [
  "#3B82F6", "#8B5CF6", "#F59E0B", "#10B981",
  "#EF4444", "#06B6D4", "#F97316", "#EC4899",
  "#6366F1", "#14B8A6", "#A855F7", "#F43F5E",
];

function CreateDepartmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createDept = useCreateDepartment();

  const [form, setForm] = useState({
    name: "",
    description: "",
    color: "#3B82F6",
    slaResponseHours: "4",
    slaResolutionHours: "24",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Validation error", description: "Department name is required", variant: "destructive" });
      return;
    }
    createDept.mutate({
      data: {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        color: form.color,
        slaResponseHours: parseInt(form.slaResponseHours) || 4,
        slaResolutionHours: parseInt(form.slaResolutionHours) || 24,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Department created", description: `${form.name} has been added` });
        queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
        setForm({ name: "", description: "", color: "#3B82F6", slaResponseHours: "4", slaResolutionHours: "24" });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: "Failed to create department", description: err?.data?.message ?? "Something went wrong", variant: "destructive" });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Department</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="d-name">Department Name <span className="text-red-500">*</span></Label>
            <Input id="d-name" placeholder="e.g. Engineering" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-desc">Description</Label>
            <Input id="d-desc" placeholder="Short description (optional)" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex gap-2 flex-wrap">
              {colorPalette.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? "scale-125 ring-2 ring-offset-1 ring-gray-400" : "hover:scale-110"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-sla-res">Response SLA (hours)</Label>
              <Input id="d-sla-res" type="number" min="1" placeholder="4" value={form.slaResponseHours} onChange={(e) => setForm(f => ({ ...f, slaResponseHours: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-sla-resol">Resolution SLA (hours)</Label>
              <Input id="d-sla-resol" type="number" min="1" placeholder="24" value={form.slaResolutionHours} onChange={(e) => setForm(f => ({ ...f, slaResolutionHours: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createDept.isPending}>
              {createDept.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Department
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Departments() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const { data: departments, isLoading, refetch: refetchDepts } = useListDepartments();
  const [deleteDept, setDeleteDept] = useState<{ id: number; name: string } | null>(null);
  const [deletingDept, setDeletingDept] = useState(false);

  const canManage = user?.role === "super_admin" || user?.role === "admin" ||
    user?.departmentName?.toLowerCase() === "it";
  const canDelete = user?.role === "super_admin" || user?.role === "admin";

  const handleDeleteDept = async () => {
    if (!deleteDept) return;
    setDeletingDept(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/departments/${deleteDept.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to delete department");
      await queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      toast({ title: "Department deleted", description: `"${deleteDept.name}" has been permanently deleted` });
      setDeleteDept(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setDeletingDept(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Departments</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {departments?.length ?? 0} departments configured
            </p>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowBulk(true)}>
                <Upload className="h-4 w-4" />
                Bulk Upload
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" />
                Add Department
              </Button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {(departments ?? []).map((dept, idx) => {
              const color = dept.color ?? defaultColors[idx % defaultColors.length];
              const IconComponent = dept.icon ? (iconMap[dept.icon] ?? Building2) : Building2;

              return (
                <div
                  key={dept.id}
                  className="bg-card border border-border rounded-lg p-5 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${color}1A`, border: `1px solid ${color}30` }}
                      >
                        <IconComponent className="h-5 w-5" style={{ color }} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground text-sm">{dept.name}</h3>
                        {dept.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{dept.description}</p>
                        )}
                      </div>
                    </div>
                    {canDelete && (
                      <button
                        title="Delete department"
                        onClick={() => setDeleteDept({ id: dept.id, name: dept.name })}
                        className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                        <TicketIcon className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-lg font-bold text-foreground">{dept.openTicketCount}</p>
                      <p className="text-xs text-muted-foreground">Open</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                        <UserCheck className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-lg font-bold text-foreground">{dept.agentCount}</p>
                      <p className="text-xs text-muted-foreground">Agents</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                        <Clock className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-lg font-bold text-foreground">{dept.slaResolutionHours}h</p>
                      <p className="text-xs text-muted-foreground">SLA</p>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Response SLA: <span className="font-medium text-foreground">{dept.slaResponseHours}h</span></span>
                      <span>Resolution SLA: <span className="font-medium text-foreground">{dept.slaResolutionHours}h</span></span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CreateDepartmentDialog open={showCreate} onClose={() => setShowCreate(false)} />
      <BulkUploadDialog open={showBulk} onClose={() => setShowBulk(false)} type="departments" onSuccess={refetchDepts} />

      <AlertDialog open={!!deleteDept} onOpenChange={(open) => !open && setDeleteDept(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Department</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete the <strong>{deleteDept?.name}</strong> department? All users and tickets in this department will be unassigned. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingDept}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteDept}
              disabled={deletingDept}
            >
              {deletingDept ? "Deleting…" : "Delete Department"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
