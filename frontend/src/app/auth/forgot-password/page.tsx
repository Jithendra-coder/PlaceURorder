"use client";

import { useState, type FormEvent } from "react";
import { AuthLink, AuthLinks, AuthNotice, AuthShell, AuthSubmit, AuthTextField } from "@/components/AuthShell";
import { VStack } from "@astryxdesign/core/Stack";
import { AuthService } from "@/services/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
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
      <form onSubmit={submit} noValidate>
        <VStack gap={5}>
          <AuthNotice message={error} />
          <AuthNotice tone="success" message={message} />
          <AuthTextField id="email" name="email" type="email" label="Email" placeholder="Enter your email address" autoComplete="email" value={email} onChange={setEmail} disabled={busy} required />
          <AuthSubmit label="Continue" disabled={!email.trim()} busy={busy} />
          <AuthLinks><AuthLink href="/auth/sign-in" label="Back to sign in" /></AuthLinks>
        </VStack>
      </form>
    </AuthShell>
  );
}
