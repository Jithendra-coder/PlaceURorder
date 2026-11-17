"use client";

// Local development demo account. The credentials come from NEXT_PUBLIC_DEV_DEMO_EMAIL and
// NEXT_PUBLIC_DEV_DEMO_PASSWORD in a local frontend/.env.local file, which is never committed.
// They are unset in production, so no demo credential is compiled into the production bundle.
// The backend only honours the x-user-id header when ALLOW_DEV_AUTH_BYPASS=true and the environment is local.

export const DEV_DEMO_EMAIL = process.env.NEXT_PUBLIC_DEV_DEMO_EMAIL?.trim() ?? "";
export const DEV_DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEV_DEMO_PASSWORD ?? "";
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

/** True only in development builds where both demo credentials were provided. */
export function devDemoConfigured() {
  return process.env.NODE_ENV !== "production" && DEV_DEMO_EMAIL !== "" && DEV_DEMO_PASSWORD !== "";
}

export function isDevDemoCredentials(identifier: string, password: string) {
  return devDemoConfigured() && identifier.trim().toLowerCase() === DEV_DEMO_EMAIL.toLowerCase() && password === DEV_DEMO_PASSWORD;
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
