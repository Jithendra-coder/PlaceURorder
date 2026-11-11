"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Maximize2, RotateCcw, X } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { DashboardPageWithPanel, DetailRow, KioskDevice, LoadingBlock, NoticeBanner, PageHeader, Panel, ScaledStage, StatusBadge } from "@/components/dashboard/kit";
import { KioskRuntime, type KioskExperienceData } from "@/features/kiosk/KioskApp";
import { api as dataApi, type PromotionRecord } from "@/lib/api";
import { parseKioskThemeSelection } from "@/lib/constants";
import type { Business as KioskBusiness, Category, KioskSetupOverview, Product } from "@/lib/types";
import { type Business } from "@/services/api";

type PreviewContext = "welcome" | "menu";
type PreviewKioskProps = { business: Business; products: Product[]; categories: Category[]; setup: KioskSetupOverview | null };
type RailRow = { title: string; summary: string; href: string; label: string };
type Attention = { title: string; detail: string; href: string; label: string };

const kioskBusiness = (business: Business) => business as unknown as KioskBusiness;
const queryFor = (context: PreviewContext) => `?from=preview-kiosk&previewContext=${context}`;
const editHref = (path: string, context: PreviewContext) => `${path}${queryFor(context)}`;
const readableTemplate = (value: string) => ({ category_gate: "Category Gate", left_category: "Left Rail", top_category: "Top Bar" }[value] || "Kiosk layout");

export function PreviewKioskSkeleton() {
  return <LoadingBlock rows={6} />;
}

export function PreviewKioskPage({ business, products, categories, setup }: PreviewKioskProps) {
  const raw = kioskBusiness(business);
  const [context, setContext] = useState<PreviewContext>(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("previewContext") === "menu" ? "menu" : raw.kiosk_start_screen_enabled === false ? "menu" : "welcome");
  const [runtimeKey, setRuntimeKey] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const [promotions, setPromotions] = useState<PromotionRecord[] | null>(null);
  const [promotionError, setPromotionError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void dataApi.promotions(business.id).then((result) => { if (!cancelled) setPromotions(Array.isArray(result.promotions) ? result.promotions : []); }).catch(() => { if (!cancelled) setPromotionError(true); });
    return () => { cancelled = true; };
  }, [business.id]);

  const orientation = raw.kiosk_screen_orientation === "portrait" ? "portrait" : "landscape";
  const previewData = useMemo<KioskExperienceData>(() => ({ business: raw, products, categories }), [raw, products, categories]);
  const rows = useMemo(() => buildRows(business, products, categories, promotions, promotionError, context), [business, products, categories, promotions, promotionError, context]);
  const attention = useMemo(() => buildAttention(products, categories, promotionError, context), [products, categories, promotionError, context]);
  const unpublished = setup?.unpublishedChanges || 0;
  const welcomeEnabled = raw.kiosk_start_screen_enabled !== false;

  const panel = (
    <VStack gap={4}>
      <Text type="label">Customize</Text>
      {attention.length > 0 && (
        <VStack gap={2} aria-label="Needs attention">
          {attention.slice(0, 3).map((item) => <NoticeBanner key={item.title} tone="warning" title={item.title} description={item.detail} action={<Button label={item.label} variant="ghost" href={item.href} />} />)}
        </VStack>
      )}
      <VStack gap={3}>
        {rows.map((row) => (
          <HStack key={row.title} gap={2} vAlign="center" hAlign="between">
            <VStack gap={0}>
              <Text type="body" weight="semibold">{row.title}</Text>
              <Text type="supporting" color="secondary">{row.summary}</Text>
            </VStack>
            <Button label={row.label} variant="ghost" size="sm" href={row.href} />
          </HStack>
        ))}
      </VStack>
    </VStack>
  );

  return (
    <DashboardPageWithPanel panel={panel} width={1240} panelWidth={360}>
      <PageHeader
        eyebrow="Kiosk & Menu"
        title="Preview kiosk"
        description="See and test your kiosk before publishing."
        actions={<Button label="Full screen" variant="secondary" icon={<Maximize2 size={15} aria-hidden="true" />} onClick={() => setFullScreen(true)} />}
      >
        {unpublished > 0 && <NoticeBanner tone="warning" title={`${unpublished} unpublished change${unpublished === 1 ? "" : "s"}`} action={<Button label="Review changes" variant="ghost" href="/dashboard/kiosk-experience/publish" />} />}
      </PageHeader>
      <Panel
        title="Kiosk preview"
        actions={<>
          <SegmentedControl value={context} onChange={(value) => setContext(value as PreviewContext)} label="Preview context">
            <SegmentedControlItem value="welcome" label="Welcome" isDisabled={!welcomeEnabled} />
            <SegmentedControlItem value="menu" label="Menu" />
          </SegmentedControl>
          <StatusBadge tone="info">{orientation[0].toUpperCase() + orientation.slice(1)}</StatusBadge>
        </>}
      >
        <KioskDevice orientation={orientation} label="Kiosk preview">
          <KioskRuntime key={`${runtimeKey}-${context}`} routeSlug={business.slug} operationalMode="preview" experienceData={previewData} contained forcedOrientation={orientation} initialView={context === "welcome" ? "start" : "menu"} />
        </KioskDevice>
        <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
          <Text type="supporting" color="secondary">Preview mode</Text>
          <HStack gap={2}>
            <Button label="Restart preview" variant="ghost" size="sm" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => setRuntimeKey((value) => value + 1)} />
          </HStack>
        </HStack>
      </Panel>
      <Dialog isOpen={fullScreen} onOpenChange={setFullScreen} variant="fullscreen" purpose="info" padding={4}>
        <VStack gap={4}>
          <Heading level={2}>Full-screen kiosk preview</Heading>
          <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
            <Button label="Exit full screen" variant="secondary" icon={<X size={16} aria-hidden="true" />} onClick={() => setFullScreen(false)} />
            <SegmentedControl value={context} onChange={(value) => setContext(value as PreviewContext)} label="Preview context">
              <SegmentedControlItem value="welcome" label="Welcome" isDisabled={!welcomeEnabled} />
              <SegmentedControlItem value="menu" label="Menu" />
            </SegmentedControl>
            <StatusBadge tone="info">Preview mode</StatusBadge>
          </HStack>
          <ScaledStage width={orientation === "portrait" ? 1080 : 1920} height={orientation === "portrait" ? 1920 : 1080} label="Full-screen kiosk preview">
            <KioskRuntime key={`full-${runtimeKey}-${context}`} routeSlug={business.slug} operationalMode="preview" experienceData={previewData} contained forcedOrientation={orientation} initialView={context === "welcome" ? "start" : "menu"} />
          </ScaledStage>
        </VStack>
      </Dialog>
      {unpublished > 0 ? null : <HStack gap={2} vAlign="center"><Check size={14} aria-hidden="true" /><Text type="supporting" color="secondary">Preview matches published kiosk</Text></HStack>}
      {promotionError && <DetailRow label="Promotions">Could not load promotion status.</DetailRow>}
    </DashboardPageWithPanel>
  );
}


function buildRows(business: Business, products: Product[], categories: Category[], promotions: PromotionRecord[] | null, promotionError: boolean, context: PreviewContext): RailRow[] {
  const raw = kioskBusiness(business);
  const settings = (raw.kiosk_start_screen_settings || {}) as Record<string, unknown>;
  const selection = parseKioskThemeSelection(raw.kiosk_theme);
  const available = products.filter((product) => product.is_available).length;
  const activePromotions = promotions?.filter((promotion) => promotion.status === "active").length;
  const scheduledPromotions = promotions?.filter((promotion) => promotion.status === "scheduled").length;
  return [
    { title: "Welcome screen", summary: raw.kiosk_start_screen_enabled === false ? "Disabled" : raw.offer_image_path ? "Enabled · Background image" : "Enabled · Theme background", href: editHref("/dashboard/kiosk-experience/welcome-screen", context), label: "Edit Welcome Screen" },
    { title: "Kiosk layout", summary: `${raw.kiosk_screen_orientation === "portrait" ? "Portrait" : "Landscape"} · ${readableTemplate(selection.templateId)}`, href: editHref("/dashboard/kiosk-experience/screens", context), label: "Edit Kiosk Layout" },
    { title: "Branding", summary: `${raw.logo_path ? "Logo" : "Business name"} · ${settings.brand_type_scale === "spacious" ? "Spacious" : settings.brand_type_scale === "compact" ? "Compact" : "Balanced"} type`, href: editHref("/dashboard/kiosk-experience/branding", context), label: "Edit Branding" },
    { title: "Menu", summary: `${products.length} items · ${categories.length} categories`, href: editHref("/dashboard/kiosk-experience/menu", context), label: "Edit Menu" },
    { title: "Availability", summary: `${available} available · ${products.length - available} unavailable`, href: editHref("/dashboard/kiosk-experience/availability", context), label: "Edit Availability" },
    { title: "Promotions", summary: promotionError ? "Couldn’t load status" : promotions === null ? "Loading status…" : activePromotions || scheduledPromotions ? `${activePromotions || 0} active · ${scheduledPromotions || 0} scheduled` : "No active promotions", href: editHref("/dashboard/kiosk-experience/promotions", context), label: "Edit Promotions" },
  ];
}

function buildAttention(products: Product[], categories: Category[], promotionError: boolean, context: PreviewContext): Attention[] {
  const issues: Attention[] = [];
  const missingImages = products.filter((product) => !product.primary_image_path).length;
  if (!products.length) issues.push({ title: "Menu is empty", detail: "Add menu items before publishing.", href: editHref("/dashboard/kiosk-experience/menu", context), label: "Add items" });
  else if (missingImages) issues.push({ title: "Menu images missing", detail: `${missingImages} item${missingImages === 1 ? " is" : "s are"} missing an image.`, href: editHref("/dashboard/kiosk-experience/menu", context), label: "Fix images" });
  if (categories.some((category) => category.is_active && !products.some((product) => product.category_id === category.id && product.is_available))) issues.push({ title: "Empty category", detail: "An active category has no available items.", href: editHref("/dashboard/kiosk-experience/availability", context), label: "Review availability" });
  if (promotionError) issues.push({ title: "Promotion status unavailable", detail: "Couldn’t load promotion status.", href: editHref("/dashboard/kiosk-experience/promotions", context), label: "Review promotions" });
  return issues;
}
