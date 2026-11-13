"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Phone } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import {
  AuthDivider,
  AuthFooter,
  AuthLink,
  AuthNotice,
  AuthPasswordField,
  AuthProviderButton,
  AuthShell,
  AuthSubmit,
  AuthTextField,
  GoogleIcon,
} from "@/components/AuthShell";
import { postLoginDestination, rememberPostLoginReturnPath, takePostLoginReturnPath } from "@/lib/protected-routing";
import { AuthService } from "@/services/auth";
import { DEV_DEMO_EMAIL, DEV_DEMO_PASSWORD } from "@/lib/dev-demo";

export default function SignInPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = identifier.trim().length > 0 && password.length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await AuthService.signIn(identifier, password);
      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const pendingPath = takePostLoginReturnPath();
      router.replace(postLoginDestination(result.nextRoute, requestedPath ?? pendingPath));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not sign you in with those details.");
      setBusy(false);
    }
  };

  const startGoogleSignIn = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      rememberPostLoginReturnPath(new URLSearchParams(window.location.search).get("next"));
      const { authorization_url } = await AuthService.startGoogleSignIn();
      window.location.assign(authorization_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Google sign-in could not be started.");
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" description="Sign in to manage your menu, kiosks and orders.">
      <form onSubmit={submit} noValidate>
        <VStack gap={5}>
          <AuthNotice message={error} />

          <VStack gap={4}>
            <AuthTextField id="identifier" name="identifier" label="Email or phone" helper="Use the email address or phone number on your account." autoComplete="username" value={identifier} onChange={setIdentifier} disabled={busy} required />
            <VStack gap={2}>
              <AuthPasswordField id="password" name="password" label="Password" autoComplete="current-password" value={password} onChange={setPassword} disabled={busy} required />
              <HStack gap={2} hAlign="end">
                <AuthLink href="/auth/forgot-password" label="Forgot password?" />
              </HStack>
            </VStack>
          </VStack>

          {process.env.NODE_ENV !== "production" && (
            <Button label="Fill demo account" variant="ghost" size="sm" width="100%" onClick={() => { setIdentifier(DEV_DEMO_EMAIL); setPassword(DEV_DEMO_PASSWORD); }} />
          )}
          {process.env.NEXT_PUBLIC_DEMO_ACCOUNT === "true" && (
            <VStack gap={2} hAlign="center">
              <AuthLink href="/demo" label="Open the Tasty Bug demo" />
              <AuthLink href="/demo/onboarding" label="Open the onboarding demo" />
            </VStack>
          )}
          <AuthSubmit label="Sign in" disabled={!valid} busy={busy} />

          <AuthDivider />

          <Grid columns={2} gap={3}>
            <AuthProviderButton label="Google" icon={<GoogleIcon />} disabled={busy} onClick={() => void startGoogleSignIn()} />
            <AuthProviderButton label="Phone" icon={<Phone size={18} aria-hidden="true" />} disabled={busy} onClick={() => router.push(`/auth/phone${window.location.search}`)} />
          </Grid>

          <AuthFooter text="Don’t have an account?" linkText="Create one" href="/auth/sign-up" />
        </VStack>
      </form>
    </AuthShell>
  );
}
