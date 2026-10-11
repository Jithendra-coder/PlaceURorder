"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { safeSetupRoute } from "@/lib/protected-routing";

import { AutoRecoveringState } from "@/components/ui/AutoRecoveringState";
import { SetupShellSkeleton, WorkspaceSkeleton } from "@/components/ui/Skeletons";

type ProtectedArea = "dashboard" | "setup";

export function ProtectedRouteGate({ area, children }: { area: ProtectedArea; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, error, refresh, onboardingStatus, onboardingLoading, onboardingError, refreshOnboarding } = useBusiness();
  const unresolved = loading || onboardingLoading;
  const loadError = error || onboardingError;
  const redirectTarget = useMemo(() => {
    if (unresolved || loadError || !onboardingStatus) return null;
    if (area === "dashboard" && !onboardingStatus.onboarding_completed) return safeSetupRoute(onboardingStatus.next_route);
    if (area === "setup" && onboardingStatus.onboarding_completed) {
      return pathname === "/setup/test-kiosk" ? "/dashboard/kiosk-experience/publish?test=1" : "/dashboard";
    }
    return null;
  }, [area, loadError, onboardingStatus, pathname, unresolved]);

  useEffect(() => {
    if (redirectTarget) router.replace(redirectTarget);
  }, [redirectTarget, router]);

  if (unresolved || redirectTarget) {
    return area === "setup" ? <SetupShellSkeleton /> : <WorkspaceSkeleton />;
  }

  if (loadError || !onboardingStatus) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "#f8fafc" }}>
        <div style={{ width: "100%", maxWidth: "560px" }}>
          <AutoRecoveringState
            title="Could not verify your workspace"
            description={loadError || "Onboarding status is currently unavailable."}
            onRetry={async () => { await Promise.all([refresh(), refreshOnboarding()]); }}
          />
        </div>
      </div>
    );
  }

  return children;
}
