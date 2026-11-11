"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { AuthLink, AuthLinks, AuthNotice, AuthPasswordField, AuthShell, AuthSubmit, AuthTextField } from "@/components/AuthShell";
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

  const submit = async (event: FormEvent) => {
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
      <form onSubmit={submit} noValidate>
        <VStack gap={5}>
          <AuthNotice message={error} />
          <VStack gap={4}>
            <AuthTextField id="phone" name="phone" type="tel" label="Phone number" helper="Include your country code, such as +1." placeholder="+1 555 123 4567" autoComplete="tel" value={phone} onChange={setPhone} disabled={busy} required />
            <AuthPasswordField id="password" name="password" label="Password" autoComplete="current-password" value={password} onChange={setPassword} disabled={busy} required />
          </VStack>
          <AuthSubmit label="Sign in" disabled={!valid} busy={busy} />
          <AuthLinks><AuthLink href="/auth/sign-in" label="Back to sign in" /></AuthLinks>
        </VStack>
      </form>
    </AuthShell>
  );
}
