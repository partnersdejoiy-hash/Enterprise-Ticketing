import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useAuthStore } from "@/lib/auth";
export default function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const { user, logout } = useAuthStore();
  const [, navigate] = useLocation();
  const cache = useQueryClient();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      cache.clear();
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="password-page">
      <div className="password-card">
        <img src="/dejoiy-official-logo.png" alt="DEJOIY" />
        <span className="login-secure">
          <ShieldCheck size={16} /> YOUR ACCOUNT, PROTECTED
        </span>
        <h1>{done ? "You’re all set." : "Make this account yours."}</h1>
        <p>
          {done
            ? "Your password has changed and previous sessions have ended."
            : `${user?.name?.split(" ")[0] || "Welcome"}, replace your temporary password before entering the workspace.`}
        </p>
        {done ? (
          <button
            className="primary-action"
            onClick={() => {
              logout();
              navigate("/");
            }}
          >
            Sign in with new password
          </button>
        ) : (
          <form onSubmit={submit}>
            {[
              {
                label: "Current password",
                value: current,
                set: setCurrent,
                auto: "current-password",
              },
              {
                label: "New password",
                value: next,
                set: setNext,
                auto: "new-password",
              },
              {
                label: "Confirm new password",
                value: confirm,
                set: setConfirm,
                auto: "new-password",
              },
            ].map((f, i) => (
              <label key={f.label}>
                {f.label}
                <input
                  type="password"
                  autoComplete={f.auto}
                  required
                  minLength={i ? 12 : 1}
                  maxLength={1024}
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                />
              </label>
            ))}
            <p className="muted-copy">
              Use at least 12 characters. Choose a password you haven’t used for
              this account.
            </p>
            {error && (
              <p role="alert" className="login-error">
                {error}
              </p>
            )}
            <button className="primary-action" disabled={busy}>
              {busy ? "Saving…" : "Save new password"}
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                logout();
                navigate("/");
              }}
            >
              Sign out
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
