"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Selector } from "@astryxdesign/core/Selector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Table } from "@astryxdesign/core/Table";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { DashboardPage, DetailDrawer, DetailRow, EmptyBlock, LoadingBlock, Metric, MetricGrid, NoticeBanner, PageHeader, Panel, StatusBadge, Toolbar, type Tone, useLiveRefresh } from "@/components/dashboard/kit";
import { DailyBars, LineChart, RankedBars, SegmentedShare, type Series } from "@/components/dashboard/charts";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { api } from "@/lib/api";
import { formatCategoryName, formatCurrency, formatDateTime, formatOrderStatus, formatPaymentStatus } from "@/lib/formatters";
import type { Category, DashboardStats, DeviceRecord, Order, Product } from "@/lib/types";

type Mode = "sales-reports" | "analytics" | "menu-performance" | "reports";
type Reporting = { preset: "today" | "7d" | "30d"; start: string; end: string; comparison: "previous" | "none"; locationId: string | null };
type PaymentAnalytics = Awaited<ReturnType<typeof api.payments>>;
type Data = { stats: DashboardStats; previous: DashboardStats | null; orders: Order[]; products: Product[]; categories: Category[]; devices: DeviceRecord[] | null; payments: PaymentAnalytics | null };
type LocationOption = { id: string; name: string };
type Props = { data: Data; locations: LocationOption[]; reporting: Reporting; onChange: (next: Partial<Reporting>) => void; errors: Record<string, string>; retry: () => void };
type Measure = "sales" | "orders" | "aov";

const measureOptions: Array<{ value: Measure; label: string }> = [{ value: "sales", label: "Revenue" }, { value: "orders", label: "Orders" }, { value: "aov", label: "Average order value" }];
const measureDescriptions: Record<Measure, string> = {
  sales: "Completed sales per day in the selected period.",
  orders: "Completed orders per day in the selected period.",
  aov: "Average order value per day in the selected period.",
};

export function BusinessInsightsPage({ mode }: { mode: Mode }) {
  return <Suspense fallback={<DashboardPage><LoadingBlock rows={4} /></DashboardPage>}><Insights mode={mode} /></Suspense>;
}

function Insights({ mode }: { mode: Mode }) {
  const { business, loading: businessLoading, error: businessError, locations } = useBusiness();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const reporting = useReporting(params);
  const [retryCount, setRetryCount] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fullAnalytics = mode === "analytics" && params.get("full") === "1";
  const { start, end, locationId, comparison } = reporting;

  useEffect(() => {
    if (!business?.id) return;
    let alive = true;
    void Promise.resolve().then(async () => {
      if (!alive) return null;
      setLoading(true);
      setError("");
      return loadInsightsData(business.id, { start, end, locationId, comparison }, mode, fullAnalytics);
    }).then((result) => {
      if (!alive || !result) return;
      setData(result.data);
      setErrors(result.errors);
      setLoading(false);
    }).catch((cause) => {
      if (!alive) return;
      setError(cause instanceof Error ? cause.message : "Couldn't load Insights.");
      setLoading(false);
    });
    return () => { alive = false; };
  }, [business?.id, comparison, end, fullAnalytics, locationId, mode, retryCount, start]);

  const update = (next: Partial<Reporting>) => {
    const merged = { ...reporting, ...next };
    const query = new URLSearchParams(params.toString());
    query.set("preset", merged.preset);
    query.set("start", merged.start);
    query.set("end", merged.end);
    query.set("comparison", merged.comparison);
    if (merged.locationId) query.set("location_id", merged.locationId);
    else query.delete("location_id");
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };
  const retry = () => setRetryCount((value) => value + 1);
  useLiveRefresh(retry, 60000);

  if (businessLoading || (business && loading && !data)) return <DashboardPage><LoadingBlock rows={4} /></DashboardPage>;
  if (businessError) return <DashboardPage><NoticeBanner tone="danger" title="Couldn't load Insights" description={businessError} action={<Button label="Try again" variant="secondary" onClick={retry} />} /></DashboardPage>;
  if (!business) return <DashboardPage><NoticeBanner tone="warning" title="No business selected" description="Choose a business before opening Insights." action={<Button label="Open setup" variant="secondary" href="/setup/business-details" />} /></DashboardPage>;
  if (error) return <DashboardPage><NoticeBanner tone="danger" title="Couldn't load Insights" description={error} action={<Button label="Try again" variant="secondary" onClick={retry} />} /></DashboardPage>;
  if (!data) return <DashboardPage><LoadingBlock rows={4} /></DashboardPage>;

  const common = { data, locations: locations.map((item) => ({ id: item.id, name: item.name })), reporting, onChange: update, errors, retry };
  if (mode === "sales-reports") return <DashboardPage><SalesOrders {...common} /></DashboardPage>;
  if (fullAnalytics) return <DashboardPage><FullAnalytics {...common} /></DashboardPage>;

  return (
    <DashboardPage>
      <PageHeader
        title={titleFor(mode)}
        description={subtitleFor(mode)}
        actions={<Button label="Export CSV" variant="secondary" onClick={() => downloadCsv(`${mode}.csv`, rowsFor(data))} />}
      >
        <InsightsToolbar reporting={reporting} locations={common.locations} onChange={update} />
      </PageHeader>
      {mode === "menu-performance" ? <MenuPerformance {...common} /> : mode === "reports" ? <Reports data={data} reporting={reporting} /> : <Trends data={data} />}
    </DashboardPage>
  );
}

async function loadInsightsData(businessId: string, reporting: Pick<Reporting, "start" | "end" | "locationId" | "comparison">, mode: Mode, fullAnalytics: boolean) {
  const needsMenu = mode === "menu-performance";
  try {
    const [insightsResult, productsResult, categoriesResult, devicesResult, paymentsResult] = await Promise.allSettled([
      api.insights(businessId, reporting),
      needsMenu ? api.products(businessId) : Promise.resolve({ products: [] as Product[] }),
      needsMenu ? api.categories(businessId) : Promise.resolve({ categories: [] as Category[] }),
      fullAnalytics ? api.devices(businessId) : Promise.resolve({ devices: [] as DeviceRecord[] }),
      fullAnalytics ? api.payments(businessId) : Promise.resolve(null),
    ] as const);

    if (insightsResult.status === "rejected") {
      const fallback = await api.dashboard(businessId, reporting);
      return {
        errors: {},
        data: { stats: fallback, previous: null, orders: [], products: [], categories: [], devices: null, payments: null } satisfies Data,
      };
    }

    const payload = insightsResult.value as Record<string, unknown>;
    const stats = (payload.stats || {}) as DashboardStats;
    const previous = (payload.previous || null) as DashboardStats | null;
    const orders = (payload.recent_orders || []) as Order[];
    const errors: Record<string, string> = {};
    if (needsMenu && productsResult.status === "rejected") errors.products = "Menu items could not be loaded.";
    if (needsMenu && categoriesResult.status === "rejected") errors.categories = "Categories could not be loaded.";
    if (fullAnalytics && paymentsResult.status === "rejected") errors.payments = "Payment analytics could not be loaded.";

    return {
      errors,
      data: {
        stats,
        previous,
        orders,
        products: productsResult.status === "fulfilled" ? productsResult.value.products : [],
        categories: categoriesResult.status === "fulfilled" ? categoriesResult.value.categories : [],
        devices: devicesResult.status === "fulfilled" ? devicesResult.value.devices : null,
        payments: paymentsResult.status === "fulfilled" ? paymentsResult.value : null,
      } satisfies Data,
    };
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error("Couldn't load Insights.");
  }
}

function SalesOrders({ data, locations, reporting, onChange, errors, retry }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const completed = completedCount(data);
  const stats = data.stats;
  const rows = data.orders.filter((order) => !status || order.status === status).slice(0, 8);

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Sales & Orders"
        description="Track completed sales, orders and customer activity."
        actions={<><Button label="Export" variant="secondary" onClick={() => downloadCsv("sales-orders.csv", rowsFor(data))} /><Button label="Full analytics" variant="primary" href="/dashboard/insights/analytics?full=1" /></>}
      >
        <InsightsToolbar reporting={reporting} locations={locations} onChange={onChange} />
      </PageHeader>
      {completed === 0 ? <NoSalesYet data={data} onChange={onChange} /> : (
        <>
          <MetricGrid>
            <Metric label="Net sales" value={formatCurrency(stats.period_net_sales ?? stats.net_sales_today)} hint={periodLabel(reporting)} />
            <Metric label="Completed orders" value={completed} />
            <Metric label="Average order value" value={formatCurrency(stats.period_average_order_value ?? stats.average_order_value)} />
          </MetricGrid>
          <Grid columns={{ minWidth: 300, repeat: "fit" }} gap={4}>
            {measureOptions.map((option) => (
              <Panel key={option.value} title={option.label} description={measureDescriptions[option.value]}>
                <LineChart series={dailySeries(stats, option.value, data.previous)} ariaLabel={`${option.label} by day`} format={measureFormat(option.value)} height={220} />
              </Panel>
            ))}
          </Grid>
          <Grid columns={{ minWidth: 320, repeat: "fit" }} gap={4}>
            <Panel title="Period summary">
              <SummaryRows rows={[
                ["Gross sales", formatCurrency(stats.period_gross_sales ?? stats.gross_sales_today)],
                ["Discounts", formatCurrency(stats.period_discounts ?? stats.discounts_today)],
                ["Refunds", formatCurrency(stats.period_refunds ?? stats.refunds_today)],
                ["Net sales", formatCurrency(stats.period_net_sales ?? stats.net_sales_today)],
              ]} />
            </Panel>
            <Panel title="Key insight">
              {stats.top_selling_item
                ? <Text type="body">{stats.top_selling_item.name} leads sales: {stats.top_selling_item.quantity} units sold in this period.</Text>
                : <Text type="body" color="secondary">Item-level sales were not returned for this period.</Text>}
            </Panel>
          </Grid>
          <Panel title="Recent orders" description="Latest orders in the selected period.">
            {errors.orders ? <InlineError message={errors.orders} retry={retry} /> : rows.length ? (
              <Table
                idKey="id"
                data={rows as Array<Order & Record<string, unknown>>}
                columns={[
                  { key: "order", header: "Order", renderCell: (order: Order) => (order.order_number ? `#${order.order_number}` : order.public_token || "Pending") },
                  { key: "time", header: "Time", renderCell: (order: Order) => formatDateTime(order.placed_at) },
                  { key: "type", header: "Type", renderCell: (order: Order) => readable(order.order_type) },
                  { key: "location", header: "Location", renderCell: (order: Order) => locations.find((item) => item.id === order.location_id)?.name || "All locations" },
                  { key: "total", header: "Total", align: "end", renderCell: (order: Order) => formatCurrency(order.total_amount) },
                  { key: "status", header: "Status", renderCell: (order: Order) => <Button label={`Show ${formatOrderStatus(order.status)} orders`} variant="ghost" size="sm" onClick={() => setStatus(order.status)}>{formatOrderStatus(order.status)}</Button> },
                ]}
              />
            ) : <EmptyBlock title="No orders in this period" description="Try another period or clear the location filter." />}
            {status && <Button label="Clear status filter" variant="ghost" size="sm" onClick={() => setStatus(null)} />}
          </Panel>
        </>
      )}
    </>
  );
}

function NoSalesYet({ data, onChange }: { data: Data; onChange: (next: Partial<Reporting>) => void }) {
  return (
    <>
      <MetricGrid>
        <Metric label="Net sales" value={formatCurrency(0)} hint="No completed sales in this period" />
        <Metric label="Completed orders" value={0} hint="No completed orders in this period" />
        <Metric label="Average order value" value="—" hint="Available after a completed order" />
      </MetricGrid>
      <Grid columns={{ minWidth: 320, repeat: "fit" }} gap={4}>
        <Panel title="Revenue & order activity">
          <EmptyBlock title="No sales yet" description="Sales and order activity will appear after your first completed order." action={<Button label="View last 30 days" variant="secondary" onClick={() => onChange({ preset: "30d", ...rangeFor("30d") })} />} />
        </Panel>
        <Panel title="Last active period">
          <SummaryRows rows={[
            ["Net sales", formatCurrency(data.previous?.period_net_sales ?? data.previous?.net_sales_today)],
            ["Completed orders", data.previous?.completed_orders ?? data.previous?.orders_past_7_days ?? "—"],
            ["Average order value", formatCurrency(data.previous?.period_average_order_value ?? data.previous?.average_order_value)],
          ]} />
          <Button label="View order history" variant="ghost" href="/dashboard/operations/order-history" />
        </Panel>
      </Grid>
    </>
  );
}

function FullAnalytics({ data, locations, reporting, onChange, errors, retry }: Props) {
  const [section, setSection] = useState<"overview" | "revenue" | "orders" | "channels" | "payments" | "locations" | "peak">("overview");
  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Full analytics"
        description="Investigate performance signals across the selected scope."
        actions={<Button label="Back to Sales & Orders" variant="ghost" href="/dashboard/insights/sales-reports" />}
      >
        <InsightsToolbar reporting={reporting} locations={locations} onChange={onChange} />
      </PageHeader>
      <TabList value={section} onChange={(value) => setSection(value as typeof section)} size="sm" layout="hug">
        <Tab value="overview" label="Overview" />
        <Tab value="revenue" label="Revenue" />
        <Tab value="orders" label="Orders" />
        <Tab value="channels" label="Channels" />
        <Tab value="payments" label="Payments" />
        <Tab value="locations" label="Locations & devices" />
        <Tab value="peak" label="Peak times" />
      </TabList>
      {section === "overview" && <Overview data={data} setSection={(next) => setSection(next as typeof section)} />}
      {section === "revenue" && <Revenue data={data} />}
      {section === "orders" && <AnalyticsOrders data={data} locations={locations} errors={errors} retry={retry} />}
      {section === "channels" && <Channels data={data} />}
      {section === "payments" && <Payments data={data} errors={errors} retry={retry} />}
      {section === "locations" && <Locations data={data} locations={locations} devices={data.devices} />}
      {section === "peak" && <Peak data={data} />}
    </>
  );
}

function Overview({ data, setSection }: { data: Data; setSection: (section: string) => void }) {
  const [measure, setMeasure] = useState<Measure>("sales");
  const stats = data.stats;
  const gross = stats.period_gross_sales ?? stats.gross_sales_today;
  const refunds = stats.period_refunds ?? stats.refunds_today;
  return (
    <VStack gap={4}>
      <MetricGrid>
        <Metric label="Net sales" value={formatCurrency(stats.period_net_sales ?? stats.net_sales_today)} />
        <Metric label="Orders" value={completedCount(data)} />
        <Metric label="Average order value" value={formatCurrency(stats.period_average_order_value ?? stats.average_order_value)} />
        <Metric label="Refund rate" value={`${gross ? (refunds / gross * 100).toFixed(1) : "0.0"}%`} />
      </MetricGrid>
      <Panel title="Business performance" actions={<MeasureSwitch value={measure} onChange={setMeasure} />}>
        <LineChart series={dailySeries(stats, measure, data.previous)} ariaLabel={`${measure} performance`} format={measureFormat(measure)} />
      </Panel>
      <Grid columns={{ minWidth: 300, repeat: "fit" }} gap={4}>
        <Panel title="Channel mix">
          <SummaryRows rows={Object.entries(stats.order_type_summary || {}).map(([key, value]) => [readable(key), value])} />
        </Panel>
        <Panel title="Payment mix">
          <SummaryRows rows={Object.entries(stats.payment_method_summary || {}).map(([key, value]) => [formatPaymentStatus(key), value])} />
        </Panel>
        <Panel title="Busiest period">
          <SummaryRows rows={[["Period", busiest(data)], ["Orders", completedCount(data)]]} />
          <Button label="View peak times" variant="ghost" onClick={() => setSection("peak")} />
        </Panel>
      </Grid>
    </VStack>
  );
}

function Revenue({ data }: { data: Data }) {
  const s = data.stats;
  return (
    <VStack gap={4}>
      <MetricGrid>
        <Metric label="Gross sales" value={formatCurrency(s.period_gross_sales ?? s.gross_sales_today)} />
        <Metric label="Discounts" value={formatCurrency(s.period_discounts ?? s.discounts_today)} />
        <Metric label="Refunds" value={formatCurrency(s.period_refunds ?? s.refunds_today)} />
        <Metric label="Net sales" value={formatCurrency(s.period_net_sales ?? s.net_sales_today)} />
      </MetricGrid>
      <Panel title="Revenue trend">
        <LineChart series={dailySeries(s, "sales", data.previous)} ariaLabel="Revenue trend" format={measureFormat("sales")} />
      </Panel>
      <Panel title="Revenue by period">
        <Table
          idKey="date"
          data={s.weekly_revenue as Array<(typeof s.weekly_revenue)[number] & Record<string, unknown>>}
          columns={[
            { key: "period", header: "Period", renderCell: (row: { date: string }) => row.date },
            { key: "gross", header: "Revenue", align: "end", renderCell: (row: { revenue: number }) => formatCurrency(row.revenue) },
          ]}
        />
      </Panel>
    </VStack>
  );
}

function AnalyticsOrders({ data, locations, errors, retry }: { data: Data; locations: LocationOption[]; errors: Record<string, string>; retry: () => void }) {
  const rows = data.orders.slice(0, 20);
  return (
    <VStack gap={4}>
      <MetricGrid>
        <Metric label="Completed" value={completedCount(data)} />
        <Metric label="Cancelled" value={data.orders.filter((order) => order.status === "cancelled").length} />
        <Metric label="Average order value" value={formatCurrency(data.stats.period_average_order_value ?? data.stats.average_order_value)} />
      </MetricGrid>
      <Panel title="Order volume">
        <DailyBars values={sortedPoints(data.stats.weekly_revenue, (point) => point.orders)} ariaLabel="Order volume" format={measureFormat("orders")} />
      </Panel>
      <Panel title="Order analytics">
        {errors.orders ? <InlineError message={errors.orders} retry={retry} /> : (
          <Table
            idKey="id"
            data={rows as Array<Order & Record<string, unknown>>}
            columns={[
              { key: "order", header: "Order", renderCell: (order: Order) => order.order_number || order.public_token || "Pending" },
              { key: "date", header: "Date", renderCell: (order: Order) => formatDateTime(order.placed_at) },
              { key: "location", header: "Location", renderCell: (order: Order) => locations.find((item) => item.id === order.location_id)?.name || "All locations" },
              { key: "type", header: "Type", renderCell: (order: Order) => readable(order.order_type) },
              { key: "total", header: "Total", align: "end", renderCell: (order: Order) => formatCurrency(order.total_amount) },
              { key: "status", header: "Status", renderCell: (order: Order) => <StatusBadge tone={pill(order.status)}>{formatOrderStatus(order.status)}</StatusBadge> },
            ]}
          />
        )}
      </Panel>
    </VStack>
  );
}

function Channels({ data }: { data: Data }) {
  const rows = Object.entries(data.stats.order_type_summary || {}).map(([channel, orders]) => ({ id: channel, channel: readable(channel), orders }));
  return (
    <Panel title="Channel performance">
      {rows.length ? (
        <Table
          idKey="id"
          data={rows as Array<(typeof rows)[number] & Record<string, unknown>>}
          columns={[
            { key: "channel", header: "Channel", renderCell: (row: { channel: string }) => row.channel },
            { key: "orders", header: "Orders", align: "end", renderCell: (row: { orders: number }) => String(row.orders) },
          ]}
        />
      ) : <EmptyBlock title="No channel data for this period" />}
    </Panel>
  );
}

function Payments({ data, errors, retry }: { data: Data; errors: Record<string, string>; retry: () => void }) {
  if (errors.payments) return <InlineError message={errors.payments} retry={retry} />;
  if (!data.payments) return <NoticeBanner tone="info" title="Payment analytics unavailable" description="The current endpoint did not return payment analytics." />;
  return (
    <VStack gap={4}>
      <MetricGrid>
        <Metric label="Payment volume" value={formatCurrency(data.payments.summary.total_collected)} />
        <Metric label="Paid orders" value={data.payments.summary.paid_count} />
        <Metric label="Failed orders" value={data.payments.summary.failed_count} />
      </MetricGrid>
      <Panel title="Payment records">
        <Table
          idKey="id"
          data={data.payments.payments.slice(0, 50) as Array<(typeof data.payments.payments)[number] & Record<string, unknown>>}
          columns={[
            { key: "provider", header: "Provider", renderCell: (row: { provider?: string | null }) => row.provider || "Not returned" },
            { key: "method", header: "Method", renderCell: (row: { payment_method?: string | null }) => row.payment_method || "Not returned" },
            { key: "amount", header: "Amount", align: "end", renderCell: (row: { amount: number }) => formatCurrency(row.amount) },
            { key: "status", header: "Status", renderCell: (row: { status: string }) => <StatusBadge tone={pill(row.status)}>{formatPaymentStatus(row.status)}</StatusBadge> },
          ]}
        />
      </Panel>
    </VStack>
  );
}

function Locations({ data, locations, devices }: { data: Data; locations: LocationOption[]; devices: DeviceRecord[] | null }) {
  const rows = locations.map((location) => {
    const orders = data.orders.filter((order) => order.location_id === location.id && isCompleted(order));
    return { id: location.id, location: location.name, orders: orders.length, sales: orders.reduce((sum, order) => sum + order.total_amount, 0) };
  }).filter((row) => row.orders);
  return (
    <VStack gap={4}>
      <Panel title="Location performance">
        {rows.length ? (
          <Table
            idKey="id"
            data={rows as Array<(typeof rows)[number] & Record<string, unknown>>}
            columns={[
              { key: "location", header: "Location", renderCell: (row: { location: string }) => row.location },
              { key: "sales", header: "Sales", align: "end", renderCell: (row: { sales: number }) => formatCurrency(row.sales) },
              { key: "orders", header: "Orders", align: "end", renderCell: (row: { orders: number }) => String(row.orders) },
              { key: "aov", header: "Average order", align: "end", renderCell: (row: { sales: number; orders: number }) => formatCurrency(row.orders ? row.sales / row.orders : 0) },
            ]}
          />
        ) : <EmptyBlock title="No location performance for this period" />}
      </Panel>
      <Panel title="Device performance">
        {devices?.length ? (
          <Table
            idKey="id"
            data={devices as Array<DeviceRecord & Record<string, unknown>>}
            columns={[
              { key: "device", header: "Device", renderCell: (row: DeviceRecord) => row.name || row.device_id },
              { key: "type", header: "Type", renderCell: (row: DeviceRecord) => row.device_type },
              { key: "status", header: "Status", renderCell: (row: DeviceRecord) => row.status },
            ]}
          />
        ) : <NoticeBanner tone="info" title="Device performance is not returned by the current analytics endpoint." />}
      </Panel>
    </VStack>
  );
}

function Peak({ data }: { data: Data }) {
  const hours = data.orders.filter(isCompleted).reduce((map, order) => {
    const hour = new Date(order.placed_at).getHours();
    map.set(hour, (map.get(hour) || 0) + 1);
    return map;
  }, new Map<number, number>());
  if (!hours.size) return <NoticeBanner tone="info" title="Not enough order history for peak-time analysis" />;
  const rows = Array.from(hours, ([hour, orders]) => ({ id: String(hour), hour: `${hour}:00`, orders }));
  return (
    <Panel title="Peak ordering times">
      <Table
        idKey="id"
        data={rows as Array<(typeof rows)[number] & Record<string, unknown>>}
        columns={[
          { key: "hour", header: "Hour", renderCell: (row: { hour: string }) => row.hour },
          { key: "orders", header: "Orders", align: "end", renderCell: (row: { orders: number }) => String(row.orders) },
        ]}
      />
    </Panel>
  );
}

function MenuPerformance({ data, errors, retry }: Props) {
  const [view, setView] = useState<"best" | "attention" | "all">("best");
  const [selected, setSelected] = useState<Product | null>(null);
  const sales = new Map(data.stats.top_selling_items.map((item) => [item.name, item]));
  const rows = data.products.map((product) => ({
    ...product,
    sold: sales.get(product.name)?.quantity || 0,
    sales: sales.get(product.name)?.revenue || 0,
    reason: !product.is_available ? "Unavailable" : !sales.has(product.name) ? "No completed sales" : "",
  })).filter((row) => view === "attention" ? Boolean(row.reason) : row.sold > 0 || view === "all").sort((a, b) => b.sales - a.sales);
  const total = rows.reduce((sum, row) => sum + row.sales, 0);
  const items = rows.reduce((sum, row) => sum + row.sold, 0);
  const categoryParts = shareParts(data.categories.map((category) => ({ id: category.id, label: formatCategoryName(category.name), value: rows.filter((row) => row.category_id === category.id).reduce((sum, row) => sum + row.sales, 0) })));

  return (
    <VStack gap={4}>
      <MetricGrid>
        <Metric label="Items sold" value={items} />
        <Metric label="Menu sales" value={formatCurrency(total)} />
        <Metric label="Average item value" value={formatCurrency(items ? total / items : 0)} />
      </MetricGrid>
      <SegmentedControl label="Menu performance view" value={view} onChange={(value) => setView(value as typeof view)}>
        <SegmentedControlItem value="best" label="Best sellers" />
        <SegmentedControlItem value="attention" label="Needs attention" />
        <SegmentedControlItem value="all" label="All items" />
      </SegmentedControl>
      <Grid columns={{ minWidth: 320, repeat: "fit" }} gap={4}>
        <Panel title="Top sellers by sales" description="Ranked by sales in the selected period.">
          <RankedBars ariaLabel="Top sellers by sales" rows={rows.filter((row) => row.sales > 0).map((row) => ({ id: row.id, label: row.name, value: row.sales, detail: `${row.sold} sold` }))} format={formatCurrency} />
        </Panel>
        <Panel title="Sales by category" description="Share of menu sales. Smaller categories are grouped into Other.">
          <SegmentedShare ariaLabel="Sales by category" parts={categoryParts} format={formatCurrency} />
        </Panel>
      </Grid>
      <Panel title="Item performance">
        {errors.products ? <InlineError message={errors.products} retry={retry} /> : rows.length ? (
          <Table
            idKey="id"
            data={rows as Array<(typeof rows)[number] & Record<string, unknown>>}
            columns={[
              { key: "item", header: "Item", renderCell: (row: Product & { reason: string }) => <Button label={`Open ${row.name} details`} variant="ghost" size="sm" onClick={() => setSelected(row)}>{row.name}</Button> },
              { key: "sold", header: "Sold", align: "end", renderCell: (row: { sold: number }) => String(row.sold) },
              { key: "sales", header: "Sales", align: "end", renderCell: (row: { sales: number }) => formatCurrency(row.sales) },
              { key: "status", header: "Status", renderCell: (row: { reason: string }) => row.reason ? <StatusBadge tone="warning">{row.reason}</StatusBadge> : <StatusBadge tone="success">Healthy</StatusBadge> },
            ]}
          />
        ) : <EmptyBlock title={view === "attention" ? "No items need attention" : "No completed item sales"} />}
      </Panel>
      <Panel title="Category performance">
        {errors.categories ? <InlineError message={errors.categories} retry={retry} /> : (
          <Table
            data={data.categories.map((category) => ({ category: formatCategoryName(category.name), items: data.products.filter((product) => product.category_id === category.id).length })) as Array<{ category: string; items: number } & Record<string, unknown>>}
            idKey="category"
            columns={[
              { key: "category", header: "Category", renderCell: (row: { category: string }) => row.category },
              { key: "items", header: "Items", align: "end", renderCell: (row: { items: number }) => String(row.items) },
            ]}
          />
        )}
      </Panel>
      {selected && (
        <DetailDrawer title={selected.name} isOpen onClose={() => setSelected(null)} footer={<Button label="Close" variant="secondary" onClick={() => setSelected(null)} />}>
          <DetailRow label="Price">{formatCurrency(selected.price)}</DetailRow>
          <DetailRow label="Availability">{selected.is_available ? "Available" : "Unavailable"}</DetailRow>
          <DetailRow label="Items sold">{sales.get(selected.name)?.quantity || 0}</DetailRow>
        </DetailDrawer>
      )}
    </VStack>
  );
}

function Trends({ data }: { data: Data }) {
  return (
    <VStack gap={4}>
      <Grid columns={{ minWidth: 300, repeat: "fit" }} gap={4}>
        {(["sales", "orders", "aov"] as Measure[]).map((measure) => (
          <Panel key={measure} title={measureNames[measure]} description={measure === "sales" ? "Revenue per day" : measure === "orders" ? "Orders per day" : "Average value of each day's orders"}>
            <LineChart series={dailySeries(data.stats, measure, data.previous)} ariaLabel={`${measureNames[measure]} trend`} format={measureFormat(measure)} width={340} height={200} />
          </Panel>
        ))}
      </Grid>
      <Grid columns={{ minWidth: 300, repeat: "fit" }} gap={4}>
        <Panel title="Peak ordering times">
          <SummaryRows rows={[["Completed orders", completedCount(data)], ["Busiest period", busiest(data)]]} />
        </Panel>
        <Panel title="Order type trend">
          <SummaryRows rows={Object.entries(data.stats.order_type_summary || {}).map(([key, value]) => [readable(key), value])} />
        </Panel>
        <Panel title="Completion time trend">
          <NoticeBanner tone="info" title="Completion trend unavailable" description="Prep and completion timestamps were not returned." />
        </Panel>
        <Panel title="Top item">
          <SummaryRows rows={data.stats.top_selling_item ? [["Top item", data.stats.top_selling_item.name]] : []} />
        </Panel>
      </Grid>
    </VStack>
  );
}

const reportTemplates = ["Sales Report", "Orders Report", "Payment Report", "Menu Performance", "Tax Summary", "Location Summary"];

function Reports({ data, reporting }: { data: Data; reporting: Reporting }) {
  const [tab, setTab] = useState<"library" | "saved" | "exports">("library");
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  return (
    <VStack gap={4}>
      <TabList value={tab} onChange={(value) => setTab(value as typeof tab)} size="sm" layout="hug">
        <Tab value="library" label="Report library" />
        <Tab value="saved" label="Saved reports" />
        <Tab value="exports" label="Exports" />
      </TabList>
      {tab === "library" && (
        <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4}>
          {reportTemplates.map((title) => (
            <Panel key={title} title={title} description="Structured records for the current reporting scope." actions={<Button label={`Run ${title}`} variant="secondary" onClick={() => setSelected(title)} />} />
          ))}
        </Grid>
      )}
      {tab === "saved" && (saved.length ? (
        <Panel title="Saved reports"><SummaryRows rows={saved.map((name) => [name, periodLabel(reporting)])} /></Panel>
      ) : <EmptyBlock title="No saved reports yet" description="Save a report configuration to run it again quickly." />)}
      {tab === "exports" && <EmptyBlock title="No exports yet" description="Generated files will appear after a real export." />}
      {selected && (
        <DetailDrawer title={`Create ${selected}`} isOpen onClose={() => setSelected(null)} footer={<><Button label="Cancel" variant="secondary" onClick={() => setSelected(null)} /><Button label="Generate CSV" variant="primary" onClick={() => { downloadCsv(`${selected.toLowerCase().replaceAll(" ", "-")}.csv`, rowsFor(data)); setSaved((items) => items.includes(selected) ? items : [...items, selected]); setSelected(null); }} /></>}>
          <DetailRow label="Current period">{periodLabel(reporting)}</DetailRow>
        </DetailDrawer>
      )}
    </VStack>
  );
}

function InsightsToolbar({ reporting, locations, onChange }: { reporting: Reporting; locations: LocationOption[]; onChange: (next: Partial<Reporting>) => void }) {
  return (
    <Toolbar>
      <Selector label="Date range" value={reporting.preset} onChange={(value) => { const preset = value as Reporting["preset"]; onChange({ preset, ...rangeFor(preset) }); }} options={[{ value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }]} />
      <Selector label="Location" value={reporting.locationId || "all"} onChange={(value) => onChange({ locationId: value === "all" ? null : value })} options={[{ value: "all", label: "All locations" }, ...locations.map((item) => ({ value: item.id, label: item.name }))]} />
      <Selector label="Compare" value={reporting.comparison} onChange={(value) => onChange({ comparison: value as Reporting["comparison"] })} options={[{ value: "previous", label: "Previous period" }, { value: "none", label: "No comparison" }]} />
    </Toolbar>
  );
}

function MeasureSwitch({ value, onChange }: { value: Measure; onChange: (value: Measure) => void }) {
  return (
    <SegmentedControl label="Chart measure" value={value} onChange={(next) => onChange(next as Measure)}>
      {measureOptions.map((option) => <SegmentedControlItem key={option.value} value={option.value} label={option.label} />)}
    </SegmentedControl>
  );
}

function SummaryRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return rows.length ? <VStack gap={3}>{rows.map(([label, value]) => <DetailRow key={label} label={label}>{value}</DetailRow>)}</VStack> : <EmptyBlock title="No data for this period" />;
}

function InlineError({ message, retry }: { message: string; retry: () => void }) {
  return <NoticeBanner tone="danger" title={message} action={<Button label="Retry" variant="secondary" onClick={retry} />} />;
}

const measureNames: Record<Measure, string> = { sales: "Revenue", orders: "Orders", aov: "Average order value" };

function measureFormat(measure: Measure) {
  return measure === "orders" ? (value: number) => String(Math.round(value)) : (value: number) => formatCurrency(value);
}

function measureValue(point: { orders: number; revenue: number }, measure: Measure) {
  return measure === "orders" ? point.orders : measure === "aov" ? (point.orders ? point.revenue / point.orders : 0) : point.revenue;
}

// Days are sorted oldest first so the time axis always runs forward.
function sortedPoints<T extends { date: string }>(points: T[], pick: (point: T) => number) {
  return [...points].sort((a, b) => a.date.localeCompare(b.date)).map((point) => ({ label: point.date.slice(5), value: pick(point) }));
}

// The selected period's days when the API returns them, otherwise the last seven days.
function periodDays(source: DashboardStats) {
  return source.daily_revenue?.length ? source.daily_revenue : source.weekly_revenue;
}

// The subject series is the chosen measure; the previous period, when returned, is a quiet comparison line aligned by day.
function dailySeries(stats: DashboardStats, measure: Measure, previous?: DashboardStats | null): Series[] {
  const subject: Series = { id: "current", name: measureNames[measure], tone: "primary", values: sortedPoints(periodDays(stats), (point) => measureValue(point, measure)) };
  const prior = previous ? periodDays(previous) : [];
  if (!prior.length) return [subject];
  const comparison = sortedPoints(prior, (point) => measureValue(point, measure)).map((point, index) => ({ label: `Day ${index + 1}`, value: point.value }));
  return [subject, { id: "previous", name: "Previous period", tone: "comparison", values: comparison }];
}

// Up to five named parts, largest first; the rest fold into one "Other" so a split never exceeds six blocks.
function shareParts(parts: Array<{ id: string; label: string; value: number }>) {
  const ranked = parts.filter((part) => part.value > 0).sort((a, b) => b.value - a.value);
  if (ranked.length <= 6) return ranked;
  const head = ranked.slice(0, 5);
  const rest = ranked.slice(5).reduce((sum, part) => sum + part.value, 0);
  return [...head, { id: "other", label: "Other", value: rest }];
}
function completedCount(data: Data) {
  return data.stats.completed_orders ?? data.orders.filter(isCompleted).length;
}
function isCompleted(order: Order) {
  return order.status === "completed" && !["failed", "cancelled", "expired", "unpaid", "pending", "pay_at_counter_pending"].includes(order.payment_status);
}
function pill(status: string): Tone {
  return status === "completed" ? "success" : status === "cancelled" ? "danger" : status === "pending" ? "warning" : "info";
}
function readable(value?: string | null) {
  return String(value || "Unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function busiest(data: Data) {
  const counts = new Map<number, number>();
  data.orders.filter(isCompleted).forEach((order) => {
    const hour = new Date(order.placed_at).getHours();
    counts.set(hour, (counts.get(hour) || 0) + 1);
  });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]}:00` : "Not enough data";
}
function rowsFor(data: Data) {
  return [["Net Sales", data.stats.period_net_sales ?? data.stats.net_sales_today], ["Completed Orders", completedCount(data)], ...data.orders.slice(0, 100).map((order) => [order.order_number || order.public_token || "Pending", order.placed_at, readable(order.order_type), formatOrderStatus(order.status), order.total_amount] as Array<string | number>)];
}
function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  if (typeof window === "undefined") return;
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
function titleFor(mode: Mode) {
  return mode === "sales-reports" ? "Sales & Orders" : mode === "menu-performance" ? "Menu Performance" : mode === "reports" ? "Reports" : "Trends";
}
function subtitleFor(mode: Mode) {
  return mode === "sales-reports" ? "Understand sales and order activity for your business." : mode === "menu-performance" ? "Understand what's driving menu sales and where attention is needed." : mode === "reports" ? "Create, save and export structured business reports." : "Understand how demand and business patterns change over time.";
}
function useReporting(params: ReturnType<typeof useSearchParams>): Reporting {
  const preset = params.get("preset") === "today" || params.get("preset") === "30d" ? params.get("preset") as Reporting["preset"] : "7d";
  const range = rangeFor(preset);
  return { preset, start: params.get("start") || range.start, end: params.get("end") || range.end, comparison: params.get("comparison") === "none" ? "none" : "previous", locationId: params.get("location_id") };
}
function rangeFor(preset: Reporting["preset"]) {
  const end = isoDate(0);
  return preset === "today" ? { start: end, end } : preset === "30d" ? { start: isoDate(-29), end } : { start: isoDate(-6), end };
}
function isoDate(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}
function periodLabel(reporting: Reporting) {
  return reporting.preset === "today" ? "Today" : reporting.preset === "30d" ? "Last 30 days" : "Last 7 days";
}
