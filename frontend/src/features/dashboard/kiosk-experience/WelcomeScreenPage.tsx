"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Image as ImageIcon, X } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Grid } from "@astryxdesign/core/Grid";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Card } from "@astryxdesign/core/Card";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { DashboardPageWithPanel, KioskDevice, LoadingBlock, NoticeBanner, PageHeader, Panel, StatusBadge } from "@/components/dashboard/kit";
import { KioskRuntime, type KioskExperienceData } from "@/features/kiosk/KioskApp";
import { api as dashboardApi, assetUrl as nullableAssetUrl } from "@/lib/api";
import type { Business, Category, Product } from "@/lib/types";
import { api, type Business as ApiBusiness } from "@/services/api";

const assetUrl = (path?: string | null) => nullableAssetUrl(path) || "";

type Readability = "auto" | "light" | "strong";
type ContentPosition = "bottom_left" | "bottom_center" | "center";
type WelcomeConfig = { enabled: boolean; background: string; focalX: number; focalY: number; readability: Readability; position: ContentPosition; headline: string; highlight: string; supporting: string; startPrompt: string; touchAnywhere: boolean; autoStart: "off" };
type SaveState = "saved" | "saving" | "error";
type WelcomeBusiness = ApiBusiness & { offer_title?: string | null; offer_subtitle?: string | null; offer_badge?: string | null; offer_cta?: string | null; offer_image_path?: string | null; offer_background?: string | null; kiosk_start_screen_enabled?: boolean; kiosk_start_text_position?: string; kiosk_touch_to_start?: boolean; kiosk_start_screen_settings?: Record<string, unknown> };

const asWelcomeBusiness = (business: ApiBusiness) => business as WelcomeBusiness;
const settingsOf = (business: ApiBusiness) => asWelcomeBusiness(business).kiosk_start_screen_settings || {};

function initialConfig(business: ApiBusiness): WelcomeConfig {
  const raw = asWelcomeBusiness(business);
  const settings = settingsOf(business);
  const welcome = raw.welcome_screen;
  const position = (settings.content_position === "bottom_center" || settings.content_position === "center" ? settings.content_position : welcome?.text_position === "middle" ? "center" : welcome?.text_position === "bottom" ? "bottom_left" : "center") as ContentPosition;
  return {
    enabled: welcome?.enabled ?? raw.kiosk_start_screen_enabled !== false,
    background: raw.offer_image_path || "",
    focalX: typeof settings.focal_x === "number" ? settings.focal_x : 0.5,
    focalY: typeof settings.focal_y === "number" ? settings.focal_y : 0.5,
    readability: settings.readability === "light" || settings.readability === "strong" ? settings.readability : "auto",
    position,
    headline: raw.offer_title || "Order Here",
    highlight: typeof settings.highlight_text === "string" ? settings.highlight_text : "",
    supporting: raw.offer_subtitle || welcome?.supporting_text || "",
    startPrompt: typeof settings.start_prompt === "string" ? settings.start_prompt : welcome?.instruction_text || "Touch screen to order",
    touchAnywhere: welcome?.touch_anywhere_to_start ?? raw.kiosk_touch_to_start === true,
    autoStart: "off",
  };
}

function sameConfig(a: WelcomeConfig, b: WelcomeConfig) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function updatePayload(business: ApiBusiness, config: WelcomeConfig) {
  const raw = asWelcomeBusiness(business);
  const current = settingsOf(business);
  return {
    offer_title: config.headline,
    offer_subtitle: config.supporting,
    offer_image_path: config.background || null,
    offer_background: config.readability === "light" ? "black" : raw.offer_background || "white",
    kiosk_start_screen_enabled: config.enabled,
    kiosk_start_text_position: config.position === "bottom_left" || config.position === "bottom_center" ? "bottom" : "middle",
    kiosk_touch_to_start: config.touchAnywhere,
    kiosk_start_screen_settings: { ...current, focal_x: config.focalX, focal_y: config.focalY, readability: config.readability, content_position: config.position, highlight_text: config.highlight, start_prompt: config.startPrompt, configured: true },
    welcome_screen: { ...(raw.welcome_screen || {}), enabled: config.enabled, heading: config.headline, supporting_text: config.supporting, instruction_text: config.startPrompt, start_button_text: raw.welcome_screen?.start_button_text || "Start", text_position: config.position === "bottom_left" || config.position === "bottom_center" ? "bottom" : "middle", touch_anywhere_to_start: config.touchAnywhere, show_business_logo: raw.welcome_screen?.show_business_logo ?? true },
  };
}

export function WelcomeScreenSkeleton() {
  return <LoadingBlock rows={6} />;
}

export function WelcomeScreenPage({ business, products, categories, setup, refresh }: { business: ApiBusiness; products: Product[]; categories: Category[]; setup: { unpublishedChanges: number } | null; refresh: () => Promise<ApiBusiness | null> }) {
  const initial = useMemo(() => initialConfig(business), [business]);
  const [config, setConfig] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const baselineRef = useRef(initial);
  const configRef = useRef(initial);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [unpublishedCount, setUnpublishedCount] = useState(setup?.unpublishedChanges || 0);
  const dirty = !sameConfig(config, baseline);

  useEffect(() => { configRef.current = config; }, [config]);

  const save = useCallback(async (next: WelcomeConfig) => {
    setSaveState("saving");
    setSaveError("");
    try {
      await api.updateBusiness(business.id, updatePayload(business, next));
      baselineRef.current = next;
      setBaseline(next);
      setSaveState("saved");
      const nextSetup = await dashboardApi.kioskSetup(business.id).catch(() => null);
      if (nextSetup) setUnpublishedCount(nextSetup.unpublishedChanges);
      await refresh();
    } catch (cause) {
      setSaveState("error");
      setSaveError(cause instanceof Error ? cause.message : "Could not save welcome screen.");
    }
  }, [business, refresh]);

  useEffect(() => {
    if (sameConfig(config, baseline)) return;
    const timer = window.setTimeout(() => void save(configRef.current), 500);
    return () => window.clearTimeout(timer);
  }, [config, baseline, save]);

  const select = (patch: Partial<WelcomeConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setSaveState("saving");
    setSaveError("");
  };
  const reset = () => {
    if (!dirty) return;
    setConfig(baselineRef.current);
    setBaseline(baselineRef.current);
    setSaveState("saved");
    setSaveError("");
  };
  const previewBusiness = useMemo(() => {
    const payload = updatePayload(business, config);
    return { ...(business as unknown as Business), ...payload } as Business;
  }, [business, config]);
  const previewData: KioskExperienceData = useMemo(() => ({ business: previewBusiness, products, categories }), [previewBusiness, products, categories]);
  const upload = async (file: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setUploadError("This image format isn't supported.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const result = await api.uploadBrandAsset(business.id, file);
      select({ background: result.path });
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "Couldn’t upload the new image.");
    } finally {
      setUploading(false);
    }
  };

  const orientation = business.kiosk_screen_orientation === "portrait" ? "portrait" : "landscape";
  const preview = (
    <VStack gap={3}>
      <HStack gap={2} hAlign="between" vAlign="center">
        <Text type="label">Live preview</Text>
        <StatusBadge tone="info">{orientation[0].toUpperCase() + orientation.slice(1)}</StatusBadge>
      </HStack>
      <KioskDevice orientation={orientation} label="Welcome screen preview">
        <KioskRuntime routeSlug={business.slug} operationalMode="preview" experienceData={previewData} contained forcedOrientation={orientation} initialView="start" />
      </KioskDevice>
      <HStack gap={2} hAlign="between" vAlign="center">
        <Text type="supporting" color="secondary">Draft preview</Text>
      </HStack>
    </VStack>
  );

  return (
    <DashboardPageWithPanel panel={preview} panelWidth={400}>
      <PageHeader
        eyebrow="Kiosk & Menu"
        title="Welcome screen"
        description="Control what customers see before they start ordering."
        actions={<Button label="Open full preview" variant="secondary" href="/dashboard/kiosk-experience/preview" />}
      >
        {unpublishedCount > 0 && <NoticeBanner tone="warning" title={`${unpublishedCount} unpublished change${unpublishedCount === 1 ? "" : "s"}`} action={<Button label="Review changes" variant="ghost" href="/dashboard/kiosk-experience/publish" />} />}
      </PageHeader>
      <Panel title="Welcome setup" actions={<Switch label="Welcome screen on" value={config.enabled} onChange={(checked) => select({ enabled: checked })} />}>
        <VStack gap={4}>
          <Panel title="Background" description="Choose the image, then the point that stays in view when the kiosk crops it." padding={4}>
            <BackgroundControl value={config.background} uploading={uploading} error={uploadError} onUpload={upload} onRemove={() => select({ background: "" })} focalX={config.focalX} focalY={config.focalY} onFocus={(focalX, focalY) => select({ focalX, focalY })} />
          </Panel>
          <Grid columns={{ minWidth: 220, repeat: "fit" }} gap={4}>
            <VStack gap={2}>
              <Text type="label">Text readability</Text>
              <SegmentedControl value={config.readability} onChange={(value) => select({ readability: value as Readability })} label="Text readability">
                {(["auto", "light", "strong"] as Readability[]).map((option) => <SegmentedControlItem key={option} value={option} label={option[0].toUpperCase() + option.slice(1)} />)}
              </SegmentedControl>
            </VStack>
            <Selector label="Content position" value={config.position} onChange={(value) => select({ position: value as ContentPosition })} options={[{ value: "bottom_left", label: "Bottom left" }, { value: "bottom_center", label: "Bottom center" }, { value: "center", label: "Center" }]} />
          </Grid>
          <TextInput label="Headline" value={config.headline} onChange={(value) => select({ headline: value.slice(0, 120) })} />
          <HStack gap={2} vAlign="end">
            <TextInput label="Highlight" placeholder="Optional" value={config.highlight} onChange={(value) => select({ highlight: value.slice(0, 60) })} />
            {config.highlight && <Button label="Clear highlight" variant="ghost" size="sm" icon={<X size={14} aria-hidden="true" />} onClick={() => select({ highlight: "" })} />}
          </HStack>
          <TextArea label="Supporting text" maxLength={240} value={config.supporting} onChange={(value) => select({ supporting: value })} />
          <TextInput label="Start prompt" value={config.startPrompt} onChange={(value) => select({ startPrompt: value.slice(0, 160) })} />
          <Switch label="Touch anywhere to start" value={config.touchAnywhere} onChange={(checked) => select({ touchAnywhere: checked })} />
        </VStack>
      </Panel>
      <Panel>
        <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
          <HStack gap={2} vAlign="center">
            <StatusBadge tone={config.enabled ? "success" : "neutral"}>{config.enabled ? "Welcome on" : "Welcome off"}</StatusBadge>
            <Text type="supporting" color="secondary">{`${config.readability} readability · ${config.position.replace("_", " ")} · ${config.touchAnywhere ? "Touch anywhere" : "Button start"}`}</Text>
          </HStack>
          <HStack gap={2} vAlign="center">
            {saveState === "saving" && <Text type="supporting" color="secondary">Saving…</Text>}
            {saveState === "error" ? <><StatusBadge tone="danger">{saveError || "Couldn’t save changes"}</StatusBadge><Button label="Retry save" variant="ghost" size="sm" onClick={() => void save(configRef.current)} /></> : saveState === "saved" && !dirty ? <HStack gap={1} vAlign="center"><Check size={14} aria-hidden="true" /><Text type="supporting" color="secondary">Saved as draft</Text></HStack> : null}
            <Button label="Reset" variant="secondary" size="sm" isDisabled={!dirty} onClick={reset} />
          </HStack>
        </HStack>
      </Panel>
    </DashboardPageWithPanel>
  );
}

function BackgroundControl({ value, uploading, error, onUpload, onRemove, focalX, focalY, onFocus }: { value: string; uploading: boolean; error: string; onUpload: (file: File) => void; onRemove: () => void; focalX: number; focalY: number; onFocus: (x: number, y: number) => void }) {
  return (
    <VStack gap={3}>
      {value ? (
        <FocusStage x={focalX} y={focalY} image={value} onChange={onFocus} />
      ) : (
        <Card padding={5} elevation="low">
          <VStack gap={2} hAlign="center">
            <ImageIcon size={22} aria-hidden="true" />
            <Text type="body" weight="semibold">No background image yet</Text>
            <Text type="supporting" color="secondary">Upload a JPG, PNG or WebP. You can then choose which part of it stays in view.</Text>
          </VStack>
        </Card>
      )}
      <HStack gap={3} vAlign="end" hAlign="between" wrap="wrap">
        <FileInput label={value ? "Replace background image" : "Upload background image"} accept="image/jpeg,image/png,image/webp" value={null} onChange={(file) => { const picked = Array.isArray(file) ? file[0] : file; if (picked) void onUpload(picked); }} />
        {value && <Button label="Remove background" variant="destructive" size="sm" icon={<X size={14} aria-hidden="true" />} onClick={onRemove} />}
      </HStack>
      {uploading && <Text type="supporting" color="secondary">Uploading…</Text>}
      {error && <NoticeBanner tone="danger" title={error} />}
    </VStack>
  );
}

// The focus point is where the kiosk keeps the picture anchored when it crops to the screen shape.
function FocusStage({ x, y, image, onChange }: { x: number; y: number; image: string; onChange: (x: number, y: number) => void }) {
  const update = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)));
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    onChange(
      Math.max(0, Math.min(1, x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))),
      Math.max(0, Math.min(1, y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))),
    );
  };
  const label = `Focus point: ${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down`;
  return (
    <VStack gap={2}>
      <Layout
        height="auto"
        role="slider"
        tabIndex={0}
        aria-label="Background focus point"
        aria-valuetext={label}
        onPointerDown={(event: ReactPointerEvent<HTMLElement>) => { event.currentTarget.setPointerCapture(event.pointerId); update(event); }}
        onPointerMove={(event: ReactPointerEvent<HTMLElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event); }}
        onKeyDown={onKey}
        style={{ margin: 0, position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: "var(--radius-element)", overflow: "hidden", border: "1px solid var(--color-border)", background: "var(--color-background-muted)", touchAction: "none", cursor: "crosshair" }}
      >
        <LayoutContent padding={0}>
          <Image src={assetUrl(image)} alt="" fill unoptimized draggable={false} style={{ objectFit: "cover", objectPosition: `${x * 100}% ${y * 100}%`, pointerEvents: "none" }} />
          {[1 / 3, 2 / 3].map((position) => (
            <Layout key={`v-${position}`} height="auto" style={{ margin: 0, position: "absolute", top: 0, bottom: 0, left: `${position * 100}%`, width: 1, background: "rgba(255, 255, 255, 0.45)", pointerEvents: "none" }}>
              <LayoutContent padding={0}>{null}</LayoutContent>
            </Layout>
          ))}
          {[1 / 3, 2 / 3].map((position) => (
            <Layout key={`h-${position}`} height="auto" style={{ margin: 0, position: "absolute", left: 0, right: 0, top: `${position * 100}%`, height: 1, background: "rgba(255, 255, 255, 0.45)", pointerEvents: "none" }}>
              <LayoutContent padding={0}>{null}</LayoutContent>
            </Layout>
          ))}
          <Layout height="auto" style={{ margin: 0, position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, transform: "translate(-50%, -50%)", width: 18, height: 18, borderRadius: 999, background: "var(--color-background-card)", border: "3px solid var(--color-accent)", boxShadow: "var(--shadow-med)", pointerEvents: "none" }}>
            <LayoutContent padding={0}>{null}</LayoutContent>
          </Layout>
        </LayoutContent>
      </Layout>
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <Text type="supporting" color="secondary">Drag the marker, or use the arrow keys (hold Shift for larger steps).</Text>
        <HStack gap={2} vAlign="center">
          <Text type="supporting" color="secondary">{`${Math.round(x * 100)}% · ${Math.round(y * 100)}%`}</Text>
          <Button label="Centre" variant="ghost" size="sm" onClick={() => onChange(0.5, 0.5)} />
        </HStack>
      </HStack>
    </VStack>
  );
}
