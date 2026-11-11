"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Lock, Minus, Plus, RefreshCw, Trash2, UtensilsCrossed, Wifi, WifiOff } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Tab as AstryxTab, TabList } from "@astryxdesign/core/TabList";
import { Table } from "@astryxdesign/core/Table";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { AstryxDashboardProviders } from "@/components/dashboard/AstryxDashboardProviders";
import { DetailDrawer, DetailRow, EmptyBlock, Metric, NoticeBanner, Panel, StatusBadge } from "@/components/dashboard/kit";
import { SegmentedShare } from "@/components/dashboard/charts";
import { DeviceCard, DeviceFrame, DeviceLoading } from "@/components/device/DeviceFrame";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import type { Category, KioskMenu, LiveDeviceContext, ModifierOption, Order, Product } from "@/lib/types";
import { connectionLabel, elapsedLabel, kitchenLabel, kitchenStage, orderSourceLabel } from "@/features/staff/status";
import { listQueuedCounterOrders, queueCounterOrder, removeQueuedCounterOrder, updateQueuedCounterOrder } from "./offline-store";
import { testDeviceContext, testOrder, testSessionStateMessage } from "@/features/test-runtime";

type Tab = "ordering" | "kitchen" | "handover";
type Source = "counter" | "kiosk";
type CartLine = { product: Product; quantity: number; customizations: Array<{ option_id: string; name: string; price_delta: number }> };
type PendingPaymentRow = { id: string; business_id?: string; amount?: number; status: string; item_count?: number; claim?: { device_id: string }; order?: { source?: string | null; order_number?: string | number | null; public_token?: string | null; order_type?: string; table_label?: string | null; total_amount?: number; notes?: string | null; items?: Array<{ product_id: string; quantity: number; name?: string; product_name?: string }> } };

const makeId = () => crypto.randomUUID();

export function CounterApp({ runtimeMode = "live" }: { runtimeMode?: "live" | "test" }) {
  const isTest = runtimeMode === "test";
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "ordering");
  const [context, setContext] = useState<LiveDeviceContext | null>(null);
  const [menu, setMenu] = useState<KioskMenu | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [history, setHistory] = useState<Order[]>([]);
  const [pending, setPending] = useState<PendingPaymentRow[]>([]);
  const [held, setHeld] = useState<Array<Record<string, unknown>>>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [source, setSource] = useState<Source>("counter");
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("takeaway");
  const [table, setTable] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("pay_at_counter");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PendingPaymentRow | null>(null);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [modifierSelection, setModifierSelection] = useState<ModifierOption[]>([]);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [shellError, setShellError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(0);

  const setAreaError = (area: string, value = "") => setErrors((current) => ({ ...current, [area]: value }));
  const syncLocal = useCallback(async () => {
    if (isTest) { setQueued(0); return; }
    const local = await listQueuedCounterOrders();
    if (!online) { setQueued(local.length); return; }
    for (const item of local) {
      try { await api.liveCounterSessionCreateOrder(item.payload, item.idempotencyKey); await removeQueuedCounterOrder(item.localId); }
      catch (error) { await updateQueuedCounterOrder({ ...item, status: "failed", retryCount: item.retryCount + 1, lastError: error instanceof Error ? error.message : "Synchronization failed" }); }
    }
    setQueued((await listQueuedCounterOrders()).length);
  }, [isTest, online]);
  const refreshOperational = useCallback(async () => {
    const businessId = menu?.business.id || context?.business.id || "test";
    if (isTest) {
      const [nextOrders, nextHistory, nextPending] = await Promise.allSettled([api.testCounterKitchenOrders(), api.testCounterHandoverHistory(), api.testCounterPendingPayments()]);
      if (nextOrders.status === "fulfilled") { setOrders(nextOrders.value.orders.map((order) => testOrder(order, businessId))); setAreaError("queue"); } else setAreaError("queue", "Couldn't load Kitchen Queue.");
      if (nextHistory.status === "fulfilled") { setHistory(nextHistory.value.orders.map((order) => testOrder(order, businessId))); setAreaError("history"); } else setAreaError("history", "Couldn't load Handover History.");
      setHeld([]); setAreaError("held");
      if (nextPending.status === "fulfilled") { setPending(nextPending.value.orders.map((raw) => { const order = testOrder(raw, businessId); return { id: order.id, business_id: order.business_id, amount: order.total_amount, status: order.payment_status, item_count: order.order_items?.reduce((count, item) => count + item.quantity, 0), order: { ...order, items: order.order_items?.map((item) => ({ product_id: item.product_id || "", quantity: item.quantity, product_name: item.product_name })) } }; })); setAreaError("payments"); } else setAreaError("payments", "Payment status unavailable.");
      return;
    }
    const [nextOrders, nextHistory, nextHeld, nextPending] = await Promise.allSettled([api.liveCounterKitchenOrders(), api.liveCounterHandoverHistory(), api.liveCounterHeldOrders(), api.liveCounterPendingPayments()]);
    if (nextOrders.status === "fulfilled") { setOrders(nextOrders.value.orders); setAreaError("queue"); } else setAreaError("queue", "Couldn't load Kitchen Queue.");
    if (nextHistory.status === "fulfilled") { setHistory(nextHistory.value.orders); setAreaError("history"); } else setAreaError("history", "Couldn't load Handover History.");
    if (nextHeld.status === "fulfilled") { setHeld(nextHeld.value.held_orders); setAreaError("held"); } else setAreaError("held", "Couldn't load held orders.");
    if (nextPending.status === "fulfilled") { setPending(nextPending.value.payments as PendingPaymentRow[]); setAreaError("payments"); } else setAreaError("payments", "Payment status unavailable.");
  }, [context?.business.id, isTest, menu?.business.id]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextMenu = isTest ? await api.testKioskSessionMenu() : await api.liveCounterSessionMenu();
      const session = isTest ? await api.testRuntimeContext("counter") : await api.liveDeviceSessionContext("counter");
      setContext(isTest ? testDeviceContext(nextMenu, "counter") : (session as LiveDeviceContext));
      setMenu(nextMenu); setShellError(""); setAreaError("menu");
      await Promise.all([syncLocal(), refreshOperational()]);
    } catch (error) {
      setShellError(error instanceof Error ? error.message : isTest ? "Test session unavailable or expired." : "Counter session unavailable. Pair or reactivate this device.");
    } finally { setLoading(false); }
  }, [isTest, refreshOperational, syncLocal]);
  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);
  useEffect(() => { const onlineHandler = () => { setOnline(true); void load(); }; const offlineHandler = () => setOnline(false); const timer = window.setInterval(() => setNow(Date.now()), 1000); const refreshTimer = window.setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void refreshOperational(); }, 15000); addEventListener("online", onlineHandler); addEventListener("offline", offlineHandler); return () => { removeEventListener("online", onlineHandler); removeEventListener("offline", offlineHandler); clearInterval(timer); clearInterval(refreshTimer); }; }, [load, refreshOperational]);
  const switchTab = (next: Tab) => { setTab(next); router.replace(isTest ? `/test/counter?tab=${next}` : `/device?tab=${next}`); };
  const currency = menu?.business.currency_symbol || "";
  const products = useMemo(() => (menu?.products || []).filter((product) => (category === "all" || product.category_id === category) && product.name.toLowerCase().includes(search.toLowerCase())), [category, menu?.products, search]);
  const subtotal = cart.reduce((sum, line) => sum + (line.product.price + line.customizations.reduce((total, item) => total + item.price_delta, 0)) * line.quantity, 0);
  const tax = subtotal * Number(menu?.business.tax_percent || 0) / 100;
  const total = subtotal + tax;
  const itemCount = cart.reduce((count, line) => count + line.quantity, 0);
  const productQuantities = useMemo(() => cart.reduce((quantities, line) => quantities.set(line.product.id, (quantities.get(line.product.id) || 0) + line.quantity), new Map<string, number>()), [cart]);
  const readyOrders = orders.filter((order) => order.status === "ready");
  const queueOrders = orders.filter((order) => order.status !== "ready" && order.status !== "completed").slice(0, 4);
  const addProduct = (product: Product) => { if (!product.is_available) return; if (product.modifier_groups?.length) { setModifierProduct(product); setModifierSelection(product.modifier_groups.flatMap((group) => group.options.filter((option) => option.is_default))); return; } setCart((current) => { const index = current.findIndex((line) => line.product.id === product.id && !line.customizations.length); return index < 0 ? [...current, { product, quantity: 1, customizations: [] }] : current.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: line.quantity + 1 } : line); }); };
  const decreaseProduct = (product: Product) => setCart((current) => { const index = current.map((line) => line.product.id).lastIndexOf(product.id); return index < 0 ? current : current.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: line.quantity - 1 } : line).filter((line) => line.quantity > 0); });
  const confirmModifiers = () => { if (!modifierProduct) return; for (const group of modifierProduct.modifier_groups || []) { const count = modifierSelection.filter((option) => option.group_id === group.id).length; if (group.is_required && count < group.min_select) { setNotice(`Select ${group.name} before adding ${modifierProduct.name}.`); return; } if (group.max_select && count > group.max_select) { setNotice(`Select no more than ${group.max_select} ${group.name} options.`); return; } } setCart((current) => [...current, { product: modifierProduct, quantity: 1, customizations: modifierSelection.map((option) => ({ option_id: option.id, name: option.name, price_delta: option.price_delta })) }]); setModifierProduct(null); setModifierSelection([]); };
  const orderPayload = () => isTest
    ? { source: "counter", order_type: orderType, table_label: orderType === "dine_in" ? table || null : null, notes: notes || null, idempotency_key: `counter-${makeId()}`, items: cart.map((line) => ({ product_id: line.product.id, quantity: line.quantity, modifiers: line.customizations })) }
    : { order_type: orderType, table_label: orderType === "dine_in" ? table || null : null, notes: notes || null, payment_method: paymentMethod, items: cart.map((line) => ({ product_id: line.product.id, quantity: line.quantity, customizations: line.customizations })) };
  const newOrder = () => { if (!cart.length || window.confirm("Discard the current order? Choose Cancel to keep it, or OK to discard it.")) { setCart([]); setTable(""); setNotes(""); setNotice(""); } };
  const holdOrder = async () => { if (!cart.length) return; if (isTest) { setNotice("Test Counter does not persist unfinished drafts."); return; } setBusy("hold"); try { await api.liveCounterHoldOrder(orderPayload()); setCart([]); setTable(""); setNotes(""); setNotice("Order held. It has not been sent to Kitchen."); await refreshOperational(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not hold this order."); } finally { setBusy(""); } };
  const placeOrder = async () => { if (!cart.length || (orderType === "dine_in" && !table.trim())) { setNotice(orderType === "dine_in" ? "Add a table number before payment." : "Add an item before payment."); return; } const payload = orderPayload(); const idempotencyKey = `counter-${makeId()}`; setBusy("payment"); try { if (isTest) { const created = await api.testRuntimeCreateOrder(payload); await api.testRuntimeMarkPaid(String(created.id)); } else { const order = await api.liveCounterSessionCreateOrder(payload, idempotencyKey); const payment = order.payment?.payment; if (payment?.id && ["cash", "pay_at_counter"].includes(paymentMethod)) { if (payment.status !== "paid") await api.liveCounterClaimPayment(payment.id); await api.liveCounterSessionMarkPaid(payment.id, { business_id: order.business_id, amount: order.total_amount, method: paymentMethod }); } } setCart([]); setTable(""); setNotes(""); setNotice("Payment confirmed and order sent to Kitchen."); await refreshOperational(); } catch (error) { const message = error instanceof Error ? error.message : "Payment could not be confirmed."; if (!isTest && (!online || /network|offline|fetch/i.test(message))) { await queueCounterOrder({ localId: makeId(), idempotencyKey, payload: payload as Record<string, unknown>, createdAt: new Date().toISOString(), status: "pending", retryCount: 0 }); setQueued((count) => count + 1); setNotice("Saved locally. Payment and Kitchen dispatch will wait for a safe retry."); } else setNotice(message); } finally { setBusy(""); } };
  const handover = async (order: Order) => { setBusy(order.id); try { if (isTest) await api.testCounterHandover(order.id); else await api.liveCounterSessionCompleteOrder(order.id, { business_id: order.business_id }); setNotice(`Order #${order.order_number || order.public_token} handed over.`); await refreshOperational(); } catch (error) { setNotice(error instanceof Error ? error.message : "Handover could not be completed."); } finally { setBusy(""); } };
  const resumeHeld = async (item: Record<string, unknown>) => { setBusy(String(item.id)); try { const resumed = await api.liveCounterResumeHeldOrder(String(item.id)); const payload = resumed.payload as { items?: Array<{ product_id: string; quantity: number; customizations?: Array<{ option_id: string; name: string; price_delta: number }> }>; order_type?: "dine_in" | "takeaway"; table_label?: string; notes?: string }; const lines = (payload.items || []).flatMap((entry) => { const product = menu?.products.find((candidate) => candidate.id === entry.product_id); return product ? [{ product, quantity: entry.quantity, customizations: entry.customizations || [] }] : []; }); setCart(lines); setOrderType(payload.order_type || "takeaway"); setTable(payload.table_label || ""); setNotes(payload.notes || ""); setSource("counter"); switchTab("ordering"); await refreshOperational(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not resume held order."); } finally { setBusy(""); } };
  if (shellError && !context) {
    return (
      <DeviceFrame>
        <DeviceCard title={isTest ? "Test Counter" : "PlaceURorder Counter"} description={isTest ? testSessionStateMessage(new Error(shellError)) : shellError}>
          <VStack gap={3}>
            <Button label="Try again" variant="secondary" width="100%" onClick={() => void load()} />
            <Button label={isTest ? "Return to Test Hub" : "Pair or recover device"} variant="primary" width="100%" onClick={() => router.push(isTest ? "/dashboard/test" : "/device/start")} />
          </VStack>
        </DeviceCard>
      </DeviceFrame>
    );
  }
  if (loading && !context) return <DeviceLoading title="PlaceURorder Counter" message="Loading the counter" />;

  const alert = context?.device.status === "warning" || context?.device.status === "issue";
  const activeOrders = orders.filter((order) => order.status !== "ready" && order.status !== "completed");
  const exitDevice = () => (isTest ? router.push("/dashboard/test") : void api.clearLiveDeviceSession().then(() => router.push("/device/start")));
  const counterHandovers = history.filter((order) => order.source === "counter").length;
  const qrHandovers = history.filter((order) => order.source === "qr").length;
  // Only counter payment methods the owner has enabled are offered; the store default is pay at counter.
  const enabledPayments = menu?.business.payment_summary?.enabled_methods ?? [];
  const counterPaymentOptions = [{ value: "pay_at_counter", label: "Pay at counter" }, { value: "cash", label: "Cash" }].filter((option) => enabledPayments.length === 0 ? option.value === "pay_at_counter" : enabledPayments.includes(option.value));
  const handoverParts = [{ id: "counter", label: "Counter entry", value: counterHandovers }, { id: "qr", label: "Online (QR)", value: qrHandovers }, { id: "kiosk", label: "Kiosk", value: Math.max(history.length - counterHandovers - qrHandovers, 0) }];

  return (
    <AstryxDashboardProviders>
      <VStack gap={0} style={{ minHeight: "100vh", background: "var(--color-background-muted)" }}>
        <CounterHeader context={context} online={online} queued={queued} testMode={isTest} onLock={exitDevice} />
        <VStack gap={0} style={{ background: "var(--color-background-card)", borderBottom: "1px solid var(--color-border)", padding: "0 20px" }}>
          <HStack gap={4} vAlign="center" style={{ padding: "12px 0" }}>
            <TabList value={tab} onChange={(value) => switchTab(value as Tab)} size="sm" layout="hug">
              <AstryxTab value="ordering" label="Counter ordering" />
              <AstryxTab value="kitchen" label="Kitchen orders" />
              <AstryxTab value="handover" label="Handover history" />
            </TabList>
          </HStack>
        </VStack>

        <VStack gap={5} style={{ padding: 20 }}>
          {notice && <NoticeBanner tone="info" title={notice} role="status" />}

          <Grid columns={{ minWidth: 200, repeat: "fit" }} gap={4} align="start">
            <Metric label="In the kitchen" value={activeOrders.length} hint="Orders being prepared" />
            <Metric label="Ready for handover" value={readyOrders.length} hint="Waiting at the counter" />
            <Metric label="To collect" value={pending.length} hint="Pay at counter: kiosk and QR orders" />
            <Metric label="Offline sync" value={online ? (queued ? `${queued} pending` : "Clear") : "Offline"} hint={online ? "Connected to the server" : "Saved locally until reconnect"} />
            <Metric label="Device" value={alert ? "Needs attention" : "Normal"} hint={alert ? "Check this device" : "Reporting normally"} />
          </Grid>

          {tab === "ordering" && (
            <HStack gap={5} vAlign="start" wrap="wrap">
              <div style={{ flex: "1 1 460px", minWidth: 0 }}>
                <Panel title="Menu" description={`${products.length} ${products.length === 1 ? "item" : "items"} shown`}>
                  <VStack gap={4}>
                    <HStack gap={3} vAlign="end" wrap="wrap">
                      <SegmentedControl label="Order type" value={orderType} onChange={(value) => setOrderType(value as "dine_in" | "takeaway")}>
                        <SegmentedControlItem value="takeaway" label="Takeaway" />
                        <SegmentedControlItem value="dine_in" label="Dine in" />
                      </SegmentedControl>
                      <TextInput label="Search menu items" isLabelHidden value={search} onChange={setSearch} placeholder="Search menu items" width={240} />
                      <HStack gap={2} style={{ marginLeft: "auto" }}>
                        <Button label="Hold order" variant="secondary" isDisabled={!cart.length || !!busy} onClick={() => void holdOrder()} />
                        <Button label="New order" variant="primary" onClick={newOrder} />
                      </HStack>
                    </HStack>
                    <HStack gap={3} vAlign="end" wrap="wrap">
                      <SegmentedControl label="Order source" value={source} onChange={(value) => setSource(value as Source)}>
                        <SegmentedControlItem value="counter" label="Counter entry" />
                        <SegmentedControlItem value="kiosk" label={pending.length ? `Pay at counter (${pending.length})` : "Pay at counter"} />
                      </SegmentedControl>
                      {orderType === "dine_in" && <TextInput label="Table number" value={table} onChange={setTable} width={160} />}
                    </HStack>
                    {menu?.categories?.length ? (
                      <SegmentedControl label="Category" value={category} onChange={setCategory}>
                        <SegmentedControlItem value="all" label="All items" />
                        {menu.categories.filter((item: Category) => item.is_active).map((item: Category) => <SegmentedControlItem key={item.id} value={item.id} label={item.name} />)}
                      </SegmentedControl>
                    ) : null}
                    {errors.menu ? (
                      <NoticeBanner tone="danger" title={errors.menu} action={<Button label="Retry" variant="secondary" size="sm" onClick={() => void load()} />} role="alert" />
                    ) : products.length ? (
                      <Grid columns={{ minWidth: 148, repeat: "fit" }} gap={3} align="start">
                        {products.map((product) => <ProductTile key={product.id} product={product} currency={currency} quantity={productQuantities.get(product.id) || 0} onAdd={() => addProduct(product)} onDecrease={() => decreaseProduct(product)} />)}
                      </Grid>
                    ) : (
                      <EmptyBlock title="No items match" description="Try another search or category." />
                    )}
                  </VStack>
                </Panel>
              </div>

              <div style={{ flex: "0 1 360px", minWidth: 300 }}>
                {source === "counter" ? (
                  <Panel title="Current order" description="Counter entry · draft" actions={<StatusBadge tone="info">{`${itemCount} ${itemCount === 1 ? "item" : "items"}`}</StatusBadge>}>
                    <VStack gap={4}>
                      {cart.length ? (
                        <VStack gap={3}>
                          {cart.map((line, index) => (
                            <HStack key={`${line.product.id}-${index}`} gap={3} vAlign="start" hAlign="between">
                              <HStack gap={2} vAlign="center">
                                <IconButton label={`Decrease ${line.product.name} quantity`} variant="secondary" size="sm" icon={<Minus size={14} aria-hidden="true" />} onClick={() => setCart((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, quantity: Math.max(0, item.quantity - 1) } : item).filter((item) => item.quantity > 0))} />
                                <Text type="body" weight="semibold" color="primary">{String(line.quantity)}</Text>
                                <IconButton label={`Increase ${line.product.name} quantity`} variant="secondary" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setCart((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, quantity: item.quantity + 1 } : item))} />
                              </HStack>
                              <VStack gap={0} style={{ flex: 1, minWidth: 0 }}>
                                <Text type="body" weight="semibold" color="primary">{line.product.name}</Text>
                                <Text type="supporting" color="secondary">{line.customizations.map((item) => item.name).join(", ") || "No modifiers"}</Text>
                              </VStack>
                              <HStack gap={1} vAlign="center">
                                <Text type="body" color="primary">{formatCurrency((line.product.price + line.customizations.reduce((sum, item) => sum + item.price_delta, 0)) * line.quantity, currency)}</Text>
                                <IconButton label={`Remove ${line.product.name}`} variant="ghost" size="sm" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setCart((current) => current.filter((_, currentIndex) => currentIndex !== index))} />
                              </HStack>
                            </HStack>
                          ))}
                        </VStack>
                      ) : (
                        <EmptyBlock title="No items yet" description="Choose an item from the menu to start this order." />
                      )}
                      <TextArea label="Order note" rows={2} value={notes} onChange={setNotes} />
                      <VStack gap={1}>
                        <HStack hAlign="between"><Text type="supporting" color="secondary">Subtotal</Text><Text type="supporting" color="primary">{formatCurrency(subtotal, currency)}</Text></HStack>
                        <HStack hAlign="between"><Text type="supporting" color="secondary">Tax</Text><Text type="supporting" color="primary">{formatCurrency(tax, currency)}</Text></HStack>
                        <HStack hAlign="between"><Text type="body" weight="semibold" color="primary">Total</Text><Text type="label" color="primary">{formatCurrency(total, currency)}</Text></HStack>
                      </VStack>
                      <Selector label="Payment method" value={paymentMethod} onChange={setPaymentMethod} options={counterPaymentOptions} />
                      <Button label={busy === "payment" ? "Confirming payment…" : "Pay & send to Kitchen"} variant="primary" width="100%" isLoading={busy === "payment"} isDisabled={!cart.length || !!busy} onClick={() => void placeOrder()} />
                      {queued ? <Text type="supporting" color="secondary">{`${queued} ${queued > 1 ? "orders" : "order"} awaiting safe sync.`}</Text> : null}
                    </VStack>
                  </Panel>
                ) : (
                  <Panel title="Orders to collect" description="Kiosk and QR orders paid at the counter. Collect payment, then hand over when ready.">
                    {errors.payments ? (
                      <NoticeBanner tone="warning" title={errors.payments} role="status" />
                    ) : pending.length ? (
                      <VStack gap={2}>
                        {pending.map((row) => (
                          <Button key={row.id} label={`#${row.order?.order_number || row.order?.public_token || row.id.slice(0, 8)} · ${orderSourceLabel(row.order?.source)} · ${row.item_count || 0} items · ${formatCurrency(Number(row.amount || row.order?.total_amount || 0), currency)}`} variant="secondary" width="100%" onClick={() => setSelectedPayment(row)} />
                        ))}
                      </VStack>
                    ) : (
                      <EmptyBlock title="No kiosk orders waiting" description="Orders placed on the kiosk for counter payment appear here." />
                    )}
                  </Panel>
                )}
              </div>

              <div style={{ flex: "0 1 300px", minWidth: 260 }}>
                <VStack gap={4}>
                  <Panel title="Kitchen queue" actions={<StatusBadge tone="info">{`${queueOrders.length} active`}</StatusBadge>}>
                    <VStack gap={3}>
                      {errors.queue ? (
                        <NoticeBanner tone="danger" title={errors.queue} role="alert" />
                      ) : queueOrders.length ? queueOrders.map((order) => (
                        <HStack key={order.id} gap={3} vAlign="center" hAlign="between">
                          <VStack gap={0}>
                            <Text type="body" weight="semibold" color="primary">{`#${order.order_number || order.public_token}`}</Text>
                            <Text type="supporting" color="secondary">{`${kitchenLabel(kitchenStage(order) || "pending")} · ${elapsedLabel(order.placed_at, now)} · ${(order.order_items || []).length} items`}</Text>
                          </VStack>
                          <Button label={`Open order ${order.order_number || order.public_token}`} variant="ghost" size="sm" onClick={() => { setSelectedOrder(order); switchTab("kitchen"); }} />
                        </HStack>
                      )) : (
                        <EmptyBlock title="No active Kitchen orders" description="Orders sent to the Kitchen show here." />
                      )}
                      <Button label="View full Kitchen queue" variant="ghost" width="100%" onClick={() => switchTab("kitchen")} />
                    </VStack>
                  </Panel>

                  <Panel title="Ready for handover" actions={<StatusBadge tone="success">{`${readyOrders.length} ready`}</StatusBadge>}>
                    <VStack gap={3}>
                      {readyOrders.length ? readyOrders.slice(0, 4).map((order) => (
                        <HStack key={order.id} gap={3} vAlign="center" hAlign="between">
                          <VStack gap={0}>
                            <Text type="body" weight="semibold" color="primary">{`#${order.order_number || order.public_token}`}</Text>
                            <Text type="supporting" color="secondary">{`${(order.order_items || []).length} items · ${formatCurrency(order.total_amount, currency)}`}</Text>
                          </VStack>
                          <Button label="Mark handed over" variant="primary" size="sm" isDisabled={!!busy} onClick={() => void handover(order)} />
                        </HStack>
                      )) : (
                        <EmptyBlock title="No orders are ready" description="Finished orders wait here for handover." />
                      )}
                    </VStack>
                  </Panel>

                  {alert ? (
                    <NoticeBanner tone="warning" title="Device needs attention" description="This counter reported a problem. Check the device." role="status" />
                  ) : (
                    <NoticeBanner tone="success" title="No device alerts" description="Counter device is reporting normally." role="status" />
                  )}
                </VStack>
              </div>
            </HStack>
          )}

          {tab === "kitchen" && (
            <KitchenOrdersView orders={orders} pending={pending} error={errors.queue} currency={currency} busy={busy} now={now} onRefresh={refreshOperational} onOpen={setSelectedOrder} onPayment={setSelectedPayment} />
          )}

          {tab === "handover" && (
            <VStack gap={5}>
              <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4} align="start">
                <Metric label="Handed over" value={history.length} hint="Completed on this counter" />
                <Panel title="Handover source" description="Share of handovers by where the order came from.">
                  {history.length ? (
                    <SegmentedShare ariaLabel="Handovers by source" parts={handoverParts} format={(value) => String(Math.round(value))} />
                  ) : (
                    <Text type="supporting" color="secondary">No handovers yet.</Text>
                  )}
                </Panel>
              </Grid>
              <Panel title="Handover history" description="Completed handovers for this device." actions={<Button label="Refresh" variant="secondary" size="sm" onClick={() => void refreshOperational()} />}>
                {errors.history ? (
                  <NoticeBanner tone="danger" title={errors.history} action={<Button label="Retry" variant="secondary" size="sm" onClick={() => void refreshOperational()} />} role="alert" />
                ) : history.length ? (
                  <Table
                    idKey="id"
                    data={history as Array<Order & Record<string, unknown>>}
                    columns={[
                      { key: "order", header: "Order", renderCell: (row: Order) => `#${row.order_number || row.public_token}` },
                      { key: "source", header: "Source", renderCell: (row: Order) => orderSourceLabel(row.source) },
                      { key: "total", header: "Total", align: "end", renderCell: (row: Order) => formatCurrency(row.total_amount, currency) },
                      { key: "ready", header: "Ready at", renderCell: (row: Order) => (row.ready_at ? new Date(row.ready_at).toLocaleTimeString() : "—") },
                      { key: "handed", header: "Handed over", renderCell: (row: Order) => (row.completed_at ? new Date(row.completed_at).toLocaleTimeString() : "—") },
                      { key: "prep", header: "Kitchen prep", renderCell: (row: Order) => (row.prep_started_at && row.ready_at ? elapsedLabel(row.prep_started_at, new Date(row.ready_at).getTime()) : elapsedLabel(row.placed_at, now)) },
                    ]}
                  />
                ) : (
                  <EmptyBlock title="No handovers yet" description="Handed-over orders appear here." />
                )}
              </Panel>
            </VStack>
          )}

          {held.length > 0 && tab === "ordering" && (
            <Panel title="Held counter orders" description="Incomplete orders only. They have not been sent to Kitchen.">
              <VStack gap={3}>
                {held.map((item) => (
                  <HStack key={String(item.id)} gap={3} vAlign="center" hAlign="between">
                    <VStack gap={0}>
                      <Text type="body" weight="semibold" color="primary">{String(item.order_reference || "Held order")}</Text>
                      <Text type="supporting" color="secondary">{item.created_at ? new Date(String(item.created_at)).toLocaleTimeString() : "Saved"}</Text>
                    </VStack>
                    <Button label="Resume" variant="secondary" size="sm" isDisabled={!!busy} onClick={() => void resumeHeld(item)} />
                  </HStack>
                ))}
              </VStack>
            </Panel>
          )}
        </VStack>
      </VStack>

      {modifierProduct && <ModifierDrawer product={modifierProduct} selected={modifierSelection} currency={currency} onToggle={(option) => setModifierSelection((current) => current.some((item) => item.id === option.id) ? current.filter((item) => item.id !== option.id) : [...current, option])} onClose={() => setModifierProduct(null)} onConfirm={confirmModifiers} />}
      {selectedPayment && <PaymentDrawer row={selectedPayment} currency={currency} testMode={isTest} onClose={() => setSelectedPayment(null)} onRefresh={refreshOperational} />}
      {selectedOrder && <OrderDrawer order={selectedOrder} currency={currency} busy={busy} onClose={() => setSelectedOrder(null)} onHandover={(order) => { setSelectedOrder(null); void handover(order); }} />}
    </AstryxDashboardProviders>
  );
}

function CounterHeader({ context, online, queued, testMode, onLock }: { context: LiveDeviceContext | null; online: boolean; queued: number; testMode: boolean; onLock: () => void }) {
  return (
    <HStack gap={4} vAlign="center" hAlign="between" wrap="wrap" style={{ background: "var(--color-background-card)", borderBottom: "1px solid var(--color-border)", padding: "14px 20px" }}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Heading level={2} weight="semibold">Counter</Heading>
        <StatusBadge tone="info">{testMode ? "Test mode" : "Counter display"}</StatusBadge>
        <Text type="supporting" color="secondary">{context?.device.location_label || context?.business.name || "Assigned location"}</Text>
      </HStack>
      <HStack gap={3} vAlign="center">
        <StatusBadge tone={online ? "success" : "warning"}>
          <HStack gap={1} vAlign="center">{online ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}{testMode ? "Test session · current" : connectionLabel(online, queued)}</HStack>
        </StatusBadge>
        <IconButton label="Lock device" variant="ghost" icon={<Lock size={18} aria-hidden="true" />} onClick={onLock} />
      </HStack>
    </HStack>
  );
}

function ProductTile({ product, currency, quantity, onAdd, onDecrease }: { product: Product; currency: string; quantity: number; onAdd: () => void; onDecrease: () => void }) {
  return (
    <Card padding={3} elevation="low">
      <VStack gap={2}>
        <div style={{ position: "relative", height: 88, borderRadius: 10, overflow: "hidden", background: "var(--color-background-muted)", display: "grid", placeItems: "center" }}>
          {product.primary_image_path ? <Image src={product.primary_image_path} alt="" fill sizes="160px" unoptimized /> : <UtensilsCrossed size={26} aria-hidden="true" />}
        </div>
        <VStack gap={0}>
          <Text type="body" weight="semibold" color="primary">{product.name}</Text>
          <Text type="supporting" color="secondary">{formatCurrency(product.price, currency)}</Text>
        </VStack>
        {!product.is_available ? (
          <StatusBadge tone="neutral">Unavailable</StatusBadge>
        ) : quantity ? (
          <HStack gap={2} vAlign="center" hAlign="between">
            <IconButton label={`Decrease ${product.name}`} variant="secondary" size="sm" icon={<Minus size={14} aria-hidden="true" />} onClick={onDecrease} />
            <Text type="body" weight="semibold" color="primary">{String(quantity)}</Text>
            <IconButton label={`Increase ${product.name}`} variant="secondary" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={onAdd} />
          </HStack>
        ) : (
          <Button label="Add" variant="secondary" size="sm" width="100%" onClick={onAdd} />
        )}
      </VStack>
    </Card>
  );
}

function KitchenOrdersView({ orders, pending, error, currency, busy, now, onRefresh, onOpen, onPayment }: { orders: Order[]; pending: PendingPaymentRow[]; error?: string; currency: string; busy: string; now: number; onRefresh: () => Promise<void>; onOpen: (order: Order) => void; onPayment: (row: PendingPaymentRow) => void }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = orders.filter((order) => !query || String(order.order_number || order.public_token).toLowerCase().includes(query) || order.status.toLowerCase().includes(query));
  return (
    <VStack gap={5}>
      <Panel title="Kitchen orders" description="Track status and handover. Preparation actions stay on the Kitchen display." actions={<IconButton label="Refresh orders" variant="ghost" size="sm" icon={<RefreshCw size={15} aria-hidden="true" />} onClick={() => void onRefresh()} />}>
        <VStack gap={4}>
          <TextInput label="Search orders" isLabelHidden value={search} onChange={setSearch} placeholder="Search by order number or status" width={320} />
          {error ? (
            <NoticeBanner tone="danger" title={error} action={<Button label="Retry" variant="secondary" size="sm" onClick={() => void onRefresh()} />} role="alert" />
          ) : visible.length ? (
            <Table
              idKey="id"
              data={visible as Array<Order & Record<string, unknown>>}
              columns={[
                { key: "order", header: "Order", renderCell: (row: Order) => `#${row.order_number || row.public_token}` },
                { key: "source", header: "Source", renderCell: (row: Order) => orderSourceLabel(row.source) },
                { key: "payment", header: "Payment", renderCell: (row: Order) => row.payment_status },
                { key: "status", header: "Kitchen status", renderCell: (row: Order) => <StatusBadge tone={row.status === "ready" ? "success" : row.status === "completed" ? "neutral" : "info"}>{row.status}</StatusBadge> },
                { key: "elapsed", header: "Elapsed", renderCell: (row: Order) => elapsedLabel(row.placed_at, now) },
                { key: "open", header: "", align: "end", renderCell: (row: Order) => <Button label={`Details for order ${row.order_number || row.public_token}`} variant="ghost" size="sm" onClick={() => onOpen(row)} /> },
              ]}
            />
          ) : (
            <EmptyBlock title="No Kitchen orders match" description="Orders sent to the Kitchen appear here." />
          )}
        </VStack>
      </Panel>
      <Panel title="Awaiting payment" description="Kiosk and QR orders the counter has not collected yet.">
        {pending.length ? (
          <VStack gap={2}>
            {pending.map((row) => (
              <Button key={row.id} label={`#${row.order?.order_number || row.id.slice(0, 8)} · ${orderSourceLabel(row.order?.source)} · ${formatCurrency(Number(row.amount || row.order?.total_amount || 0), currency)}`} variant="secondary" width="100%" isDisabled={!!busy} onClick={() => onPayment(row)} />
            ))}
          </VStack>
        ) : (
          <EmptyBlock title="Nothing awaiting payment" description="Kiosk and QR orders waiting for the counter appear here." />
        )}
      </Panel>
    </VStack>
  );
}

function ModifierDrawer({ product, selected, currency, onToggle, onClose, onConfirm }: { product: Product; selected: ModifierOption[]; currency: string; onToggle: (option: ModifierOption) => void; onClose: () => void; onConfirm: () => void }) {
  return (
    <DetailDrawer
      title={`Configure ${product.name}`}
      isOpen
      onClose={onClose}
      footer={<HStack gap={2} hAlign="end"><Button label="Cancel" variant="secondary" onClick={onClose} /><Button label="Add to order" variant="primary" onClick={onConfirm} /></HStack>}
    >
      <VStack gap={5}>
        {(product.modifier_groups || []).map((group) => (
          <VStack key={group.id} gap={2}>
            <Text type="label" color="primary">{`${group.name}${group.is_required ? " (required)" : ""}`}</Text>
            {group.options.filter((option) => option.is_available).map((option) => (
              <CheckboxInput key={option.id} label={`${option.name}${option.price_delta ? ` · +${formatCurrency(option.price_delta, currency)}` : ""}`} value={selected.some((item) => item.id === option.id)} onChange={() => onToggle(option)} />
            ))}
          </VStack>
        ))}
      </VStack>
    </DetailDrawer>
  );
}

function OrderDrawer({ order, currency, busy, onClose, onHandover }: { order: Order; currency: string; busy: string; onClose: () => void; onHandover: (order: Order) => void }) {
  return (
    <DetailDrawer
      title={`Order #${order.order_number || order.public_token}`}
      isOpen
      onClose={onClose}
      footer={order.status === "ready" ? <Button label="Mark handed over" variant="primary" width="100%" isDisabled={!!busy} onClick={() => onHandover(order)} /> : undefined}
    >
      <VStack gap={4}>
        <DetailRow label="Source">{orderSourceLabel(order.source)}</DetailRow>
        <DetailRow label="Payment">{order.payment_status}</DetailRow>
        <DetailRow label="Kitchen status"><StatusBadge tone={order.status === "ready" ? "success" : "info"}>{order.status}</StatusBadge></DetailRow>
        <DetailRow label="Total">{formatCurrency(order.total_amount, currency)}</DetailRow>
        <VStack gap={1}>
          <Text type="label" color="primary">Items</Text>
          {(order.order_items || []).map((item) => <Text key={item.id} type="body" color="primary">{`${item.quantity} × ${item.product_name}`}</Text>)}
        </VStack>
      </VStack>
    </DetailDrawer>
  );
}

function PaymentDrawer({ row, currency, testMode, onClose, onRefresh }: { row: PendingPaymentRow; currency: string; testMode: boolean; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const order = row.order || {};
  const amount = Number(row.amount || order.total_amount || 0);
  const run = async () => {
    setBusy(true);
    try {
      if (testMode) await api.testRuntimeMarkPaid(row.id);
      else {
        if (!row.claim) await api.liveCounterClaimPayment(row.id);
        await api.liveCounterSessionMarkPaid(row.id, { business_id: String(row.business_id), amount, method: "cash" });
      }
      await onRefresh();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment could not be confirmed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailDrawer
      title="Counter payment"
      isOpen
      onClose={onClose}
      footer={<HStack gap={2} hAlign="end"><Button label="Close" variant="secondary" onClick={onClose} /><Button label={row.claim ? "Take payment" : "Claim & take payment"} variant="primary" isLoading={busy} isDisabled={busy} onClick={() => void run()} /></HStack>}
    >
      <VStack gap={4}>
        <DetailRow label="Order">{`#${order.order_number || order.public_token || row.id.slice(0, 8)}`}</DetailRow>
        <DetailRow label="Total">{formatCurrency(amount, currency)}</DetailRow>
        <NoticeBanner tone="info" title="This order reaches Kitchen only after payment is confirmed here." />
        {message ? <NoticeBanner tone="danger" title={message} role="alert" /> : null}
      </VStack>
    </DetailDrawer>
  );
}
