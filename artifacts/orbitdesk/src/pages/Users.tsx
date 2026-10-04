import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListDepartments } from "@workspace/api-client-react";
import { Plus, Users as UsersIcon, Search, Upload } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BulkUploadDialog } from "@/components/BulkUploadDialog";
import { useAuthStore } from "@/lib/auth";
import { readApi } from "@/lib/operations";
interface Person {
  id: number;
  name: string;
  email: string;
  role: string;
  departmentId: number | null;
  departmentName: string | null;
  managerId: number | null;
  managerName: string | null;
  teamName: string | null;
  employeeId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
}
const labels: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
  employee: "Employee",
  external: "External",
};
export default function Users() {
  const user = useAuthStore((s) => s.user);
  const admin = ["admin", "super_admin"].includes(user?.role ?? "");
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["/api/users", user?.id],
    queryFn: () => readApi<Person[]>("/api/users"),
  });
  const { data: departments = [] } = useListDepartments();
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("");
  const [selected, setSelected] = useState<Person | null>(null);
  const [create, setCreate] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const blank = {
    name: "",
    email: "",
    password: "",
    role: "employee",
    departmentId: "",
    managerId: "",
    teamName: "",
    employeeId: "",
    isActive: true,
  };
  const [form, setForm] = useState(blank);
  const people = query.data ?? [];
  const visible = people.filter(
    (p) =>
      (!dept || String(p.departmentId) === dept) &&
      [p.name, p.email, p.employeeId, p.teamName]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  function edit(p: Person) {
    setSelected(p);
    setCreate(false);
    setError("");
    setForm({
      name: p.name,
      email: p.email,
      password: "",
      role: p.role,
      departmentId: String(p.departmentId ?? ""),
      managerId: String(p.managerId ?? ""),
      teamName: p.teamName ?? "",
      employeeId: p.employeeId ?? "",
      isActive: p.isActive,
    });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = create
        ? {
            name: form.name,
            email: form.email,
            password: form.password,
            role: form.role,
            departmentId: form.departmentId ? Number(form.departmentId) : null,
          }
        : {
            departmentId: form.departmentId ? Number(form.departmentId) : null,
            managerId: form.managerId ? Number(form.managerId) : null,
            teamName: form.teamName || null,
            ...(admin
              ? {
                  name: form.name,
                  role: form.role,
                  employeeId: form.employeeId || null,
                  isActive: form.isActive,
                }
              : {}),
            ...(form.password ? { newPassword: form.password } : {}),
          };
      const response = await fetch(
        create ? "/api/users" : `/api/users/${selected!.id}`,
        {
          method: create ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save");
      await cache.invalidateQueries();
      setSelected(null);
      setCreate(false);
      setSaved(
        create
          ? "Account created. First login requires a password change."
          : "User access and reporting relationships updated.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppLayout>
      <div className="workspace-page">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">PEOPLE & ACCESS</p>
            <h1>The right people. Connected.</h1>
            <p>Manage departments, reporting lines and workspace access.</p>
          </div>
          <div className="people-actions">
            {admin && (
              <button className="quiet-button" onClick={() => setBulk(true)}>
                <Upload size={15} />
                Import
              </button>
            )}
            <button
              className="primary-action"
              onClick={() => {
                setForm(blank);
                setCreate(true);
                setSelected(null);
                setError("");
              }}
            >
              <Plus size={16} />
              Add user
            </button>
          </div>
        </div>
        {saved && (
          <p role="status" className="login-confirmation">
            {saved}
          </p>
        )}
        {query.isError ? (
          <div className="workspace-error" role="alert">
            Unable to load users. {query.error.message}
          </div>
        ) : (
          <section className="workspace-panel">
            <div className="queue-toolbar">
              <label className="queue-search">
                <Search size={18} />
                <input
                  aria-label="Search people"
                  placeholder="Search people, employee IDs or teams…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <select
                aria-label="Filter people by department"
                value={dept}
                onChange={(e) => setDept(e.target.value)}
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="work-table-wrap">
              <table className="work-table people-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role / access</th>
                    <th>Department / team</th>
                    <th>Reports to</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <small>{p.email}</small>
                        <small>{p.employeeId || "Employee ID not set"}</small>
                      </td>
                      <td>
                        {labels[p.role]}
                        <small>
                          {p.isActive
                            ? p.mustChangePassword
                              ? "Password change required"
                              : "Active"
                            : "Access revoked"}
                        </small>
                      </td>
                      <td>
                        {p.departmentName || "Unassigned"}
                        <small>{p.teamName || "No team label"}</small>
                      </td>
                      <td>{p.managerName || "No reporting manager"}</td>
                      <td>
                        <button
                          className="quiet-button"
                          disabled={
                            (user?.role !== "super_admin" &&
                              p.role === "super_admin") ||
                            (!admin &&
                              ["admin", "super_admin"].includes(p.role))
                          }
                          onClick={() => edit(p)}
                          aria-label={`Manage ${p.name}`}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && (
                <div className="workspace-empty">
                  <UsersIcon />
                  <p>
                    {query.isLoading
                      ? "Loading your directory…"
                      : "No people match these filters."}
                  </p>
                </div>
              )}
            </div>
            <div className="panel-footnote">
              {visible.length} people · Reporting managers inherit team ticket
              visibility. Team labels help organise the directory.
            </div>
          </section>
        )}
        <Dialog
          open={create || !!selected}
          onOpenChange={(open) => {
            if (!open) {
              setCreate(false);
              setSelected(null);
            }
          }}
        >
          <DialogContent className="max-h-[90svh] overflow-auto">
            <DialogHeader>
              <DialogTitle>
                {create ? "Add a teammate" : `Manage ${selected?.name}`}
              </DialogTitle>
              <DialogDescription>
                {create
                  ? "Create an account with a temporary password."
                  : "Changes take effect on the next request and are recorded in the access history."}
              </DialogDescription>
            </DialogHeader>
            <form className="people-admin-form" onSubmit={save}>
              {(create || admin) && (
                <label>
                  Full name
                  <input
                    required
                    maxLength={150}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
              )}
              {create && (
                <label>
                  Work email
                  <input
                    type="email"
                    required
                    maxLength={254}
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                  />
                </label>
              )}
              {(create || admin) && (
                <label>
                  Role
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                  >
                    {Object.entries(labels)
                      .filter(
                        ([r]) =>
                          user?.role === "super_admin" ||
                          (admin
                            ? r !== "super_admin"
                            : !["super_admin", "admin"].includes(r)),
                      )
                      .map(([r, label]) => (
                        <option key={r} value={r}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Department
                <select
                  value={form.departmentId}
                  onChange={(e) =>
                    setForm({ ...form, departmentId: e.target.value })
                  }
                >
                  <option value="">No department</option>
                  {departments.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              {!create && (
                <>
                  <label>
                    Reporting manager
                    <select
                      value={form.managerId}
                      onChange={(e) =>
                        setForm({ ...form, managerId: e.target.value })
                      }
                    >
                      <option value="">No reporting manager</option>
                      {people
                        .filter(
                          (p) =>
                            p.id !== selected?.id &&
                            p.isActive &&
                            !["employee", "external"].includes(p.role),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.departmentName || labels[p.role]}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Team name
                    <input
                      maxLength={150}
                      placeholder="e.g. BGV — India"
                      value={form.teamName}
                      onChange={(e) =>
                        setForm({ ...form, teamName: e.target.value })
                      }
                    />
                  </label>
                  {admin && (
                    <>
                      <label>
                        Employee ID
                        <input
                          maxLength={150}
                          value={form.employeeId}
                          onChange={(e) =>
                            setForm({ ...form, employeeId: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Workspace access
                        <select
                          disabled={selected?.id === user?.id}
                          value={String(form.isActive)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              isActive: e.target.value === "true",
                            })
                          }
                        >
                          <option value="true">Active</option>
                          <option value="false">Revoked</option>
                        </select>
                      </label>
                    </>
                  )}
                </>
              )}
              <label>
                {create
                  ? "Temporary password"
                  : "Reset temporary password (optional)"}
                <input
                  type="password"
                  autoComplete="new-password"
                  required={create}
                  minLength={12}
                  maxLength={1024}
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </label>
              <p className="muted-copy">
                At least 12 characters. Every new or reset account must change
                its password before using the workspace. Revoking access
                preserves ticket history.
              </p>
              {error && <p role="alert">{error}</p>}
              <button className="primary-action" disabled={busy}>
                {busy ? "Saving…" : create ? "Create account" : "Save changes"}
              </button>
            </form>
          </DialogContent>
        </Dialog>
        {admin && (
          <BulkUploadDialog
            open={bulk}
            onClose={() => setBulk(false)}
            type="users"
            onSuccess={() => query.refetch()}
          />
        )}
      </div>
    </AppLayout>
  );
}
