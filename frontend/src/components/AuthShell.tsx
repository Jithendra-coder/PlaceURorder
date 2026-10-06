"use client";

import Link from "next/link";
import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { AmbientBackground } from "./AmbientBackground";
import { PlaceURorderLogo } from "./onboarding/OnboardingTopBar";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mt-auth-shell">
      <AmbientBackground />
      <div className="mt-auth-center">{children}</div>
    </main>
  );
}

export function AuthShell({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <section className="mt-auth-card">
      <header className="mt-auth-header">
        <div className="mt-auth-wordmark"><PlaceURorderLogo /></div>
        <h1 className="mt-auth-heading">{title}</h1>
        <p className="mt-auth-supporting">{description}</p>
      </header>
      {children}
    </section>
  );
}

export function AuthField({
  id,
  label,
  error,
  helper,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-auth-field">
      <label htmlFor={id} className="mt-auth-field__label">{label}</label>
      {children}
      {(error || helper) && <p id={`${id}-${error ? "error" : "helper"}`} className={`mt-auth-field__message${error ? " mt-auth-field__message--error" : ""}`} role={error ? "alert" : undefined}>{error || helper}</p>}
    </div>
  );
}

export const AuthInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function AuthInput({ className = "", invalid, ...props }, ref) {
    return <input ref={ref} className={`mt-auth-input ${className}`.trim()} aria-invalid={invalid || undefined} {...props} />;
  }
);

export const AuthPasswordField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function AuthPasswordField({ invalid, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="mt-auth-input-wrap">
        <AuthInput ref={ref} {...props} type={visible ? "text" : "password"} invalid={invalid} className="mt-auth-input--password" />
        <button type="button" className="mt-auth-password-toggle" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? "Hide" : "Show"}</button>
      </div>
    );
  }
);

export function AuthPrimaryButton({ busy = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} className="mt-auth-primary" disabled={props.disabled || busy} aria-busy={busy}>{busy ? "Loading..." : children}</button>;
}

export function AuthStatus({ tone = "error", children }: { tone?: "error" | "success" | "info"; children?: ReactNode }) {
  if (!children) return null;
  return <div className={`mt-auth-status mt-auth-status--${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function AuthDivider({ children = "or continue with" }: { children?: ReactNode }) {
  return <div className="mt-auth-divider"><span>{children}</span></div>;
}

export function AuthProviderButton({ icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode }) {
  return <button {...props} type="button" className="mt-auth-provider">{icon}<span>{children}</span></button>;
}

export function AuthFooter({ text, linkText, href }: { text: string; linkText: string; href: string }) {
  return <div className="mt-auth-footer">{text}<Link href={href}>{linkText}</Link></div>;
}

export function AuthOtpInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-auth-otp" role="group" aria-label="Six-digit verification code">
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          className="mt-auth-otp__input"
          value={value[index] || ""}
          onChange={(event) => {
            const digit = event.target.value.replace(/\D/g, "").slice(-1);
            const nextValue = `${value.slice(0, index)}${digit}${value.slice(index + 1)}`.slice(0, 6);
            onChange(nextValue);
            const next = event.currentTarget.nextElementSibling;
            if (digit && next instanceof HTMLInputElement) next.focus();
            if (nextValue.length === 6) onComplete?.(nextValue);
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !value[index] && event.currentTarget.previousElementSibling instanceof HTMLInputElement) event.currentTarget.previousElementSibling.focus();
          }}
          onPaste={(event) => {
            const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            if (digits) {
              event.preventDefault();
              onChange(digits);
              if (digits.length === 6) onComplete?.(digits);
            }
          }}
          disabled={disabled}
          maxLength={1}
          aria-label={`Digit ${index + 1}`}
        />
      ))}
    </div>
  );
}

export function GoogleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.7 12.2c0-.7-.1-1.5-.2-2.2H12v4.1h5.5a4.7 4.7 0 0 1-2 3.1v2.7h3.4a10.3 10.3 0 0 0 2.8-7.7Z" fill="#4285f4"/><path d="M12 22c2.7 0 5-.9 6.8-2.4l-3.4-2.7c-.9.6-2.1 1-3.4 1a6 6 0 0 1-5.6-4.1H2.9v2.8A10 10 0 0 0 12 22Z" fill="#34a853"/><path d="M6.4 13.8a6 6 0 0 1 0-3.6V7.4H2.9a10 10 0 0 0 0 9.2l3.5-2.8Z" fill="#fbbc05"/><path d="M12 6.1c1.5 0 2.9.5 4 1.6l3-3A10 10 0 0 0 2.9 7.4l3.5 2.8A6 6 0 0 1 12 6.1Z" fill="#ea4335"/></svg>;
}

export function PhoneIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>;
}
