"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AuthDivider,
  AuthField,
  AuthFooter,
  AuthInput,
  AuthPasswordField,
  AuthPrimaryButton,
  AuthProviderButton,
  AuthShell,
  AuthStatus,
  GoogleIcon,
  PhoneIcon,
} from "@/components/AuthShell";
import { postLoginDestination, rememberPostLoginReturnPath, takePostLoginReturnPath } from "@/lib/protected-routing";
import { AuthService } from "@/services/auth";

export default function SignInPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = identifier.trim().length > 0 && password.length > 0;

  const submit = async (event: React.FormEvent) => {
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
    <AuthShell title="Welcome Back" description="Sign in to continue to your account">
      <AuthStatus>{error}</AuthStatus>
      <form onSubmit={submit} className="mt-auth-form">
        <AuthField id="identifier" label="Email or Phone">
          <AuthInput id="identifier" name="identifier" placeholder="Enter your email or phone" value={identifier} onChange={(event) => setIdentifier(event.target.value)} disabled={busy} autoComplete="username" required />
        </AuthField>
        <div className="mt-auth-field">
          <div className="mt-auth-field__header">
            <label htmlFor="password" className="mt-auth-field__label">Password</label>
            <Link href="/auth/forgot-password" className="mt-auth-forgot">Forgot password?</Link>
          </div>
          <AuthPasswordField id="password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} autoComplete="current-password" required />
        </div>
        <div className="mt-auth-action"><AuthPrimaryButton type="submit" disabled={!valid} busy={busy}>Sign In</AuthPrimaryButton></div>
      </form>
      <AuthDivider />
      <div className="mt-auth-providers">
        <AuthProviderButton icon={<GoogleIcon />} onClick={() => void startGoogleSignIn()} disabled={busy}>Google</AuthProviderButton>
        <AuthProviderButton icon={<PhoneIcon />} onClick={() => router.push("/auth/phone")} disabled={busy}>Phone</AuthProviderButton>
      </div>
      <AuthFooter text="Don't have an account?" linkText="Sign up" href="/auth/sign-up" />
    </AuthShell>
  );
}
