"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Selector } from "@astryxdesign/core/Selector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Table } from "@astryxdesign/core/Table";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Grid } from "@astryxdesign/core/Grid";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { BoardColumn, BoardGrid, ConfirmDialog, DashboardPage, DetailDrawer, DetailRow, EmptyBlock, LoadingBlock, Metric, MetricGrid, NoticeBanner, PageHeader, Panel, StatusBadge, Toolbar, useLiveRefresh } from "@/components/dashboard/kit";
import { DailyBars } from "@/components/dashboard/charts";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { api, assetUrl } from "@/lib/api";
import { formatCurrency, formatOrderStatus, formatPaymentStatus } from "@/lib/formatters";
import type { AlertRecord, BusinessLocation, Category, DevicePairingRequest, DeviceRecord, Order, Product } from "@/lib/types";

export type OperationsMode = "live-orders" | "order-history" | "kitchen" | "counter" | "inventory" | "devices" | "alerts";
type OpsData = { orders: Order[]; products: Product[]; categories: Category[]; devices: DeviceRecord[]; pairings: DevicePairingRequest[]; alerts: AlertRecord[] };
type Failure = "orders" | "products" | "categories" | "devices" | "pairings" | "alerts";
type Setter<T> = Dispatch<SetStateAction<T>>;
type OpsProps = { business: NonNullable<ReturnType<typeof useBusiness>["business"]>; data: OpsData; locations: BusinessLocation[]; selectedLocationId: string | null; failed: Failure[] };

const empty: OpsData = { orders: [], products: [], categories: [], devices: [], pairings: [], alerts: [] };
type IsoDate = NonNullable<ComponentProps<typeof DateInput>["value"]>;
const stageLabels = { pending: "New", preparing: "Preparing", ready: "Ready" } as const;
const openStatuses = ["pending", "preparing", "ready"];

export function OperationsPage({ mode }: { mode: OperationsMode }) {
  const { business, loading: businessLoading, error: businessError, locations, selectedLocationId } = useBusiness();
  const [data, setData] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<Failure[]>([]);
  const [refresh, setRefresh] = useState(0);
  // Only the first load of a page shows the skeleton; live refreshes update the data in place.
  const loadedMode = useRef<OperationsMode | null>(null);
  const [start, setStart] = useState(() => isoDate(-6));
  const [end, setEnd] = useState(() => isoDate(0));

  const load = useCallback(async () => {
    if (!business?.id) return;
    if (loadedMode.current !== mode) setLoading(true);
    loadedMode.current = mode;
    const jobs: Array<[Failure, Promise<unknown>]> = [];
    if (["live-orders", "order-history", "kitchen", "counter"].includes(mode)) jobs.push(["orders", api.orders(business.id, { status: mode === "live-orders" ? "active" : undefined, start: mode === "order-history" ? start : isoDate(0), end: mode === "order-history" ? end : isoDate(0), locationId: selectedLocationId, limit: 250 })]);
    if (mode === "inventory") {
      jobs.push(["products", api.products(business.id, true)]);
      jobs.push(["categories", api.categories(business.id)]);
    }
    if (["devices", "counter"].includes(mode)) jobs.push(["devices", api.devices(business.id)]);
    if (mode === "devices") jobs.push(["pairings", api.devicePairingRequests(business.id)]);
    if (mode === "alerts") jobs.push(["alerts", api.alerts(business.id)]);
    const results = await Promise.allSettled(jobs.map((job) => job[1]));
    const next = { ...empty };
    const errors: Failure[] = [];
    results.forEach((result, index) => {
      const key = jobs[index][0];
      if (result.status === "rejected") {
        errors.push(key);
        return;
      }
      const value = result.value as Record<string, unknown>;
      if (key === "orders") next.orders = (value.orders as Order[]) || [];
      if (key === "products") next.products = (value.products as Product[]) || [];
      if (key === "categories") next.categories = (value.categories as Category[]) || [];
      if (key === "devices") next.devices = (value.devices as DeviceRecord[]) || [];
      if (key === "pairings") next.pairings = (value.requests as DevicePairingRequest[]) || [];
      if (key === "alerts") next.alerts = (value.alerts as AlertRecord[]) || [];
    });
    setData(next);
    setFailed(errors);
    setLoading(false);
  }, [business, end, mode, selectedLocationId, start]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refresh]);

  const retry = () => setRefresh((value) => value + 1);
  useLiveRefresh(retry, 20000);

  if (businessLoading || loading) return <DashboardPage><LoadingBlock rows={4} /></DashboardPage>;
  if (businessError) return <DashboardPage><NoticeBanner tone="danger" title="Couldn't load Operations" description={businessError} action={<Button label="Try again" variant="secondary" onClick={retry} />} /></DashboardPage>;
  if (!business) return <DashboardPage><NoticeBanner tone="warning" title="No business selected" description="Choose a business before opening Operations." /></DashboardPage>;

  const props: OpsProps = { business, data, locations, selectedLocationId, failed };
  if (mode === "live-orders") return <LiveOrders {...props} />;
  if (mode === "order-history") return <OrderHistory {...props} start={start} end={end} setStart={setStart} setEnd={setEnd} />;
  if (mode === "kitchen") return <Kitchen {...props} />;
  if (mode === "counter") return <Counter {...props} />;
  if (mode === "inventory") return <Inventory {...props} setData={setData} />;
  if (mode === "devices") return <Devices {...props} setData={setData} />;
  return <Alerts {...props} setData={setData} />;
}

function LocationSelector({ locations, value }: { locations: BusinessLocation[]; value: string | null }) {
  const { setSelectedLocationId } = useBusiness();
  return (
    <Selector
      label="Location"
      value={value ?? "all"}
      onChange={(next) => setSelectedLocationId(next === "all" ? null : next)}
      options={[{ value: "all", label: "All locations" }, ...locations.map((location) => ({ value: location.id, label: location.name }))]}
    />
  );
}

function FailureNotice({ failed, name }: { failed: Failure[]; name: Failure }) {
  return failed.includes(name)
    ? <NoticeBanner tone="danger" title={`Couldn't load ${name}.`} description="Retry without losing the rest of this page." />
    : null;
}

function ModeSwitch({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <SegmentedControl label={label} value={value} onChange={onChange}>
      {options.map((option) => <SegmentedControlItem key={option.value} value={option.value} label={option.label} />)}
    </SegmentedControl>
  );
}

function LiveOrders({ data, locations, selectedLocationId, failed }: OpsProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const live = useMemo(() => data.orders.filter((order) => openStatuses.includes(order.status) && (!search || orderNumber(order).includes(search))), [data.orders, search]);
  const stages = Object.keys(stageLabels) as Array<keyof typeof stageLabels>;

  return (
    <DashboardPage>
      <PageHeader
        title="Live Orders"
        description="See active orders across your business in real time."
        actions={<StatusBadge tone="success">Live</StatusBadge>}
      >
        <Toolbar>
          <LocationSelector locations={locations} value={selectedLocationId} />
          <TextInput type="search" label="Search orders" placeholder="Search order number" value={search} onChange={setSearch} />
        </Toolbar>
      </PageHeader>
      <FailureNotice failed={failed} name="orders" />
      {!failed.includes("orders") && <LiveSummary orders={live} />}
      {!failed.includes("orders") && (
        <BoardGrid>
          {stages.map((key) => {
            const orders = live.filter((order) => order.status === key);
            return (
              <BoardColumn key={key} title={stageLabels[key]} count={orders.length}>
                {orders.length ? orders.map((order) => <OrderTicket key={order.id} order={order} onOpen={() => setSelected(order)} />) : <EmptyBlock title={`No ${stageLabels[key].toLowerCase()} orders`} description="New orders will appear here automatically." />}
              </BoardColumn>
            );
          })}
        </BoardGrid>
      )}
      {selected && <OrderDetails order={selected} onClose={() => setSelected(null)} />}
    </DashboardPage>
  );
}

function OrderTicket({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const label = `Order ${orderNumber(order)}`;
  return (
    <ClickableCard label={label} onClick={onOpen} padding={3}>
      <VStack gap={2}>
        <HStack gap={2} hAlign="between" vAlign="center">
          <Text type="body" weight="semibold">#{orderNumber(order)}</Text>
          <StatusBadge tone={order.status === "ready" ? "success" : "info"}>{formatOrderStatus(order.status)}</StatusBadge>
        </HStack>
        <Text type="supporting" color="secondary">{order.order_type.replaceAll("_", "-")} · {itemCount(order)} items · {elapsed(order.placed_at)}</Text>
        {isDelayed(order) && <StatusBadge tone="warning">Delayed</StatusBadge>}
      </VStack>
    </ClickableCard>
  );
}

function OrderHistory({ business, data, locations, selectedLocationId, failed, start, end, setStart, setEnd }: OpsProps & { start: string; end: string; setStart: (value: string) => void; setEnd: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Order | null>(null);
  const rows = data.orders.filter((order) => (!search || orderNumber(order).includes(search)) && (status === "all" || order.status === status));

  return (
    <DashboardPage>
      <PageHeader title="Order History" description="Find and review completed, cancelled and past orders." actions={<Button label="Export CSV" variant="secondary" onClick={() => downloadOrders(rows)} />}>
        <Toolbar>
          <TextInput type="search" label="Search orders" placeholder="Search order number" value={search} onChange={setSearch} />
          <Selector label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, ...["pending", "preparing", "ready", "completed", "cancelled"].map((item) => ({ value: item, label: formatOrderStatus(item) }))]} />
          <LocationSelector locations={locations} value={selectedLocationId} />
          <DateInput label="Start date" value={start as IsoDate} onChange={(value) => { if (value) setStart(value); }} />
          <DateInput label="End date" value={end as IsoDate} onChange={(value) => { if (value) setEnd(value); }} />
        </Toolbar>
      </PageHeader>
      <FailureNotice failed={failed} name="orders" />
      {!failed.includes("orders") && <OrderSummary orders={rows} symbol={business.currency_symbol} />}
      {!failed.includes("orders") && (
        <Panel title="Orders per day" description="Orders placed each day in the selected period.">
          <OrderVolume orders={rows} />
        </Panel>
      )}
      {!failed.includes("orders") && (
        <Panel padding={4}>
          {rows.length > 0 && <Table
            idKey="id"
            data={rows as Array<Order & Record<string, unknown>>}
            columns={[
              { key: "order", header: "Order", renderCell: (row: Order) => <Button label={`Open order ${orderNumber(row)}`} variant="ghost" size="sm" onClick={() => setSelected(row)}>#{orderNumber(row)}</Button> },
              { key: "time", header: "Time", renderCell: (row: Order) => formatDateTime(row.placed_at) },
              { key: "type", header: "Type", renderCell: (row: Order) => row.order_type.replaceAll("_", "-") },
              { key: "items", header: "Items", renderCell: (row: Order) => String(itemCount(row)) },
              { key: "total", header: "Total", align: "end", renderCell: (row: Order) => money(row.total_amount, business.currency_symbol) },
              { key: "payment", header: "Payment", renderCell: (row: Order) => formatPaymentStatus(row.payment_status) },
              { key: "status", header: "Status", renderCell: (row: Order) => <StatusBadge tone={row.status === "completed" ? "success" : row.status === "cancelled" ? "danger" : "info"}>{formatOrderStatus(row.status)}</StatusBadge> },
            ]}
          />}
          {!rows.length && <EmptyBlock title={data.orders.length ? "No orders match these filters" : "No orders found"} description={data.orders.length ? "Try a different status or search." : "There are no orders for this period."} />}
        </Panel>
      )}
      {selected && <OrderDetails order={selected} onClose={() => setSelected(null)} />}
    </DashboardPage>
  );
}

function KitchenSummary({ orders }: { orders: Order[] }) {
  const oldest = orders.reduce<Order | null>((best, order) => (!best || order.placed_at < best.placed_at ? order : best), null);
  return (
    <MetricGrid>
      <Metric label="Queued" value={orders.filter((order) => order.status === "pending").length} hint="Waiting to start" />
      <Metric label="Preparing" value={orders.filter((order) => order.status === "preparing").length} hint="On the line now" />
      <Metric label="Ready to hand over" value={orders.filter((order) => order.status === "ready").length} hint="Waiting for pickup" />
      <Metric label="Oldest ticket" value={oldest ? elapsed(oldest.placed_at) : "None"} hint={oldest && isDelayed(oldest) ? "Past the expected prep time" : "Within the expected prep time"} />
    </MetricGrid>
  );
}

function Kitchen({ data, failed }: OpsProps) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const view = params.get("mode") === "today" ? "today" : "live";
  const setView = (value: string) => router.replace(`${path}?mode=${value}`);
  const orders = data.orders.filter((order) => openStatuses.includes(order.status));

  return (
    <DashboardPage>
      <PageHeader
        title="Kitchen Display"
        description="Monitor what is happening in the kitchen right now."
        actions={<Button label="Open Kitchen Screen" variant="primary" href="/kitchen/live" />}
      >
        <ModeSwitch label="Kitchen view" value={view} onChange={setView} options={[{ value: "live", label: "Live Kitchen" }, { value: "today", label: "Today" }]} />
      </PageHeader>
      <FailureNotice failed={failed} name="orders" />
      {!failed.includes("orders") && (view === "today" ? <TodaySummary data={data} /> : (
        <VStack gap={4}>
        <KitchenSummary orders={orders} />
        <BoardGrid>
          {["pending", "preparing", "ready"].map((status) => {
            const queue = orders.filter((order) => order.status === status);
            return (
              <BoardColumn key={status} title={status === "pending" ? "Queued" : capitalise(status)} count={queue.length}>
                {queue.length ? queue.map((order) => (
                  <Panel key={order.id} padding={3}>
                    <VStack gap={2}>
                      <Text type="body" weight="semibold">#{orderNumber(order)}</Text>
                      <Text type="supporting" color="secondary">{itemCount(order)} items · {elapsed(order.placed_at)}</Text>
                      <StatusBadge tone={status === "ready" ? "success" : "info"}>{formatOrderStatus(status)}</StatusBadge>
                    </VStack>
                  </Panel>
                )) : <EmptyBlock title="No orders in this queue" description="New kitchen orders will appear automatically." />}
              </BoardColumn>
            );
          })}
        </BoardGrid>
        </VStack>
      ))}
    </DashboardPage>
  );
}

function TodaySummary({ data }: { data: OpsData }) {
  const prep = data.orders.filter((order) => order.prep_started_at && (order.ready_at || order.completed_at));
  const average = prep.length ? Math.round(prep.reduce((sum, order) => sum + ((new Date(order.ready_at || order.completed_at || "").getTime() - new Date(order.prep_started_at || "").getTime()) / 60000), 0) / prep.length) : 0;
  return (
    <VStack gap={4}>
      <MetricGrid>
        <Metric label="Orders handled" value={data.orders.length} />
        <Metric label="Currently preparing" value={data.orders.filter((order) => order.status === "preparing").length} />
        <Metric label="Delayed now" value={data.orders.filter(isDelayed).length} />
        <Metric label="Average prep" value={average ? `${average} min` : "Unavailable"} />
      </MetricGrid>
      {data.orders.length
        ? <NoticeBanner tone="info" title="Recent kitchen activity" description="Live order timestamps are shown in the queue." />
        : <EmptyBlock title="No kitchen activity today" description="New kitchen orders will appear automatically." />}
    </VStack>
  );
}

function Counter({ data, failed, locations, selectedLocationId }: OpsProps) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const view = params.get("mode") === "today" ? "today" : "live";
  const setView = (value: string) => router.replace(`${path}?mode=${value}`);
  const devices = data.devices.filter((device) => device.device_type === "counter");
  const orders = data.orders.filter((order) => openStatuses.includes(order.status) && ["dine_in", "takeaway"].includes(order.order_type));

  return (
    <DashboardPage>
      <PageHeader
        title="Counter POS"
        description="Monitor counter activity and open the staff ordering screen."
        actions={<Button label="Open Counter Screen" variant="primary" href="/counter/live" />}
      >
        <Toolbar>
          <ModeSwitch label="Counter view" value={view} onChange={setView} options={[{ value: "live", label: "Live Counter" }, { value: "today", label: "Today" }]} />
          <LocationSelector locations={locations} value={selectedLocationId} />
        </Toolbar>
      </PageHeader>
      <FailureNotice failed={failed} name="devices" />
      <FailureNotice failed={failed} name="orders" />
      {!failed.length && (view === "today" ? (
        <MetricGrid>
          <Metric label="Counter orders" value={data.orders.length} />
          <Metric label="Dine-in" value={data.orders.filter((order) => order.order_type === "dine_in").length} />
          <Metric label="Takeaway" value={data.orders.filter((order) => order.order_type === "takeaway").length} />
          <Metric label="Waiting for kitchen" value={data.orders.filter((order) => ["pending", "preparing"].includes(order.status)).length} />
        </MetricGrid>
      ) : (
        <>
        <MetricGrid>
          <Metric label="Counters online" value={devices.filter((device) => device.status === "online").length} hint={`of ${devices.length} configured`} />
          <Metric label="Not online" value={devices.filter((device) => device.status !== "online").length} hint="Check power and network" />
          <Metric label="Active orders" value={orders.filter((order) => ["pending", "preparing"].includes(order.status)).length} hint="Waiting for or in the kitchen" />
          <Metric label="Ready for handover" value={orders.filter((order) => order.status === "ready").length} hint="Waiting at the counter" />
        </MetricGrid>
        <Grid columns={{ minWidth: 340, max: 2, repeat: "fit" }} gap={4} align="start">
          <Panel title="Counter status">
            {devices.length ? devices.map((device) => (
              <DetailRow key={device.id} label={device.name || device.device_id}>
                <StatusBadge tone={device.status === "online" ? "success" : "danger"}>{device.status === "online" ? "Online" : "Offline"}</StatusBadge>
              </DetailRow>
            )) : <EmptyBlock title="No Counter devices configured" description="Add a Counter device to start taking orders here." action={<Button label="Add device" variant="secondary" href="/dashboard/operations/devices?mode=add" />} />}
          </Panel>
          <Panel title="Current counter activity">
            {orders.length ? orders.map((order) => (
              <DetailRow key={order.id} label={`#${orderNumber(order)}`}>{formatOrderStatus(order.status)}</DetailRow>
            )) : <EmptyBlock title="No counter activity right now" description="Counter orders will appear here as they are created." />}
          </Panel>
        </Grid>
        </>
      ))}
    </DashboardPage>
  );
}

function Inventory({ data, failed, setData }: OpsProps & { setData: Setter<OpsData> }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const rows = data.products.filter((product) => !search || product.name.toLowerCase().includes(search.toLowerCase()));
  const toggle = async (product: Product) => {
    const next = await api.setAvailability(product.id, !product.is_available);
    setData((current) => ({ ...current, products: current.products.map((item) => item.id === next.id ? next : item) }));
    setSelected(next);
  };

  return (
    <DashboardPage>
      <PageHeader title="Inventory" description="Manage item availability and low-stock status." actions={<Button label="Manage Menu" variant="secondary" href="/dashboard/kiosk-experience/menu" />}>
        <Toolbar>
          <TextInput type="search" label="Search menu items" placeholder="Search menu items" value={search} onChange={setSearch} />
        </Toolbar>
      </PageHeader>
      <FailureNotice failed={failed} name="products" />
      {!failed.includes("products") && <InventorySummary products={data.products} />}
      {!failed.includes("products") && (
        <Panel padding={4}>
          {rows.length > 0 && <Table
            idKey="id"
            data={rows as Array<Product & Record<string, unknown>>}
            columns={[
              { key: "item", header: "Item", renderCell: (row: Product) => (
                <HStack gap={3} vAlign="center">
                  <Avatar size="sm" shape="rounded" name={row.name} src={row.primary_image_path ? assetUrl(row.primary_image_path) || undefined : undefined} tooltip={false} />
                  <Button label={`Open ${row.name} details`} variant="ghost" size="sm" onClick={() => setSelected(row)}>{row.name}</Button>
                </HStack>
              ) },
              { key: "status", header: "Status", renderCell: (row: Product) => <StatusBadge tone={row.is_available ? "success" : "warning"}>{row.is_available ? "Available" : "Unavailable"}</StatusBadge> },
              { key: "stock", header: "Stock", renderCell: (row: Product) => row.track_stock ? `${row.stock_quantity ?? 0} units` : <Button label={`Track stock for ${row.name}`} variant="secondary" size="sm" onClick={() => setSelected(row)}>Track stock</Button> },
              { key: "action", header: "Action", align: "end", renderCell: (row: Product) => <Button label={`View ${row.name}`} variant="ghost" size="sm" onClick={() => setSelected(row)}>View</Button> },
            ]}
          />}
          {!rows.length && <EmptyBlock title={data.products.length ? "No items match these filters" : "No menu items yet"} description={data.products.length ? "Try a different search." : "Add menu items before managing inventory."} />}
        </Panel>
      )}
      {selected && (
        <DetailDrawer title={selected.name} isOpen onClose={() => setSelected(null)} footer={<Button label="Close" variant="secondary" onClick={() => setSelected(null)} />}>
          <DetailRow label="Availability">{selected.is_available ? "Available" : "Unavailable"}</DetailRow>
          <StockControl product={selected} onSaved={(next) => { setData((current) => ({ ...current, products: current.products.map((item) => item.id === next.id ? next : item) })); setSelected(next); }} />
          <HStack gap={2} wrap="wrap">
            <Button label={selected.is_available ? "Mark unavailable" : "Mark available"} variant="primary" onClick={() => void toggle(selected)} />
            <Button label="Manage schedule" variant="secondary" href="/dashboard/kiosk-experience/availability" />
          </HStack>
        </DetailDrawer>
      )}
    </DashboardPage>
  );
}

function Devices({ business, data, failed, setData }: OpsProps & { setData: Setter<OpsData> }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const view = params.get("mode") === "add" ? "add" : "manage";
  const setView = (value: string) => router.replace(`${path}?mode=${value}`);
  const [selected, setSelected] = useState<DeviceRecord | null>(null);
  const [type, setType] = useState("kiosk");
  const [pairing, setPairing] = useState<DevicePairingRequest | null>(null);
  const [removing, setRemoving] = useState<DeviceRecord | null>(null);
  const [removeError, setRemoveError] = useState("");
  const removeDevice = async () => {
    if (!removing) return;
    try {
      await api.deleteDevice(removing.business_id, removing.id);
      setData((current) => ({ ...current, devices: current.devices.filter((item) => item.id !== removing.id) }));
      setRemoving(null);
      setSelected(null);
      setRemoveError("");
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : "The device could not be removed.");
      setRemoving(null);
    }
  };

  const generate = async () => setPairing(await api.createDeviceActivationCode(business.id, { device_type: type }));
  const groups = data.devices.reduce<Record<string, DeviceRecord[]>>((out, device) => {
    (out[device.location_label || "Unassigned"] ||= []).push(device);
    return out;
  }, {});

  return (
    <DashboardPage>
      <PageHeader title="Devices" description="Monitor and manage the devices running PlaceURorder.">
        <ModeSwitch label="Device view" value={view} onChange={setView} options={[{ value: "manage", label: "Manage Devices" }, { value: "add", label: "Add Devices" }]} />
      </PageHeader>
      {view === "add" ? (
        <Grid columns={{ minWidth: 340, max: 2, repeat: "fit" }} gap={4} align="start">
          <Panel title="Add a device" description="Choose the device type, then generate a one-time pairing code.">
            <VStack gap={4}>
              <Selector label="Device type" value={type} onChange={setType} options={[{ value: "kiosk", label: "Kiosk" }, { value: "counter", label: "Counter" }, { value: "kitchen", label: "Kitchen" }]} />
              <HStack gap={2}><Button label="Generate pairing code" variant="primary" onClick={() => void generate()} /></HStack>
              {pairing && (
                <Panel title="Pairing code" padding={4}>
                  <VStack gap={2}>
                    <Text type="label" color="primary">{pairing.pairing_code}</Text>
                    <Text type="supporting" color="secondary">{`Expires ${formatDateTime(pairing.expires_at)}`}</Text>
                  </VStack>
                </Panel>
              )}
            </VStack>
          </Panel>
          <Panel title="How pairing works" description="Three steps on the device you are adding.">
            <VStack gap={3}>
              <Text type="body" color="primary">1. Choose the device type and generate a code.</Text>
              <Text type="body" color="primary">2. On the new device, open its pairing screen. A counter opens /device/start.</Text>
              <Text type="body" color="primary">3. Enter the code. The device appears under Manage Devices once it connects.</Text>
            </VStack>
          </Panel>
        </Grid>
      ) : (
        <>
          <FailureNotice failed={failed} name="devices" />
          {!failed.includes("devices") && (
            <VStack gap={4}>
              <MetricGrid>
                <Metric label="Online" value={data.devices.filter((device) => device.status === "online").length} hint="Connected now" />
                <Metric label="Offline" value={data.devices.filter((device) => device.status === "offline").length} hint="Were connected, not now" />
                <Metric label="Never connected" value={data.devices.filter((device) => device.status === "never_connected").length} hint="Paired but not yet started" />
                <Metric label="Other" value={data.devices.filter((device) => !["online", "offline", "never_connected"].includes(device.status)).length} hint="Disabled or pending" />
              </MetricGrid>
              {Object.entries(groups).map(([name, devices]) => (
                <Panel key={name} title={name}>
                  <HStack gap={3} wrap="wrap" vAlign="start">
                    {devices.map((device) => (
                      <ClickableCard key={device.id} label={`Device ${device.name || device.device_id}`} onClick={() => setSelected(device)} padding={3} width={260}>
                        <VStack gap={2}>
                          <Text type="body" weight="semibold">{device.name || device.device_id}</Text>
                          <StatusBadge tone={device.status === "online" ? "success" : device.status === "offline" ? "danger" : "warning"}>{device.status === "never_connected" ? "Never connected" : device.status}</StatusBadge>
                          <Text type="supporting" color="secondary">{device.last_seen ? `Last seen ${formatDateTime(device.last_seen)}` : "Last seen unavailable"}</Text>
                        </VStack>
                      </ClickableCard>
                    ))}
                  </HStack>
                </Panel>
              ))}
              {!data.devices.length && <EmptyBlock title="No devices added yet" description="Add a kiosk, counter or kitchen device." action={<Button label="Add device" variant="primary" onClick={() => setView("add")} />} />}
            </VStack>
          )}
        </>
      )}
      {selected && (
        <DetailDrawer title={selected.name || selected.device_id} isOpen onClose={() => setSelected(null)} footer={<Button label="Close" variant="secondary" onClick={() => setSelected(null)} />}>
          <DetailRow label="Type">{selected.device_type}</DetailRow>
          <DetailRow label="Location">{selected.location_label || "Unassigned"}</DetailRow>
          <DetailRow label="Connection">{selected.status}</DetailRow>
          {selected.status === "never_connected" && <Button label="Remove device" variant="ghost" onClick={() => { setRemoveError(""); setRemoving(selected); }} />}
          {removeError && <NoticeBanner tone="danger" title="Could not remove device" description={removeError} role="alert" />}
          <Button label="Disable device" variant="secondary" onClick={() => void api.disableDevice(selected.business_id, selected.id).then((next) => { setData((current) => ({ ...current, devices: current.devices.map((item) => item.id === next.id ? next : item) })); setSelected(next); })} />
        </DetailDrawer>
      )}
      <ConfirmDialog
        isOpen={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this device?"
        description={`${removing?.name || removing?.device_id || "This device"} has never connected, so removing it loses no history.`}
        confirmLabel="Remove device"
        onConfirm={() => void removeDevice()}
      />
    </DashboardPage>
  );
}

function Alerts({ data, failed, setData }: OpsProps & { setData: Setter<OpsData> }) {
  const [tab, setTab] = useState("all");
  const [openOnly, setOpenOnly] = useState(true);
  const [selected, setSelected] = useState<AlertRecord | null>(null);
  const rows = data.alerts.filter((alert) => (tab === "all" || (tab === "critical" && alert.severity === "critical") || alert.source.includes(tab.slice(0, -1))) && (!openOnly || alert.status !== "resolved"));
  const toggle = async (alert: AlertRecord) => {
    const next = await api.updateAlert(alert.id, alert.business_id, alert.status === "resolved" ? "open" : "resolved");
    setData((current) => ({ ...current, alerts: current.alerts.map((item) => item.id === next.id ? next : item) }));
    setSelected(next);
  };

  return (
    <DashboardPage>
      <PageHeader title="Alerts" description="Review issues that may need your attention.">
        <Toolbar>
          <TabList value={tab} onChange={setTab} size="sm">
            {["all", "critical", "devices", "orders", "inventory"].map((item) => <Tab key={item} value={item} label={item[0].toUpperCase() + item.slice(1)} />)}
          </TabList>
          <Switch label="Open only" value={openOnly} onChange={setOpenOnly} />
        </Toolbar>
      </PageHeader>
      {!failed.includes("alerts") && (
        <MetricGrid>
          <Metric label="Open" value={data.alerts.filter((alert) => alert.status !== "resolved").length} hint="Not yet resolved" />
          <Metric label="Critical" value={data.alerts.filter((alert) => alert.status !== "resolved" && alert.severity === "critical").length} hint="Act on these first" />
          <Metric label="Devices" value={data.alerts.filter((alert) => alert.status !== "resolved" && alert.source.includes("device")).length} hint="Connection and pairing" />
          <Metric label="Orders" value={data.alerts.filter((alert) => alert.status !== "resolved" && alert.source.includes("order")).length} hint="Kitchen and payment" />
          <Metric label="Inventory" value={data.alerts.filter((alert) => alert.status !== "resolved" && alert.source.includes("inventory")).length} hint="Stock and availability" />
        </MetricGrid>
      )}
      <FailureNotice failed={failed} name="alerts" />
      {!failed.includes("alerts") && (
        <Panel title="Needs attention">
          {rows.length ? rows.map((alert) => (
            <HStack key={alert.id} gap={3} vAlign="center" hAlign="between" wrap="wrap">
              <HStack gap={3} vAlign="center" wrap="wrap">
                <StatusBadge tone={alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}>{capitalise(alert.severity)}</StatusBadge>
                <VStack gap={1}>
                  <Text type="body" weight="semibold">{alert.title}</Text>
                  <Text type="supporting" color="secondary">{alert.message} · {formatDateTime(alert.created_at)}</Text>
                </VStack>
              </HStack>
              <Button label={`Review ${alert.title}`} variant="secondary" onClick={() => setSelected(alert)} />
            </HStack>
          )) : <EmptyBlock title="No active alerts" description="Everything currently looks operational." />}
        </Panel>
      )}
      {selected && (
        <DetailDrawer title={selected.title} isOpen onClose={() => setSelected(null)} footer={<Button label="Close" variant="secondary" onClick={() => setSelected(null)} />}>
          <Text type="body">{selected.message}</Text>
          <Button label={selected.status === "resolved" ? "Reopen alert" : "Mark resolved"} variant="primary" onClick={() => void toggle(selected)} />
        </DetailDrawer>
      )}
    </DashboardPage>
  );
}

function OrderDetails({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <DetailDrawer title={`Order #${orderNumber(order)}`} isOpen onClose={onClose} footer={<Button label="Close" variant="secondary" onClick={onClose} />}>
      <StatusBadge tone={order.status === "completed" ? "success" : order.status === "cancelled" ? "danger" : "info"}>{formatOrderStatus(order.status)}</StatusBadge>
      <DetailRow label="Type">{order.order_type.replaceAll("_", "-")}</DetailRow>
      <DetailRow label="Placed">{formatDateTime(order.placed_at)}</DetailRow>
      <DetailRow label="Payment">{formatPaymentStatus(order.payment_status)}</DetailRow>
      <Text type="label">Items</Text>
      {order.order_items?.length
        ? order.order_items.map((item) => <DetailRow key={item.id} label={`${item.quantity}×`}>{item.product_name}</DetailRow>)
        : <Text type="supporting" color="secondary">Item details unavailable</Text>}
    </DetailDrawer>
  );
}

function LiveSummary({ orders }: { orders: Order[] }) {
  const oldest = orders.reduce<Order | null>((best, order) => (!best || order.placed_at < best.placed_at ? order : best), null);
  return (
    <MetricGrid>
      <Metric label="Open orders" value={orders.length} hint="New, preparing and ready" />
      <Metric label="Waiting to start" value={orders.filter((order) => order.status === "pending").length} hint="Not yet in preparation" />
      <Metric label="Running late" value={orders.filter(isDelayed).length} hint="Past the expected prep time" />
      <Metric label="Oldest open order" value={oldest ? elapsed(oldest.placed_at) : "None"} />
    </MetricGrid>
  );
}

function OrderSummary({ orders, symbol }: { orders: Order[]; symbol: string }) {
  const completed = orders.filter((order) => order.status === "completed");
  const sales = completed.reduce((sum, order) => sum + order.total_amount, 0);
  const cancelled = orders.filter((order) => order.status === "cancelled").length;
  return (
    <MetricGrid>
      <Metric label="Orders" value={orders.length} hint="In the selected period" />
      <Metric label="Completed" value={completed.length} hint={`${cancelled} cancelled`} />
      <Metric label="Completed sales" value={money(sales, symbol)} />
      <Metric label="Average completed order" value={money(completed.length ? sales / completed.length : 0, symbol)} />
    </MetricGrid>
  );
}

function OrderVolume({ orders }: { orders: Order[] }) {
  const byDay = new Map<string, number>();
  orders.forEach((order) => {
    const day = order.placed_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  });
  const values = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ label: day.slice(5), value: count }));
  return <DailyBars values={values} ariaLabel="Orders per day" format={(value) => String(Math.round(value))} />;
}

function InventorySummary({ products }: { products: Product[] }) {
  const tracked = products.filter((product) => product.track_stock);
  const outOfStock = tracked.filter((product) => (product.stock_quantity ?? 0) <= 0).length;
  const unavailable = products.filter((product) => !product.is_available).length;
  return (
    <MetricGrid>
      <Metric label="Menu items" value={products.length} />
      <Metric label="Stock tracked" value={tracked.length} hint={`${products.length - tracked.length} not tracked`} />
      <Metric label="Out of stock" value={outOfStock} hint="Tracked items at zero" />
      <Metric label="Unavailable" value={unavailable} hint="Hidden from the kiosk" />
    </MetricGrid>
  );
}

// Units on hand for an item. Turning tracking on or off saves at once; the quantity saves on its own button.
function StockControl({ product, onSaved }: { product: Product; onSaved: (next: Product) => void }) {
  const [quantity, setQuantity] = useState(String(product.stock_quantity ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (patch: Partial<Product>) => {
    setBusy(true);
    setError("");
    try {
      onSaved(await api.updateProduct(product.id, patch));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stock could not be updated.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
        <Text type="body" color="secondary">{product.track_stock ? "Stock is tracked for this item." : "Stock is not tracked for this item."}</Text>
        <Button label={product.track_stock ? "Stop tracking" : "Track stock"} variant="secondary" size="sm" isLoading={busy} onClick={() => void save({ track_stock: !product.track_stock, stock_quantity: product.track_stock ? null : Math.max(0, Math.floor(Number(quantity) || 0)) })} />
      </HStack>
      {product.track_stock && (
        <HStack gap={2} vAlign="end">
          <TextInput label="Units on hand" inputMode="numeric" value={quantity} onChange={setQuantity} width="100%" />
          <Button label="Save quantity" variant="primary" isLoading={busy} onClick={() => void save({ stock_quantity: Math.max(0, Math.floor(Number(quantity) || 0)) })} />
        </HStack>
      )}
      {error && <NoticeBanner tone="danger" title="Stock was not updated" description={error} role="alert" />}
    </VStack>
  );
}

function downloadOrders(rows: Order[]) {
  const header = ["Order", "Placed at", "Type", "Items", "Total", "Payment", "Status"];
  const body = rows.map((order) => [orderNumber(order), order.placed_at, order.order_type, itemCount(order), order.total_amount, order.payment_status, order.status]);
  const csv = [header, ...body].map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "order-history.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function orderNumber(order: Order) {
  return String(order.order_number ?? order.public_token ?? "Pending");
}
function itemCount(order: Order) {
  return order.order_items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
}
function isDelayed(order: Order) {
  return !["completed", "cancelled"].includes(order.status) && Date.now() - new Date(order.placed_at).getTime() > 15 * 60000;
}
function elapsed(value: string) {
  return `${Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000))} min`;
}
function money(value: number, symbol: string) {
  return formatCurrency(value, symbol || "INR");
}
function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function capitalise(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
function isoDate(offset: number) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
}
