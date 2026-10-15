"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, ChevronDown, ChevronRight, Copy, Download, Eye, Grid2X2, List, MoreHorizontal, Plus } from "lucide-react";
import { RealKioskFrame } from "@/app/admin/_components/real-kiosk-frame";
import { api, assetUrl } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import type { Category, Combo, ComboPayload, ComboSectionInput, ItemType, KioskSetupOverview, MenuStatus, ModifierGroup, Product } from "@/lib/types";
import type { Business } from "@/services/api";
import { Button, Checkbox, ConfirmationDialog, DataState, DetailsDrawer, Input, SearchInput, Select, StatusPill, StickyFormActions, Textarea, Toast, Toggle, UploadField } from "@/components/ui/DashboardUI";

type MenuMode = "items" | "add-item" | "combos";
type MenuScope = "all" | "available" | "unavailable" | "attention";
type VariantDraft = { name: string; price: string; isDefault: boolean; isAvailable: boolean };
type OptionDraft = { name: string; price: string; isDefault: boolean; isAvailable: boolean };
type ItemDraft = { name: string; internalName: string; description: string; sku: string; price: string; compareAt: string; categoryId: string; itemType: ItemType; allergens: string; status: MenuStatus; available: boolean; featured: boolean; trackStock: boolean; stock: string; tags: string; variants: VariantDraft[] };
const emptyDraft = (): ItemDraft => ({ name: "", internalName: "", description: "", sku: "", price: "", compareAt: "", categoryId: "", itemType: "veg", allergens: "", status: "draft", available: true, featured: false, trackStock: false, stock: "", tags: "", variants: [] });
const readable = (value?: string | null) => (value || "Not set").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  const link = document.createElement("a"); link.href = url; link.download = "menu-items.csv"; link.click(); URL.revokeObjectURL(url);
}

export function ManageMenuSkeleton() {
  return <section className="mt-menu-manage" aria-label="Loading Manage Menu"><div className="mt-menu-skeleton mt-menu-skeleton--header" /><div className="mt-menu-skeleton mt-menu-skeleton--tabs" /><div className="mt-menu-skeleton mt-menu-skeleton--body" /></section>;
}

export function ManageMenuPage({ business, products, categories, combos, setup, reload }: { business: Business; products: Product[]; categories: Category[]; combos: Combo[]; setup: KioskSetupOverview | null; reload: () => Promise<void> }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mode: MenuMode = params.get("mode") === "add-item" ? "add-item" : params.get("mode") === "combos" ? "combos" : "items";
  const [previewKey, setPreviewKey] = useState(0);
  const [compactPreviewOpen, setCompactPreviewOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; status?: "success" | "danger" | "info" } | null>(null);
  const setMode = (next: MenuMode) => router.replace(`${pathname}?mode=${next}`);
  const refreshed = async () => { await reload(); setPreviewKey((value) => value + 1); };
  const headerAction = mode === "items" ? <Button onClick={() => setMode("add-item")}><Plus size={17} /> Add item</Button> : mode === "combos" ? <Button onClick={() => window.dispatchEvent(new CustomEvent("menutap:new-combo"))}><Plus size={17} /> Create combo</Button> : null;

  return <section className="mt-menu-manage">
    <header className="mt-menu-header"><div><h1>Manage Menu</h1><div className="mt-menu-header__meta"><span>{products.length} items</span><span>{categories.length} categories</span><span>{combos.length} combos</span><span>Saved {setup?.lastSavedAt ? new Date(setup.lastSavedAt).toLocaleString() : "not yet"}</span></div></div><div className="mt-menu-header__actions"><Link className="mt-button mt-button--secondary mt-menu-desktop-preview" href="/dashboard/kiosk-experience/preview"><Eye size={17} /> Preview kiosk</Link><Button className="mt-menu-mobile-preview" variant="secondary" onClick={() => setCompactPreviewOpen(true)}><Eye size={17} /> Preview kiosk</Button><Link className="mt-menu-draft" href="/dashboard/kiosk-experience/publish"><span>{setup?.unpublishedChanges || 0}</span> draft changes <ChevronRight size={15} /></Link>{headerAction}</div></header>
    <nav className="mt-menu-tabs" aria-label="Manage Menu modes">{(["items", "add-item", "combos"] as MenuMode[]).map((value) => <button key={value} type="button" aria-current={mode === value ? "page" : undefined} onClick={() => setMode(value)}>{value === "add-item" ? "Add Item" : readable(value)}</button>)}</nav>
    {mode === "items" ? <ItemsMode business={business} products={products} categories={categories} combos={combos} initialProductId={params.get("product") || ""} previewKey={previewKey} refreshed={refreshed} setMode={setMode} setToast={setToast} /> : mode === "add-item" ? <AddItemMode business={business} products={products} categories={categories} refreshed={refreshed} setToast={setToast} /> : <CombosMode business={business} products={products} categories={categories} combos={combos} previewKey={previewKey} refreshed={refreshed} setToast={setToast} />}
    {toast && <div className="mt-menu-toast"><Toast status={toast.status || "success"} onDismiss={() => setToast(null)}>{toast.text}{toast.undo && <button type="button" onClick={() => { toast.undo?.(); setToast(null); }}>{toast.status === "danger" ? "Retry" : "Undo"}</button>}</Toast></div>}
    <DetailsDrawer open={compactPreviewOpen} onClose={() => setCompactPreviewOpen(false)} title="Portrait kiosk preview" footer={<Button variant="secondary" onClick={() => setCompactPreviewOpen(false)}>Close</Button>}><RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={`compact-${previewKey}`} /></DetailsDrawer>
  </section>;
}

function ItemsMode({ business, products, categories, combos, initialProductId, previewKey, refreshed, setMode, setToast }: { business: Business; products: Product[]; categories: Category[]; combos: Combo[]; initialProductId: string; previewKey: number; refreshed: () => Promise<void>; setMode: (mode: MenuMode) => void; setToast: (toast: { text: string; undo?: () => void; status?: "success" | "danger" | "info" } | null) => void }) {
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
  const groups = [...categoryRows, { id: "uncategorised", name: "Uncategorised", business_id: business.id, sort_order: 999, is_active: true } as Category].map((entry) => ({ category: entry, items: visible.filter((item) => entry.id === "uncategorised" ? !item.category_id : item.category_id === entry.id) })).filter((group) => group.items.length || !filtered && group.category.id !== "uncategorised");

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
    try { await Promise.all(targets.map((row) => api.setAvailability(row.id, next))); setPreviewVersion((value) => value + 1); completeBulk(`${targets.length} items updated.`); }
    catch { setRows(products); setToast({ text: "Some items could not be updated. The local changes were reverted.", status: "danger" }); }
  };
  const moveSelected = async (categoryId: string) => {
    const targets = selectedRows(); if (!categoryId || !targets.length) return;
    setSaving(true);
    try { await Promise.all(targets.map((item) => api.updateProduct(item.id, { category_id: categoryId === "uncategorised" ? null : categoryId }))); setRows((current) => current.map((item) => selected.has(item.id) ? { ...item, category_id: categoryId === "uncategorised" ? null : categoryId } : item)); completeBulk(`${targets.length} items moved.`); }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Items were not moved.", status: "danger" }); }
    finally { setSaving(false); }
  };
  const tagSelected = async () => {
    const tag = window.prompt("Tag to add to selected items")?.trim(); if (!tag) return;
    const targets = selectedRows(); setSaving(true);
    try { await Promise.all(targets.map((item) => api.updateProduct(item.id, { tags: Array.from(new Set([...(item.tags || []), tag])) }))); setRows((current) => current.map((item) => selected.has(item.id) ? { ...item, tags: Array.from(new Set([...(item.tags || []), tag])) } : item)); completeBulk(`Tag added to ${targets.length} items.`); }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Tags were not updated.", status: "danger" }); }
    finally { setSaving(false); }
  };
  const addSelectedToCombo = async (comboId: string) => {
    if (!comboId) return; setSaving(true);
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
    } catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Items were not added to the combo.", status: "danger" }); }
    finally { setSaving(false); }
  };
  const removeSelectedFromCombos = async () => {
    if (!window.confirm("Remove the selected items from every combo that contains them?")) return;
    setSaving(true);
    try {
      const details = await Promise.all(combos.map((combo) => api.combo(combo.id).then((result) => result.combo)));
      const options = details.flatMap((combo) => combo.sections || []).flatMap((section) => section.options).filter((option) => option.existing_item_id && selected.has(option.existing_item_id));
      await Promise.all(options.map((option) => api.deleteComboOption(option.id)));
      completeBulk(`Removed ${options.length} combo references.`); await refreshed();
    } catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Combo references were not removed.", status: "danger" }); }
    finally { setSaving(false); }
  };
  const moveItem = (item: Product, destination: "up" | "down" | "top" | "bottom") => {
    const indexes = rows.map((row, index) => row.category_id === item.category_id ? index : -1).filter((index) => index >= 0);
    const current = indexes.indexOf(rows.findIndex((row) => row.id === item.id));
    const target = destination === "top" ? 0 : destination === "bottom" ? indexes.length - 1 : current + (destination === "up" ? -1 : 1);
    if (current < 0 || target < 0 || target >= indexes.length) return;
    const reordered = [...rows]; [reordered[indexes[current]], reordered[indexes[target]]] = [reordered[indexes[target]], reordered[indexes[current]]]; setRows(reordered);
  };
  const moveCategory = (entry: Category, destination: "up" | "down" | "top" | "bottom") => {
    const current = categoryRows.findIndex((row) => row.id === entry.id);
    const target = destination === "top" ? 0 : destination === "bottom" ? categoryRows.length - 1 : current + (destination === "up" ? -1 : 1);
    if (current < 0 || target < 0 || target >= categoryRows.length) return;
    const reordered = [...categoryRows]; [reordered[current], reordered[target]] = [reordered[target], reordered[current]]; setCategoryRows(reordered);
  };
  const saveOrder = async () => {
    setSaving(true);
    try { await Promise.all([...rows.map((item, index) => api.updateProduct(item.id, { sort_order: index })), ...categoryRows.map((entry, index) => api.updateCategory(entry.id, { sort_order: index }))]); setOrganizing(false); await refreshed(); setToast({ text: "Menu order saved." }); }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Menu order was not saved.", status: "danger" }); }
    finally { setSaving(false); }
  };
  const renameCategory = async (entry: Category) => {
    const name = window.prompt("Category name", entry.name)?.trim(); if (!name || name === entry.name) return;
    try { await api.updateCategory(entry.id, { name }); setCategoryRows((current) => current.map((row) => row.id === entry.id ? { ...row, name } : row)); setToast({ text: "Category renamed." }); }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Category was not renamed.", status: "danger" }); }
  };
  const toggleCategory = async (entry: Category) => {
    try { await api.updateCategory(entry.id, { is_active: !entry.is_active }); setCategoryRows((current) => current.map((row) => row.id === entry.id ? { ...row, is_active: !row.is_active } : row)); setToast({ text: `${entry.name} is now ${entry.is_active ? "hidden" : "visible"}.` }); }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Category visibility was not saved.", status: "danger" }); }
  };
  const archiveConfirmed = async () => {
    if (!confirm) return; const pending = confirm; setSaving(true);
    try {
      if (confirm.kind === "item") { await api.updateProduct(confirm.item.id, { menu_status: "hidden", is_available: false }); setRows((current) => current.map((item) => item.id === confirm.item.id ? { ...item, menu_status: "hidden", is_available: false } : item)); setDrawerItem(null); setToast({ text: "Item archived.", undo: () => void api.updateProduct(confirm.item.id, { menu_status: confirm.item.menu_status, is_available: confirm.item.is_available }).then(() => void refreshed()) }); }
      else if (confirm.kind === "bulk") { const targets = selectedRows(); await Promise.all(targets.map((item) => api.updateProduct(item.id, { menu_status: "hidden", is_available: false }))); setRows((current) => current.map((item) => selected.has(item.id) ? { ...item, menu_status: "hidden", is_available: false } : item)); completeBulk(`${targets.length} items archived.`); }
      else { await api.updateCategory(confirm.category.id, { is_active: false }); setCategoryRows((current) => current.map((entry) => entry.id === confirm.category.id ? { ...entry, is_active: false } : entry)); setToast({ text: "Category archived." }); }
      setConfirm(null); await refreshed();
    } catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Couldn’t archive this item.", status: "danger", undo: () => { setConfirm(pending); setToast(null); } }); }
    finally { setSaving(false); }
  };

  return <div className="mt-menu-content">
    <div className="mt-menu-toolbar">
      <div className="mt-menu-toolbar__filters"><SearchInput label="Search menu items" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items or SKU" /><label><span className="mt-sr-only">Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categoryRows.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label><span className="mt-sr-only">Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="shown">Published</option><option value="draft">Draft</option><option value="hidden">Archived</option><option value="unavailable">Unavailable</option></select></label><label><span className="mt-sr-only">Dietary</span><select value={dietary} onChange={(event) => setDietary(event.target.value)}><option value="all">All dietary</option><option value="veg">Vegetarian</option><option value="non_veg">Non-vegetarian</option><option value="retail">Retail</option><option value="service">Service</option><option value="other">Other</option></select></label><details className="mt-menu-more"><summary><MoreHorizontal size={18} /> More Filters</summary><div><button type="button" onClick={() => exportProducts(rows, business.currency_code || "", business.id)}><Download size={15} /> Export menu</button><Link href="/dashboard/kiosk-experience/availability">Detailed availability</Link></div></details></div>
      <div className="mt-menu-toolbar__actions"><Button variant="secondary" onClick={() => setOrganizing((value) => !value)}>{organizing ? "Stop organizing" : "Organize"}</Button><div className="mt-menu-view" aria-label="Item view"><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={18} /><span className="mt-sr-only">List view</span></button><button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Grid2X2 size={18} /><span className="mt-sr-only">Grid view</span></button></div></div>
    </div>
    <div className="mt-menu-scopes" role="group" aria-label="Availability and attention filter">{(["all", "available", "unavailable", "attention"] as MenuScope[]).map((value) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{value === "attention" && <AlertTriangle size={15} />}{readable(value)}<span>{value === "all" ? rows.length : value === "available" ? rows.filter(isProductAvailable).length : value === "unavailable" ? rows.filter((item) => !isProductAvailable(item)).length : rows.filter((item) => itemAttentionIssues(item).length).length}</span></button>)}</div>
    {filtered && <div className="mt-menu-filter-chips" aria-label="Active filters">{search && <button type="button" onClick={() => setSearch("")}>Search: {search} ×</button>}{category !== "all" && <button type="button" onClick={() => setCategory("all")}>Category: {categoryRows.find((entry) => entry.id === category)?.name || "Unknown"} ×</button>}{status !== "all" && <button type="button" onClick={() => setStatus("all")}>Status: {readable(status)} ×</button>}{dietary !== "all" && <button type="button" onClick={() => setDietary("all")}>Dietary: {readable(dietary)} ×</button>}{scope !== "all" && <button type="button" onClick={() => setScope("all")}>{readable(scope)} ×</button>}<button type="button" onClick={clearFilters}>Clear all</button></div>}
    <div className="mt-menu-layout">
      <div className={`mt-menu-catalog mt-menu-catalog--${view}`}>
        <div className="mt-menu-summary"><span>{visible.length} of {rows.length} items</span></div>
        {!rows.length ? <DataState kind="empty" title="Build your menu" description="Add your first item to begin." action={<Button onClick={() => setMode("add-item")}>Add first item</Button>} /> : !visible.length ? <DataState kind="filtered-empty" title="No matching items" action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} /> : groups.map((group) => <section className="mt-menu-category" key={group.category.id}>
          <header><button className="mt-menu-category__toggle" type="button" aria-expanded={!collapsed.has(group.category.id)} onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.category.id)) next.delete(group.category.id); else next.add(group.category.id); return next; })}><ChevronDown size={17} /><span><strong>{group.category.name}</strong><small>{group.items.length} items{group.category.id !== "uncategorised" && !group.category.is_active ? " · Hidden" : ""}</small></span></button>
          {group.category.id !== "uncategorised" && (organizing ? <div className="mt-menu-reorder"><button type="button" aria-label={`Move ${group.category.name} to top`} onClick={() => moveCategory(group.category, "top")}><ChevronsUp size={17} /></button><button type="button" aria-label={`Move ${group.category.name} up`} onClick={() => moveCategory(group.category, "up")}><ArrowUp size={17} /></button><button type="button" aria-label={`Move ${group.category.name} down`} onClick={() => moveCategory(group.category, "down")}><ArrowDown size={17} /></button><button type="button" aria-label={`Move ${group.category.name} to bottom`} onClick={() => moveCategory(group.category, "bottom")}><ChevronsDown size={17} /></button></div> : <details className="mt-menu-more"><summary aria-label={`Actions for ${group.category.name}`}><MoreHorizontal size={18} /></summary><div><button type="button" onClick={() => void renameCategory(group.category)}>Rename</button><button type="button" onClick={() => void toggleCategory(group.category)}>{group.category.is_active ? "Hide from kiosk" : "Show on kiosk"}</button><button type="button" onClick={() => { setCategory(group.category.id); setScope("unavailable"); }}>Review availability</button><button type="button" onClick={() => setConfirm({ kind: "category", category: group.category })}>Archive</button></div></details>)}</header>
          {!collapsed.has(group.category.id) && <div>{group.items.length ? group.items.map((item) => {
            const issues = itemAttentionIssues(item);
            return <article className="mt-menu-item" key={item.id}><Checkbox label={<span className="mt-sr-only">Select {item.name}</span>} checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />{item.primary_image_path ? <Image unoptimized src={assetUrl(item.primary_image_path) || ""} alt="" width={52} height={52} /> : <div className="mt-menu-item__placeholder" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</div>}<button className="mt-menu-item__identity" type="button" onClick={() => setDrawerItem(item)}><strong>{item.name}</strong><span>{readable(item.item_type)}{item.sku ? ` · ${item.sku}` : ""}{item.tags?.length ? ` · ${item.tags.slice(0, 2).join(", ")}` : ""}</span></button><strong className="mt-menu-item__price">{formatMenuPrice(item.price, business.currency_code || "INR")}</strong>{organizing ? <div className="mt-menu-reorder"><button type="button" aria-label={`Move ${item.name} to top`} onClick={() => moveItem(item, "top")}><ChevronsUp size={17} /></button><button type="button" aria-label={`Move ${item.name} up`} onClick={() => moveItem(item, "up")}><ArrowUp size={17} /></button><button type="button" aria-label={`Move ${item.name} down`} onClick={() => moveItem(item, "down")}><ArrowDown size={17} /></button><button type="button" aria-label={`Move ${item.name} to bottom`} onClick={() => moveItem(item, "bottom")}><ChevronsDown size={17} /></button></div> : <><Toggle label={<span className="mt-sr-only">{item.name} availability</span>} checked={item.is_available} onChange={(event) => void changeAvailability(item, event.target.checked)} />{!isProductAvailable(item) && item.track_stock && <StatusPill status="danger">Out of stock</StatusPill>}<StatusPill status={item.menu_status === "shown" ? "success" : item.menu_status === "draft" ? "warning" : "neutral"}>{readable(item.menu_status)}</StatusPill>{issues.length > 0 && <button className="mt-menu-attention" type="button" title={issues.join(", ")} aria-label={`Review ${item.name}: ${issues.join(", ")}`} onClick={() => setDrawerItem(item)}><AlertTriangle size={17} /></button>}<button className="mt-menu-row-more" type="button" aria-label={`Open ${item.name} details`} title="Open item details" onClick={() => setDrawerItem(item)}><MoreHorizontal size={19} /></button></>}</article>;
          }) : <DataState kind="empty" title={`No items in ${group.category.name}`} action={<Button variant="secondary" onClick={() => { window.sessionStorage.setItem("menutap-new-category-id", group.category.id); setMode("add-item"); }}>Add item to {group.category.name}</Button>} />}</div>}
        </section>)}
      </div>
      <aside className="mt-menu-preview"><div><span>Portrait draft preview</span><Link href="/dashboard/kiosk-experience/preview">Open full preview</Link></div><RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={previewVersion} /></aside>
    </div>
    {selected.size > 0 && <div className="mt-menu-bulk" role="toolbar" aria-label="Bulk item actions"><strong>{selected.size} selected</strong><Button variant="secondary" disabled={saving} onClick={() => void bulkAvailability(true)}>Available</Button><Button variant="secondary" disabled={saving} onClick={() => void bulkAvailability(false)}>Unavailable</Button><label><span className="mt-sr-only">Move selected items</span><select defaultValue="" onChange={(event) => { void moveSelected(event.target.value); event.target.value = ""; }}><option value="">Move category…</option><option value="uncategorised">Uncategorised</option>{categoryRows.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>{combos.length > 0 && <label><span className="mt-sr-only">Add selected items to combo</span><select defaultValue="" onChange={(event) => { void addSelectedToCombo(event.target.value); event.target.value = ""; }}><option value="">Add to combo…</option>{combos.map((combo) => <option key={combo.id} value={combo.id}>{combo.name}</option>)}</select></label>}<Button variant="secondary" disabled={saving || !combos.length} onClick={() => void removeSelectedFromCombos()}>Remove from combos</Button><Button variant="secondary" disabled={saving} onClick={() => void tagSelected()}>Add tag</Button><Button variant="secondary" onClick={() => exportProducts(selectedRows(), business.currency_code || "")}>Export selected</Button><Button variant="danger" disabled={saving} onClick={() => setConfirm({ kind: "bulk" })}>Archive</Button><Button variant="tertiary" onClick={() => setSelected(new Set())}>Clear</Button></div>}
    {organizing && <StickyFormActions><Button variant="secondary" onClick={() => { setRows(products); setCategoryRows(categories); setOrganizing(false); }}>Cancel</Button><Button loading={saving} onClick={() => void saveOrder()}>Save order</Button></StickyFormActions>}
    <ItemDrawer key={drawerItem?.id || "closed"} business={business} item={drawerItem} categoryName={categoryRows.find((entry) => entry.id === drawerItem?.category_id)?.name} previewKey={previewVersion} onClose={() => setDrawerItem(null)} onArchive={() => drawerItem && setConfirm({ kind: "item", item: drawerItem })} onEdit={() => { setDrawerItem(null); setMode("add-item"); window.sessionStorage.setItem("menutap-edit-item", drawerItem?.id || ""); }} />
    <ConfirmationDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={() => void archiveConfirmed()} title={confirm?.kind === "bulk" ? "Archive selected items?" : confirm?.kind === "category" ? "Archive category?" : "Archive item?"} description={confirm?.kind === "bulk" ? `${selected.size} items will be hidden and marked unavailable.` : confirm?.kind === "category" ? `${confirm.category.name} will be hidden from the kiosk. Its items will not be deleted.` : `${confirm?.item.name || "This item"} will be hidden and marked unavailable.`} confirmLabel="Archive" destructive loading={saving} />
  </div>;
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
  return <DetailsDrawer open={Boolean(item)} onClose={onClose} title={item?.name || "Item details"} footer={<><Button variant="danger" onClick={onArchive}>Archive</Button><Button onClick={onEdit}>Edit item</Button></>}>
    <div className="mt-menu-drawer-tabs" role="tablist" aria-label="Item detail sections">{["overview", "options", "locations", "preview", "activity"].map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{value === "options" ? "Options & Add-ons" : value === "preview" ? "Kiosk Preview" : readable(value)}</button>)}</div>
    {item && tab === "overview" && <><dl className="mt-menu-details"><div><dt>Price</dt><dd>{formatMenuPrice(item.price, business.currency_code || "INR")}</dd></div><div><dt>Status</dt><dd>{readable(item.menu_status)}</dd></div><div><dt>Availability</dt><dd>{item.is_available ? "Available" : "Unavailable"}</dd></div><div><dt>Category</dt><dd>{categoryName || "Uncategorised"}</dd></div><div><dt>Dietary / type</dt><dd>{readable(item.item_type)}</dd></div><div><dt>Stock</dt><dd>{item.track_stock ? item.stock_quantity ?? 0 : "Not tracked"}</dd></div></dl>{issues.length > 0 && <DataState kind="info" title="Needs attention" description={issues.join(" · ")} action={<Button variant="secondary" onClick={onEdit}>Correct item</Button>} />}</>}
    {tab === "options" && <>{groupError && <DataState kind="recoverable-error" title="Options could not be refreshed" description={groupError} />}{groups.length ? <div className="mt-menu-option-list">{groups.map((group) => <section key={group.id}><strong>{group.name}</strong><span>{group.is_required ? "Required" : "Optional"} · {group.min_select}–{group.max_select} selections</span>{group.options.map((option) => <div key={option.id}>{option.name}{option.is_default && <small>Default</small>}<span>{option.is_available ? `+${formatMenuPrice(option.price_delta, business.currency_code || "INR")}` : "Unavailable"}</span></div>)}</section>)}</div> : !groupError && <DataState kind="empty" title="No options or add-ons" description="Edit the item to add a modifier group." />}</>}
    {tab === "locations" && <DataState kind="info" title="Uses business-wide menu settings" description="No location override is exposed by the current product contract." />}
    {tab === "preview" && item && <RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={`${previewKey}-${item.id}`} />}
    {tab === "activity" && <dl className="mt-menu-details"><div><dt>Created</dt><dd>{item?.created_at ? new Date(item.created_at).toLocaleString() : "Not returned"}</dd></div><div><dt>Last updated</dt><dd>{item?.updated_at ? new Date(item.updated_at).toLocaleString() : "Not returned"}</dd></div></dl>}
  </DetailsDrawer>;
}


function AddItemMode({ business, products, categories, refreshed, setToast }: { business: Business; products: Product[]; categories: Category[]; refreshed: () => Promise<void>; setToast: (toast: { text: string; status?: "success" | "danger" } | null) => void }) {
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
      window.sessionStorage.removeItem("menutap-edit-item"); window.sessionStorage.removeItem("menutap-new-category-id");
      if (presetCategory) setDraft((current) => ({ ...current, categoryId: presetCategory }));
      if (!id) return;
      const item = products.find((row) => row.id === id); if (!item) return;
      const metadata = item.metadata || {};
      const variants = Array.isArray(metadata.variants) ? (metadata.variants as Array<Record<string, unknown>>).map((variant) => ({ name: String(variant.name || ""), price: String(variant.price || ""), isDefault: Boolean(variant.isDefault ?? variant.is_default), isAvailable: variant.isAvailable === undefined && variant.is_available === undefined ? true : Boolean(variant.isAvailable ?? variant.is_available) })) : [];
      setEditingId(id); setOriginalMetadata(metadata);
      setDraft({ name: item.name, internalName: String(metadata.internal_name || ""), description: item.description || "", sku: item.sku || "", price: String(item.price), compareAt: item.original_price == null ? "" : String(item.original_price), categoryId: item.category_id || "", itemType: item.item_type, allergens: Array.isArray(metadata.allergens) ? metadata.allergens.join(", ") : "", status: item.menu_status || "draft", available: item.is_available, featured: item.is_featured, trackStock: item.track_stock, stock: item.stock_quantity == null ? "" : String(item.stock_quantity), tags: (item.tags || []).join(", "), variants });
      void api.modifierGroups(id).then((result) => setExistingGroups(result.modifier_groups)).catch(() => setExistingGroups(item.modifier_groups || []));
    }, 0);
    return () => window.clearTimeout(task);
  }, [products]);
  const update = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const reset = () => { setDraft(emptyDraft()); setEditingId(""); setOriginalMetadata({}); setExistingGroups([]); setImage(null); setModifierName(""); setModifierRequired(false); setModifierMin("0"); setModifierMax("1"); setModifierOptions([]); };
  const moveVariant = (index: number, amount: number) => {
    const target = index + amount; if (target < 0 || target >= draft.variants.length) return;
    const next = [...draft.variants]; [next[index], next[target]] = [next[target], next[index]]; update("variants", next);
  };
  const save = async (action: "draft" | "save" | "another") => {
    const price = Number(draft.price); const compareAt = draft.compareAt === "" ? null : Number(draft.compareAt);
    const min = Number(modifierMin); const max = Number(modifierMax);
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
      await refreshed(); setToast({ text: action === "draft" ? "Draft saved." : editingId ? "Item updated." : "Item added." });
      if (action === "another") reset();
    } catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "The item was not saved.", status: "danger" }); }
    finally { setBusy(false); }
  };
  return <div className="mt-menu-editor">
    <div className="mt-menu-subtabs"><button type="button" aria-pressed={submode === "item"} onClick={() => setSubmode("item")}>{editingId ? "Edit Item" : "New Item"}</button><button type="button" aria-pressed={submode === "category"} onClick={() => setSubmode("category")}>New Category</button></div>
    {submode === "category" ? <CategoryForm business={business} categories={categories} refreshed={refreshed} onDone={(id) => { if (id) update("categoryId", id); setSubmode("item"); }} setToast={setToast} /> : <form onSubmit={(event) => { event.preventDefault(); void save("save"); }}>
      <section className="mt-menu-form-card"><header><h2>Basic information</h2><span>Required fields</span></header><div className="mt-menu-form-grid"><Input label="Item name" value={draft.name} onChange={(event) => update("name", event.target.value)} required minLength={2} /><Input label="Internal name" value={draft.internalName} onChange={(event) => update("internalName", event.target.value)} /><Input label="SKU / code" value={draft.sku} onChange={(event) => update("sku", event.target.value)} /><Textarea label="Short description" value={draft.description} onChange={(event) => update("description", event.target.value)} maxLength={500} /><UploadField label="Product image" accept="image/png,image/jpeg,image/webp" value={image} onChange={setImage} /></div></section>
      <section className="mt-menu-form-card"><header><h2>Pricing, category & dietary</h2></header><div className="mt-menu-form-grid"><Input label={`Base price (${business.currency_symbol})`} type="number" min="0" step="0.01" value={draft.price} onChange={(event) => update("price", event.target.value)} required /><Input label={`Compare-at price (${business.currency_symbol})`} type="number" min="0" step="0.01" value={draft.compareAt} onChange={(event) => update("compareAt", event.target.value)} /><Select label="Category" value={draft.categoryId} onChange={(event) => event.target.value === "__new" ? setSubmode("category") : update("categoryId", event.target.value)}><option value="">Uncategorised</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}<option value="__new">+ Create category</option></Select><Select label="Dietary / item type" value={draft.itemType} onChange={(event) => update("itemType", event.target.value as ItemType)}><option value="veg">Vegetarian</option><option value="non_veg">Non-vegetarian</option><option value="retail">Retail</option><option value="service">Service</option><option value="other">Other</option></Select><Input label="Allergens" value={draft.allergens} onChange={(event) => update("allergens", event.target.value)} helperText="Comma separated" /><Input label="Tags" value={draft.tags} onChange={(event) => update("tags", event.target.value)} helperText="Comma separated" /></div></section>
      <section className="mt-menu-form-card"><header><h2>Variants / sizes</h2><Button type="button" variant="secondary" onClick={() => update("variants", [...draft.variants, { name: "", price: draft.price, isDefault: !draft.variants.length, isAvailable: true }])}>Add variant</Button></header>{draft.variants.length ? <div className="mt-menu-repeat-list">{draft.variants.map((variant, index) => <div key={index}><Input label={`Variant ${index + 1}`} value={variant.name} onChange={(event) => update("variants", draft.variants.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} /><Input label="Price" type="number" min="0" step="0.01" value={variant.price} onChange={(event) => update("variants", draft.variants.map((row, rowIndex) => rowIndex === index ? { ...row, price: event.target.value } : row))} /><Toggle label="Default" checked={variant.isDefault} onChange={(event) => update("variants", draft.variants.map((row, rowIndex) => ({ ...row, isDefault: rowIndex === index ? event.target.checked : event.target.checked ? false : row.isDefault })))} /><Toggle label="Available" checked={variant.isAvailable} onChange={(event) => update("variants", draft.variants.map((row, rowIndex) => rowIndex === index ? { ...row, isAvailable: event.target.checked } : row))} /><div className="mt-menu-reorder"><button type="button" aria-label={`Move variant ${index + 1} up`} onClick={() => moveVariant(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Move variant ${index + 1} down`} onClick={() => moveVariant(index, 1)}><ArrowDown size={16} /></button></div><Button type="button" variant="tertiary" onClick={() => update("variants", draft.variants.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button></div>)}</div> : <p className="mt-menu-helper">The base item is used when no variants are added.</p>}</section>
      <section className="mt-menu-form-card"><header><h2>Modifier / add-on group</h2><span>Optional new group</span></header>{existingGroups.length > 0 && <div className="mt-menu-existing-groups">{existingGroups.map((group) => <StatusPill key={group.id} status="info">{group.name} · {group.options.length} options</StatusPill>)}</div>}<div className="mt-menu-form-grid"><Input label="Group name" value={modifierName} onChange={(event) => setModifierName(event.target.value)} placeholder="Choose a size" /><Input label="Minimum selections" type="number" min="0" value={modifierMin} onChange={(event) => setModifierMin(event.target.value)} /><Input label="Maximum selections" type="number" min="0" value={modifierMax} onChange={(event) => setModifierMax(event.target.value)} /><Toggle label="Required group" checked={modifierRequired} onChange={(event) => setModifierRequired(event.target.checked)} /><div><Button type="button" variant="secondary" onClick={() => setModifierOptions((current) => [...current, { name: "", price: "0", isDefault: false, isAvailable: true }])}>Add option</Button></div></div>{modifierOptions.length > 0 && <div className="mt-menu-repeat-list">{modifierOptions.map((option, index) => <div key={index}><Input label={`Option ${index + 1}`} value={option.name} onChange={(event) => setModifierOptions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} /><Input label="Price adjustment" type="number" step="0.01" value={option.price} onChange={(event) => setModifierOptions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, price: event.target.value } : row))} /><Toggle label="Default" checked={option.isDefault} onChange={(event) => setModifierOptions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, isDefault: event.target.checked } : row))} /><Toggle label="Available" checked={option.isAvailable} onChange={(event) => setModifierOptions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, isAvailable: event.target.checked } : row))} /><Button type="button" variant="tertiary" onClick={() => setModifierOptions((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button></div>)}</div>}</section>
      <section className="mt-menu-form-card"><header><h2>Quick availability & draft status</h2><Link href="/dashboard/kiosk-experience/availability">Open detailed availability</Link></header><div className="mt-menu-form-grid"><Select label="Menu status" value={draft.status} onChange={(event) => update("status", event.target.value as MenuStatus)}><option value="draft">Draft</option><option value="shown">Shown</option><option value="hidden">Hidden</option><option value="unavailable">Unavailable</option></Select><Toggle label="Available for ordering" checked={draft.available} onChange={(event) => update("available", event.target.checked)} /><Toggle label="Featured item" checked={draft.featured} onChange={(event) => update("featured", event.target.checked)} /><Toggle label="Track stock" checked={draft.trackStock} onChange={(event) => update("trackStock", event.target.checked)} />{draft.trackStock && <Input label="Stock quantity" type="number" min="0" value={draft.stock} onChange={(event) => update("stock", event.target.value)} />}</div><details className="mt-menu-inline-details"><summary>Location overrides</summary><p>No location override is exposed by the current product contract, so this item inherits business-wide settings.</p></details></section>
      <StickyFormActions><Button type="button" variant="secondary" loading={busy} onClick={() => void save("draft")}>Save draft</Button><Button type="button" variant="secondary" loading={busy} onClick={() => void save("another")}>Save & add another</Button><Button type="submit" loading={busy}>{editingId ? "Update item" : "Save item"}</Button></StickyFormActions>
    </form>}
  </div>;
}


function CategoryForm({ business, categories, refreshed, onDone, setToast }: { business: Business; categories: Category[]; refreshed: () => Promise<void>; onDone: (id: string) => void; setToast: (toast: { text: string; status?: "success" | "danger" } | null) => void }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [active, setActive] = useState(true); const [order, setOrder] = useState(String(categories.length + 1)); const [busy, setBusy] = useState(false); const [image, setImage] = useState<File | null>(null);
  return <form className="mt-menu-form-card" onSubmit={async (event) => {
    event.preventDefault(); const clean = name.trim(); const sortOrder = Math.max(0, Number(order || 1) - 1);
    if (clean.length < 2) { setToast({ text: "Enter a category name.", status: "danger" }); return; }
    if (categories.some((category) => category.name.toLowerCase() === clean.toLowerCase())) { setToast({ text: "A category with this name already exists.", status: "danger" }); return; }
    setBusy(true);
    try { const imagePath = image ? (await api.uploadProductImage(business.id, image)).path : null; const saved = await api.createCategory(business.id, { name: clean, description: description.trim() || null, image_path: imagePath, is_active: active, sort_order: sortOrder }); await refreshed(); setToast({ text: "Category created." }); onDone(saved.id); }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Category was not created.", status: "danger" }); }
    finally { setBusy(false); }
  }}><header><h2>Create category</h2><span>Your item form is preserved</span></header><div className="mt-menu-form-grid"><Input label="Category name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} /><Textarea label="Description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /><UploadField label="Category image" accept="image/png,image/jpeg,image/webp" value={image} onChange={setImage} /><Input label="Display order" type="number" min="1" value={order} onChange={(event) => setOrder(event.target.value)} /><Toggle label="Visible on kiosk" checked={active} onChange={(event) => setActive(event.target.checked)} /></div><p className="mt-menu-helper">Items inherit category kiosk visibility. Location visibility is not exposed by the current category contract.</p><StickyFormActions><Button type="button" variant="secondary" onClick={() => onDone("")}>Back to item</Button><Button type="submit" loading={busy}>Create category</Button></StickyFormActions></form>;
}


function CombosMode({ business, products, categories, combos, previewKey, refreshed, setToast }: { business: Business; products: Product[]; categories: Category[]; combos: Combo[]; previewKey: number; refreshed: () => Promise<void>; setToast: (toast: { text: string; status?: "success" | "danger" | "info" } | null) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [editor, setEditor] = useState<Combo | "new" | null>(null);
  const [confirm, setConfirm] = useState<Combo | null>(null);
  const [busy, setBusy] = useState(false);
  const filtered = combos.filter((combo) => (!search || combo.name.toLowerCase().includes(search.toLowerCase())) && (status === "all" || combo.status === status) && (category === "all" || combo.category_id === category));
  useEffect(() => { const open = () => setEditor("new"); window.addEventListener("menutap:new-combo", open); return () => window.removeEventListener("menutap:new-combo", open); }, []);
  const openCombo = async (combo: Combo) => {
    setBusy(true);
    try { setEditor((await api.combo(combo.id)).combo); }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Combo details could not be loaded.", status: "danger" }); }
    finally { setBusy(false); }
  };
  const duplicate = async (combo: Combo) => {
    setBusy(true);
    try { await api.duplicateCombo(combo.id); await refreshed(); setToast({ text: "Combo duplicated as a draft." }); }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Combo was not duplicated.", status: "danger" }); }
    finally { setBusy(false); }
  };
  const archive = async () => {
    if (!confirm) return; setBusy(true);
    try { await api.updateCombo(confirm.id, { status: "hidden" }); setConfirm(null); await refreshed(); setToast({ text: "Combo archived." }); }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Combo was not archived.", status: "danger" }); }
    finally { setBusy(false); }
  };
  const toggleAvailability = async (combo: Combo) => {
    const next = combo.status === "shown" ? "unavailable" : "shown"; setBusy(true);
    try {
      if (next === "shown") {
        const detail = (await api.combo(combo.id)).combo;
        const unavailableRequired = (detail.sections || []).some((section) => section.required && section.options.some((option) => option.existing_item_id && !products.find((item) => item.id === option.existing_item_id)?.is_available));
        if (unavailableRequired) { setEditor(detail); setToast({ text: "Review unavailable items in required combo groups before making this combo available.", status: "danger" }); return; }
      }
      await api.updateCombo(combo.id, { status: next }); await refreshed(); setToast({ text: `${combo.name} is now ${next === "shown" ? "available" : "unavailable"}.` });
    }
    catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Combo availability was not saved.", status: "danger" }); }
    finally { setBusy(false); }
  };
  const clearFilters = () => { setSearch(""); setStatus("all"); setCategory("all"); };
  return <div className="mt-menu-content">
    <div className="mt-menu-toolbar"><div className="mt-menu-toolbar__filters"><SearchInput label="Search combos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search combos" /><label><span className="mt-sr-only">Combo status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="shown">Published</option><option value="draft">Draft</option><option value="unavailable">Unavailable</option><option value="hidden">Archived</option></select></label><label><span className="mt-sr-only">Combo category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><details className="mt-menu-more"><summary><MoreHorizontal size={18} /> More Filters</summary><div><Link href="/dashboard/kiosk-experience/availability">Detailed availability</Link></div></details></div><Button onClick={() => setEditor("new")}><Plus size={17} /> Create combo</Button></div>
    {(search || status !== "all" || category !== "all") && <div className="mt-menu-filter-chips">{search && <button type="button" onClick={() => setSearch("")}>Search: {search} ×</button>}{status !== "all" && <button type="button" onClick={() => setStatus("all")}>Status: {readable(status)} ×</button>}{category !== "all" && <button type="button" onClick={() => setCategory("all")}>Category: {categories.find((entry) => entry.id === category)?.name || "Unknown"} ×</button>}<button type="button" onClick={clearFilters}>Clear all</button></div>}
    <div className="mt-menu-layout"><div>{!combos.length ? <DataState kind="empty" title="Create your first combo" action={<Button onClick={() => setEditor("new")}>Create combo</Button>} /> : !filtered.length ? <DataState kind="filtered-empty" title="No matching combos" action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} /> : <div className="mt-menu-combo-grid">{filtered.map((combo) => <article key={combo.id}><button type="button" className="mt-menu-combo-main" disabled={busy} onClick={() => void openCombo(combo)}>{combo.image_path ? <Image unoptimized src={assetUrl(combo.image_path) || ""} alt="" width={220} height={128} /> : <div className="mt-menu-combo-placeholder" aria-hidden="true"><Grid2X2 size={28} /></div>}<div><span><StatusPill status={combo.status === "shown" ? "success" : combo.status === "draft" ? "warning" : combo.status === "unavailable" ? "danger" : "neutral"}>{readable(combo.status)}</StatusPill><small>{combo.included_items_count || 0} included items</small></span><h2>{combo.name}</h2><p>{combo.description || "No description"}</p><strong>{formatMenuPrice(combo.price, business.currency_code || "INR")}</strong></div></button><footer>{(combo.status === "shown" || combo.status === "unavailable") && <Button variant="tertiary" disabled={busy} onClick={() => void toggleAvailability(combo)}>{combo.status === "shown" ? "Unavailable" : "Available"}</Button>}<Button variant="tertiary" disabled={busy} onClick={() => void openCombo(combo)}>Edit</Button><Button variant="tertiary" disabled={busy} onClick={() => void duplicate(combo)}><Copy size={16} /> Duplicate</Button><Button variant="tertiary" disabled={busy} onClick={() => setConfirm(combo)}>Archive</Button></footer></article>)}</div>}</div><aside className="mt-menu-preview"><div><span>Portrait draft preview</span><Link href="/dashboard/kiosk-experience/preview">Open full preview</Link></div><RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={previewKey} /></aside></div>
    <ComboEditor key={editor === "new" ? "new" : editor?.id || "closed"} business={business} products={products} categories={categories} combo={editor} onClose={() => setEditor(null)} refreshed={refreshed} setToast={setToast} />
    <ConfirmationDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={() => void archive()} title="Archive combo?" description={`${confirm?.name || "This combo"} will be hidden from the kiosk. Its configuration is preserved.`} confirmLabel="Archive" destructive loading={busy} />
  </div>;
}

const newComboSection = (index: number): ComboSectionInput => ({ title: index ? `Selection group ${index + 1}` : "Included items", section_type: index ? "optional_upgrades" : "included_items", required: index === 0, min_select: index === 0 ? 1 : 0, max_select: 1, sort_order: index, options: [] });
const sectionInputs = (combo: Combo | null): ComboSectionInput[] => combo?.sections?.length ? combo.sections.map((section) => ({ id: section.id, title: section.title, section_type: section.section_type, required: section.required, min_select: section.min_select, max_select: section.max_select, sort_order: section.sort_order, options: section.options.map((option) => ({ id: option.id, source_type: option.source_type, existing_item_id: option.existing_item_id, exclusive_name: option.exclusive_name, exclusive_description: option.exclusive_description, exclusive_image_path: option.exclusive_image_path, exclusive_type: option.exclusive_type, quantity: option.quantity, price_impact: option.price_impact, default_selected: option.default_selected, removable: option.removable, visible: option.visible, sort_order: option.sort_order })) })) : [newComboSection(0)];

function ComboEditor({ business, products, categories, combo, onClose, refreshed, setToast }: { business: Business; products: Product[]; categories: Category[]; combo: Combo | "new" | null; onClose: () => void; refreshed: () => Promise<void>; setToast: (toast: { text: string; status?: "success" | "danger" } | null) => void }) {
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
  const moveSection = (index: number, amount: number) => { const target = index + amount; if (target < 0 || target >= sections.length) return; const next = [...sections]; [next[index], next[target]] = [next[target], next[index]]; setSections(next.map((section, sort_order) => ({ ...section, sort_order }))); };
  const save = async () => {
    const invalidSection = sections.find((section) => !section.title.trim() || section.min_select < 0 || section.max_select < section.min_select || section.max_select > section.options.length);
    const shownWithoutIncluded = status === "shown" && !sections.some((section) => section.section_type === "included_items" && section.options.length);
    if (name.trim().length < 2 || !Number.isFinite(resolvedPrice) || resolvedPrice < 0 || invalidSection || shownWithoutIncluded) { setToast({ text: "Complete the combo name, pricing, and valid selection limits before saving.", status: "danger" }); return; }
    setBusy(true);
    try {
      const uploadedPath = image ? (await api.uploadProductImage(business.id, image)).path : null;
      const payload: ComboPayload = { name: name.trim(), description: description.trim() || null, category_id: categoryId || null, image_path: uploadedPath || current?.image_path || null, price: resolvedPrice, original_price: pricingMode === "discount" ? includedTotal : null, display_badge: current?.display_badge || null, tags: [...(current?.tags || []).filter((tag) => !tag.startsWith("pricing:")), `pricing:${pricingMode}`], status, sort_order: current?.sort_order || 0, availability_type: current?.availability_type || "always", available_days: current?.available_days || [], available_start_time: current?.available_start_time || null, available_end_time: current?.available_end_time || null, sections };
      if (combo === "new") await api.createCombo(business.id, payload); else if (combo) await api.updateCombo(combo.id, payload);
      await refreshed(); setToast({ text: combo === "new" ? "Combo created." : "Combo updated." }); onClose();
    } catch (cause) { setToast({ text: cause instanceof Error ? cause.message : "Combo was not saved.", status: "danger" }); }
    finally { setBusy(false); }
  };
  return <DetailsDrawer open={Boolean(combo)} onClose={onClose} title={combo === "new" ? "Create combo" : `Edit ${combo && combo.name}`} confirmOnClose="Discard unsaved combo changes?" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save combo</Button></>}>
    <div className="mt-menu-combo-editor">
      <section><h3>Basics & pricing</h3><Input label="Combo name" value={name} onChange={(event) => setName(event.target.value)} required /><Textarea label="Description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /><UploadField label="Combo image" accept="image/png,image/jpeg,image/webp" value={image} onChange={setImage} /><Select label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorised</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</Select><Select label="Pricing model" value={pricingMode} onChange={(event) => setPricingMode(event.target.value as "fixed" | "discount" | "base")}><option value="fixed">Fixed combo price</option><option value="discount">Included-item sum minus discount</option><option value="base">Base price plus upgrades</option></Select>{pricingMode !== "discount" && <Input label={`${pricingMode === "base" ? "Base" : "Fixed"} price (${business.currency_code || "INR"})`} type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required />}{pricingMode === "discount" && <Input label={`Discount amount (${business.currency_code || "INR"})`} type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />}<p className="mt-menu-helper">Saved combo price from selected real items: <strong>{formatMenuPrice(resolvedPrice, business.currency_code || "INR")}</strong></p><Select label="Publish / availability state" value={status} onChange={(event) => setStatus(event.target.value as MenuStatus)}><option value="draft">Draft</option><option value="shown">Shown and available</option><option value="unavailable">Shown but unavailable</option><option value="hidden">Archived</option></Select></section>
      <section><header className="mt-menu-editor-heading"><div><h3>Selection groups</h3><p>Define included choices and optional upgrades.</p></div><Button type="button" variant="secondary" onClick={() => setSections((currentSections) => [...currentSections, newComboSection(currentSections.length)])}>Add group</Button></header>{sections.map((section, sectionIndex) => <div className="mt-menu-selection-group" key={section.id || sectionIndex}><div className="mt-menu-selection-group__header"><Input label={`Group ${sectionIndex + 1} name`} value={section.title} onChange={(event) => setSection(sectionIndex, { title: event.target.value })} /><Select label="Group type" value={section.section_type} onChange={(event) => setSection(sectionIndex, { section_type: event.target.value as ComboSectionInput["section_type"] })}><option value="included_items">Included items</option><option value="optional_upgrades">Optional upgrades</option></Select><Input label="Minimum" type="number" min="0" value={section.min_select} onChange={(event) => setSection(sectionIndex, { min_select: Number(event.target.value) })} /><Input label="Maximum" type="number" min="0" value={section.max_select} onChange={(event) => setSection(sectionIndex, { max_select: Number(event.target.value) })} /><Toggle label="Required" checked={section.required} onChange={(event) => setSection(sectionIndex, { required: event.target.checked })} /><div className="mt-menu-reorder"><button type="button" aria-label={`Move group ${sectionIndex + 1} up`} onClick={() => moveSection(sectionIndex, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Move group ${sectionIndex + 1} down`} onClick={() => moveSection(sectionIndex, 1)}><ArrowDown size={16} /></button></div>{sections.length > 1 && <Button type="button" variant="danger" onClick={() => { if (window.confirm(`Remove ${section.title}?`)) setSections((currentSections) => currentSections.filter((_, index) => index !== sectionIndex)); }}>Remove group</Button>}</div><div className="mt-menu-check-list">{products.filter((item) => item.menu_status !== "hidden").map((item) => { const optionIndex = section.options.findIndex((option) => option.existing_item_id === item.id); const option = section.options[optionIndex]; return <div className="mt-menu-combo-option" key={item.id}><Checkbox label={<span>{item.name}<small>{item.is_available ? formatMenuPrice(item.price, business.currency_code || "INR") : "Unavailable"}</small></span>} checked={optionIndex >= 0} onChange={(event) => toggleProduct(sectionIndex, item, event.target.checked)} />{option && <><Input label="Quantity" type="number" min="1" value={option.quantity} onChange={(event) => updateOption(sectionIndex, optionIndex, { quantity: Number(event.target.value) })} /><Input label="Upgrade price" type="number" min="0" step="0.01" value={option.price_impact} onChange={(event) => updateOption(sectionIndex, optionIndex, { price_impact: Number(event.target.value) })} /><Toggle label="Default" checked={option.default_selected} onChange={(event) => setSection(sectionIndex, { options: section.options.map((entry, index) => index === optionIndex ? { ...entry, default_selected: event.target.checked } : entry) })} /><Toggle label="Visible" checked={option.visible} onChange={(event) => setSection(sectionIndex, { options: section.options.map((entry, index) => index === optionIndex ? { ...entry, visible: event.target.checked } : entry) })} /></>}</div>; })}{section.options.some((option) => option.existing_item_id && !productMap.get(option.existing_item_id)?.is_available) && <DataState kind="info" title="Needs attention" description="This group includes an unavailable item. Review the selection before publishing." />}</div></div>)}</section>
      <section><h3>Quick availability & locations</h3><p>Use the state above for quick availability. <Link href="/dashboard/kiosk-experience/availability">Open detailed availability</Link> for schedules. Location overrides are not exposed by the current combo contract.</p></section>
      <section><h3>Portrait kiosk preview</h3><RealKioskFrame slug={business.slug} businessId={business.id} orientation="portrait" compact sessionKey={`combo-${combo === "new" ? "new" : combo?.id}`} /></section>
    </div>
  </DetailsDrawer>;
}
