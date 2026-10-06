"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart } from "@/components/charts/ChartPrimitives";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { PageContainer, SectionHeader } from "@/components/layout/DashboardPrimitives";
import { Button, DataState, DetailsDrawer, SearchInput, Select, Skeleton, StatusBadge, StatusPill } from "@/components/ui/DashboardUI";
import { AutoRecoveringState } from "@/components/ui/AutoRecoveringState";
import { DashboardHomeSkeleton } from "@/components/ui/Skeletons";
import { api, assetUrl } from "@/lib/api";
import { formatCurrency, formatDateTime, formatDuration, formatOrderStatus } from "@/lib/formatters";
import type { AlertRecord, DashboardStats, DeviceRecord, HomeActivation, KioskSetupOverview, Order, Product } from "@/lib/types";
import { resolveHomeMode, type HomeMode } from "@/components/dashboard/home-state";

type HomeData = {
  activation: HomeActivation;
  setup: KioskSetupOverview;
  products: Product[];
  stats: DashboardStats | null;
  orders: Order[];
  activeOrders: Order[];
  alerts: { alerts: AlertRecord[]; summary: { unresolved_count: number; critical_count: number; warning_count: number } } | null;
  devices: DeviceRecord[] | null;
};

const commands = [
  ["View today’s sales", "/dashboard/insights/sales-reports"], ["Check devices", "/dashboard/operations/devices"],
  ["Add a menu item", "/dashboard/kiosk-experience/menu?mode=items"], ["Publish kiosk changes", "/dashboard/kiosk-experience/publish"],
  ["View live orders", "/dashboard/operations/live-orders"], ["Open test device", "/dashboard/test"],
] as const;

const setupCards = [
  { key: "menu", title: "Add Your First Product", description: "Add a name, price, category and image to begin building your menu.", action: "Add Product", href: "/setup/menu-items", asset: "/home-assets/burger.png", tone: "orange" },
  { key: "kiosk", title: "Customise Your Kiosk", description: "Choose a layout and customise how your kiosk looks and feels.", action: "Customise Kiosk", href: "/setup/kiosk-layout", asset: "/home-assets/kiosk.png", tone: "purple" },
  { key: "business", title: "Edit Business Details", description: "Update your business name, logo, address and contact details.", action: "Edit Details", href: "/setup/business-details", asset: "/home-assets/storefront.png", tone: "blue" },
  { key: "payments", title: "Connect Payments", description: "Configure a payment method so your kiosk can accept orders.", action: "Connect Payment", href: "/dashboard/administration/payments", asset: "/home-assets/payment-terminal.png", tone: "green" },
] as const;

const homeAssetSizes: Record<string, { width: number; height: number }> = {
  "/home-assets/alerts-clear.png": { width: 425, height: 455 },
  "/home-assets/burger.png": { width: 447, height: 558 },
  "/home-assets/kiosk.png": { width: 447, height: 558 },
  "/home-assets/kitchen-clear.png": { width: 965, height: 740 },
  "/home-assets/payment-terminal.png": { width: 559, height: 446 },
  "/home-assets/sales-empty.png": { width: 520, height: 370 },
  "/home-assets/storefront.png": { width: 260, height: 241 },
};

export function HomePage() {
  const { business, loading: businessLoading, error: businessError, locationsLoading, selectedLocationId } = useBusiness();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const requestKey = `${business?.id || ""}:${selectedLocationId || "all"}`;

  const [reloadToken, setReloadToken] = useState(0);
  const retry = useCallback(() => {
    setLoadedKey("");
    setError("");
    setReloadToken((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!business?.id) return;
    let current = true;
    void Promise.all([api.homeActivation(business.id, selectedLocationId), api.kioskSetup(business.id), api.products(business.id)])
      .then(([activation, setup, products]) => { if (current) { setData({ activation, setup, products: products.products, stats: null, orders: [], activeOrders: [], alerts: null, devices: null }); setError(""); setLoadedKey(requestKey); } })
      .catch((cause) => { if (current) { setError(cause instanceof Error ? cause.message : "Could not load Home."); setLoadedKey(requestKey); } });
    return () => { current = false; };
  }, [business?.id, reloadToken, requestKey, selectedLocationId]);

  const mode = data && business ? resolveHomeMode(business, data.setup, data.products, data.activation.completed_order_count) : null;
  useEffect(() => {
    if (!business?.id || !mode || mode === "setup") return;
    let current = true;
    void Promise.allSettled([api.dashboard(business.id, { ...rangeFor("today"), locationId: selectedLocationId }), api.orders(business.id, { limit: 5 }), api.orders(business.id, "active"), api.alerts(business.id), api.devices(business.id)])
      .then(([stats, orders, activeOrders, alerts, devices]) => {
        if (!current) return;
        setData((value) => value && ({ ...value, stats: stats.status === "fulfilled" ? stats.value : null, orders: orders.status === "fulfilled" ? orders.value.orders : [], activeOrders: activeOrders.status === "fulfilled" ? activeOrders.value.orders : [], alerts: alerts.status === "fulfilled" ? alerts.value : null, devices: devices.status === "fulfilled" ? devices.value.devices : null }));
      });
    return () => { current = false; };
  }, [business?.id, data?.activation.completed_order_count, mode, reloadToken, selectedLocationId]);

  if (businessLoading || locationsLoading || loadedKey !== requestKey || (!data && !error && !businessError)) {
    return (
      <PageContainer width="maximum" className="mt-home-page">
        <DashboardHomeSkeleton />
      </PageContainer>
    );
  }

  if (businessError || error) {
    return (
      <PageContainer width="standard" style={{ padding: "40px 16px" }}>
        <AutoRecoveringState
          title="Home is unavailable"
          description={businessError || error}
          onRetry={retry}
        />
      </PageContainer>
    );
  }

  if (!business || !data || !mode) return <PageContainer width="standard"><DataState kind="permission-denied" title="No business selected" description="Complete business setup before opening the owner dashboard." action={<Link className="mt-card-link" href="/setup/business-details">Open setup</Link>} /></PageContainer>;
  return <PageContainer width="maximum" className="mt-home-page"><HomeLayout mode={mode} businessName={business.name}>{mode === "setup" ? <SetupHome business={business} setup={data.setup} products={data.products} /> : <BusinessHome business={business} data={data} mode={mode} locationId={selectedLocationId} />}</HomeLayout></PageContainer>;
}

function HomeHero({ mode, businessName, children }: { mode: HomeMode; businessName: string; children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const router = useRouter();
  const matches = commands.filter(([label]) => label.toLowerCase().includes(query.toLowerCase()));
  const go = (href: string) => { setQuery(""); router.push(href); };
  return <><section className="mt-home-hero"><p className="mt-home-greeting">Good morning, {businessName || "there"}! <span aria-hidden="true">👋</span></p><h1 className="mt-type-page-heading">{mode === "setup" ? "Welcome to PlaceURorder" : <>Here’s what’s happening with <em>your business</em></>}</h1>{mode === "setup" && <p className="mt-home-hero-copy">Where would you like to start?</p>}<div className="mt-home-command"><SearchInput label="Search orders, menu items, devices, pages or actions" placeholder={mode === "setup" ? "Search or tell us what you want to set up" : "Search orders, menu items, devices, pages or actions…"} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); if (event.key === "Enter" && matches[0]) { event.preventDefault(); go(matches[0][1]); } }} />{query && <div className="mt-home-command-results" role="listbox" aria-label="Home actions">{matches.length ? matches.map(([label, href], index) => <button type="button" key={href} role="option" aria-selected={index === 0} onClick={() => go(href)}>{label}<span aria-hidden="true">→</span></button>) : <span>No matching actions.</span>}</div>}</div></section>{children}</>;
}

function HomeLayout({ mode, businessName, children }: { mode: HomeMode; businessName: string; children: React.ReactNode }) { return <HomeHero mode={mode} businessName={businessName}>{children}</HomeHero>; }

function SetupHome({ business, setup, products }: { business: NonNullable<ReturnType<typeof useBusiness>["business"]>; setup: KioskSetupOverview; products: Product[] }) {
  const payment = business.kiosk_order_settings?.default_payment_method || business.payment_summary?.default_payment_method;
  const needsOnlinePayment = Boolean(payment && !["cash", "counter", "pay_at_counter"].includes(payment));
  const completed = { menu: setup.status.menuComplete && products.some((product) => product.is_available && product.category_id), kiosk: setup.status.kioskSettingsComplete && setup.status.welcomeScreenComplete, business: setup.status.businessComplete, payments: !needsOnlinePayment || Boolean(business.payment_summary?.enabled_methods?.length) };
  const completeCount = Object.values(completed).filter(Boolean).length;
  const next = setupCards.find((card) => !completed[card.key]);
  return <section className="mt-home-content"><div className="mt-home-setup-progress"><div><strong>{completeCount} of 4 essentials complete</strong><span>{next ? `Next: ${next.title}` : "Everything is ready for your first order."}</span></div><div className="mt-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={completeCount}><span style={{ width: `${completeCount * 25}%` }} /></div></div><div className="mt-home-grid mt-home-setup-grid">{setupCards.map((card) => <Link className={`mt-home-card mt-home-setup-action mt-home-setup-action--${card.tone}${completed[card.key] ? " is-complete" : ""}${next?.key === card.key ? " is-next" : ""}`} href={card.href} key={card.key}><div><span className="mt-home-card-icon" aria-hidden="true">{completed[card.key] ? "✓" : "→"}</span>{completed[card.key] && <StatusBadge status="success">Completed</StatusBadge>}<h2>{card.title}</h2><p>{card.description}</p><span className="mt-button mt-button--primary">{completed[card.key] ? "Review" : card.action}</span></div><span className="mt-home-setup-art"><HomeAsset src={card.asset} /></span></Link>)}</div></section>;
}

function BusinessHome({ business, data, mode, locationId }: { business: NonNullable<ReturnType<typeof useBusiness>["business"]>; data: HomeData; mode: HomeMode; locationId: string | null }) {
  const [salesPeriod, setSalesPeriod] = useState("today");
  const [selectedStats, setStats] = useState(data.stats);
  const [updating, setUpdating] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [kitchenFilter, setKitchenFilter] = useState("active");
  const stats = salesPeriod === "today" ? data.stats : selectedStats;
  const changeSalesPeriod = async (period: string) => { setSalesPeriod(period); setUpdating(true); try { setStats(await api.dashboard(business.id, { ...rangeFor(period), locationId })); } finally { setUpdating(false); } };
  const alerts = data.alerts?.alerts.filter((alert) => alert.status !== "resolved") || [];
  const statuses = mode === "active" ? contextualStatuses(data, alerts).slice(0, 3) : [];
  return <section className={`mt-home-content${mode === "active" ? " mt-home-active" : ""}`}>{statuses.length > 0 && <div className="mt-home-contextual-status">{statuses.map((item) => <Link className="mt-home-status-link" key={item.label} href={item.href}><StatusBadge status={item.status}>{item.label}</StatusBadge></Link>)}</div>}<div className="mt-home-grid"><SalesCard business={business} stats={stats} period={salesPeriod} onPeriod={changeSalesPeriod} loading={updating} /><MenuCard business={business} stats={stats} products={data.products} /><KitchenCard orders={data.activeOrders} filter={kitchenFilter} setFilter={setKitchenFilter} onOrder={setSelectedOrder} /><DevicesCard devices={data.devices} /><AlertsCard alerts={alerts} total={data.alerts?.summary.unresolved_count || 0} /><OrdersCard business={business} orders={data.orders} completedOrders={data.activation.completed_order_count} onOrder={setSelectedOrder} /></div>{mode === "first_order" && <FirstOrderJourney setup={data.setup} products={data.products} />}{selectedOrder && <OrderDrawer business={business} order={selectedOrder} close={() => setSelectedOrder(null)} />}</section>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <article className={`mt-home-card ${className}`}>{children}</article>; }

function SalesCard({ business, stats, period, onPeriod, loading }: { business: NonNullable<ReturnType<typeof useBusiness>["business"]>; stats: DashboardStats | null; period: string; onPeriod: (period: string) => void; loading: boolean }) {
  const hasSales = Boolean(stats?.completed_orders);
  return <Card className="mt-home-sales"><SectionHeader title="Sales Overview" actions={<Select label="Sales period" value={period} onChange={(event) => onPeriod(event.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></Select>} />{loading ? <Skeleton lines={4} label="Updating sales" /> : hasSales ? <><div className="mt-home-sales-total"><div><span>{period === "today" ? "Today’s revenue" : "Revenue"}</span><strong>{formatCurrency(stats?.period_net_sales ?? stats?.net_sales_today, business.currency_code || "INR")}</strong><small>{stats?.completed_orders} completed orders</small></div><div className="mt-home-sales-support"><span>Orders <b>{stats?.completed_orders || 0}</b></span><span>Avg. order <b>{formatCurrency(stats?.period_average_order_value ?? stats?.average_order_value, business.currency_code || "INR")}</b></span><span>Items sold <b>{stats?.items_sold ?? "—"}</b></span></div></div><LineChart values={stats?.weekly_revenue?.map((point) => ({ label: point.date, value: point.revenue })) || []} ariaLabel="Sales overview trend" /><Link className="mt-card-link" href="/dashboard/insights/sales-reports">View Sales &amp; Reports →</Link></> : <EmptyContent title={period === "today" && business ? "No sales today" : "No sales yet"} description={period === "today" && business ? "Completed sales for today will appear here." : "Once you receive completed orders, your sales summary will appear here."} action="View Order History" href="/dashboard/operations/order-history" kind="chart" />}</Card>;
}

function MenuCard({ business, stats, products }: { business: NonNullable<ReturnType<typeof useBusiness>["business"]>; stats: DashboardStats | null; products: Product[] }) {
  const router = useRouter();
  const items = stats?.top_selling_items || [];
  const productMap = new Map(products.map((product) => [product.name.toLowerCase(), product]));
  return <Card><SectionHeader title="Menu Performance" description="Top items in the last 7 days" actions={<Link className="mt-card-link" href="/dashboard/insights/menu-performance">View full performance →</Link>} />{items.length ? <ol className="mt-home-performance-list">{items.slice(0, 5).map((item, index) => { const product = productMap.get(item.name.toLowerCase()); return <li key={item.name}><span>{index + 1}</span>{product?.primary_image_path ? <i style={{ backgroundImage: `url(${assetUrl(product.primary_image_path)})` }} /> : <i className="mt-home-product-placeholder" /> }<button type="button" onClick={() => router.push(`/dashboard/kiosk-experience/menu?product=${product?.id || ""}`)}><b>{item.name}</b><small>{item.quantity} sold</small></button><em style={{ width: `${Math.max(12, item.quantity / Math.max(...items.map((entry) => entry.quantity)) * 100)}%` }} /><strong>{formatCurrency(item.revenue, business.currency_code || "INR")}</strong></li>; })}</ol> : <EmptyContent title="No menu performance data" description="Add menu items and start receiving orders to see performance insights." action={products.length ? "Manage Menu" : "Add Menu Items"} href="/dashboard/kiosk-experience/menu?mode=items" kind="burger" />}</Card>;
}

function KitchenCard({ orders, filter, setFilter, onOrder }: { orders: Order[]; filter: string; setFilter: (value: string) => void; onOrder: (order: Order) => void }) {
  const summary = kitchenSummary(orders); const shown = filter === "active" ? orders : orders.filter((order) => order.status === filter);
  return <Card><SectionHeader title="What’s happening in kitchen" description="Live production status" actions={<Link className="mt-card-link" href="/dashboard/operations/live-orders">View all orders →</Link>} />{orders.length ? <><div className="mt-home-kitchen-filters">{[["active", `Active ${summary.active}`], ["preparing", `Preparing ${summary.preparing}`], ["ready", `Ready ${summary.ready}`], ["delayed", `Delayed ${summary.delayed}`]].map(([value, label]) => <button type="button" className={filter === value ? `is-${value}` : ""} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div><ul className="mt-home-live-list">{shown.slice(0, 4).map((order) => <li key={order.id} className={isDelayed(order) ? "is-delayed" : ""}><button type="button" onClick={() => onOrder(order)}><b>{order.order_number ? `Order ${order.order_number}` : "New order"}</b><span>{formatOrderType(order.order_type)} · {order.order_items?.length || 0} items</span><StatusPill status={order.status === "ready" ? "success" : order.status === "preparing" ? "warning" : "info"}>{formatOrderStatus(order.status)}</StatusPill><small>{formatElapsed(order.placed_at)}</small><i aria-hidden="true">›</i></button></li>)}</ul></> : <EmptyContent title="Kitchen is all clear" description="No active or pending orders in the kitchen right now. You’re all set!" href="/dashboard/operations/order-history" action="View All Orders" kind="cloche" badge="All clear" />}</Card>;
}

function DevicesCard({ devices }: { devices: DeviceRecord[] | null }) { return <Card><SectionHeader title="Active Devices" description="All your devices at a glance" actions={<Link className="mt-card-link" href="/dashboard/operations/devices">Manage devices →</Link>} />{devices === null ? <Skeleton lines={4} label="Loading devices" /> : devices.length ? <ul className="mt-home-device-list">{devices.slice(0, 4).map((device) => <li key={device.id}><Link href="/dashboard/operations/devices"><DeviceAsset type={device.device_type} /><span><b>{device.name || "Unnamed device"}</b><small>{device.device_type || "Device"}{device.location_label ? ` · ${device.location_label}` : ""}</small></span><StatusPill status={device.status === "online" ? "success" : device.status === "offline" ? "danger" : "warning"}>{formatDeviceStatus(device.status)}</StatusPill><i aria-hidden="true">›</i></Link></li>)}</ul> : <EmptyContent title="No devices added" description="Add your first kiosk, kitchen display or counter device to get started." action="Add Device" href="/dashboard/operations/devices" kind="devices" />}</Card>; }

function AlertsCard({ alerts, total }: { alerts: AlertRecord[]; total: number }) { return <Card><SectionHeader title={alerts.length ? "Action Centre" : "Alerts"} description={alerts.length ? `${total} item${total === 1 ? "" : "s"} need attention` : undefined} actions={<Link className="mt-card-link" href="/dashboard/operations/alerts">View all alerts →</Link>} />{alerts.length ? <ul className="mt-home-alert-list">{alerts.slice(0, 3).map((alert) => <li key={alert.id}><Link href="/dashboard/operations/alerts"><StatusBadge status={alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}>{alert.severity || "Info"}</StatusBadge><span><b>{alert.title || "Attention needed"}</b><small>{alert.message || "Open this alert to review the next step."}</small></span><i aria-hidden="true">›</i></Link></li>)}</ul> : <EmptyContent title="No alerts right now" description="Great! There are no issues or actions that need your attention." href="/dashboard/operations/alerts" action="View All Alerts" kind="checklist" badge="Everything good" />}</Card>; }

function OrdersCard({ business, orders, completedOrders, onOrder }: { business: NonNullable<ReturnType<typeof useBusiness>["business"]>; orders: Order[]; completedOrders: number; onOrder: (order: Order) => void }) { return <Card><SectionHeader title="Recent Orders" description="Latest completed orders" actions={<Link className="mt-card-link" href="/dashboard/operations/order-history">View all orders →</Link>} />{orders.length ? <ul className="mt-home-order-list">{orders.slice(0, 5).map((order) => <li key={order.id}><button type="button" onClick={() => onOrder(order)}><span><b>{order.order_number ? `Order ${order.order_number}` : "New order"}</b><small>{formatOrderType(order.order_type)} · {formatDateTime(order.placed_at, business.timezone || undefined)}</small></span><StatusPill status={order.status === "completed" ? "success" : order.status === "cancelled" ? "danger" : "info"}>{formatOrderStatus(order.status)}</StatusPill><strong>{formatCurrency(order.total_amount, business.currency_code || "INR")}</strong><i aria-hidden="true">›</i></button></li>)}</ul> : <EmptyContent title={completedOrders ? "No orders yet today" : "No recent orders"} description={completedOrders ? "Completed orders in the selected location will show here." : "Once orders are placed, your recent orders will show up here."} href="/dashboard/operations/order-history" action="View Order History" kind="receipt" badge="No orders yet" />}</Card>; }

function EmptyContent({ title, description, href, action, kind, badge }: { title: string; description: string; href: string; action: string; kind: "chart" | "burger" | "cloche" | "devices" | "checklist" | "receipt"; badge?: string }) { return <div className="mt-home-empty"><div><>{badge && <StatusBadge status="success">{badge}</StatusBadge>}</><h3>{title}</h3><p>{description}</p><Link className={kind === "devices" || kind === "chart" || kind === "burger" ? "mt-button mt-button--primary" : "mt-card-link"} href={href}>{action}{kind !== "devices" && kind !== "chart" && kind !== "burger" ? " →" : ""}</Link></div><div className="mt-home-empty-visual"><MiniIllustration kind={kind} /></div></div>; }

function MiniIllustration({ kind }: { kind: string }) { if (kind === "burger") return <span className="mt-home-empty-art mt-home-empty-art--image mt-home-empty-art--burger"><HomeAsset src="/home-assets/burger.png" /></span>; if (kind === "devices") return <span className="mt-home-device-group"><HomeAsset src="/home-assets/kiosk.png" /><HomeAsset src="/home-assets/payment-terminal.png" /><i /><i /></span>; if (kind === "chart" || kind === "cloche" || kind === "checklist") { const asset = kind === "chart" ? "sales-empty.png" : kind === "cloche" ? "kitchen-clear.png" : "alerts-clear.png"; return <span className={`mt-home-empty-art mt-home-empty-art--image mt-home-empty-art--${kind}`}><HomeAsset src={`/home-assets/${asset}`} /></span>; } return <svg className="mt-home-empty-art mt-home-empty-art--receipt" viewBox="0 0 120 100" aria-hidden="true"><circle cx="60" cy="50" r="42" /><path d="M37 24h46v52H37zM47 38h26M47 51h26M47 64h18" /></svg>; }

function FirstOrderJourney({ setup, products }: { setup: KioskSetupOverview; products: Product[] }) { const steps = [{ label: "Add Menu Items", detail: "Add products and set categories", complete: setup.status.menuComplete && products.some((product) => product.is_available && product.category_id), href: "/dashboard/kiosk-experience/menu?mode=items" }, { label: "Choose Kiosk Layout", detail: "Pick the best layout for your business", complete: setup.status.kioskSettingsComplete, href: "/dashboard/kiosk-experience/screens" }, { label: "Publish Kiosk", detail: "Preview and publish your kiosk", complete: setup.status.published && !setup.unpublishedChanges, href: "/dashboard/kiosk-experience/publish" }, { label: "Receive Orders", detail: "Start receiving orders from customers", complete: false, href: "/dashboard/test" }]; const next = steps.find((step) => !step.complete) || steps.at(-1)!; return <section className="mt-home-journey"><div><h2>Need help getting started?</h2><p>Follow these steps to start receiving orders from your customers.</p></div><ol>{steps.map((step, index) => <li className={step.complete ? "is-complete" : step === next ? "is-current" : ""} key={step.label}><span>{step.complete ? "✓" : index + 1}</span><b>{step.label}</b><small>{step.detail}</small></li>)}</ol><Link className="mt-button mt-button--primary" href={next.href}>{next.label}</Link></section>; }

function HomeAsset({ src }: { src: string }) { const size = homeAssetSizes[src]; return <Image src={src} alt="" width={size.width} height={size.height} unoptimized />; }

function DeviceAsset({ type }: { type?: string | null }) { return <span className="mt-home-device-asset">{type === "kiosk" ? <HomeAsset src="/home-assets/kiosk.png" /> : type === "counter" ? <HomeAsset src="/home-assets/payment-terminal.png" /> : <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="9" width="32" height="25" rx="3" /><path d="M18 40h12M24 34v6" /></svg>}</span>; }

function OrderDrawer({ business, order, close }: { business: NonNullable<ReturnType<typeof useBusiness>["business"]>; order: Order; close: () => void }) { return <DetailsDrawer open onClose={close} title={order.order_number ? `Order ${order.order_number}` : "Order details"} footer={<Button variant="secondary" onClick={close}>Close</Button>}><p>Status: {formatOrderStatus(order.status)}</p><p>Placed: {formatDateTime(order.placed_at, business.timezone || undefined)}</p><p>Total: {formatCurrency(order.total_amount, business.currency_code || "INR")}</p>{order.order_items?.length ? <ul>{order.order_items.map((item) => <li key={item.id}>{item.product_name} × {item.quantity}</li>)}</ul> : <DataState kind="info" title="Item details unavailable" />}</DetailsDrawer>; }

function rangeFor(period: string) { const end = new Date(); const start = new Date(end); start.setDate(end.getDate() - (period === "today" ? 0 : period === "yesterday" ? 1 : period === "30d" ? 29 : 6)); if (period === "yesterday") end.setDate(end.getDate() - 1); return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }; }
function formatOrderType(value?: string | null) { return value === "dine_in" ? "Dine-in" : value === "takeaway" ? "Takeaway" : value === "pickup" ? "Pickup" : value === "delivery" ? "Delivery" : "Order"; }
function formatDeviceStatus(value?: string | null) { return value ? value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : "Unknown"; }
function formatElapsed(value?: string | null) { return value ? formatDuration(Math.max(0, (Date.now() - new Date(value).getTime()) / 1000)) : "Just now"; }
function isDelayed(order: Order) { return Boolean(order.placed_at && Date.now() - new Date(order.placed_at).getTime() > 30 * 60 * 1000 && order.status !== "ready"); }
function kitchenSummary(orders: Order[]) { return { active: orders.length, preparing: orders.filter((order) => order.status === "preparing").length, ready: orders.filter((order) => order.status === "ready").length, delayed: orders.filter(isDelayed).length }; }
function contextualStatuses(data: HomeData, alerts: AlertRecord[]) { const items: Array<{ label: string; status: "success" | "warning" | "danger" | "info"; href: string }> = []; if (alerts.some((alert) => alert.severity === "critical")) items.push({ label: "Critical alerts need attention", status: "danger", href: "/dashboard/operations/alerts" }); if (data.setup.unpublishedChanges) items.push({ label: `${data.setup.unpublishedChanges} changes need publishing`, status: "warning", href: "/dashboard/kiosk-experience/publish" }); if ((data.devices || []).some((device) => device.status === "offline")) items.push({ label: "A device is offline", status: "danger", href: "/dashboard/operations/devices" }); return items; }
