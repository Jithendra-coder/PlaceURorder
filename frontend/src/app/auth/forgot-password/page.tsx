"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthField, AuthInput, AuthPrimaryButton, AuthShell, AuthStatus } from "@/components/AuthShell";
import { AuthService } from "@/services/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await AuthService.forgotPassword(email);
      setMessage(response.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request a reset link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Reset your password" description="Enter your email address and we’ll send you a secure reset link.">
      <AuthStatus>{error}</AuthStatus>
      <AuthStatus tone="success">{message}</AuthStatus>
      <form onSubmit={submit} className="mt-auth-form">
        <AuthField id="email" label="Email"><AuthInput id="email" type="email" placeholder="Enter your email address" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} required /></AuthField>
        <div className="mt-auth-action"><AuthPrimaryButton type="submit" disabled={!email.trim()} busy={busy}>Continue</AuthPrimaryButton></div>
      </form>
      <div className="mt-auth-route-links"><Link href="/auth/sign-in">Back to sign in</Link></div>
    </AuthShell>
  );
}
