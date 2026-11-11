"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Drawer } from "@astryxdesign/core/Drawer";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";

// Shared building blocks for every owner dashboard page. Each one is composed only from Astryx
// components, so colour, spacing and type come from the theme tokens.

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const badgeVariant = { neutral: "neutral", success: "success", warning: "warning", danger: "error", info: "info" } as const;
const bannerStatus = { neutral: "info", success: "success", warning: "warning", danger: "error", info: "info" } as const;

/**
 * Keeps data fresh without a Refresh button: re-runs `refresh` on an interval and whenever the
 * window regains focus or becomes visible again. The latest callback is always used.
 */
export function useLiveRefresh(refresh: () => void, intervalMs = 30000) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = window.setInterval(tick, intervalMs);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);
}

/** A number that increments on every live tick. Loaders list it as a dependency to re-fetch in place. */
export function useLiveTick(intervalMs = 30000): number {
  const [tick, setTick] = useState(0);
  useLiveRefresh(() => setTick((value) => value + 1), intervalMs);
  return tick;
}

/** Full-width page body. Every section sits in one stack with the same gap, so no two cards touch. */
export function DashboardPage({ children, width = 1240 }: { children: ReactNode; width?: number }) {
  return (
    <Layout height="auto" contentWidth={width}>
      <LayoutContent padding={6}>
        <VStack gap={6}>{children}</VStack>
      </LayoutContent>
    </Layout>
  );
}

/** Page body with a fixed-width side panel for previews beside the main content on wide screens. */
export function DashboardPageWithPanel({ children, panel, width = 1240, panelWidth = 360, panelLabel = "Preview" }: { children: ReactNode; panel: ReactNode; width?: number; panelWidth?: number; panelLabel?: string }) {
  return (
    <Layout height="auto" contentWidth={width} end={<LayoutPanel width={panelWidth} padding={6} label={panelLabel}>{panel}</LayoutPanel>}>
      <LayoutContent padding={6}>
        <VStack gap={6}>{children}</VStack>
      </LayoutContent>
    </Layout>
  );
}

/** Page title, description and primary actions. Every dashboard page starts with one. */
export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <VStack gap={5}>
      <HStack gap={4} vAlign="end" hAlign="between" wrap="wrap">
        <VStack gap={1}>
          {eyebrow && <Text type="label" color="secondary">{eyebrow}</Text>}
          <Heading level={1} weight="semibold">{title}</Heading>
          {description && <Text type="body" color="secondary">{description}</Text>}
        </VStack>
        {actions && <HStack gap={2} vAlign="center" wrap="wrap">{actions}</HStack>}
      </HStack>
      {children}
    </VStack>
  );
}

/** A titled content group on a card surface. */
export function Panel({ title, description, actions, children, padding = 5 }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; padding?: 3 | 4 | 5 | 6 }) {
  return (
    <Card padding={padding} elevation="low">
      <VStack gap={4}>
        {(title || actions) && (
          <HStack gap={3} vAlign="start" hAlign="between" wrap="wrap">
            <VStack gap={1}>
              {title && <Heading level={2} weight="semibold">{title}</Heading>}
              {description && <Text type="supporting" color="secondary">{description}</Text>}
            </VStack>
            {actions && <HStack gap={2} vAlign="center" wrap="wrap">{actions}</HStack>}
          </HStack>
        )}
        {children}
      </VStack>
    </Card>
  );
}

/** Row of toolbar controls (search, filters, dates) that wraps on narrow screens. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <HStack gap={3} vAlign="end" wrap="wrap">{children}</HStack>;
}

/** Grid of headline numbers. */
export function MetricGrid({ children }: { children: ReactNode }) {
  return <Grid columns={{ minWidth: 200, repeat: "fit" }} gap={4}>{children}</Grid>;
}

export function Metric({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card padding={4} elevation="low">
      <VStack gap={2}>
        <Text type="label" color="secondary">{label}</Text>
        <Heading level={3} weight="semibold">{value}</Heading>
        {hint && <Text type="supporting" color="secondary">{hint}</Text>}
      </VStack>
    </Card>
  );
}

/** Status pill for orders, devices and alerts. */
export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <Badge variant={badgeVariant[tone]} label={children} />;
}

/** Scales a fixed-size kiosk canvas to fill its container width, keeping the canvas proportions. */
export function ScaledStage({ width, height, children, label }: { width: number; height: number; children: ReactNode; label: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const update = () => setStageWidth(element.clientWidth || 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = stageWidth ? stageWidth / width : 0.25;
  return (
    <Layout ref={stageRef} height="auto" aria-label={label} style={{ position: "relative", margin: 0, width: "100%", aspectRatio: `${width} / ${height}`, overflow: "hidden" }}>
      <LayoutContent padding={0}>
        <VStack gap={0} style={{ position: "absolute", left: 0, top: 0, width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {children}
        </VStack>
      </LayoutContent>
    </Layout>
  );
}

/**
 * Kiosk device frame for previews: a dark bezel around the scaled canvas, so a draft reads as the
 * real screen on the real device rather than a loose rectangle. Caption names the orientation.
 */
export function KioskDevice({ orientation, children, label }: { orientation: "portrait" | "landscape"; children: ReactNode; label: string }) {
  const portrait = orientation === "portrait";
  return (
    <VStack gap={5} hAlign="center">
      <Layout
        height="auto"
        style={{
          width: "100%",
          margin: 0,
          maxWidth: portrait ? 320 : 600,
          padding: portrait ? 12 : 10,
          background: "var(--color-text-primary)",
          borderRadius: "var(--radius-container)",
          boxShadow: "var(--shadow-med)",
        }}
      >
        <LayoutContent padding={0}>
          <Layout height="auto" style={{ borderRadius: "var(--radius-element)", overflow: "hidden", background: "var(--color-background-surface)" }}>
            <LayoutContent padding={0}>
              <ScaledStage width={portrait ? 1080 : 1920} height={portrait ? 1920 : 1080} label={label}>
                {children}
              </ScaledStage>
            </LayoutContent>
          </Layout>
        </LayoutContent>
      </Layout>
      <Text type="supporting" color="secondary">{portrait ? "Portrait kiosk preview" : "Landscape kiosk preview"}</Text>    </VStack>
  );
}

/** Equal-width columns for status boards: at most three tracks, sharing the available width. */
export function BoardGrid({ children }: { children: ReactNode }) {
  return <Grid columns={{ minWidth: 260, max: 3, repeat: "fit" }} gap={4} align="start">{children}</Grid>;
}

/** A status column on a board, such as Kitchen queues or Live Orders stages. */
export function BoardColumn({ title, count, children }: { title: ReactNode; count: number; children?: ReactNode }) {
  return (
    <Card padding={4} elevation="low">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" hAlign="between">
          <Heading level={3} weight="semibold">{title}</Heading>
          <Badge variant="neutral" label={String(count)} />
        </HStack>
        <Divider />
        <VStack gap={3}>{children}</VStack>
      </VStack>
    </Card>
  );
}

export function EmptyBlock({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <EmptyState title={title as string} description={description as string | undefined} actions={action} isCompact headingLevel={3} />;
}

/** Inline notice for errors, permission gaps and information. */
export function NoticeBanner({ tone = "info", title, description, action, role }: { tone?: Tone; title: string; description?: string; action?: ReactNode; role?: "alert" | "status" }) {
  return <Banner status={bannerStatus[tone]} title={title} description={description} container="card" endContent={action} role={role} />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <VStack gap={3}>
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} height={64} width="100%" radius={3} />)}
    </VStack>
  );
}

/** Confirmation step before an action that changes or removes something. */
export function ConfirmDialog({ isOpen, onClose, title, description, confirmLabel, onConfirm, loading, destructive = true }: { isOpen: boolean; onClose: () => void; title: string; description: string; confirmLabel: string; onConfirm: () => void; loading?: boolean; destructive?: boolean }) {
  // Mounted only while open, so its heading and buttons are not in the DOM when dismissed.
  if (!isOpen) return null;
  return <AlertDialog isOpen={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title={title} description={description} actionLabel={confirmLabel} onAction={onConfirm} isActionLoading={loading} actionVariant={destructive ? "destructive" : "primary"} />;
}

/** Side panel for a single record: order, device, product or alert details. */
export function DetailDrawer({ title, isOpen, onClose, children, footer, width = 440 }: { title: string; isOpen: boolean; onClose: () => void; children?: ReactNode; footer?: ReactNode; width?: number }) {
  return (
    <Drawer isOpen={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} label={title} width={width} padding={5}>
      <VStack gap={5}>
        <Heading level={2} weight="semibold">{title}</Heading>
        <VStack gap={4}>{children}</VStack>
        {footer && <HStack gap={2} hAlign="end" wrap="wrap">{footer}</HStack>}
      </VStack>
    </Drawer>
  );
}

/** Placeholder shaped like a dashboard page (title, metric row, panel). Shown inside the live shell while data loads. */
export function DashboardPageSkeleton() {
  return (
    <Layout height="auto" contentWidth={1240} role="status" aria-label="Loading workspace">
      <LayoutContent padding={6}>
        <VStack gap={6}>
          <VStack gap={3}>
            <Skeleton height={32} width={260} radius={3} />
            <Skeleton height={16} width={420} radius={3} />
          </VStack>
          <MetricGrid>
            {Array.from({ length: 4 }, (_, index) => (
              <Card key={index} padding={4} elevation="low">
                <VStack gap={3}>
                  <Skeleton height={14} width={120} radius={3} />
                  <Skeleton height={28} width={160} radius={3} />
                </VStack>
              </Card>
            ))}
          </MetricGrid>
          <Panel>
            <LoadingBlock rows={3} />
          </Panel>
        </VStack>
      </LayoutContent>
    </Layout>
  );
}

/** Key/value line used in details drawers and summaries. */
export function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <HStack gap={4} hAlign="between" vAlign="start">
      <Text type="supporting" color="secondary">{label}</Text>
      <Text type="body">{children}</Text>
    </HStack>
  );
}
