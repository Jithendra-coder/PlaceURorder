"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import {
  AuthLink,
  AuthLinks,
  AuthNotice,
  AuthOtpInput,
  AuthPasswordField,
  AuthShell,
  AuthSubmit,
  AuthTextField,
} from "@/components/AuthShell";
import { AuthService } from "@/services/auth";

type Step = "email" | "verify" | "password" | "created";

export default function SignUpPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") || ""));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expiresIn, setExpiresIn] = useState(300);
  const [cooldown, setCooldown] = useState(30);
  const actionInFlight = useRef(false);
  const passwordValid = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password);
  const mismatch = Boolean(confirm && confirm !== password);

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

  const requestCode = async (event?: FormEvent) => {
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

  const complete = async (event: FormEvent) => {
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
    <AuthShell title="Create your account" description="We’ll email you a six-digit code to verify your address and choose a password.">
      <VStack gap={5}>
        <AuthNotice message={error} />
        <AuthNotice tone="success" message={step === "created" ? "Account created successfully." : ""} />

        {step === "email" && (
          <form onSubmit={requestCode} noValidate>
            <VStack gap={5}>
              <AuthTextField id="email" name="email" type="email" label="Email" placeholder="Enter your email" autoComplete="email" value={email} onChange={setEmail} disabled={busy} required />
              <AuthSubmit label="Send verification code" disabled={!email.trim()} busy={busy} />
            </VStack>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={(event) => { event.preventDefault(); void verify(); }} noValidate>
            <VStack gap={5}>
              <HStack gap={2} vAlign="end">
                <AuthTextField id="verified-email" label="Email" value={email} onChange={() => {}} disabled />
                <Button label="Change" variant="ghost" size="sm" onClick={() => setStep("email")} />
              </HStack>
              <Text type="body" color="secondary">Enter the six-digit code from your email. After verification, you’ll choose your password.</Text>
              <AuthOtpInput value={code} onChange={setCode} onComplete={(value) => void verify(value)} disabled={busy} />
              <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
                <Text type="supporting" color={expiresIn ? "secondary" : "primary"}>
                  {expiresIn ? `Code expires in ${timerText}` : "Code has expired. Request a new code to continue."}
                </Text>
                <Button label={cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"} variant="ghost" size="sm" isDisabled={busy || cooldown > 0} onClick={() => void resend()} />
              </HStack>
              <AuthSubmit label="Verify code" busy={busy} />
            </VStack>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={complete} noValidate>
            <VStack gap={5}>
              <AuthTextField id="verified-email" label="Verified email" value={email} onChange={() => {}} disabled />
              <VStack gap={4}>
                <AuthPasswordField id="password" name="password" label="Password" helper="Use at least 8 characters, including one uppercase letter and one number." autoComplete="new-password" value={password} onChange={setPassword} disabled={busy} required />
                <AuthPasswordField id="confirm" name="confirm" label="Confirm password" error={mismatch ? "The passwords do not match." : undefined} autoComplete="new-password" value={confirm} onChange={setConfirm} disabled={busy} required />
              </VStack>
              <AuthSubmit label="Create account" disabled={!passwordValid || password !== confirm} busy={busy} />
            </VStack>
          </form>
        )}

        {step === "created" && <AuthSubmit label="Continue to business setup" type="button" onClick={() => router.replace("/setup/business-type")} />}

        {step === "email" && (
          <AuthLinks>
            <AuthLink href="/auth/sign-in" label="Back to sign in" />
          </AuthLinks>
        )}
      </VStack>
    </AuthShell>
  );
}
