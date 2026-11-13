"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { Button } from "@astryxdesign/core/Button";
import { SetupShell } from "@/components/layout/SetupShell";
import {
  ALL_MENU_PRESETS,
  getMenuPresetsForBusinessType,
  useMenuPresetExperience,
} from "@/features/onboarding/menu-presets";
import { api } from "@/services/api";

// A tile never shows an empty box: if the photo is missing or fails to load, the item's initial stands in.
function MenuPresetImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="mt-menu-selection-card__fallback" aria-hidden="true">{alt.slice(0, 1)}</span>;
  return <Image src={src} alt={alt} fill sizes="160px" onError={() => setFailed(true)} />;
}

export default function MenuItemsPage() {
  const router = useRouter();
  const { business, loading, refresh: refreshBusiness } = useBusiness();
  const { visiblePresetIds, selectedPresetIds, configure, refresh, toggle } = useMenuPresetExperience();
  const [profileType, setProfileType] = useState<{ type: string; description: string }>({ type: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const businessType = business?.type || profileType.type;
  const businessDescription = business?.business_subtype || profileType.description;
  const presets = useMemo(() => getMenuPresetsForBusinessType({
    businessType,
    businessDescription,
    allPresets: ALL_MENU_PRESETS,
  }), [businessDescription, businessType]);
  const presetMap = useMemo(() => new Map(presets.map((preset) => [preset.id, preset])), [presets]);
  const visible = visiblePresetIds.map((id) => presetMap.get(id)).filter((preset) => preset !== undefined);
  const selected = new Set(selectedPresetIds);
  const remaining = Math.max(0, 4 - selected.size);

  useEffect(() => {
    void api.onboardingBusinessType()
      .then(({ business_type, business_description }) => setProfileType({ type: business_type || "", description: business_description || "" }))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load the selected business type."));
  }, []);

  useEffect(() => {
    if (!businessType || !presets.length) return;
    configure(`${businessType}:${businessDescription}`, presets.map((preset) => preset.id));
  }, [businessDescription, businessType, configure, presets]);

  const continueSetup = async () => {
    if (!business || selected.size < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.updateBusiness(business.id, { onboarding_step: 3 });
      await refreshBusiness();
      router.push("/setup/kiosk-layout");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not continue setup.");
      setBusy(false);
    }
  };

  return (
    <SetupShell headerContinue={false} step={3} title="Menu Items" description="Choose at least four items for your menu preview." onContinue={() => void continueSetup()} continueDisabled={loading || visible.length !== 15 || selected.size < 4} continueBusy={busy} className="mt-setup-page--menu">
      {error && <p className="mt-setup-error" role="alert">{error}</p>}
      <section className="mt-menu-grid-panel" aria-label="Menu item recommendations">
        <div className="mt-menu-grid-panel__toolbar">
          <span>Suggested for your business</span>
          <button type="button" className="mt-menu-refresh" onClick={() => refresh(presets.map((preset) => preset.id))}>Refresh Items</button>
        </div>
        <div className="mt-menu-selection-grid" role="group" aria-label="Menu items">
          {visible.map((preset) => {
            const chosen = selected.has(preset.id);
            return (
              <button key={preset.id} type="button" className="mt-menu-selection-card" data-preset-id={preset.id} aria-pressed={chosen} onClick={() => toggle(preset.id)}>
                <span className="mt-menu-selection-card__media">
                  <MenuPresetImage src={preset.imagePath} alt={preset.name} />
                  {chosen && <i aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M10 3 4.5 8.5 2 6" /></svg></i>}
                </span>
                <span className="mt-menu-selection-card__details">
                  <span className="mt-menu-selection-card__title">
                    {preset.foodType && (
                      <i className={`mt-dietary-marker mt-dietary-marker--${preset.foodType}`} aria-label={preset.foodType === "veg" ? "Vegetarian" : "Non-vegetarian"}><i /></i>
                    )}
                    <strong title={preset.name}>{preset.name}</strong>
                  </span>
                  <small title={preset.category}>{preset.category}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <div className="mt-menu-actions">
        {selected.size >= 4 && <p>Want to add more?</p>}
        <Button label={busy ? "Loading…" : remaining ? `${remaining} more ${remaining === 1 ? "item" : "items"} to continue` : `Continue with ${selected.size} items`} variant="primary" isDisabled={selected.size < 4 || busy} isLoading={busy} onClick={() => void continueSetup()} />
      </div>
    </SetupShell>
  );
}
