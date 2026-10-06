import { expect, test, type Page } from "@playwright/test";

const business = { id: "business-1", name: "Test Cafe", slug: "test-cafe", currency_symbol: "₹", tax_percent: 0 };
const product = { id: "burger-1", name: "Classic Burger", price: 100, is_available: true, category_id: "mains", modifier_groups: [] };
const menu = { business, categories: [{ id: "mains", name: "Mains", is_active: true }], products: [product] };

async function mockTestRuntime(page: Page, app: "counter" | "kitchen" | "kiosk") {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/kiosk/test/session/context/${app}`) return route.fulfill({ json: { session: { id: "session-1", business_id: business.id, expires_at: new Date(Date.now() + 60_000).toISOString(), app_type: app } } });
    if (path === "/api/kiosk/test/session/menu") return route.fulfill({ json: menu });
    if (path === "/api/test/runtime/counter/kitchen-orders" || path === "/api/test/runtime/counter/handover-history" || path === "/api/test/runtime/kitchen/orders" || path === "/api/test/runtime/kitchen/history") return route.fulfill({ json: { orders: [] } });
    if (path === "/api/test/runtime/counter/pending-payments") return route.fulfill({ json: { orders: [] } });
    if (path === "/api/test/runtime/kitchen/availability") return route.fulfill({ json: { products: [product] } });
    if (path === "/api/test/runtime/kitchen/summary") return route.fulfill({ json: { new: 0, preparing: 0, ready: 0, held: 0, delayed: 0 } });
    return route.fulfill({ status: 404, json: { detail: `Unexpected request: ${path}` } });
  });
}

test("standalone Counter and Kitchen routes render their shared apps without the owner shell", async ({ page }) => {
  await mockTestRuntime(page, "counter");
  await page.goto("/test/counter");
  await expect(page.locator(".staff-app")).toBeVisible();
  await expect(page.locator(".staff-brand")).toContainText("TEST MODE");
  await expect(page.locator(".mt-dashboard-shell")).toHaveCount(0);
  await expect(page).toHaveURL(/\/test\/counter/);

  await mockTestRuntime(page, "kitchen");
  await page.goto("/test/kitchen");
  await expect(page.locator(".staff-app")).toBeVisible();
  await expect(page.locator(".staff-brand")).toContainText("TEST MODE");
  await expect(page.locator(".mt-dashboard-shell")).toHaveCount(0);
  await expect(page).toHaveURL(/\/test\/kitchen/);
});

test("missing Test Kiosk session stays in a dedicated recovery state", async ({ page }) => {
  await page.route("**/api/kiosk/test/session/context/kiosk", (route) => route.fulfill({ status: 401, json: { detail: "Test kiosk session is required." } }));
  await page.goto("/test/kiosk");
  await expect(page.getByRole("heading", { name: "PlaceURorder Test Kiosk" })).toBeVisible();
  await expect(page.getByText("Test session unavailable.")).toBeVisible();
  await expect(page).toHaveURL(/\/test\/kiosk$/);
  await expect(page.getByRole("button", { name: "Return to Test Hub" })).toBeVisible();
});

test("expired Test Kitchen session does not fall back to a live device", async ({ page }) => {
  await page.route("**/api/kiosk/test/session/menu", (route) => route.fulfill({ json: menu }));
  await page.route("**/api/kiosk/test/session/context/kitchen", (route) => route.fulfill({ status: 401, json: { detail: "This test kiosk session is invalid or expired." } }));
  await page.goto("/test/kitchen");
  await expect(page.getByText("Test session expired.")).toBeVisible();
  await expect(page).toHaveURL(/\/test\/kitchen$/);
  await expect(page.getByText("Pair or recover device")).toHaveCount(0);
});

test("Test Hub launches actual new tabs to standalone routes", async ({ page, context }) => {
  await context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/businesses/me") return route.fulfill({ json: { business } });
    if (path === "/api/onboarding/status") return route.fulfill({ json: { onboarding_completed: true, next_route: "/dashboard", has_business: true } });
    if (path === "/api/businesses/business-1/administration/locations") return route.fulfill({ json: { locations: [] } });
    if (path === "/api/businesses/business-1/setup/test-sessions") return route.fulfill({ json: { session: { id: "session-1", expires_at: new Date(Date.now() + 60_000).toISOString() } } });
    if (path === "/api/test/runtime/kitchen/orders" || path === "/api/test/runtime/kitchen/history") return route.fulfill({ json: { orders: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/dashboard/test");
  for (const [name, pathname] of [["Test Kiosk", "/test/kiosk"], ["Test Counter", "/test/counter"], ["Test Kitchen", "/test/kitchen"]] as const) {
    await expect(page.getByRole("link", { name: new RegExp(`Open ${name}`) })).toHaveAttribute("href", pathname);
    const popupPromise = context.waitForEvent("page");
    await page.getByRole("link", { name: new RegExp(`Open ${name}`) }).click();
    const popup = await popupPromise;
    await expect.poll(() => new URL(popup.url()).pathname).toBe(pathname);
    await popup.close();
  }
  await expect(page).toHaveURL(/\/dashboard\/test$/);
});
