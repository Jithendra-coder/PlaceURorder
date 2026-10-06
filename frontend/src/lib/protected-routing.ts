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

export function postLoginDestination(serverNextRoute: string, requestedPath: string | null | undefined) {
  if (serverNextRoute !== "/dashboard") return safeSetupRoute(serverNextRoute);
  return safeProtectedReturnPath(requestedPath) ?? serverNextRoute;
}
