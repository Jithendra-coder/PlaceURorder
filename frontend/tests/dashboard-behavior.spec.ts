import { expect, test, type Page, type Route } from "@playwright/test";
import type { PromotionRecord } from "../src/lib/api";

const business = { id: "business-1", name: "Test Cafe", slug: "test-cafe", type: "restaurant", brand_color: "#155EEF", kiosk_layout_id: "top-navigation", kiosk_screen_orientation: "portrait", welcome_screen: { enabled: true, heading: "Welcome", supporting_text: "", instruction_text: "", start_button_text: "Start", text_position: "middle", touch_anywhere_to_start: false, show_business_logo: true }, tax_percent: 0, currency_symbol: "₹", currency_code: "INR", order_modes: ["dine_in"], idle_timeout_seconds: 60, order_reset_seconds: 5 };
const product = { id: "product-1", business_id: business.id, category_id: "category-1", name: "Classic Burger", price: 199, is_available: true, menu_status: "shown", sort_order: 0, primary_image_path: null, item_type: "veg", track_stock: false };
const category = { id: "category-1", business_id: business.id, name: "Burgers", is_active: true, sort_order: 0 };
const setup = { unpublishedChanges: 0, lastSavedAt: null, changeSummary: [], requirements: [], setup: { revision: 1 }, status: { published: true, publishable: true, previewComplete: true } };
const dashboard = { revenue_today: 0, active_orders: 0, orders_today: 0, orders_last_hour: 0, orders_past_7_days: 0, items_sold: 0, average_order_value: 0, top_selling_item: null, top_selling_items: [], gross_sales_today: 0, discounts_today: 0, refunds_today: 0, cancellations_today: 0, net_sales_today: 0, weekly_revenue: [], period_start: "2026-08-01T00:00:00Z", period_end: "2026-08-07T23:59:59Z", completed_orders: 0, period_gross_sales: 0, period_discounts: 0, period_refunds: 0, period_cancellations: 0, period_net_sales: 0, period_average_order_value: 0, order_type_summary: {}, payment_method_summary: {}, order_funnel: { started: 0, awaiting_payment: 0, paid: 0, sent: 0, completed: 0, cancelled_or_failed: 0 } };

async function mockDashboard(page: Page, locations: Array<{ id: string; name: string }> = [], options: { failArchive?: boolean; promotions?: PromotionRecord[]; failPromotions?: boolean; failLocations?: boolean; failDashboard?: boolean; failCategories?: boolean; failProducts?: boolean } = {}) {
  let failArchive = Boolean(options.failArchive);
  let failPromotions = Boolean(options.failPromotions);
  let currentPromotions = [...(options.promotions || [])];
  const calls = { dashboard: 0 };
  await page.addInitScript((value) => sessionStorage.setItem("menutap.user", JSON.stringify(value)), { id: "user-1", email: "owner@example.com", full_name: "Owner" });
  await page.route("**/kiosk/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Test kiosk</title>" }));
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    if (path === "/onboarding/status") return route.fulfill({ json: { has_business: true, business_id: business.id, onboarding_step: 6, onboarding_completed: true, next_route: "/dashboard" } });
    if (path === "/businesses/me") return route.fulfill({ json: { business } });
    if (path.endsWith(`/businesses/${business.id}/dashboard`)) { calls.dashboard += 1; return options.failDashboard ? route.fulfill({ status: 500, json: { detail: "Internal server error" } }) : route.fulfill({ json: dashboard }); }
    if (path.endsWith(`/businesses/${business.id}/products`) || path === `/businesses/${business.id}/products`) return options.failProducts ? route.fulfill({ status: 500, json: { detail: "Internal server error" } }) : route.fulfill({ json: { products: [product] } });
    if (path === `/businesses/${business.id}/categories`) return options.failCategories ? route.fulfill({ status: 500, json: { detail: "Internal server error" } }) : route.fulfill({ json: { categories: [category] } });
    if (path === `/businesses/${business.id}/combos`) return route.fulfill({ json: { combos: [] } });
    if (path === `/businesses/${business.id}/setup`) return route.fulfill({ json: setup });
    if (path === `/businesses/${business.id}/administration/locations`) {
      if (options.failLocations) return route.fulfill({ status: 500, json: { detail: "Internal server error" } });
      return route.fulfill({ json: { locations } });
    }
    if (path === `/businesses/${business.id}/promotions`) {
      if (failPromotions) { failPromotions = false; return route.fulfill({ status: 500, json: { detail: "Internal server error" } }); }
      if (method === "POST") {
        const created = { id: "created-1", name: "Saved promotion", status: "active", discount_type: "percentage", discount_value: 20, targets: [{ target_type: "product", target_id: product.id }], location_ids: [] } as PromotionRecord;
        currentPromotions = [created, ...currentPromotions];
        return route.fulfill({ json: created });
      }
      return route.fulfill({ json: { promotions: currentPromotions } });
    }
    if (path === `/businesses/${business.id}/setup/draft-menu`) return route.fulfill({ json: { business: { ...business, welcome_screen: { ...business.welcome_screen, enabled: false } }, categories: [category], products: [product] } });
    if (path === `/businesses/${business.id}/availability`) return route.fulfill({ json: { rules: [], locations, resolved: [{ product_id: product.id, available: true, next_change_at: null, source: "default", reason: null }] } });
    if (path === `/products/${product.id}/availability` && method === "PATCH") return failArchive ? route.fulfill({ status: 500, json: { detail: "Could not save" } }) : route.fulfill({ json: { data: { product } } });
    if (path === `/products/${product.id}` && method === "PATCH") {
      if (failArchive) { failArchive = false; return route.fulfill({ status: 500, json: { detail: "Could not archive" } }); }
      return route.fulfill({ json: { data: { product } } });
    }
    if (path === `/businesses/${business.id}/orders` || path === `/businesses/${business.id}/orders/active`) return route.fulfill({ json: { orders: [] } });
    return route.fulfill({ json: {} });
  });
  return calls;
}

async function openArchive(page: Page) {
  await page.getByRole("button", { name: "Open Classic Burger details" }).click({ force: true });
  const drawer = page.locator("dialog[open]");
  await expect(drawer.getByRole("heading", { name: "Classic Burger" })).toBeVisible();
  await drawer.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("dialog[open]").getByRole("heading", { name: "Archive item?" })).toBeVisible();
}

test("Manage Menu archive dialog is wired to one target and closes safely", async ({ page }) => {
  await mockDashboard(page);
  await page.goto("/dashboard/kiosk-experience/menu?mode=items");
  await expect(page.getByRole("heading", { name: "Manage Menu" })).toBeVisible();
  await openArchive(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive item?" })).toHaveCount(0);
  await openArchive(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Archive item?" })).toHaveCount(0);
  await openArchive(page);
  await page.locator("dialog.mt-overlay--dialog button[aria-label=Close]").click();
  await expect(page.getByRole("heading", { name: "Archive item?" })).toHaveCount(0);
});

test("Manage Menu stays available when dashboard analytics fails", async ({ page }) => {
  const calls = await mockDashboard(page, [], { failDashboard: true });
  await page.goto("/dashboard/kiosk-experience/menu?mode=items");
  await expect(page.getByRole("heading", { name: "Manage Menu" })).toBeVisible();
  expect(calls.dashboard).toBe(0);
});

test("Manage Menu keeps a menu-local error and retry when a required API fails", async ({ page }) => {
  await mockDashboard(page, [], { failCategories: true });
  await page.goto("/dashboard/kiosk-experience/menu?mode=items");
  await expect(page.locator(".mt-state-card")).toContainText("Could not load Manage Menu.");
  await expect(page.locator(".mt-state-card")).toContainText("The server could not complete this request.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Ask AI starts closed and opens as a compact floating panel on desktop and mobile", async ({ page }) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");

  const trigger = page.getByRole("button", { name: "Ask AI" });
  const panel = page.locator("#mt-ai-dialog");
  await expect(trigger).toBeEnabled();
  await expect(panel).toBeHidden();

  const triggerBox = await trigger.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(Math.abs(1280 - (triggerBox!.x + triggerBox!.width) - 24)).toBeLessThanOrEqual(1);
  expect(Math.abs(800 - (triggerBox!.y + triggerBox!.height) - 24)).toBeLessThanOrEqual(1);

  await trigger.click();
  await expect(panel).toBeVisible();
  let panelBox = await panel.boundingBox();
  expect(panelBox?.width).toBeLessThanOrEqual(380);
  expect(panelBox?.height).toBeLessThanOrEqual(520);
  const focusStyles = await panel.locator("textarea").evaluate((element) => ({
    inputOutline: getComputedStyle(element).outlineStyle,
    inputShadow: getComputedStyle(element).boxShadow,
    fieldShadow: getComputedStyle(element.closest("form")!).boxShadow,
    fieldBorder: getComputedStyle(element.closest("form")!).borderTopColor,
  }));
  expect(focusStyles.inputOutline).toBe("none");
  expect(focusStyles.inputShadow).toBe("none");
  expect(focusStyles.fieldShadow).toBe("none");
  expect(focusStyles.fieldBorder).toBe("rgb(132, 202, 255)");
  await panel.getByRole("button", { name: "Close Ask AI" }).click();
  await expect(panel).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(panel).toBeVisible();
  panelBox = await panel.boundingBox();
  expect(panelBox?.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("Insights fails locally while Sales & Orders and Menu Performance render with dashboard data", async ({ page }) => {
  await mockDashboard(page, [], { failDashboard: true });
  await page.goto("/dashboard/insights/sales-reports");
  await expect(page.getByText("Couldn't load Insights", { exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockDashboard(page);
  await page.goto("/dashboard/insights/sales-reports");
  await expect(page.getByRole("heading", { name: "Sales & Orders" })).toBeVisible();
  await page.goto("/dashboard/insights/menu-performance");
  await expect(page.getByRole("heading", { name: "Menu Performance" })).toBeVisible();
});

test("Manage Menu archive success closes and exposes Undo", async ({ page }) => {
  await mockDashboard(page);
  await page.goto("/dashboard/kiosk-experience/menu?mode=items");
  await openArchive(page);
  await page.getByRole("button", { name: "Archive", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Archive item?" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
});

test("Manage Menu archive failure stays recoverable", async ({ page }) => {
  await mockDashboard(page, [], { failArchive: true });
  await page.goto("/dashboard/kiosk-experience/menu?mode=items");
  await openArchive(page);
  await page.getByRole("button", { name: "Archive", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Archive item?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("Availability uses zero, one, and two-location modal rules", async ({ page }) => {
  const locations = [{ id: "location-1", name: "Downtown" }, { id: "location-2", name: "Airport" }];
  await mockDashboard(page, []);
  await page.goto("/dashboard/kiosk-experience/availability");
  await expect(page.getByRole("heading", { name: "Availability" })).toBeVisible();
  await page.locator("label.mt-toggle").first().click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/Apply to \d+ locations\?/)).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockDashboard(page, locations.slice(0, 1));
  await page.reload();
  await page.locator("label.mt-toggle").first().click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/Apply to \d+ locations\?/)).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockDashboard(page, locations);
  await page.reload();
  await page.locator("label.mt-toggle").first().click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Apply to 2 locations?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Apply to 2 locations?" }).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Apply to 2 locations?" })).toHaveCount(0);
});

test("Promotions route has one visible heading and no generic details page", async ({ page }) => {
  await mockDashboard(page);
  await page.goto("/dashboard/kiosk-experience/promotions");
  await expect(page.getByRole("heading", { name: "Promotions", exact: true })).toHaveCount(1);
  await expect(page.getByText("Promotion details", { exact: true })).toHaveCount(0);
});

test("Promotions renders working groups and guarded create types", async ({ page }) => {
  const promotions = [
    { id: "active-1", name: "Burger Weekend", status: "active", discount_type: "percentage", discount_value: 20, targets: [{ target_type: "product", target_id: product.id }], location_ids: [] },
    { id: "scheduled-1", name: "Dinner Deal", status: "scheduled", discount_type: "fixed", discount_value: 100, starts_at: new Date(Date.now() + 86400000).toISOString(), targets: [{ target_type: "product", target_id: product.id }], location_ids: [] },
    { id: "draft-1", name: "Chef Pick", status: "draft", discount_type: "label", discount_value: 0, targets: [{ target_type: "product", target_id: product.id }], location_ids: [] },
    { id: "ended-1", name: "Old Deal", status: "expired", discount_type: "fixed", discount_value: 50, targets: [{ target_type: "product", target_id: product.id }], location_ids: [] },
  ] as PromotionRecord[];
  await mockDashboard(page, [], { promotions });
  await page.goto("/dashboard/kiosk-experience/promotions");
  await expect(page.getByRole("heading", { name: "ACTIVE" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SCHEDULED" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DRAFT" })).toBeVisible();
  await expect(page.getByText("Old Deal", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Ended/ }).click();
  await expect(page.getByText("Old Deal", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create promotion" }).first().click();
  await expect(page.getByRole("heading", { name: "Create promotion" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Buy X get Y/ })).toBeDisabled();
  await page.getByRole("button", { name: "Item discount" }).click();
  await expect(page.getByLabel("Promotion name")).toBeVisible();
});

test("Promotions keeps counts hidden on load failure and recovers on retry", async ({ page }) => {
  const promotions = [{ id: "active-1", name: "Burger Weekend", status: "active", discount_type: "percentage", discount_value: 20, targets: [{ target_type: "product", target_id: product.id }], location_ids: [] }] as PromotionRecord[];
  await mockDashboard(page, [], { promotions, failPromotions: true });
  await page.goto("/dashboard/kiosk-experience/promotions");
  await expect(page.getByText("Couldn’t load promotions.", { exact: true })).toBeVisible();
  await expect(page.getByText("0 active · 0 scheduled", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create promotion" })).toBeEnabled();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("1 active · 0 scheduled", { exact: true })).toBeVisible();
  await expect(page.getByText("Burger Weekend", { exact: true })).toBeVisible();
});

test("Promotions list is usable when optional locations fail", async ({ page }) => {
  const promotions = [{ id: "active-1", name: "Burger Weekend", status: "active", discount_type: "percentage", discount_value: 20, targets: [{ target_type: "product", target_id: product.id }], location_ids: [] }] as PromotionRecord[];
  await mockDashboard(page, [], { promotions, failLocations: true });
  await page.goto("/dashboard/kiosk-experience/promotions");
  await expect(page.getByText("Burger Weekend", { exact: true })).toBeVisible();
  await expect(page.getByText("Couldn’t load promotions.", { exact: true })).toHaveCount(0);
});

test("Promotions create saves and refreshes the real list", async ({ page }) => {
  await mockDashboard(page);
  await page.goto("/dashboard/kiosk-experience/promotions");
  await page.getByRole("button", { name: "Create promotion" }).first().click();
  const editor = page.locator("dialog[open]");
  await expect(editor.getByRole("heading", { name: "Create promotion" })).toBeVisible();
  await editor.getByRole("button", { name: "Item discount" }).click();
  await page.getByLabel("Promotion name").fill("Saved promotion");
  await page.getByRole("checkbox", { name: "Classic Burger" }).check();
  await page.getByRole("button", { name: "Save promotion" }).click();
  await expect(page.getByText("Saved promotion", { exact: true })).toBeVisible();
  await expect(page.getByText("1 active · 0 scheduled", { exact: true })).toBeVisible();
});
