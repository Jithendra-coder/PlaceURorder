"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AuthField,
  AuthInput,
  AuthOtpInput,
  AuthPasswordField,
  AuthPrimaryButton,
  AuthShell,
  AuthStatus,
} from "@/components/AuthShell";
import { AuthService } from "@/services/auth";

type Step = "email" | "verify" | "password" | "created";

export default function SignUpPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expiresIn, setExpiresIn] = useState(300);
  const [cooldown, setCooldown] = useState(30);
  const actionInFlight = useRef(false);
  const passwordValid = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password);

  useEffect(() => {
    if (step !== "verify") return;
    const timer = setInterval(() => {
      setExpiresIn((value) => Math.max(0, value - 1));
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      const authType = fragment.get("type");
      const authError = fragment.get("error_description");
      if (!accessToken && authError) {
        setError(authError);
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        return;
      }
      if (!accessToken || !refreshToken || !["signup", "magiclink", "email"].includes(authType || "") || actionInFlight.current) return;
      actionInFlight.current = true;
      setBusy(true);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      void AuthService.acceptSignupLink(accessToken, refreshToken).then((result) => {
        setEmail(result.email);
        setStep("password");
      }).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "This verification link is invalid or expired.");
      }).finally(() => {
        setBusy(false);
        actionInFlight.current = false;
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const requestCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy || actionInFlight.current || !email.trim()) return;
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await AuthService.startSignUp(email);
      if (result.dev_otp) console.info(`Local verification code: ${result.dev_otp}`);
      setExpiresIn(300);
      setCooldown(30);
      setStep("verify");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the verification code.");
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  };

  const verify = async (verificationCode = code) => {
    if (busy || actionInFlight.current || verificationCode.length !== 6) return;
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await AuthService.verifySignUp(email, verificationCode);
      setStep("password");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the email.");
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  };

  const complete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || actionInFlight.current || !passwordValid || password !== confirm) return;
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await AuthService.completeSignUp(password);
      setStep("created");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the account.");
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  };

  const resend = async () => {
    if (busy || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await AuthService.sendOtp(email);
      if (result.dev_otp) console.info(`Local verification code: ${result.dev_otp}`);
      setExpiresIn(300);
      setCooldown(30);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resend the code.");
    } finally {
      setBusy(false);
      actionInFlight.current = false;
    }
  };

  const timerText = `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}`;

  return (
    <AuthShell title="Create your account" description="Start by verifying your email">
      <AuthStatus>{error}</AuthStatus>
      <AuthStatus tone="success">{step === "created" ? "Account created successfully." : ""}</AuthStatus>

      {step === "email" && (
        <form onSubmit={requestCode} className="mt-auth-form">
          <AuthField id="email" label="Email"><AuthInput id="email" name="email" type="email" placeholder="Enter your email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} required /></AuthField>
          <div className="mt-auth-action"><AuthPrimaryButton type="submit" disabled={!email.trim()} busy={busy}>Verify Email</AuthPrimaryButton></div>
        </form>
      )}

      {step === "verify" && (
        <form onSubmit={(event) => { event.preventDefault(); void verify(); }} className="mt-auth-otp-stage">
          <div className="mt-auth-field mt-auth-otp-email">
            <div className="mt-auth-field__header"><label htmlFor="verified-email" className="mt-auth-field__label">Email</label><button type="button" className="mt-auth-change" onClick={() => setStep("email")}>Change</button></div>
            <AuthInput id="verified-email" value={email} disabled />
          </div>
          <p className="mt-auth-code-support">Open the secure link in your email, or enter its 6-digit code if shown.</p>
          <AuthOtpInput value={code} onChange={setCode} onComplete={(value) => void verify(value)} disabled={busy} />
          <div className="mt-auth-otp-timer">
            <p className={expiresIn ? "" : "mt-auth-otp-expired"}>{expiresIn ? `Code expires in ${timerText}` : "Code has expired. Request a new code to continue."}</p>
            <button type="button" className="mt-auth-otp-resend" onClick={() => void resend()} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
          </div>
          <div className="mt-auth-otp-action"><AuthPrimaryButton type="submit" busy={busy}>Verify code</AuthPrimaryButton></div>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={complete} className="mt-auth-form">
          <AuthField id="verified-email" label="Verified email"><AuthInput id="verified-email" value={email} disabled /></AuthField>
          <AuthField id="password" label="Password" helper="Use at least 8 characters, including one uppercase letter and one number."><AuthPasswordField id="password" name="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required /></AuthField>
          <AuthField id="confirm" label="Confirm password" error={confirm && confirm !== password ? "The passwords do not match." : undefined}><AuthPasswordField id="confirm" name="confirm" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={busy} invalid={Boolean(confirm && confirm !== password)} required /></AuthField>
          <div className="mt-auth-action"><AuthPrimaryButton type="submit" disabled={!passwordValid || password !== confirm} busy={busy}>Create Account</AuthPrimaryButton></div>
        </form>
      )}

      {step === "created" && <AuthPrimaryButton type="button" onClick={() => router.replace("/setup/business-type")}>Continue to Business Onboarding</AuthPrimaryButton>}

      {step === "email" && (
        <div className="mt-auth-route-links">
          <Link href="/auth/sign-up/phone">Use phone instead</Link>
          <Link href="/auth/sign-in">Back to sign in</Link>
        </div>
      )}
    </AuthShell>
  );
}
