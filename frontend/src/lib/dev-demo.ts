"use client";

// Local development demo account. Every export is inert in production builds:
// the NODE_ENV guard is constant-folded, so the demo credentials are not shipped.
// The backend only honours the x-user-id header when ALLOW_DEV_AUTH_BYPASS=true
// and the environment is local.

export const DEV_DEMO_EMAIL = "demo@placeurorder.local";
export const DEV_DEMO_PASSWORD = "PlaceURorder-Demo-2026";
export const DEV_DEMO_USER_ID = "7e570000-0000-4000-8000-000000000001";
const DEV_USER_KEY = "menutap.dev_user_id";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isDevDemoCredentials(identifier: string, password: string) {
  return process.env.NODE_ENV !== "production" && identifier.trim().toLowerCase() === DEV_DEMO_EMAIL && password === DEV_DEMO_PASSWORD;
}

export function activateDevDemoSession() {
  if (process.env.NODE_ENV === "production") return;
  storage()?.setItem(DEV_USER_KEY, DEV_DEMO_USER_ID);
}

export function clearDevDemoSession() {
  storage()?.removeItem(DEV_USER_KEY);
}

/** The user id to send as x-user-id, or null. Always null in production builds. */
export function devUserIdHeader(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  return storage()?.getItem(DEV_USER_KEY) ?? null;
}
