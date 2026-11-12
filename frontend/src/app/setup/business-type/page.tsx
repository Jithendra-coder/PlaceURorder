"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { SetupShell } from "@/components/layout/SetupShell";
import { api } from "@/services/api";

const businessTypes = [
  ["restaurant", "Restaurant"],
  ["cafe", "Cafe"],
  ["retail-store", "Retail Store"],
  ["bakery", "Bakery"],
  ["pizza", "Pizza"],
  ["burger", "Burger"],
  ["grocery", "Grocery"],
  ["salon", "Salon"],
  ["ice-cream", "Ice Cream"],
  ["other", "Other"],
] as const;

const toUiId = (id: string) => id === "retail" ? "retail-store" : id === "ice_cream" ? "ice-cream" : id;
const toApiId = (id: string) => id === "retail-store" ? "retail" : id === "ice-cream" ? "ice_cream" : id;

export default function BusinessTypePage() {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestAbortRef.current = controller;
    api.onboardingBusinessType({ signal: controller.signal })
      .then(({ business_type, business_description }) => {
        if (controller.signal.aborted) return;
        setSelected(toUiId(business_type || ""));
        setDescription(business_description || "");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load your saved business type.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => requestAbortRef.current?.abort();
  }, []);

  const save = async () => {
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setBusy(true);
    setError("");
    try {
      await api.saveOnboardingBusinessType(toApiId(selected), selected === "other" ? description.trim() : undefined, { signal: controller.signal });
      if (controller.signal.aborted) return;
      router.push("/setup/business-details");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not save the business type.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      savingRef.current = false;
    }
  };

  return (
    <SetupShell headerContinue={false}
      step={1}
      title=""
      description=""
      onContinue={() => void save()}
      continueDisabled={loading || !selected}
      continueBusy={busy}
      className="mt-setup-page--business-type"
    >
        <div className="mt-business-type-main">
          <section className="mt-business-type-card" aria-labelledby="business-type-title">
            <div className="mt-business-type-card__icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M3 9l1-4a3 3 0 0 1 3-2h10a3 3 0 0 1 3 2l1 4M3 9h18M4 9l1 10h14l1-10M8 19v-5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="mt-business-type-heading">
              <h1 id="business-type-title">Business Type</h1>
              <p>Choose the category that best describes your business.</p>
            </div>
            <fieldset className="mt-business-type-fieldset" disabled={loading || busy}>
              <legend className="mt-sr-only">Select your business type</legend>
              <div className="mt-business-type-grid">
                {businessTypes.map(([id, label]) => (
                  <label key={id} className="mt-business-type-option" aria-checked={selected === id}>
                    <input
                      type="radio"
                      name="business-type"
                      value={id}
                      checked={selected === id}
                      onChange={() => setSelected(id)}
                      aria-label={label}
                    />
                    {selected === id && (
                      <span className="mt-business-type-option__check" aria-hidden="true">
                        <svg viewBox="0 0 14 14" fill="none"><path d="m11.67 3.5-6.42 6.42L2.33 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                    )}
                    <span className="mt-business-type-option__visual">
                      <Image src={`/business-types/${id}.webp`} alt="" fill sizes="63px" priority />
                    </span>
                    <span className="mt-business-type-option__label">{label}</span>
                  </label>
                ))}
              </div>
              {selected === "other" && (
                <label className="mt-business-type-description">
                  <span>Describe your business</span>
                  <input value={description} onChange={(event) => setDescription(event.target.value.slice(0, 80))} maxLength={80} />
                </label>
              )}
            </fieldset>
            <Button label={busy ? "Saving…" : "Continue"} variant="primary" width="100%" isDisabled={loading || !selected || busy} isLoading={busy} onClick={() => void save()} />
            {error && <p className="mt-business-type-error" role="alert">{error}</p>}
          </section>
        </div>
    </SetupShell>
  );
}
