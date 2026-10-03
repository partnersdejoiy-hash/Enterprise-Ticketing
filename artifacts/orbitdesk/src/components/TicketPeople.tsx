import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDirectory } from "@/lib/directory";
export function PeopleFields({
  raisedFor,
  setRaisedFor,
  tagged,
  setTagged,
  disabled = false,
}: {
  raisedFor: number | null;
  setRaisedFor: (id: number | null) => void;
  tagged: number[];
  setTagged: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const { data: people = [], isError } = useDirectory();
  return (
    <div className="people-fields">
      <label>
        Raised for an employee
        <select
          disabled={disabled}
          value={raisedFor ?? ""}
          onChange={(e) =>
            setRaisedFor(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">No linked employee</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.employeeId || p.departmentName || p.email}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tagged employees
        <select
          aria-label="Tagged employees"
          disabled={disabled}
          multiple
          value={tagged.map(String)}
          onChange={(e) =>
            setTagged([...e.target.selectedOptions].map((o) => Number(o.value)))
          }
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.departmentName || p.role}
            </option>
          ))}
        </select>
      </label>
      <p className="muted-copy">
        Linked employees and their reporting managers can view this ticket. Hold
        Ctrl or Command to select multiple employees.
      </p>
      {isError && <p role="alert">Could not load the employee directory.</p>}
    </div>
  );
}
export function TicketPeople({
  ticket,
  editable,
}: {
  ticket: {
    id: number;
    raisedForUserId?: number | null;
    taggedUserIds?: number[];
  };
  editable: boolean;
}) {
  const [raisedFor, setRaisedFor] = useState<number | null>(
    ticket.raisedForUserId ?? null,
  );
  const [tagged, setTagged] = useState<number[]>(ticket.taggedUserIds ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const cache = useQueryClient();
  const { data: people = [] } = useDirectory();
  useEffect(() => {
    setRaisedFor(ticket.raisedForUserId ?? null);
    setTagged(ticket.taggedUserIds ?? []);
  }, [ticket.id, ticket.raisedForUserId, JSON.stringify(ticket.taggedUserIds)]);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raisedForUserId: raisedFor,
          taggedUserIds: tagged,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await cache.invalidateQueries();
      setMessage("Employee access updated.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-panel ticket-people">
      <h2>People & visibility</h2>
      {editable ? (
        <>
          <PeopleFields
            raisedFor={raisedFor}
            setRaisedFor={setRaisedFor}
            tagged={tagged}
            setTagged={setTagged}
          />
          <button className="quiet-button" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save employee links"}
          </button>
        </>
      ) : (
        <p className="muted-copy">
          {[raisedFor, ...tagged]
            .filter(Boolean)
            .map(
              (id) =>
                people.find((p) => p.id === id)?.name || `Employee #${id}`,
            )
            .join(", ") || "No additional employees linked."}
        </p>
      )}
      {message && (
        <p role="status" className="muted-copy">
          {message}
        </p>
      )}
    </section>
  );
}
