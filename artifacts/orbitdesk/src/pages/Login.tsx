import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  Layers3,
  GitPullRequest,
  Loader2,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth";
export default function Login() {
  const cache = useQueryClient();
  const [, navigate] = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reset, setReset] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(
        reset ? "/api/auth/forgot-password" : "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ email, password }),
        },
      );
      const result = await res.json().catch(() => null);
      if (!result || typeof result !== "object")
        throw new Error("Sign-in service is temporarily unavailable. Please try again later.");
      if (!res.ok)
        throw new Error(
          result.message ||
            result.error ||
            "Unable to sign in. Please try again.",
        );
      if (reset) {
        setMessage(result.message);
        return;
      }
      cache.clear();
      setAuth(result.token, result.user);
      navigate(
        result.user.mustChangePassword ? "/change-password" : "/dashboard",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="orbit-login">
      <section className="login-story">
        <div className="login-brand">
          <img src="/dejoiy-official-logo.png" alt="DEJOIY — Your Joy" />
          <span>
            OrbitDesk<span>SERVICE OPERATIONS</span>
          </span>
        </div>
        <div className="login-story-copy">
          <p className="eyebrow">A CONNECTED WORKSPACE</p>
          <h1>
            Good work.
            <br />
            Great service.
            <br />
            <em>One orbit.</em>
          </h1>
          <p>
            A clear path from the first request to the final resolution. Built
            for the people behind every experience.
          </p>
          <div className="login-capabilities">
            <span>
              <Layers3 size={18} /> Connected queues
            </span>
            <span>
              <GitPullRequest size={18} /> Clear ownership
            </span>
            <span>
              <ShieldCheck size={18} /> Private evidence
            </span>
          </div>
        </div>
        <div className="login-orbits" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <footer>DEJOIY · People. Purpose. Possibility.</footer>
      </section>
      <section className="login-form-side">
        <div className="login-form-wrap">
          <span className="login-secure">
            <ShieldCheck size={15} /> TEAM WORKSPACE
          </span>
          <h2>{reset ? "Recover access" : "Welcome back."}</h2>
          <p>
            {reset
              ? "Ask your administrator to help restore your account."
              : "Sign in to keep good work moving."}
          </p>
          <form onSubmit={submit}>
            <label htmlFor="work-email">Work email</label>
            <input
              id="work-email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@dejoiy.com"
            />
            {!reset && (
              <>
                <div className="password-label">
                  <label htmlFor="work-password">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setReset(true);
                      setError("");
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="password-field">
                  <input
                    id="work-password"
                    type={visible ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    maxLength={1024}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={visible ? "Hide password" : "Show password"}
                    onClick={() => setVisible((v) => !v)}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </>
            )}
            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="login-confirmation" role="status">
                {message}
              </p>
            )}
            <button className="primary-action login-submit" disabled={busy}>
              {busy ? (
                <Loader2 size={18} className="animate-spin" />
              ) : reset ? (
                "Request account help"
              ) : (
                "Enter workspace"
              )}
              <ArrowRight size={18} />
            </button>
            {reset && (
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  setReset(false);
                  setError("");
                  setMessage("");
                }}
              >
                Back to sign in
              </button>
            )}
          </form>
          <p className="login-note">
            <ShieldCheck size={16} /> For authorised DEJOIY team members. Access
            is limited by role and department.
          </p>
        </div>
        <footer>
          © {new Date().getFullYear()} DEJOIY. All rights reserved.
        </footer>
      </section>
    </main>
  );
}
