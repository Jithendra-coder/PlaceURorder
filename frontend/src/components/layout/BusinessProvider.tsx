"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Business } from "@/services/api";
import { ApiError } from "@/lib/api";
import { useAutoReconnect } from "@/lib/connectivity";
import type { BusinessLocation, OnboardingStatus } from "@/lib/types";

type BusinessContextValue = {
  business: Business | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<Business | null>;
  onboardingStatus: OnboardingStatus | null;
  onboardingLoading: boolean;
  onboardingError: string;
  refreshOnboarding: () => Promise<OnboardingStatus | null>;
  locations: BusinessLocation[];
  locationsLoading: boolean;
  locationsError: string;
  selectedLocationId: string | null;
  setSelectedLocationId: (locationId: string | null) => void;
  refreshLocations: () => Promise<BusinessLocation[]>;
};

const BusinessContext = createContext<BusinessContextValue | null>(null);

// The demo deployment signs visitors in again when a session has expired, so no login screen is shown.
function redirectToSignIn(next: string) {
  if (process.env.NEXT_PUBLIC_DEMO_ACCOUNT === "true") {
    window.location.replace("/demo");
    return;
  }
  window.location.replace(`/auth/sign-in?next=${encodeURIComponent(next)}`);
}

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(true);
  const [onboardingError, setOnboardingError] = useState("");
  const redirectingRef = useRef(false);
  const initialLoadStartedRef = useRef(false);
  const [locations, setLocations] = useState<BusinessLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState("");
  const [selectedLocationId, setSelectedLocationIdState] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = (await api.myBusiness()).business;
      setBusiness(next);
      setError("");
      return next;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401 && !redirectingRef.current) {
        redirectingRef.current = true;
        setBusiness(null);
        const next = `${window.location.pathname}${window.location.search}`;
        redirectToSignIn(next);
      }
      setError(cause instanceof Error ? cause.message : "Could not load the business.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshOnboarding = useCallback(async () => {
    setOnboardingLoading(true);
    try {
      const next = await api.onboardingStatus();
      setOnboardingStatus(next);
      setOnboardingError("");
      return next;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401 && !redirectingRef.current) {
        redirectingRef.current = true;
        setOnboardingStatus(null);
        const next = `${window.location.pathname}${window.location.search}`;
        redirectToSignIn(next);
      }
      setOnboardingError(cause instanceof Error ? cause.message : "Could not load onboarding status.");
      return null;
    } finally {
      setOnboardingLoading(false);
    }
  }, []);

  const setSelectedLocationId = useCallback((locationId: string | null) => {
    setSelectedLocationIdState(locationId);
    if (typeof window !== "undefined" && business?.id) window.sessionStorage.setItem(`menutap.location.${business.id}`, locationId || "");
  }, [business]);

  const refreshLocations = useCallback(async () => {
    if (!business?.id) return [];
    setLocationsLoading(true);
    try {
      const next = (await api.locations(business.id)).locations;
      setLocations(next);
      setLocationsError("");
      setSelectedLocationIdState((current) => next.some((location) => location.id === current) ? current : next[0]?.id || null);
      return next;
    } catch (cause) {
      setLocationsError(cause instanceof Error ? cause.message : "Could not load locations.");
      setLocations([]);
      return [];
    } finally {
      setLocationsLoading(false);
    }
  }, [business]);

  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void Promise.resolve().then(() => Promise.all([refresh(), refreshOnboarding()]));
  }, [refresh, refreshOnboarding]);

  useEffect(() => {
    if (!business?.id) { void Promise.resolve().then(() => { setLocations([]); setSelectedLocationIdState(null); }); return; }
    const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(`menutap.location.${business.id}`) : null;
    void Promise.resolve().then(() => setSelectedLocationIdState(stored || null)).then(refreshLocations);
  }, [business?.id, refreshLocations]);

  useAutoReconnect({
    isError: Boolean(error || onboardingError),
    onReconnect: async () => {
      await Promise.all([refresh(), refreshOnboarding()]);
    },
    intervalMs: 3500,
  });

  const value = useMemo(() => ({ business, loading, error, refresh, onboardingStatus, onboardingLoading, onboardingError, refreshOnboarding, locations, locationsLoading, locationsError, selectedLocationId, setSelectedLocationId, refreshLocations }), [business, error, loading, refresh, onboardingStatus, onboardingLoading, onboardingError, refreshOnboarding, locations, locationsLoading, locationsError, selectedLocationId, setSelectedLocationId, refreshLocations]);
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const value = useContext(BusinessContext);
  if (!value) throw new Error("useBusiness must be used inside BusinessProvider.");
  return value;
}
