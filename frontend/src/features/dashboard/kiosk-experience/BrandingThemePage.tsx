"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Grid } from "@astryxdesign/core/Grid";
import { Popover } from "@astryxdesign/core/Popover";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Card } from "@astryxdesign/core/Card";
import { DashboardPageWithPanel, DetailRow, KioskDevice, LoadingBlock, NoticeBanner, PageHeader, Panel, StatusBadge } from "@/components/dashboard/kit";
import { ColorPickerPortal } from "@/features/dashboard/kiosk-experience/ColorPickerPortal";
import { KioskRuntime, type KioskExperienceData } from "@/features/kiosk/KioskApp";
import { api as dashboardApi, assetUrl } from "@/lib/api";
import { formatKioskThemeSelection, parseKioskThemeSelection } from "@/lib/constants";
import type { Business as KioskBusiness, Category, KioskSetupOverview, Product } from "@/lib/types";
import { api, type Business } from "@/services/api";

type TypeScale = "compact" | "balanced" | "spacious";
type BackgroundTreatment = "clean" | "soft" | "dark";
type BrandingConfig = { logo: string; primary: string; accent: string; font: "Inter"; scale: TypeScale; background: BackgroundTreatment };
type SaveState = "saved" | "saving" | "error";
type PickerKey = "primary" | "accent";

const DEFAULT_PRIMARY = "#1A4D2E";
const DEFAULT_ACCENT = "#6D5DFB";
const kioskBusiness = (business: Business) => business as unknown as KioskBusiness;
const settingsOf = (business: Business) => (kioskBusiness(business).kiosk_start_screen_settings || {}) as Record<string, unknown>;
const safeHex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

function initialConfig(business: Business): BrandingConfig {
  const settings = settingsOf(business);
  const selection = parseKioskThemeSelection(kioskBusiness(business).kiosk_theme);
  const scale = settings.brand_type_scale === "compact" || settings.brand_type_scale === "spacious" ? settings.brand_type_scale : "balanced";
  const background = settings.brand_background === "soft" || settings.brand_background === "dark" ? settings.brand_background : "clean";
  return { logo: business.logo_path || "", primary: safeHex(business.brand_color, DEFAULT_PRIMARY), accent: safeHex(settings.brand_accent_color, safeHex(selection.accentColor, DEFAULT_ACCENT)), font: "Inter", scale, background };
}

const sameConfig = (a: BrandingConfig, b: BrandingConfig) => JSON.stringify(a) === JSON.stringify(b);

export function BrandingThemeSkeleton() {
  return <LoadingBlock rows={5} />;
}

export function BrandingThemePage({ business, products, categories, setup, refresh }: { business: Business; products: Product[]; categories: Category[]; setup: KioskSetupOverview | null; refresh: () => Promise<Business | null> }) {
  const initial = useMemo(() => initialConfig(business), [business]);
  const [config, setConfig] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const baselineRef = useRef(initial);
  const configRef = useRef(initial);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [unpublished, setUnpublished] = useState(setup?.unpublishedChanges || 0);
  const [previewContext, setPreviewContext] = useState<"menu" | "welcome">("menu");
  const [uploading, setUploading] = useState(false);
  const [undoLogo, setUndoLogo] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ key: PickerKey; original: string; temporary: string } | null>(null);
  const saveVersion = useRef(0);
  const dirty = !sameConfig(config, baseline);

  useEffect(() => { configRef.current = config; }, [config]);

  const update = (patch: Partial<BrandingConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setSaveState("saving");
    setSaveError("");
  };
  const themeFor = useCallback((next: BrandingConfig) => {
    const current = parseKioskThemeSelection(kioskBusiness(business).kiosk_theme);
    return formatKioskThemeSelection(current.templateId, next.background === "dark" ? "premium_contrast" : "premium_light", { cardStyle: current.cardStyle, categoryStyle: current.categoryStyle, productDisplayStyle: current.productDisplayStyle, actionBehavior: current.actionBehavior, accentColor: next.accent });
  }, [business]);
  const payloadFor = useCallback((next: BrandingConfig) => ({
    brand_color: next.primary,
    logo_path: next.logo || null,
    kiosk_theme: themeFor(next),
    kiosk_start_screen_settings: { ...settingsOf(business), brand_accent_color: next.accent, brand_font: next.font, brand_type_scale: next.scale, brand_background: next.background },
  }), [business, themeFor]);
  const save = useCallback(async (next: BrandingConfig) => {
    const version = ++saveVersion.current;
    setSaveState("saving");
    setSaveError("");
    try {
      await api.updateBusiness(business.id, payloadFor(next));
      if (version !== saveVersion.current) return;
      baselineRef.current = next;
      setBaseline(next);
      setSaveState("saved");
      const nextSetup = await dashboardApi.kioskSetup(business.id).catch(() => null);
      if (nextSetup) setUnpublished(nextSetup.unpublishedChanges);
      await refresh();
    } catch {
      if (version !== saveVersion.current) return;
      setSaveState("error");
      setSaveError("Couldn’t save branding changes.");
    }
  }, [business.id, payloadFor, refresh]);
  useEffect(() => {
    if (sameConfig(config, baseline)) return;
    const timer = window.setTimeout(() => void save(configRef.current), 550);
    return () => window.clearTimeout(timer);
  }, [config, baseline, save]);

  const openPicker = (key: PickerKey) => setPicker({ key, original: config[key], temporary: config[key] });
  const closePicker = () => setPicker(null);
  const applyColor = (key: PickerKey, value: string) => {
    update({ [key]: value } as Partial<BrandingConfig>);
    closePicker();
  };
  const reset = () => {
    if (!dirty) return;
    setConfig(baselineRef.current);
    setSaveState("saved");
    setSaveError("");
  };
  const uploadLogo = async (file: File) => {
    setUploading(true);
    setSaveError("");
    try {
      const result = await api.uploadBrandAsset(business.id, file);
      update({ logo: result.path });
    } catch {
      setSaveState("error");
      setSaveError("Couldn’t upload the new logo.");
    } finally {
      setUploading(false);
    }
  };
  const removeLogo = () => {
    setUndoLogo(config.logo || null);
    update({ logo: "" });
  };
  const restoreLogo = () => {
    if (!undoLogo) return;
    update({ logo: undoLogo });
    setUndoLogo(null);
  };

  // While a color is being chosen, the live preview shows the candidate color without saving it.
  const previewConfig = useMemo(() => (picker ? { ...config, [picker.key]: picker.temporary } : config), [config, picker]);
  const previewBusiness = useMemo(() => ({ ...(business as unknown as KioskBusiness), ...payloadFor(previewConfig), logo_path: previewConfig.logo || null, brand_color: previewConfig.primary, kiosk_theme: themeFor(previewConfig) }) as KioskBusiness, [business, payloadFor, previewConfig, themeFor]);
  const previewData = useMemo<KioskExperienceData>(() => ({ business: previewBusiness, products, categories }), [previewBusiness, products, categories]);
  const portrait = business.kiosk_screen_orientation === "portrait";
  const summary = `${config.scale[0].toUpperCase()}${config.scale.slice(1)} type · ${config.background[0].toUpperCase()}${config.background.slice(1)} background`;

  const preview = (
    <VStack gap={3}>
      <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
        <Text type="label">Live preview</Text>
        <SegmentedControl value={previewContext} onChange={(value) => setPreviewContext(value as "menu" | "welcome")} label="Preview context">
          <SegmentedControlItem value="menu" label="Menu" />
          <SegmentedControlItem value="welcome" label="Welcome" />
        </SegmentedControl>
      </HStack>
      <KioskDevice orientation={portrait ? "portrait" : "landscape"} label="Branding preview">
        <KioskRuntime key={previewContext} routeSlug={business.slug} operationalMode="preview" experienceData={previewData} contained forcedOrientation={portrait ? "portrait" : "landscape"} initialView={previewContext === "menu" ? "menu" : "start"} />
      </KioskDevice>
      <HStack gap={2} hAlign="between" vAlign="center">
        <Text type="supporting" color="secondary">Previewing draft</Text>
      </HStack>
    </VStack>
  );

  return (
    <DashboardPageWithPanel panel={preview} panelWidth={400}>
      <PageHeader
        eyebrow="Kiosk & Menu"
        title="Branding & theme"
        description="Shape the visual identity customers see on your kiosk."
        actions={<Button label="Open full preview" variant="secondary" href="/dashboard/kiosk-experience/preview" />}
      >
        {unpublished > 0 && <NoticeBanner tone="warning" title={`${unpublished} unpublished change${unpublished === 1 ? "" : "s"}`} action={<Button label="Review changes" variant="ghost" href="/dashboard/kiosk-experience/publish" />} />}
      </PageHeader>
      <Panel title="Brand logo" description="Shown on the kiosk welcome and menu screens.">
        <HStack gap={4} vAlign="center" wrap="wrap">
          <Avatar size={96} shape="rounded" name={business.name} src={config.logo ? assetUrl(config.logo) || undefined : undefined} tooltip={false} />
          <VStack gap={2}>
            <FileInput label="Choose logo" accept="image/png,image/jpeg,image/gif,image/webp" description="PNG, JPG, GIF or WebP · 5 MB max" maxSize={5 * 1024 * 1024} value={null} onChange={(file) => { const picked = Array.isArray(file) ? file[0] : file; if (picked) void uploadLogo(picked); }} />
            <HStack gap={2} wrap="wrap">
              {config.logo && <Button label="Remove logo" variant="destructive" size="sm" onClick={removeLogo} />}
              {undoLogo && <Button label="Undo logo removal" variant="ghost" size="sm" onClick={restoreLogo} />}
              {uploading && <Text type="supporting" color="secondary">Uploading…</Text>}
            </HStack>
          </VStack>
        </HStack>
      </Panel>
      <Panel title="Brand colors" description="Primary colors drive buttons and highlights; the accent marks interactive details.">
        <Grid columns={{ minWidth: 240, repeat: "fit" }} gap={3}>
          <ColorSwatchPicker label="Primary color" id="primary" value={config.primary} open={picker?.key === "primary"} onOpen={() => openPicker("primary")} onClose={closePicker}>
            {picker?.key === "primary" && <ColorPickerPortal label="Primary color" value={picker.original} onPreview={(temporary) => setPicker((current) => current ? { ...current, temporary } : current)} onCancel={closePicker} onApply={(value) => applyColor("primary", value)} />}
          </ColorSwatchPicker>
          <ColorSwatchPicker label="Accent color" id="accent" value={config.accent} open={picker?.key === "accent"} onOpen={() => openPicker("accent")} onClose={closePicker}>
            {picker?.key === "accent" && <ColorPickerPortal label="Accent color" value={picker.original} onPreview={(temporary) => setPicker((current) => current ? { ...current, temporary } : current)} onCancel={closePicker} onApply={(value) => applyColor("accent", value)} />}
          </ColorSwatchPicker>
        </Grid>
      </Panel>
      <Panel title="Typography" description="Customer-facing text uses the supported brand font.">
        <Selector label="Brand font" value={config.font} onChange={() => undefined} isDisabled options={[{ value: "Inter", label: "Inter (supported font)" }]} />
        <VStack gap={2}>
          <Text type="label">Type scale</Text>
          <SegmentedControl value={config.scale} onChange={(value) => update({ scale: value as TypeScale })} label="Type scale">
            <SegmentedControlItem value="compact" label="Compact" />
            <SegmentedControlItem value="balanced" label="Balanced" />
            <SegmentedControlItem value="spacious" label="Spacious" />
          </SegmentedControl>
        </VStack>
      </Panel>
      <Panel title="Kiosk background" description="Sets the surface behind menu content.">
        <Grid columns={{ minWidth: 160, repeat: "fit" }} gap={3}>
          {(["clean", "soft", "dark"] as BackgroundTreatment[]).map((value) => (
            <ClickableCard key={value} label={`${value[0].toUpperCase()}${value.slice(1)} background`} onClick={() => update({ background: value })} padding={3}>
              <VStack gap={2}>
                <Card padding={3} variant={value === "dark" ? "gray" : value === "soft" ? "muted" : "default"} height={56}><Text type="supporting" color={value === "dark" ? "primary" : "secondary"}>Menu</Text></Card>
                <HStack gap={2} vAlign="center" hAlign="between">
                  <Text type="body" weight="semibold">{`${value[0].toUpperCase()}${value.slice(1)}`}</Text>
                  {config.background === value && <Check size={14} aria-hidden="true" />}
                </HStack>
              </VStack>
            </ClickableCard>
          ))}
        </Grid>
      </Panel>
      <Panel>
        <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
          <HStack gap={2} vAlign="center" wrap="wrap">
            <StatusBadge tone={config.logo ? "success" : "neutral"}>{config.logo ? "Logo" : "No logo"}</StatusBadge>
            <DetailRow label="Primary"><VStack gap={0} width={14} height={14} style={{ background: config.primary, borderRadius: 999 }} /></DetailRow>
            <DetailRow label="Accent"><VStack gap={0} width={14} height={14} style={{ background: config.accent, borderRadius: 999 }} /></DetailRow>
            <Text type="supporting" color="secondary">{summary}</Text>
          </HStack>
          <HStack gap={2} vAlign="center">
            {saveState === "saving" && <Text type="supporting" color="secondary">Saving…</Text>}
            {saveState === "error" ? <><StatusBadge tone="danger">{saveError}</StatusBadge><Button label="Retry save" variant="ghost" size="sm" onClick={() => void save(configRef.current)} /></> : !dirty && saveState === "saved" ? <HStack gap={1} vAlign="center"><Check size={14} aria-hidden="true" /><Text type="supporting" color="secondary">Saved as draft</Text></HStack> : null}
            <Button label="Reset" variant="secondary" size="sm" icon={<RotateCcw size={14} aria-hidden="true" />} isDisabled={!dirty} onClick={reset} />
          </HStack>
        </HStack>
      </Panel>
      <Text type="supporting" color="secondary">{`Brand settings are saved as a draft. Publish them from `}<Link href="/dashboard/kiosk-experience/publish">Test &amp; Publish</Link>{" to make them live."}</Text>
    </DashboardPageWithPanel>
  );
}

function ColorSwatchPicker({ id, label, value, open, onOpen, onClose, children }: { id: PickerKey; label: string; value: string; open: boolean; onOpen: () => void; onClose: () => void; children: ReactNode }) {
  return (
    <Popover label={label} isOpen={open} onOpenChange={(next) => { if (next) onOpen(); else onClose(); }} placement="below" alignment="start" padding={4} content={children}>
      <ClickableCard label={`Change ${label.toLowerCase()}`} onClick={onOpen} padding={3} data-brand-color={id}>
        <HStack gap={3} vAlign="center">
          <VStack gap={0} width={40} height={40} style={{ background: value, borderRadius: "var(--radius-element)" }} />
          <VStack gap={0}>
            <Text type="body" weight="semibold">{label}</Text>
            <Text type="supporting" color="secondary">{value.toUpperCase()}</Text>
          </VStack>
        </HStack>
      </ClickableCard>
    </Popover>
  );
}
