"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, History, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { ConfirmDialog, DashboardPage, DetailDrawer, Metric, MetricGrid, NoticeBanner, PageHeader, Panel, StatusBadge, type Tone } from "@/components/dashboard/kit";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { VirtualKioskFrame } from "@/components/onboarding/VirtualKioskFrame";
import { KioskRuntime, type KioskExperienceData } from "@/features/kiosk/KioskApp";
import { api as dataApi } from "@/lib/api";
import type { Business as KioskBusiness, Category, KioskSetupOverview, KioskScreenOrientation, Product } from "@/lib/types";
import { type Business } from "@/services/api";

type TestPublishProps = { business: Business; products: Product[]; categories: Category[]; setup: KioskSetupOverview | null; reload: () => Promise<void>; initialTestOpen?: boolean };
type ChangeGroup = { key: string; title: string; count: number; summary: string; href: string };
type Readiness = { key: string; label: string; state: "pass" | "warning" | "block"; href?: string };

const kioskBusiness = (business: Business) => business as unknown as KioskBusiness;
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not tested yet";
const editorHref = (path: string) => `${path}?from=test-publish&returnTo=%2Fdashboard%2Fkiosk-experience%2Fpublish`;

const groupMeta: Record<string, { title: string; summary: (count: number) => string; href: string }> = {
  business: { title: "Kiosk screens", summary: (count) => `${count} kiosk setting${count === 1 ? "" : "s"} changed`, href: editorHref("/dashboard/kiosk-experience/screens") },
  categories: { title: "Menu", summary: (count) => `${count} categor${count === 1 ? "y" : "ies"} changed`, href: editorHref("/dashboard/kiosk-experience/menu") },
  products: { title: "Menu", summary: (count) => `${count} menu item${count === 1 ? "" : "s"} updated`, href: editorHref("/dashboard/kiosk-experience/menu") },
  modifier_groups: { title: "Menu", summary: (count) => `${count} add-on group${count === 1 ? "" : "s"} changed`, href: editorHref("/dashboard/kiosk-experience/menu") },
  modifier_options: { title: "Menu", summary: (count) => `${count} add-on${count === 1 ? "" : "s"} changed`, href: editorHref("/dashboard/kiosk-experience/menu") },
  combos: { title: "Menu", summary: (count) => `${count} combo${count === 1 ? "" : "s"} changed`, href: editorHref("/dashboard/kiosk-experience/menu") },
  combo_sections: { title: "Menu", summary: (count) => `${count} combo section${count === 1 ? "" : "s"} changed`, href: editorHref("/dashboard/kiosk-experience/menu") },
  combo_options: { title: "Menu", summary: (count) => `${count} combo option${count === 1 ? "" : "s"} changed`, href: editorHref("/dashboard/kiosk-experience/menu") },
  availability_rules: { title: "Availability", summary: (count) => `${count} availability rule${count === 1 ? "" : "s"} changed`, href: editorHref("/dashboard/kiosk-experience/availability") },
  initial: { title: "Kiosk setup", summary: () => "Initial kiosk configuration", href: editorHref("/dashboard/kiosk-experience/screens") },
};

function changeGroups(setup: KioskSetupOverview | null): ChangeGroup[] {
  const grouped = new Map<string, ChangeGroup>();
  for (const change of setup?.changeSummary || []) {
    const meta = groupMeta[change.key] || { title: change.label, summary: (count: number) => `${count} change${count === 1 ? "" : "s"}`, href: editorHref("/dashboard/kiosk-experience/screens") };
    const previous = grouped.get(meta.title);
    grouped.set(meta.title, previous ? { ...previous, count: previous.count + change.count, summary: `${previous.count + change.count} changes in this area` } : { key: change.key, title: meta.title, count: change.count, summary: meta.summary(change.count), href: meta.href });
  }
  return [...grouped.values()];
}

function readiness(setup: KioskSetupOverview | null): Readiness[] {
  if (!setup) return [];
  const status = setup.status;
  return [
    { key: "draft", label: "Draft saved", state: "pass" },
    { key: "menu", label: "Menu has available items", state: status.menuComplete ? "pass" : "block", href: editorHref("/dashboard/kiosk-experience/menu") },
    { key: "layout", label: "Kiosk configuration valid", state: status.kioskSettingsComplete ? "pass" : "block", href: editorHref("/dashboard/kiosk-experience/screens") },
    { key: "welcome", label: "Welcome configuration valid", state: status.welcomeScreenComplete ? "pass" : "block", href: editorHref("/dashboard/kiosk-experience/welcome-screen") },
    { key: "business", label: "Business details complete", state: status.businessComplete ? "pass" : "block", href: editorHref("/dashboard/administration/business-settings") },
    { key: "test", label: status.testStale ? "Draft changed since last test" : "Test recommended", state: status.successfulTestComplete && !status.testStale ? "pass" : "warning" },
  ];
}

const readinessTone = (state: Readiness["state"]): Tone => state === "pass" ? "success" : state === "warning" ? "warning" : "danger";
const readinessMark = (state: Readiness["state"]) => state === "pass" ? "✓" : state === "warning" ? "!" : "×";

export function TestPublishSkeleton() {
  return (
    <VStack gap={4} aria-busy="true">
      <Skeleton height={40} width="50%" radius={3} />
      <Skeleton height={160} width="100%" radius={3} />
      <Grid columns={{ minWidth: 320, repeat: "fit" }} gap={4}>
        <Skeleton height={260} width="100%" radius={3} />
        <Skeleton height={260} width="100%" radius={3} />
      </Grid>
    </VStack>
  );
}

export function TestPublishPage({ business, products, categories, setup, reload, initialTestOpen = false }: TestPublishProps) {
  const { locations } = useBusiness();
  const [testOpen, setTestOpen] = useState(initialTestOpen);
  const [testStart, setTestStart] = useState<"welcome" | "menu">("welcome");
  const [selectedChange, setSelectedChange] = useState<ChangeGroup | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const groups = useMemo(() => changeGroups(setup), [setup]);
  const checks = useMemo(() => readiness(setup), [setup]);
  const blockers = checks.filter((check) => check.state === "block");
  const unpublished = setup?.unpublishedChanges || 0;
  const canPublish = Boolean(setup && unpublished > 0 && !blockers.length);
  // The publish action is always visible; when it is not available, the reason sits beside it.
  const publishReason = blockers.length ? `Fix ${blockers.length} issue${blockers.length === 1 ? "" : "s"} before publishing.` : unpublished ? "Ready to publish." : "No saved changes to publish.";
  const scope = locations.length ? `${locations.length} location${locations.length === 1 ? "" : "s"}` : "Business-wide kiosk";

  const publish = async () => {
    if (!setup || !canPublish || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await dataApi.publishKioskSetup(business.id, setup.setup.revision || 0, true);
      setConfirmOpen(false);
      setMessage("Published successfully. Your customer-facing kiosks now use this configuration.");
      await reload();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Publish failed. The saved draft is unchanged.");
    } finally {
      setBusy(false);
    }
  };

  const openTest = (start: "welcome" | "menu") => {
    setTestStart(start);
    setTestOpen(true);
  };

  const headline = blockers.length ? `${blockers.length} issue${blockers.length === 1 ? "" : "s"} to fix` : unpublished ? "Ready for final review" : "Everything is up to date";

  return (
    <DashboardPage>
      <PageHeader
        eyebrow="Kiosk & Menu"
        title="Test & publish"
        description="Review, test and publish your latest kiosk changes."
        actions={<>
          {unpublished > 0 && <StatusBadge tone="warning">{`${unpublished} unpublished change${unpublished === 1 ? "" : "s"}`}</StatusBadge>}
          <Button label="Publish history" variant="secondary" href="/dashboard/kiosk-experience/publish-history" icon={<History size={15} aria-hidden="true" />} />
        </>}
      />
      <Panel padding={6}>
        <HStack gap={4} vAlign="start" hAlign="between" wrap="wrap">
          <VStack gap={2}>
            <StatusBadge tone={blockers.length ? "danger" : unpublished ? "info" : "success"}>{headline}</StatusBadge>
            <Text type="label">{blockers.length ? "Resolve blocking issues before publishing" : unpublished ? "Your latest draft is ready" : "Your kiosk matches the latest published version"}</Text>
            <Text type="supporting" color="secondary">{blockers.length ? "Complete the required kiosk setup before making this draft live." : unpublished ? "Test the saved draft, review its changes, then publish when you are ready." : "You can test the published kiosk or review earlier versions."}</Text>
          </VStack>
          <HStack gap={2} wrap="wrap">
            <Button label="Test kiosk" variant="secondary" icon={<Play size={16} aria-hidden="true" />} onClick={() => openTest("welcome")} />
            <VStack gap={1} hAlign="end">
              <Button label={busy ? "Publishing…" : "Publish changes"} variant="primary" isLoading={busy} isDisabled={!canPublish} onClick={() => setConfirmOpen(true)} />
              <Text type="supporting" color="secondary">{publishReason}</Text>
            </VStack>
          </HStack>
        </HStack>
        <MetricGrid>
          <Metric label="Last tested" value={setup?.lastSuccessfulTestAt ? dateTime(setup.lastSuccessfulTestAt) : "Not tested yet"} />
          <Metric label="Last published" value={setup?.lastPublishedAt ? dateTime(setup.lastPublishedAt) : "Not published yet"} />
          <Metric label="Publish scope" value={scope} />
        </MetricGrid>
      </Panel>
      <Grid columns={{ minWidth: 340, repeat: "fit" }} gap={4} align="start">
        <Panel title="Changes to publish" description="Only saved changes compared with the published kiosk are shown." actions={<StatusBadge tone="neutral">{`${groups.reduce((sum, group) => sum + group.count, 0)} total`}</StatusBadge>}>
          {groups.length ? (
            <VStack gap={3}>
              {groups.map((group) => (
                <HStack key={group.title} gap={3} vAlign="center" hAlign="between">
                  <VStack gap={0}>
                    <Text type="body" weight="semibold">{group.title}</Text>
                    <Text type="supporting" color="secondary">{group.summary}</Text>
                  </VStack>
                  <HStack gap={2} vAlign="center">
                    <StatusBadge tone="info">{String(group.count)}</StatusBadge>
                    <Button label={`View ${group.title} changes`} variant="ghost" size="sm" onClick={() => setSelectedChange(group)}>View</Button>
                  </HStack>
                </HStack>
              ))}
            </VStack>
          ) : (
            <VStack gap={2} hAlign="center">
              <Check size={18} aria-hidden="true" />
              <Text type="body" weight="semibold">No unpublished changes</Text>
              <Text type="supporting" color="secondary">Save an editor change to review it here.</Text>
            </VStack>
          )}
        </Panel>
        <Panel title="Publish readiness" description="Can this draft safely go live?" actions={<ShieldCheck size={20} aria-hidden="true" />}>
          <VStack gap={3}>
            {checks.map((check) => (
              <HStack key={check.key} gap={3} vAlign="center" hAlign="between">
                <HStack gap={2} vAlign="center">
                  <StatusBadge tone={readinessTone(check.state)}>{readinessMark(check.state)}</StatusBadge>
                  <Text type="body">{check.label}</Text>
                </HStack>
                {check.href && check.state === "block" && <Button label={`Fix ${check.label}`} variant="ghost" size="sm" href={check.href}>Fix</Button>}
              </HStack>
            ))}
          </VStack>
          {!blockers.length && checks.some((check) => check.state === "warning") && (
            <HStack gap={2} vAlign="center"><AlertTriangle size={14} aria-hidden="true" /><Text type="supporting" color="secondary">Testing is recommended, but it does not block publishing.</Text></HStack>
          )}
        </Panel>
      </Grid>
      <NoticeBanner tone={message.startsWith("Published") || message.startsWith("Test completed") ? "success" : message ? "danger" : "info"} title={message || (setup?.status.testStale ? "Draft changed since last test." : setup?.lastSuccessfulTestAt ? `Tested ${dateTime(setup.lastSuccessfulTestAt)}.` : "Test the saved draft before publishing.")} action={canPublish ? <Button label="Publish" variant="primary" onClick={() => setConfirmOpen(true)} /> : undefined} />
      <DetailDrawer title={selectedChange ? `${selectedChange.title} changes` : "Change details"} isOpen={Boolean(selectedChange)} onClose={() => setSelectedChange(null)} footer={selectedChange ? <><Button label={`Edit ${selectedChange.title}`} variant="secondary" href={selectedChange.href} /><Button label="Done" variant="ghost" onClick={() => setSelectedChange(null)} /></> : undefined}>
        {selectedChange && (
          <VStack gap={3}>
            <Text type="body">{`${selectedChange.summary} are included in this saved draft.`}</Text>
            <Text type="supporting" color="secondary">Review the owning editor for the exact configuration, then return here to recalculate readiness.</Text>
          </VStack>
        )}
      </DetailDrawer>
      <ConfirmDialog isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={() => void publish()} title={`Publish ${unpublished} change${unpublished === 1 ? "" : "s"}?`} description={`These changes will become visible on your ${scope}. The last successful test is ${setup?.lastSuccessfulTestAt ? dateTime(setup.lastSuccessfulTestAt) : "not available"}.`} confirmLabel={busy ? "Publishing…" : "Publish now"} destructive={false} loading={busy} />
      <TestKioskDialog open={testOpen} business={business} products={products} categories={categories} startContext={testStart} onClose={() => setTestOpen(false)} onCompleted={() => { setMessage("Test completed successfully. Ready for final review."); void reload(); }} />
    </DashboardPage>
  );
}

export function TestKioskDialog({ open, business, products, categories, startContext, onClose, onCompleted, historicalLabel }: { open: boolean; business: Business; products: Product[]; categories: Category[]; startContext: "welcome" | "menu"; onClose: () => void; onCompleted?: () => void; historicalLabel?: string }) {
  const [orientation, setOrientation] = useState<KioskScreenOrientation>(kioskBusiness(business).kiosk_screen_orientation === "portrait" ? "portrait" : "landscape");
  const [sessionReady, setSessionReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const [runtimeKey, setRuntimeKey] = useState(0);
  const ending = useRef(false);
  const experienceData = useMemo<KioskExperienceData>(() => ({ business: kioskBusiness(business), products, categories }), [business, products, categories]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const task = window.setTimeout(() => {
      setSessionReady(false);
      setCompleted(false);
      setError("");
      void dataApi.createKioskTestSession(business.id).then(({ session }) => dataApi.exchangeKioskTestSession(session.token || "")).then(() => { if (active) setSessionReady(true); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not start the isolated test session."); });
    }, 0);
    return () => { active = false; window.clearTimeout(task); };
  }, [business.id, open]);
  const end = async (success: boolean) => {
    if (ending.current) return;
    ending.current = true;
    await dataApi.endKioskTestSession(business.id).catch(() => undefined);
    await dataApi.clearKioskTestSession().catch(() => undefined);
    ending.current = false;
    if (success) onCompleted?.();
    onClose();
  };

  return (
    <Dialog isOpen={open} onOpenChange={(next) => { if (!next) void end(false); }} variant="fullscreen" purpose="info" padding={4}>
      <VStack gap={4}>
        <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
          <VStack gap={0}>
            <Text type="label">{historicalLabel || "Test saved kiosk draft"}</Text>
            <Text type="supporting" color="secondary"><ShieldCheck size={14} aria-hidden="true" /> Test mode · no real orders or payments</Text>
          </VStack>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Button label="Welcome" variant={startContext === "welcome" ? "primary" : "secondary"} size="sm" onClick={() => setRuntimeKey((value) => value + 1)} />
            <Button label="Menu" variant={startContext === "menu" ? "primary" : "secondary"} size="sm" onClick={() => setRuntimeKey((value) => value + 1)} />
            <Button label="Portrait" variant={orientation === "portrait" ? "primary" : "secondary"} size="sm" onClick={() => setOrientation("portrait")} />
            <Button label="Landscape" variant={orientation === "landscape" ? "primary" : "secondary"} size="sm" onClick={() => setOrientation("landscape")} />
            <Button label="Restart test" variant="ghost" size="sm" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => { setCompleted(false); setRuntimeKey((value) => value + 1); }} />
          </HStack>
        </HStack>
        {error ? (
          <NoticeBanner tone="danger" title="Test kiosk unavailable" description={error} action={<Button label="Retry" variant="secondary" onClick={() => setRuntimeKey((value) => value + 1)} />} />
        ) : sessionReady ? (
          <VirtualKioskFrame orientation={orientation} interactive size="test" label={`Interactive ${orientation} test kiosk`}>
            <KioskRuntime key={`${runtimeKey}-${startContext}-${orientation}`} routeSlug={business.slug} operationalMode="test" sessionId={`publish-${business.id}`} experienceData={experienceData} contained forcedOrientation={orientation} initialView={startContext === "menu" ? "menu" : "start"} onKioskEvent={(event, payload) => { if (event === "test-payment-completed" && payload?.success === true) setCompleted(true); if (event === "kiosk-error") setError(String(payload?.message || "Test order failed.")); }} />
          </VirtualKioskFrame>
        ) : <Skeleton height={320} width="100%" radius={3} />}
        <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
          {completed ? <StatusBadge tone="success">Test checkout complete. No production order was created.</StatusBadge> : <Text type="supporting" color="secondary">Complete a test checkout to enable Done testing.</Text>}
          <HStack gap={2}>
            <Button label="Close" variant="secondary" onClick={() => void end(false)} />
            <Button label="Done testing" variant="primary" isDisabled={!completed} onClick={() => void end(true)} />
          </HStack>
        </HStack>
      </VStack>
    </Dialog>
  );
}

