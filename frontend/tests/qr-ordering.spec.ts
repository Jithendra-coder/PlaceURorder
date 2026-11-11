import { expect, test, type Page, type Route } from "@playwright/test";
import { isOnlineOrder, orderSourceLabel } from "../src/features/staff/status";

const business = { id: "business-1", name: "Demo Cafe", slug: "demo-cafe", currency_symbol: "₹", tax_percent: 0 };
const burger = { id: "burger-1", business_id: business.id, category_id: "mains", name: "Classic Burger", description: "Beef patty", price: 199, discount_type: "none", discount_value: 0, is_available: true, modifier_groups: [] };
const menu = {
  business,
  categories: [{ id: "mains", name: "Mains", is_active: true, sort_order: 0 }],
  products: [burger],
};
const storeOpen = {
  name: "Demo Cafe",
  slug: "demo-cafe",
  currency_symbol: "₹",
  tax_percent: 0,
  qr_ordering_enabled: true,
  is_open: true,
  order_modes: ["dine_in", "takeaway"],
  require_customer_name: false,
  require_customer_phone: false,
  allow_customer_notes: true,
  store_url: "https://app.example.test/order/demo-cafe",
};

async function mockStore(page: Page, store: typeof storeOpen, onOrder?: (body: Record<string, unknown>) => void) {
  await page.route("**/api/kiosk/demo-cafe/store", (route) => route.fulfill({ json: store }));
  await page.route("**/api/kiosk/demo-cafe/menu", (route) => route.fulfill({ json: menu }));
  await page.route("**/api/kiosk/demo-cafe/qr-orders", async (route: Route) => {
    onOrder?.(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      json: {
        message: "Order placed.",
        data: {
          id: "order-1",
          business_id: business.id,
          order_number: 7,
          public_token: "tok-7",
          total_amount: 199,
          order_items: [{ id: "item-1", product_name: "Classic Burger", quantity: 1, total_price: 199 }],
        },
      },
    });
  });
}

test("a customer scans the store link, orders on a phone, and gets an order number", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let sent: Record<string, unknown> | null = null;
  await mockStore(page, storeOpen, (body) => { sent = body; });

  await page.goto("/order/demo-cafe");
  await expect(page.getByText("Order online", { exact: true })).toBeVisible();
  await expect(page.getByText("Classic Burger", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /View order/ }).click();
  await expect(page.getByText("Your order", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Place order", exact: true }).click();

  await expect(page.getByText("Order received", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order #7" })).toBeVisible();
  expect(sent).toMatchObject({
    order_type: "takeaway",
    payment_method: "pay_at_counter",
    items: [{ product_id: "burger-1", quantity: 1, customizations: [] }],
  });
});

test("the menu stays visible but ordering is blocked while the owner has QR ordering off", async ({ page }) => {
  await mockStore(page, { ...storeOpen, qr_ordering_enabled: false });
  await page.goto("/order/demo-cafe");
  await expect(page.getByText("Online ordering isn't available right now", { exact: true })).toBeVisible();
  await expect(page.getByText("Classic Burger", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
});

test("a table QR code prefills the table and dine-in checkout asks for it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStore(page, storeOpen);
  await page.goto("/order/demo-cafe?table=4");
  await expect(page.getByText("Table 4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /View order/ }).click();
  await expect(page.getByRole("textbox", { name: "Table number" })).toHaveValue("4");
});

test("the kitchen and counter label QR orders as online, not kiosk", async () => {
  expect(orderSourceLabel("qr")).toBe("Online (QR)");
  expect(orderSourceLabel("counter")).toBe("Counter");
  expect(orderSourceLabel("kiosk")).toBe("Kiosk");
  expect(orderSourceLabel(undefined)).toBe("Kiosk");
  expect(isOnlineOrder("qr")).toBe(true);
  expect(isOnlineOrder("kiosk")).toBe(false);
});
