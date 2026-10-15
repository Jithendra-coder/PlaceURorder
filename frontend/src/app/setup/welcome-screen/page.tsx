"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { KioskRuntime } from "@/features/kiosk/KioskApp";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { VirtualKioskFrame } from "@/components/onboarding/VirtualKioskFrame";
import { SetupInfoBanner, SetupSelectedBadge, SetupShell } from "@/components/layout/SetupShell";
import {
  ALL_MENU_PRESETS,
  createOnboardingKioskExperience,
  useMenuPresetExperience,
} from "@/features/onboarding/menu-presets";
import { api, type WelcomeScreenConfiguration } from "@/services/api";

const defaultWelcome: WelcomeScreenConfiguration = {
  enabled: true,
  heading: "Welcome",
  supporting_text: "Browse our menu and place your order.",
  instruction_text: "Tap start when you are ready.",
  start_button_text: "Start",
  text_position: "middle",
  touch_anywhere_to_start: false,
  show_business_logo: true,
};

export default function WelcomeScreenPage() {
  const router = useRouter();
  const { business, loading, refresh } = useBusiness();
  const { selectedPresetIds } = useMenuPresetExperience();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedPresets = useMemo(() => {
    const selectedIds = new Set(selectedPresetIds);
    return ALL_MENU_PRESETS.filter((preset) => selectedIds.has(preset.id));
  }, [selectedPresetIds]);
  const preview = useMemo(() => business
    ? createOnboardingKioskExperience({
        business,
        presets: selectedPresets,
        orientation: "portrait",
      })
    : null, [business, selectedPresets]);

  const save = async () => {
    if (!business || selectedPresets.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.updateBusiness(business.id, {
        welcome_screen: business.welcome_screen || defaultWelcome,
        onboarding_step: 5,
      });
      await refresh();
      router.push("/setup/test-kiosk");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the welcome screen.");
      setBusy(false);
    }
  };

  return (
    <SetupShell step={5} title="Welcome Screen" description="Preview how customers begin using your kiosk." onContinue={() => void save()} continueDisabled={loading || !business || selectedPresets.length < 4} continueBusy={busy} className="mt-setup-page--welcome">
      {error && <p className="mt-setup-error" role="alert">{error}</p>}
      {!loading && selectedPresets.length < 4 && <SetupInfoBanner>Choose at least four menu items on the Menu Items step to preview the welcome screen.</SetupInfoBanner>}
      <div className="mt-welcome-selection-grid mt-welcome-selection-grid--single">
        <section className="mt-welcome-selection-card" data-selected="true" aria-label="Selected welcome screen">
          <div className="mt-welcome-selection-card__header"><strong>Welcome screen</strong><SetupSelectedBadge /></div>
          <div className="mt-welcome-selection-card__preview">
            {preview ? (
              <VirtualKioskFrame orientation="portrait" label="Welcome screen 1080 by 1920 preview">
                <KioskRuntime
                  routeSlug={preview.business.slug}
                  operationalMode="preview"
                  experienceData={preview}
                  contained
                  forcedOrientation="portrait"
                  initialView="start"
                />
              </VirtualKioskFrame>
            ) : (
              <div className="mt-welcome-preview-empty" />
            )}
          </div>
        </section>
      </div>
      {selectedPresets.length >= 4 && <SetupInfoBanner>You can change the welcome screen settings later.</SetupInfoBanner>}
    </SetupShell>
  );
}
