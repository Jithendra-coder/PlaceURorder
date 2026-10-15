"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LogoUploadField } from "@/components/ui/LogoUploadField";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { SetupField, SetupInput, SetupSelect, SetupShell } from "@/components/layout/SetupShell";
import { api } from "@/services/api";

const states = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh",
  "Lakshadweep", "Puducherry",
] as const;

type Details = {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  state: string;
  city: string;
  postal: string;
  address: string;
  taxMode: "inclusive" | "exclusive";
  tax: string;
  gstin: string;
  fssai: string;
};

const empty: Details = {
  name: "", tagline: "", phone: "", email: "",
  state: "", city: "", postal: "", address: "", taxMode: "inclusive", tax: "5", gstin: "", fssai: "",
};

export default function BusinessDetailsPage() {
  const router = useRouter();
  const { business, loading, refresh } = useBusiness();
  const businessId = business?.id || "new";
  const [draft, setDraft] = useState<{ id: string; value: Details }>({ id: "new", value: empty });
  const [logo, setLogo] = useState<File | null>(null);
  const [onboardingType, setOnboardingType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api.onboardingBusinessType().then(({ business_type }) => {
      if (active) setOnboardingType(business_type || "");
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const details = useMemo(() => {
    if (draft.id === businessId) return draft.value;
    if (!business) return empty;
    return {
      ...empty,
      name: business.name,
      tagline: business.tagline || "",
      phone: business.contact_phone || "",
      state: business.state || "",
      city: business.city || "",
      postal: business.postal_code || "",
      address: business.address_line1 || "",
      tax: String(business.tax_percent || 5),
    };
  }, [business, businessId, draft]);
  const update = <K extends keyof Details>(key: K, value: Details[K]) => setDraft({ id: businessId, value: { ...details, [key]: value } });
  const valid = details.name.trim().length > 1 && details.state && details.city.trim() && details.postal.length === 6 && details.address.trim();
  const selectedType = onboardingType || business?.type || "other";
  const typeId = selectedType === "retail" ? "retail-store" : selectedType === "ice_cream" ? "ice-cream" : selectedType;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const businessType = await api.onboardingBusinessType();
      const type = businessType.business_type || business?.type || "other";
      const payload = {
        name: details.name.trim(),
        type,
        business_subtype: type === "other" ? businessType.business_description : null,
        tagline: details.tagline.trim() || null,
        contact_phone: details.phone.trim() || null,
        address_line1: details.address.trim(),
        city: details.city.trim(),
        state: details.state,
        postal_code: details.postal,
        tax_percent: Number(details.tax) || 0,
        onboarding_step: 2,
      };
      let saved = business ? await api.updateBusiness(business.id, payload) : await api.createBusiness(payload);
      if (logo) {
        const uploaded = await api.uploadBrandAsset(saved.id, logo);
        saved = await api.updateBusiness(saved.id, { logo_path: uploaded.path });
      }
      await refresh();
      router.push("/setup/menu-items");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the business details.");
      setBusy(false);
    }
  };

  return (
    <SetupShell step={2} title="Business Details" description="Add the essential information for your kiosk." onContinue={() => void save()} continueDisabled={loading || !valid} continueBusy={busy} className="mt-setup-page--details">
      <section className="mt-business-details-card">
        <div className="mt-business-details-card__heading">
          <div className="mt-setup-heading">
            <h1>Business Details</h1>
            <p>Add the essential information for your kiosk.</p>
          </div>
          <span className="mt-autosave" aria-live="polite">{busy ? "Saving…" : error}</span>
        </div>

        <div className="mt-business-identity">
          <div className="mt-business-fields">
            <SetupField id="business-name" label="Business Name" required>
              <SetupInput id="business-name" value={details.name} onChange={(event) => update("name", event.target.value)} placeholder="Enter your business name" maxLength={60} required />
            </SetupField>
            <SetupField id="tagline" label="Tagline" optional>
              <SetupInput id="tagline" value={details.tagline} onChange={(event) => update("tagline", event.target.value)} placeholder="Add a short tagline for your business" maxLength={60} />
            </SetupField>
            <div className="mt-business-pair">
              <SetupField id="phone" label="Contact Number">
                <div className="mt-phone-control"><span>+91</span><SetupInput id="phone" value={details.phone} onChange={(event) => update("phone", event.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="tel" /></div>
              </SetupField>
              <SetupField id="email" label="Business Email" optional>
                <SetupInput id="email" type="email" value={details.email} onChange={(event) => update("email", event.target.value)} placeholder="Enter business email address" />
              </SetupField>
            </div>
          </div>

          <aside className="mt-business-media">
            <LogoUploadField value={business?.logo_path} onFile={setLogo} onClearSelection={() => setLogo(null)} />
            <div className="mt-business-media__selected"><span className="mt-business-media__label">Selected Business</span><div className="mt-business-type-preview"><Image src={`/business-types/${typeId}.webp`} alt="" width={80} height={80} /><strong>{typeId.replaceAll("-", " ")}</strong></div></div>
          </aside>
        </div>

        <h2>Business Location</h2>
        <div className="mt-business-location">
          <SetupField id="state" label="State / Union Territory" required><SetupSelect id="state" value={details.state} onChange={(event) => update("state", event.target.value)}><option value="">Select state</option>{states.map((state) => <option key={state}>{state}</option>)}</SetupSelect></SetupField>
          <SetupField id="city" label="City" required><SetupInput id="city" value={details.city} onChange={(event) => update("city", event.target.value)} /></SetupField>
          <SetupField id="postal" label="Postal Code" required><SetupInput id="postal" value={details.postal} onChange={(event) => update("postal", event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} /></SetupField>
          <div className="mt-span-3"><SetupField id="street" label="Street Address" required><SetupInput id="street" value={details.address} onChange={(event) => update("address", event.target.value)} /></SetupField></div>
        </div>

        <h2>Tax &amp; Invoicing Settings</h2>
        <div className="mt-business-tax">
          <fieldset className="mt-tax-mode"><legend>Tax Calculation Mode<i aria-hidden="true">*</i></legend>{(["inclusive", "exclusive"] as const).map((mode) => <label key={mode} aria-checked={details.taxMode === mode}><input type="radio" name="tax-mode" checked={details.taxMode === mode} onChange={() => update("taxMode", mode)} /><span>{mode === "inclusive" ? "Prices Include Tax" : "Tax Added at Checkout"}</span><b title={mode === "inclusive" ? "Final price shown upfront." : "Tax is added at final payment."}>i</b></label>)}</fieldset>
          <SetupField id="tax" label="Default Tax Rate (%)" required><SetupSelect id="tax" value={details.tax} onChange={(event) => update("tax", event.target.value)}><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="0">0% — Exempt</option></SetupSelect></SetupField>
          <SetupField id="gstin" label="GSTIN Number" optional><SetupInput id="gstin" value={details.gstin} onChange={(event) => update("gstin", event.target.value.toUpperCase().slice(0, 15))} placeholder="e.g. 29AAAAA0000A1Z5" /></SetupField>
        </div>

        <div className="mt-business-details-actions"><button type="button" className="mt-setup-primary" onClick={() => void save()} disabled={!valid || busy}>{busy ? "Saving..." : "Start your journey"}</button></div>
      </section>
    </SetupShell>
  );
}
