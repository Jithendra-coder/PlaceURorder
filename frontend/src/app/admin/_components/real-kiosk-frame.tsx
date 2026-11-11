"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { KioskScreenOrientation } from "@/lib/types";

export type KioskFrameEvent = {
  source: "menutap-kiosk";
  version: 1;
  event: "kiosk-ready" | "category-selected" | "item-added" | "cart-opened" | "checkout-reached" | "test-payment-started" | "test-payment-completed" | "confirmation-shown" | "kiosk-error";
  kioskId: string;
  businessId: string;
  mode: "preview" | "test";
  sessionId: string;
  timestamp: string;
  payload?: Record<string, unknown>;
};

export function RealKioskFrame({ slug, businessId, locationId, orientation, mode = "preview", sessionKey = 0, onLoad, onKioskEvent, compact = false }: {
  slug: string;
  businessId?: string;
  locationId?: string | null;
  orientation: KioskScreenOrientation;
  mode?: "preview" | "test";
  sessionKey?: string | number;
  onLoad?: () => void;
  onKioskEvent?: (message: KioskFrameEvent) => void;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reactSessionId = useId();
  const sessionId = `frame-${reactSessionId.replace(/[^a-zA-Z0-9_-]/g, "")}-${mode}-${sessionKey}`;
  const seenEventsRef = useRef(new Set<string>());
  const [scale, setScale] = useState(1);
  const width = orientation === "portrait" ? 1080 : 1920;
  const height = orientation === "portrait" ? 1920 : 1080;

  useEffect(() => {
    seenEventsRef.current.clear();
  }, [sessionId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setScale(Math.min(container.clientWidth / width, container.clientHeight / height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [height, width]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as Partial<KioskFrameEvent> | null;
      if (!message || message.source !== "menutap-kiosk" || message.version !== 1 || message.kioskId !== slug || message.mode !== mode || message.sessionId !== sessionId || typeof message.businessId !== "string" || typeof message.timestamp !== "string" || typeof message.event !== "string") return;
      const typed = message as KioskFrameEvent;
      const requires: Partial<Record<KioskFrameEvent["event"], KioskFrameEvent["event"]>> = { "cart-opened": "item-added", "checkout-reached": "cart-opened", "test-payment-started": "checkout-reached", "test-payment-completed": "test-payment-started", "confirmation-shown": "test-payment-completed" };
      const prerequisite = requires[typed.event];
      if (prerequisite && !seenEventsRef.current.has(prerequisite)) return;
      seenEventsRef.current.add(typed.event);
      if (typed.event === "kiosk-ready") onLoad?.();
      onKioskEvent?.(typed);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [mode, onKioskEvent, onLoad, sessionId, slug]);

  return (
    <VStack gap={3} hAlign="center">
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <Text type="supporting" color="secondary">{`${orientation === "portrait" ? "Portrait" : "Landscape"} · ${Math.round(scale * 100)}%`}</Text>
        <Button label="Fullscreen" variant="ghost" size="sm" icon={<Maximize2 size={14} aria-hidden="true" />} onClick={() => void containerRef.current?.requestFullscreen()} />
      </HStack>
      <Layout height="auto" style={{ margin: 0, width: "100%", maxWidth: orientation === "portrait" ? (compact ? 252 : 420) : (compact ? 780 : 1280), padding: orientation === "portrait" ? 10 : 8, background: "var(--color-text-primary)", borderRadius: "var(--radius-container)", boxShadow: "var(--shadow-med)" }}>
        <LayoutContent padding={0}>
          <Layout ref={containerRef} height="auto" style={{ position: "relative", width: "100%", aspectRatio: `${width} / ${height}`, overflow: "hidden", borderRadius: "var(--radius-element)", background: "var(--color-background-surface)" }}>
            <LayoutContent padding={0}>
              <iframe ref={iframeRef} key={`${mode}-${locationId || "all"}-${sessionKey}`} title={`${mode === "test" ? "Test" : "Preview"} kiosk`} src={`/kiosk/${encodeURIComponent(slug)}?mode=${mode}&embedded=1&session=${encodeURIComponent(sessionId)}${businessId ? `&business=${encodeURIComponent(businessId)}` : ""}${locationId ? `&location=${encodeURIComponent(locationId)}` : ""}`} style={{ position: "absolute", left: 0, top: 0, width, height, border: 0, background: "var(--color-background-surface)", transform: `scale(${scale})`, transformOrigin: "top left" }} />
            </LayoutContent>
          </Layout>
        </LayoutContent>
      </Layout>
    </VStack>
  );
}
