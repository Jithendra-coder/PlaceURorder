"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ExternalLink, Image as ImageIcon, Info, LayoutTemplate, Loader2, Monitor, RefreshCw, RotateCcw, ShoppingBag, Smartphone } from "lucide-react";
import { KioskRuntime, type KioskExperienceData } from "@/features/kiosk/KioskApp";
import { DetailsDrawer, Skeleton } from "@/components/ui/DashboardUI";
import { api as dashboardApi, assetUrl as nullableAssetUrl } from "@/lib/api";
import { formatKioskThemeSelection, parseKioskThemeSelection } from "@/lib/constants";
import { kioskBusinessConfig, type KioskLayoutId } from "@/lib/kiosk/kiosk-business-config";
import type { Business, Category, KioskScreenOrientation, Product } from "@/lib/types";
import { api, type Business as ApiBusiness } from "@/services/api";

const assetUrl = (path?: string | null) => nullableAssetUrl(path) || "/placeholder.svg";

type ScreenConfig = {
  orientation: KioskScreenOrientation;
  layout: KioskLayoutId;
  categoryCardStyle: "picture" | "simple";
  productCardStyle: "detailed" | "simple";
};

type SaveState = "saved" | "saving" | "error";

const layoutOptions: Array<{ id: KioskLayoutId; label: string; meta: string }> = [
  { id: "category_gate", label: "Gate", meta: "Category Gate" },
  { id: "left_category", label: "Left Rail", meta: "Left Category Rail" },
  { id: "top_category", label: "Top Bar", meta: "Top Category Bar" },
];

const orientationOptions: Array<{ id: KioskScreenOrientation; label: string }> = [
  { id: "portrait", label: "Portrait" },
  { id: "landscape", label: "Landscape" },
];

const categoryOptions = [
  { id: "picture" as const, label: "Picture", meta: "Picture Category" },
  { id: "simple" as const, label: "Simple", meta: "Simple Category" },
];

const productOptions = [
  { id: "detailed" as const, label: "Detailed", meta: "Detailed Product" },
  { id: "simple" as const, label: "Simple", meta: "Simple Product" },
];

type ScreenBusiness = ApiBusiness & {
  kiosk_theme?: string | null;
  kiosk_layout?: string | null;
  kiosk_order_settings?: Record<string, unknown>;
  kiosk_start_screen_enabled?: boolean;
  display_show_category_images?: boolean;
  display_show_item_descriptions?: boolean;
  display_show_prices?: boolean;
};

function asScreenBusiness(business: ApiBusiness) {
  return business as ScreenBusiness;
}

function runtimeLayoutFromSaved(value?: string | null): KioskLayoutId | null {
  if (value === "side-navigation") return "left_category";
  if (value === "category-first") return "category_gate";
  if (value === "top-navigation") return "top_category";
  return null;
}

function savedLayoutFromRuntime(value: KioskLayoutId) {
  return value === "left_category" ? "side-navigation" : value === "category_gate" ? "category-first" : "top-navigation";
}

function initialConfig(business: ApiBusiness): ScreenConfig {
  const raw = asScreenBusiness(business);
  const theme = parseKioskThemeSelection(raw.kiosk_theme, "premium_light");
  const layout = (theme.templateRecognized ? theme.templateId : runtimeLayoutFromSaved(business.kiosk_layout_id) || kioskBusinessConfig(business.type as Business["type"]).defaultLayout) as KioskLayoutId;
  return {
    orientation: business.kiosk_screen_orientation === "landscape" ? "landscape" : "portrait",
    layout,
    categoryCardStyle: theme.categoryStyle === "simple_button" ? "simple" : "picture",
    productCardStyle: theme.productDisplayStyle === "simple_item" ? "simple" : "detailed",
  };
}

function sameConfig(left: ScreenConfig, right: ScreenConfig) {
  return left.orientation === right.orientation && left.layout === right.layout && left.categoryCardStyle === right.categoryCardStyle && left.productCardStyle === right.productCardStyle;
}

function themeForConfig(business: ApiBusiness, config: ScreenConfig) {
  const raw = asScreenBusiness(business);
  const current = parseKioskThemeSelection(raw.kiosk_theme, "premium_light");
  return formatKioskThemeSelection(config.layout, current.mode, {
    cardStyle: current.cardStyle,
    categoryStyle: config.categoryCardStyle === "picture" ? "picture_card" : "simple_button",
    productDisplayStyle: config.productCardStyle === "detailed" ? "detailed_card" : "simple_item",
    actionBehavior: current.actionBehavior,
    accentColor: current.accentColor,
  });
}

function previewBusiness(business: ApiBusiness, config: ScreenConfig): Business {
  const raw = asScreenBusiness(business);
  return {
    ...(business as unknown as Business),
    kiosk_theme: themeForConfig(business, config),
    kiosk_layout: config.layout,
    kiosk_screen_orientation: config.orientation,
    kiosk_start_screen_enabled: false,
    kiosk_order_settings: raw.kiosk_order_settings,
  };
}

export function KioskScreensSkeleton() {
  return <div className="mt-kiosk-screens mt-kiosk-screens--loading" aria-busy="true"><div className="mt-kiosk-screens-header"><div><Skeleton lines={2} label="Loading Kiosk Screens" /></div><Skeleton lines={1} label="Loading preview actions" /></div><div className="mt-kiosk-screens-workspace"><div className="mt-kiosk-screens-config"><Skeleton lines={12} label="Loading screen settings" /></div><div className="mt-kiosk-screens-preview-skeleton"><Skeleton lines={8} label="Loading kiosk preview" /></div></div></div>;
}

export function KioskScreensPage({ business, products, categories, setup, refresh }: { business: ApiBusiness; products: Product[]; categories: Category[]; setup: { unpublishedChanges: number } | null; refresh: () => Promise<ApiBusiness | null> }) {
  const initial = useMemo(() => initialConfig(business), [business]);
  const [config, setConfig] = useState<ScreenConfig>(initial);
  const [baseline, setBaseline] = useState<ScreenConfig>(initial);
  const baselineRef = useRef(initial);
  const configRef = useRef(initial);
  const requestRef = useRef(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [unpublishedCount, setUnpublishedCount] = useState(setup?.unpublishedChanges || 0);
  const isDirty = !sameConfig(config, baseline);

  useEffect(() => { configRef.current = config; }, [config]);

  const saveConfig = useCallback(async (next: ScreenConfig) => {
    const requestId = ++requestRef.current;
    setSaveState("saving");
    setSaveError("");
    try {
      await api.updateBusiness(business.id, {
        kiosk_layout_id: savedLayoutFromRuntime(next.layout),
        kiosk_theme: themeForConfig(business, next),
        kiosk_screen_orientation: next.orientation,
      });
      if (requestId !== requestRef.current) return;
      baselineRef.current = next;
      setBaseline(next);
      setSaveState("saved");
      const nextSetup = await dashboardApi.kioskSetup(business.id).catch(() => null);
      if (nextSetup) setUnpublishedCount(nextSetup.unpublishedChanges);
      await refresh();
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setSaveState("error");
      setSaveError(cause instanceof Error ? cause.message : "Couldn’t save changes.");
    }
  }, [business, refresh]);

  useEffect(() => {
    if (sameConfig(config, baseline)) return;
    const timer = window.setTimeout(() => void saveConfig(configRef.current), 500);
    return () => window.clearTimeout(timer);
  }, [config, baseline, saveConfig]);

  const select = (patch: Partial<ScreenConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setSaveState("saving");
    setSaveError("");
  };

  const reset = () => {
    if (!isDirty) return;
    requestRef.current += 1;
    setConfig(baselineRef.current);
    setBaseline(baselineRef.current);
    setSaveState("saved");
    setSaveError("");
  };

  const previewData: KioskExperienceData = useMemo(() => ({ business: previewBusiness(business, config), categories, products }), [business, categories, config, products]);

  const categoriesWithoutImages = categories.filter((category) => !category.image_path).length;
  const productsWithoutImages = products.filter((product) => !product.primary_image_path).length;
  const missingMenu = products.length === 0;
  const missingCategories = products.length > 0 && categories.length === 0;
  const setupCount = unpublishedCount;

  return <div className="mt-kiosk-screens">
    <header className="mt-kiosk-screens-header">
      <div><h1>Kiosk Screens</h1><p>Choose how your kiosk menu is presented.</p></div>
      <div className="mt-kiosk-screens-header__actions">
        {setupCount > 0 && <Link className="mt-kiosk-screens-draft" href="/dashboard/kiosk-experience/publish"><span aria-hidden="true">●</span> {setupCount} unpublished change{setupCount === 1 ? "" : "s"} <span>Review →</span></Link>}
        <button className="mt-button mt-button--secondary mt-kiosk-screens-preview-trigger" type="button" onClick={() => setPreviewOpen(true)}><Monitor size={16} /> Preview</button>
        <Link className="mt-button mt-button--secondary" href="/dashboard/kiosk-experience/preview"><ExternalLink size={16} /> Open full preview</Link>
      </div>
    </header>
    <div className="mt-kiosk-screens-workspace">
      <div>
        <section className="mt-kiosk-screens-config" aria-label="Kiosk screen configuration">
          <ScreenSection number="1" title="Orientation" helper="Choose the screen orientation."><div className="mt-kiosk-screen-options mt-kiosk-screen-options--orientation" role="radiogroup" aria-label="Screen orientation">{orientationOptions.map((option) => <RadioOption key={option.id} checked={config.orientation === option.id} label={option.label} onSelect={() => select({ orientation: option.id })} onKeyDown={(event) => moveRadio(event, orientationOptions.map((item) => item.id), config.orientation, (value) => select({ orientation: value as KioskScreenOrientation }))}><OrientationIcon orientation={option.id} /></RadioOption>)}</div></ScreenSection>
          <ScreenSection number="2" title="Kiosk layout" helper="Choose how customers move through categories."><div className="mt-kiosk-screen-options mt-kiosk-screen-options--layouts" role="radiogroup" aria-label="Kiosk layout">{layoutOptions.map((option) => <RadioOption key={option.id} checked={config.layout === option.id} label={option.label} meta={option.meta} onSelect={() => select({ layout: option.id })} onKeyDown={(event) => moveRadio(event, layoutOptions.map((item) => item.id), config.layout, (value) => select({ layout: value as KioskLayoutId }))}><LayoutMiniature layout={option.id} /></RadioOption>)}</div></ScreenSection>
          <ScreenSection number="3" title="Category cards" helper="Choose how category choices appear."><div className="mt-kiosk-screen-options mt-kiosk-screen-options--cards" role="radiogroup" aria-label="Category card style">{categoryOptions.map((option) => <RadioOption key={option.id} checked={config.categoryCardStyle === option.id} label={option.label} meta={option.meta} onSelect={() => select({ categoryCardStyle: option.id })} onKeyDown={(event) => moveRadio(event, categoryOptions.map((item) => item.id), config.categoryCardStyle, (value) => select({ categoryCardStyle: value as ScreenConfig["categoryCardStyle"] }))}><CategoryMiniature style={option.id} category={categories[0]} /></RadioOption>)}</div></ScreenSection>
          <ScreenSection number="4" title="Menu item cards" helper="Choose how products appear to customers."><div className="mt-kiosk-screen-options mt-kiosk-screen-options--cards" role="radiogroup" aria-label="Menu item card style">{productOptions.map((option) => <RadioOption key={option.id} checked={config.productCardStyle === option.id} label={option.label} meta={option.meta} onSelect={() => select({ productCardStyle: option.id })} onKeyDown={(event) => moveRadio(event, productOptions.map((item) => item.id), config.productCardStyle, (value) => select({ productCardStyle: value as ScreenConfig["productCardStyle"] }))}><ProductMiniature style={option.id} product={products[0]} /></RadioOption>)}</div></ScreenSection>
        </section>
        <CurrentSetup config={config} baseline={baseline} onReset={reset} saveState={saveState} saveError={saveError} onRetry={() => void saveConfig(configRef.current)} unpublishedCount={setupCount} />
        {(missingMenu || missingCategories || categoriesWithoutImages > 0 || productsWithoutImages > 0) && <div className="mt-kiosk-screens-warnings" aria-live="polite">
          {missingMenu && <WarningRow message="No menu items to preview" detail="Add items to see your kiosk menu." href="/dashboard/kiosk-experience/menu?mode=items" action="Go to Manage Menu →" />}
          {missingCategories && <WarningRow message="No categories available to preview." detail="Create categories to organize your menu." href="/dashboard/kiosk-experience/menu?mode=categories" action="Manage categories →" />}
          {config.categoryCardStyle === "picture" && categoriesWithoutImages > 0 && <WarningRow message={`${categoriesWithoutImages} categor${categoriesWithoutImages === 1 ? "y has" : "ies have"} no images`} href="/dashboard/kiosk-experience/menu?mode=categories" action="Review →" />}
          {productsWithoutImages > 0 && <WarningRow message={`${productsWithoutImages} item${productsWithoutImages === 1 ? " has" : "s have"} no images`} detail="The kiosk fallback image will be used." href="/dashboard/kiosk-experience/menu?mode=items" action="Review →" />}
        </div>}
      </div>
      <PreviewPanel business={business} config={config} previewData={previewData} previewKey={previewKey} onRefresh={() => setPreviewKey((value) => value + 1)} />
    </div>
    <DetailsDrawer open={previewOpen} onClose={() => setPreviewOpen(false)} title="Live preview" variant="sheet" className="mt-kiosk-screens-preview-drawer" footer={<button className="mt-button mt-button--secondary" type="button" onClick={() => setPreviewOpen(false)}>Close</button>}><PreviewPanel business={business} config={config} previewData={previewData} previewKey={previewKey} onRefresh={() => setPreviewKey((value) => value + 1)} compact /></DetailsDrawer>
  </div>;
}

function ScreenSection({ title, children }: { number?: string; title: string; helper?: string; children: ReactNode }) {
  const displayTitle = title === "Kiosk layout" ? "Layout" : title === "Category cards" ? "Category style" : title === "Menu item cards" ? "Product style" : title;
  return <section className="mt-kiosk-screen-section"><header><h2>{displayTitle}</h2></header>{children}</section>;
}

function RadioOption({ checked, label, meta, children, onSelect, onKeyDown }: { checked: boolean; label: string; meta?: string; children: ReactNode; onSelect: () => void; onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void }) {
  return <button type="button" role="radio" aria-label={meta || label} aria-checked={checked} tabIndex={checked ? 0 : -1} className={`mt-kiosk-screen-option${checked ? " is-selected" : ""}`} onClick={onSelect} onKeyDown={onKeyDown}><span className="mt-kiosk-screen-option__check" aria-hidden="true">{checked && <Check size={13} />}</span><span className="mt-kiosk-screen-option__visual" aria-hidden="true">{children}</span><span className="mt-kiosk-screen-option__copy"><strong>{label}</strong></span></button>;
}

function moveRadio<T extends string>(event: React.KeyboardEvent<HTMLButtonElement>, values: T[], current: T, onChange: (value: T) => void) {
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", " ", "Enter"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === " " || event.key === "Enter") return;
  const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
  onChange(values[(values.indexOf(current) + delta + values.length) % values.length]);
}

function OrientationIcon({ orientation }: { orientation: KioskScreenOrientation }) {
  return orientation === "portrait" ? <Smartphone size={19} /> : <Monitor size={19} />;
}

function LayoutMiniature({ layout }: { layout: KioskLayoutId }) {
  return <span className={`mt-kiosk-screen-mini mt-kiosk-screen-mini--${layout}`}><i /><i /><i /><i /><i /><i /></span>;
}

function CategoryMiniature({ style, category }: { style: "picture" | "simple"; category?: Category }) {
  const imageSrc = category?.image_path ? assetUrl(category.image_path) : "";
  return style === "picture" ? <span className="mt-kiosk-screen-mini-card mt-kiosk-screen-mini-card--picture">{imageSrc ? <Image src={imageSrc} alt="" width={100} height={42} unoptimized /> : <ImageIcon size={18} />}<b>{category?.name || "Category"}</b></span> : <span className="mt-kiosk-screen-mini-card mt-kiosk-screen-mini-card--simple"><b>{category?.name || "Category"}</b><small>{category ? "Menu category" : "Categories"}</small></span>;
}

function ProductMiniature({ style, product }: { style: "detailed" | "simple"; product?: Product }) {
  return <span className={`mt-kiosk-screen-mini-product mt-kiosk-screen-mini-product--${style}`}>{product?.primary_image_path ? <Image src={assetUrl(product.primary_image_path)} alt="" width={38} height={38} unoptimized /> : <span className="mt-kiosk-screen-product-placeholder"><ShoppingBag size={17} /></span>}<span><b>{product?.name || "Classic Burger"}</b>{style === "detailed" && <small>{product?.description || "Freshly prepared"}</small>}<em>₹{product?.price || "199"}</em></span><strong aria-hidden="true">+</strong></span>;
}

function CurrentSetup({ config, baseline, onReset, saveState, saveError, onRetry, unpublishedCount }: { config: ScreenConfig; baseline: ScreenConfig; onReset: () => void; saveState: SaveState; saveError: string; onRetry: () => void; unpublishedCount: number }) {
  const status = saveState === "error" ? <><span className="mt-kiosk-save-status mt-kiosk-save-status--error">Couldn’t save changes</span><button type="button" onClick={onRetry}>Retry</button></> : saveState === "saving" ? <span className="mt-kiosk-save-status"><Loader2 size={13} className="mt-kiosk-spin" /> Saving…</span> : <span className="mt-kiosk-save-status mt-kiosk-save-status--success"><Check size={13} /> Changes saved as draft {unpublishedCount > 0 ? "· Publish to make them live on your kiosks." : ""}</span>;
  return <section className="mt-kiosk-current-setup" aria-label="Current kiosk setup"><header><div><h2>Current setup</h2><p>{saveError || "Your selections update the draft preview automatically."}</p></div><button type="button" className="mt-button mt-button--secondary mt-button--compact" disabled={sameConfig(config, baseline)} onClick={onReset}><RotateCcw size={14} /> Reset</button></header><div className="mt-kiosk-current-setup__grid"><SetupValue icon={<Smartphone size={15} />} value={config.orientation[0].toUpperCase() + config.orientation.slice(1)} label="Orientation" /><SetupValue icon={<LayoutTemplate size={15} />} value={layoutOptions.find((item) => item.id === config.layout)?.label || "Kiosk layout"} label="Layout" /><SetupValue icon={<ImageIcon size={15} />} value={config.categoryCardStyle === "picture" ? "Picture Category" : "Simple Category"} label="Category cards" /><SetupValue icon={<ShoppingBag size={15} />} value={config.productCardStyle === "detailed" ? "Detailed Product" : "Simple Product"} label="Menu item cards" /></div><div className="mt-kiosk-save-row" role="status" aria-live="polite">{status}</div></section>;
}

function SetupValue({ icon, value, label }: { icon: ReactNode; value: string; label: string }) { return <div><span aria-hidden="true">{icon}</span><strong>{value}</strong><small>{label}</small></div>; }

function WarningRow({ message, detail, href, action }: { message: string; detail?: string; href: string; action: string }) { return <div className="mt-kiosk-warning"><AlertTriangle size={16} aria-hidden="true" /><span><strong>{message}</strong>{detail && <small>{detail}</small>}</span><Link href={href}>{action}</Link></div>; }

function PreviewPanelLegacy({ business, config, previewData, previewKey, onRefresh, compact = false }: { business: ApiBusiness; config: ScreenConfig; previewData: KioskExperienceData; previewKey: number; onRefresh: () => void; compact?: boolean }) {
  return <aside className={`mt-kiosk-screens-preview${compact ? " mt-kiosk-screens-preview--drawer" : ""}`}><header><div><h2>Live preview</h2><span className="mt-kiosk-preview-status"><i /> {config.orientation[0].toUpperCase() + config.orientation.slice(1)}</span></div><Link href="/dashboard/kiosk-experience/branding">Edit branding &amp; theme →</Link></header><div className="mt-kiosk-screens-preview__body"><KioskRuntime key={previewKey} routeSlug={business.slug} operationalMode="preview" experienceData={previewData} contained forcedOrientation={config.orientation} initialView="menu" /></div><footer><span><Info size={14} /> Previewing draft setup</span><button type="button" onClick={onRefresh}><RefreshCw size={14} /> Refresh preview</button></footer></aside>;
}

function PreviewPanel({ business, config, previewData, previewKey, onRefresh, compact = false }: { business: ApiBusiness; config: ScreenConfig; previewData: KioskExperienceData; previewKey: number; onRefresh: () => void; compact?: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!stageRef.current) return;
    const update = () => setStage({ width: stageRef.current?.clientWidth || 0, height: stageRef.current?.clientHeight || 0 });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);
  const canonical = config.orientation === "landscape" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
  const scale = stage.width && stage.height ? Math.min(stage.width / canonical.width, stage.height / canonical.height) : 0.25;
  return <aside className={`mt-kiosk-preview-studio${compact ? " mt-kiosk-preview-studio--drawer" : ""}`}><header className="mt-kiosk-preview-studio__header"><div><h2>Live preview</h2><span className="mt-kiosk-preview-status"><i /> {config.orientation[0].toUpperCase() + config.orientation.slice(1)}</span></div><Link href="/dashboard/kiosk-experience/branding">Branding →</Link></header><div ref={stageRef} className="mt-kiosk-preview-stage" data-testid="kiosk-preview-stage" data-canonical-width={canonical.width} data-canonical-height={canonical.height}><div className="mt-kiosk-preview-viewport" style={{ width: canonical.width * scale, height: canonical.height * scale }}><div style={{ width: canonical.width, height: canonical.height, transform: `scale(${scale})`, transformOrigin: "top left" }}><PreviewPanelLegacy business={business} config={config} previewData={previewData} previewKey={previewKey} onRefresh={onRefresh} compact /></div></div></div><footer className="mt-kiosk-preview-studio__footer"><span><Info size={14} /> Previewing draft</span><button type="button" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button><Link href="/dashboard/kiosk-experience/preview">Full preview ↗</Link></footer></aside>;
}
