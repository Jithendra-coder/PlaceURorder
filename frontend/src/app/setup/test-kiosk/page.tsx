"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KioskRuntime } from "@/features/kiosk/KioskApp";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { VirtualKioskFrame } from "@/components/onboarding/VirtualKioskFrame";
import { SetupShell } from "@/components/layout/SetupShell";
import {
  ALL_MENU_PRESETS,
  createOnboardingKioskExperience,
  useMenuPresetExperience,
} from "@/features/onboarding/menu-presets";
import { api as kioskApi } from "@/lib/api";
import type { KioskScreenOrientation } from "@/lib/types";
import { api as setupApi, type SetupOverview } from "@/services/api";

export default function TestKioskPage() {
  const router = useRouter();
  const { business } = useBusiness();
  const { selectedPresetIds } = useMenuPresetExperience();
  const sessionTaskRef = useRef<Promise<void> | null>(null);
  const [orientation, setOrientation] = useState<KioskScreenOrientation>("portrait");
  const [sessionReady, setSessionReady] = useState(false);
  const [attemptComplete, setAttemptComplete] = useState(false);
  const [attemptNumber, setAttemptNumber] = useState(0);
  const [overview, setOverview] = useState<SetupOverview | null>(null);
  const [error, setError] = useState("");
  const selectedPresets = useMemo(() => {
    const selectedIds = new Set(selectedPresetIds);
    return ALL_MENU_PRESETS.filter((preset) => selectedIds.has(preset.id));
  }, [selectedPresetIds]);
  const experience = useMemo(() => business && selectedPresets.length
    ? createOnboardingKioskExperience({ business, presets: selectedPresets, orientation })
    : null, [business, orientation, selectedPresets]);

  const load = useCallback(async () => {
    if (!business) return;
    try {
      setOverview(await setupApi.setup(business.id));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load setup status.");
    }
  }, [business]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  useEffect(() => {
    if (!business || !selectedPresets.length) return;
    let current = true;
    sessionTaskRef.current ??= kioskApi.createKioskTestSession(business.id)
      .then(({ session }) => kioskApi.exchangeKioskTestSession(session.token))
      .then(() => undefined);
    void sessionTaskRef.current
      .then(() => {
        if (current) setSessionReady(true);
      })
      .catch((cause) => {
        if (current) setError(cause instanceof Error ? cause.message : "Could not start the isolated test session.");
      });
    return () => {
      current = false;
    };
  }, [business, selectedPresets.length]);

  const receiveEvent = useCallback((event: string, payload?: Record<string, unknown>) => {
    if (event === "test-payment-completed" && payload?.success === true) {
      setAttemptComplete(true);
      void load();
    }
    if (event === "kiosk-error") setError(String(payload?.message ?? "Test kiosk failed."));
  }, [load]);

  const continueSetup = async () => {
    if (!attemptComplete && !overview?.status.successfulTestComplete) return;
    await kioskApi.clearKioskTestSession().catch(() => undefined);
    router.push("/dashboard");
  };

  return (
    <SetupShell
      step={6}
      title="Test Kiosk"
      description="Complete one isolated checkout in the exact customer kiosk."
      onContinue={() => void continueSetup()}
      continueDisabled={!attemptComplete && !overview?.status.successfulTestComplete}
      className="mt-setup-page--test"
    >
      {attemptComplete ? (
        <div className="mt-test-completion-card" role="status">
          <div className="mt-test-illustration" aria-hidden="true">
            <svg viewBox="0 0 72 64">
              <path d="M18 33.5 30 45l25-27" />
              <path className="mt-test-spark" d="m57 8 2.2 4.5L64 15l-4.8 2.4L57 22l-2.3-4.6L50 15l4.7-2.5L57 8Z" />
            </svg>
          </div>
          <h2>Test order completed</h2>
          <p>Your kiosk flow is working correctly. Continue setup, or run another complete customer test.</p>
          <div className="mt-test-info">
            <svg viewBox="0 0 32 36" aria-hidden="true"><path d="M7 3h18v30H7zM12 8h8M12 13h8M12 18h5" /></svg>
            <div>
              <h3>Ready for another run</h3>
              <p>Test Again restarts from your Welcome screen with a fresh cart.</p>
            </div>
          </div>
          <button
            type="button"
            className="mt-menu-continue mt-test-again"
            onClick={() => {
              setAttemptNumber((value) => value + 1);
              setAttemptComplete(false);
              setError("");
            }}
          >
            Test Again
          </button>
        </div>
      ) : !selectedPresets.length ? (
        <div className="mt-test-kiosk-empty">
          <h2>Select menu items first</h2>
          <p>Return to Menu Items and choose at least four presets for this temporary test.</p>
          <button type="button" onClick={() => router.push("/setup/menu-items")}>Choose menu items</button>
        </div>
      ) : !experience || !sessionReady ? (
        <div className="mt-setup-loading" role="status">Preparing your isolated Test Kiosk…</div>
      ) : (
        <>
          <div className="mt-test-kiosk-toolbar" aria-label="Test kiosk orientation">
            <span>Screen orientation</span>
            <div role="radiogroup" aria-label="Choose test kiosk orientation">
              <button type="button" role="radio" aria-checked={orientation === "portrait"} onClick={() => setOrientation("portrait")}>
                Portrait <small>1080 × 1920</small>
              </button>
              <button type="button" role="radio" aria-checked={orientation === "landscape"} onClick={() => setOrientation("landscape")}>
                Landscape <small>1920 × 1080</small>
              </button>
            </div>
          </div>
          <div className="mt-test-kiosk-stage">
            <VirtualKioskFrame orientation={orientation} interactive size="test" label={`Interactive ${orientation} Test Kiosk`}>
              <KioskRuntime
                key={attemptNumber}
                routeSlug={experience.business.slug}
                operationalMode="test"
                sessionId="onboarding"
                experienceData={experience}
                contained
                forcedOrientation={orientation}
                initialView="start"
                onKioskEvent={receiveEvent}
              />
            </VirtualKioskFrame>
          </div>
        </>
      )}
      {error && <p className="mt-setup-error" role="alert">{error}</p>}
    </SetupShell>
  );
}
