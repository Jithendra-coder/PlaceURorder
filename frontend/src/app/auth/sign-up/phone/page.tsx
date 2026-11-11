"use client";

import { VStack } from "@astryxdesign/core/Stack";
import { AuthLink, AuthLinks, AuthNotice, AuthShell } from "@/components/AuthShell";

export default function PhoneSignUpPage() {
  return (
    <AuthShell title="Phone sign-up unavailable" description="Create your PlaceURorder account with email verification.">
      <VStack gap={5}>
        <AuthNotice tone="info" message="Phone number sign-up is not available yet. You can create an account with your email address." />
        <AuthLinks>
          <AuthLink href="/auth/sign-up" label="Sign up with email" />
          <AuthLink href="/auth/sign-in" label="Back to sign in" />
        </AuthLinks>
      </VStack>
    </AuthShell>
  );
}
