"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { AuthNotice, AuthPasswordField, AuthShell, AuthSubmit } from "@/components/AuthShell";
import { AuthService } from "@/services/auth";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShell title="Choose a new password" description="Loading your secure reset form." />}>
      <ResetPasswordForm />
    </Suspense>
  );
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
    const timer = window.setTimeout(() => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = fragment.get("access_token");
      if (fragment.get("type") === "recovery" && accessToken) setToken(accessToken);
      if (fragment.get("error_description")) setError(fragment.get("error_description") || "This reset link has expired.");
      if (window.location.hash) window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const passwordValid = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password);
  const mismatch = Boolean(confirm && confirm !== password);
  const valid = Boolean(token) && passwordValid && password === confirm;

  const submit = async (event: FormEvent) => {
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
      <form onSubmit={submit} noValidate>
        <VStack gap={5}>
          <AuthNotice message={error || (!token ? "This reset link is invalid." : "")} />
          <VStack gap={4}>
            <AuthPasswordField id="password" name="password" label="New password" helper="Use at least 8 characters, including one uppercase letter and one number." autoComplete="new-password" value={password} onChange={setPassword} disabled={busy} required />
            <AuthPasswordField id="confirm" name="confirm" label="Confirm new password" error={mismatch ? "The passwords do not match." : undefined} autoComplete="new-password" value={confirm} onChange={setConfirm} disabled={busy} required />
          </VStack>
          <AuthSubmit label="Reset password" disabled={!valid} busy={busy} />
        </VStack>
      </form>
    </AuthShell>
  );
}
