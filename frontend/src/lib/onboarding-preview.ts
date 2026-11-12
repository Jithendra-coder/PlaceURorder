// Demo-only onboarding preview. The setup screens open for an existing business so the flow can be shown,
// and nothing they do is saved. It is only active on the demo build, only under /setup, and only after
// the onboarding demo link has been opened in this tab.
const KEY = "menutap.onboarding-preview";

export function onboardingPreviewActive(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_ACCOUNT !== "true" || typeof window === "undefined") return false;
  try {
    if (!window.location.pathname.startsWith("/setup")) {
      window.sessionStorage.removeItem(KEY);
      return false;
    }
    if (new URLSearchParams(window.location.search).get("preview") === "onboarding") {
      window.sessionStorage.setItem(KEY, "1");
    }
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
