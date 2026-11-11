"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { safeSetupRoute } from "@/lib/protected-routing";
import { DashboardPage, DashboardPageSkeleton, NoticeBanner } from "@/components/dashboard/kit";

import { AutoRecoveringState } from "@/components/ui/AutoRecoveringState";
import { SetupShellSkeleton } from "@/components/ui/Skeletons";

type ProtectedArea = "dashboard" | "setup";

// The dashboard gate sits inside the app shell, so the navigation stays on screen while the workspace loads.
// Only the content area swaps between a placeholder shaped like the real page and the page itself.
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

  const retry = async () => { await Promise.all([refresh(), refreshOnboarding()]); };

  if (unresolved || redirectTarget) {
    return area === "setup" ? <SetupShellSkeleton /> : <DashboardPageSkeleton />;
  }

  if (loadError || !onboardingStatus) {
    if (area === "dashboard") {
      return (
        <DashboardPage>
          <NoticeBanner
            tone="danger"
            title="Could not verify your workspace"
            description={loadError || "Onboarding status is currently unavailable."}
            role="alert"
            action={<Button label="Try again" variant="secondary" onClick={() => void retry()} />}
          />
        </DashboardPage>
      );
    }
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "#f8fafc" }}>
        <div style={{ width: "100%", maxWidth: "560px" }}>
          <AutoRecoveringState
            title="Could not verify your workspace"
            description={loadError || "Onboarding status is currently unavailable."}
            onRetry={retry}
          />
        </div>
      </div>
    );
  }

  return children;
}
