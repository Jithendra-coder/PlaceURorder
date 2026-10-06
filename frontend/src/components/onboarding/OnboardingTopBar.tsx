"use client";

const steps = ["Business Type", "Business Details", "Menu Items", "Kiosk Layout", "Welcome Screen", "Test Kiosk"];

export function PlaceURorderLogo({ className = "", height = 46 }: { className?: string; height?: number }) {
  return (
    <div className={`mt-onboarding-logo ${className}`.trim()} role="img" aria-label="PlaceURorder logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/place-ur-order-logo.png"
        alt="PlaceURorder"
        style={{
          height: `${height}px`,
          width: "auto",
          maxWidth: "240px",
          objectFit: "contain",
          display: "block",
        }}
      />
    </div>
  );
}


export function OnboardingTopBar({
  currentStep,
  onContinue,
  disabled,
  busy = false,
}: {
  currentStep: number;
  onContinue: () => void;
  disabled: boolean;
  busy?: boolean;
}) {
  return (
    <header className="mt-onboarding-topbar">
      <div className="mt-onboarding-topbar__inner">
        <div className="mt-onboarding-progress" aria-hidden="true">
          {steps.map((_, index) => {
            const step = index + 1;
            if (step < currentStep) {
              return (
                <svg key={step} className="mt-onboarding-progress__tick" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7l4 4 8-9" stroke="#000000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              );
            }
            return <span key={step} className={step === currentStep ? "mt-onboarding-progress__current" : "mt-onboarding-progress__future"} />;
          })}
        </div>
        <span className="mt-sr-only">Step {currentStep} of 6: {steps[currentStep - 1]}</span>
        <div className="mt-onboarding-topbar__logo"><PlaceURorderLogo /></div>
        <button
          type="button"
          className="mt-onboarding-topbar__continue"
          onClick={onContinue}
          disabled={disabled || busy}
          aria-busy={busy}
          aria-label="Continue"
        >
          <span>Continue</span>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
