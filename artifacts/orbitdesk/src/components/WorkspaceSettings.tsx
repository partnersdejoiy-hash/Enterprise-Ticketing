import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuthStore } from "@/lib/auth";
const defaults = {
  assigned: true,
  updates: true,
  comments: true,
  sla: false,
  digest: false,
};
export function PersonalSettings({
  notificationsOnly = false,
}: {
  notificationsOnly?: boolean;
}) {
  const { updateUser } = useAuthStore();
  const [saved, setSaved] = useState<any>(null),
    [draft, setDraft] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/settings/workspace/me")
      .then(async (r) => {
        if (!r.ok) throw Error("Could not load preferences");
        return r.json();
      })
      .then((v) => {
        if (live) {
          setSaved(v);
          setDraft(v);
        }
      })
      .catch((e) => setMessage(e.message));
    return () => {
      live = false;
    };
  }, []);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/settings/workspace/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          notificationsOnly
            ? { notifications: draft.notifications }
            : { name: draft.name },
        ),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error || "Save failed");
      setSaved(v);
      setDraft(v);
      updateUser({ name: v.name });
      setMessage("Saved to your account. Preferences remain after refresh.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {notificationsOnly ? "Notification preferences" : "Your profile"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!draft ? (
          <p role="status">{message || "Loading saved settings…"}</p>
        ) : (
          <>
            {notificationsOnly ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Choose which ticket emails you receive. Delivery also requires
                  a working email provider.
                </p>
                {Object.entries({
                  assigned: "Ticket assigned to me",
                  updates: "Ticket status updates",
                  comments: "New replies",
                  sla: "SLA review alerts (on ticket updates)",
                  digest: "Daily digest — scheduling not enabled",
                }).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-4 rounded-lg border p-3"
                  >
                    <span className="text-sm">{label}</span>
                    <Switch
                      aria-label={label}
                      checked={
                        draft.notifications[key] ??
                        defaults[key as keyof typeof defaults]
                      }
                      disabled={busy || key === "digest"}
                      onCheckedChange={(v) => {
                        setDraft({
                          ...draft,
                          notifications: { ...draft.notifications, [key]: v },
                        });
                        setMessage("");
                      }}
                    />
                  </label>
                ))}
              </>
            ) : (
              <>
                <label className="block space-y-2">
                  <span>Full name</span>
                  <Input
                    value={draft.name}
                    maxLength={150}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </label>
                <label className="block space-y-2">
                  <span>Work email</span>
                  <Input value={draft.email} readOnly />
                  <span className="text-xs text-muted-foreground">
                    An administrator manages your sign-in email.
                  </span>
                </label>
                <Link
                  href="/change-password"
                  className="inline-block text-sm text-primary underline"
                >
                  Change password securely
                </Link>
              </>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button onClick={save} disabled={busy || !dirty}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(saved);
                  setMessage("");
                }}
                disabled={busy || !dirty}
              >
                Discard
              </Button>
              <span className="text-sm text-muted-foreground">
                {dirty ? "Unsaved changes" : "All changes saved"}
              </span>
            </div>
            {message && (
              <p role="status" className="text-sm">
                {message}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
export function RoutingSettingsPanel() {
  const [saved, setSaved] = useState<any>(null),
    [draft, setDraft] = useState<any>(null),
    [departments, setDepartments] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      fetch("/api/settings/workspace/routing"),
      fetch("/api/departments"),
    ])
      .then(async ([r, d]) => {
        if (!r.ok || !d.ok) throw Error("Could not load routing settings");
        const v = await r.json(),
          ds = await d.json();
        setSaved(v);
        setDraft(v);
        setDepartments(
          Array.isArray(ds) ? ds : ds.data || ds.departments || [],
        );
      })
      .catch((e) => setMessage(e.message));
  }, []);
  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/settings/workspace/routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error || "Save failed");
      setSaved(v);
      setDraft(v);
      setMessage(
        "Routing saved. Applies to new requests; existing tickets stay unchanged.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team routing & automation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Verification requests stay inside the selected handling team. Active
          agents and managers receive work by smallest open queue; no eligible
          handler means the department queue keeps the ticket.
        </p>
        {draft && (
          <>
            {(["bgvDepartmentId", "employmentDepartmentId"] as const).map(
              (key, i) => (
                <label className="block space-y-2" key={key}>
                  <span>{i ? "Employment verification team" : "BGV team"}</span>
                  <select
                    className="w-full rounded-lg border bg-background p-3"
                    value={draft[key] ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [key]: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">Admin triage only</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              ),
            )}
            {Object.entries({
              autoAssign: "Automatically assign within the handling team",
              automationEnabled: "Run active automation rules",
            }).map(([key, label]) => (
              <label
                key={key}
                className="flex justify-between gap-4 border-t pt-3"
              >
                <span>{label}</span>
                <Switch
                  aria-label={label}
                  checked={draft[key]}
                  disabled={busy}
                  onCheckedChange={(v) => setDraft({ ...draft, [key]: v })}
                />
              </label>
            ))}
            <div className="flex gap-3">
              <Button
                disabled={
                  busy || JSON.stringify(draft) === JSON.stringify(saved)
                }
                onClick={save}
              >
                {busy ? "Saving…" : "Save routing"}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDraft(saved)}
              >
                Discard
              </Button>
            </div>
          </>
        )}
        {message && <p role="status">{message}</p>}
      </CardContent>
    </Card>
  );
}
