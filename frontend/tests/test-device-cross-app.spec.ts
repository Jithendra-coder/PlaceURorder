import { expect, test, type BrowserContext, type Page, type APIRequestContext } from "@playwright/test";

test.describe.configure({ mode: "serial", retries: 0 });

type JsonObject = Record<string, unknown>;

type Diagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  hydrationWarnings: string[];
  serverErrors: string[];
  resourceErrors: string[];
  testKioskRouteResponses: number[];
};

const diagnostics: Diagnostics = { consoleErrors: [], pageErrors: [], hydrationWarnings: [], serverErrors: [], resourceErrors: [], testKioskRouteResponses: [] };

function watchPage(page: Page) {
  page.on("pageerror", (error) => diagnostics.pageErrors.push(`${page.url()} :: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error" && !/hydration/i.test(message.text())) return;
    const entry = `${page.url()} :: ${message.text()}`;
    if (/hydration/i.test(message.text())) diagnostics.hydrationWarnings.push(entry);
    if (message.type() === "error") diagnostics.consoleErrors.push(entry);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.serverErrors.push(`${response.status()} ${response.url()}`);
    if (response.status() >= 400 && response.status() < 500 && /\/test\/kiosk/.test(response.url())) {
      diagnostics.resourceErrors.push(`${response.request().method()} ${response.status()} ${response.url()} ${JSON.stringify(response.request().headers())}`);
    }
  });
}

async function jsonRequest(
  request: APIRequestContext,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  data?: JsonObject,
): Promise<JsonObject> {
  const response = await request.fetch(path, { method, data });
  const body = (await response.json().catch(() => ({}))) as JsonObject;
  expect(response.ok(), `${method} ${path} failed: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

function bodyData(body: JsonObject): JsonObject {
  return (body.data && typeof body.data === "object" ? body.data : body) as JsonObject;
}

function bodyList(body: JsonObject, key: string): JsonObject[] {
  return Array.isArray(body[key]) ? (body[key] as JsonObject[]) : [];
}

function bodyIds(body: JsonObject, key: string): string[] {
  return bodyList(body, key).map((row) => String(row.id)).sort();
}

async function createOwnerSession(request: APIRequestContext) {
  const email = `playwright-device-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const started = await jsonRequest(request, "POST", "/api/auth/signup/start", { email });
  const otp = String(started.dev_otp || "");
  expect(otp).toMatch(/^\d{6}$/);
  await jsonRequest(request, "POST", "/api/auth/signup/verify", { email, code: otp });
  await jsonRequest(request, "POST", "/api/auth/signup/complete", { password: "PlaceURorderTest1", full_name: "Playwright Device Test" });
}

async function refreshButton(page: Page) {
  const button = page.getByRole("button", { name: "Refresh" }).or(page.getByRole("button", { name: "Refresh orders" }));
  await button.first().click();
}

async function openOwnerLink(context: BrowserContext, owner: Page, name: string) {
  const pagePromise = context.waitForEvent("page");
  await owner.getByRole("link", { name: new RegExp(`Open ${name}`) }).click();
  const page = await pagePromise;
  watchPage(page);
  await page.waitForLoadState("domcontentloaded");
  return page;
}

async function completeKitchenOrder(kitchen: Page, orderLabel: string, observingCounter?: Page) {
  await expect.poll(async () => (await kitchen.request.get("/api/test/runtime/kitchen/orders")).json().then((body) => body.orders.filter((order: JsonObject) => String(order.public_token || order.order_number || `TEST-${String(order.id).slice(0, 8).toUpperCase()}`).includes(orderLabel)).length), { timeout: 15_000 }).toBe(1);
  await refreshButton(kitchen);
  const ticket = kitchen.locator("article.kitchen-ticket").filter({ hasText: orderLabel }).first();
  await expect(ticket).toBeVisible();
  await ticket.getByRole("button", { name: "Start Preparing" }).click();
  await expect(ticket.getByRole("button", { name: "Mark Ready" })).toBeDisabled();
  if (observingCounter) {
    await observingCounter.getByRole("tab", { name: "Kitchen Orders" }).click();
    await refreshButton(observingCounter);
    await expect(observingCounter.locator(".staff-table button").filter({ hasText: orderLabel }).filter({ hasText: "preparing" })).toBeVisible();
  }
  await ticket.locator("button.ticket-main").click();
  const drawer = kitchen.getByRole("dialog").filter({ hasText: orderLabel }).last();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Complete" }).click();
  await drawer.locator("header button").click({ force: true });
  await refreshButton(kitchen);
  const readyTicket = kitchen.locator("article.kitchen-ticket").filter({ hasText: orderLabel }).first();
  await expect(readyTicket.getByRole("button", { name: "Mark Ready" })).toBeEnabled();
  await readyTicket.getByRole("button", { name: "Mark Ready" }).click();
  await expect.poll(async () => (await kitchen.request.get("/api/test/runtime/kitchen/orders")).json().then((body) => body.orders.filter((order: JsonObject) => String(order.public_token || order.order_number || `TEST-${String(order.id).slice(0, 8).toUpperCase()}`).includes(orderLabel) && order.kitchen_status === "ready").length), { timeout: 15_000 }).toBe(1);
}

test("real isolated Test Device workflow stays backend-backed across Kiosk, Counter, and Kitchen", async ({ page, context }) => {
  test.setTimeout(120_000);
  context.on("response", (response) => {
    if (new URL(response.url()).pathname === "/test/kiosk") diagnostics.testKioskRouteResponses.push(response.status());
    if (response.status() >= 400 && response.status() < 500 && /\/test\/kiosk/.test(response.url())) {
      diagnostics.resourceErrors.push(`${response.request().method()} ${response.status()} ${response.url()} ${JSON.stringify(response.request().headers())}`);
    }
  });
  watchPage(page);
  await createOwnerSession(page.request);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const businessBody = await jsonRequest(page.request, "POST", "/api/businesses", {
    name: `Playwright Isolated Cafe ${suffix}`,
    slug: `playwright-isolated-${suffix}`,
    type: "cafe",
    onboarding_step: 5,
  });
  const business = bodyData(businessBody);
  const businessId = String(business.id);
  const category = bodyData(await jsonRequest(page.request, "POST", `/api/businesses/${businessId}/categories`, { name: "E2E Menu" }));
  const productName = `E2E Test Bowl ${suffix}`;
  const product = bodyData(await jsonRequest(page.request, "POST", `/api/businesses/${businessId}/products`, {
    category_id: String(category.id), name: productName, price: 125, item_type: "other", is_available: true, menu_status: "shown",
  }));
  const productId = String(product.id);
  const productionBefore = await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/products?include_unavailable=true`);
  const productionProductBefore = bodyList(productionBefore, "products").find((row) => String(row.id) === productId);
  expect(productionProductBefore?.is_available).toBe(true);
  const productionIdsBefore = {
    orders: bodyIds(await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/orders?limit=100`), "orders"),
    payments: bodyIds(await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/payments?limit=100`), "payments"),
    devices: bodyIds(await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/devices`), "devices"),
  };
  const productionSetupBefore = await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/setup`);

  const sessionBody = await jsonRequest(page.request, "POST", `/api/businesses/${businessId}/setup/test-sessions`);
  const session = sessionBody.session as JsonObject;
  await jsonRequest(page.request, "POST", "/api/kiosk/test/session/exchange", { token: String(session.token) });
  await jsonRequest(page.request, "POST", "/api/kiosk/test/session/experience-complete", {
    event_version: 1, order_type: "takeaway", items: [{ preset_id: productId.toLowerCase(), name: productName, quantity: 1 }],
  });

  await page.goto("/dashboard/test");
  await expect(page.getByRole("heading", { name: "Test Device" })).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open Test Kiosk/ })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: /Open Test Counter/ })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: /Open Test Kitchen/ })).toHaveAttribute("target", "_blank");

  const kiosk = await openOwnerLink(context, page, "Test Kiosk");
  const counter = await openOwnerLink(context, page, "Test Counter");
  const kitchen = await openOwnerLink(context, page, "Test Kitchen");
  await expect(page).toHaveURL(/\/dashboard\/test$/);
  await expect(kiosk.locator("[data-testid='kiosk-start-screen']")).toBeVisible();
  await expect(counter.getByRole("tab", { name: "Counter Ordering" })).toBeVisible();
  await expect(kitchen.getByRole("tab", { name: "Live Orders" })).toBeVisible();
  await expect(kiosk.locator("body")).not.toContainText("/device");
  await expect(counter.locator("body")).not.toContainText("Activate");
  await expect(kitchen.locator("body")).not.toContainText("Pair");

  const startButton = kiosk.locator("[data-testid='kiosk-start-screen'] main button");
  if (await startButton.count()) await startButton.first().click({ force: true });
  else await kiosk.getByRole("button", { name: "Touch anywhere to start ordering" }).click();
  await expect(kiosk.locator("[data-testid='kiosk-product-grid']")).toBeVisible();
  await kiosk.getByRole("button", { name: `Add ${productName}` }).click();
  await kiosk.getByRole("button", { name: "View cart and continue" }).click();
  await kiosk.getByRole("button", { name: "Proceed to Payment" }).click();
  await expect(kiosk.getByText("Test Payment", { exact: true })).toBeVisible();
  const kioskCreate = kiosk.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/test/runtime/kiosk/orders");
  await kiosk.getByRole("button", { name: "Proceed with Test Payment" }).click();
  const createdBody = (await (await kioskCreate).json()) as JsonObject;
  const createdOrder = bodyData(createdBody);
  expect(createdOrder.id, `Unexpected Kiosk create response: ${JSON.stringify(createdBody)}`).toBeTruthy();
  const kioskOrderId = String(createdOrder.id);
  const kioskOrderLabel = String(createdOrder.public_token || `TEST-${kioskOrderId.slice(0, 8).toUpperCase()}`);

  await expect.poll(async () => bodyList(await (await counter.request.get("/api/test/runtime/counter/pending-payments")).json() as JsonObject, "orders").filter((order) => String(order.id) === kioskOrderId).length, { timeout: 15_000 }).toBe(1);
  await counter.getByRole("tab", { name: "Kitchen Orders" }).click();
  await refreshButton(counter);
  await counter.getByRole("tab", { name: "Counter Ordering" }).click();
  await counter.getByRole("button", { name: "Kiosk Pay at Counter" }).click();
  await expect(counter.getByRole("heading", { name: "Kiosk Pay at Counter" })).toBeVisible();
  await expect(counter.getByRole("button", { name: new RegExp(kioskOrderLabel) })).toBeVisible();
  await expect((await kitchen.request.get("/api/test/runtime/kitchen/orders")).status()).toBe(200);
  expect(bodyList(await (await kitchen.request.get("/api/test/runtime/kitchen/orders")).json() as JsonObject, "orders").filter((order) => String(order.id) === kioskOrderId)).toHaveLength(0);

  await counter.getByRole("button", { name: new RegExp(kioskOrderLabel) }).click();
  const paymentDialog = counter.getByRole("dialog", { name: "Counter payment" });
  await expect(paymentDialog).toBeVisible();
  await paymentDialog.getByRole("button", { name: /Claim & take payment|Take payment/ }).click();
  await expect.poll(async () => bodyList(await (await kitchen.request.get("/api/test/runtime/kitchen/orders")).json() as JsonObject, "orders").filter((order) => String(order.id) === kioskOrderId).length, { timeout: 15_000 }).toBe(1);
  await refreshButton(kitchen);
  await expect(kitchen.locator("article.kitchen-ticket").filter({ hasText: kioskOrderLabel })).toHaveCount(1);
  await completeKitchenOrder(kitchen, kioskOrderLabel, counter);

  await counter.getByRole("tab", { name: "Kitchen Orders" }).click();
  await refreshButton(counter);
  await expect(counter.getByRole("button").filter({ hasText: kioskOrderLabel }).filter({ hasText: "ready" })).toBeVisible();
  await counter.getByRole("tab", { name: "Counter Ordering" }).click();
  await counter.getByRole("button", { name: "Mark Handed Over" }).click();
  await expect.poll(async () => bodyList(await (await counter.request.get("/api/test/runtime/counter/handover-history")).json() as JsonObject, "orders").filter((order) => String(order.id) === kioskOrderId).length, { timeout: 15_000 }).toBe(1);

  await counter.getByRole("button", { name: "Counter Entry" }).click();
  const directCreate = counter.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/test/runtime/counter/orders");
  await counter.locator(".counter-product-grid").getByRole("button", { name: "Add", exact: true }).click();
  await counter.getByRole("button", { name: "Pay & Send to Kitchen" }).click();
  const directOrder = bodyData((await (await directCreate).json()) as JsonObject);
  const directOrderId = String(directOrder.id);
  const directOrderLabel = `TEST-${directOrderId.slice(0, 8).toUpperCase()}`;
  await expect.poll(async () => bodyList(await (await kitchen.request.get("/api/test/runtime/kitchen/orders")).json() as JsonObject, "orders").filter((order) => String(order.id) === directOrderId).length, { timeout: 15_000 }).toBe(1);
  await completeKitchenOrder(kitchen, directOrderLabel);
  await counter.getByRole("tab", { name: "Kitchen Orders" }).click();
  await refreshButton(counter);
  await expect(counter.locator(".staff-table").getByText(directOrderLabel, { exact: false })).toBeVisible();
  await counter.getByRole("tab", { name: "Counter Ordering" }).click();
  await counter.getByRole("button", { name: "Mark Handed Over" }).click();
  await expect.poll(async () => bodyList(await (await counter.request.get("/api/test/runtime/counter/handover-history")).json() as JsonObject, "orders").filter((order) => String(order.id) === directOrderId).length, { timeout: 15_000 }).toBe(1);

  await counter.getByRole("button", { name: "Counter Entry" }).click();
  const exceptionCreate = counter.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/test/runtime/counter/orders");
  await counter.locator(".counter-product-grid").getByRole("button", { name: "Add", exact: true }).click();
  await counter.getByRole("button", { name: "Pay & Send to Kitchen" }).click();
  const exceptionOrder = bodyData((await (await exceptionCreate).json()) as JsonObject);
  const exceptionOrderId = String(exceptionOrder.id);
  const exceptionOrderLabel = `TEST-${exceptionOrderId.slice(0, 8).toUpperCase()}`;
  await expect.poll(async () => bodyList(await (await kitchen.request.get("/api/test/runtime/kitchen/orders")).json() as JsonObject, "orders").filter((order) => String(order.id) === exceptionOrderId).length, { timeout: 15_000 }).toBe(1);
  await refreshButton(kitchen);
  const exceptionTicket = kitchen.locator("article.kitchen-ticket").filter({ hasText: exceptionOrderLabel }).first();
  await exceptionTicket.getByRole("button", { name: "Start Preparing" }).click();
  await expect.poll(async () => bodyList(await (await kitchen.request.get("/api/test/runtime/kitchen/orders")).json() as JsonObject, "orders").filter((order) => String(order.id) === exceptionOrderId && order.kitchen_status === "preparing").length, { timeout: 15_000 }).toBe(1);
  await refreshButton(kitchen);
  await kitchen.locator("article.kitchen-ticket").filter({ hasText: exceptionOrderLabel }).first().getByRole("button", { name: "Hold" }).click();
  const holdDialog = kitchen.getByRole("dialog", { name: "Hold Kitchen order" });
  await holdDialog.getByRole("textbox").fill("Ingredient check");
  await holdDialog.getByRole("button", { name: "Hold Order" }).click();
  await expect.poll(async () => bodyList(await (await kitchen.request.get("/api/test/runtime/kitchen/orders")).json() as JsonObject, "orders").filter((order) => String(order.id) === exceptionOrderId && order.is_held === true).length, { timeout: 15_000 }).toBe(1);
  await kitchen.locator("button.summary-card.purple").click();
  const heldDrawer = kitchen.getByRole("dialog", { name: "Held orders" });
  await heldDrawer.getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => bodyList(await (await kitchen.request.get("/api/test/runtime/kitchen/orders")).json() as JsonObject, "orders").filter((order) => String(order.id) === exceptionOrderId && order.is_held === false && order.kitchen_status === "preparing").length, { timeout: 15_000 }).toBe(1);

  await kitchen.goto("/test/kitchen?tab=completed");
  await expect(kitchen.getByRole("tab", { name: "Completed" })).toBeVisible();
  await expect(kitchen.locator("body")).toContainText(kioskOrderLabel);
  const kioskHistory = bodyList(await jsonRequest(kitchen.request, "GET", "/api/test/runtime/kitchen/history"), "orders");
  const kioskEvents = (kioskHistory.find((order) => String(order.id) === kioskOrderId)?.lifecycle_events as JsonObject[] | undefined) || [];
  const kioskEventTypes = kioskEvents.map((event) => String(event.event_type));
  expect(kioskEventTypes.filter((eventType) => eventType === "created")).toHaveLength(1);
  expect(kioskEventTypes.filter((eventType) => eventType === "simulated_payment")).toHaveLength(1);
  expect(kioskEventTypes.filter((eventType) => eventType === "kitchen_ready")).toHaveLength(1);
  expect(kioskEventTypes.filter((eventType) => eventType === "counter_handover_completed")).toHaveLength(1);

  await page.reload();
  const activity = page.locator(".mt-test-activity-list");
  await expect(activity).toContainText("Created");
  await expect(activity).toContainText("Simulated Payment");
  await expect(activity).toContainText("Kitchen Preparing Started");
  await expect(activity).toContainText("Kitchen Ready");
  await expect(activity).toContainText("Counter Handover Completed");

  await kitchen.goto("/test/kitchen?tab=availability");
  await expect(kitchen.getByRole("tab", { name: "Item Availability" })).toBeVisible();
  const availabilityRow = kitchen.locator("article").filter({ hasText: productName }).first();
  await availabilityRow.getByRole("button", { name: "Set unavailable" }).click();
  await expect(availabilityRow).toContainText("Unavailable");
  await kitchen.request.delete(`/api/test/runtime/kitchen/availability/${productId}`);
  await expect.poll(async () => {
    const body = await (await page.request.get(`/api/businesses/${businessId}/products?include_unavailable=true`)).json() as JsonObject;
    return Boolean(bodyList(body, "products").find((row) => String(row.id) === productId)?.is_available);
  }).toBe(true);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Reset test data" }).click();
  await expect.poll(async () => bodyList(await (await page.request.get("/api/test/runtime/kitchen/orders")).json() as JsonObject, "orders").length).toBe(0);
  await expect.poll(async () => bodyList(await (await counter.request.get("/api/test/runtime/counter/pending-payments")).json() as JsonObject, "orders").length).toBe(0);
  await expect.poll(async () => bodyList(await (await counter.request.get("/api/test/runtime/counter/handover-history")).json() as JsonObject, "orders").length).toBe(0);
  await expect(page.getByText("No test activity yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByText("Not running", { exact: true })).toBeVisible();
  expect((await kitchen.request.post("/api/test/runtime/counter/orders", { data: { source: "counter", order_type: "takeaway", items: [{ product_id: productId, quantity: 1 }] } })).status()).toBe(401);
  expect((await counter.request.get("/api/test/runtime/counter/pending-payments")).status()).toBe(401);

  const productionAfter = await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/products?include_unavailable=true`);
  const productionProductAfter = bodyList(productionAfter, "products").find((row) => String(row.id) === productId);
  expect(productionProductAfter?.is_available).toBe(productionProductBefore?.is_available);
  expect(bodyIds(await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/orders?limit=100`), "orders")).toEqual(productionIdsBefore.orders);
  expect(bodyIds(await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/payments?limit=100`), "payments")).toEqual(productionIdsBefore.payments);
  expect(bodyIds(await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/devices`), "devices")).toEqual(productionIdsBefore.devices);
  const productionSetupAfter = await jsonRequest(page.request, "GET", `/api/businesses/${businessId}/setup`);
  expect(productionSetupAfter.signature).toBe(productionSetupBefore.signature);
  expect(productionSetupAfter.lastPublishedAt).toBe(productionSetupBefore.lastPublishedAt);
  expect(diagnostics.hydrationWarnings, diagnostics.hydrationWarnings.join("\n")).toEqual([]);
  expect(diagnostics.pageErrors, diagnostics.pageErrors.join("\n")).toEqual([]);
  expect(diagnostics.testKioskRouteResponses).toContain(200);
  const actionableConsoleErrors = diagnostics.consoleErrors.filter((message) => !(/\/test\/kiosk :: Failed to load resource: the server responded with a status of 404/.test(message) && diagnostics.testKioskRouteResponses.includes(200)));
  expect([...actionableConsoleErrors, ...diagnostics.resourceErrors], [...actionableConsoleErrors, ...diagnostics.resourceErrors].join("\n")).toEqual([]);
  expect(diagnostics.serverErrors, diagnostics.serverErrors.join("\n")).toEqual([]);
});
