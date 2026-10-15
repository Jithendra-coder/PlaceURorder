import { expect, test, type Page } from "@playwright/test";

const business = { id: "business-1", name: "Test Cafe", slug: "test-cafe", type: "cafe", brand_color: "#155eef", kiosk_layout_id: "side-navigation", welcome_screen: { enabled: true, heading: "Welcome", supporting_text: "", instruction_text: "", start_button_text: "Start", text_position: "middle", touch_anywhere_to_start: false, show_business_logo: true }, tax_percent: 0, currency_symbol: "₹", order_modes: ["takeaway"], idle_timeout_seconds: 60, order_reset_seconds: 5 };
const stats = { revenue_today: 0, active_orders: 0, orders_today: 0, orders_last_hour: 0, orders_past_7_days: 0, items_sold: 0, average_order_value: 0, top_selling_item: null, top_selling_items: [], gross_sales_today: 0, discounts_today: 0, refunds_today: 0, cancellations_today: 0, net_sales_today: 0, weekly_revenue: [], completed_orders: 0, period_gross_sales: 0, period_discounts: 0, period_refunds: 0, period_cancellations: 0, period_net_sales: 0, period_average_order_value: 0, order_type_summary: {}, payment_method_summary: {}, order_funnel: {} };

async function mockDashboard(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/onboarding/status") return route.fulfill({ json: { has_business: true, business_id: business.id, onboarding_step: 6, onboarding_completed: true, next_route: "/dashboard" } });
    if (path === "/businesses/me") return route.fulfill({ json: { business } });
    if (path.endsWith("/dashboard")) return route.fulfill({ json: stats });
    if (path.endsWith(`/businesses/${business.id}/insights`)) return route.fulfill({ json: { stats, previous: stats, recent_orders: [] } });
    if (path.endsWith("/orders") || path.endsWith("/orders/active")) return route.fulfill({ json: { orders: [] } });
    if (path.endsWith("/products")) return route.fulfill({ json: { products: [] } });
    if (path.endsWith("/categories")) return route.fulfill({ json: { categories: [] } });
    if (path.endsWith("/combos")) return route.fulfill({ json: { combos: [] } });
    if (path.endsWith("/devices")) return route.fulfill({ json: { devices: [] } });
    if (path.endsWith("/payments")) return route.fulfill({ json: { payments: [], summary: { total_collected: 0, paid_count: 0, failed_count: 0 } } });
    if (path.endsWith("/payment-accounts")) return route.fulfill({ json: { accounts: [] } });
    if (path.endsWith("/payment-location-assignments")) return route.fulfill({ json: { assignments: [] } });
    if (path.endsWith("/administration/locations")) return route.fulfill({ json: { locations: [] } });
    return route.fulfill({ json: {} });
  });
}

test("normal dashboard navigation stays expanded; Full Analytics alone compacts the sidebar", async ({ page }) => {
  await mockDashboard(page);
  for (const path of ["/dashboard", "/dashboard/insights/sales-reports", "/dashboard/insights/menu-performance", "/dashboard/operations/live-orders", "/dashboard/kiosk-experience/menu", "/dashboard/administration/payments"]) {
    await page.goto(path);
    await expect(page.locator(".mt-dashboard-shell")).toHaveAttribute("data-collapsed", "false");
  }
  await page.goto("/dashboard/insights/sales-reports");
  await page.getByRole("link", { name: /Full Analytics/ }).click();
  await expect(page.locator(".mt-dashboard-shell")).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("link", { name: /Sales & Orders/ }).click();
  await expect(page.locator(".mt-dashboard-shell")).toHaveAttribute("data-collapsed", "false");
});

test("collapsed sidebar is an icon rail with flyouts and preserves manual preference", async ({ page }) => {
  await mockDashboard(page);
  await page.goto("/dashboard/insights/sales-reports");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".mt-dashboard-shell")).toHaveAttribute("data-collapsed", "true");
  await expect(page.locator(".mt-dashboard-sidebar")).toHaveCSS("width", "76px");

  await page.getByRole("button", { name: "Open Insights" }).click();
  const flyout = page.getByRole("navigation", { name: "Insights navigation" });
  await expect(flyout).toBeVisible();
  await flyout.getByRole("link", { name: "Menu Performance" }).click();
  await expect(page).toHaveURL(/\/dashboard\/insights\/menu-performance$/);
  await expect(page.locator(".mt-dashboard-shell")).toHaveAttribute("data-collapsed", "true");

  await page.goto("/dashboard/insights/sales-reports");
  await page.getByRole("link", { name: /Full Analytics/ }).click();
  await expect(page.locator(".mt-dashboard-shell")).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("link", { name: /Sales & Orders/ }).click();
  await expect(page.locator(".mt-dashboard-shell")).toHaveAttribute("data-collapsed", "true");

  const testDevice = page.getByRole("link", { name: "Test Device" });
  await expect(testDevice).toBeVisible();
  await testDevice.click();
  await expect(page).toHaveURL(/\/dashboard\/test$/);
});
