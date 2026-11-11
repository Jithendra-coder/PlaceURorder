"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ExternalLink, Image as ImageIcon, Monitor, RotateCcw, ShoppingBag, Smartphone } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { Card } from "@astryxdesign/core/Card";
import { DashboardPageWithPanel, DetailDrawer, KioskDevice, Metric, MetricGrid, NoticeBanner, PageHeader, Panel, StatusBadge } from "@/components/dashboard/kit";
import { KioskRuntime, type KioskExperienceData } from "@/features/kiosk/KioskApp";
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
  { id: "left_category", label: "Left rail", meta: "Left Category Rail" },
  { id: "top_category", label: "Top bar", meta: "Top Category Bar" },
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
  return (
    <VStack gap={4} aria-busy="true">
      <Skeleton height={48} width="40%" radius={3} />
      <Grid columns={{ minWidth: 220, repeat: "fit" }} gap={4}>
        <Skeleton height={160} width="100%" radius={3} />
        <Skeleton height={160} width="100%" radius={3} />
        <Skeleton height={160} width="100%" radius={3} />
      </Grid>
    </VStack>
  );
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

  const preview = <ScreenPreview business={business} config={config} previewData={previewData} />;

  return (
    <DashboardPageWithPanel panel={preview} panelWidth={400}>
      <PageHeader
        eyebrow="Kiosk & Menu"
        title="Kiosk screens"
        description="Choose how your kiosk menu is presented to customers."
        actions={<>
          <Button label="Preview kiosk" variant="secondary" onClick={() => setPreviewOpen(true)} icon={<Monitor size={16} aria-hidden="true" />} />
          <Button label="Open full preview" variant="ghost" href="/dashboard/kiosk-experience/preview" icon={<ExternalLink size={16} aria-hidden="true" />} />
        </>}
      >
        {unpublishedCount > 0 && <NoticeBanner tone="warning" title={`${unpublishedCount} unpublished change${unpublishedCount === 1 ? "" : "s"}`} action={<Button label="Review in Test & Publish" variant="ghost" href="/dashboard/kiosk-experience/publish" />} />}
      </PageHeader>
      <Panel title="Orientation" description="Choose the screen orientation.">
        <Grid columns={{ minWidth: 200, repeat: "fit" }} gap={3}>
          {orientationOptions.map((option) => (
            <OptionCard key={option.id} label={option.label} selected={config.orientation === option.id} onSelect={() => select({ orientation: option.id })}>
              <HStack gap={2} vAlign="center">
                {option.id === "portrait" ? <Smartphone size={19} aria-hidden="true" /> : <Monitor size={19} aria-hidden="true" />}
                <Text type="body" weight="semibold">{option.label}</Text>
              </HStack>
            </OptionCard>
          ))}
        </Grid>
      </Panel>
      <Panel title="Layout" description="Choose how customers move through categories.">
        <Grid columns={{ minWidth: 200, repeat: "fit" }} gap={3}>
          {layoutOptions.map((option) => (
            <OptionCard key={option.id} label={option.meta} selected={config.layout === option.id} onSelect={() => select({ layout: option.id })}>
              <LayoutMiniature layout={option.id} />
              <Text type="body" weight="semibold">{option.label}</Text>
            </OptionCard>
          ))}
        </Grid>
      </Panel>
      <Panel title="Category style" description="Choose how category choices appear.">
        <Grid columns={{ minWidth: 200, repeat: "fit" }} gap={3}>
          {categoryOptions.map((option) => (
            <OptionCard key={option.id} label={option.meta} selected={config.categoryCardStyle === option.id} onSelect={() => select({ categoryCardStyle: option.id })}>
              <CategoryMiniature style={option.id} category={categories[0]} />
              <Text type="body" weight="semibold">{option.label}</Text>
            </OptionCard>
          ))}
        </Grid>
      </Panel>
      <Panel title="Product style" description="Choose how products appear to customers.">
        <Grid columns={{ minWidth: 200, repeat: "fit" }} gap={3}>
          {productOptions.map((option) => (
            <OptionCard key={option.id} label={option.meta} selected={config.productCardStyle === option.id} onSelect={() => select({ productCardStyle: option.id })}>
              <ProductMiniature style={option.id} product={products[0]} />
              <Text type="body" weight="semibold">{option.label}</Text>
            </OptionCard>
          ))}
        </Grid>
      </Panel>
      <CurrentSetup config={config} baseline={baseline} onReset={reset} saveState={saveState} saveError={saveError} onRetry={() => void saveConfig(configRef.current)} unpublishedCount={unpublishedCount} />
      {(missingMenu || missingCategories || (config.categoryCardStyle === "picture" && categoriesWithoutImages > 0) || productsWithoutImages > 0) && (
        <VStack gap={2} aria-live="polite">
          {missingMenu && <NoticeBanner tone="warning" title="No menu items to preview" description="Add items to see your kiosk menu." action={<Button label="Go to Manage Menu" variant="ghost" href="/dashboard/kiosk-experience/menu?mode=items" />} />}
          {missingCategories && <NoticeBanner tone="warning" title="No categories available to preview." description="Create categories to organize your menu." action={<Button label="Manage categories" variant="ghost" href="/dashboard/kiosk-experience/menu?mode=combos" />} />}
          {config.categoryCardStyle === "picture" && categoriesWithoutImages > 0 && <NoticeBanner tone="warning" title={`${categoriesWithoutImages} categor${categoriesWithoutImages === 1 ? "y has" : "ies have"} no images`} action={<Button label="Review" variant="ghost" href="/dashboard/kiosk-experience/menu?mode=items" />} />}
          {productsWithoutImages > 0 && <NoticeBanner tone="info" title={`${productsWithoutImages} item${productsWithoutImages === 1 ? " has" : "s have"} no images`} description="The kiosk fallback image will be used." action={<Button label="Review" variant="ghost" href="/dashboard/kiosk-experience/menu?mode=items" />} />}
        </VStack>
      )}
      <DetailDrawer title="Live preview" isOpen={previewOpen} onClose={() => setPreviewOpen(false)} width={520} footer={<Button label="Close" variant="secondary" onClick={() => setPreviewOpen(false)} />}>
        {preview}
      </DetailDrawer>
    </DashboardPageWithPanel>
  );
}

function OptionCard({ label, selected, onSelect, children }: { label: string; selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <SelectableCard label={label} isSelected={selected} onChange={(next) => { if (next) onSelect(); }} padding={3}>
      <VStack gap={3}>
        {children}
        {selected && <StatusBadge tone="info">Selected</StatusBadge>}
      </VStack>
    </SelectableCard>
  );
}

function LayoutMiniature({ layout }: { layout: KioskLayoutId }) {
  const cells = Array.from({ length: 6 }, (_, index) => index);
  return (
    <Grid columns={layout === "top_category" ? 3 : layout === "left_category" ? 2 : 3} gap={1}>
      {cells.map((cell) => <Card key={cell} padding={1} variant="muted" height={layout === "left_category" && cell === 0 ? 56 : 24} />)}
    </Grid>
  );
}

function CategoryMiniature({ style, category }: { style: "picture" | "simple"; category?: Category }) {
  const imageSrc = category?.image_path ? assetUrl(category.image_path) : "";
  return style === "picture" ? (
    <Card padding={2} variant="muted">
      <VStack gap={2} hAlign="center">
        {imageSrc ? <Image src={imageSrc} alt="" width={100} height={42} unoptimized /> : <ImageIcon size={18} aria-hidden="true" />}
        <Text type="supporting">{category?.name || "Category"}</Text>
      </VStack>
    </Card>
  ) : (
    <Card padding={2} variant="muted">
      <VStack gap={0}>
        <Text type="body" weight="semibold">{category?.name || "Category"}</Text>
        <Text type="supporting" color="secondary">{category ? "Menu category" : "Categories"}</Text>
      </VStack>
    </Card>
  );
}

function ProductMiniature({ style, product }: { style: "detailed" | "simple"; product?: Product }) {
  return (
    <Card padding={2} variant="muted">
      <HStack gap={2} vAlign="center">
        {product?.primary_image_path ? <Image src={assetUrl(product.primary_image_path)} alt="" width={38} height={38} unoptimized /> : <ShoppingBag size={17} aria-hidden="true" />}
        <VStack gap={0}>
          <Text type="body" weight="semibold">{product?.name || "Classic Burger"}</Text>
          {style === "detailed" && <Text type="supporting" color="secondary">{product?.description || "Freshly prepared"}</Text>}
          <Text type="supporting">{`₹${product?.price || "199"}`}</Text>
        </VStack>
      </HStack>
    </Card>
  );
}

function CurrentSetup({ config, baseline, onReset, saveState, saveError, onRetry, unpublishedCount }: { config: ScreenConfig; baseline: ScreenConfig; onReset: () => void; saveState: SaveState; saveError: string; onRetry: () => void; unpublishedCount: number }) {
  const status = saveState === "error"
    ? <HStack gap={2} vAlign="center"><StatusBadge tone="danger">Couldn’t save changes</StatusBadge><Button label="Retry" variant="ghost" size="sm" onClick={onRetry} /></HStack>
    : saveState === "saving"
      ? <Text type="supporting" color="secondary">Saving…</Text>
      : <HStack gap={2} vAlign="center"><Check size={14} aria-hidden="true" /><Text type="supporting" color="secondary">{`Changes saved as draft${unpublishedCount > 0 ? " · publish to make them live on your kiosks" : ""}`}</Text></HStack>;
  return (
    <Panel title="Current setup" description={saveError || "Your selections update the draft preview automatically."} actions={<Button label="Reset" variant="secondary" size="sm" icon={<RotateCcw size={14} aria-hidden="true" />} isDisabled={sameConfig(config, baseline)} onClick={onReset} />}>
      <MetricGrid>
        <Metric label="Orientation" value={config.orientation[0].toUpperCase() + config.orientation.slice(1)} />
        <Metric label="Layout" value={layoutOptions.find((item) => item.id === config.layout)?.label || "Layout"} />
        <Metric label="Category style" value={config.categoryCardStyle === "picture" ? "Picture" : "Simple"} />
        <Metric label="Product style" value={config.productCardStyle === "detailed" ? "Detailed" : "Simple"} />
      </MetricGrid>
      <VStack gap={0} role="status" aria-live="polite">{status}</VStack>
    </Panel>
  );
}

function ScreenPreview({ business, config, previewData }: { business: ApiBusiness; config: ScreenConfig; previewData: KioskExperienceData }) {
  const orientation = config.orientation === "landscape" ? "landscape" : "portrait";
  return (
    <VStack gap={4}>
      <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
        <VStack gap={1}>
          <Text type="label">Live preview</Text>
          <Text type="supporting" color="secondary">Updates as you change the screen setup.</Text>
        </VStack>
        <Button label="Edit branding" variant="ghost" size="sm" href="/dashboard/kiosk-experience/branding" />
      </HStack>
      <KioskDevice orientation={orientation} label="Kiosk screen preview">
        <KioskRuntime routeSlug={business.slug} operationalMode="preview" experienceData={previewData} contained forcedOrientation={orientation} initialView="menu" />
      </KioskDevice>
    </VStack>
  );
}

