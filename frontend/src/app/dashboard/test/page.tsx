"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, RotateCcw, ShieldCheck, Square, Trash2 } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { DashboardPage, EmptyBlock, LoadingBlock, NoticeBanner, PageHeader, Panel, StatusBadge } from "@/components/dashboard/kit";
import { api } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/formatters";

type Session = { id: string; expires_at: string; token?: string };
type Activity = { id: string; label: string; created_at?: string };

const testApps = [
  { title: "Test Kiosk", description: "Place customer orders using the isolated test menu and session.", href: "/test/kiosk" },
  { title: "Test Counter", description: "Create counter orders, simulate payments, monitor kitchen progress, and test handover.", href: "/test/counter" },
  { title: "Test Kitchen", description: "Receive isolated orders and test preparation, hold, ready, recall, and rework.", href: "/test/kitchen" },
];

const testScenarios = [
  { title: "Kiosk → Counter → Kitchen", description: "Place a pay-at-counter order, simulate payment, prepare it, and complete handover.", path: "Kiosk → Payment → Kitchen → Handover" },
  { title: "Counter direct order", description: "Create and send a direct counter order through the full lifecycle.", path: "Counter → Kitchen → Ready → Handover" },
  { title: "Kitchen exception flow", description: "Exercise operational exceptions without touching production state.", path: "Preparing → Hold/Resume → Recall/Rework → Ready" },
];

export default function TestHubPage() {
  const { business } = useBusiness();
  const [session, setSession] = useState<Session | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<Activity[]>([]);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    try {
      const current = (await api.currentKioskTestSession(business.id)).session;
      setSession(current);
      if (current) {
        const [orders, history] = await Promise.allSettled([api.testKitchenOrders(), api.testKitchenCompleted()]);
        const rows = [
          ...(orders.status === "fulfilled" ? orders.value.orders : []),
          ...(history.status === "fulfilled" ? history.value.orders : []),
        ].flatMap((order) => (Array.isArray(order.lifecycle_events) ? order.lifecycle_events : []).map((event) => {
          const entry = event as Record<string, unknown>;
          return {
            id: String(entry.id),
            created_at: typeof entry.created_at === "string" ? entry.created_at : undefined,
            label: String(entry.event_type || "Test activity").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()),
          };
        }));
        setActivity(Array.from(new Map(rows.map((row) => [row.id, row])).values()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10));
      } else setActivity([]);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the test workspace.");
    } finally {
      setLoading(false);
    }
  }, [business]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  useEffect(() => {
    const tick = () => setRemaining(session ? Math.max(0, new Date(session.expires_at).getTime() - Date.now()) : 0);
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [session]);

  const active = Boolean(session && remaining);

  const start = async (reset = false) => {
    if (!business) return;
    setWorking(true);
    try {
      const response = reset ? await api.resetKioskTestSession(business.id) : await api.createKioskTestSession(business.id);
      await api.exchangeKioskTestSession(response.session.token || "");
      setSession(response.session);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the isolated test workspace.");
    } finally {
      setWorking(false);
    }
  };

  const end = async () => {
    if (!business) return;
    setWorking(true);
    try {
      await api.endKioskTestSession(business.id);
      await api.clearKioskTestSession().catch(() => undefined);
      setSession(null);
      setRemaining(0);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not end the test workspace.");
    } finally {
      setWorking(false);
    }
  };

  const resetData = async () => {
    if (!window.confirm("Reset test data? This clears only the current isolated test session.")) return;
    setWorking(true);
    try {
      await api.testRuntimeReset();
      setActivity([]);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset isolated test data.");
    } finally {
      setWorking(false);
    }
  };

  const openApp = (href: string) => window.open(href, "_blank", "noopener,noreferrer");

  return (
    <DashboardPage>
      <PageHeader
        eyebrow="Isolated workspace"
        title="Test device"
        description="Test kiosk, counter and kitchen together in an isolated environment without affecting live operations."
        actions={<StatusBadge tone={active ? "success" : "neutral"}>{active ? "Active" : "Not running"}</StatusBadge>}
      />
      {error && <NoticeBanner tone="danger" title="Test workspace unavailable" description={error} action={<Button label="Try again" variant="secondary" onClick={() => void load()} />} />}
      <Panel title="Isolated test session" description="Server-controlled access. Test orders and payments never reach live operations." actions={<ShieldCheck size={18} aria-hidden="true" />}>
        {loading ? <LoadingBlock rows={2} /> : active ? (
          <VStack gap={3}>
            <Text type="label">{`${formatDuration(Math.ceil(remaining / 1000))} remaining`}</Text>
            <Text type="supporting" color="secondary">{`Expires ${formatDateTime(session!.expires_at, business?.timezone || undefined)}`}</Text>
            <HStack gap={2} wrap="wrap">
              <Button label="Reset test data" variant="secondary" icon={<Trash2 size={15} aria-hidden="true" />} isDisabled={working} onClick={() => void resetData()} />
              <Button label="Reset session" variant="secondary" icon={<RotateCcw size={15} aria-hidden="true" />} isDisabled={working} onClick={() => void start(true)} />
              <Button label="End session" variant="destructive" icon={<Square size={15} aria-hidden="true" />} isDisabled={working} onClick={() => void end()} />
            </HStack>
          </VStack>
        ) : (
          <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
            <Text type="body" color="secondary">Start a session to open the test kiosk, counter and kitchen.</Text>
            <Button label={working ? "Starting…" : "Start test session"} variant="primary" icon={<Play size={16} aria-hidden="true" />} isLoading={working} onClick={() => void start()} />
          </HStack>
        )}
      </Panel>
      {active && (
        <HStack gap={2} wrap="wrap">
          {["Isolated orders", "Simulated payments", "No live devices", "No production writes"].map((label) => <StatusBadge key={label} tone="success">{`✓ ${label}`}</StatusBadge>)}
        </HStack>
      )}
      <Panel title="Test applications" description="Open each application in a separate tab and test the connected order flow.">
        <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4}>
          {testApps.map((app) => (
            <Panel key={app.title} title={app.title} description={app.description} padding={4} actions={active ? <Button label={`Open ${app.title}`} variant="secondary" size="sm" href={app.href} onClick={(event) => { event.preventDefault(); openApp(app.href); }} /> : <StatusBadge tone="neutral">Start session to open</StatusBadge>} />
          ))}
        </Grid>
      </Panel>
      <Panel title="Test scenarios" description="Guided workflows for the connected isolated apps.">
        <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4}>
          {testScenarios.map((scenario) => (
            <Panel key={scenario.title} title={scenario.title} description={scenario.description} padding={4}>
              <Text type="supporting" color="secondary">{scenario.path}</Text>
            </Panel>
          ))}
        </Grid>
      </Panel>
      <Panel title="Test activity" description="Recent lifecycle events from the current isolated session.">
        {activity.length ? (
          <VStack gap={2}>
            {activity.map((event) => (
              <HStack key={event.id} gap={3} vAlign="center" hAlign="between" wrap="wrap">
                <Text type="body">{event.label}</Text>
                <Text type="supporting" color="secondary">{event.created_at ? formatDateTime(event.created_at, business?.timezone || undefined) : "Just now"}</Text>
              </HStack>
            ))}
          </VStack>
        ) : <EmptyBlock title="No test activity yet" description="Open an application and start a workflow to see it here." />}
      </Panel>
    </DashboardPage>
  );
}
