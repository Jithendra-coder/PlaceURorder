"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  MapPin,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { RealKioskFrame } from "@/app/admin/_components/real-kiosk-frame";
import {
  Button,
  Checkbox,
  ConfirmationDialog,
  DataState,
  DetailsDrawer,
  Input,
  SearchInput,
  Select,
  StatusPill,
  Toast,
  Toggle,
} from "@/components/ui/DashboardUI";
import { api, assetUrl } from "@/lib/api";
import type {
  AvailabilityRule,
  BusinessLocation,
  Category,
  Combo,
  KioskSetupOverview,
  Product,
  ResolvedAvailability,
} from "@/lib/types";
import type { Business } from "@/services/api";

type Mode = "live" | "schedules" | "exceptions";
type LiveView = "items" | "categories";
type StatusFilter =
  "all" | "available" | "unavailable" | "changing" | "attention";
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

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
const emptyRule = (
  ruleType: RuleDraft["ruleType"],
  locationId = "",
): RuleDraft => ({
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
const readable = (value?: string | null) =>
  (value || "Default")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const localDateTime = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const formatMoment = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "No upcoming change";
const activeException = (rule: AvailabilityRule, now = Date.now()) =>
  rule.rule_type === "exception" &&
  rule.status === "active" &&
  (!rule.starts_at || new Date(rule.starts_at).getTime() <= now) &&
  (!rule.ends_at || new Date(rule.ends_at).getTime() > now);
const upcomingException = (rule: AvailabilityRule, now = Date.now()) =>
  rule.rule_type === "exception" &&
  rule.status === "active" &&
  Boolean(rule.starts_at) &&
  new Date(rule.starts_at!).getTime() > now;

export function comboAvailability(combo: Combo, states: Map<string, boolean>) {
  const blocked = (combo.sections || []).filter(
    (section) =>
      section.required &&
      !section.options.some(
        (option) =>
          option.visible &&
          (!option.existing_item_id || states.get(option.existing_item_id)),
      ),
  );
  return {
    available: combo.status === "shown" && blocked.length === 0,
    reason: blocked.length
      ? `No available ${blocked[0].title.toLowerCase()} selection`
      : "All required groups have an available choice",
  };
}

export function AvailabilityPage({
  business,
  products,
  categories,
  combos,
  setup,
}: {
  business: Business;
  products: Product[];
  categories: Category[];
  combos: Combo[];
  setup: KioskSetupOverview | null;
}) {
  const [mode, setMode] = useState<Mode>("live");
  const [rows, setRows] = useState(products);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [locations, setLocations] = useState<BusinessLocation[]>([]);
  const [resolved, setResolved] = useState<ResolvedAvailability[]>([]);
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [draftChanges, setDraftChanges] = useState(
    setup?.unpublishedChanges || 0,
  );

  const load = useCallback(async (scope = "", preserve = true) => {
    if (!preserve) setLoading(true);
    setError("");
    try {
      const result = await api.availability(business.id, scope || null);
      setRules(result.rules);
      setLocations(result.locations);
      setResolved(result.resolved);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t load current availability.",
      );
    } finally {
      setLoading(false);
    }
  }, [business.id]);
  useEffect(() => {
    const task = window.setTimeout(() => void load("", false), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const states = useMemo(
    () => new Map(resolved.map((entry) => [entry.product_id, entry])),
    [resolved],
  );
  const visibleRows = rows.filter((item) => item.menu_status !== "hidden");
  const counts = visibleRows.reduce(
    (total, item) => {
      const state = states.get(item.id);
      if (state?.available ?? item.is_available) total.available += 1;
      else total.unavailable += 1;
      if (state?.next_change_at) total.changing += 1;
      return total;
    },
    { available: 0, unavailable: 0, changing: 0 },
  );
  const comboStates = useMemo(
    () =>
      new Map(
        visibleRows.map((item) => [
          item.id,
          states.get(item.id)?.available ?? item.is_available,
        ]),
      ),
    [states, visibleRows],
  );
  const attention = combos.filter(
    (combo) =>
      !comboAvailability(combo, comboStates).available &&
      combo.status === "shown",
  );
  const changed = () => {
    setDraftChanges((value) => value + 1);
    setPreviewKey((value) => value + 1);
  };
  const refresh = async () => {
    await load(locationId);
    setPreviewKey((value) => value + 1);
  };

  return (
    <section className="mt-availability-page">
      <header className="mt-availability-header">
        <div>
          <h1>Availability</h1>
          {loading ? (
            <span className="mt-availability-meta-skeleton" />
          ) : (
            <p>
              {counts.available} available now · {counts.unavailable}{" "}
              unavailable · {counts.changing} changing soon
            </p>
          )}
        </div>
        <div className="mt-availability-header__actions">
          <label className="mt-availability-location">
            <MapPin size={16} />
            <span className="mt-sr-only">Location</span>
            <select
              value={locationId}
              onChange={(event) => {
                const next = event.target.value;
                setLocationId(next);
                void load(next, false);
              }}
            >
              <option value="">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            onClick={() => {
              if (window.matchMedia("(min-width: 1367px)").matches)
                document
                  .getElementById("availability-preview")
                  ?.scrollIntoView({ block: "nearest" });
              else setPreviewOpen(true);
            }}
          >
            <Eye size={16} /> Preview availability
          </Button>
        </div>
      </header>
      {draftChanges > 0 && (
        <button
          type="button"
          className="mt-availability-draft"
          onClick={() => setChangesOpen(true)}
        >
          <span />
          {draftChanges} unpublished changes <b>Review changes →</b>
        </button>
      )}
      <nav className="mt-availability-modes" aria-label="Availability modes">
        {(["live", "schedules", "exceptions"] as Mode[]).map((value) => (
          <button
            type="button"
            key={value}
            aria-current={mode === value ? "page" : undefined}
            onClick={() => setMode(value)}
          >
            {readable(value)}
          </button>
        ))}
      </nav>
      {error && (
        <DataState
          kind="recoverable-error"
          title="Couldn’t load current availability."
          description={error}
          action={
            <Button
              variant="secondary"
              onClick={() => void load(locationId, false)}
            >
              Retry
            </Button>
          }
        />
      )}
      {loading ? (
        <AvailabilitySkeleton />
      ) : (
        <div className="mt-availability-workspace">
          <div className="mt-availability-main">
            {mode === "live" ? (
              <LiveMode
                products={visibleRows}
                categories={categories}
                states={states}
                attention={attention}
                locationId={locationId}
                locations={locations}
                onChanged={changed}
                refresh={refresh}
                setRows={setRows}
                setToast={setToast}
              />
            ) : mode === "schedules" ? (
              <SchedulesMode
                businessId={business.id}
                rules={rules}
                products={visibleRows}
                categories={categories}
                combos={combos}
                locations={locations}
                locationId={locationId}
                refresh={refresh}
                changed={changed}
                setToast={setToast}
              />
            ) : (
              <ExceptionsMode
                businessId={business.id}
                rules={rules}
                products={visibleRows}
                categories={categories}
                combos={combos}
                locations={locations}
                locationId={locationId}
                refresh={refresh}
                changed={changed}
                setToast={setToast}
              />
            )}
          </div>
          <aside id="availability-preview" className="mt-availability-preview">
            <RealKioskFrame
              slug={business.slug}
              businessId={business.id}
              locationId={locationId || null}
              orientation="portrait"
              compact
              sessionKey={`availability-${previewKey}`}
            />
            <p>Portrait preview</p>
          </aside>
        </div>
      )}
      <DetailsDrawer
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Portrait availability preview"
        footer={
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
        }
      >
        <RealKioskFrame
          slug={business.slug}
          businessId={business.id}
          locationId={locationId || null}
          orientation="portrait"
          compact
          sessionKey={`availability-drawer-${previewKey}`}
        />
      </DetailsDrawer>
      <DetailsDrawer
        open={changesOpen}
        onClose={() => setChangesOpen(false)}
        title="Availability changes"
        footer={
          <Button variant="secondary" onClick={() => setChangesOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="mt-availability-changes">
          {setup?.changeSummary.map((entry) => (
            <div key={entry.key}>
              <span>
                <strong>{entry.label}</strong>
                <small>
                  {entry.count} draft {entry.count === 1 ? "change" : "changes"}
                </small>
              </span>
              {entry.key === "availability_rules" && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMode(
                      rules.some((rule) => rule.rule_type === "exception")
                        ? "exceptions"
                        : "schedules",
                    );
                    setChangesOpen(false);
                  }}
                >
                  View
                </Button>
              )}
            </div>
          ))}
          {!setup?.changeSummary.length && (
            <DataState
              kind="info"
              title={`${draftChanges} availability ${draftChanges === 1 ? "change" : "changes"} saved`}
              description="The current kiosk draft has not been published."
            />
          )}
        </div>
      </DetailsDrawer>
      {toast && (
        <div className="mt-availability-toast">
          <Toast
            status={toast.status || "success"}
            onDismiss={() => setToast(null)}
          >
            {toast.text}
            {toast.action && (
              <button type="button" onClick={() => void toast.action?.run()}>
                {toast.action.label}
              </button>
            )}
          </Toast>
        </div>
      )}
    </section>
  );
}

function LiveMode({
  products,
  categories,
  states,
  attention,
  locationId,
  locations,
  onChanged,
  refresh,
  setRows,
  setToast,
}: {
  products: Product[];
  categories: Category[];
  states: Map<string, ResolvedAvailability>;
  attention: Combo[];
  locationId: string;
  locations: BusinessLocation[];
  onChanged: () => void;
  refresh: () => Promise<void>;
  setRows: React.Dispatch<React.SetStateAction<Product[]>>;
  setToast: (toast: ToastState | null) => void;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [categoryId, setCategoryId] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [view, setView] = useState<LiveView>("items");
  const [selected, setSelected] = useState(new Set<string>());
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [quickItem, setQuickItem] = useState<Product | null>(null);
  const [duration, setDuration] = useState("manual");
  const [customEnd, setCustomEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    null | (() => Promise<void>)
  >(null);
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const matches = products.filter((item) => {
    const state = states.get(item.id);
    const available = state?.available ?? item.is_available;
    return (
      (!deferredSearch ||
        `${item.name} ${item.sku || ""} ${categoriesById.get(item.category_id || "")?.name || ""}`
          .toLowerCase()
          .includes(deferredSearch)) &&
      (categoryId === "all" || item.category_id === categoryId) &&
      (status === "all" ||
        (status === "available" && available) ||
        (status === "unavailable" && !available) ||
        (status === "changing" && Boolean(state?.next_change_at)))
    );
  });
  const groups = categories
    .map((category) => ({
      category,
      items: matches.filter((item) => item.category_id === category.id),
    }))
    .filter((group) => group.items.length);
  const uncategorised = matches.filter(
    (item) => !item.category_id || !categoriesById.has(item.category_id),
  );
  if (uncategorised.length)
    groups.push({
      category: {
        id: "uncategorised",
        business_id: "",
        name: "Uncategorised",
        is_active: true,
        sort_order: 999,
      },
      items: uncategorised,
    });
  const applyItem = async (item: Product, available: boolean, end?: string) => {
    const previous = states.get(item.id)?.available ?? item.is_available;
    setBusy(true);
    setRows((current) =>
      current.map((row) =>
        row.id === item.id ? { ...row, is_available: available } : row,
      ),
    );
    try {
      let ruleId = "";
      if (end || locationId) {
        const rule = await api.createAvailabilityRule(item.business_id, {
          target_type: "item",
          target_id: item.id,
          rule_type: "exception",
          name: `${item.name} override`,
          is_available: available,
          status: "active",
          days: [],
          time_windows: [],
          starts_at: new Date().toISOString(),
          ends_at: end || null,
          location_ids: locationId ? [locationId] : [],
          reason: end ? "Temporary override" : "Location override",
        });
        ruleId = rule.id;
      } else await api.setAvailability(item.id, available);
      onChanged();
      await refresh();
      setQuickItem(null);
      setToast({
        text: `${item.name} is ${available ? "available" : end ? `unavailable until ${formatMoment(end)}` : "unavailable"}.`,
        action: {
          label: "Undo",
          run: async () => {
            if (ruleId)
              await api.deleteAvailabilityRule(item.business_id, ruleId);
            else await api.setAvailability(item.id, previous);
            await refresh();
            setToast(null);
          },
        },
      });
    } catch (cause) {
      setRows((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, is_available: previous } : row,
        ),
      );
      setToast({
        text:
          cause instanceof Error
            ? cause.message
            : "Availability wasn’t changed.",
        status: "danger",
      });
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
    else if (duration === "custom")
      return customEnd ? new Date(customEnd).toISOString() : undefined;
    else return undefined;
    return now.toISOString();
  };
  const bulk = async (available: boolean) => {
    const chosen = products.filter((item) => selected.has(item.id));
    setBusy(true);
    try {
      await Promise.all(
        chosen.map((item) =>
          locationId
            ? api.createAvailabilityRule(item.business_id, {
                target_type: "item",
                target_id: item.id,
                rule_type: "exception",
                name: `${item.name} location override`,
                is_available: available,
                status: "active",
                days: [],
                time_windows: [],
                starts_at: new Date().toISOString(),
                ends_at: null,
                location_ids: [locationId],
                reason: "Location override",
              })
            : api.setAvailability(item.id, available),
        ),
      );
      setSelected(new Set());
      onChanged();
      await refresh();
      setToast({ text: `${chosen.length} items updated.` });
    } catch (cause) {
      setToast({
        text:
          cause instanceof Error
            ? cause.message
            : "Availability wasn’t changed.",
        status: "danger",
      });
    } finally {
      setBusy(false);
    }
  };
  if (!products.length)
    return (
      <DataState
        kind="empty"
        title="No menu items yet"
        description="Add items before managing availability."
        action={
          <Link
            className="mt-button mt-button--primary"
            href="/dashboard/kiosk-experience/menu"
          >
            Go to Manage Menu
          </Link>
        }
      />
    );
  return (
    <div className="mt-availability-live">
      <div
        className="mt-availability-statuses"
        aria-label="Availability filters"
      >
        {(
          [
            { id: "all", label: "All", count: products.length },
            {
              id: "available",
              label: "Available",
              count: products.filter(
                (item) => states.get(item.id)?.available ?? item.is_available,
              ).length,
            },
            {
              id: "unavailable",
              label: "Unavailable",
              count: products.filter(
                (item) =>
                  !(states.get(item.id)?.available ?? item.is_available),
              ).length,
            },
            {
              id: "changing",
              label: "Changing soon",
              count: products.filter(
                (item) => states.get(item.id)?.next_change_at,
              ).length,
            },
            {
              id: "attention",
              label: "Needs attention",
              count: attention.length,
            },
          ] as const
        ).map((filter) => (
          <button
            type="button"
            key={filter.id}
            data-kind={filter.id}
            aria-pressed={status === filter.id}
            onClick={() => setStatus(filter.id)}
          >
            {filter.label} {filter.count}
          </button>
        ))}
      </div>
      <div className="mt-availability-toolbar">
        <SearchInput
          label="Search items or categories"
          placeholder="Search items or categories…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label>
          <span className="mt-sr-only">Category</span>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <div
          className="mt-availability-view"
          role="group"
          aria-label="Live view"
        >
          <button
            type="button"
            aria-pressed={view === "items"}
            onClick={() => setView("items")}
          >
            Items
          </button>
          <button
            type="button"
            aria-pressed={view === "categories"}
            onClick={() => setView("categories")}
          >
            Categories
          </button>
        </div>
      </div>
      {status === "attention" ? (
        <div className="mt-availability-list">
          {attention.length ? (
            attention.map((combo) => (
              <div className="mt-availability-attention" key={combo.id}>
                <AlertTriangle size={18} />
                <span>
                  <strong>{combo.name}</strong>
                  <small>
                    {
                      comboAvailability(
                        combo,
                        new Map(
                          products.map((item) => [
                            item.id,
                            states.get(item.id)?.available ?? item.is_available,
                          ]),
                        ),
                      ).reason
                    }
                  </small>
                </span>
                <Link href={`/dashboard/kiosk-experience/menu?mode=combos`}>
                  Review combo →
                </Link>
              </div>
            ))
          ) : (
            <DataState
              kind="empty"
              title="No items need attention"
              description="Availability rules are consistent."
            />
          )}
        </div>
      ) : view === "categories" ? (
        <CategoryRows
          groups={groups}
          states={states}
          businessId={products[0].business_id}
          locationId={locationId}
          requestChange={requestChange}
          refresh={refresh}
          changed={onChanged}
          setToast={setToast}
        />
      ) : (
        <div className="mt-availability-list">
          {groups.map((group) => (
            <section className="mt-availability-group" key={group.category.id}>
              <header>
                <button
                  type="button"
                  aria-expanded={!collapsed.has(group.category.id)}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(group.category.id))
                        next.delete(group.category.id);
                      else next.add(group.category.id);
                      return next;
                    })
                  }
                >
                  {collapsed.has(group.category.id) ? (
                    <ChevronRight size={17} />
                  ) : (
                    <ChevronDown size={17} />
                  )}
                  <span>
                    <strong>{group.category.name}</strong>
                    <small>{group.items.length} items</small>
                  </span>
                </button>
                <StatusPill
                  status={
                    group.items.every(
                      (item) =>
                        states.get(item.id)?.available ?? item.is_available,
                    )
                      ? "success"
                      : group.items.some(
                            (item) =>
                              states.get(item.id)?.available ??
                              item.is_available,
                          )
                        ? "info"
                        : "neutral"
                  }
                >
                  {group.items.every(
                    (item) =>
                      states.get(item.id)?.available ?? item.is_available,
                  )
                    ? "Available"
                    : group.items.some(
                          (item) =>
                            states.get(item.id)?.available ?? item.is_available,
                        )
                      ? "Mixed"
                      : "Unavailable"}
                </StatusPill>
              </header>
              {!collapsed.has(group.category.id) &&
                group.items.map((item) => {
                  const state = states.get(item.id);
                  const available = state?.available ?? item.is_available;
                  return (
                    <div className="mt-availability-item" key={item.id}>
                      <Checkbox
                        label={
                          <span className="mt-sr-only">Select {item.name}</span>
                        }
                        checked={selected.has(item.id)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                      />
                      {item.primary_image_path ? (
                        <Image
                          src={assetUrl(item.primary_image_path)!}
                          alt=""
                          width={50}
                          height={50}
                        />
                      ) : (
                        <span
                          className="mt-availability-thumb"
                          aria-hidden="true"
                        >
                          {item.name.slice(0, 1)}
                        </span>
                      )}
                      <span className="mt-availability-item__identity">
                        <strong>{item.name}</strong>
                        <small>
                          {group.category.name}
                          {item.sku ? ` · ${item.sku}` : ""}
                        </small>
                      </span>
                      <Toggle
                        label={
                          state?.mixed
                            ? "Mixed"
                            : available
                              ? "Available"
                              : "Unavailable"
                        }
                        checked={state?.mixed ? true : available}
                        disabled={busy}
                        onChange={(event) =>
                          event.target.checked
                            ? requestChange(() => applyItem(item, true))
                            : setQuickItem(item)
                        }
                      />
                      <span className="mt-availability-next">
                        {state?.mixed
                          ? "Mixed across locations"
                          : state?.next_change_at
                            ? `Until ${formatMoment(state.next_change_at)}`
                            : "No upcoming change"}
                      </span>
                      <span className="mt-availability-source">
                        <b>{readable(state?.source)}</b>
                        <small>{state?.reason || "Default"}</small>
                      </span>
                      <Link
                        className="mt-availability-more"
                        aria-label={`Open ${item.name} in Manage Menu`}
                        href={`/dashboard/kiosk-experience/menu?product=${item.id}`}
                      >
                        <MoreHorizontal size={18} />
                      </Link>
                      {quickItem?.id === item.id && (
                        <div className="mt-availability-quick">
                          <strong>Make unavailable</strong>
                          {[
                            ["manual", "Until manually restored"],
                            ["30", "For 30 minutes"],
                            ["60", "For 1 hour"],
                            ["day", "Until end of day"],
                            ["custom", "Choose time…"],
                          ].map(([value, label]) => (
                            <label key={value}>
                              <input
                                type="radio"
                                name={`duration-${item.id}`}
                                value={value}
                                checked={duration === value}
                                onChange={() => setDuration(value)}
                              />{" "}
                              {label}
                            </label>
                          ))}
                          {duration === "custom" && (
                            <input
                              aria-label="Unavailable until"
                              type="datetime-local"
                              value={customEnd}
                              min={localDateTime(new Date())}
                              onChange={(event) =>
                                setCustomEnd(event.target.value)
                              }
                            />
                          )}
                          <div>
                            <Button
                              variant="secondary"
                              onClick={() => setQuickItem(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              disabled={duration === "custom" && !customEnd}
                              loading={busy}
                              onClick={() =>
                                requestChange(() =>
                                  applyItem(item, false, endForDuration()),
                                )
                              }
                            >
                              Apply
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </section>
          ))}
          {!groups.length && (
            <DataState
              kind="filtered-empty"
              title={
                status === "unavailable"
                  ? "Everything is available"
                  : "No matching items"
              }
              description={
                status === "unavailable"
                  ? "No items are currently unavailable."
                  : "Try another search or clear the filters."
              }
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setCategoryId("all");
                    setStatus("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          )}
        </div>
      )}
      {selected.size > 0 && (
        <div className="mt-availability-bulk">
          <strong>{selected.size} items selected</strong>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => requestChange(() => bulk(true))}
          >
            Make available
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => requestChange(() => bulk(false))}
          >
            Make unavailable
          </Button>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => setSelected(new Set())}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <ConfirmationDialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action) void action();
        }}
        title={`Apply to ${locations.length} locations?`}
        description={`This change affects: ${locations.map((location) => location.name).join(", ")}.`}
        confirmLabel={`Apply to ${locations.length} locations`}
        loading={busy}
      />
    </div>
  );
}

function CategoryRows({
  groups,
  states,
  businessId,
  locationId,
  requestChange,
  refresh,
  changed,
  setToast,
}: {
  groups: Array<{ category: Category; items: Product[] }>;
  states: Map<string, ResolvedAvailability>;
  businessId: string;
  locationId: string;
  requestChange: (task: () => Promise<void>) => void;
  refresh: () => Promise<void>;
  changed: () => void;
  setToast: (toast: ToastState | null) => void;
}) {
  const [busy, setBusy] = useState("");
  const apply = async (
    group: { category: Category; items: Product[] },
    available: boolean,
  ) => {
    if (group.category.id === "uncategorised") return;
    setBusy(group.category.id);
    try {
      await api.createAvailabilityRule(businessId, {
        target_type: "category",
        target_id: group.category.id,
        rule_type: "exception",
        name: `${group.category.name} category override`,
        is_available: available,
        status: "active",
        days: [],
        time_windows: [],
        starts_at: new Date().toISOString(),
        ends_at: null,
        location_ids: locationId ? [locationId] : [],
        reason: "Category override",
      });
      changed();
      await refresh();
      setToast({
        text: `${group.category.name} is ${available ? "available" : "unavailable"}.`,
      });
    } catch (cause) {
      setToast({
        text:
          cause instanceof Error
            ? cause.message
            : "Availability wasn’t changed.",
        status: "danger",
      });
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="mt-availability-category-list">
      {groups.map((group) => {
        const available = group.items.filter(
          (item) => states.get(item.id)?.available ?? item.is_available,
        ).length;
        return (
          <div key={group.category.id}>
            <span>
              <strong>{group.category.name}</strong>
              <small>
                {group.items.length} items ·{" "}
                {available === group.items.length
                  ? "Available now"
                  : available
                    ? "Mixed"
                    : "Unavailable"}
              </small>
            </span>
            <span>
              {
                group.items.filter(
                  (item) => states.get(item.id)?.source === "exception",
                ).length
              }{" "}
              item overrides
            </span>
            <Toggle
              label={available ? "Available" : "Unavailable"}
              checked={available === group.items.length}
              disabled={
                busy === group.category.id ||
                group.category.id === "uncategorised"
              }
            onChange={(event) => requestChange(() => apply(group, event.target.checked))}
            />
          </div>
        );
      })}
    </div>
  );
}

function SchedulesMode({
  businessId,
  rules,
  products,
  categories,
  combos,
  locations,
  locationId,
  refresh,
  changed,
  setToast,
}: RuleModeProps) {
  const schedules = rules.filter((rule) => rule.rule_type === "schedule");
  const [view, setView] = useState<"list" | "week">("list");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [deleteRule, setDeleteRule] = useState<AvailabilityRule | null>(null);
  const [busy, setBusy] = useState(false);
  const filtered = schedules.filter(
    (rule) =>
      !search ||
      `${rule.name || ""} ${rule.target_type}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
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
      setToast({
        text:
          cause instanceof Error ? cause.message : "Schedule wasn’t deleted.",
        status: "danger",
      });
    } finally {
      setBusy(false);
    }
  };
  const toggleRule = async (rule: AvailabilityRule) => {
    try {
      await api.updateAvailabilityRule(businessId, rule.id, {
        status: rule.status === "active" ? "paused" : "active",
      });
      changed();
      await refresh();
      setToast({
        text: `Schedule ${rule.status === "active" ? "paused" : "resumed"}.`,
      });
    } catch (cause) {
      setToast({
        text:
          cause instanceof Error ? cause.message : "Schedule wasn’t updated.",
        status: "danger",
      });
    }
  };
  const duplicateRule = async (rule: AvailabilityRule) => {
    try {
      await api.createAvailabilityRule(businessId, {
        target_type: rule.target_type,
        target_id: rule.target_id,
        rule_type: "schedule",
        name: `${rule.name || readable(rule.target_type)} copy`,
        is_available: rule.is_available,
        status: "paused",
        days: rule.days,
        time_windows: rule.time_windows,
        starts_at: rule.starts_at,
        ends_at: rule.ends_at,
        location_ids: rule.location_ids,
        reason: rule.reason,
      });
      changed();
      await refresh();
      setToast({ text: "Paused schedule copy created." });
    } catch (cause) {
      setToast({
        text:
          cause instanceof Error
            ? cause.message
            : "Schedule wasn’t duplicated.",
        status: "danger",
      });
    }
  };
  return (
    <div className="mt-availability-rules">
      <div className="mt-availability-rules__toolbar">
        <SearchInput
          label="Search schedules"
          placeholder="Search schedules…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mt-availability-view">
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            List
          </button>
          <button
            type="button"
            aria-pressed={view === "week"}
            onClick={() => setView("week")}
          >
            Week
          </button>
        </div>
        <Button onClick={() => setDraft(emptyRule("schedule", locationId))}>
          <Plus size={16} /> Create schedule
        </Button>
      </div>
      {filtered.length ? (
        view === "list" ? (
          <div className="mt-availability-rule-list">
            {filtered.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                locations={locations}
                onEdit={() => setDraft(ruleDraft(rule))}
                onDelete={() => setDeleteRule(rule)}
                onToggle={() => void toggleRule(rule)}
                onDuplicate={() => void duplicateRule(rule)}
              />
            ))}
          </div>
        ) : (
          <WeekView rules={filtered} />
        )
      ) : (
        <DataState
          kind="empty"
          title="No availability schedules"
          description="Everything is using default availability."
          action={
            <Button onClick={() => setDraft(emptyRule("schedule", locationId))}>
              Create schedule
            </Button>
          }
        />
      )}
      <RuleEditor
        open={Boolean(draft)}
        draft={draft}
        setDraft={setDraft}
        businessId={businessId}
        products={products}
        categories={categories}
        combos={combos}
        locations={locations}
        refresh={refresh}
        changed={changed}
        setToast={setToast}
      />
      <ConfirmationDialog
        open={Boolean(deleteRule)}
        onClose={() => setDeleteRule(null)}
        onConfirm={() => void remove()}
        title="Delete schedule?"
        description={`${deleteRule?.name || "This schedule"} will stop controlling availability.`}
        confirmLabel="Delete"
        destructive
        loading={busy}
      />
    </div>
  );
}

function ExceptionsMode({
  businessId,
  rules,
  products,
  categories,
  combos,
  locations,
  locationId,
  refresh,
  changed,
  setToast,
}: RuleModeProps) {
  const [filter, setFilter] = useState<"active" | "upcoming" | "past">(
    "active",
  );
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [busy, setBusy] = useState("");
  const [now] = useState(Date.now);
  const exceptions = rules.filter(
    (rule) =>
      rule.rule_type === "exception" &&
      (filter === "active"
        ? activeException(rule, now)
        : filter === "upcoming"
          ? upcomingException(rule, now)
          : Boolean(rule.ends_at) && new Date(rule.ends_at!).getTime() <= now),
  );
  const restore = async (rule: AvailabilityRule) => {
    setBusy(rule.id);
    try {
      await api.deleteAvailabilityRule(businessId, rule.id);
      changed();
      await refresh();
      setToast({ text: "Override removed." });
    } catch (cause) {
      setToast({
        text:
          cause instanceof Error ? cause.message : "Override wasn’t removed.",
        status: "danger",
      });
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="mt-availability-rules">
      <div className="mt-availability-rules__toolbar">
        <div className="mt-availability-view">
          {(["active", "upcoming", "past"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {readable(value)}
            </button>
          ))}
        </div>
        <Button onClick={() => setDraft(emptyRule("exception", locationId))}>
          <Plus size={16} /> Add exception
        </Button>
      </div>
      {exceptions.length ? (
        <div className="mt-availability-rule-list">
          {exceptions.map((rule) => (
            <div className="mt-availability-rule" key={rule.id}>
              <span>
                <strong>{rule.name || readable(rule.target_type)}</strong>
                <small>
                  {rule.is_available ? "Available" : "Unavailable"}{" "}
                  {rule.ends_at
                    ? `until ${formatMoment(rule.ends_at)}`
                    : "until manually restored"}
                </small>
              </span>
              <span>
                <b>{readable(rule.target_type)}</b>
                <small>
                  {rule.location_ids.length
                    ? `${rule.location_ids.length} locations`
                    : "All locations"}
                </small>
              </span>
              <StatusPill
                status={activeException(rule) ? "warning" : "neutral"}
              >
                {activeException(rule)
                  ? "Active"
                  : filter === "upcoming"
                    ? "Upcoming"
                    : "Past"}
              </StatusPill>
              {activeException(rule) && (
                <Button
                  variant="secondary"
                  loading={busy === rule.id}
                  onClick={() => void restore(rule)}
                >
                  <RotateCcw size={15} /> Restore now
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDraft(ruleDraft(rule))}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <DataState
          kind="empty"
          title={`No ${filter} exceptions`}
          description={
            filter === "active"
              ? "Scheduled availability is running normally."
              : "Nothing is scheduled to override normal availability."
          }
        />
      )}
      <RuleEditor
        open={Boolean(draft)}
        draft={draft}
        setDraft={setDraft}
        businessId={businessId}
        products={products}
        categories={categories}
        combos={combos}
        locations={locations}
        refresh={refresh}
        changed={changed}
        setToast={setToast}
      />
    </div>
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

function RuleRow({
  rule,
  locations,
  onEdit,
  onDelete,
  onToggle,
  onDuplicate,
}: {
  rule: AvailabilityRule;
  locations: BusinessLocation[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
}) {
  const locationNames = rule.location_ids
    .map((id) => locations.find((location) => location.id === id)?.name)
    .filter(Boolean);
  return (
    <div className="mt-availability-rule">
      <span>
        <strong>{rule.name || readable(rule.target_type)}</strong>
        <small>
          {readable(rule.target_type)} ·{" "}
          {rule.days.length === 7
            ? "Every day"
            : rule.days.map((day) => day.slice(0, 3)).join("–")}
        </small>
      </span>
      <span>
        <b>
          {rule.time_windows
            .map(
              (window) =>
                `${window.start.slice(0, 5)}–${window.end.slice(0, 5)}`,
            )
            .join(" · ")}
        </b>
        <small>
          {locationNames.length ? locationNames.join(", ") : "All locations"}
        </small>
      </span>
      <StatusPill status={rule.status === "active" ? "success" : "neutral"}>
        {readable(rule.status)}
      </StatusPill>
      <Button variant="secondary" onClick={onEdit}>
        Edit
      </Button>
      <details className="mt-availability-rule-menu">
        <summary aria-label={`More actions for ${rule.name || "schedule"}`}>
          <MoreHorizontal size={17} />
        </summary>
        <div>
          <button type="button" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" onClick={onToggle}>
            {rule.status === "active" ? "Pause" : "Resume"}
          </button>
          <button type="button" onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </details>
    </div>
  );
}

function WeekView({ rules }: { rules: AvailabilityRule[] }) {
  return (
    <div className="mt-availability-week">
      {DAYS.map((day) => (
        <section key={day}>
          <h3>{day.slice(0, 3)}</h3>
          {rules
            .filter((rule) => rule.days.includes(day))
            .map((rule) => (
              <div key={rule.id}>
                <strong>{rule.name || readable(rule.target_type)}</strong>
                <span>
                  {rule.time_windows
                    .map(
                      (window) =>
                        `${window.start.slice(0, 5)}–${window.end.slice(0, 5)}`,
                    )
                    .join(", ")}
                </span>
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}

function RuleEditor({
  open,
  draft,
  setDraft,
  businessId,
  products,
  categories,
  combos,
  locations,
  refresh,
  changed,
  setToast,
}: {
  open: boolean;
  draft: RuleDraft | null;
  setDraft: (draft: RuleDraft | null) => void;
  businessId: string;
  products: Product[];
  categories: Category[];
  combos: Combo[];
  locations: BusinessLocation[];
  refresh: () => Promise<void>;
  changed: () => void;
  setToast: (toast: ToastState | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!draft) return null;
  const targets =
    draft.targetType === "item"
      ? products
      : draft.targetType === "category"
        ? categories
        : draft.targetType === "combo"
          ? combos
          : draft.targetType === "location"
            ? locations
            : [];
  const update = (changes: Partial<RuleDraft>) =>
    setDraft({ ...draft, ...changes });
  const save = async () => {
    setError("");
    if (draft.targetType !== "menu" && !draft.targetIds.length) {
      setError("Select at least one target.");
      return;
    }
    if (
      draft.ruleType === "schedule" &&
      (!draft.days.length ||
        draft.windows.some(
          (window) =>
            !window.start || !window.end || window.start === window.end,
        ))
    ) {
      setError("Choose days and valid time windows.");
      return;
    }
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
        starts_at: draft.startsAt
          ? new Date(draft.startsAt).toISOString()
          : null,
        ends_at: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
        location_ids: draft.locations,
        reason: draft.reason || null,
      };
      if (draft.id)
        await api.updateAvailabilityRule(businessId, draft.id, payload);
      else
        await Promise.all(
          (draft.targetType === "menu" ? [""] : draft.targetIds).map(
            (targetId) =>
              api.createAvailabilityRule(businessId, {
                ...payload,
                target_id: draft.targetType === "menu" ? null : targetId,
              }),
          ),
        );
      changed();
      await refresh();
      setToast({
        text: `${draft.ruleType === "schedule" ? "Schedule" : "Exception"} saved.`,
      });
      setDraft(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Availability rule wasn’t saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailsDrawer
      open={open}
      onClose={() => setDraft(null)}
      title={
        draft.id
          ? `Edit ${readable(draft.ruleType)}`
          : draft.ruleType === "schedule"
            ? "Create schedule"
            : "Add exception"
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Save {draft.ruleType}
          </Button>
        </>
      }
    >
      <div className="mt-availability-editor">
        <Select
          label="Applies to"
          value={draft.targetType}
          onChange={(event) =>
            update({
              targetType: event.target.value as RuleDraft["targetType"],
              targetIds: [],
            })
          }
        >
          <option value="item">Items</option>
          <option value="category">Category</option>
          <option value="combo">Combo</option>
          {draft.ruleType === "exception" && (
            <option value="location">Location</option>
          )}
          {draft.ruleType === "exception" && (
            <option value="menu">Entire menu</option>
          )}
        </Select>
        {draft.targetType !== "menu" && (
          <label className="mt-field">
            <span className="mt-field__label">
              Target{!draft.id && draft.targetType === "item" ? "s" : ""}
            </span>
            <select
              className="mt-select"
              multiple={!draft.id && draft.targetType === "item"}
              value={draft.targetIds}
              onChange={(event) =>
                update({
                  targetIds: Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  ),
                })
              }
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Input
          label="Name"
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder={
            draft.ruleType === "schedule" ? "Breakfast" : "Temporary closure"
          }
        />
        <Toggle
          label={draft.available ? "Available" : "Unavailable"}
          checked={draft.available}
          onChange={(event) => update({ available: event.target.checked })}
        />
        {draft.ruleType === "schedule" ? (
          <>
            <fieldset className="mt-availability-days">
              <legend>Days</legend>
              {DAYS.map((day) => (
                <button
                  type="button"
                  key={day}
                  aria-pressed={draft.days.includes(day)}
                  aria-label={readable(day)}
                  onClick={() =>
                    update({
                      days: draft.days.includes(day)
                        ? draft.days.filter((value) => value !== day)
                        : [...draft.days, day],
                    })
                  }
                >
                  {day.slice(0, 1).toUpperCase()}
                </button>
              ))}
            </fieldset>
            <div className="mt-availability-windows">
              <span className="mt-field__label">Time windows</span>
              {draft.windows.map((window, index) => (
                <div key={index}>
                  <input
                    aria-label={`Window ${index + 1} start`}
                    type="time"
                    value={window.start}
                    onChange={(event) =>
                      update({
                        windows: draft.windows.map((entry, entryIndex) =>
                          entryIndex === index
                            ? { ...entry, start: event.target.value }
                            : entry,
                        ),
                      })
                    }
                  />
                  <span>–</span>
                  <input
                    aria-label={`Window ${index + 1} end`}
                    type="time"
                    value={window.end}
                    onChange={(event) =>
                      update({
                        windows: draft.windows.map((entry, entryIndex) =>
                          entryIndex === index
                            ? { ...entry, end: event.target.value }
                            : entry,
                        ),
                      })
                    }
                  />
                  {draft.windows.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove window ${index + 1}`}
                      onClick={() =>
                        update({
                          windows: draft.windows.filter(
                            (_, entryIndex) => entryIndex !== index,
                          ),
                        })
                      }
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
              <Button
                variant="tertiary"
                onClick={() =>
                  update({
                    windows: [...draft.windows, { start: "", end: "" }],
                  })
                }
              >
                + Add time window
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-availability-presets">
            <span className="mt-field__label">Quick presets</span>
            <button
              type="button"
              onClick={() =>
                update({
                  startsAt: localDateTime(new Date()),
                  endsAt: localDateTime(new Date(Date.now() + 30 * 60000)),
                  available: false,
                })
              }
            >
              30 minutes
            </button>
            <button
              type="button"
              onClick={() =>
                update({
                  startsAt: localDateTime(new Date()),
                  endsAt: localDateTime(new Date(Date.now() + 60 * 60000)),
                  available: false,
                })
              }
            >
              1 hour
            </button>
            <button
              type="button"
              onClick={() => {
                const end = new Date();
                end.setHours(23, 59, 0, 0);
                update({
                  startsAt: localDateTime(new Date()),
                  endsAt: localDateTime(end),
                  available: false,
                });
              }}
            >
              End of day
            </button>
          </div>
        )}
        <div className="mt-availability-date-grid">
          <Input
            label="Starts"
            type="datetime-local"
            value={draft.startsAt}
            onChange={(event) => update({ startsAt: event.target.value })}
          />
          <Input
            label="Ends"
            type="datetime-local"
            value={draft.endsAt}
            min={draft.startsAt}
            onChange={(event) => update({ endsAt: event.target.value })}
          />
        </div>
        {locations.length > 0 && (
          <label className="mt-field">
            <span className="mt-field__label">Locations</span>
            <select
              className="mt-select"
              multiple
              value={draft.locations}
              onChange={(event) =>
                update({
                  locations: Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  ),
                })
              }
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <small className="mt-field__message">
              No selection applies to all locations.
            </small>
          </label>
        )}
        <Input
          label="Reason (optional)"
          value={draft.reason}
          onChange={(event) => update({ reason: event.target.value })}
        />
        {error && <DataState kind="recoverable-error" title={error} />}
      </div>
    </DetailsDrawer>
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
    windows: (rule.time_windows || []).map((window) => ({
      start: window.start.slice(0, 5),
      end: window.end.slice(0, 5),
    })),
    startsAt: rule.starts_at ? localDateTime(new Date(rule.starts_at)) : "",
    endsAt: rule.ends_at ? localDateTime(new Date(rule.ends_at)) : "",
    locations: rule.location_ids || [],
    reason: rule.reason || "",
  };
}

export function AvailabilitySkeleton() {
  return (
    <div
      className="mt-availability-skeleton"
      role="status"
      aria-label="Loading availability"
    >
      <span />
      <div />
      <div />
      <div />
      <div />
      <div />
    </div>
  );
}
