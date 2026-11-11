import { expect, test } from "@playwright/test";

const business = { id: "business-1", name: "Test Cafe", currency_symbol: "₹", tax_percent: 0 };
const device = { id: "device-1", business_id: business.id, device_type: "counter", status: "online", location_label: "Main Counter" };
const burger = { id: "burger-1", name: "Classic Burger", price: 100, is_available: true, category_id: "mains", modifier_groups: [] };

async function mockCounter(page: import("@playwright/test").Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/devices/live/session") return route.fulfill({ json: { business, device } });
    if (path === "/api/counter/live/session/menu") return route.fulfill({ json: { business, device, categories: [{ id: "mains", name: "Mains", is_active: true }], products: [burger] } });
    if (path === "/api/counter/live/session/kitchen-orders" || path === "/api/counter/live/session/handover-history") return route.fulfill({ json: { orders: [] } });
    if (path === "/api/counter/live/session/held-orders") return route.fulfill({ json: { held_orders: [] } });
    if (path === "/api/counter/live/session/payments") return route.fulfill({ json: { payments: [] } });
    return route.fulfill({ status: 404, json: { detail: "Unexpected test request" } });
  });
}

test("Counter product tiles derive quantity from the current order", async ({ page }) => {
  await mockCounter(page);
  await page.goto("/device");
  await expect(page.getByText("Current order", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("1 item", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Increase Classic Burger", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Increase Classic Burger", exact: true }).click();
  await expect(page.getByText("2 items", { exact: true })).toBeVisible();
  await expect(page.getByText("₹200.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Decrease Classic Burger", exact: true }).click();
  await expect(page.getByText("1 item", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Decrease Classic Burger", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await expect(page.getByText("0 items", { exact: true })).toBeVisible();
});
