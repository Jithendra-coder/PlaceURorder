const PROTECTED_RETURN_ROOTS = ["/dashboard"] as const;
const SETUP_ROUTES = new Set([
  "/setup/business-type",
  "/setup/business-details",
  "/setup/menu-items",
  "/setup/kiosk-layout",
  "/setup/welcome-screen",
  "/setup/test-kiosk",
]);

const LOCAL_ORIGIN = "https://placeurorder.local";
const POST_LOGIN_RETURN_KEY = "menutap.auth.next";

export function safeProtectedReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return null;
    const allowed = PROTECTED_RETURN_ROOTS.some((root) => url.pathname === root || url.pathname.startsWith(`${root}/`));
    return allowed ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

export function safeSetupRoute(value: string | null | undefined) {
  return value && SETUP_ROUTES.has(value) ? value : "/setup/business-type";
}

export function rememberPostLoginReturnPath(value: string | null | undefined) {
  if (typeof window === "undefined") return;
  try {
    const path = safeProtectedReturnPath(value);
    if (path) window.sessionStorage.setItem(POST_LOGIN_RETURN_KEY, path);
    else window.sessionStorage.removeItem(POST_LOGIN_RETURN_KEY);
  } catch {
    // Restricted browser storage should not prevent sign-in.
  }
}

export function takePostLoginReturnPath() {
  if (typeof window === "undefined") return null;
  try {
    const path = window.sessionStorage.getItem(POST_LOGIN_RETURN_KEY);
    window.sessionStorage.removeItem(POST_LOGIN_RETURN_KEY);
    return safeProtectedReturnPath(path);
  } catch {
    return null;
  }
}

export function postLoginDestination(serverNextRoute: string, requestedPath: string | null | undefined) {
  if (serverNextRoute !== "/dashboard") return safeSetupRoute(serverNextRoute);
  return safeProtectedReturnPath(requestedPath) ?? serverNextRoute;
}
