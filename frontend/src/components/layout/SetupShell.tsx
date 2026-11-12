"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { OnboardingTopBar } from "@/components/onboarding/OnboardingTopBar";

export type SetupStep = 1 | 2 | 3 | 4 | 5 | 6;

export function SetupShell({
  step,
  title,
  description,
  children,
  onContinue,
  continueDisabled = false,
  continueBusy = false,
  headerContinue = true,
  className = "",
}: {
  step: SetupStep;
  title: string;
  description: string;
  children: ReactNode;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueBusy?: boolean;
  // Screens with their own primary button turn the header action off, so each step has one clear action.
  headerContinue?: boolean;
  className?: string;
}) {
  return (
    <main className={`mt-setup-page ${className}`.trim()} data-step={step}>
      <OnboardingTopBar currentStep={step} onContinue={onContinue} disabled={continueDisabled} busy={continueBusy} showContinue={headerContinue} />
      <div className="mt-setup-page__shell">
        {title && (
          <header className="mt-setup-heading">
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
        )}
        {children}
      </div>
    </main>
  );
}

export function SetupField({
  id,
  label,
  optional,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="mt-setup-field" htmlFor={id}>
      <span className="mt-setup-field__label">{label}{required && <i aria-hidden="true">*</i>}{optional && <small> · Optional</small>}</span>
      {children}
      {error && <span className="mt-setup-field__error" role="alert">{error}</span>}
    </label>
  );
}

export function SetupInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`mt-setup-control ${props.className || ""}`.trim()} />;
}

export function SetupSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`mt-setup-control ${props.className || ""}`.trim()} />;
}


export function SetupSelectedBadge() {
  return <span className="mt-setup-selected"><i aria-hidden="true">✓</i>Selected</span>;
}

export function SetupInfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="mt-setup-info">
      <span className="mt-setup-info__icon" aria-hidden="true">i</span>
      <span>{children}</span>
    </div>
  );
}
