"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Tab as AstryxTab, TabList } from "@astryxdesign/core/TabList";
import { Table } from "@astryxdesign/core/Table";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { AstryxDashboardProviders } from "@/components/dashboard/AstryxDashboardProviders";
import { BoardColumn, BoardGrid, DetailDrawer, EmptyBlock, Metric, NoticeBanner, Panel, StatusBadge } from "@/components/dashboard/kit";
import { SegmentedShare } from "@/components/dashboard/charts";
import { DeviceCard, DeviceFrame, DeviceLoading } from "@/components/device/DeviceFrame";
import { api } from "@/lib/api";
import type { LiveDeviceContext, Order, OrderItem, Product } from "@/lib/types";
import { elapsedLabel, isOnlineOrder, kitchenLabel, kitchenStage, orderSourceLabel, type KitchenStage } from "@/features/staff/status";
import { queuedKitchenEvents, removeKitchenEvent, saveKitchenEvent, type KitchenQueuedEvent } from "./offline-store";
import { testDeviceContext, testOrder, testProducts, testSessionStateMessage } from "@/features/test-runtime";

type Tab = "live" | "availability" | "completed";
type KitchenOrder = Order & { source?: string; items?: (OrderItem & { completed_quantity?: number; kitchen_status?: string })[]; kitchen?: { stage?: KitchenStage; is_held?: boolean; hold_reason?: string; delayed?: boolean; delay_minutes?: number }; sync_state?: string };
const makeId = () => crypto.randomUUID();

export function KitchenApp({ runtimeMode = "live" }: { runtimeMode?: "live" | "test" }) {
  const isTest = runtimeMode === "test";
  const router = useRouter(); const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "live");
  const [context, setContext] = useState<LiveDeviceContext | null>(null); const [orders, setOrders] = useState<KitchenOrder[]>([]); const [completed, setCompleted] = useState<KitchenOrder[]>([]); const [products, setProducts] = useState<Product[]>([]); const [queue, setQueue] = useState<KitchenQueuedEvent[]>([]);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine); const [sound, setSound] = useState(true); const [now, setNow] = useState(0); const [loading, setLoading] = useState(true); const [shellError, setShellError] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({}); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<KitchenOrder | null>(null); const [heldOpen, setHeldOpen] = useState(false); const [allDayOpen, setAllDayOpen] = useState(false); const [allDay, setAllDay] = useState<Array<Record<string, unknown>>>([]); const [delayedOnly, setDelayedOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | "online" | "instore">("all"); const [holdOrder, setHoldOrder] = useState<KitchenOrder | null>(null); const [recallOrder, setRecallOrder] = useState<KitchenOrder | null>(null);
  const setAreaError = (area: string, value = "") => setErrors((current) => ({ ...current, [area]: value }));
  const invoke = useCallback((event: KitchenQueuedEvent) => { if (isTest) { if (event.action === "availability") return api.testKitchenSetAvailability(event.productId!, (event.payload as { status: string }).status === "available"); if (event.action === "item") return api.testKitchenItem(event.orderId!, event.itemId!, (event.payload as { completed_quantity: number }).completed_quantity); return api.testKitchenAction(event.action as "start" | "hold" | "resume" | "ready" | "recall", event.orderId!, event.payload as Record<string, unknown>); } if (event.action === "start") return api.liveKitchenStart(event.orderId!, event.payload as { event_id: string }); if (event.action === "hold") return api.liveKitchenHold(event.orderId!, event.payload as { event_id: string; reason: string }); if (event.action === "resume") return api.liveKitchenResume(event.orderId!, event.payload as { event_id: string }); if (event.action === "ready") return api.liveKitchenReady(event.orderId!, event.payload as { event_id: string }); if (event.action === "recall") return api.liveKitchenRecall(event.orderId!, event.payload as { event_id: string; reason: string; override_token: string }); if (event.action === "item") return api.liveKitchenItem(event.orderId!, event.itemId!, event.payload as { event_id: string; completed_quantity: number }); return api.liveKitchenSetAvailability(event.productId!, event.payload as { event_id: string; status: "available" | "temporarily_unavailable" | "out_of_stock" }); }, [isTest]);
  const refreshBoard = useCallback(async () => { try { const board = isTest ? await api.testKitchenOrders() : await api.liveKitchenBoard(); setOrders((isTest ? board.orders.map((order) => testOrder(order, context?.business.id || "test")) : board.orders) as KitchenOrder[]); setAreaError("board"); } catch { setAreaError("board", "Couldn't load Kitchen orders. The server couldn't complete this request."); } }, [context?.business.id, isTest]);
  const refreshOptional = useCallback(async () => {
    const businessId = context?.business.id || "test";
    if (isTest) {
      const [done, available] = await Promise.allSettled([api.testKitchenCompleted(), api.testKitchenAvailability()]);
      if (done.status === "fulfilled") { setCompleted(done.value.orders.map((order) => testOrder(order, businessId)) as KitchenOrder[]); setAreaError("completed"); } else setAreaError("completed", "Couldn't load completed Kitchen orders.");
      if (available.status === "fulfilled") { setProducts(testProducts(available.value.products)); setAreaError("availability"); } else setAreaError("availability", "Couldn't load Item Availability.");
      setSound(true); setAreaError("preferences");
      return;
    }
    const [done, available, preferences] = await Promise.allSettled([api.liveKitchenCompleted(), api.liveKitchenAvailability(), api.liveKitchenPreferences()]);
    if (done.status === "fulfilled") { setCompleted(done.value.orders as KitchenOrder[]); setAreaError("completed"); } else setAreaError("completed", "Couldn't load completed Kitchen orders.");
    if (available.status === "fulfilled") { setProducts(available.value.products); setAreaError("availability"); } else setAreaError("availability", "Couldn't load Item Availability.");
    if (preferences.status === "fulfilled") { setSound(preferences.value.sound_enabled); setAreaError("preferences"); } else setAreaError("preferences", "Kitchen sound preference unavailable.");
  }, [context?.business.id, isTest]);
  const sync = useCallback(async () => { if (isTest) { setQueue([]); return; } if (!online) { setQueue(await queuedKitchenEvents()); return; } for (const event of await queuedKitchenEvents()) { try { await invoke(event); await removeKitchenEvent(event.id); } catch (error) { await saveKitchenEvent({ ...event, retryCount: event.retryCount + 1, lastError: error instanceof Error ? error.message : "Sync failed" }); } } setQueue(await queuedKitchenEvents()); }, [invoke, isTest, online]);
  const load = useCallback(async () => { setLoading(true); try { const menu = isTest ? await api.testKioskSessionMenu() : null; const session = isTest ? await api.testRuntimeContext("kitchen") : await api.liveDeviceSessionContext("kitchen"); setContext(isTest ? testDeviceContext(menu!, "kitchen") : (session as LiveDeviceContext)); setShellError(""); await Promise.all([refreshBoard(), refreshOptional(), sync()]); } catch (error) { setShellError(error instanceof Error ? error.message : isTest ? "Test session unavailable or expired." : "Kitchen session unavailable. Pair or reactivate this device."); } finally { setLoading(false); } }, [isTest, refreshBoard, refreshOptional, sync]);
  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);
  useEffect(() => { const onlineHandler = () => { setOnline(true); void sync().then(refreshBoard); }; const offlineHandler = () => setOnline(false); const clock = window.setInterval(() => setNow(Date.now()), 1000); const refresh = window.setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void refreshBoard(); }, 15000); addEventListener("online", onlineHandler); addEventListener("offline", offlineHandler); return () => { removeEventListener("online", onlineHandler); removeEventListener("offline", offlineHandler); clearInterval(clock); clearInterval(refresh); }; }, [refreshBoard, sync]);
  const changeTab = (next: Tab) => { setTab(next); router.replace(isTest ? `/test/kitchen?tab=${next}` : `/device?tab=${next}`); };
  const submit = async (event: KitchenQueuedEvent) => { setBusy(event.id); try { if (!online && !isTest) throw new Error("Offline"); await invoke(event); await refreshBoard(); if (event.action === "availability") await refreshOptional(); return true; } catch (error) { const message = error instanceof Error ? error.message : "Kitchen action failed."; if (!isTest && (!online || /network|offline|fetch/i.test(message))) { await saveKitchenEvent(event); setQueue(await queuedKitchenEvents()); setNotice("Saved locally. Kitchen Sync will retry with the same event ID."); } else setNotice(message); return false; } finally { setBusy(""); } };
  const action = (actionName: KitchenQueuedEvent["action"], order: KitchenOrder, extra: Record<string, unknown> = {}, itemId?: string) => void submit({ id: makeId(), action: actionName, orderId: order.id, itemId, payload: { event_id: makeId(), ...extra }, createdAt: new Date().toISOString(), retryCount: 0 });
  const held = orders.filter((order) => order.kitchen?.is_held); const active = orders.filter((order) => !order.kitchen?.is_held && (sourceFilter === "all" || isOnlineOrder(order.source) === (sourceFilter === "online"))); const onlineCount = orders.filter((order) => !order.kitchen?.is_held && isOnlineOrder(order.source)).length; const delayed = active.filter((order) => order.kitchen?.delayed); const lanes = (["pending", "preparing", "ready"] as const).map((stage) => ({ stage, label: kitchenLabel(stage), orders: active.filter((order) => kitchenStage(order) === stage && (!delayedOnly || order.kitchen?.delayed)) }));
  const toggleSound = async () => { const next = !sound; setSound(next); if (isTest) return; try { await api.liveKitchenSetPreferences({ sound_enabled: next }); setAreaError("preferences"); } catch { setSound(!next); setAreaError("preferences", "Kitchen sound preference unavailable."); } };
  const fullscreen = () => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.(); else void document.exitFullscreen?.(); };
  const loadAllDay = useCallback(async () => { if (isTest) { setAllDay([]); return; } try { setAllDay((await api.liveKitchenAllDay()).items); } catch { setNotice("Couldn't load All Day view."); } }, [isTest]);
  if (shellError && !context) {
    return (
      <DeviceFrame>
        <DeviceCard title={isTest ? "Test Kitchen" : "PlaceURorder Kitchen"} description={isTest ? testSessionStateMessage(new Error(shellError)) : shellError}>
          <VStack gap={3}>
            <Button label="Try again" variant="secondary" width="100%" onClick={() => void load()} />
            <Button label={isTest ? "Return to Test Hub" : "Pair or recover device"} variant="primary" width="100%" onClick={() => router.push(isTest ? "/dashboard/test" : "/device/start")} />
          </VStack>
        </DeviceCard>
      </DeviceFrame>
    );
  }
  if (loading && !context) return <DeviceLoading title="PlaceURorder Kitchen" message="Loading the kitchen display" />;

  const stageCount = (stage: KitchenStage) => active.filter((order) => kitchenStage(order) === stage).length;
  const parts = (["pending", "preparing", "ready"] as const).map((stage) => ({ id: stage, label: kitchenLabel(stage), value: stageCount(stage) }));
  const exitDevice = () => (isTest ? router.push("/dashboard/test") : void api.clearLiveDeviceSession().then(() => router.push("/device/start")));

  return (
    <AstryxDashboardProviders>
      <VStack gap={0} style={{ minHeight: "100vh", background: "var(--color-background-muted)" }}>
        <KitchenHeader context={context} now={now} online={online} queue={queue.length} sound={sound} testMode={isTest} onSound={toggleSound} onFullscreen={fullscreen} onExit={exitDevice} />
        <VStack gap={0} style={{ background: "var(--color-background-card)", borderBottom: "1px solid var(--color-border)", padding: "0 20px" }}>
          <HStack gap={4} vAlign="center" hAlign="between" wrap="wrap" style={{ padding: "12px 0" }}>
            <TabList value={tab} onChange={(value) => changeTab(value as Tab)} size="sm" layout="hug">
              <AstryxTab value="live" label="Live orders" />
              <AstryxTab value="availability" label="Item availability" />
              <AstryxTab value="completed" label="Completed" />
            </TabList>
            {tab === "live" && (
              <HStack gap={2} vAlign="center" wrap="wrap">
                <SegmentedControl label="Order source" value={sourceFilter} onChange={(value) => setSourceFilter(value as typeof sourceFilter)}>
                  <SegmentedControlItem value="all" label="All" />
                  <SegmentedControlItem value="online" label="Online (QR)" />
                  <SegmentedControlItem value="instore" label="Kiosk & counter" />
                </SegmentedControl>
                <Button label="All-day view" variant="secondary" size="sm" onClick={() => setAllDayOpen(true)} />
                <Button label={delayedOnly ? "Showing delayed only" : "Delayed only"} variant={delayedOnly ? "primary" : "ghost"} size="sm" onClick={() => setDelayedOnly((value) => !value)} />
              </HStack>
            )}
          </HStack>
        </VStack>

        <VStack gap={5} style={{ padding: 20 }}>
          {notice && <NoticeBanner tone="info" title={notice} role="status" />}

          {tab === "live" && (
            <VStack gap={5}>
              {errors.board && <NoticeBanner tone="danger" title="Kitchen orders are unavailable" description={errors.board} action={<Button label="Retry" variant="secondary" onClick={() => void refreshBoard()} />} role="alert" />}
              <Grid columns={{ minWidth: 240, repeat: "fit" }} gap={4} align="start">
                <Panel title="Active orders" description={`${active.length} in the kitchen right now`}>
                  <SegmentedShare ariaLabel="Active orders by stage" parts={parts} format={(value) => String(Math.round(value))} />
                </Panel>
                <Metric label="Held" value={held.length} hint="Paused with a reason" />
                <Metric label="Delayed" value={delayed.length} hint="Past the expected prep time" />
                <Metric label="Online (QR)" value={onlineCount} hint="Ordered from your QR link" />
              </Grid>
              {delayedOnly && <NoticeBanner tone="warning" title="Showing delayed orders only" action={<Button label="Clear filter" variant="ghost" size="sm" onClick={() => setDelayedOnly(false)} />} />}
              <BoardGrid>
                {lanes.map((lane) => {
                  const oldest = lane.orders.reduce<string | null>((value, order) => (value === null || order.placed_at < value ? order.placed_at : value), null);
                  return (
                    <BoardColumn key={lane.stage} title={lane.label} count={lane.orders.length}>
                      {oldest && <Text type="supporting" color="secondary">{`Oldest ${elapsedLabel(oldest, now)}`}</Text>}
                      {lane.orders.length ? lane.orders.map((order) => (
                        <KitchenTicket key={order.id} order={order} now={now} busy={busy} onOpen={() => setSelected(order)} onStart={() => action("start", order)} onHold={() => setHoldOrder(order)} onReady={() => action("ready", order)} onRecall={() => setRecallOrder(order)} />
                      )) : <EmptyBlock title={laneEmpty[lane.stage][0]} description={laneEmpty[lane.stage][1]} />}
                    </BoardColumn>
                  );
                })}
              </BoardGrid>
            </VStack>
          )}

          {tab === "availability" && <AvailabilityPanel products={products} error={errors.availability} busy={busy} onRetry={refreshOptional} onChange={(product, status) => { const previous = products; setProducts((current) => current.map((item) => item.id === product.id ? { ...item, is_available: status === "available" } : item)); void submit({ id: makeId(), action: "availability", productId: product.id, payload: { event_id: makeId(), status }, createdAt: new Date().toISOString(), retryCount: 0 }).then((success) => { if (!success) setProducts(previous); }); }} />}

          {tab === "completed" && <CompletedPanel orders={completed} error={errors.completed} onRetry={refreshOptional} onOpen={setSelected} />}
        </VStack>

        <KitchenSystemBar online={online} queue={queue.length} error={errors.board} now={now} onRefresh={refreshBoard} />

        {selected && <OrderDrawer order={selected} busy={busy} onClose={() => setSelected(null)} onItem={(item) => action("item", selected, { completed_quantity: item.completed_quantity === item.quantity ? 0 : item.quantity }, item.id)} onRecall={() => setRecallOrder(selected)} />}
        {heldOpen && <HeldDrawer orders={held} busy={busy} onClose={() => setHeldOpen(false)} onResume={(order) => action("resume", order)} onOpen={setSelected} />}
        {allDayOpen && <AllDayDrawer items={allDay} onLoad={loadAllDay} onClose={() => setAllDayOpen(false)} />}
        {holdOrder && <HoldDialog order={holdOrder} busy={busy} onClose={() => setHoldOrder(null)} onConfirm={(reason) => { action("hold", holdOrder, { reason }); setHoldOrder(null); }} />}
        {recallOrder && <RecallDialog order={recallOrder} busy={busy} testMode={isTest} onClose={() => setRecallOrder(null)} onConfirm={async (reason, pin) => { try { if (isTest) action("recall", recallOrder, { reason }); else { const result = await api.liveKitchenOverride({ action: "recall", reason, pin }); action("recall", recallOrder, { reason, override_token: result.override_token }); } setRecallOrder(null); } catch (error) { setNotice(error instanceof Error ? error.message : "Recall approval failed."); } }} />}
      </VStack>
    </AstryxDashboardProviders>
  );
}

const laneEmpty: Record<KitchenStage, [string, string]> = {
  pending: ["No new orders", "New orders from the kiosk or counter appear here."],
  preparing: ["Nothing in preparation", "Orders you start preparing appear here."],
  ready: ["No ready orders", "Finished orders wait here for handover."],
};

function KitchenHeader({ context, now, online, queue, sound, testMode, onSound, onFullscreen, onExit }: { context: LiveDeviceContext | null; now: number; online: boolean; queue: number; sound: boolean; testMode: boolean; onSound: () => void; onFullscreen: () => void; onExit: () => void }) {
  return (
    <HStack gap={4} vAlign="center" hAlign="between" wrap="wrap" style={{ padding: "14px 20px", background: "var(--color-background-card)", borderBottom: "1px solid var(--color-border)" }}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Heading level={2} weight="semibold">Kitchen</Heading>
        <StatusBadge tone={testMode ? "warning" : "info"}>{testMode ? "Test mode" : context?.device.name || "Kitchen device"}</StatusBadge>
        <Text type="supporting" color="secondary">{context?.device.location_label || context?.business.name || "Main kitchen"}</Text>
      </HStack>
      <HStack gap={4} vAlign="center" wrap="wrap">
        <Text type="label" color="primary">{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
        <StatusBadge tone={online ? (queue ? "warning" : "success") : "danger"}>{testMode ? "Test session" : connectionLabelText(online, queue)}</StatusBadge>
        <Button label={sound ? "Sound on" : "Sound off"} variant="ghost" size="sm" onClick={onSound} />
        <Button label="Fullscreen" variant="ghost" size="sm" onClick={onFullscreen} />
        <Button label="Exit" variant="secondary" size="sm" onClick={onExit} />
      </HStack>
    </HStack>
  );
}

// Short, plain status for the header: the connection state plus any orders still waiting to sync.
function connectionLabelText(online: boolean, queue: number) {
  if (!online) return "Offline";
  return queue ? `${queue} waiting to sync` : "Connected";
}

function KitchenTicket({ order, now, busy, onOpen, onStart, onHold, onReady, onRecall }: { order: KitchenOrder; now: number; busy: string; onOpen: () => void; onStart: () => void; onHold: () => void; onReady: () => void; onRecall: () => void }) {
  const stage = kitchenStage(order) || "pending";
  const items = (order.items || order.order_items || []) as Array<OrderItem & { completed_quantity?: number }>;
  const readyAllowed = items.every((item) => (item.completed_quantity || 0) >= item.quantity);
  return (
    <Card padding={4} elevation="low">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" hAlign="between">
          <Heading level={3} weight="semibold">{`#${order.order_number || order.public_token}`}</Heading>
          {order.kitchen?.delayed ? <StatusBadge tone="danger">Delayed</StatusBadge> : <Text type="supporting" color="secondary">{elapsedLabel(order.placed_at, now)}</Text>}
        </HStack>
        <Text type="supporting" color="secondary">{`${orderSourceLabel(order.source)} · ${order.order_type === "dine_in" ? `Table ${order.table_label || "—"}` : "Takeaway"}`}</Text>
        <VStack gap={1}>
          {items.slice(0, 4).map((item) => (
            <HStack key={item.id} gap={2} vAlign="center">
              <Text type="body" weight="semibold" color="primary">{`${item.quantity} ×`}</Text>
              <Text type="body" color="primary">{item.product_name}</Text>
              {stage === "preparing" && (item.completed_quantity || 0) >= item.quantity && <StatusBadge tone="success">Done</StatusBadge>}
            </HStack>
          ))}
          {items.length > 4 && <Text type="supporting" color="secondary">{`+${items.length - 4} more`}</Text>}
        </VStack>
        <HStack gap={2} wrap="wrap">
          {stage === "pending" && <Button label="Hold" variant="secondary" size="sm" isDisabled={!!busy} onClick={onHold} />}
          {stage === "pending" && <Button label="Start preparing" variant="primary" size="sm" isDisabled={!!busy} onClick={onStart} />}
          {stage === "preparing" && <Button label="Hold" variant="secondary" size="sm" isDisabled={!!busy} onClick={onHold} />}
          {stage === "preparing" && <Button label="Mark ready" variant="primary" size="sm" isDisabled={!!busy || !readyAllowed} onClick={onReady} />}
          {stage === "ready" && <Button label="Recall" variant="secondary" size="sm" isDisabled={!!busy} onClick={onRecall} />}
          <Button label="Details" variant="ghost" size="sm" onClick={onOpen} />
        </HStack>
      </VStack>
    </Card>
  );
}

function AvailabilityPanel({ products, error, busy, onRetry, onChange }: { products: Product[]; error?: string; busy: string; onRetry: () => Promise<void>; onChange: (product: Product, status: "available" | "temporarily_unavailable" | "out_of_stock") => void }) {
  const [search, setSearch] = useState("");
  const shown = products.filter((product) => product.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <Panel title="Item availability" description="A Kitchen override. It does not change menu prices or schedules.">
      <VStack gap={4}>
        <TextInput label="Search items" value={search} onChange={setSearch} placeholder="Search items" width={320} />
        {error ? <NoticeBanner tone="danger" title={error} action={<Button label="Retry" variant="secondary" onClick={() => void onRetry()} />} /> : (
          <Table
            idKey="id"
            data={shown as Array<Product & Record<string, unknown>>}
            columns={[
              { key: "item", header: "Item", renderCell: (row: Product) => row.name },
              { key: "status", header: "Availability", renderCell: (row: Product) => <StatusBadge tone={row.is_available ? "success" : "danger"}>{row.is_available ? "Available" : "Unavailable"}</StatusBadge> },
              { key: "schedule", header: "Schedule", renderCell: (row: Product) => (row.availability_start_time || row.availability_end_time ? "Scheduled" : "No schedule") },
              { key: "action", header: "Action", align: "end", renderCell: (row: Product) => <Button label={row.is_available ? "Set unavailable" : "Set available"} variant="secondary" size="sm" isDisabled={!!busy} onClick={() => onChange(row, row.is_available ? "temporarily_unavailable" : "available")} /> },
            ]}
          />
        )}
        {!error && !shown.length && <EmptyBlock title="No items match this search" />}
      </VStack>
    </Panel>
  );
}

function CompletedPanel({ orders, error, onRetry, onOpen }: { orders: KitchenOrder[]; error?: string; onRetry: () => Promise<void>; onOpen: (order: KitchenOrder) => void }) {
  return (
    <Panel title="Completed" description="Read-only history of finished Kitchen orders." actions={<Button label="Refresh" variant="secondary" size="sm" onClick={() => void onRetry()} />}>
      {error ? <NoticeBanner tone="danger" title={error} action={<Button label="Retry" variant="secondary" onClick={() => void onRetry()} />} /> : orders.length ? (
        <Table
          idKey="id"
          data={orders as Array<KitchenOrder & Record<string, unknown>>}
          columns={[
            { key: "order", header: "Order", renderCell: (row: KitchenOrder) => `#${row.order_number || row.public_token}` },
            { key: "source", header: "Source", renderCell: (row: KitchenOrder) => orderSourceLabel(row.source) },
            { key: "started", header: "Started", renderCell: (row: KitchenOrder) => (row.prep_started_at ? new Date(row.prep_started_at).toLocaleTimeString() : "—") },
            { key: "ready", header: "Ready", renderCell: (row: KitchenOrder) => (row.ready_at ? new Date(row.ready_at).toLocaleTimeString() : "—") },
            { key: "prep", header: "Prep time", renderCell: (row: KitchenOrder) => (row.prep_started_at && row.ready_at ? elapsedLabel(row.prep_started_at, new Date(row.ready_at).getTime()) : "—") },
            { key: "handover", header: "Handover", renderCell: (row: KitchenOrder) => (row.completed_at ? "Handed over" : "Awaiting counter") },
            { key: "open", header: "", align: "end", renderCell: (row: KitchenOrder) => <Button label={`Details for order ${row.order_number || row.public_token}`} variant="ghost" size="sm" onClick={() => onOpen(row)} /> },
          ]}
        />
      ) : <EmptyBlock title="No completed orders today" description="Finished Kitchen orders appear here." />}
    </Panel>
  );
}

function KitchenSystemBar({ online, queue, error, now, onRefresh }: { online: boolean; queue: number; error?: string; now: number; onRefresh: () => Promise<void> }) {
  const label = !online ? "Offline. Changes will sync when the connection returns." : error ? "Reconnecting to the kitchen feed." : queue ? `${queue} change${queue === 1 ? "" : "s"} waiting to sync.` : "All systems operational.";
  return (
    <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap" style={{ padding: "10px 20px", background: "var(--color-background-card)", borderTop: "1px solid var(--color-border)" }}>
      <StatusBadge tone={!online || error ? "warning" : "success"}>{label}</StatusBadge>
      <HStack gap={2} vAlign="center">
        <Text type="supporting" color="secondary">{`Last updated ${new Date(now).toLocaleTimeString()}`}</Text>
        <IconButton label="Refresh orders" variant="ghost" size="sm" icon={<RefreshCw size={15} aria-hidden="true" />} onClick={() => void onRefresh()} />
      </HStack>
    </HStack>
  );
}

function OrderDrawer({ order, busy, onClose, onItem, onRecall }: { order: KitchenOrder; busy: string; onClose: () => void; onItem: (item: OrderItem & { completed_quantity?: number }) => void; onRecall: () => void }) {
  const items = (order.items || order.order_items || []) as Array<OrderItem & { completed_quantity?: number }>;
  const stage = kitchenStage(order);
  return (
    <DetailDrawer title={`Order #${order.order_number || order.public_token}`} isOpen onClose={onClose} footer={stage === "ready" ? <Button label="Recall with manager approval" variant="secondary" isDisabled={!!busy} onClick={onRecall} /> : undefined}>
      <Text type="supporting" color="secondary">{`${orderSourceLabel(order.source)} · ${order.payment_status} · ${order.status}`}</Text>
      <VStack gap={3}>
        {items.map((item) => (
          <HStack key={item.id} gap={3} vAlign="center" hAlign="between">
            <VStack gap={0}>
              <Text type="body" color="primary">{`${item.quantity} × ${item.product_name}`}</Text>
              <Text type="supporting" color="secondary">{item.notes || "No item note"}</Text>
            </VStack>
            {stage === "preparing" && <Button label={(item.completed_quantity || 0) >= item.quantity ? "Undo" : "Complete"} variant="secondary" size="sm" isDisabled={!!busy} onClick={() => onItem(item)} />}
          </HStack>
        ))}
      </VStack>
      {order.notes && <Text type="body" color="secondary">{order.notes}</Text>}
    </DetailDrawer>
  );
}

function HeldDrawer({ orders, busy, onClose, onResume, onOpen }: { orders: KitchenOrder[]; busy: string; onClose: () => void; onResume: (order: KitchenOrder) => void; onOpen: (order: KitchenOrder) => void }) {
  return (
    <DetailDrawer title="Held orders" isOpen onClose={onClose}>
      {orders.length ? orders.map((order) => (
        <HStack key={order.id} gap={3} vAlign="center" hAlign="between" wrap="wrap">
          <VStack gap={0}>
            <Text type="body" weight="semibold" color="primary">{`#${order.order_number || order.public_token}`}</Text>
            <Text type="supporting" color="secondary">{`${kitchenLabel(kitchenStage(order) || "pending")} · ${order.kitchen?.hold_reason || "No reason recorded"}`}</Text>
          </VStack>
          <HStack gap={2}>
            <Button label="Details" variant="ghost" size="sm" onClick={() => onOpen(order)} />
            <Button label="Resume" variant="primary" size="sm" isDisabled={!!busy} onClick={() => onResume(order)} />
          </HStack>
        </HStack>
      )) : <EmptyBlock title="No held orders" description="Orders you hold with a reason appear here." />}
    </DetailDrawer>
  );
}

function AllDayDrawer({ items, onLoad, onClose }: { items: Array<Record<string, unknown>>; onLoad: () => Promise<void>; onClose: () => void }) {
  useEffect(() => { void onLoad(); }, [onLoad]);
  return (
    <DetailDrawer title="All-day view" isOpen onClose={onClose}>
      <Text type="supporting" color="secondary">Total production still needed, by item.</Text>
      {items.length ? items.map((item) => (
        <VStack key={String(item.item)} gap={0}>
          <Text type="body" weight="semibold" color="primary">{String(item.item)}</Text>
          <Text type="supporting" color="secondary">{`${String(item.total_required)} required · ${String(item.preparing_quantity)} preparing · ${String(item.held_quantity)} held`}</Text>
        </VStack>
      )) : <EmptyBlock title="Nothing in production" />}
    </DetailDrawer>
  );
}

function HoldDialog({ order, busy, onClose, onConfirm }: { order: KitchenOrder; busy: string; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <DetailDrawer title={`Hold order #${order.order_number || order.public_token}`} isOpen onClose={onClose} footer={<><Button label="Cancel" variant="ghost" onClick={onClose} /><Button label="Hold order" variant="primary" isDisabled={!reason.trim() || !!busy} onClick={() => onConfirm(reason.trim())} /></>}>
      <TextArea label="Hold reason" value={reason} onChange={setReason} placeholder="Why is this order held?" rows={3} />
    </DetailDrawer>
  );
}

function RecallDialog({ order, busy, testMode, onClose, onConfirm }: { order: KitchenOrder; busy: string; testMode: boolean; onClose: () => void; onConfirm: (reason: string, pin: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  return (
    <DetailDrawer title={`Recall order #${order.order_number || order.public_token}`} isOpen onClose={onClose} footer={<><Button label="Cancel" variant="ghost" onClick={onClose} /><Button label="Recall to preparing" variant="primary" isDisabled={!!busy || !reason.trim() || (!testMode && pin.length < 4)} onClick={() => void onConfirm(reason.trim(), pin)} /></>}>
      <TextArea label="Reason" value={reason} onChange={setReason} rows={3} />
      {!testMode && <TextInput label="Manager PIN" inputMode="numeric" value={pin} onChange={setPin} />}
    </DetailDrawer>
  );
}
