"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Copy, Download, Eye, Grid2X2, List, Plus } from "lucide-react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { FileInput } from "@astryxdesign/core/FileInput";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Selector } from "@astryxdesign/core/Selector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ConfirmDialog, DashboardPage, DetailDrawer, DetailRow, EmptyBlock, LoadingBlock, NoticeBanner, PageHeader, Panel, StatusBadge, Toolbar, type Tone } from "@/components/dashboard/kit";
import { RealKioskFrame } from "@/app/admin/_components/real-kiosk-frame";
import { api, assetUrl } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import type { Category, Combo, ComboPayload, ComboSectionInput, ItemType, KioskSetupOverview, MenuStatus, ModifierGroup, Product } from "@/lib/types";
import type { Business } from "@/services/api";

type MenuMode = "items" | "add-item" | "combos";
type MenuScope = "all" | "available" | "unavailable" | "attention";
type ToastState = { text: string; undo?: () => void; status?: "success" | "danger" | "info" } | null;
type VariantDraft = { name: string; price: string; isDefault: boolean; isAvailable: boolean };
type OptionDraft = { name: string; price: string; isDefault: boolean; isAvailable: boolean };
type ItemDraft = { name: string; internalName: string; description: string; sku: string; price: string; compareAt: string; categoryId: string; itemType: ItemType; allergens: string; status: MenuStatus; available: boolean; featured: boolean; trackStock: boolean; stock: string; tags: string; variants: VariantDraft[] };
type Setter = (toast: ToastState) => void;

const emptyDraft = (): ItemDraft => ({ name: "", internalName: "", description: "", sku: "", price: "", compareAt: "", categoryId: "", itemType: "veg", allergens: "", status: "draft", available: true, featured: false, trackStock: false, stock: "", tags: "", variants: [] });
const readable = (value?: string | null) => (value || "Not set").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusTone = (status?: string | null): Tone => status === "shown" ? "success" : status === "draft" ? "warning" : status === "unavailable" ? "danger" : "neutral";
export const isProductAvailable = (item: Product) => item.is_available && !(item.track_stock && Number(item.stock_quantity || 0) <= 0);
export const itemAttentionIssues = (item: Product) => [!item.category_id && "Missing category", !item.primary_image_path && "Missing image", !Number.isFinite(Number(item.price)) && "Missing price", item.menu_status === "draft" && "Draft changes"].filter(Boolean) as string[];
export const formatMenuPrice = (value: number | string | null | undefined, currency = "INR") => formatCurrency(Number(value ?? 0), currency);
export const filterMenuProducts = (products: Product[], search: string, category: string, status: string, dietary: string, scope: MenuScope = "all") => products.filter((item) => (!search || `${item.name} ${item.sku || ""}`.toLowerCase().includes(search)) && (category === "all" || item.category_id === category) && (status === "all" || item.menu_status === status) && (dietary === "all" || item.item_type === dietary) && (scope === "all" || scope === "available" && isProductAvailable(item) || scope === "unavailable" && !isProductAvailable(item) || scope === "attention" && itemAttentionIssues(item).length > 0));

async function exportProducts(products: Product[], currency: string, businessId?: string) {
  if (businessId && products.length > 0) {
    try {
      const res = await fetch(`/api/businesses/${businessId}/products/export`, { credentials: "include" });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `menu-items-${businessId}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }
    } catch {
      // Fallback to client generation
    }
  }
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [["Name", "SKU", "Price", "Currency", "Category ID", "Dietary", "Available", "Status"], ...products.map((item) => [item.name, item.sku || "", item.price, currency, item.category_id || "", item.item_type, item.is_available, item.menu_status || "draft"])].map((row) => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "menu-items.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function ManageMenuSkeleton() {
  return <LoadingBlock rows={5} />;
}

export function ManageMenuPage({ business, products, categories, combos, setup, reload }: { business: Business; products: Product[]; categories: Category[]; combos: Combo[]; setup: KioskSetupOverview | null; reload: () => Promise<void> }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mode: MenuMode = params.get("mode") === "add-item" ? "add-item" : params.get("mode") === "combos" ? "combos" : "items";
  const [previewKey, setPreviewKey] = useState(0);
  const [compactPreviewOpen, setCompactPreviewOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const setMode = (next: MenuMode) => router.replace(`${pathname}?mode=${next}`);
  const refreshed = async () => {
    await reload();
    setPreviewKey((value) => value + 1);
  };
  const headerAction = mode === "items"
    ? <Button label="Add item" variant="primary" onClick={() => setMode("add-item")} icon={<Plus size={17} aria-hidden="true" />} />
    : mode === "combos"
      ? <Button label="Create combo" variant="primary" onClick={() => window.dispatchEvent(new CustomEvent("menutap:new-combo"))} icon={<Plus size={17} aria-hidden="true" />} />
      : null;

  return (
    <DashboardPage>
      <PageHeader
        eyebrow="Kiosk & Menu"
        title="Manage Menu"
        description={`${products.length} items · ${categories.length} categories · ${combos.length} combos · Saved ${setup?.lastSavedAt ? new Date(setup.lastSavedAt).toLocaleString() : "not yet"}`}
        actions={<>
          <Button label="Preview kiosk" variant="secondary" href="/dashboard/kiosk-experience/preview" icon={<Eye size={17} aria-hidden="true" />} />
          <Button label="Portrait preview" variant="ghost" onClick={() => setCompactPreviewOpen(true)} />
          <Button label={`${setup?.unpublishedChanges || 0} draft changes`} variant="ghost" href="/dashboard/kiosk-experience/publish" />
          {headerAction}
        </>}
      >
        <TabList value={mode} onChange={(value) => setMode(value as MenuMode)} size="sm" layout="hug">
          <Tab value="items" label="Items" />
          <Tab value="add-item" label="Add item" />
          <Tab value="combos" label="Combos" />
        </TabList>
      </PageHeader>
      {toast && <NoticeBanner tone={toast.status === "danger" ? "danger" : toast.status === "info" ? "info" : "success"} title={toast.text} action={<HStack gap={2}>{toast.undo && <Button label={toast.status === "danger" ? "Retry" : "Undo"} variant="ghost" onClick={() => { toast.undo?.(); setToast(null); }} />}<Button label="Dismiss" variant="ghost" onClick={() => setToast(null)} /></HStack>} />}
      {mode === "items" ? <ItemsMode business={business} products={products} categories={categories} combos={combos} initialProductId={params.get("product") || ""} previewKey={previewKey} refreshed={refreshed} setMode={setMode} setToast={setToast} />
        : mode === "add-item" ? <AddItemMode business={business} products={products} categories={categories} refreshed={refreshed} setToast={setToast} />
        : <CombosMode business={business} products={products} categories={categories} combos={combos} previewKey={previewKey} refreshed={refreshed} setToast={setToast} />}
      <DetailDrawer title="Portrait kiosk preview" isOpen={compactPreviewOpen} onClose={() => setCompactPreviewOpen(false)} width={520} footer={<Button label="Close" variant="secondary" onClick={() => setCompactPreviewOpen(false)} />}>
        <RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={`compact-${previewKey}`} />
      </DetailDrawer>
    </DashboardPage>
  );
}

function ItemsMode({ business, products, categories, combos, initialProductId, previewKey, refreshed, setMode, setToast }: { business: Business; products: Product[]; categories: Category[]; combos: Combo[]; initialProductId: string; previewKey: number; refreshed: () => Promise<void>; setMode: (mode: MenuMode) => void; setToast: Setter }) {
  const [rows, setRows] = useState(products);
  const [categoryRows, setCategoryRows] = useState(categories);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [dietary, setDietary] = useState("all");
  const [scope, setScope] = useState<MenuScope>("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState(new Set<string>());
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [drawerItem, setDrawerItem] = useState<Product | null>(() => products.find((item) => item.id === initialProductId) || null);
  const [organizing, setOrganizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "item"; item: Product } | { kind: "bulk" } | { kind: "category"; category: Category } | null>(null);
  const [previewVersion, setPreviewVersion] = useState(previewKey);
  const visible = filterMenuProducts(rows, deferredSearch, category, status, dietary, scope);
  const filtered = Boolean(search || category !== "all" || status !== "all" || dietary !== "all" || scope !== "all");
  const groups = [...categoryRows, { id: "uncategorised", name: "Uncategorised", business_id: business.id, sort_order: 999, is_active: true } as Category]
    .map((entry) => ({ category: entry, items: visible.filter((item) => entry.id === "uncategorised" ? !item.category_id : item.category_id === entry.id) }))
    .filter((group) => group.items.length || !filtered && group.category.id !== "uncategorised");

  const clearFilters = () => { setSearch(""); setCategory("all"); setStatus("all"); setDietary("all"); setScope("all"); };
  const selectedRows = () => rows.filter((row) => selected.has(row.id));
  const completeBulk = (text: string) => { setSelected(new Set()); setToast({ text }); };
  const changeAvailability = async (item: Product, next: boolean, notify = true) => {
    setRows((current) => current.map((row) => row.id === item.id ? { ...row, is_available: next } : row));
    try {
      await api.setAvailability(item.id, next);
      setPreviewVersion((value) => value + 1);
      if (notify) setToast({ text: `${item.name} is now ${next ? "available" : "unavailable"}.`, undo: () => void changeAvailability(item, !next, false) });
    } catch (cause) {
      setRows((current) => current.map((row) => row.id === item.id ? { ...row, is_available: !next } : row));
      setToast({ text: cause instanceof Error ? cause.message : "Availability was not saved.", status: "danger" });
    }
  };
  const bulkAvailability = async (next: boolean) => {
    const targets = selectedRows();
    setRows((current) => current.map((row) => selected.has(row.id) ? { ...row, is_available: next } : row));
    try {
      await Promise.all(targets.map((row) => api.setAvailability(row.id, next)));
      setPreviewVersion((value) => value + 1);
      completeBulk(`${targets.length} items updated.`);
    } catch {
      setRows(products);
      setToast({ text: "Some items could not be updated. The local changes were reverted.", status: "danger" });
    }
  };
  const moveSelected = async (categoryId: string) => {
    const targets = selectedRows();
    if (!categoryId || !targets.length) return;
    setSaving(true);
    try {
      await Promise.all(targets.map((item) => api.updateProduct(item.id, { category_id: categoryId === "uncategorised" ? null : categoryId })));
      setRows((current) => current.map((item) => selected.has(item.id) ? { ...item, category_id: categoryId === "uncategorised" ? null : categoryId } : item));
      completeBulk(`${targets.length} items moved.`);
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Items were not moved.", status: "danger" });
    } finally {
      setSaving(false);
    }
  };
  const tagSelected = async () => {
    const tag = window.prompt("Tag to add to selected items")?.trim();
    if (!tag) return;
    const targets = selectedRows();
    setSaving(true);
    try {
      await Promise.all(targets.map((item) => api.updateProduct(item.id, { tags: Array.from(new Set([...(item.tags || []), tag])) })));
      setRows((current) => current.map((item) => selected.has(item.id) ? { ...item, tags: Array.from(new Set([...(item.tags || []), tag])) } : item));
      completeBulk(`Tag added to ${targets.length} items.`);
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Tags were not updated.", status: "danger" });
    } finally {
      setSaving(false);
    }
  };
  const addSelectedToCombo = async (comboId: string) => {
    if (!comboId) return;
    setSaving(true);
    try {
      const detail = (await api.combo(comboId)).combo;
      const included = detail.sections?.find((section) => section.section_type === "included_items");
      const existing = new Set((included?.options || []).map((option) => option.existing_item_id));
      const targets = selectedRows().filter((item) => !existing.has(item.id));
      if (included) await Promise.all(targets.map((item, index) => api.createComboOption(included.id, { source_type: "existing_item", existing_item_id: item.id, quantity: 1, price_impact: 0, default_selected: true, removable: false, visible: true, sort_order: included.options.length + index })));
      else {
        const created = await api.createComboSection(detail.id, { title: "Included items", section_type: "included_items", required: true, min_select: targets.length, max_select: targets.length, sort_order: 0, options: [] });
        await Promise.all(targets.map((item, index) => api.createComboOption(created.id, { source_type: "existing_item", existing_item_id: item.id, quantity: 1, price_impact: 0, default_selected: true, removable: false, visible: true, sort_order: index })));
      }
      completeBulk(targets.length ? `${targets.length} items added to ${detail.name}.` : "Those items are already in the combo.");
      await refreshed();
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Items were not added to the combo.", status: "danger" });
    } finally {
      setSaving(false);
    }
  };
  const removeSelectedFromCombos = async () => {
    if (!window.confirm("Remove the selected items from every combo that contains them?")) return;
    setSaving(true);
    try {
      const details = await Promise.all(combos.map((combo) => api.combo(combo.id).then((result) => result.combo)));
      const options = details.flatMap((combo) => combo.sections || []).flatMap((section) => section.options).filter((option) => option.existing_item_id && selected.has(option.existing_item_id));
      await Promise.all(options.map((option) => api.deleteComboOption(option.id)));
      completeBulk(`Removed ${options.length} combo references.`);
      await refreshed();
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Combo references were not removed.", status: "danger" });
    } finally {
      setSaving(false);
    }
  };
  const moveItem = (item: Product, destination: "up" | "down" | "top" | "bottom") => {
    const indexes = rows.map((row, index) => row.category_id === item.category_id ? index : -1).filter((index) => index >= 0);
    const current = indexes.indexOf(rows.findIndex((row) => row.id === item.id));
    const target = destination === "top" ? 0 : destination === "bottom" ? indexes.length - 1 : current + (destination === "up" ? -1 : 1);
    if (current < 0 || target < 0 || target >= indexes.length) return;
    const reordered = [...rows];
    [reordered[indexes[current]], reordered[indexes[target]]] = [reordered[indexes[target]], reordered[indexes[current]]];
    setRows(reordered);
  };
  const moveCategory = (entry: Category, destination: "up" | "down" | "top" | "bottom") => {
    const current = categoryRows.findIndex((row) => row.id === entry.id);
    const target = destination === "top" ? 0 : destination === "bottom" ? categoryRows.length - 1 : current + (destination === "up" ? -1 : 1);
    if (current < 0 || target < 0 || target >= categoryRows.length) return;
    const reordered = [...categoryRows];
    [reordered[current], reordered[target]] = [reordered[target], reordered[current]];
    setCategoryRows(reordered);
  };
  const saveOrder = async () => {
    setSaving(true);
    try {
      await Promise.all([...rows.map((item, index) => api.updateProduct(item.id, { sort_order: index })), ...categoryRows.map((entry, index) => api.updateCategory(entry.id, { sort_order: index }))]);
      setOrganizing(false);
      await refreshed();
      setToast({ text: "Menu order saved." });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Menu order was not saved.", status: "danger" });
    } finally {
      setSaving(false);
    }
  };
  const renameCategory = async (entry: Category) => {
    const name = window.prompt("Category name", entry.name)?.trim();
    if (!name || name === entry.name) return;
    try {
      await api.updateCategory(entry.id, { name });
      setCategoryRows((current) => current.map((row) => row.id === entry.id ? { ...row, name } : row));
      setToast({ text: "Category renamed." });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Category was not renamed.", status: "danger" });
    }
  };
  const toggleCategory = async (entry: Category) => {
    try {
      await api.updateCategory(entry.id, { is_active: !entry.is_active });
      setCategoryRows((current) => current.map((row) => row.id === entry.id ? { ...row, is_active: !row.is_active } : row));
      setToast({ text: `${entry.name} is now ${entry.is_active ? "hidden" : "visible"}.` });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Category visibility was not saved.", status: "danger" });
    }
  };
  const archiveConfirmed = async () => {
    if (!confirm) return;
    const pending = confirm;
    setSaving(true);
    try {
      if (confirm.kind === "item") {
        await api.updateProduct(confirm.item.id, { menu_status: "hidden", is_available: false });
        setRows((current) => current.map((item) => item.id === confirm.item.id ? { ...item, menu_status: "hidden", is_available: false } : item));
        setDrawerItem(null);
        setToast({ text: "Item archived.", undo: () => void api.updateProduct(confirm.item.id, { menu_status: confirm.item.menu_status, is_available: confirm.item.is_available }).then(() => void refreshed()) });
      } else if (confirm.kind === "bulk") {
        const targets = selectedRows();
        await Promise.all(targets.map((item) => api.updateProduct(item.id, { menu_status: "hidden", is_available: false })));
        setRows((current) => current.map((item) => selected.has(item.id) ? { ...item, menu_status: "hidden", is_available: false } : item));
        completeBulk(`${targets.length} items archived.`);
      } else {
        await api.updateCategory(confirm.category.id, { is_active: false });
        setCategoryRows((current) => current.map((entry) => entry.id === confirm.category.id ? { ...entry, is_active: false } : entry));
        setToast({ text: "Category archived." });
      }
      setConfirm(null);
      await refreshed();
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Couldn’t archive this item.", status: "danger", undo: () => { setConfirm(pending); setToast(null); } });
    } finally {
      setSaving(false);
    }
  };
  const toggleGroup = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleSelected = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  });
  const scopeCount = (value: MenuScope) => value === "all" ? rows.length : value === "available" ? rows.filter(isProductAvailable).length : value === "unavailable" ? rows.filter((item) => !isProductAvailable(item)).length : rows.filter((item) => itemAttentionIssues(item).length).length;

  return (
    <VStack gap={4}>
      <Toolbar>
        <TextInput type="search" label="Search menu items" placeholder="Search items or SKU" value={search} onChange={setSearch} />
        <Selector label="Category" value={category} onChange={setCategory} options={[{ value: "all", label: "All categories" }, ...categoryRows.map((entry) => ({ value: entry.id, label: entry.name }))]} />
        <Selector label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "shown", label: "Published" }, { value: "draft", label: "Draft" }, { value: "hidden", label: "Archived" }, { value: "unavailable", label: "Unavailable" }]} />
        <Selector label="Dietary" value={dietary} onChange={setDietary} options={[{ value: "all", label: "All dietary" }, { value: "veg", label: "Vegetarian" }, { value: "non_veg", label: "Non-vegetarian" }, { value: "retail", label: "Retail" }, { value: "service", label: "Service" }, { value: "other", label: "Other" }]} />
        <Button label="Export menu" variant="ghost" icon={<Download size={16} aria-hidden="true" />} onClick={() => void exportProducts(rows, business.currency_code || "", business.id)} />
        <Button label={organizing ? "Stop organizing" : "Organize"} variant="secondary" onClick={() => setOrganizing((value) => !value)} />
        <SegmentedControl label="Item view" value={view} onChange={(value) => setView(value as "list" | "grid")}>
          <SegmentedControlItem value="list" label="List" icon={<List size={16} aria-hidden="true" />} isLabelHidden />
          <SegmentedControlItem value="grid" label="Grid" icon={<Grid2X2 size={16} aria-hidden="true" />} isLabelHidden />
        </SegmentedControl>
      </Toolbar>
      <SegmentedControl label="Availability and attention filter" value={scope} onChange={(value) => setScope(value as MenuScope)}>
        {(["all", "available", "unavailable", "attention"] as MenuScope[]).map((value) => <SegmentedControlItem key={value} value={value} label={`${readable(value)} ${scopeCount(value)}`} icon={value === "attention" ? <AlertTriangle size={15} aria-hidden="true" /> : undefined} />)}
      </SegmentedControl>
      {filtered && (
        <HStack gap={2} wrap="wrap" vAlign="center">
          {search && <Button label={`Clear search ${search}`} variant="ghost" size="sm" onClick={() => setSearch("")}>{`Search: ${search}`}</Button>}
          {category !== "all" && <Button label="Clear category filter" variant="ghost" size="sm" onClick={() => setCategory("all")}>{`Category: ${categoryRows.find((entry) => entry.id === category)?.name || "Unknown"}`}</Button>}
          {status !== "all" && <Button label="Clear status filter" variant="ghost" size="sm" onClick={() => setStatus("all")}>{`Status: ${readable(status)}`}</Button>}
          {dietary !== "all" && <Button label="Clear dietary filter" variant="ghost" size="sm" onClick={() => setDietary("all")}>{`Dietary: ${readable(dietary)}`}</Button>}
          {scope !== "all" && <Button label="Clear scope filter" variant="ghost" size="sm" onClick={() => setScope("all")}>{readable(scope)}</Button>}
          <Button label="Clear all filters" variant="ghost" size="sm" onClick={clearFilters} />
        </HStack>
      )}
      <Grid columns={{ minWidth: 300, repeat: "fit" }} gap={5}>
        <VStack gap={4}>
          <Text type="supporting" color="secondary">{`${visible.length} of ${rows.length} items`}</Text>
          {!rows.length ? <EmptyBlock title="Build your menu" description="Add your first item to begin." action={<Button label="Add first item" variant="primary" onClick={() => setMode("add-item")} />} />
            : !visible.length ? <EmptyBlock title="No matching items" action={<Button label="Clear filters" variant="secondary" onClick={clearFilters} />} />
            : groups.map((group) => (
              <Panel key={group.category.id} title={group.category.name} description={`${group.items.length} items${group.category.id !== "uncategorised" && !group.category.is_active ? " · Hidden from kiosk" : ""}`} padding={4} actions={
                group.category.id !== "uncategorised" && (organizing ? (
                  <HStack gap={1}>
                    <IconButton label={`Move ${group.category.name} to top`} icon={<ChevronsUp size={17} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => moveCategory(group.category, "top")} />
                    <IconButton label={`Move ${group.category.name} up`} icon={<ArrowUp size={17} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => moveCategory(group.category, "up")} />
                    <IconButton label={`Move ${group.category.name} down`} icon={<ArrowDown size={17} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => moveCategory(group.category, "down")} />
                    <IconButton label={`Move ${group.category.name} to bottom`} icon={<ChevronsDown size={17} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => moveCategory(group.category, "bottom")} />
                  </HStack>
                ) : (
                  <HStack gap={1}>
                    <Button label={`Rename ${group.category.name}`} variant="ghost" size="sm" onClick={() => void renameCategory(group.category)}>Rename</Button>
                    <Button label={group.category.is_active ? `Hide ${group.category.name} from kiosk` : `Show ${group.category.name} on kiosk`} variant="ghost" size="sm" onClick={() => void toggleCategory(group.category)}>{group.category.is_active ? "Hide" : "Show"}</Button>
                    <Button label={`Archive ${group.category.name}`} variant="ghost" size="sm" onClick={() => setConfirm({ kind: "category", category: group.category })}>Archive</Button>
                  </HStack>
                ))
              }>
                {collapsed.has(group.category.id) ? (
                  <Button label={`Expand ${group.category.name}`} variant="ghost" size="sm" onClick={() => toggleGroup(group.category.id)}>Show items</Button>
                ) : (
                  <VStack gap={2}>
                    {group.items.length ? group.items.map((item) => (
                      <ItemRow key={item.id} item={item} currency={business.currency_code || "INR"} organizing={organizing} selected={selected.has(item.id)} onSelect={(checked) => toggleSelected(item.id, checked)} onOpen={() => setDrawerItem(item)} onMove={(destination) => moveItem(item, destination)} onAvailability={(next) => void changeAvailability(item, next)} />
                    )) : <EmptyBlock title={`No items in ${group.category.name}`} action={<Button label={`Add item to ${group.category.name}`} variant="secondary" onClick={() => { window.sessionStorage.setItem("menutap-new-category-id", group.category.id); setMode("add-item"); }} />} />}
                  </VStack>
                )}
              </Panel>
            ))}
        </VStack>
        <VStack gap={3}>
          <Panel title="Portrait draft preview" padding={4} actions={<Button label="Open full preview" variant="ghost" size="sm" href="/dashboard/kiosk-experience/preview" />}>
            <RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={previewVersion} />
          </Panel>
        </VStack>
      </Grid>
      {selected.size > 0 && (
        <Panel padding={4}>
          <Toolbar>
            <Text type="body" weight="semibold">{`${selected.size} selected`}</Text>
            <Button label="Mark selected available" variant="secondary" isDisabled={saving} onClick={() => void bulkAvailability(true)} />
            <Button label="Mark selected unavailable" variant="secondary" isDisabled={saving} onClick={() => void bulkAvailability(false)} />
            <Selector label="Move selected to category" value="" placeholder="Move category…" onChange={(value) => void moveSelected(value)} options={[{ value: "uncategorised", label: "Uncategorised" }, ...categoryRows.map((entry) => ({ value: entry.id, label: entry.name }))]} />
            {combos.length > 0 && <Selector label="Add selected to combo" value="" placeholder="Add to combo…" onChange={(value) => void addSelectedToCombo(value)} options={combos.map((combo) => ({ value: combo.id, label: combo.name }))} />}
            <Button label="Remove selected from combos" variant="secondary" isDisabled={saving || !combos.length} onClick={() => void removeSelectedFromCombos()} />
            <Button label="Add tag to selected" variant="secondary" isDisabled={saving} onClick={() => void tagSelected()} />
            <Button label="Export selected" variant="secondary" onClick={() => void exportProducts(selectedRows(), business.currency_code || "")} />
            <Button label="Archive selected" variant="destructive" isDisabled={saving} onClick={() => setConfirm({ kind: "bulk" })} />
            <Button label="Clear selection" variant="ghost" onClick={() => setSelected(new Set())} />
          </Toolbar>
        </Panel>
      )}
      {organizing && (
        <HStack gap={2} hAlign="end">
          <Button label="Cancel reordering" variant="secondary" onClick={() => { setRows(products); setCategoryRows(categories); setOrganizing(false); }} />
          <Button label="Save order" variant="primary" isLoading={saving} onClick={() => void saveOrder()} />
        </HStack>
      )}
      <ItemDrawer key={drawerItem?.id || "closed"} business={business} item={drawerItem} categoryName={categoryRows.find((entry) => entry.id === drawerItem?.category_id)?.name} previewKey={previewVersion} onClose={() => setDrawerItem(null)} onArchive={() => drawerItem && setConfirm({ kind: "item", item: drawerItem })} onEdit={() => { setDrawerItem(null); setMode("add-item"); window.sessionStorage.setItem("menutap-edit-item", drawerItem?.id || ""); }} />
      <ConfirmDialog isOpen={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={() => void archiveConfirmed()} title={confirm?.kind === "bulk" ? "Archive selected items?" : confirm?.kind === "category" ? "Archive category?" : "Archive item?"} description={confirm?.kind === "bulk" ? `${selected.size} items will be hidden and marked unavailable.` : confirm?.kind === "category" ? `${confirm.category.name} will be hidden from the kiosk. Its items will not be deleted.` : `${confirm?.item.name || "This item"} will be hidden and marked unavailable.`} confirmLabel="Archive" loading={saving} />
    </VStack>
  );
}

function ItemRow({ item, currency, organizing, selected, onSelect, onOpen, onMove, onAvailability }: { item: Product; currency: string; organizing: boolean; selected: boolean; onSelect: (checked: boolean) => void; onOpen: () => void; onMove: (destination: "up" | "down" | "top" | "bottom") => void; onAvailability: (next: boolean) => void }) {
  const issues = itemAttentionIssues(item);
  const thumb = item.primary_image_path
    ? <Avatar size="lg" shape="rounded" name={item.name} src={assetUrl(item.primary_image_path) || undefined} tooltip={false} />
    : <Avatar size="lg" shape="rounded" name={item.name} tooltip={false} />;
  return (
    <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
      <HStack gap={3} vAlign="center">
        <CheckboxInput label={`Select ${item.name}`} isLabelHidden value={selected} onChange={(checked) => onSelect(checked)} />
        {thumb}
        <ClickableCard label={`Open ${item.name} details`} onClick={onOpen} padding={1}>
          <VStack gap={0}>
            <Text type="body" weight="semibold">{item.name}</Text>
            <Text type="supporting" color="secondary">{`${readable(item.item_type)}${item.sku ? ` · ${item.sku}` : ""}${item.tags?.length ? ` · ${item.tags.slice(0, 2).join(", ")}` : ""}`}</Text>
          </VStack>
        </ClickableCard>
      </HStack>
      {organizing ? (
        <HStack gap={1}>
          <IconButton label={`Move ${item.name} to top`} icon={<ChevronsUp size={17} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => onMove("top")} />
          <IconButton label={`Move ${item.name} up`} icon={<ArrowUp size={17} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => onMove("up")} />
          <IconButton label={`Move ${item.name} down`} icon={<ArrowDown size={17} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => onMove("down")} />
          <IconButton label={`Move ${item.name} to bottom`} icon={<ChevronsDown size={17} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => onMove("bottom")} />
        </HStack>
      ) : (
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Text type="body" weight="semibold">{formatMenuPrice(item.price, currency)}</Text>
          <Switch label={`${item.name} available`} isLabelHidden value={item.is_available} onChange={(checked) => onAvailability(checked)} />
          {!isProductAvailable(item) && item.track_stock && <StatusBadge tone="danger">Out of stock</StatusBadge>}
          <StatusBadge tone={statusTone(item.menu_status)}>{readable(item.menu_status)}</StatusBadge>
          {issues.length > 0 && <IconButton label={`Review ${item.name}: ${issues.join(", ")}`} icon={<AlertTriangle size={17} aria-hidden="true" />} variant="ghost" size="sm" tooltip={issues.join(", ")} onClick={onOpen} />}
        </HStack>
      )}
    </HStack>
  );
}

function ItemDrawer({ business, item, categoryName, previewKey, onClose, onArchive, onEdit }: { business: Business; item: Product | null; categoryName?: string; previewKey: number; onClose: () => void; onArchive: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState("overview");
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [groupError, setGroupError] = useState("");
  useEffect(() => {
    if (!item) return;
    void api.modifierGroups(item.id).then((result) => { setGroups(result.modifier_groups); setGroupError(""); }).catch((cause) => { setGroups(item.modifier_groups || []); setGroupError(cause instanceof Error ? cause.message : "Options could not be loaded."); });
  }, [item]);
  const issues = item ? itemAttentionIssues(item) : [];
  const currency = business.currency_code || "INR";
  return (
    <DetailDrawer title={item?.name || "Item details"} isOpen={Boolean(item)} onClose={onClose} width={520} footer={<><Button label="Archive" variant="destructive" onClick={onArchive} /><Button label="Close" variant="secondary" onClick={onClose} /><Button label="Edit item" variant="primary" onClick={onEdit} /></>}>
      <TabList value={tab} onChange={setTab} size="sm" layout="hug">
        {["overview", "options", "locations", "preview", "activity"].map((value) => <Tab key={value} value={value} label={value === "options" ? "Options & add-ons" : value === "preview" ? "Kiosk preview" : readable(value)} />)}
      </TabList>
      {item && tab === "overview" && (
        <VStack gap={3}>
          <DetailRow label="Price">{formatMenuPrice(item.price, currency)}</DetailRow>
          <DetailRow label="Status">{readable(item.menu_status)}</DetailRow>
          <DetailRow label="Availability">{item.is_available ? "Available" : "Unavailable"}</DetailRow>
          <DetailRow label="Category">{categoryName || "Uncategorised"}</DetailRow>
          <DetailRow label="Dietary / type">{readable(item.item_type)}</DetailRow>
          <DetailRow label="Stock">{item.track_stock ? String(item.stock_quantity ?? 0) : "Not tracked"}</DetailRow>
          {issues.length > 0 && <NoticeBanner tone="warning" title="Needs attention" description={issues.join(" · ")} action={<Button label="Correct item" variant="secondary" onClick={onEdit} />} />}
        </VStack>
      )}
      {tab === "options" && (
        <VStack gap={3}>
          {groupError && <NoticeBanner tone="danger" title="Options could not be refreshed" description={groupError} />}
          {groups.length ? groups.map((group) => (
            <Panel key={group.id} title={group.name} description={`${group.is_required ? "Required" : "Optional"} · ${group.min_select}–${group.max_select} selections`} padding={3}>
              <VStack gap={2}>
                {group.options.map((option) => <DetailRow key={option.id} label={option.is_default ? `${option.name} (default)` : option.name}>{option.is_available ? `+${formatMenuPrice(option.price_delta, currency)}` : "Unavailable"}</DetailRow>)}
              </VStack>
            </Panel>
          )) : !groupError && <EmptyBlock title="No options or add-ons" description="Edit the item to add a modifier group." />}
        </VStack>
      )}
      {tab === "locations" && <NoticeBanner tone="info" title="Uses business-wide menu settings" description="No location override is exposed by the current product contract." />}
      {tab === "preview" && item && <RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={`${previewKey}-${item.id}`} />}
      {tab === "activity" && item && (
        <VStack gap={3}>
          <DetailRow label="Created">{item.created_at ? new Date(item.created_at).toLocaleString() : "Not returned"}</DetailRow>
          <DetailRow label="Last updated">{item.updated_at ? new Date(item.updated_at).toLocaleString() : "Not returned"}</DetailRow>
        </VStack>
      )}
    </DetailDrawer>
  );
}

function AddItemMode({ business, products, categories, refreshed, setToast }: { business: Business; products: Product[]; categories: Category[]; refreshed: () => Promise<void>; setToast: Setter }) {
  const [submode, setSubmode] = useState<"item" | "category">("item");
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft);
  const [editingId, setEditingId] = useState("");
  const [originalMetadata, setOriginalMetadata] = useState<Record<string, unknown>>({});
  const [existingGroups, setExistingGroups] = useState<ModifierGroup[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [modifierName, setModifierName] = useState("");
  const [modifierRequired, setModifierRequired] = useState(false);
  const [modifierMin, setModifierMin] = useState("0");
  const [modifierMax, setModifierMax] = useState("1");
  const [modifierOptions, setModifierOptions] = useState<OptionDraft[]>([]);
  useEffect(() => {
    const task = window.setTimeout(() => {
      const id = window.sessionStorage.getItem("menutap-edit-item") || "";
      const presetCategory = window.sessionStorage.getItem("menutap-new-category-id") || "";
      window.sessionStorage.removeItem("menutap-edit-item");
      window.sessionStorage.removeItem("menutap-new-category-id");
      if (presetCategory) setDraft((current) => ({ ...current, categoryId: presetCategory }));
      if (!id) return;
      const item = products.find((row) => row.id === id);
      if (!item) return;
      const metadata = item.metadata || {};
      const variants = Array.isArray(metadata.variants) ? (metadata.variants as Array<Record<string, unknown>>).map((variant) => ({ name: String(variant.name || ""), price: String(variant.price || ""), isDefault: Boolean(variant.isDefault ?? variant.is_default), isAvailable: variant.isAvailable === undefined && variant.is_available === undefined ? true : Boolean(variant.isAvailable ?? variant.is_available) })) : [];
      setEditingId(id);
      setOriginalMetadata(metadata);
      setDraft({ name: item.name, internalName: String(metadata.internal_name || ""), description: item.description || "", sku: item.sku || "", price: String(item.price), compareAt: item.original_price == null ? "" : String(item.original_price), categoryId: item.category_id || "", itemType: item.item_type, allergens: Array.isArray(metadata.allergens) ? metadata.allergens.join(", ") : "", status: item.menu_status || "draft", available: item.is_available, featured: item.is_featured, trackStock: item.track_stock, stock: item.stock_quantity == null ? "" : String(item.stock_quantity), tags: (item.tags || []).join(", "), variants });
      void api.modifierGroups(id).then((result) => setExistingGroups(result.modifier_groups)).catch(() => setExistingGroups(item.modifier_groups || []));
    }, 0);
    return () => window.clearTimeout(task);
  }, [products]);

  const update = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const reset = () => {
    setDraft(emptyDraft());
    setEditingId("");
    setOriginalMetadata({});
    setExistingGroups([]);
    setImage(null);
    setModifierName("");
    setModifierRequired(false);
    setModifierMin("0");
    setModifierMax("1");
    setModifierOptions([]);
  };
  const moveVariant = (index: number, amount: number) => {
    const target = index + amount;
    if (target < 0 || target >= draft.variants.length) return;
    const next = [...draft.variants];
    [next[index], next[target]] = [next[target], next[index]];
    update("variants", next);
  };
  const setVariant = (index: number, patch: Partial<VariantDraft>) => update("variants", draft.variants.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const setOption = (index: number, patch: Partial<OptionDraft>) => setModifierOptions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));

  const save = async (action: "draft" | "save" | "another") => {
    const price = Number(draft.price);
    const compareAt = draft.compareAt === "" ? null : Number(draft.compareAt);
    const min = Number(modifierMin);
    const max = Number(modifierMax);
    if (draft.name.trim().length < 2 || !Number.isFinite(price) || price < 0) { setToast({ text: "Enter an item name and a valid non-negative price.", status: "danger" }); return; }
    if (compareAt !== null && (!Number.isFinite(compareAt) || compareAt < price)) { setToast({ text: "Compare-at price must be at least the base price.", status: "danger" }); return; }
    if (modifierName.trim() && (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > modifierOptions.filter((option) => option.name.trim()).length)) { setToast({ text: "Modifier minimum and maximum must match the available options.", status: "danger" }); return; }
    setBusy(true);
    try {
      const imagePath = image ? (await api.uploadProductImage(business.id, image)).path : undefined;
      const metadata = { ...originalMetadata, internal_name: draft.internalName.trim() || undefined, allergens: draft.allergens.split(",").map((value) => value.trim()).filter(Boolean), variants: draft.variants };
      const payload: Partial<Product> = { name: draft.name.trim(), description: draft.description.trim() || null, sku: draft.sku.trim() || null, price, original_price: compareAt, category_id: draft.categoryId || null, item_type: draft.itemType, menu_status: action === "draft" ? "draft" : draft.status, is_available: draft.available, is_featured: draft.featured, track_stock: draft.trackStock, stock_quantity: draft.trackStock && draft.stock !== "" ? Number(draft.stock) : null, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), metadata, ...(imagePath ? { primary_image_path: imagePath } : {}) };
      const item = editingId ? await api.updateProduct(editingId, payload) : await api.createProduct(business.id, payload);
      const options = modifierOptions.filter((option) => option.name.trim());
      if (modifierName.trim() && options.length) await api.createModifierGroup(item.id, { name: modifierName.trim(), min_select: min, max_select: max, is_required: modifierRequired, options: options.map((option, index) => ({ name: option.name.trim(), price_delta: Number(option.price || 0), is_default: option.isDefault, is_available: option.isAvailable, sort_order: index })) });
      await refreshed();
      setToast({ text: action === "draft" ? "Draft saved." : editingId ? "Item updated." : "Item added." });
      if (action === "another") reset();
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "The item was not saved.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <VStack gap={5}>
      <SegmentedControl label="Item form section" value={submode} onChange={(value) => setSubmode(value as "item" | "category")}>
        <SegmentedControlItem value="item" label={editingId ? "Edit item" : "New item"} />
        <SegmentedControlItem value="category" label="New category" />
      </SegmentedControl>
      {submode === "category" ? (
        <CategoryForm business={business} categories={categories} refreshed={refreshed} onDone={(id) => { if (id) update("categoryId", id); setSubmode("item"); }} setToast={setToast} />
      ) : (
        <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save("save"); }}>
          <VStack gap={5}>
            <Panel title="Basic information" description="Required fields are marked.">
              <Grid columns={{ minWidth: 240, repeat: "fit" }} gap={4}>
                <TextInput label="Item name" isRequired value={draft.name} onChange={(value) => update("name", value)} />
                <TextInput label="Internal name" value={draft.internalName} onChange={(value) => update("internalName", value)} />
                <TextInput label="SKU / code" value={draft.sku} onChange={(value) => update("sku", value)} />
              </Grid>
              <TextArea label="Short description" value={draft.description} onChange={(value) => update("description", value)} maxLength={500} />
              <FileInput label="Product image" accept="image/png,image/jpeg,image/webp" value={image} onChange={(file) => setImage(file as File | null)} />
            </Panel>
            <Panel title="Pricing, category & dietary">
              <Grid columns={{ minWidth: 240, repeat: "fit" }} gap={4}>
                <TextInput label={`Base price (${business.currency_symbol})`} inputMode="decimal" isRequired value={draft.price} onChange={(value) => update("price", value)} />
                <TextInput label={`Compare-at price (${business.currency_symbol})`} inputMode="decimal" value={draft.compareAt} onChange={(value) => update("compareAt", value)} />
                <Selector label="Category" value={draft.categoryId} onChange={(value) => value === "__new" ? setSubmode("category") : update("categoryId", value)} options={[{ value: "", label: "Uncategorised" }, ...categories.map((category) => ({ value: category.id, label: category.name })), { value: "__new", label: "+ Create category" }]} />
                <Selector label="Dietary / item type" value={draft.itemType} onChange={(value) => update("itemType", value as ItemType)} options={[{ value: "veg", label: "Vegetarian" }, { value: "non_veg", label: "Non-vegetarian" }, { value: "retail", label: "Retail" }, { value: "service", label: "Service" }, { value: "other", label: "Other" }]} />
                <TextInput label="Allergens" value={draft.allergens} onChange={(value) => update("allergens", value)} description="Comma separated" />
                <TextInput label="Tags" value={draft.tags} onChange={(value) => update("tags", value)} description="Comma separated" />
              </Grid>
            </Panel>
            <Panel title="Variants & sizes" description={draft.variants.length ? undefined : "The base item is used when no variants are added."} actions={<Button label="Add variant" variant="secondary" onClick={() => update("variants", [...draft.variants, { name: "", price: draft.price, isDefault: !draft.variants.length, isAvailable: true }])} />}>
              {draft.variants.map((variant, index) => (
                <Grid key={index} columns={{ minWidth: 200, repeat: "fit" }} gap={3} align="end">
                  <TextInput label={`Variant ${index + 1}`} value={variant.name} onChange={(value) => setVariant(index, { name: value })} />
                  <TextInput label="Price" inputMode="decimal" value={variant.price} onChange={(value) => setVariant(index, { price: value })} />
                  <Switch label="Default" value={variant.isDefault} onChange={(checked) => update("variants", draft.variants.map((row, rowIndex) => ({ ...row, isDefault: rowIndex === index ? checked : checked ? false : row.isDefault })))} />
                  <Switch label="Available" value={variant.isAvailable} onChange={(checked) => setVariant(index, { isAvailable: checked })} />
                  <HStack gap={1}>
                    <IconButton label={`Move variant ${index + 1} up`} icon={<ArrowUp size={16} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => moveVariant(index, -1)} />
                    <IconButton label={`Move variant ${index + 1} down`} icon={<ArrowDown size={16} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => moveVariant(index, 1)} />
                    <Button label={`Remove variant ${index + 1}`} variant="ghost" size="sm" onClick={() => update("variants", draft.variants.filter((_, rowIndex) => rowIndex !== index))} />
                  </HStack>
                </Grid>
              ))}
            </Panel>
            <Panel title="Modifier & add-on group" description="Optional new group">
              {existingGroups.length > 0 && <HStack gap={2} wrap="wrap">{existingGroups.map((group) => <StatusBadge key={group.id} tone="info">{`${group.name} · ${group.options.length} options`}</StatusBadge>)}</HStack>}
              <Grid columns={{ minWidth: 200, repeat: "fit" }} gap={4}>
                <TextInput label="Group name" value={modifierName} onChange={setModifierName} />
                <TextInput label="Minimum selections" inputMode="numeric" value={modifierMin} onChange={setModifierMin} />
                <TextInput label="Maximum selections" inputMode="numeric" value={modifierMax} onChange={setModifierMax} />
                <Switch label="Required group" value={modifierRequired} onChange={setModifierRequired} />
              </Grid>
              <HStack gap={2}>
                <Button label={modifierOptions.length >= 100 ? "100 options maximum" : "Add option"} variant="secondary" isDisabled={modifierOptions.length >= 100} onClick={() => setModifierOptions((current) => [...current, { name: "", price: "0", isDefault: false, isAvailable: true }])} />
              </HStack>
              {modifierOptions.map((option, index) => (
                <Grid key={index} columns={{ minWidth: 200, repeat: "fit" }} gap={3} align="end">
                  <TextInput label={`Option ${index + 1}`} value={option.name} onChange={(value) => setOption(index, { name: value })} />
                  <TextInput label="Price adjustment" inputMode="decimal" value={option.price} onChange={(value) => setOption(index, { price: value })} />
                  <Switch label="Default" value={option.isDefault} onChange={(checked) => setOption(index, { isDefault: checked })} />
                  <Switch label="Available" value={option.isAvailable} onChange={(checked) => setOption(index, { isAvailable: checked })} />
                  <Button label={`Remove option ${index + 1}`} variant="ghost" size="sm" onClick={() => setModifierOptions((current) => current.filter((_, rowIndex) => rowIndex !== index))} />
                </Grid>
              ))}
            </Panel>
            <Panel title="Availability & status" actions={<Button label="Open detailed availability" variant="ghost" size="sm" href="/dashboard/kiosk-experience/availability" />}>
              <Grid columns={{ minWidth: 220, repeat: "fit" }} gap={4}>
                <Selector label="Menu status" value={draft.status} onChange={(value) => update("status", value as MenuStatus)} options={[{ value: "draft", label: "Draft" }, { value: "shown", label: "Shown" }, { value: "hidden", label: "Hidden" }, { value: "unavailable", label: "Unavailable" }]} />
                <Switch label="Available for ordering" value={draft.available} onChange={(checked) => update("available", checked)} />
                <Switch label="Featured item" value={draft.featured} onChange={(checked) => update("featured", checked)} />
                <Switch label="Track stock" value={draft.trackStock} onChange={(checked) => update("trackStock", checked)} />
                {draft.trackStock && <TextInput label="Stock quantity" inputMode="numeric" value={draft.stock} onChange={(value) => update("stock", value)} />}
              </Grid>
              <Text type="supporting" color="secondary">No location override is exposed by the current product contract, so this item inherits business-wide settings.</Text>
            </Panel>
            <HStack gap={2} hAlign="end" wrap="wrap">
              <Button label="Save draft" variant="secondary" isLoading={busy} onClick={() => void save("draft")} />
              <Button label="Save and add another" variant="secondary" isLoading={busy} onClick={() => void save("another")} />
              <Button label={editingId ? "Update item" : "Save item"} variant="primary" type="submit" isLoading={busy} />
            </HStack>
          </VStack>
        </form>
      )}
    </VStack>
  );
}

function CategoryForm({ business, categories, refreshed, onDone, setToast }: { business: Business; categories: Category[]; refreshed: () => Promise<void>; onDone: (id: string) => void; setToast: Setter }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [order, setOrder] = useState(String(categories.length + 1));
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = name.trim();
    const sortOrder = Math.max(0, Number(order || 1) - 1);
    if (clean.length < 2) { setToast({ text: "Enter a category name.", status: "danger" }); return; }
    if (categories.some((category) => category.name.toLowerCase() === clean.toLowerCase())) { setToast({ text: "A category with this name already exists.", status: "danger" }); return; }
    setBusy(true);
    try {
      const imagePath = image ? (await api.uploadProductImage(business.id, image)).path : null;
      const saved = await api.createCategory(business.id, { name: clean, description: description.trim() || null, image_path: imagePath, is_active: active, sort_order: sortOrder });
      await refreshed();
      setToast({ text: "Category created." });
      onDone(saved.id);
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Category was not created.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <Panel title="Create category" description="Your item form is preserved.">
        <Grid columns={{ minWidth: 240, repeat: "fit" }} gap={4}>
          <TextInput label="Category name" isRequired value={name} onChange={setName} />
          <TextInput label="Display order" inputMode="numeric" value={order} onChange={setOrder} />
        </Grid>
        <TextArea label="Description" value={description} onChange={setDescription} maxLength={500} />
        <FileInput label="Category image" accept="image/png,image/jpeg,image/webp" value={image} onChange={(file) => setImage(file as File | null)} />
        <Switch label="Visible on kiosk" value={active} onChange={setActive} description="Items inherit category kiosk visibility. Location visibility is not exposed by the current category contract." />
        <HStack gap={2} hAlign="end">
          <Button label="Back to item" variant="secondary" onClick={() => onDone("")} />
          <Button label="Create category" variant="primary" type="submit" isLoading={busy} />
        </HStack>
      </Panel>
    </form>
  );
}

function CombosMode({ business, products, categories, combos, previewKey, refreshed, setToast }: { business: Business; products: Product[]; categories: Category[]; combos: Combo[]; previewKey: number; refreshed: () => Promise<void>; setToast: Setter }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [editor, setEditor] = useState<Combo | "new" | null>(null);
  const [confirm, setConfirm] = useState<Combo | null>(null);
  const [busy, setBusy] = useState(false);
  const filtered = combos.filter((combo) => (!search || combo.name.toLowerCase().includes(search.toLowerCase())) && (status === "all" || combo.status === status) && (category === "all" || combo.category_id === category));
  useEffect(() => {
    const open = () => setEditor("new");
    window.addEventListener("menutap:new-combo", open);
    return () => window.removeEventListener("menutap:new-combo", open);
  }, []);
  const openCombo = async (combo: Combo) => {
    setBusy(true);
    try {
      setEditor((await api.combo(combo.id)).combo);
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Combo details could not be loaded.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const duplicate = async (combo: Combo) => {
    setBusy(true);
    try {
      await api.duplicateCombo(combo.id);
      await refreshed();
      setToast({ text: "Combo duplicated as a draft." });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Combo was not duplicated.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await api.updateCombo(confirm.id, { status: "hidden" });
      setConfirm(null);
      await refreshed();
      setToast({ text: "Combo archived." });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Combo was not archived.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const toggleAvailability = async (combo: Combo) => {
    const next = combo.status === "shown" ? "unavailable" : "shown";
    setBusy(true);
    try {
      if (next === "shown") {
        const detail = (await api.combo(combo.id)).combo;
        const unavailableRequired = (detail.sections || []).some((section) => section.required && section.options.some((option) => option.existing_item_id && !products.find((item) => item.id === option.existing_item_id)?.is_available));
        if (unavailableRequired) {
          setEditor(detail);
          setToast({ text: "Review unavailable items in required combo groups before making this combo available.", status: "danger" });
          return;
        }
      }
      await api.updateCombo(combo.id, { status: next });
      await refreshed();
      setToast({ text: `${combo.name} is now ${next === "shown" ? "available" : "unavailable"}.` });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Combo availability was not saved.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const clearFilters = () => { setSearch(""); setStatus("all"); setCategory("all"); };

  return (
    <VStack gap={4}>
      <Toolbar>
        <TextInput type="search" label="Search combos" placeholder="Search combos" value={search} onChange={setSearch} />
        <Selector label="Combo status" value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "shown", label: "Published" }, { value: "draft", label: "Draft" }, { value: "unavailable", label: "Unavailable" }, { value: "hidden", label: "Archived" }]} />
        <Selector label="Combo category" value={category} onChange={setCategory} options={[{ value: "all", label: "All categories" }, ...categories.map((entry) => ({ value: entry.id, label: entry.name }))]} />
        {(search || status !== "all" || category !== "all") && <Button label="Clear filters" variant="ghost" onClick={clearFilters} />}
        <Button label="Create combo" variant="primary" onClick={() => setEditor("new")} icon={<Plus size={17} aria-hidden="true" />} />
      </Toolbar>
      <Grid columns={{ minWidth: 300, repeat: "fit" }} gap={5}>
        <VStack gap={4}>
          {!combos.length ? <EmptyBlock title="Create your first combo" action={<Button label="Create combo" variant="primary" onClick={() => setEditor("new")} />} />
            : !filtered.length ? <EmptyBlock title="No matching combos" action={<Button label="Clear filters" variant="secondary" onClick={clearFilters} />} />
            : <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4}>
              {filtered.map((combo) => (
                <Panel key={combo.id} padding={4}>
                  <VStack gap={3}>
                    <ClickableCard label={`Edit ${combo.name}`} onClick={() => void openCombo(combo)} padding={0} isDisabled={busy}>
                      <VStack gap={2}>
                        {combo.image_path ? <Image unoptimized src={assetUrl(combo.image_path) || ""} alt="" width={220} height={128} style={{ width: "100%", height: "auto", borderRadius: "var(--radius-element)" }} /> : null}
                        <HStack gap={2} hAlign="between" vAlign="center">
                          <StatusBadge tone={statusTone(combo.status)}>{readable(combo.status)}</StatusBadge>
                          <Text type="supporting" color="secondary">{`${combo.included_items_count || 0} included items`}</Text>
                        </HStack>
                        <Text type="label">{combo.name}</Text>
                        <Text type="supporting" color="secondary">{combo.description || "No description"}</Text>
                        <Text type="body" weight="semibold">{formatMenuPrice(combo.price, business.currency_code || "INR")}</Text>
                      </VStack>
                    </ClickableCard>
                    <HStack gap={1} wrap="wrap">
                      {(combo.status === "shown" || combo.status === "unavailable") && <Button label={combo.status === "shown" ? `Mark ${combo.name} unavailable` : `Mark ${combo.name} available`} variant="ghost" size="sm" isDisabled={busy} onClick={() => void toggleAvailability(combo)}>{combo.status === "shown" ? "Unavailable" : "Available"}</Button>}
                      <Button label={`Duplicate ${combo.name}`} variant="ghost" size="sm" icon={<Copy size={14} aria-hidden="true" />} isDisabled={busy} onClick={() => void duplicate(combo)}>Duplicate</Button>
                      <Button label={`Archive ${combo.name}`} variant="ghost" size="sm" isDisabled={busy} onClick={() => setConfirm(combo)}>Archive</Button>
                    </HStack>
                  </VStack>
                </Panel>
              ))}
            </Grid>}
        </VStack>
        <VStack gap={3}>
          <Panel title="Portrait draft preview" padding={4} actions={<Button label="Open full preview" variant="ghost" size="sm" href="/dashboard/kiosk-experience/preview" />}>
            <RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={previewKey} />
          </Panel>
        </VStack>
      </Grid>
      <ComboEditor key={editor === "new" ? "new" : editor?.id || "closed"} business={business} products={products} categories={categories} combo={editor} onClose={() => setEditor(null)} refreshed={refreshed} setToast={setToast} />
      <ConfirmDialog isOpen={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={() => void archive()} title="Archive combo?" description={`${confirm?.name || "This combo"} will be hidden from the kiosk. Its configuration is preserved.`} confirmLabel="Archive" loading={busy} />
    </VStack>
  );
}

const newComboSection = (index: number): ComboSectionInput => ({ title: index ? `Selection group ${index + 1}` : "Included items", section_type: index ? "optional_upgrades" : "included_items", required: index === 0, min_select: index === 0 ? 1 : 0, max_select: 1, sort_order: index, options: [] });
const sectionInputs = (combo: Combo | null): ComboSectionInput[] => combo?.sections?.length ? combo.sections.map((section) => ({ id: section.id, title: section.title, section_type: section.section_type, required: section.required, min_select: section.min_select, max_select: section.max_select, sort_order: section.sort_order, options: section.options.map((option) => ({ id: option.id, source_type: option.source_type, existing_item_id: option.existing_item_id, exclusive_name: option.exclusive_name, exclusive_description: option.exclusive_description, exclusive_image_path: option.exclusive_image_path, exclusive_type: option.exclusive_type, quantity: option.quantity, price_impact: option.price_impact, default_selected: option.default_selected, removable: option.removable, visible: option.visible, sort_order: option.sort_order })) })) : [newComboSection(0)];

function ComboEditor({ business, products, categories, combo, onClose, refreshed, setToast }: { business: Business; products: Product[]; categories: Category[]; combo: Combo | "new" | null; onClose: () => void; refreshed: () => Promise<void>; setToast: Setter }) {
  const current = combo === "new" || !combo ? null : combo;
  const savedPricing = current?.tags.find((tag) => tag.startsWith("pricing:"))?.slice(8);
  const [name, setName] = useState(current?.name || "");
  const [description, setDescription] = useState(current?.description || "");
  const [categoryId, setCategoryId] = useState(current?.category_id || "");
  const [price, setPrice] = useState(current ? String(current.price) : "");
  const [pricingMode, setPricingMode] = useState<"fixed" | "discount" | "base">(savedPricing === "discount" || savedPricing === "base" ? savedPricing : "fixed");
  const [discount, setDiscount] = useState(current?.original_price ? String(Math.max(0, current.original_price - current.price)) : "0");
  const [status, setStatus] = useState<MenuStatus>(current?.status || "draft");
  const [sections, setSections] = useState<ComboSectionInput[]>(sectionInputs(current));
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const productMap = useMemo(() => new Map(products.map((item) => [item.id, item])), [products]);
  const includedTotal = sections.filter((section) => section.section_type === "included_items").flatMap((section) => section.options).filter((option) => option.default_selected && option.existing_item_id).reduce((total, option) => total + Number(productMap.get(option.existing_item_id || "")?.price || 0) * option.quantity, 0);
  const resolvedPrice = pricingMode === "discount" ? Math.max(0, includedTotal - Number(discount || 0)) : Number(price || 0);
  const setSection = (index: number, patch: Partial<ComboSectionInput>) => setSections((currentSections) => currentSections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section));
  const toggleProduct = (sectionIndex: number, product: Product, checked: boolean) => setSections((currentSections) => currentSections.map((section, index) => {
    if (index !== sectionIndex) return section;
    const existing = section.options.find((option) => option.existing_item_id === product.id);
    if (!checked) return { ...section, options: section.options.filter((option) => option.existing_item_id !== product.id) };
    if (existing) return section;
    return { ...section, options: [...section.options, { source_type: "existing_item", existing_item_id: product.id, quantity: 1, price_impact: 0, default_selected: section.section_type === "included_items", removable: section.section_type !== "included_items", visible: true, sort_order: section.options.length }] };
  }));
  const updateOption = (sectionIndex: number, optionIndex: number, patch: Partial<ComboSectionInput["options"][number]>) => setSections((currentSections) => currentSections.map((section, index) => index === sectionIndex ? { ...section, options: section.options.map((option, currentOption) => currentOption === optionIndex ? { ...option, ...patch } : option) } : section));
  const moveSection = (index: number, amount: number) => {
    const target = index + amount;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    setSections(next.map((section, sort_order) => ({ ...section, sort_order })));
  };
  const save = async () => {
    const invalidSection = sections.find((section) => !section.title.trim() || section.min_select < 0 || section.max_select < section.min_select || section.max_select > section.options.length);
    const shownWithoutIncluded = status === "shown" && !sections.some((section) => section.section_type === "included_items" && section.options.length);
    if (name.trim().length < 2 || !Number.isFinite(resolvedPrice) || resolvedPrice < 0 || invalidSection || shownWithoutIncluded) { setToast({ text: "Complete the combo name, pricing, and valid selection limits before saving.", status: "danger" }); return; }
    setBusy(true);
    try {
      const uploadedPath = image ? (await api.uploadProductImage(business.id, image)).path : null;
      const payload: ComboPayload = { name: name.trim(), description: description.trim() || null, category_id: categoryId || null, image_path: uploadedPath || current?.image_path || null, price: resolvedPrice, original_price: pricingMode === "discount" ? includedTotal : null, display_badge: current?.display_badge || null, tags: [...(current?.tags || []).filter((tag) => !tag.startsWith("pricing:")), `pricing:${pricingMode}`], status, sort_order: current?.sort_order || 0, availability_type: current?.availability_type || "always", available_days: current?.available_days || [], available_start_time: current?.available_start_time || null, available_end_time: current?.available_end_time || null, sections };
      if (combo === "new") await api.createCombo(business.id, payload);
      else if (combo) await api.updateCombo(combo.id, payload);
      await refreshed();
      setToast({ text: combo === "new" ? "Combo created." : "Combo updated." });
      onClose();
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "Combo was not saved.", status: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const currency = business.currency_code || "INR";

  return (
    <DetailDrawer title={combo === "new" ? "Create combo" : `Edit ${combo?.name || "combo"}`} isOpen={Boolean(combo)} onClose={onClose} width={640} footer={<><Button label="Cancel" variant="secondary" onClick={onClose} /><Button label="Save combo" variant="primary" isLoading={busy} onClick={() => void save()} /></>}>
      <Panel title="Basics & pricing" padding={4}>
        <TextInput label="Combo name" isRequired value={name} onChange={setName} />
        <TextArea label="Description" value={description} onChange={setDescription} maxLength={1000} />
        <FileInput label="Combo image" accept="image/png,image/jpeg,image/webp" value={image} onChange={(file) => setImage(file as File | null)} />
        <Selector label="Category" value={categoryId} onChange={setCategoryId} options={[{ value: "", label: "Uncategorised" }, ...categories.map((entry) => ({ value: entry.id, label: entry.name }))]} />
        <Selector label="Pricing model" value={pricingMode} onChange={(value) => setPricingMode(value as "fixed" | "discount" | "base")} options={[{ value: "fixed", label: "Fixed combo price" }, { value: "discount", label: "Included-item sum minus discount" }, { value: "base", label: "Base price plus upgrades" }]} />
        {pricingMode !== "discount" && <TextInput label={`${pricingMode === "base" ? "Base" : "Fixed"} price (${currency})`} inputMode="decimal" isRequired value={price} onChange={setPrice} />}
        {pricingMode === "discount" && <TextInput label={`Discount amount (${currency})`} inputMode="decimal" value={discount} onChange={setDiscount} />}
        <DetailRow label="Saved combo price">{formatMenuPrice(resolvedPrice, currency)}</DetailRow>
        <Selector label="Publish / availability state" value={status} onChange={(value) => setStatus(value as MenuStatus)} options={[{ value: "draft", label: "Draft" }, { value: "shown", label: "Shown and available" }, { value: "unavailable", label: "Shown but unavailable" }, { value: "hidden", label: "Archived" }]} />
      </Panel>
      <Panel title="Selection groups" description="Define included choices and optional upgrades." actions={<Button label="Add group" variant="secondary" isDisabled={sections.length >= 100} onClick={() => setSections((currentSections) => [...currentSections, newComboSection(currentSections.length)])} />}>
        {sections.map((section, sectionIndex) => (
          <Panel key={section.id || sectionIndex} padding={3} title={section.title || `Group ${sectionIndex + 1}`} actions={<HStack gap={1}><IconButton label={`Move group ${sectionIndex + 1} up`} icon={<ArrowUp size={16} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => moveSection(sectionIndex, -1)} /><IconButton label={`Move group ${sectionIndex + 1} down`} icon={<ArrowDown size={16} aria-hidden="true" />} variant="ghost" size="sm" onClick={() => moveSection(sectionIndex, 1)} />{sections.length > 1 && <Button label={`Remove group ${sectionIndex + 1}`} variant="destructive" size="sm" onClick={() => { if (window.confirm(`Remove ${section.title}?`)) setSections((currentSections) => currentSections.filter((_, index) => index !== sectionIndex)); }} />}</HStack>}>
            <Grid columns={{ minWidth: 200, repeat: "fit" }} gap={3} align="end">
              <TextInput label={`Group ${sectionIndex + 1} name`} value={section.title} onChange={(value) => setSection(sectionIndex, { title: value })} />
              <Selector label="Group type" value={section.section_type} onChange={(value) => setSection(sectionIndex, { section_type: value as ComboSectionInput["section_type"] })} options={[{ value: "included_items", label: "Included items" }, { value: "optional_upgrades", label: "Optional upgrades" }]} />
              <TextInput label="Minimum" inputMode="numeric" value={String(section.min_select)} onChange={(value) => setSection(sectionIndex, { min_select: Number(value) })} />
              <TextInput label="Maximum" inputMode="numeric" value={String(section.max_select)} onChange={(value) => setSection(sectionIndex, { max_select: Number(value) })} />
              <Switch label="Required" value={section.required} onChange={(checked) => setSection(sectionIndex, { required: checked })} />
            </Grid>
            <VStack gap={2}>
              {section.options.length >= 100 && <Text type="supporting" color="secondary">This group is at the 100-option limit. Remove an item to add another.</Text>}
              {products.filter((item) => item.menu_status !== "hidden").map((item) => {
                const optionIndex = section.options.findIndex((option) => option.existing_item_id === item.id);
                const option = section.options[optionIndex];
                return (
                  <VStack key={item.id} gap={2}>
                    <CheckboxInput label={item.name} description={item.is_available ? formatMenuPrice(item.price, currency) : "Unavailable"} value={optionIndex >= 0} isDisabled={optionIndex < 0 && section.options.length >= 100} onChange={(checked) => toggleProduct(sectionIndex, item, checked)} />
                    {option && (
                      <Grid columns={{ minWidth: 160, repeat: "fit" }} gap={3} align="end">
                        <TextInput label={`Quantity for ${item.name}`} inputMode="numeric" value={String(option.quantity)} onChange={(value) => updateOption(sectionIndex, optionIndex, { quantity: Number(value) })} />
                        <TextInput label={`Upgrade price for ${item.name}`} inputMode="decimal" value={String(option.price_impact)} onChange={(value) => updateOption(sectionIndex, optionIndex, { price_impact: Number(value) })} />
                        <Switch label="Default" value={option.default_selected} onChange={(checked) => setSection(sectionIndex, { options: section.options.map((entry, index) => index === optionIndex ? { ...entry, default_selected: checked } : entry) })} />
                        <Switch label="Visible" value={option.visible} onChange={(checked) => setSection(sectionIndex, { options: section.options.map((entry, index) => index === optionIndex ? { ...entry, visible: checked } : entry) })} />
                      </Grid>
                    )}
                  </VStack>
                );
              })}
              {section.options.some((option) => option.existing_item_id && !productMap.get(option.existing_item_id)?.is_available) && <NoticeBanner tone="warning" title="Needs attention" description="This group includes an unavailable item. Review the selection before publishing." />}
            </VStack>
          </Panel>
        ))}
      </Panel>
      <Panel title="Portrait kiosk preview" padding={3}>
        <RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={`combo-${combo === "new" ? "new" : combo?.id}`} />
      </Panel>
    </DetailDrawer>
  );
}
