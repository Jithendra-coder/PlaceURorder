"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthField, AuthPasswordField, AuthPrimaryButton, AuthShell, AuthStatus } from "@/components/AuthShell";
import { AuthService } from "@/services/auth";

export default function ResetPasswordPage() {
  return <Suspense fallback={<AuthShell title="Choose a new password" description="Loading your secure reset form." />}><ResetPasswordForm /></Suspense>;
}

function ResetPasswordForm() {
  const queryToken = useSearchParams().get("token") || "";
  const router = useRouter();
  const [token, setToken] = useState(queryToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get("access_token");
    if (fragment.get("type") === "recovery" && accessToken) setToken(accessToken);
    if (fragment.get("error_description")) setError(fragment.get("error_description") || "This reset link has expired.");
    if (window.location.hash) window.history.replaceState({}, "", window.location.pathname + window.location.search);
  }, []);
  const passwordValid = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password);
  const valid = Boolean(token) && passwordValid && password === confirm;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await AuthService.resetPassword(token, password);
      router.replace("/auth/sign-in");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset the password.");
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" description="Use at least 8 characters, one uppercase letter, and one number.">
      <AuthStatus>{error || (!token ? "This reset link is invalid." : "")}</AuthStatus>
      <form onSubmit={submit} className="mt-auth-form">
        <AuthField id="password" label="New password" helper="Use at least 8 characters, including one uppercase letter and one number."><AuthPasswordField id="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} autoComplete="new-password" required /></AuthField>
        <AuthField id="confirm" label="Confirm new password" error={confirm && confirm !== password ? "The passwords do not match." : undefined}><AuthPasswordField id="confirm" value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={busy} invalid={Boolean(confirm && confirm !== password)} autoComplete="new-password" required /></AuthField>
        <div className="mt-auth-action"><AuthPrimaryButton type="submit" disabled={!valid} busy={busy}>Reset Password</AuthPrimaryButton></div>
      </form>
    </AuthShell>
  );
}
