import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Plane,
} from "lucide-react";
import App from "./App";
import { supabase } from "./supabase";
import { authRedirectUrl, isPasswordRecovery } from "./auth-utils";
import "./Auth.css";

type AuthMode = "signin" | "signup" | "forgot";

export default function Auth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [mode, setMode] = useState<AuthMode>("signin");
  const [recovery, setRecovery] = useState(() =>
    isPasswordRecovery(window.location.href),
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    let receivedEvent = false;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, currentSession) => {
      if (!active) return;
      receivedEvent = true;
      setSession(currentSession);
      setLoading(false);
      setPassword("");
      setConfirmation("");
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") {
        setRecovery(false);
        setMode("signin");
        setMessage("");
      }
    });
    client.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;
        if (!receivedEvent) setSession(data.session);
        if (sessionError) setError(sessionError.message);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(
          "Couldn't restore your session. Check your connection and try again.",
        );
        setLoading(false);
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [retry]);

  function changeMode(next: AuthMode) {
    setMode(next);
    setError("");
    setMessage("");
    setPassword("");
    setConfirmation("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = supabase;
    if (!client || busy) return;
    setError("");
    setMessage("");
    if (recovery && session && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (recovery && session) {
        const { error: authError } = await client.auth.updateUser({ password });
        if (authError) throw authError;
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("mode");
        cleanUrl.searchParams.delete("type");
        cleanUrl.searchParams.delete("code");
        cleanUrl.hash = "";
        window.history.replaceState(
          {},
          "",
          cleanUrl.pathname + cleanUrl.search,
        );
        setRecovery(false);
        setPassword("");
        setConfirmation("");
      } else if (mode === "forgot") {
        const { error: authError } = await client.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: authRedirectUrl(
              window.location.origin,
              import.meta.env.BASE_URL,
              true,
            ),
          },
        );
        if (authError) throw authError;
        setMessage(
          "If an account exists for this email, you'll receive a password reset link.",
        );
      } else if (mode === "signup") {
        const { data, error: authError } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: authRedirectUrl(
              window.location.origin,
              import.meta.env.BASE_URL,
            ),
          },
        });
        if (authError) throw authError;
        if (!data.session) {
          setMessage("Check your email to confirm your account, then sign in.");
          setPassword("");
        }
      } else {
        const { error: authError } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signOut({
        scope: "local",
      });
      if (authError) throw authError;
      setSession(null);
      setEmail("");
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't sign out. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (session && !recovery)
    return (
      <App
        key={session.user.id}
        userId={session.user.id}
        userEmail={session.user.email || "Your account"}
        onSignOut={signOut}
        signingOut={busy}
        authError={error}
      />
    );

  const resetting = recovery && Boolean(session);
  const title = resetting
    ? "Choose a new password"
    : mode === "signup"
      ? "Join the adventure"
      : mode === "forgot"
        ? "Reset your password"
        : "Welcome back";

  return (
    <main className="auth-page">
      <a
        className="brand auth-brand"
        href={import.meta.env.BASE_URL}
        aria-label="Triply home"
      >
        <span className="brand-icon">
          <Plane size={21} />
        </span>
        triply<span className="brand-dot">.</span>
      </a>
      {loading ? (
        <section className="auth-panel auth-loading" role="status">
          <LoaderCircle className="auth-spinner" size={26} />
          <p>Restoring your session...</p>
        </section>
      ) : (
        <section className="auth-panel">
          <div className="auth-symbol">
            <LockKeyhole size={22} />
          </div>
          <h1>{title}</h1>
          {!supabase ? (
            <>
              <p className="auth-description">
                Authentication isn't configured yet.
              </p>
              <div className="warning">
                Add the Supabase project URL and public key to the environment,
                then restart the app.
              </div>
            </>
          ) : (
            <>
              {!resetting && mode !== "forgot" && (
                <div className="auth-modes" aria-label="Account access">
                  <button
                    type="button"
                    className={mode === "signin" ? "selected" : ""}
                    aria-pressed={mode === "signin"}
                    disabled={busy}
                    onClick={() => changeMode("signin")}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className={mode === "signup" ? "selected" : ""}
                    aria-pressed={mode === "signup"}
                    disabled={busy}
                    onClick={() => changeMode("signup")}
                  >
                    Create account
                  </button>
                </div>
              )}
              {recovery && !session && (
                <p className="warning">
                  This reset link is invalid or expired. Request a new link
                  below.
                </p>
              )}
              <form className="auth-form" onSubmit={submit}>
                {!resetting && (
                  <label htmlFor="auth-email">
                    Email
                    <input
                      id="auth-email"
                      type="email"
                      autoComplete="email"
                      required
                      autoFocus
                      value={email}
                      disabled={busy}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                )}
                {(resetting || mode !== "forgot") && (
                  <label htmlFor="auth-password">
                    {resetting ? "New password" : "Password"}
                    <div className="auth-password">
                      <input
                        id="auth-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete={
                          mode === "signup" || resetting
                            ? "new-password"
                            : "current-password"
                        }
                        required
                        minLength={mode === "signup" || resetting ? 6 : 1}
                        value={password}
                        disabled={busy}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                      <button
                        className="icon-button"
                        type="button"
                        title={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff size={17} />
                        ) : (
                          <Eye size={17} />
                        )}
                      </button>
                    </div>
                  </label>
                )}
                {resetting && (
                  <label htmlFor="auth-confirmation">
                    Confirm new password
                    <input
                      id="auth-confirmation"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={6}
                      value={confirmation}
                      disabled={busy}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </label>
                )}
                {mode === "signup" && !resetting && (
                  <span className="field-hint">At least 6 characters.</span>
                )}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                {message && (
                  <p className="auth-success" role="status">
                    <Check size={16} />
                    {message}
                  </p>
                )}
                <button
                  className="button primary auth-submit"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle className="auth-spinner" size={17} />
                  ) : (
                    <ArrowRight size={17} />
                  )}
                  {busy
                    ? "Please wait..."
                    : resetting
                      ? "Update password"
                      : mode === "signup"
                        ? "Create account"
                        : mode === "forgot"
                          ? "Send reset link"
                          : "Sign in"}
                </button>
              </form>
              {!resetting &&
                (mode === "forgot" ? (
                  <button
                    className="auth-text-button"
                    disabled={busy}
                    onClick={() => {
                      setRecovery(false);
                      changeMode("signin");
                    }}
                  >
                    <ArrowLeft size={14} /> Back to sign in
                  </button>
                ) : (
                  <button
                    className="auth-text-button"
                    disabled={busy}
                    onClick={() => changeMode("forgot")}
                  >
                    Forgot password?
                  </button>
                ))}
              {error && (
                <button
                  className="auth-text-button"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setLoading(true);
                    setRetry((value) => value + 1);
                  }}
                >
                  Retry session check
                </button>
              )}
            </>
          )}
        </section>
      )}
      <p className="auth-footer">Good company. Shared adventures.</p>
    </main>
  );
}
