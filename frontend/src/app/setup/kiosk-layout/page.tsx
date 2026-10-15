"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { KioskRuntime } from "@/features/kiosk/KioskApp";
import { VirtualKioskFrame } from "@/components/onboarding/VirtualKioskFrame";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { SetupInfoBanner, SetupSelectedBadge, SetupShell } from "@/components/layout/SetupShell";
import {
  ALL_MENU_PRESETS,
  createOnboardingKioskExperience,
  useMenuPresetExperience,
} from "@/features/onboarding/menu-presets";
import type { KioskLayoutId } from "@/lib/kiosk/kiosk-business-config";
import { api, type KioskLayoutId as SavedKioskLayoutId } from "@/services/api";

const layouts: { id: KioskLayoutId; name: string; description: string }[] = [
  { id: "left_category", name: "Side Navigation", description: "Categories displayed on the left" },
  { id: "top_category", name: "Top Navigation", description: "Categories displayed across the top" },
  { id: "category_gate", name: "Category First", description: "Large category-first cards" },
];

export default function KioskLayoutPage() {
  const router = useRouter();
  const { business, loading, refresh } = useBusiness();
  const { selectedPresetIds } = useMenuPresetExperience();
  const [draft, setDraft] = useState<KioskLayoutId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = draft ?? savedToRuntimeLayout(business?.kiosk_layout_id);
  const selectedPresets = useMemo(() => {
    const selectedIds = new Set(selectedPresetIds);
    return ALL_MENU_PRESETS.filter((preset) => selectedIds.has(preset.id));
  }, [selectedPresetIds]);
  const previews = useMemo(() => {
    if (!business || !selectedPresets.length) return null;
    return new Map(layouts.map((layout) => [
      layout.id,
      createOnboardingKioskExperience({
        business,
        presets: selectedPresets,
        layout: layout.id,
        orientation: "portrait",
      }),
    ]));
  }, [business, selectedPresets]);

  const save = async () => {
    if (!business || !selected || selectedPresets.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.updateBusiness(business.id, { kiosk_layout_id: runtimeToSavedLayout(selected), onboarding_step: 4 });
      await refresh();
      router.push("/setup/welcome-screen");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the kiosk layout.");
      setBusy(false);
    }
  };

  return (
    <SetupShell step={4} title="Kiosk Layout" description="Choose how your menu should appear on the kiosk." onContinue={() => void save()} continueDisabled={loading || !business || !selected || selectedPresets.length < 4} continueBusy={busy} className="mt-setup-page--layout">
      {error && <p className="mt-setup-error" role="alert">{error}</p>}
      {!loading && selectedPresets.length < 4 && <SetupInfoBanner>Choose at least four menu items on the Menu Items step to preview kiosk layouts.</SetupInfoBanner>}
      <div className="mt-kiosk-layout-grid" role="radiogroup" aria-label="Choose a kiosk layout">
        {layouts.map((layout) => {
          const chosen = selected === layout.id;
          const preview = previews?.get(layout.id);
          return (
            <div
              className="mt-kiosk-layout-card"
              data-selected={chosen}
              key={layout.id}
              role="radio"
              aria-checked={chosen}
              tabIndex={0}
              onClick={() => setDraft(layout.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setDraft(layout.id);
              }}
            >
              <span className="mt-kiosk-layout-card__header">
                <LayoutIcon id={layout.id} />
                <span><strong>{layout.name}</strong><small>{layout.description}</small></span>
                {chosen && <SetupSelectedBadge />}
              </span>
              <span className="mt-kiosk-layout-card__preview" aria-hidden="true">
                {preview ? (
                  <VirtualKioskFrame orientation="portrait" label={`${layout.name} 1080 by 1920 preview`}>
                    <KioskRuntime
                      routeSlug={preview.business.slug}
                      operationalMode="preview"
                      experienceData={preview}
                      contained
                      forcedOrientation="portrait"
                      initialView="menu"
                    />
                  </VirtualKioskFrame>
                ) : (
                  <span className="mt-kiosk-preview-loading">Select menu items to preview this layout.</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {selectedPresets.length >= 4 && <SetupInfoBanner>You can always change the layout later from settings.</SetupInfoBanner>}
    </SetupShell>
  );
}

function savedToRuntimeLayout(id?: SavedKioskLayoutId | null): KioskLayoutId {
  if (id === "side-navigation") return "left_category";
  if (id === "category-first") return "category_gate";
  return "top_category";
}

function runtimeToSavedLayout(id: KioskLayoutId): SavedKioskLayoutId {
  if (id === "left_category") return "side-navigation";
  if (id === "category_gate") return "category-first";
  return "top-navigation";
}

function LayoutIcon({ id }: { id: KioskLayoutId }) {
  return (
    <span className="mt-kiosk-layout-card__icon" data-layout={id} aria-hidden="true">
      {id === "category_gate" ? (
        <svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
      ) : (
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d={id === "left_category" ? "M8 3v18M11 7h7M11 12h7M11 17h7" : "M3 8h18M6 12h4M12 12h6M6 17h4M12 17h6"} /></svg>
      )}
    </span>
  );
}
