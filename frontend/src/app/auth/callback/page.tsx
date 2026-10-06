"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, AuthStatus } from "@/components/AuthShell";
import { postLoginDestination, takePostLoginReturnPath } from "@/lib/protected-routing";
import { api } from "@/services/api";
import { AuthService } from "@/services/auth";

export default function AuthCallbackPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const providerError = params.get("error_description") || params.get("error");
    window.history.replaceState(null, "", "/auth/callback");

    void (async () => {
      if (providerError || !code) {
        throw new Error((providerError || "The sign-in link is missing or expired.").slice(0, 240));
      }
      await AuthService.completeGoogleSignIn(code);
      const status = await api.onboardingStatus();
      router.replace(postLoginDestination(status.next_route, takePostLoginReturnPath()));
    })().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Google sign-in could not be completed.");
      });
  }, [router]);

  return (
    <AuthShell title={error ? "Sign-in unsuccessful" : "Signing you in"} description={error ? "Try signing in again." : "Securing your account and loading your workspace."}>
      <AuthStatus>{error}</AuthStatus>
    </AuthShell>
  );
}
