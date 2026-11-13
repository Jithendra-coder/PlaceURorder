import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { Text } from "@astryxdesign/core/Text";

const steps = ["Business Type", "Business Details", "Menu Items", "Kiosk Layout", "Welcome Screen", "Test Kiosk"];

export function PlaceURorderLogo({ className = "", height = 46, wordmarkOnly = false }: { className?: string; height?: number; wordmarkOnly?: boolean }) {
  return (
    <div className={`mt-onboarding-logo ${className}`.trim()} role="img" aria-label="PlaceURorder logo">
      {wordmarkOnly ? (
        <span className="mt-onboarding-logo__wordmark"><span>Place</span><span>URorder</span></span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
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
      )}
    </div>
  );
}


export function OnboardingTopBar({
  currentStep,
  onContinue,
  disabled,
  busy = false,
  showContinue = true,
}: {
  currentStep: number;
  onContinue: () => void;
  disabled: boolean;
  busy?: boolean;
  showContinue?: boolean;
}) {
  return (
    <header className="mt-onboarding-topbar">
      <div className="mt-onboarding-topbar__inner">
        <div className="mt-onboarding-progress">
          <Text type="supporting" color="secondary">{`Step ${currentStep} of ${steps.length} · ${steps[currentStep - 1]}`}</Text>
          <Stepper
            activeStep={currentStep - 1}
            label="Setup progress"
            density="compact"
            horizontalOptions={{ minimumStepWidth: 9999, collapsedVariant: "hiddenLabel" }}
          >
            {steps.map((label, index) => (
              <Step key={label} step={index} label={label} indicator="none" />
            ))}
          </Stepper>
        </div>
        <Link href="/dashboard" className="mt-onboarding-topbar__logo" aria-label="PlaceURorder dashboard"><PlaceURorderLogo wordmarkOnly /></Link>
        <div className="mt-onboarding-topbar__action">
          {showContinue && (
            <Button
              label="Continue"
              variant="primary"
              onClick={onContinue}
              isDisabled={disabled || busy}
              isLoading={busy}
            />
          )}
        </div>
      </div>
    </header>
  );
}
