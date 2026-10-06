"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField, AuthInput, AuthPasswordField, AuthPrimaryButton, AuthShell, AuthStatus } from "@/components/AuthShell";
import { postLoginDestination, takePostLoginReturnPath } from "@/lib/protected-routing";
import { AuthService } from "@/services/auth";

export default function PhoneAuthPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const normalizedPhone = phone.trim().replace(/[\s()-]/g, "");
  const valid = /^\+[1-9]\d{1,14}$/.test(normalizedPhone) && password.length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await AuthService.signIn(normalizedPhone, password);
      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const pendingPath = takePostLoginReturnPath();
      router.replace(postLoginDestination(result.nextRoute, requestedPath ?? pendingPath));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not sign you in with those details.");
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in with phone" description="Use the phone number and password on your account.">
      <AuthStatus>{error}</AuthStatus>
      <form className="mt-auth-form" onSubmit={submit}>
        <AuthField id="phone" label="Phone Number" helper="Include your country code, such as +1."><AuthInput id="phone" name="phone" type="tel" placeholder="+1 555 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" disabled={busy} required /></AuthField>
        <AuthField id="password" label="Password"><AuthPasswordField id="password" name="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required /></AuthField>
        <div className="mt-auth-action"><AuthPrimaryButton type="submit" disabled={!valid} busy={busy}>Sign In</AuthPrimaryButton></div>
      </form>
      <div className="mt-auth-route-links"><Link href="/auth/sign-in">Back to sign in</Link></div>
    </AuthShell>
  );
}
