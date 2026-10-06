import { expect, test } from "@playwright/test";
import { postLoginDestination, safeProtectedReturnPath, safeSetupRoute } from "../src/lib/protected-routing";

async function createSession(page: import("@playwright/test").Page) {
  const email = `playwright-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const start = await page.request.post("/api/auth/signup/start", { data: { email } });
  expect(start.status()).toBe(200);
  const otp = (await start.json()).dev_otp;
  expect(otp).toMatch(/^\d{6}$/);
  expect((await page.request.post("/api/auth/signup/verify", { data: { email, code: otp } })).status()).toBe(200);
  expect((await page.request.post("/api/auth/signup/complete", { data: { password: "PlaceURorderTest1", full_name: "Playwright Test" } })).status()).toBe(200);
}

async function mockBusinessBootstrap(page: import("@playwright/test").Page, status: { onboarding_completed: boolean; next_route: string }, business: Record<string, unknown> | null = null) {
  await page.route("**/api/businesses/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ business }) }));
  await page.route("**/api/onboarding/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ has_business: status.onboarding_completed, business_id: null, onboarding_step: status.onboarding_completed ? 6 : 1, ...status }),
  }));
}

test("new signup keeps one session through onboarding and refresh", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await createSession(page);
  expect((await page.request.get("/api/onboarding/business-type")).status()).toBe(200);

  let saveCount = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/onboarding/business-type") saveCount += 1;
  });
  await page.goto("/setup/business-type");
  await expect(page.getByLabel("Cafe")).toBeEnabled();
  await page.getByText("Cafe", { exact: true }).click();
  await page.locator(".mt-business-type-continue").dblclick();
  await page.waitForURL("**/setup/business-details");
  expect(saveCount).toBe(1);

  expect((await page.request.get("/api/businesses/me")).status()).toBe(200);
  await page.goto("/dashboard");
  await page.waitForURL("**/setup/business-details");
  await page.reload();
  await expect(page).toHaveURL(/\/setup\/business-details$/);
  expect((await page.request.get("/api/businesses/me")).status()).toBe(200);
  expect(browserErrors).toEqual([]);
});

test("one 401 business lookup creates one sign-in transition", async ({ page }) => {
  await createSession(page);
  let businessRequests = 0;
  await page.route("**/api/businesses/me", async (route) => {
    businessRequests += 1;
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication required." } }) });
  });

  await page.goto("/dashboard");
  await page.waitForURL(/\/auth\/sign-in\?next=/);
  expect(businessRequests).toBe(1);
});

test("post-login return paths only restore local dashboard routes", () => {
  expect(safeProtectedReturnPath("/dashboard/operations/live-orders?view=queue#latest")).toBe("/dashboard/operations/live-orders?view=queue#latest");
  expect(safeProtectedReturnPath("https://example.test/dashboard")).toBeNull();
  expect(safeProtectedReturnPath("//example.test/dashboard")).toBeNull();
  expect(safeProtectedReturnPath("/setup/test-kiosk")).toBeNull();
  expect(postLoginDestination("/dashboard", "//example.test/dashboard")).toBe("/dashboard");
  expect(postLoginDestination("/setup/menu-items", "/dashboard/insights/overview")).toBe("/setup/menu-items");
  expect(postLoginDestination("https://example.test", null)).toBe("/setup/business-type");
  expect(safeSetupRoute("https://example.test")).toBe("/setup/business-type");
});

test("completed sign-in restores an allowed dashboard deep link", async ({ page }) => {
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "user-1", email: "owner@example.test" } }) }));
  await mockBusinessBootstrap(page, { onboarding_completed: true, next_route: "/dashboard" });

  await page.goto("/auth/sign-in?next=%2Fdashboard%2Ftest%3Fsource%3Ddeep-link");
  await page.getByLabel("Email or Phone").fill("owner@example.test");
  await page.locator("#password").fill("PlaceURorderTest1");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/dashboard\/test\?source=deep-link$/);
});

test("incomplete dashboard access follows the backend onboarding route", async ({ page }) => {
  await mockBusinessBootstrap(page, { onboarding_completed: false, next_route: "/setup/business-details" });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/setup\/business-details$/);
});

test("a slow completed-status lookup never redirects to setup", async ({ page }) => {
  let releaseStatus: (() => void) | undefined;
  const statusPending = new Promise<void>((resolve) => { releaseStatus = resolve; });
  const business = {
    id: "business-1", name: "Test Cafe", slug: "test-cafe", type: "cafe", brand_color: "#2563eb", kiosk_layout_id: "side-navigation",
    welcome_screen: { enabled: true, heading: "Welcome", supporting_text: "", instruction_text: "", start_button_text: "Start", text_position: "middle", touch_anywhere_to_start: false, show_business_logo: true },
    tax_percent: 0, currency_symbol: "₹", order_modes: ["dine_in"], idle_timeout_seconds: 60, order_reset_seconds: 5,
  };
  await page.route("**/api/businesses/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ business }) }));
  await page.route("**/api/onboarding/status", async (route) => {
    await statusPending;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ has_business: true, business_id: business.id, onboarding_step: 6, onboarding_completed: true, next_route: "/dashboard" }) });
  });
  await page.route("**/api/businesses/business-1/administration/locations", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ locations: [] }) }));

  await page.goto("/dashboard");
  await expect(page.getByRole("status")).toContainText("Loading your workspace");
  await expect(page).toHaveURL(/\/dashboard$/);
  releaseStatus?.();
  await expect(page.locator(".mt-dashboard-shell")).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("an onboarding status error stays on the requested route", async ({ page }) => {
  await page.route("**/api/businesses/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ business: null }) }));
  await page.route("**/api/onboarding/status", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Status temporarily unavailable." }) }));
  await page.goto("/dashboard");
  await expect(page.locator(".mt-state-card[role='alert']")).toContainText("Could not verify your workspace");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("completed setup Test Kiosk redirects to the dashboard-native test dialog", async ({ page }) => {
  const business = {
    id: "business-1", name: "Test Cafe", slug: "test-cafe", type: "cafe", brand_color: "#2563eb", kiosk_layout_id: "side-navigation",
    welcome_screen: { enabled: true, heading: "Welcome", supporting_text: "", instruction_text: "", start_button_text: "Start", text_position: "middle", touch_anywhere_to_start: false, show_business_logo: true },
    tax_percent: 0, currency_symbol: "₹", order_modes: ["dine_in"], idle_timeout_seconds: 60, order_reset_seconds: 5,
  };
  await mockBusinessBootstrap(page, { onboarding_completed: true, next_route: "/dashboard" }, business);
  await page.route("**/api/businesses/business-1/administration/locations", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ locations: [] }) }));
  await page.route("**/api/businesses/business-1/products**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) }));
  await page.route("**/api/businesses/business-1/categories", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [] }) }));
  await page.route("**/api/businesses/business-1/combos", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ combos: [] }) }));
  await page.route("**/api/businesses/business-1/setup", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ setup: { revision: 0 }, status: { businessComplete: true, menuComplete: false, kioskSettingsComplete: true, welcomeScreenComplete: true, previewComplete: false, successfulTestComplete: false, publishable: false, published: false, testStale: false }, requirements: [], changeSummary: [], unpublishedChanges: 0 }) }));
  await page.route("**/api/businesses/business-1/setup/test-sessions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { id: "session-1", business_id: "business-1", token: "test-token", expires_at: new Date(Date.now() + 60_000).toISOString() } }) }));
  await page.route("**/api/kiosk/test/session/exchange", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { id: "session-1", business_id: "business-1", expires_at: new Date(Date.now() + 60_000).toISOString() } }) }));
  await page.goto("/setup/test-kiosk");
  await expect(page).toHaveURL(/\/dashboard\/kiosk-experience\/publish\?test=1$/);
  await expect(page.getByRole("heading", { name: "Test saved kiosk draft" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard\/kiosk-experience\/publish\?test=1$/);
  await expect(page.getByRole("heading", { name: "Test saved kiosk draft" })).toBeVisible();
});

test("a completed owner can open and refresh Preview Kiosk directly", async ({ page }) => {
  const business = {
    id: "business-1", name: "Test Cafe", slug: "test-cafe", type: "cafe", brand_color: "#2563eb", kiosk_layout_id: "side-navigation",
    welcome_screen: { enabled: true, heading: "Welcome", supporting_text: "", instruction_text: "", start_button_text: "Start", text_position: "middle", touch_anywhere_to_start: false, show_business_logo: true },
    tax_percent: 0, currency_symbol: "₹", order_modes: ["dine_in"], idle_timeout_seconds: 60, order_reset_seconds: 5,
  };
  await mockBusinessBootstrap(page, { onboarding_completed: true, next_route: "/dashboard" }, business);
  await page.route("**/api/businesses/business-1/administration/locations", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ locations: [] }) }));
  await page.route("**/api/businesses/business-1/products**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) }));
  await page.route("**/api/businesses/business-1/categories", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [] }) }));
  await page.route("**/api/businesses/business-1/combos", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ combos: [] }) }));
  await page.route("**/api/businesses/business-1/setup", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ setup: { revision: 0 }, status: { businessComplete: true, menuComplete: false, kioskSettingsComplete: true, welcomeScreenComplete: true, previewComplete: false, successfulTestComplete: false, publishable: false, published: false, testStale: false }, requirements: [], changeSummary: [], unpublishedChanges: 0 }) }));

  await page.goto("/dashboard/kiosk-experience/preview");
  await expect(page.getByRole("heading", { name: "Preview Kiosk" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard\/kiosk-experience\/preview$/);
  await expect(page.getByRole("heading", { name: "Preview Kiosk" })).toBeVisible();
});
