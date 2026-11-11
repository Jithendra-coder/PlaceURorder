"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { AlertTriangle, Eye, MoreHorizontal, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { DateTimeInput } from "@astryxdesign/core/DateTimeInput";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Selector } from "@astryxdesign/core/Selector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { TimeInput } from "@astryxdesign/core/TimeInput";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ConfirmDialog, DashboardPageWithPanel, DetailDrawer, EmptyBlock, LoadingBlock, NoticeBanner, PageHeader, Panel, StatusBadge, Toolbar, type Tone } from "@/components/dashboard/kit";
import { RealKioskFrame } from "@/app/admin/_components/real-kiosk-frame";
import { api, assetUrl } from "@/lib/api";
import type { AvailabilityRule, BusinessLocation, Category, Combo, KioskSetupOverview, Product, ResolvedAvailability } from "@/lib/types";
import type { Business } from "@/services/api";

type Mode = "live" | "schedules" | "exceptions";
type LiveView = "items" | "categories";
type StatusFilter = "all" | "available" | "unavailable" | "changing" | "attention";
type ToastState = {
  text: string;
  status?: "success" | "danger" | "info";
  action?: { label: string; run: () => Promise<void> };
};
type RuleDraft = {
  id?: string;
  ruleType: "schedule" | "exception";
  targetType: "item" | "category" | "combo" | "location" | "menu";
  targetIds: string[];
  name: string;
  available: boolean;
  days: string[];
  windows: Array<{ start: string; end: string }>;
  startsAt: string;
  endsAt: string;
  locations: string[];
  reason: string;
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const emptyRule = (ruleType: RuleDraft["ruleType"], locationId = ""): RuleDraft => ({
  ruleType,
  targetType: "item",
  targetIds: [],
  name: "",
  available: ruleType === "schedule",
  days: [...DAYS],
  windows: [{ start: "09:00", end: "22:00" }],
  startsAt: ruleType === "exception" ? localDateTime(new Date()) : "",
  endsAt: "",
  locations: locationId ? [locationId] : [],
  reason: "",
});
const readable = (value?: string | null) => (value || "Default").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const localDateTime = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const formatMoment = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "No upcoming change";
const activeException = (rule: AvailabilityRule, now = Date.now()) => rule.rule_type === "exception" && rule.status === "active" && (!rule.starts_at || new Date(rule.starts_at).getTime() <= now) && (!rule.ends_at || new Date(rule.ends_at).getTime() > now);
const upcomingException = (rule: AvailabilityRule, now = Date.now()) => rule.rule_type === "exception" && rule.status === "active" && Boolean(rule.starts_at) && new Date(rule.starts_at!).getTime() > now;
const sourceTone = (source?: string | null): Tone => source === "exception" ? "warning" : source === "schedule" ? "info" : "neutral";
const statusTone = (status: string): Tone => status === "active" ? "success" : "neutral";

export function comboAvailability(combo: Combo, states: Map<string, boolean>) {
  const blocked = (combo.sections || []).filter((section) => section.required && !section.options.some((option) => option.visible && (!option.existing_item_id || states.get(option.existing_item_id))));
  return {
    available: combo.status === "shown" && blocked.length === 0,
    reason: blocked.length ? `No available ${blocked[0].title.toLowerCase()} selection` : "All required groups have an available choice",
  };
}

export function AvailabilityPage({ business, products, categories, combos, setup }: { business: Business; products: Product[]; categories: Category[]; combos: Combo[]; setup: KioskSetupOverview | null }) {
  const [mode, setMode] = useState<Mode>("live");
  const [rows, setRows] = useState(products);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [locations, setLocations] = useState<BusinessLocation[]>([]);
  const [resolved, setResolved] = useState<ResolvedAvailability[]>([]);
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [changesOpen, setChangesOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [draftChanges, setDraftChanges] = useState(setup?.unpublishedChanges || 0);

  const load = useCallback(async (scope = "", preserve = true) => {
    if (!preserve) setLoading(true);
    setError("");
    try {
      const result = await api.availability(business.id, scope || null);
      setRules(result.rules);
      setLocations(result.locations);
      setResolved(result.resolved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t load current availability.");
    } finally {
      setLoading(false);
    }
  }, [business.id]);
  useEffect(() => {
    const task = window.setTimeout(() => void load("", false), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const states = useMemo(() => new Map(resolved.map((entry) => [entry.product_id, entry])), [resolved]);
  const visibleRows = rows.filter((item) => item.menu_status !== "hidden");
  const counts = visibleRows.reduce((total, item) => {
    const state = states.get(item.id);
    if (state?.available ?? item.is_available) total.available += 1;
    else total.unavailable += 1;
    if (state?.next_change_at) total.changing += 1;
    return total;
  }, { available: 0, unavailable: 0, changing: 0 });
  const comboStates = useMemo(() => new Map(visibleRows.map((item) => [item.id, states.get(item.id)?.available ?? item.is_available])), [states, visibleRows]);
  const attention = combos.filter((combo) => !comboAvailability(combo, comboStates).available && combo.status === "shown");
  const changed = () => {
    setDraftChanges((value) => value + 1);
    setPreviewKey((value) => value + 1);
  };
  const refresh = async () => {
    await load(locationId);
    setPreviewKey((value) => value + 1);
  };
  const previewPanel = (
    <VStack gap={3}>
      <Text type="label">Portrait preview</Text>
      <RealKioskFrame slug={business.slug} businessId={business.id} locationId={locationId || null} orientation="portrait" compact sessionKey={`availability-${previewKey}`} />
    </VStack>
  );

  return (
    <DashboardPageWithPanel panel={previewPanel}>
      <PageHeader
        eyebrow="Kiosk & Menu"
        title="Availability"
        description={loading ? "Loading availability…" : `${counts.available} available now · ${counts.unavailable} unavailable · ${counts.changing} changing soon`}
        actions={<>
          <Button label="Preview availability" variant="secondary" icon={<Eye size={16} aria-hidden="true" />} onClick={() => setPreviewOpen(true)} />
        </>}
      >
        <Toolbar>
          <Selector label="Location" value={locationId} onChange={(next) => { setLocationId(next); void load(next, false); }} options={[{ value: "", label: "All locations" }, ...locations.map((location) => ({ value: location.id, label: location.name }))]} />
        </Toolbar>
      </PageHeader>
      {draftChanges > 0 && <NoticeBanner tone="warning" title={`${draftChanges} unpublished availability ${draftChanges === 1 ? "change" : "changes"}`} action={<Button label="Review changes" variant="ghost" onClick={() => setChangesOpen(true)} />} />}
      <SegmentedControl value={mode} onChange={(value) => setMode(value as Mode)} label="Availability modes">
        {(["live", "schedules", "exceptions"] as Mode[]).map((value) => <SegmentedControlItem key={value} value={value} label={readable(value)} />)}
      </SegmentedControl>
      {toast && <NoticeBanner tone={toast.status === "danger" ? "danger" : "success"} title={toast.text} action={<HStack gap={2}>{toast.action && <Button label={toast.action.label} variant="ghost" onClick={() => void toast.action?.run()} />}<Button label="Dismiss" variant="ghost" onClick={() => setToast(null)} /></HStack>} />}
      {error && <NoticeBanner tone="danger" title="Couldn’t load current availability." description={error} action={<Button label="Retry" variant="secondary" onClick={() => void load(locationId, false)} />} />}
      {loading ? <AvailabilitySkeleton /> : mode === "live" ? (
        <LiveMode products={visibleRows} categories={categories} states={states} attention={attention} locationId={locationId} locations={locations} onChanged={changed} refresh={refresh} setRows={setRows} setToast={setToast} businessId={business.id} />
      ) : mode === "schedules" ? (
        <SchedulesMode businessId={business.id} rules={rules} products={visibleRows} categories={categories} combos={combos} locations={locations} locationId={locationId} refresh={refresh} changed={changed} setToast={setToast} />
      ) : (
        <ExceptionsMode businessId={business.id} rules={rules} products={visibleRows} categories={categories} combos={combos} locations={locations} locationId={locationId} refresh={refresh} changed={changed} setToast={setToast} />
      )}
      <DetailDrawer title="Portrait availability preview" isOpen={previewOpen} onClose={() => setPreviewOpen(false)} width={520} footer={<Button label="Close" variant="secondary" onClick={() => setPreviewOpen(false)} />}>
        <RealKioskFrame slug={business.slug} businessId={business.id} locationId={locationId || null} orientation="portrait" compact sessionKey={`availability-drawer-${previewKey}`} />
      </DetailDrawer>
      <DetailDrawer title="Availability changes" isOpen={changesOpen} onClose={() => setChangesOpen(false)} footer={<Button label="Close" variant="secondary" onClick={() => setChangesOpen(false)} />}>
        <VStack gap={3}>
          {setup?.changeSummary.map((entry) => (
            <HStack key={entry.key} gap={3} hAlign="between" vAlign="center">
              <VStack gap={0}>
                <Text type="body" weight="semibold">{entry.label}</Text>
                <Text type="supporting" color="secondary">{`${entry.count} draft ${entry.count === 1 ? "change" : "changes"}`}</Text>
              </VStack>
              {entry.key === "availability_rules" && <Button label="View" variant="ghost" onClick={() => { setMode(rules.some((rule) => rule.rule_type === "exception") ? "exceptions" : "schedules"); setChangesOpen(false); }} />}
            </HStack>
          ))}
          {!setup?.changeSummary.length && <NoticeBanner tone="info" title={`${draftChanges} availability ${draftChanges === 1 ? "change" : "changes"} saved`} description="The current kiosk draft has not been published." />}
        </VStack>
      </DetailDrawer>
    </DashboardPageWithPanel>
  );
}

type LiveProps = {
  businessId: string;
  products: Product[];
  categories: Category[];
  states: Map<string, ResolvedAvailability>;
  attention: Combo[];
  locationId: string;
  locations: BusinessLocation[];
  onChanged: () => void;
  refresh: () => Promise<void>;
  setRows: Dispatch<SetStateAction<Product[]>>;
  setToast: (toast: ToastState | null) => void;
};

function LiveMode({ businessId, products, categories, states, attention, locationId, locations, onChanged, refresh, setRows, setToast }: LiveProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [categoryId, setCategoryId] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [view, setView] = useState<LiveView>("items");
  const [selected, setSelected] = useState(new Set<string>());
  const [quickItem, setQuickItem] = useState<Product | null>(null);
  const [duration, setDuration] = useState("manual");
  const [customEnd, setCustomEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const isAvailable = (item: Product) => states.get(item.id)?.available ?? item.is_available;
  const matches = products.filter((item) => {
    const state = states.get(item.id);
    const available = isAvailable(item);
    return (!deferredSearch || `${item.name} ${item.sku || ""} ${categoriesById.get(item.category_id || "")?.name || ""}`.toLowerCase().includes(deferredSearch))
      && (categoryId === "all" || item.category_id === categoryId)
      && (status === "all" || (status === "available" && available) || (status === "unavailable" && !available) || (status === "changing" && Boolean(state?.next_change_at)));
  });
  const groups = categories.map((category) => ({ category, items: matches.filter((item) => item.category_id === category.id) })).filter((group) => group.items.length);
  const uncategorised = matches.filter((item) => !item.category_id || !categoriesById.has(item.category_id));
  if (uncategorised.length) groups.push({ category: { id: "uncategorised", business_id: "", name: "Uncategorised", is_active: true, sort_order: 999 }, items: uncategorised });

  const applyItem = async (item: Product, available: boolean, end?: string) => {
    const previous = isAvailable(item);
    setBusy(true);
    setRows((current) => current.map((row) => row.id === item.id ? { ...row, is_available: available } : row));
    try {
      let ruleId = "";
      if (end || locationId) {
        const rule = await api.createAvailabilityRule(item.business_id, {
          target_type: "item", target_id: item.id, rule_type: "exception", name: `${item.name} override`, is_available: available, status: "active", days: [], time_windows: [], starts_at: new Date().toISOString(), ends_at: end || null, location_ids: locationId ? [locationId] : [], reason: end ? "Temporary override" : "Location override",
        });
        ruleId = rule.id;
      } else await api.setAvailability(item.id, available);
      onChanged();
      await refresh();
      setQuickItem(null);
      setToast({
        text: `${item.name} is ${available ? "available" : end ? `unavailable until ${formatMoment(end)}` : "unavailable"}.`,
        action: { label: "Undo", run: async () => {
          if (ruleId) await api.deleteAvailabilityRule(item.business_id, ruleId);
          else await api.setAvailability(item.id, previous);
          await refresh();
          setToast(null);
        } },
      });
    } catch (cause) {
      setRows((current) => current.map((row) => row.id === item.id ? { ...row, is_available: previous } : row));
      setToast({ text: cause instanceof Error ? cause.message : "Availability wasn’t changed.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const requestChange = (task: () => Promise<void>) => {
    if (!locationId && locations.length > 1) setConfirmAction(() => task);
    else void task();
  };
  const endForDuration = () => {
    const now = new Date();
    if (duration === "30") now.setMinutes(now.getMinutes() + 30);
    else if (duration === "60") now.setHours(now.getHours() + 1);
    else if (duration === "day") now.setHours(23, 59, 59, 999);
    else if (duration === "custom") return customEnd ? new Date(customEnd).toISOString() : undefined;
    else return undefined;
    return now.toISOString();
  };
  const bulk = async (available: boolean) => {
    const chosen = products.filter((item) => selected.has(item.id));
    setBusy(true);
    try {
      await Promise.all(chosen.map((item) => locationId
        ? api.createAvailabilityRule(item.business_id, { target_type: "item", target_id: item.id, rule_type: "exception", name: `${item.name} location override`, is_available: available, status: "active", days: [], time_windows: [], starts_at: new Date().toISOString(), ends_at: null, location_ids: [locationId], reason: "Location override" })
        : api.setAvailability(item.id, available)));
      setSelected(new Set());
      onChanged();
      await refresh();
      setToast({ text: `${chosen.length} items updated.` });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Availability wasn’t changed.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const toggleSelected = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  });

  if (!products.length) return <EmptyBlock title="No menu items yet" description="Add items before managing availability." action={<Button label="Go to Manage Menu" variant="primary" href="/dashboard/kiosk-experience/menu" />} />;

  const filterCounts = [
    { id: "all" as const, label: "All", count: products.length },
    { id: "available" as const, label: "Available", count: products.filter((item) => isAvailable(item)).length },
    { id: "unavailable" as const, label: "Unavailable", count: products.filter((item) => !isAvailable(item)).length },
    { id: "changing" as const, label: "Changing soon", count: products.filter((item) => states.get(item.id)?.next_change_at).length },
    { id: "attention" as const, label: "Needs attention", count: attention.length },
  ];

  return (
    <VStack gap={4}>
      <SegmentedControl value={status} onChange={(value) => setStatus(value as StatusFilter)} label="Availability filters">
        {filterCounts.map((filter) => <SegmentedControlItem key={filter.id} value={filter.id} label={`${filter.label} ${filter.count}`} />)}
      </SegmentedControl>
      <Toolbar>
        <TextInput type="search" label="Search items or categories" placeholder="Search items or categories…" value={search} onChange={setSearch} />
        <Selector label="Category" value={categoryId} onChange={setCategoryId} options={[{ value: "all", label: "All categories" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} />
        <SegmentedControl value={view} onChange={(value) => setView(value as LiveView)} label="Live view">
          <SegmentedControlItem value="items" label="Items" />
          <SegmentedControlItem value="categories" label="Categories" />
        </SegmentedControl>
      </Toolbar>
      {status === "attention" ? (
        attention.length ? (
          <VStack gap={3}>
            {attention.map((combo) => {
              const reason = comboAvailability(combo, new Map(products.map((item) => [item.id, isAvailable(item)]))).reason;
              return (
                <Panel key={combo.id} padding={4}>
                  <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
                    <HStack gap={3} vAlign="center">
                      <AlertTriangle size={18} aria-hidden="true" />
                      <VStack gap={0}>
                        <Text type="body" weight="semibold">{combo.name}</Text>
                        <Text type="supporting" color="secondary">{reason}</Text>
                      </VStack>
                    </HStack>
                    <Button label={`Review ${combo.name}`} variant="ghost" href="/dashboard/kiosk-experience/menu?mode=combos" />
                  </HStack>
                </Panel>
              );
            })}
          </VStack>
        ) : <EmptyBlock title="No items need attention" description="Availability rules are consistent." />
      ) : view === "categories" ? (
        <CategoryRows groups={groups} states={states} businessId={businessId} locationId={locationId} requestChange={requestChange} refresh={refresh} changed={onChanged} setToast={setToast} />
      ) : (
        <VStack gap={4}>
          {groups.map((group) => {
            const availableCount = group.items.filter((item) => isAvailable(item)).length;
            const groupStatus = availableCount === group.items.length ? "Available" : availableCount ? "Mixed" : "Unavailable";
            return (
              <Panel key={group.category.id} title={group.category.name} description={`${group.items.length} items`} padding={4} actions={<StatusBadge tone={availableCount === group.items.length ? "success" : availableCount ? "info" : "neutral"}>{groupStatus}</StatusBadge>}>
                <VStack gap={3}>
                  {group.items.map((item) => {
                    const state = states.get(item.id);
                    const available = isAvailable(item);
                    return (
                      <VStack key={item.id} gap={3}>
                        <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
                          <HStack gap={3} vAlign="center">
                            <CheckboxInput label={`Select ${item.name}`} isLabelHidden value={selected.has(item.id)} onChange={(checked) => toggleSelected(item.id, checked)} />
                            <Avatar size="lg" shape="rounded" name={item.name} src={item.primary_image_path ? assetUrl(item.primary_image_path) || undefined : undefined} tooltip={false} />
                            <VStack gap={0}>
                              <Text type="body" weight="semibold">{item.name}</Text>
                              <Text type="supporting" color="secondary">{`${group.category.name}${item.sku ? ` · ${item.sku}` : ""}`}</Text>
                            </VStack>
                          </HStack>
                          <HStack gap={4} vAlign="center" wrap="wrap">
                            <Switch label={state?.mixed ? "Mixed" : available ? "Available" : "Unavailable"} value={state?.mixed ? true : available} isDisabled={busy} onChange={(checked) => checked ? requestChange(() => applyItem(item, true)) : setQuickItem(item)} />
                            <Text type="supporting" color="secondary">{state?.mixed ? "Mixed across locations" : state?.next_change_at ? `Until ${formatMoment(state.next_change_at)}` : "No upcoming change"}</Text>
                            <StatusBadge tone={sourceTone(state?.source)}>{`${readable(state?.source)} · ${state?.reason || "Default"}`}</StatusBadge>
                            <IconButton label={`Open ${item.name} in Manage Menu`} icon={<Eye size={18} aria-hidden="true" />} variant="ghost" size="sm" href={`/dashboard/kiosk-experience/menu?product=${item.id}`} />
                          </HStack>
                        </HStack>
                        {quickItem?.id === item.id && (
                          <Panel padding={3} title="Make unavailable">
                            <Selector label="Unavailable for" value={duration} onChange={setDuration} options={[{ value: "manual", label: "Until manually restored" }, { value: "30", label: "For 30 minutes" }, { value: "60", label: "For 1 hour" }, { value: "day", label: "Until end of day" }, { value: "custom", label: "Choose time…" }]} />
                            {duration === "custom" && <DateTimeInput label="Unavailable until" value={(customEnd || undefined) as never} onChange={(value) => setCustomEnd(value ?? "")} />}
                            <HStack gap={2} hAlign="end">
                              <Button label="Cancel" variant="secondary" onClick={() => setQuickItem(null)} />
                              <Button label="Apply" variant="primary" isDisabled={duration === "custom" && !customEnd} isLoading={busy} onClick={() => requestChange(() => applyItem(item, false, endForDuration()))} />
                            </HStack>
                          </Panel>
                        )}
                      </VStack>
                    );
                  })}
                </VStack>
              </Panel>
            );
          })}
          {!groups.length && <EmptyBlock title={status === "unavailable" ? "Everything is available" : "No matching items"} description={status === "unavailable" ? "No items are currently unavailable." : "Try another search or clear the filters."} action={<Button label="Clear filters" variant="secondary" onClick={() => { setSearch(""); setCategoryId("all"); setStatus("all"); }} />} />}
        </VStack>
      )}
      {selected.size > 0 && (
        <Panel padding={4}>
          <Toolbar>
            <Text type="body" weight="semibold">{`${selected.size} items selected`}</Text>
            <Button label="Make selected available" variant="secondary" isDisabled={busy} onClick={() => requestChange(() => bulk(true))} />
            <Button label="Make selected unavailable" variant="secondary" isDisabled={busy} onClick={() => requestChange(() => bulk(false))} />
            <Button label="Clear selection" variant="ghost" icon={<X size={16} aria-hidden="true" />} onClick={() => setSelected(new Set())} />
          </Toolbar>
        </Panel>
      )}
      <ConfirmDialog isOpen={Boolean(confirmAction)} onClose={() => setConfirmAction(null)} onConfirm={() => { const action = confirmAction; setConfirmAction(null); if (action) void action(); }} title={`Apply to ${locations.length} locations?`} description={`This change affects: ${locations.map((location) => location.name).join(", ")}.`} confirmLabel={`Apply to ${locations.length} locations`} destructive={false} loading={busy} />
    </VStack>
  );
}

function CategoryRows({ groups, states, businessId, locationId, requestChange, refresh, changed, setToast }: { groups: Array<{ category: Category; items: Product[] }>; states: Map<string, ResolvedAvailability>; businessId: string; locationId: string; requestChange: (task: () => Promise<void>) => void; refresh: () => Promise<void>; changed: () => void; setToast: (toast: ToastState | null) => void }) {
  const [busy, setBusy] = useState("");
  const apply = async (group: { category: Category; items: Product[] }, available: boolean) => {
    if (group.category.id === "uncategorised") return;
    setBusy(group.category.id);
    try {
      await api.createAvailabilityRule(businessId, {
        target_type: "category", target_id: group.category.id, rule_type: "exception", name: `${group.category.name} category override`, is_available: available, status: "active", days: [], time_windows: [], starts_at: new Date().toISOString(), ends_at: null, location_ids: locationId ? [locationId] : [], reason: "Category override",
      });
      changed();
      await refresh();
      setToast({ text: `${group.category.name} is ${available ? "available" : "unavailable"}.` });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Availability wasn’t changed.", status: "danger" });
    } finally {
      setBusy("");
    }
  };
  return (
    <VStack gap={3}>
      {groups.map((group) => {
        const available = group.items.filter((item) => states.get(item.id)?.available ?? item.is_available).length;
        const overrides = group.items.filter((item) => states.get(item.id)?.source === "exception").length;
        return (
          <Panel key={group.category.id} padding={4}>
            <HStack gap={4} vAlign="center" hAlign="between" wrap="wrap">
              <VStack gap={0}>
                <Text type="body" weight="semibold">{group.category.name}</Text>
                <Text type="supporting" color="secondary">{`${group.items.length} items · ${available === group.items.length ? "Available now" : available ? "Mixed" : "Unavailable"} · ${overrides} item overrides`}</Text>
              </VStack>
              <Switch label={`${group.category.name} available`} value={available === group.items.length} isDisabled={busy === group.category.id || group.category.id === "uncategorised"} onChange={(checked) => requestChange(() => apply(group, checked))} />
            </HStack>
          </Panel>
        );
      })}
    </VStack>
  );
}

type RuleModeProps = {
  businessId: string;
  rules: AvailabilityRule[];
  products: Product[];
  categories: Category[];
  combos: Combo[];
  locations: BusinessLocation[];
  locationId: string;
  refresh: () => Promise<void>;
  changed: () => void;
  setToast: (toast: ToastState | null) => void;
};

function SchedulesMode({ businessId, rules, products, categories, combos, locations, locationId, refresh, changed, setToast }: RuleModeProps) {
  const schedules = rules.filter((rule) => rule.rule_type === "schedule");
  const [view, setView] = useState<"list" | "week">("list");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [deleteRule, setDeleteRule] = useState<AvailabilityRule | null>(null);
  const [busy, setBusy] = useState(false);
  const filtered = schedules.filter((rule) => !search || `${rule.name || ""} ${rule.target_type}`.toLowerCase().includes(search.toLowerCase()));
  const remove = async () => {
    if (!deleteRule) return;
    setBusy(true);
    try {
      await api.deleteAvailabilityRule(businessId, deleteRule.id);
      changed();
      await refresh();
      setToast({ text: "Schedule deleted." });
      setDeleteRule(null);
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Schedule wasn’t deleted.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const toggleRule = async (rule: AvailabilityRule) => {
    try {
      await api.updateAvailabilityRule(businessId, rule.id, { status: rule.status === "active" ? "paused" : "active" });
      changed();
      await refresh();
      setToast({ text: `Schedule ${rule.status === "active" ? "paused" : "resumed"}.` });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Schedule wasn’t updated.", status: "danger" });
    }
  };
  const duplicateRule = async (rule: AvailabilityRule) => {
    try {
      await api.createAvailabilityRule(businessId, {
        target_type: rule.target_type, target_id: rule.target_id, rule_type: "schedule", name: `${rule.name || readable(rule.target_type)} copy`, is_available: rule.is_available, status: "paused", days: rule.days, time_windows: rule.time_windows, starts_at: rule.starts_at, ends_at: rule.ends_at, location_ids: rule.location_ids, reason: rule.reason,
      });
      changed();
      await refresh();
      setToast({ text: "Paused schedule copy created." });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Schedule wasn’t duplicated.", status: "danger" });
    }
  };

  return (
    <VStack gap={4}>
      <Toolbar>
        <TextInput type="search" label="Search schedules" placeholder="Search schedules…" value={search} onChange={setSearch} />
        <SegmentedControl value={view} onChange={(value) => setView(value as "list" | "week")} label="Schedule view">
          <SegmentedControlItem value="list" label="List" />
          <SegmentedControlItem value="week" label="Week" />
        </SegmentedControl>
        <Button label="Create schedule" variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setDraft(emptyRule("schedule", locationId))} />
      </Toolbar>
      {view === "week" ? <WeekView rules={filtered} /> : filtered.length ? (
          <VStack gap={3}>
            {filtered.map((rule) => <RuleRow key={rule.id} rule={rule} locations={locations} onEdit={() => setDraft(ruleDraft(rule))} onDelete={() => setDeleteRule(rule)} onToggle={() => void toggleRule(rule)} onDuplicate={() => void duplicateRule(rule)} />)}
          </VStack>
      ) : (
        <EmptyBlock title="No availability schedules" description="Everything is using default availability." action={<Button label="Create schedule" variant="primary" onClick={() => setDraft(emptyRule("schedule", locationId))} />} />
      )}
      <RuleEditor draft={draft} setDraft={setDraft} businessId={businessId} products={products} categories={categories} combos={combos} locations={locations} refresh={refresh} changed={changed} setToast={setToast} />
      <ConfirmDialog isOpen={Boolean(deleteRule)} onClose={() => setDeleteRule(null)} onConfirm={() => void remove()} title="Delete schedule?" description={`${deleteRule?.name || "This schedule"} will stop controlling availability.`} confirmLabel="Delete" loading={busy} />
    </VStack>
  );
}

function ExceptionsMode({ businessId, rules, products, categories, combos, locations, locationId, refresh, changed, setToast }: RuleModeProps) {
  const [filter, setFilter] = useState<"active" | "upcoming" | "past">("active");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [busy, setBusy] = useState("");
  const [now] = useState(Date.now);
  const exceptions = rules.filter((rule) => rule.rule_type === "exception" && (filter === "active" ? activeException(rule, now) : filter === "upcoming" ? upcomingException(rule, now) : Boolean(rule.ends_at) && new Date(rule.ends_at!).getTime() <= now));
  const restore = async (rule: AvailabilityRule) => {
    setBusy(rule.id);
    try {
      await api.deleteAvailabilityRule(businessId, rule.id);
      changed();
      await refresh();
      setToast({ text: "Override removed." });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Override wasn’t removed.", status: "danger" });
    } finally {
      setBusy("");
    }
  };
  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <SegmentedControl value={filter} onChange={(value) => setFilter(value as typeof filter)} label="Exception timing">
          {(["active", "upcoming", "past"] as const).map((value) => <SegmentedControlItem key={value} value={value} label={readable(value)} />)}
        </SegmentedControl>
        <Button label="Add exception" variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setDraft(emptyRule("exception", locationId))} />
      </HStack>
      {exceptions.length ? (
        <VStack gap={3}>
          {exceptions.map((rule) => (
            <Panel key={rule.id} padding={4}>
              <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
                <VStack gap={0}>
                  <Text type="body" weight="semibold">{rule.name || readable(rule.target_type)}</Text>
                  <Text type="supporting" color="secondary">{`${rule.is_available ? "Available" : "Unavailable"} ${rule.ends_at ? `until ${formatMoment(rule.ends_at)}` : "until manually restored"} · ${readable(rule.target_type)} · ${rule.location_ids.length ? `${rule.location_ids.length} locations` : "All locations"}`}</Text>
                </VStack>
                <HStack gap={2} vAlign="center">
                  <StatusBadge tone={activeException(rule) ? "warning" : "neutral"}>{activeException(rule) ? "Active" : filter === "upcoming" ? "Upcoming" : "Past"}</StatusBadge>
                  {activeException(rule) && <Button label={`Restore ${rule.name || "override"} now`} variant="secondary" icon={<RotateCcw size={15} aria-hidden="true" />} isLoading={busy === rule.id} onClick={() => void restore(rule)} />}
                  <Button label={`Edit ${rule.name || "override"}`} variant="ghost" onClick={() => setDraft(ruleDraft(rule))} />
                </HStack>
              </HStack>
            </Panel>
          ))}
        </VStack>
      ) : (
        <EmptyBlock title={`No ${filter} exceptions`} description={filter === "active" ? "Scheduled availability is running normally." : "Nothing is scheduled to override normal availability."} />
      )}
      <RuleEditor draft={draft} setDraft={setDraft} businessId={businessId} products={products} categories={categories} combos={combos} locations={locations} refresh={refresh} changed={changed} setToast={setToast} />
    </VStack>
  );
}

function RuleRow({ rule, locations, onEdit, onDelete, onToggle, onDuplicate }: { rule: AvailabilityRule; locations: BusinessLocation[]; onEdit: () => void; onDelete: () => void; onToggle: () => void; onDuplicate: () => void }) {
  const locationNames = rule.location_ids.map((id) => locations.find((location) => location.id === id)?.name).filter(Boolean);
  return (
    <Panel padding={4}>
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <VStack gap={0}>
          <Text type="body" weight="semibold">{rule.name || readable(rule.target_type)}</Text>
          <Text type="supporting" color="secondary">{`${readable(rule.target_type)} · ${rule.days.length === 7 ? "Every day" : rule.days.map((day) => day.slice(0, 3)).join("–")}`}</Text>
        </VStack>
        <VStack gap={0}>
          <Text type="body">{rule.time_windows.map((window) => `${window.start.slice(0, 5)}–${window.end.slice(0, 5)}`).join(" · ")}</Text>
          <Text type="supporting" color="secondary">{locationNames.length ? locationNames.join(", ") : "All locations"}</Text>
        </VStack>
        <HStack gap={2} vAlign="center">
          <StatusBadge tone={statusTone(rule.status)}>{readable(rule.status)}</StatusBadge>
          <Button label={`Edit ${rule.name || "schedule"}`} variant="secondary" onClick={onEdit} />
          <DropdownMenu button={{ label: `More actions for ${rule.name || "schedule"}`, variant: "ghost", size: "sm", icon: <MoreHorizontal size={17} aria-hidden="true" /> }} placement="below" alignment="end" items={[
            { label: "Duplicate", onClick: onDuplicate },
            { label: rule.status === "active" ? "Pause" : "Resume", onClick: onToggle },
            { label: "Delete", icon: <Trash2 size={14} aria-hidden="true" />, variant: "destructive", onClick: onDelete },
          ]} />
        </HStack>
      </HStack>
    </Panel>
  );
}

/** Minutes since midnight for a "HH:MM" or "HH:MM:SS" value. */
const clockMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + (minutes || 0);
};

/** True when the hour's midpoint falls inside a window, including windows that run past midnight. */
const windowCovers = (window: { start: string; end: string }, minute: number) => {
  const from = clockMinutes(window.start);
  const to = clockMinutes(window.end);
  return to > from ? minute >= from && minute < to : minute >= from || minute < to;
};

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];

/** Weekly coverage heatmap: how many active schedules apply in each hour of each day. Hover or focus reads a cell. */
function WeekView({ rules }: { rules: AvailabilityRule[] }) {
  const [hover, setHover] = useState<{ day: string; hour: number } | null>(null);
  const active = rules.filter((rule) => rule.rule_type === "schedule" && rule.status === "active");
  const coverage = (day: string, hour: number) => active.filter((rule) => rule.days.includes(day) && rule.time_windows.some((window) => windowCovers(window, hour * 60 + 30))).length;
  const matrix = DAYS.map((day) => Array.from({ length: 24 }, (_, hour) => coverage(day, hour)));
  const peak = Math.max(0, ...matrix.flat());
  const shade = (value: number) => (value === 0 ? "var(--color-background-muted)" : `color-mix(in srgb, var(--viz-1) ${Math.round(24 + (value / peak) * 76)}%, transparent)`);
  const readout = hover ? `${readable(hover.day)} ${String(hover.hour).padStart(2, "0")}:00 · ${coverage(hover.day, hover.hour)} ${coverage(hover.day, hover.hour) === 1 ? "schedule" : "schedules"}` : `Peak ${peak} ${peak === 1 ? "schedule" : "schedules"} at once`;
  return (
    <Panel title="Weekly coverage" description="Each cell is one hour. Darker means more active schedules apply then.">
      <VStack gap={3}>
        <div style={{ display: "grid", gridTemplateColumns: "84px repeat(24, minmax(0, 1fr))", gap: 2, alignItems: "center" }}>
          <span />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} style={{ fontSize: 11, color: "var(--color-text-secondary)", textAlign: "center" }}>
              {HOUR_LABELS.includes(hour) ? String(hour).padStart(2, "0") : ""}
            </span>
          ))}
          {DAYS.map((day, dayIndex) => (
            <div key={day} style={{ display: "contents" }}>
              <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{readable(day).slice(0, 3)}</span>
              {matrix[dayIndex].map((value, hour) => (
                <span
                  key={hour}
                  role="img"
                  tabIndex={0}
                  aria-label={`${readable(day)} ${String(hour).padStart(2, "0")}:00: ${value} ${value === 1 ? "schedule" : "schedules"}`}
                  onPointerEnter={() => setHover({ day, hour })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover({ day, hour })}
                  onBlur={() => setHover(null)}
                  style={{ height: 22, borderRadius: 3, background: shade(value), outline: hover?.day === day && hover?.hour === hour ? "2px solid var(--color-text-primary)" : "none", outlineOffset: 1 }}
                />
              ))}
            </div>
          ))}
        </div>
        <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
          <HStack gap={2} vAlign="center">
            <Text type="supporting" color="secondary">Fewer</Text>
            {[0.15, 0.4, 0.7, 1].map((level) => (
              <span key={level} style={{ width: 16, height: 10, borderRadius: 2, background: `color-mix(in srgb, var(--viz-1) ${Math.round(level * 100)}%, transparent)` }} />
            ))}
            <Text type="supporting" color="secondary">More</Text>
          </HStack>
          <Text type="supporting" color="secondary">{readout}</Text>
        </HStack>
      </VStack>
    </Panel>
  );
}

function RuleEditor({ draft, setDraft, businessId, products, categories, combos, locations, refresh, changed, setToast }: { draft: RuleDraft | null; setDraft: (draft: RuleDraft | null) => void; businessId: string; products: Product[]; categories: Category[]; combos: Combo[]; locations: BusinessLocation[]; refresh: () => Promise<void>; changed: () => void; setToast: (toast: ToastState | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!draft) return null;
  const targets = draft.targetType === "item" ? products : draft.targetType === "category" ? categories : draft.targetType === "combo" ? combos : draft.targetType === "location" ? locations : [];
  const update = (changes: Partial<RuleDraft>) => setDraft({ ...draft, ...changes });
  const multiItem = !draft.id && draft.targetType === "item";
  const save = async () => {
    setError("");
    if (draft.targetType !== "menu" && !draft.targetIds.length) { setError("Select at least one target."); return; }
    if (draft.ruleType === "schedule" && (!draft.days.length || draft.windows.some((window) => !window.start || !window.end || window.start === window.end))) { setError("Choose days and valid time windows."); return; }
    setBusy(true);
    try {
      const payload = {
        target_type: draft.targetType,
        target_id: draft.targetType === "menu" ? null : draft.targetIds[0],
        rule_type: draft.ruleType,
        name: draft.name || null,
        is_available: draft.available,
        status: "active" as const,
        days: draft.ruleType === "schedule" ? draft.days : [],
        time_windows: draft.ruleType === "schedule" ? draft.windows : [],
        starts_at: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
        ends_at: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
        location_ids: draft.locations,
        reason: draft.reason || null,
      };
      if (draft.id) await api.updateAvailabilityRule(businessId, draft.id, payload);
      else await Promise.all((draft.targetType === "menu" ? [""] : draft.targetIds).map((targetId) => api.createAvailabilityRule(businessId, { ...payload, target_id: draft.targetType === "menu" ? null : targetId })));
      changed();
      await refresh();
      setToast({ text: `${draft.ruleType === "schedule" ? "Schedule" : "Exception"} saved.` });
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Availability rule wasn’t saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailDrawer
      title={draft.id ? `Edit ${readable(draft.ruleType)}` : draft.ruleType === "schedule" ? "Create schedule" : "Add exception"}
      isOpen
      onClose={() => setDraft(null)}
      width={560}
      footer={<><Button label="Cancel" variant="secondary" onClick={() => setDraft(null)} /><Button label={`Save ${draft.ruleType}`} variant="primary" isLoading={busy} onClick={() => void save()} /></>}
    >
      <Selector label="Applies to" value={draft.targetType} onChange={(value) => update({ targetType: value as RuleDraft["targetType"], targetIds: [] })} options={[
        { value: "item", label: "Items" },
        { value: "category", label: "Category" },
        { value: "combo", label: "Combo" },
        ...(draft.ruleType === "exception" ? [{ value: "location", label: "Location" }, { value: "menu", label: "Entire menu" }] : []),
      ]} />
      {draft.targetType !== "menu" && (multiItem ? (
        <CheckboxList label="Targets" value={draft.targetIds} onChange={(values) => update({ targetIds: values })}>
          {targets.map((target) => <CheckboxListItem key={target.id} value={target.id} label={target.name} />)}
        </CheckboxList>
      ) : (
        <Selector label="Target" value={draft.targetIds[0] || ""} onChange={(value) => update({ targetIds: value ? [value] : [] })} options={targets.map((target) => ({ value: target.id, label: target.name }))} />
      ))}
      <TextInput label="Name" value={draft.name} onChange={(value) => update({ name: value })} placeholder={draft.ruleType === "schedule" ? "Breakfast" : "Temporary closure"} />
      <Switch label={draft.available ? "Available" : "Unavailable"} value={draft.available} onChange={(checked) => update({ available: checked })} />
      {draft.ruleType === "schedule" ? (
        <VStack gap={3}>
          <CheckboxList label="Days" value={draft.days} onChange={(values) => update({ days: values })}>
            {DAYS.map((day) => <CheckboxListItem key={day} value={day} label={readable(day)} />)}
          </CheckboxList>
          <Text type="label">Time windows</Text>
          {draft.windows.map((window, index) => (
            <HStack key={index} gap={2} vAlign="end" wrap="wrap">
              <TimeInput label={`Window ${index + 1} start`} value={window.start as never} onChange={(value) => update({ windows: draft.windows.map((entry, entryIndex) => entryIndex === index ? { ...entry, start: value ?? "" } : entry) })} />
              <Text type="body" color="secondary">–</Text>
              <TimeInput label={`Window ${index + 1} end`} value={window.end as never} onChange={(value) => update({ windows: draft.windows.map((entry, entryIndex) => entryIndex === index ? { ...entry, end: value ?? "" } : entry) })} />
              {draft.windows.length > 1 && <IconButton label={`Remove window ${index + 1}`} icon={<X size={15} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => update({ windows: draft.windows.filter((_, entryIndex) => entryIndex !== index) })} />}
            </HStack>
          ))}
          <HStack gap={2}><Button label="Add time window" variant="ghost" onClick={() => update({ windows: [...draft.windows, { start: "", end: "" }] })} /></HStack>
        </VStack>
      ) : (
        <VStack gap={2}>
          <Text type="label">Quick presets</Text>
          <HStack gap={2} wrap="wrap">
            <Button label="30 minutes" variant="secondary" onClick={() => update({ startsAt: localDateTime(new Date()), endsAt: localDateTime(new Date(Date.now() + 30 * 60000)), available: false })} />
            <Button label="1 hour" variant="secondary" onClick={() => update({ startsAt: localDateTime(new Date()), endsAt: localDateTime(new Date(Date.now() + 60 * 60000)), available: false })} />
            <Button label="End of day" variant="secondary" onClick={() => { const end = new Date(); end.setHours(23, 59, 0, 0); update({ startsAt: localDateTime(new Date()), endsAt: localDateTime(end), available: false }); }} />
          </HStack>
        </VStack>
      )}
      <Grid columns={{ minWidth: 220, repeat: "fit" }} gap={3}>
        <DateTimeInput label="Starts" value={(draft.startsAt || undefined) as never} onChange={(value) => update({ startsAt: value ?? "" })} />
        <DateTimeInput label="Ends" value={(draft.endsAt || undefined) as never} onChange={(value) => update({ endsAt: value ?? "" })} />
      </Grid>
      {locations.length > 0 && (
        <CheckboxList label="Locations" description="No selection applies to all locations." value={draft.locations} onChange={(values) => update({ locations: values })}>
          {locations.map((location) => <CheckboxListItem key={location.id} value={location.id} label={location.name} />)}
        </CheckboxList>
      )}
      <TextInput label="Reason (optional)" value={draft.reason} onChange={(value) => update({ reason: value })} />
      {error && <NoticeBanner tone="danger" title={error} />}
    </DetailDrawer>
  );
}

function ruleDraft(rule: AvailabilityRule): RuleDraft {
  return {
    id: rule.id,
    ruleType: rule.rule_type,
    targetType: rule.target_type,
    targetIds: rule.target_id ? [rule.target_id] : [],
    name: rule.name || "",
    available: rule.is_available,
    days: rule.days || [],
    windows: (rule.time_windows || []).map((window) => ({ start: window.start.slice(0, 5), end: window.end.slice(0, 5) })),
    startsAt: rule.starts_at ? localDateTime(new Date(rule.starts_at)) : "",
    endsAt: rule.ends_at ? localDateTime(new Date(rule.ends_at)) : "",
    locations: rule.location_ids || [],
    reason: rule.reason || "",
  };
}

export function AvailabilitySkeleton() {
  return <LoadingBlock rows={5} />;
}

