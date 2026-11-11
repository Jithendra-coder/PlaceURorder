"use client";

import type { AuthSession, AuthUser } from "@/lib/types";
import { clearDevDemoSession } from "@/lib/dev-demo";

const TOKEN_KEY = "menutap.access_token";
const USER_KEY = "menutap.user";
const LEGACY_TOKEN_KEY = "front" + "zy.access_token";
const LEGACY_USER_KEY = "front" + "zy.user";

function getSessionStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function clearLegacyLocalAuth() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
    window.localStorage.removeItem(LEGACY_USER_KEY);
  } catch {
    // Ignore storage access failures in restricted browser contexts.
  }
}

function getSessionValue(storage: Storage, key: string, legacyKey: string) {
  const value = storage.getItem(key);
  if (value) return value;
  const legacyValue = storage.getItem(legacyKey);
  if (!legacyValue) return null;
  storage.setItem(key, legacyValue);
  storage.removeItem(legacyKey);
  return legacyValue;
}

export const auth = {
  setSession(session: AuthSession) {
    this.setUser(session.user);
  },
  setUser(user: AuthUser) {
    const storage = getSessionStorage();
    if (!storage) return;
    clearLegacyLocalAuth();
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(LEGACY_TOKEN_KEY);
    storage.setItem(USER_KEY, JSON.stringify(user));
  },
  getUser(): AuthUser | null {
    const storage = getSessionStorage();
    if (!storage) return null;
    const raw = getSessionValue(storage, USER_KEY, LEGACY_USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },
  clear() {
    clearDevDemoSession();
    const storage = getSessionStorage();
    storage?.removeItem(TOKEN_KEY);
    storage?.removeItem(USER_KEY);
    storage?.removeItem(LEGACY_TOKEN_KEY);
    storage?.removeItem(LEGACY_USER_KEY);
    clearLegacyLocalAuth();
  },
};
