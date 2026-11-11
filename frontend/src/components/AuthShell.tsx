"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { AstryxDashboardProviders } from "@/components/dashboard/AstryxDashboardProviders";
import { NoticeBanner } from "@/components/dashboard/kit";
import { AmbientBackground } from "./AmbientBackground";
import { PlaceURorderLogo } from "./onboarding/OnboardingTopBar";

// Every account-access screen (sign-in, sign-up, phone, reset, callback) is built from these pieces, so they share
// one card, one spacing rhythm, one field style and one notice style. The ambient background is unchanged.

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AstryxDashboardProviders>
      <Layout height="auto" style={{ position: "relative", minHeight: "100vh" }}>
        <LayoutContent padding={6}>
          <AmbientBackground />
          <VStack gap={0} hAlign="center" vAlign="center" style={{ minHeight: "calc(100vh - 48px)", position: "relative" }}>
            {children}
          </VStack>
        </LayoutContent>
      </Layout>
    </AstryxDashboardProviders>
  );
}

export function AuthShell({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <Card padding={6} elevation="med" width="100%" maxWidth={440}>
      <VStack gap={5}>
        <VStack gap={3} hAlign="center">
          <Link href="/" aria-label="PlaceURorder home">
            <PlaceURorderLogo height={40} />
          </Link>
          <VStack gap={1} hAlign="center">
            <Heading level={1} weight="semibold">{title}</Heading>
            <Text type="body" color="secondary">{description}</Text>
          </VStack>
        </VStack>
        {children}
      </VStack>
    </Card>
  );
}

/** Status message for a form: an error, a success, or neutral information. Renders nothing when empty. */
export function AuthNotice({ tone = "error", message }: { tone?: "error" | "success" | "info"; message?: string | null }) {
  if (!message) return null;
  if (tone === "error") return <NoticeBanner tone="danger" title="Something needs attention" description={message} role="alert" />;
  if (tone === "success") return <NoticeBanner tone="success" title="Done" description={message} role="status" />;
  return <NoticeBanner tone="info" title="Note" description={message} role="status" />;
}

type FieldProps = {
  id: string;
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  helper?: string;
  error?: string;
  placeholder?: string;
  type?: "text" | "email" | "tel";
};

const fieldStatus = (error?: string) => (error ? { type: "error" as const, message: error } : undefined);

export function AuthTextField({ id, label, name, value, onChange, autoComplete, disabled, required, helper, error, placeholder, type = "text" }: FieldProps) {
  return (
    <TextInput
      id={id}
      htmlName={name}
      label={label}
      type={type}
      value={value}
      onChange={(next) => onChange(next)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      isDisabled={disabled}
      isRequired={required}
      description={helper}
      status={fieldStatus(error)}
      width="100%"
    />
  );
}

export function AuthPasswordField({ id, label, name, value, onChange, autoComplete, disabled, required, helper, error }: FieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <HStack gap={2} vAlign="end">
      <TextInput
        id={id}
        htmlName={name}
        label={label}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(next) => onChange(next)}
        autoComplete={autoComplete}
        isDisabled={disabled}
        isRequired={required}
        description={helper}
        status={fieldStatus(error)}
        width="100%"
      />
      <IconButton
        label={visible ? "Hide password" : "Show password"}
        variant="ghost"
        icon={visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        onClick={() => setVisible((current) => !current)}
      />
    </HStack>
  );
}

/** Six single-digit boxes for a one-time code. Typing advances, Backspace steps back, and a pasted code fills all six. */
export function AuthOtpInput({ value, onChange, onComplete, disabled }: { value: string; onChange: (value: string) => void; onComplete?: (value: string) => void; disabled?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const first = refs.current[0];
    if (!first) return;
    const onPaste = (event: ClipboardEvent) => {
      const digits = (event.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      if (!digits) return;
      event.preventDefault();
      onChange(digits);
      if (digits.length === 6) onComplete?.(digits);
      refs.current[Math.min(digits.length, 5)]?.focus();
    };
    first.addEventListener("paste", onPaste);
    return () => first.removeEventListener("paste", onPaste);
  }, [onChange, onComplete]);

  const setDigit = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const chars = Array.from({ length: 6 }, (_, position) => value[position] ?? "");
    chars[index] = digit;
    const next = chars.join("").slice(0, 6);
    onChange(next);
    if (digit && index < 5) refs.current[index + 1]?.focus();
    if (next.length === 6) onComplete?.(next);
  };

  return (
    <HStack gap={2} hAlign="center" vAlign="center" wrap="wrap">
      {Array.from({ length: 6 }, (_, index) => (
        <TextInput
          key={index}
          ref={(element) => { refs.current[index] = element; }}
          id={`otp-${index}`}
          label={`Digit ${index + 1}`}
          isLabelHidden
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          value={value[index] ?? ""}
          onChange={(next) => setDigit(index, next)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !value[index] && index > 0) refs.current[index - 1]?.focus();
          }}
          isDisabled={disabled}
          width={52}
        />
      ))}
    </HStack>
  );
}

export function AuthSubmit({ label, busy = false, disabled = false, type = "submit", onClick }: { label: string; busy?: boolean; disabled?: boolean; type?: "submit" | "button"; onClick?: () => void }) {
  return <Button label={label} type={type} variant="primary" width="100%" isLoading={busy} isDisabled={disabled || busy} onClick={onClick} />;
}

export function AuthDivider({ label = "or continue with" }: { label?: string }) {
  return <Divider label={label} />;
}

export function AuthProviderButton({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <Button label={label} variant="secondary" width="100%" icon={icon} isDisabled={disabled} onClick={onClick} />;
}

/** A row of text links under a form, such as "Back to sign in". Each link is an Astryx button, so it keeps the theme. */
export function AuthLinks({ children }: { children: ReactNode }) {
  return <HStack gap={2} hAlign="center" vAlign="center" wrap="wrap">{children}</HStack>;
}

export function AuthLink({ href, label }: { href: string; label: string }) {
  return <Button label={label} variant="ghost" size="sm" href={href} />;
}

export function AuthFooter({ text, linkText, href }: { text: string; linkText: string; href: string }) {
  return (
    <HStack gap={1} hAlign="center" vAlign="center" wrap="wrap">
      <Text type="supporting" color="secondary">{text}</Text>
      <AuthLink href={href} label={linkText} />
    </HStack>
  );
}

export function GoogleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.7 12.2c0-.7-.1-1.5-.2-2.2H12v4.1h5.5a4.7 4.7 0 0 1-2 3.1v2.7h3.4a10.3 10.3 0 0 0 2.8-7.7Z" fill="#4285f4"/><path d="M12 22c2.7 0 5-.9 6.8-2.4l-3.4-2.7c-.9.6-2.1 1-3.4 1a6 6 0 0 1-5.6-4.1H2.9v2.8A10 10 0 0 0 12 22Z" fill="#34a853"/><path d="M6.4 13.8a6 6 0 0 1 0-3.6V7.4H2.9a10 10 0 0 0 0 9.2l3.5-2.8Z" fill="#fbbc05"/><path d="M12 6.1c1.5 0 2.9.5 4 1.6l3-3A10 10 0 0 0 2.9 7.4l3.5 2.8A6 6 0 0 1 12 6.1Z" fill="#ea4335"/></svg>;
}

export function PhoneIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>;
}
