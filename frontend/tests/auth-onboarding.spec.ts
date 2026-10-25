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

test("sign-in error stays readable and the full form is reachable in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 703, height: 503 });
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 502, contentType: "text/html", body: "<html><body>Bad gateway</body></html>" }));
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email or Phone").fill("owner@example.test");
  await page.locator("#password").fill("test-only-not-a-credential");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.locator(".mt-auth-status--error")).toHaveText("The service is temporarily unavailable. Please try again shortly.");

  const card = page.locator(".mt-auth-card");
  await expect(card).toBeVisible();
  expect((await card.boundingBox())?.y).toBeGreaterThanOrEqual(0);
  await expect(page.locator('label[for="identifier"]')).toBeInViewport();

  const signUp = page.getByRole("link", { name: "Sign up" });
  await signUp.scrollIntoViewIfNeeded();
  await expect(signUp).toBeInViewport();
});

test("onboarding uses the shared logo upload and keeps ambient motion behind the form", async ({ page }) => {
  await mockBusinessBootstrap(page, { onboarding_completed: false, next_route: "/setup/business-details" });
  await page.route("**/api/onboarding/business-type", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ business_type: "cafe", business_description: null }) }));

  await page.goto("/setup/business-details");

  await expect(page.getByRole("heading", { name: "Business Details" })).toBeVisible();
  await expect(page.locator('[data-component="noir-ambient-background"]')).toBeVisible();
  await expect(page.getByText("Logo Shape", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Brand Accent Color", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "../qa-artifacts/ui-audit/after/logo-refresh/setup-business-details.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: "../qa-artifacts/ui-audit/after/logo-refresh/setup-business-details-mobile.png", fullPage: true });
  const logoInput = page.locator('input[type="file"]');
  await expect(logoInput).toHaveAttribute("accept", "image/png,image/jpeg,image/gif,image/webp");
  await expect(page.getByText("PNG, JPG, GIF or WebP · 5 MB max")).toBeVisible();
  await logoInput.setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg />") });
  await expect(page.locator(".mt-logo-upload__error")).toContainText("This file wasn’t selected");
  await logoInput.setInputFiles({
    name: "brand.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.locator(".mt-logo-upload__error")).toHaveCount(0);
  await expect(page.getByText("brand.png", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
});

test("onboarding flow stays consistent from business setup through Test Kiosk", async ({ page }) => {
  const business = {
    id: "business-1", name: "Sample Cafe", slug: "sample-cafe", type: "cafe", brand_color: "#0b57f0", kiosk_theme: "top_category:premium_light",
    kiosk_layout_id: "side-navigation", welcome_screen: {
      enabled: true, heading: "Welcome", supporting_text: "Browse our menu and place your order.",
      instruction_text: "Tap start when you are ready.", start_button_text: "Start", text_position: "middle",
      touch_anywhere_to_start: false, show_business_logo: true,
    },
    address_line1: "12 Sample Street", city: "Bengaluru", state: "Karnataka", postal_code: "560001",
    tax_percent: 5, currency_symbol: "₹", order_modes: ["dine_in"], idle_timeout_seconds: 60, order_reset_seconds: 5,
  };
  await mockBusinessBootstrap(page, { onboarding_completed: false, next_route: "/setup/business-type" }, business);
  await page.route("**/api/onboarding/business-type", (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ business_type: "cafe", business_description: null }) })
    : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ business_type: "cafe", business_description: null }) }));
  await page.route("**/api/businesses/business-1", (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: business }) })
    : route.continue());
  await page.route("**/api/businesses/business-1/administration/locations", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ locations: [] }) }));
  await page.route("**/api/businesses/business-1/setup", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      setup: { revision: 0 },
      status: { businessComplete: true, menuComplete: true, kioskSettingsComplete: true, welcomeScreenComplete: true, previewComplete: false, successfulTestComplete: false, publishable: false, published: false },
      requirements: [], unpublishedChanges: 0,
    }),
  }));
  await page.route("**/api/businesses/business-1/setup/test-sessions", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { id: "session-1", business_id: "business-1", token: "test-token", business_slug: "sample-cafe", expires_at: new Date(Date.now() + 60_000).toISOString() } }) })
    : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: null }) }));
  await page.route("**/api/kiosk/test/session/exchange", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { id: "session-1", business_id: "business-1", expires_at: new Date(Date.now() + 60_000).toISOString() } }) }));

  const captureResponsive = async (name: string) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `../qa-artifacts/ui-audit/after/onboarding-polish/${name}-desktop.png`, fullPage: true, style: "nextjs-portal { display: none !important; }" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.screenshot({ path: `../qa-artifacts/ui-audit/after/onboarding-polish/${name}-mobile.png`, fullPage: true, style: "nextjs-portal { display: none !important; }" });
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/setup/kiosk-layout");
  await expect(page.getByText("Choose at least four menu items on the Menu Items step to preview kiosk layouts.")).toBeVisible();
  await expect(page.locator(".mt-setup-error")).toHaveCount(0);
  await expect(page.locator(".mt-onboarding-topbar__continue")).toBeDisabled();
  await page.goto("/setup/welcome-screen");
  await expect(page.getByText("Choose at least four menu items on the Menu Items step to preview the welcome screen.")).toBeVisible();
  await expect(page.locator(".mt-setup-error")).toHaveCount(0);
  await expect(page.locator(".mt-onboarding-topbar__continue")).toBeDisabled();

  await page.goto("/setup/business-type");
  const selectedType = page.locator('.mt-business-type-option[aria-checked="true"]');
  await expect(selectedType).toBeVisible();
  await page.locator(".mt-business-type-option img").evaluateAll((images) => Promise.all(images.map((image) => (image as HTMLImageElement).decode())));
  expect(await selectedType.evaluate((option) => getComputedStyle(option).borderTopColor)).toBe("rgb(52, 64, 84)");
  expect(await page.locator(".mt-business-type-continue").evaluate((button) => getComputedStyle(button).backgroundColor)).toBe("rgb(52, 64, 84)");
  await expect(page.locator(".mt-onboarding-topbar__logo img")).toHaveCount(0);
  await expect(page.locator(".mt-onboarding-topbar__logo")).toContainText("PlaceURorder");
  await captureResponsive("business-type");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(".mt-business-type-continue").click();
  await expect(page).toHaveURL(/\/setup\/business-details$/);
  expect(await page.locator(".mt-tax-mode input:checked").evaluate((input) => getComputedStyle(input).accentColor)).toBe("rgb(52, 64, 84)");
  await captureResponsive("business-details");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(".mt-business-details-actions button").click();
  await expect(page).toHaveURL(/\/setup\/menu-items$/);

  const menuItems = page.locator(".mt-menu-selection-grid button");
  await expect(menuItems).toHaveCount(15);
  for (let index = 0; index < 4; index += 1) await menuItems.nth(index).click();
  const selectedMenuItems = page.locator('.mt-menu-selection-card[aria-pressed="true"]');
  await expect(selectedMenuItems).toHaveCount(4);
  expect(await selectedMenuItems.first().evaluate((card) => getComputedStyle(card).borderTopColor)).toBe("rgb(52, 64, 84)");
  await expect(page.locator(".mt-onboarding-topbar__continue")).toBeEnabled();
  await captureResponsive("menu-items");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(".mt-menu-continue").click();
  await expect(page).toHaveURL(/\/setup\/kiosk-layout$/);
  const frames = page.locator(".mt-virtual-kiosk-frame__viewport");
  await expect(frames).toHaveCount(3);
  expect(await frames.first().evaluate((frame) => getComputedStyle(frame).boxShadow)).toContain("rgb(208, 213, 221)");
  await captureResponsive("kiosk-layout");
  expect(await page.locator(".mt-kiosk-layout-card__preview").first().evaluate((preview) => preview.getBoundingClientRect().height)).toBeLessThanOrEqual(440);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/setup\/welcome-screen$/);
  const welcomeFrame = page.locator(".mt-virtual-kiosk-frame__viewport");
  await expect(welcomeFrame).toBeVisible();
  expect(await welcomeFrame.evaluate((frame) => getComputedStyle(frame).boxShadow)).toContain("rgb(208, 213, 221)");
  await captureResponsive("welcome-screen");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/setup\/test-kiosk$/);
  const testFrame = page.locator(".mt-virtual-kiosk-frame__viewport");
  await expect(testFrame).toBeVisible();
  expect(await testFrame.evaluate((frame) => getComputedStyle(frame).boxShadow)).toContain("rgb(208, 213, 221)");
  await captureResponsive("test-kiosk");
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

test("phone sign-in preserves its return route and routes completed accounts", async ({ page }) => {
  let submittedPhone = "";
  await page.route("**/api/auth/login", async (route) => {
    submittedPhone = String(route.request().postDataJSON().email ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "user-1", email: "owner@example.test" } }) });
  });
  await mockBusinessBootstrap(page, { onboarding_completed: true, next_route: "/dashboard" });

  await page.goto("/auth/sign-in?next=%2Fdashboard%2Foperations%2Flive-orders%3Fview%3Dqueue");
  await page.getByRole("button", { name: "Phone" }).click();
  await expect(page).toHaveURL(/\/auth\/phone\?next=/);
  await page.getByLabel("Phone Number").fill("+1 555 123 4567");
  await page.locator("#password").fill("MenuTapTest1");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/dashboard\/operations\/live-orders\?view=queue$/);
  expect(submittedPhone).toBe("+15551234567");
});

test("Google callback restores the protected page requested before OAuth", async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem("menutap.auth.next", "/dashboard/operations/live-orders?view=queue"));
  await page.route("**/api/auth/oauth/google/exchange", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { id: "user-1", email: "owner@example.test" } }),
  }));
  await mockBusinessBootstrap(page, { onboarding_completed: true, next_route: "/dashboard" });

  await page.goto("/auth/callback?code=oauth-code");

  await expect(page).toHaveURL(/\/dashboard\/operations\/live-orders\?view=queue$/);
  expect(await page.evaluate(() => window.sessionStorage.getItem("menutap.auth.next"))).toBeNull();
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
  await page.route("**/api/businesses/business-1/home-activation", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "new", completed_order_count: 0 }) }));
  await page.route("**/api/businesses/business-1/setup", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ setup: { revision: 0 }, status: { businessComplete: true, menuComplete: false, kioskSettingsComplete: true, welcomeScreenComplete: true, previewComplete: false, successfulTestComplete: false, publishable: false, published: false, testStale: false }, requirements: [], changeSummary: [], unpublishedChanges: 0 }) }));
  await page.route("**/api/businesses/business-1/products**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) }));

  await page.goto("/dashboard");
  await expect(page.getByRole("status", { name: "Loading workspace" })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  releaseStatus?.();
  await expect(page.locator(".mt-dashboard-shell")).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("an onboarding status error stays on the requested route", async ({ page }) => {
  await page.route("**/api/businesses/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ business: null }) }));
  await page.route("**/api/onboarding/status", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Status temporarily unavailable." }) }));
  await page.goto("/dashboard");
  await expect(page.getByText("Could not verify your workspace", { exact: true })).toBeVisible();
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
  await page.route("**/api/businesses/business-1/promotions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ promotions: [] }) }));

  await page.goto("/dashboard/kiosk-experience/preview");
  await expect(page.getByRole("heading", { name: "Preview Kiosk" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard\/kiosk-experience\/preview$/);
  await expect(page.getByRole("heading", { name: "Preview Kiosk" })).toBeVisible();
});
