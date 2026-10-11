"use client";

import Link from "next/link";
import { AuthShell, AuthStatus } from "@/components/AuthShell";

export default function PhoneSignUpPage() {
  return (
    <AuthShell title="Phone sign-up unavailable" description="Create your PlaceURorder account with email verification.">
      <AuthStatus tone="info">Phone number sign-up is not available yet. You can create an account with your email address.</AuthStatus>
      <div className="mt-auth-route-links"><Link href="/auth/sign-up">Sign up with email</Link><Link href="/auth/sign-in">Back to sign in</Link></div>
    </AuthShell>
  );
}
