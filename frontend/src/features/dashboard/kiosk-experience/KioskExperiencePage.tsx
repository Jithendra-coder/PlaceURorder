"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent } from "react";
import QRCode from "qrcode";
import Image from "next/image";
import { AlertTriangle, Archive, CalendarClock, Copy, Eye, Gift, History, Layers3, MoreHorizontal, Pause, Pencil, Percent, Play, Star, Tag, X } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { DateTimeInput } from "@astryxdesign/core/DateTimeInput";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Grid } from "@astryxdesign/core/Grid";
import { Selector } from "@astryxdesign/core/Selector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ConfirmDialog, DashboardPage, DetailDrawer, EmptyBlock, LoadingBlock, NoticeBanner, PageHeader, Panel, StatusBadge, Toolbar, type Tone, useLiveRefresh } from "@/components/dashboard/kit";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { ManageMenuPage, ManageMenuSkeleton } from "@/features/dashboard/kiosk-experience/ManageMenuPage";
import { KioskScreensPage, KioskScreensSkeleton } from "@/features/dashboard/kiosk-experience/KioskScreensPage";
import { WelcomeScreenPage, WelcomeScreenSkeleton } from "@/features/dashboard/kiosk-experience/WelcomeScreenPage";
import { BrandingThemePage, BrandingThemeSkeleton } from "@/features/dashboard/kiosk-experience/BrandingThemePage";
import { PreviewKioskPage, PreviewKioskSkeleton } from "@/features/dashboard/kiosk-experience/PreviewKioskPage";
import { TestPublishPage, TestPublishSkeleton } from "@/features/dashboard/kiosk-experience/TestPublishPage";
import { AvailabilityPage, AvailabilitySkeleton } from "@/features/dashboard/kiosk-experience/AvailabilityPage";
import { api as dataApi, type PromotionRecord, type QrCodeRecord } from "@/lib/api";
import { RealKioskFrame } from "@/app/admin/_components/real-kiosk-frame";
import type { BusinessLocation, Category, Combo, OwnerStoreOrdering, Product, KioskSetupOverview } from "@/lib/types";
import type { Business } from "@/services/api";

type Mode = "menu" | "availability" | "promotions" | "screens" | "welcome" | "branding" | "qr" | "preview" | "publish";

export function KioskExperiencePage({ mode, initialTestOpen = false }: { mode: Mode; initialTestOpen?: boolean }) {
  const { business, loading: businessLoading, refresh } = useBusiness();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [setup, setSetup] = useState<KioskSetupOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadedBusiness = useRef("");
  const load = useCallback(async () => {
    if (!business) return;
    if (loadedBusiness.current !== business.id) setLoading(true);
    setError("");
    try {
      if (mode === "screens") {
        const [productResult, categoryResult, comboResult, setupResult] = await Promise.allSettled([
          dataApi.products(business.id, true), dataApi.categories(business.id), dataApi.combos(business.id), dataApi.kioskSetup(business.id),
        ]);
        if (productResult.status === "fulfilled") setProducts(productResult.value.products);
        if (categoryResult.status === "fulfilled") setCategories(categoryResult.value.categories);
        if (comboResult.status === "fulfilled") setCombos(comboResult.value.combos);
        if (setupResult.status === "fulfilled") setSetup(setupResult.value);
        return;
      }
      const [productResult, categoryResult, comboResult, setupResult] = await Promise.all([
        dataApi.products(business.id, true), dataApi.categories(business.id), dataApi.combos(business.id), dataApi.kioskSetup(business.id),
      ]);
      setProducts(productResult.products);
      setCategories(categoryResult.categories);
      setCombos(comboResult.combos);
      setSetup(setupResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load kiosk experience data.");
    } finally {
      loadedBusiness.current = business.id;
      setLoading(false);
    }
  }, [business, mode]);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  if (businessLoading || loading) {
    return <DashboardPage>{mode === "menu" ? <ManageMenuSkeleton /> : mode === "availability" ? <AvailabilitySkeleton /> : mode === "screens" ? <KioskScreensSkeleton /> : mode === "welcome" ? <WelcomeScreenSkeleton /> : mode === "branding" ? <BrandingThemeSkeleton /> : mode === "preview" ? <PreviewKioskSkeleton /> : mode === "publish" ? <TestPublishSkeleton /> : <LoadingBlock rows={4} />}</DashboardPage>;
  }
  if (error) {
    return <DashboardPage><NoticeBanner role="alert" tone="danger" title={mode === "menu" ? "Could not load Manage Menu." : "Could not load this section."} description="The server could not complete this request." action={<Button label="Try again now" variant="secondary" onClick={() => void load()} />} /></DashboardPage>;
  }
  if (!business) {
    return <DashboardPage><NoticeBanner tone="warning" title="No business selected" description="Finish business setup before configuring a kiosk." /></DashboardPage>;
  }
  return <ModeContent mode={mode} business={business} products={products} categories={categories} combos={combos} setup={setup} reload={load} refreshBusiness={refresh} initialTestOpen={initialTestOpen} />;
}

function ModeContent({ mode, business, products, categories, combos, setup, reload, refreshBusiness, initialTestOpen }: { mode: Mode; business: Business; products: Product[]; categories: Category[]; combos: Combo[]; setup: KioskSetupOverview | null; reload: () => Promise<void>; refreshBusiness: () => Promise<Business | null>; initialTestOpen: boolean }) {
  if (mode === "menu") return <ManageMenuPage business={business} products={products} categories={categories} combos={combos} setup={setup} reload={reload} />;
  if (mode === "availability") return <AvailabilityPage business={business} products={products} categories={categories} combos={combos} setup={setup} />;
  if (mode === "screens") return <KioskScreensPage business={business} products={products} categories={categories} setup={setup} refresh={refreshBusiness} />;
  if (mode === "welcome") return <WelcomeScreenPage business={business} products={products} categories={categories} setup={setup} refresh={refreshBusiness} />;
  if (mode === "branding") return <BrandingThemePage business={business} products={products} categories={categories} setup={setup} refresh={refreshBusiness} />;
  if (mode === "preview") return <PreviewKioskPage business={business} products={products} categories={categories} setup={setup} />;
  if (mode === "publish") return <TestPublishPage business={business} products={products} categories={categories} setup={setup} reload={reload} initialTestOpen={initialTestOpen} />;
  if (mode === "qr") return <QrSection business={business} products={products} categories={categories} combos={combos} />;
  return <PromotionsSection business={business} products={products} categories={categories} combos={combos} setup={setup} />;
}

type PromotionType = "item_discount" | "category_discount" | "order_offer" | "featured_item" | "badge" | "bogo";
type PromotionFilter = "all" | "active" | "scheduled" | "draft" | "paused" | "ended" | "attention";
type PromotionDraft = { type: PromotionType; name: string; discountType: "percentage" | "fixed" | "label"; value: string; targetType: "product" | "category" | "combo"; targetIds: string[]; locationIds: string[]; startsAt: string; endsAt: string; placements: string[]; badge: string; description: string };
type Feedback = { text: string; tone: Tone };
type ISODateTime = NonNullable<ComponentProps<typeof DateTimeInput>["value"]>;

const promotionTypeMeta: Record<PromotionType, { label: string; icon: typeof Percent; supported: boolean; discountType: "percentage" | "fixed" | "label" }> = {
  item_discount: { label: "Item discount", icon: Percent, supported: true, discountType: "percentage" },
  category_discount: { label: "Category discount", icon: Layers3, supported: true, discountType: "percentage" },
  order_offer: { label: "Order offer", icon: Tag, supported: true, discountType: "fixed" },
  featured_item: { label: "Featured item", icon: Star, supported: true, discountType: "label" },
  badge: { label: "Badge", icon: Tag, supported: true, discountType: "label" },
  bogo: { label: "Buy X get Y", icon: Gift, supported: false, discountType: "label" },
};
const statusFilters: PromotionFilter[] = ["all", "active", "scheduled", "draft", "paused", "ended", "attention"];
const groupOrder: Array<Exclude<PromotionFilter, "all">> = ["active", "scheduled", "draft", "paused", "ended", "attention"];

function emptyPromotionDraft(type: PromotionType = "item_discount"): PromotionDraft {
  return { type, name: "", discountType: promotionTypeMeta[type].discountType, value: type === "featured_item" ? "Featured" : "20", targetType: type === "category_discount" ? "category" : "product", targetIds: [], locationIds: [], startsAt: "", endsAt: "", placements: [], badge: type === "badge" ? "Bestseller" : "", description: "" };
}

export function promotionStatus(row: PromotionRecord, now = Date.now()): PromotionFilter {
  if (["needs_attention", "attention"].includes(row.status)) return "attention";
  if (row.status === "paused") return "paused";
  if (row.status === "expired" || (row.ends_at && new Date(row.ends_at).getTime() < now)) return "ended";
  if (row.status === "scheduled" || (row.starts_at && new Date(row.starts_at).getTime() > now)) return "scheduled";
  if (row.status === "active") return "active";
  return "draft";
}

export function filterPromotions(rows: PromotionRecord[], search: string, filter: PromotionFilter, now = Date.now()) {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => (!query || `${row.name} ${row.description || ""}`.toLowerCase().includes(query)) && (filter === "all" || promotionStatus(row, now) === filter));
}

function promotionType(row: PromotionRecord): Exclude<PromotionType, "bogo"> {
  if (row.discount_type === "label") return row.name.toLowerCase().includes("featured") ? "featured_item" : "badge";
  if (row.targets?.[0]?.target_type === "category") return "category_discount";
  if (row.discount_type === "fixed") return "order_offer";
  return "item_discount";
}

function PromotionsSection({ business, products, categories, combos, setup }: { business: Business; products: Product[]; categories: Category[]; combos: Combo[]; setup: KioskSetupOverview | null }) {
  const [rows, setRows] = useState<PromotionRecord[]>([]);
  const [locations, setLocations] = useState<BusinessLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PromotionFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [view, setView] = useState<"cards" | "list">("cards");
  const [editor, setEditor] = useState<PromotionDraft | null>(null);
  const [editing, setEditing] = useState<PromotionRecord | null>(null);
  const [preview, setPreview] = useState<PromotionRecord | null>(null);
  const [activity, setActivity] = useState<PromotionRecord | null>(null);
  const [confirm, setConfirm] = useState<{ row: PromotionRecord; action: "end" | "archive" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const promotionResult = await dataApi.promotions(business.id);
      if (!Array.isArray(promotionResult.promotions)) throw new Error("Invalid promotions response.");
      setRows(promotionResult.promotions);
      try {
        const locationResult = await dataApi.administrationLocations(business.id);
        setLocations(Array.isArray(locationResult.locations) ? locationResult.locations : []);
      } catch {
        setLocations([]);
      }
    } catch {
      setError("We couldn’t retrieve your saved promotions.");
    } finally {
      setLoading(false);
    }
  }, [business.id]);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const selectedType = typeFilter === "percentage" ? "item_discount" : typeFilter === "fixed" ? "order_offer" : typeFilter === "featured" ? "label" : typeFilter;
  const filtered = useMemo(() => filterPromotions(rows, search, filter)
    .filter((row) => filter !== "all" || ["active", "scheduled", "draft"].includes(promotionStatus(row)))
    .filter((row) => selectedType === "all" || (selectedType === "label" ? row.discount_type === "label" : promotionType(row) === selectedType))
    .filter((row) => locationFilter === "all" || row.location_ids?.includes(locationFilter)), [rows, search, filter, selectedType, locationFilter]);
  const counts = useMemo(() => statusFilters.reduce((result, key) => {
    result[key] = key === "all" ? rows.length : rows.filter((row) => promotionStatus(row) === key).length;
    return result;
  }, {} as Record<PromotionFilter, number>), [rows]);
  const targetName = (row: PromotionRecord) => {
    const target = row.targets?.[0];
    if (!target) return "All eligible orders";
    const list = target.target_type === "category" ? categories : target.target_type === "combo" ? combos : products;
    return list.find((item) => item.id === target.target_id)?.name || "Target needs attention";
  };
  const locationsLabel = (row: PromotionRecord) => row.location_ids?.length ? `${row.location_ids.length} location${row.location_ids.length === 1 ? "" : "s"}` : locations.length ? "All locations" : "Business-wide";
  const clearFilters = () => { setSearch(""); setFilter("all"); setTypeFilter("all"); setLocationFilter("all"); };
  const startCreate = () => { setEditing(null); setEditor(emptyPromotionDraft()); };

  const save = async (event: FormEvent<HTMLFormElement>, status: "draft" | "active") => {
    event.preventDefault();
    if (!editor || editor.type === "bogo") return;
    const targetIds = editor.targetIds;
    if (!editor.name.trim() || (editor.type !== "order_offer" && !targetIds.length)) {
      setFeedback({ text: "Choose a name and eligible target before saving.", tone: "warning" });
      return;
    }
    if (editor.endsAt && editor.startsAt && new Date(editor.endsAt) <= new Date(editor.startsAt)) {
      setFeedback({ text: "End date must be after start date.", tone: "warning" });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const payload = {
      name: editor.name.trim(), description: editor.description.trim() || null, discount_type: editor.discountType,
      discount_value: editor.discountType === "label" ? 0 : Number(editor.value || 0), status, target_type: editor.targetType, target_ids: targetIds,
      location_ids: editor.locationIds, starts_at: editor.startsAt ? new Date(editor.startsAt).toISOString() : null, ends_at: editor.endsAt ? new Date(editor.endsAt).toISOString() : null, placements: editor.placements,
    };
    try {
      if (editing) await dataApi.updatePromotion(business.id, editing.id, payload);
      else await dataApi.createPromotion(business.id, payload);
      setEditor(null);
      setEditing(null);
      await load();
      setFeedback({ text: status === "draft" ? "Draft saved." : "Promotion saved.", tone: "success" });
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? (cause.message || "Couldn’t save promotion.") : "Couldn’t save promotion.", tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = async (row: PromotionRecord, nextStatus: "paused" | "active" | "scheduled") => {
    setBusy(true);
    try {
      await dataApi.updatePromotion(business.id, row.id, { status: nextStatus });
      await load();
      setFeedback({ text: nextStatus === "paused" ? "Promotion paused." : "Promotion resumed.", tone: "success" });
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? cause.message : "Couldn’t update promotion.", tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const endOrArchive = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.action === "end") await dataApi.updatePromotion(business.id, confirm.row.id, { status: "expired", ends_at: new Date().toISOString() });
      else await dataApi.deletePromotion(business.id, confirm.row.id);
      setConfirm(null);
      await load();
      setFeedback({ text: confirm.action === "end" ? "Promotion ended." : "Promotion archived.", tone: "success" });
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? cause.message : "Couldn’t complete that action.", tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const duplicate = (row: PromotionRecord) => {
    const target = row.targets?.[0];
    setEditing(null);
    setEditor({ ...emptyPromotionDraft(target?.target_type === "category" ? "category_discount" : "item_discount"), name: `${row.name} copy`, discountType: row.discount_type as PromotionDraft["discountType"], value: String(row.discount_value || "20"), targetType: (target?.target_type as PromotionDraft["targetType"]) || "product", targetIds: row.targets?.map((item) => item.target_id) || [], locationIds: row.location_ids || [], startsAt: "", endsAt: "", placements: row.placements || [] });
  };
  const openEdit = (row: PromotionRecord) => {
    const target = row.targets?.[0];
    const type: PromotionType = row.discount_type === "label" ? (row.name.toLowerCase().includes("featured") ? "featured_item" : "badge") : target?.target_type === "category" ? "category_discount" : "item_discount";
    setEditing(row);
    setEditor({ ...emptyPromotionDraft(type), name: row.name, description: row.description || "", discountType: row.discount_type as PromotionDraft["discountType"], value: String(row.discount_value || 0), targetType: (target?.target_type as PromotionDraft["targetType"]) || "product", targetIds: row.targets?.map((item) => item.target_id) || [], locationIds: row.location_ids || [], startsAt: row.starts_at ? row.starts_at.slice(0, 16) : "", endsAt: row.ends_at ? row.ends_at.slice(0, 16) : "", placements: row.placements || [] });
  };
  const openPreview = () => {
    const first = rows[0];
    if (first) setPreview(first);
    else setFeedback({ text: "No saved promotions to preview yet.", tone: "warning" });
  };

  const header = (
    <PageHeader
      eyebrow="Kiosk & Menu"
      title="Promotions"
      description={error ? undefined : `${counts.active} active · ${counts.scheduled} scheduled`}
      actions={<><Button label="Preview promotions" variant="secondary" onClick={openPreview} /><Button label="Create promotion" variant="primary" onClick={startCreate} /></>}
    >
      {(setup?.unpublishedChanges || 0) > 0 && <NoticeBanner tone="warning" title={`${setup?.unpublishedChanges} unpublished promotion changes`} action={<Button label="Review in Test & Publish" variant="ghost" href="/dashboard/kiosk-experience/publish" />} />}
    </PageHeader>
  );

  if (loading) return <DashboardPage>{header}<LoadingBlock rows={4} /></DashboardPage>;
  if (error) return <DashboardPage>{header}<NoticeBanner tone="danger" title="Couldn’t load promotions." description={error} action={<Button label="Retry" variant="secondary" onClick={() => void load()} />} /></DashboardPage>;

  return (
    <DashboardPage>
      {header}
      {feedback && <NoticeBanner tone={feedback.tone} title={feedback.text} action={<Button label="Dismiss" variant="ghost" onClick={() => setFeedback(null)} />} />}
      <SegmentedControl value={filter} onChange={(value) => setFilter(value as PromotionFilter)} label="Promotion status">
        {statusFilters.map((key) => <SegmentedControlItem key={key} value={key} label={`${key[0].toUpperCase()}${key.slice(1)} ${counts[key]}`} />)}
      </SegmentedControl>
      <Toolbar>
        <TextInput type="search" label="Search promotions" placeholder="Search promotions…" value={search} onChange={setSearch} />
        <Selector label="Type" value={typeFilter} onChange={setTypeFilter} options={[{ value: "all", label: "All types" }, { value: "percentage", label: "Discounts" }, { value: "fixed", label: "Order offers" }, { value: "featured", label: "Featured & badges" }]} />
        <Selector label="Location" value={locationFilter} onChange={setLocationFilter} options={[{ value: "all", label: "All locations" }, ...locations.map((location) => ({ value: location.id, label: location.name }))]} />
        <SegmentedControl value={view} onChange={(value) => setView(value as "cards" | "list")} label="Promotion view">
          <SegmentedControlItem value="cards" label="Cards" />
          <SegmentedControlItem value="list" label="List" />
        </SegmentedControl>
        {(search || filter !== "all" || typeFilter !== "all" || locationFilter !== "all") && <Button label="Clear filters" variant="ghost" onClick={clearFilters} />}
      </Toolbar>
      {!rows.length ? (
        <EmptyBlock title="No promotions yet" description="Create an offer or highlight an item." action={<Button label="Create promotion" variant="primary" onClick={startCreate} />} />
      ) : !filtered.length ? (
        <EmptyBlock title={filter === "all" ? "No matching promotions" : filter === "active" ? "No active promotions" : `No ${filter} promotions`} description={filter === "active" && counts.scheduled ? `${counts.scheduled} promotion${counts.scheduled === 1 ? " is" : "s are"} scheduled to start later.` : "Try another search or clear filters."} action={<Button label="Clear filters" variant="secondary" onClick={clearFilters} />} />
      ) : (
        <VStack gap={6}>
          {groupOrder.map((group) => {
            const groupRows = filtered.filter((row) => promotionStatus(row) === group);
            if (!groupRows.length) return null;
            return (
              <Panel key={group} title={group === "attention" ? "Needs attention" : `${group[0].toUpperCase()}${group.slice(1)}`} actions={<StatusBadge tone="neutral">{String(groupRows.length)}</StatusBadge>}>
                {view === "cards" ? (
                  <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4}>
                    {groupRows.map((row) => <PromotionCard key={row.id} row={row} target={targetName(row)} locations={locationsLabel(row)} onEdit={() => openEdit(row)} onDuplicate={() => duplicate(row)} onPreview={() => setPreview(row)} onActivity={() => setActivity(row)} onPause={() => void changeStatus(row, "paused")} onResume={() => void changeStatus(row, row.starts_at && new Date(row.starts_at) > new Date() ? "scheduled" : "active")} onEnd={() => setConfirm({ row, action: "end" })} onArchive={() => setConfirm({ row, action: "archive" })} busy={busy} />)}
                  </Grid>
                ) : (
                  <VStack gap={3}>
                    {groupRows.map((row) => <PromotionListRow key={row.id} row={row} target={targetName(row)} locations={locationsLabel(row)} onEdit={() => openEdit(row)} />)}
                  </VStack>
                )}
              </Panel>
            );
          })}
        </VStack>
      )}
      {editor && <PromotionEditor key={editing?.id || "new"} products={products} categories={categories} combos={combos} locations={locations} editor={editor} editing={editing} busy={busy} onClose={() => { setEditor(null); setEditing(null); }} onChange={setEditor} onSubmit={save} />}
      <DetailDrawer title="Promotion preview" isOpen={Boolean(preview)} onClose={() => setPreview(null)} width={520} footer={<Button label="Close" variant="secondary" onClick={() => setPreview(null)} />}>
        {preview && (
          <VStack gap={3}>
            <RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={preview.id.length} />
            <Text type="supporting" color="secondary">Preview uses the saved kiosk draft and does not publish changes.</Text>
          </VStack>
        )}
      </DetailDrawer>
      <DetailDrawer title="Promotion activity" isOpen={Boolean(activity)} onClose={() => setActivity(null)} footer={<Button label="Close" variant="secondary" onClick={() => setActivity(null)} />}>
        {activity && <NoticeBanner tone="info" title="Activity log is available after save" description={`${activity.name} · ${promotionStatus(activity)} · ${locationsLabel(activity)}. Detailed audit events use the existing Activity Log.`} />}
      </DetailDrawer>
      <ConfirmDialog isOpen={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={() => void endOrArchive()} title={confirm?.action === "end" ? "End promotion now?" : "Archive promotion?"} description={confirm?.action === "end" ? `${confirm.row.name} will stop applying to customer orders.` : "The promotion will leave the normal list. Historical records remain available."} confirmLabel={confirm?.action === "end" ? "End promotion" : "Archive"} loading={busy} />
    </DashboardPage>
  );
}

function PromotionCard({ row, target, locations, onEdit, onDuplicate, onPreview, onActivity, onPause, onResume, onEnd, onArchive, busy }: { row: PromotionRecord; target: string; locations: string; onEdit: () => void; onDuplicate: () => void; onPreview: () => void; onActivity: () => void; onPause: () => void; onResume: () => void; onEnd: () => void; onArchive: () => void; busy: boolean }) {
  const state = promotionStatus(row);
  const tone: Tone = state === "attention" ? "danger" : state === "paused" ? "warning" : state === "active" ? "success" : state === "scheduled" ? "info" : "neutral";
  const benefit = row.discount_type === "percentage" ? `${row.discount_value}% off` : row.discount_type === "fixed" ? `₹${row.discount_value} off` : row.name;
  const Icon = row.discount_type === "percentage" ? Percent : row.discount_type === "fixed" ? Tag : Star;
  const menu = [
    { label: "Edit", icon: <Pencil size={14} />, onClick: onEdit },
    { label: "Duplicate", icon: <Copy size={14} />, onClick: onDuplicate },
    { label: "Preview", icon: <Eye size={14} />, onClick: onPreview },
    { label: "Activity", icon: <History size={14} />, onClick: onActivity },
    ...(state === "active" ? [{ label: "Pause", icon: <Pause size={14} />, onClick: onPause, isDisabled: busy }, { label: "End", icon: <X size={14} />, onClick: onEnd, variant: "destructive" as const }] : []),
    ...(state === "paused" ? [{ label: "Resume", icon: <Play size={14} />, onClick: onResume, isDisabled: busy }] : []),
    ...(state === "draft" ? [{ label: "Archive", icon: <Archive size={14} />, onClick: onArchive, variant: "destructive" as const }] : []),
  ];
  return (
    <ClickableCard label={`Edit ${row.name}`} onClick={onEdit} padding={4}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="start" hAlign="between">
          <HStack gap={2} vAlign="center">
            <Icon size={16} aria-hidden="true" />
            <VStack gap={0}>
              <Text type="body" weight="semibold">{row.name}</Text>
              <Text type="supporting" color="secondary">{target}</Text>
            </VStack>
          </HStack>
          <HStack gap={1} vAlign="center">
            <StatusBadge tone={tone}>{state === "ended" ? "Ended" : state === "attention" ? "Needs attention" : `${state[0].toUpperCase()}${state.slice(1)}`}</StatusBadge>
            <DropdownMenu button={{ label: `Actions for ${row.name}`, variant: "ghost", size: "sm", icon: <MoreHorizontal size={17} aria-hidden="true" /> }} items={menu} placement="below" alignment="end" />
          </HStack>
        </HStack>
        <Text type="label">{state === "attention" ? <><AlertTriangle size={14} aria-hidden="true" /> {row.description || "Review target or location configuration."}</> : benefit}</Text>
        <HStack gap={2} vAlign="center" hAlign="between">
          <HStack gap={1} vAlign="center"><CalendarClock size={14} aria-hidden="true" /><Text type="supporting" color="secondary">{formatPromotionWindow(row)}</Text></HStack>
          <Text type="supporting" color="secondary">{locations}</Text>
        </HStack>
      </VStack>
    </ClickableCard>
  );
}

function PromotionListRow({ row, target, locations, onEdit }: { row: PromotionRecord; target: string; locations: string; onEdit: () => void }) {
  const state = promotionStatus(row);
  return (
    <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
      <VStack gap={0}>
        <Text type="body" weight="semibold">{row.name}</Text>
        <Text type="supporting" color="secondary">{target} · {locations} · {formatPromotionWindow(row)}</Text>
      </VStack>
      <HStack gap={2} vAlign="center">
        <StatusBadge tone={state === "active" ? "success" : state === "attention" ? "danger" : "neutral"}>{state}</StatusBadge>
        <Button label={`Edit ${row.name}`} variant="ghost" size="sm" onClick={onEdit} />
      </HStack>
    </HStack>
  );
}

function formatPromotionWindow(row: PromotionRecord) {
  if (row.starts_at && new Date(row.starts_at) > new Date()) return `Starts ${new Date(row.starts_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })}`;
  if (row.ends_at) return `Until ${new Date(row.ends_at).toLocaleString(undefined, { hour: "numeric" })}`;
  return "Runs until changed";
}

function PromotionEditor({ products, categories, combos, locations, editor, editing, busy, onClose, onChange, onSubmit }: { products: Product[]; categories: Category[]; combos: Combo[]; locations: BusinessLocation[]; editor: PromotionDraft; editing: PromotionRecord | null; busy: boolean; onClose: () => void; onChange: (draft: PromotionDraft | null) => void; onSubmit: (event: FormEvent<HTMLFormElement>, status: "draft" | "active") => void }) {
  const [step, setStep] = useState<"type" | "form">(editing ? "form" : "type");
  const targetOptions = editor.targetType === "category" ? categories : editor.targetType === "combo" ? combos : products;
  const update = (patch: Partial<PromotionDraft>) => onChange({ ...editor, ...patch });
  const togglePlacement = (placement: string, checked: boolean) => update({ placements: checked ? [...editor.placements, placement] : editor.placements.filter((item) => item !== placement) });

  return (
    <DetailDrawer title={editing ? "Edit promotion" : "Create promotion"} isOpen onClose={onClose} width={560} footer={step === "form" ? <><Button label="Cancel" variant="secondary" onClick={onClose} /><Button label="Save draft" variant="secondary" type="submit" form="promotion-editor-form" name="status" value="draft" isLoading={busy} /><Button label="Save promotion" variant="primary" type="submit" form="promotion-editor-form" name="status" value="active" isLoading={busy} /></> : undefined}>
      {step === "type" ? (
        <Grid columns={{ minWidth: 200, repeat: "fit" }} gap={3}>
          {(Object.keys(promotionTypeMeta) as PromotionType[]).map((type) => {
            const item = promotionTypeMeta[type];
            const Icon = item.icon;
            return (
              <Button key={type} label={item.label} variant="secondary" width="100%" icon={<Icon size={18} aria-hidden="true" />} isDisabled={!item.supported} tooltip={item.supported ? undefined : "Not supported by checkout"} onClick={() => { onChange({ ...emptyPromotionDraft(type), name: editor.name }); setStep("form"); }} />
            );
          })}
        </Grid>
      ) : (
        <form id="promotion-editor-form" onSubmit={(event) => { const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; onSubmit(event, submitter?.value === "active" ? "active" : "draft"); }}>
          <VStack gap={4}>
            {!editing && <Button label="Change promotion type" variant="ghost" onClick={() => setStep("type")} />}
            <TextInput label="Promotion name" isRequired value={editor.name} onChange={(value) => update({ name: value })} />
            <Selector label="Target type" value={editor.targetType} onChange={(value) => update({ targetType: value as PromotionDraft["targetType"], targetIds: [] })} options={[{ value: "product", label: "Items" }, { value: "category", label: "Categories" }, { value: "combo", label: "Combos" }]} />
            {editor.type !== "order_offer" && (
              targetOptions.length ? (
                <CheckboxList label={editor.targetType === "category" ? "Select categories" : editor.targetType === "combo" ? "Select combos" : "Select items"} value={editor.targetIds} onChange={(values) => update({ targetIds: values })}>
                  {targetOptions.map((item) => <CheckboxListItem key={item.id} value={item.id} label={item.name} />)}
                </CheckboxList>
              ) : <EmptyBlock title="No menu items available" description="Add menu items before creating this promotion." action={<Button label="Go to Manage Menu" variant="secondary" href="/dashboard/kiosk-experience/menu" />} />
            )}
            {editor.type === "order_offer" && <Text type="supporting" color="secondary">Applies to qualifying orders. Minimum subtotal and stacking rules are not returned by the current backend contract.</Text>}
            {editor.discountType !== "label" && <TextInput label={editor.discountType === "percentage" ? "Discount percentage" : "Discount amount (₹)"} inputMode="decimal" isRequired value={editor.value} onChange={(value) => update({ value })} />}
            {editor.discountType === "label" && <TextInput label="Badge label" isRequired value={editor.badge || editor.value} onChange={(value) => update({ badge: value, value })} />}
            {editor.type !== "featured_item" && <TextInput label="Internal note (optional)" value={editor.description} onChange={(value) => update({ description: value })} />}
            <CheckboxList label="Locations" description={editor.locationIds.length ? `${editor.locationIds.length} selected` : "Business-wide scope when none are selected."} value={editor.locationIds} onChange={(values) => update({ locationIds: values })}>
              {locations.map((location) => <CheckboxListItem key={location.id} value={location.id} label={location.name} />)}
            </CheckboxList>
            {!locations.length && <NoticeBanner tone="info" title="No locations available" description="Business-wide scope will be used." />}
            <Grid columns={{ minWidth: 220, repeat: "fit" }} gap={4}>
              <DateTimeInput label="Starts" value={(editor.startsAt || undefined) as ISODateTime | undefined} onChange={(value) => update({ startsAt: value ?? "" })} />
              <DateTimeInput label="Ends" value={(editor.endsAt || undefined) as ISODateTime | undefined} onChange={(value) => update({ endsAt: value ?? "" })} />
            </Grid>
            <VStack gap={3}>
              <Text type="label">Presentation</Text>
              <Switch label="Deals category" value={editor.placements.includes("deals_category")} onChange={(checked) => togglePlacement("deals_category", checked)} />
              <Switch label="Welcome screen" value={editor.placements.includes("welcome_screen")} onChange={(checked) => togglePlacement("welcome_screen", checked)} />
              <Switch label="Kiosk banner" value={editor.placements.includes("kiosk_banner")} onChange={(checked) => togglePlacement("kiosk_banner", checked)} />
            </VStack>
          </VStack>
        </form>
      )}
    </DetailDrawer>
  );
}

/** The store's permanent ordering link and its QR, generated in the browser from the backend link. */
function StoreOrderingPanel({ business }: { business: Business }) {
  const [status, setStatus] = useState<OwnerStoreOrdering | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  // The owner is on the public app domain, so the link uses that origin: it always matches where customers land.
  const url = status ? `${origin || ""}/order/${status.slug}` : "";

  const load = useCallback(async () => {
    try {
      setStatus(await dataApi.ownerStoreOrdering(business.id));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load QR ordering.");
    }
  }, [business.id]);

  useEffect(() => {
    const task = window.setTimeout(() => { setOrigin(window.location.origin); void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  useEffect(() => {
    if (!url) return;
    let active = true;
    QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 4, width: 720, color: { dark: "#101828", light: "#ffffff" } })
      .then((dataUrl) => { if (active) setQrImage(dataUrl); })
      .catch(() => { if (active) setError("The QR code could not be drawn. Copy the link instead."); });
    return () => { active = false; };
  }, [url]);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      setStatus(await dataApi.setStoreOrdering(business.id, enabled));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "QR ordering could not be changed.");
    } finally {
      setSaving(false);
    }
  };

  const download = (href: string, filename: string) => {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy is not available in this browser. Select the link and copy it.");
    }
  };

  const downloadSvg = async () => {
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 4 });
    const objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    download(objectUrl, `${status?.slug || "store"}-ordering-qr.svg`);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  return (
    <Panel title="Store ordering link" description="Share this link or print the QR. It always opens your current menu.">
      {error && <NoticeBanner tone="danger" title="QR ordering" description={error} role="alert" />}
      {!status ? <LoadingBlock rows={2} /> : (
        <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={5} align="start">
          <VStack gap={4}>
            <Switch label="Accept QR orders" value={status.qr_ordering_enabled} onChange={(checked) => void toggle(checked)} />
            <Text type="supporting" color="secondary">
              {status.qr_ordering_enabled ? "On. Customers who scan can order now. QR orders are paid at the counter when collected." : "Off. Customers can see the menu but cannot order until you turn this on."}
            </Text>
            {!status.is_open && <NoticeBanner tone="warning" title="Your store is closed right now" description="Customers can browse, but ordering opens during business hours." />}
            <VStack gap={1}>
              <Text type="label" color="primary">Store link</Text>
              <Text type="supporting" color="secondary">{url}</Text>
            </VStack>
            <HStack gap={2} wrap="wrap">
              <Button label={copied ? "Copied" : "Copy link"} variant="secondary" size="sm" onClick={() => void copyLink()} />
              <Button label="Open ordering page" variant="ghost" size="sm" href={url} />
            </HStack>
            <HStack gap={2} wrap="wrap">
              <Button label="Download PNG" variant="secondary" size="sm" isDisabled={!qrImage} onClick={() => qrImage && download(qrImage, `${status.slug}-ordering-qr.png`)} />
              <Button label="Download SVG" variant="secondary" size="sm" onClick={() => void downloadSvg()} />
            </HStack>
            {saving && <Text type="supporting" color="secondary">Saving…</Text>}
          </VStack>
          <VStack gap={2} hAlign="center">
            {qrImage ? (
              <Image src={qrImage} alt={`QR code that opens ${status.name} ordering`} width={240} height={240} unoptimized style={{ borderRadius: 12, background: "#ffffff", padding: 12, border: "1px solid var(--color-border)" }} />
            ) : <LoadingBlock rows={1} />}
            <Text type="supporting" color="secondary">{status.name}</Text>
          </VStack>
        </Grid>
      )}
    </Panel>
  );
}

function QrSection({ business, products, categories, combos }: { business: Business; products: Product[]; categories: Category[]; combos: Combo[] }) {
  const [rows, setRows] = useState<QrCodeRecord[]>([]);
  const [promotions, setPromotions] = useState<PromotionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [tableToken, setTableToken] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [destinationType, setDestinationType] = useState("main_menu");
  const load = useCallback(async () => {
    try {
      const [qr, deals] = await Promise.all([dataApi.qrCodes(business.id), dataApi.promotions(business.id)]);
      setRows(qr.qr_codes);
      setPromotions(deals.promotions);
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not load QR codes.");
    } finally {
      setLoading(false);
    }
  }, [business.id]);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  useLiveRefresh(() => void load(), 30000);
  const destinationOptions = destinationType === "category" ? categories.map((item) => ({ value: item.id, label: item.name }))
    : destinationType === "item" ? products.map((item) => ({ value: item.id, label: item.name }))
    : destinationType === "deal" ? promotions.map((item) => ({ value: item.id, label: item.name }))
    : combos.map((item) => ({ value: item.id, label: item.name }));
  const create = async () => {
    try {
      await dataApi.createQrCode(business.id, { name, destination_type: destinationType, destination_id: destinationId || null, table_token: tableToken || null, tracking_metadata: { source: "dashboard" } });
      setName("");
      setTableToken("");
      setDestinationId("");
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not create QR code.");
    }
  };

  return (
    <DashboardPage>
      <PageHeader eyebrow="Kiosk & Menu" title="QR ordering" description="Give customers one link or QR code. They scan it, see your menu, and order. Orders reach the kitchen as Online (QR) orders." />
      <StoreOrderingPanel business={business} />
      <Panel title="Generate QR code">
        <Grid columns={{ minWidth: 220, repeat: "fit" }} gap={4}>
          <TextInput label="Name" isRequired placeholder="Front counter" value={name} onChange={setName} />
          <Selector label="Destination" value={destinationType} onChange={(value) => { setDestinationType(value); setDestinationId(""); }} options={[{ value: "main_menu", label: "Main menu" }, { value: "category", label: "Category" }, { value: "item", label: "Item" }, { value: "deal", label: "Deal" }, { value: "table", label: "Table" }, { value: "takeaway", label: "Takeaway" }]} />
          {["category", "item", "deal"].includes(destinationType) && <Selector label="Destination identifier" value={destinationId} placeholder="Select destination" onChange={setDestinationId} options={destinationOptions} />}
          <TextInput label="Table token (for table QR)" value={tableToken} onChange={setTableToken} />
        </Grid>
        <HStack gap={2} hAlign="end"><Button label="Create QR code" variant="primary" isDisabled={!name.trim()} onClick={() => void create()} /></HStack>
      </Panel>
      <Panel title="Extra QR codes" description="Codes for tables, categories and deals. Each one opens your ordering page at that destination.">
        {loading ? <LoadingBlock rows={3} /> : rows.length ? (
          <VStack gap={3}>
            {rows.map((row) => (
              <HStack key={row.id} gap={3} vAlign="center" hAlign="between" wrap="wrap">
                <VStack gap={0}>
                  <Text type="body" weight="semibold">{row.name}</Text>
                  <Text type="supporting" color="secondary">{row.destination_type} · {row.active ? "Active" : "Disabled"}</Text>
                  <Text type="supporting" color="secondary">{row.url}</Text>
                </VStack>
                <HStack gap={2}>
                  <Button label={`Download ${row.name} as SVG`} variant="secondary" size="sm" href={`/api/businesses/${business.id}/qr-codes/${row.id}/download?format=svg`} />
                  <Button label={`Download ${row.name} as PNG`} variant="secondary" size="sm" href={`/api/businesses/${business.id}/qr-codes/${row.id}/download?format=png`} />
                </HStack>
              </HStack>
            ))}
          </VStack>
        ) : <EmptyBlock title="No QR codes yet" description="Save data through the existing menu setup flow to see it here." />}
        {message && <NoticeBanner tone="danger" title="QR codes" description={message} />}
      </Panel>
    </DashboardPage>
  );
}

