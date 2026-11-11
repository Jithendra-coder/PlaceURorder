"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { ConfirmDialog, DashboardPage, DetailDrawer, DetailRow, EmptyBlock, NoticeBanner, PageHeader, Panel, StatusBadge } from "@/components/dashboard/kit";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { api, type KioskVersionRecord, type KioskVersionSnapshot } from "@/lib/api";
import type { Category, Product } from "@/lib/types";
import { TestKioskDialog } from "@/features/dashboard/kiosk-experience/TestPublishPage";
import type { Business } from "@/services/api";

const dateTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

type VersionView = KioskVersionRecord & { changedAreas: string[] };

export default function PublishHistoryPage() {
  const { business } = useBusiness();
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<VersionView | null>(null);
  const [confirm, setConfirm] = useState<VersionView | null>(null);
  const [test, setTest] = useState<{ version: VersionView; snapshot: KioskVersionSnapshot } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    setError("");
    try {
      const rows = (await api.kioskVersions(business.id)).versions;
      setVersions(rows.map((row, index) => ({ ...row, changedAreas: row.changed_areas?.length ? row.changed_areas : index === rows.length - 1 ? ["Kiosk configuration"] : ["Published configuration"] })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t load publish history.");
    } finally {
      setLoading(false);
    }
  }, [business]);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const filtered = useMemo(() => versions.filter((version) => !search || `version ${version.version_number} ${version.changedAreas.join(" ")}`.toLowerCase().includes(search.toLowerCase())), [search, versions]);
  const current = versions[0];
  const previous = versions[1];

  const openTest = async (version: VersionView) => {
    if (!business) return;
    try {
      setMessage("");
      setTest({ version, snapshot: await api.kioskVersionSnapshot(business.id, version.id) });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Couldn’t load this version for testing.");
    }
  };
  const restore = async () => {
    if (!business || !confirm) return;
    setBusy(true);
    setMessage("");
    try {
      const setup = await api.kioskSetup(business.id);
      const draft = await api.restoreKioskVersion(business.id, confirm.id, setup.setup.revision || 0);
      await api.publishKioskSetup(business.id, draft.setup?.revision || (setup.setup.revision || 0) + 1, true);
      setConfirm(null);
      setMessage(`Version ${confirm.version_number} restored as a new published version.`);
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Couldn’t restore this version. The current published kiosk is unchanged.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardPage>
      <PageHeader
        eyebrow="Kiosk & Menu"
        title="Publish history"
        description="View and restore previous kiosk versions. Published versions are immutable records."
        actions={<>
          <Button label="Back to Test & publish" variant="ghost" href="/dashboard/kiosk-experience/publish" />
          {previous && <Button label="Restore previous publish" variant="secondary" icon={<RotateCcw size={15} aria-hidden="true" />} onClick={() => setConfirm(previous)} />}
        </>}
      />
      {message && <NoticeBanner tone={message.startsWith("Couldn’t") ? "danger" : "success"} title={message} />}
      {loading ? (
        <VStack gap={3} aria-busy="true"><Skeleton height={96} width="100%" radius={3} /><Skeleton height={320} width="100%" radius={3} /></VStack>
      ) : error ? (
        <NoticeBanner tone="danger" title="Couldn’t load publish history." description={error} action={<Button label="Retry" variant="secondary" onClick={() => void load()} />} />
      ) : !versions.length ? (
        <EmptyBlock title="No publish history yet" description="Your published versions will appear here after your first publish." action={<Button label="Back to Test & publish" variant="secondary" href="/dashboard/kiosk-experience/publish" />} />
      ) : (
        <VStack gap={4}>
          {current && (
            <Panel title={`Version ${current.version_number}`} description={`${dateTime(current.published_at)} · ${current.changedAreas.join(" · ")}`} actions={<StatusBadge tone="success">Currently published</StatusBadge>}>
              <HStack gap={2} wrap="wrap">
                <Button label="Test this version" variant="secondary" onClick={() => void openTest(current)} />
                <Button label={`View details for version ${current.version_number}`} variant="ghost" onClick={() => setSelected(current)}>View details</Button>
              </HStack>
            </Panel>
          )}
          <HStack gap={3} vAlign="end" hAlign="between" wrap="wrap">
            <TextInput type="search" label="Search versions" placeholder="Search versions" value={search} onChange={setSearch} />
            <Text type="supporting" color="secondary">{`${filtered.length} version${filtered.length === 1 ? "" : "s"}`}</Text>
          </HStack>
          <Panel title="Published versions" padding={4}>
            <VStack gap={3} aria-label="Published versions">
              {filtered.map((version, index) => (
                <SelectableCard key={version.id} label={`Version ${version.version_number}`} isSelected={selected?.id === version.id} onChange={(next) => setSelected(next ? version : null)} padding={4}>
                  <VStack gap={2}>
                    <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
                      <HStack gap={2} vAlign="center">
                        <History size={16} aria-hidden="true" />
                        <Text type="body" weight="semibold">{`Version ${version.version_number}`}</Text>
                        {index === 0 && <StatusBadge tone="success">Current</StatusBadge>}
                      </HStack>
                      <Text type="supporting" color="secondary">{dateTime(version.published_at)}</Text>
                    </HStack>
                    <Text type="supporting" color="secondary">{version.changedAreas.join(" · ")}</Text>
                    <HStack gap={2} wrap="wrap">
                      <Button label={`Test version ${version.version_number}`} variant="ghost" size="sm" onClick={() => void openTest(version)} />
                      <Button label={`Details for version ${version.version_number}`} variant="ghost" size="sm" onClick={() => setSelected(version)} />
                      {index > 0 && <Button label={`Restore version ${version.version_number}`} variant="ghost" size="sm" onClick={() => setConfirm(version)} />}
                    </HStack>
                  </VStack>
                </SelectableCard>
              ))}
            </VStack>
          </Panel>
        </VStack>
      )}
      {message && !loading && <HStack gap={2} vAlign="center"><ShieldCheck size={14} aria-hidden="true" /><Text type="supporting" color="secondary">Restored versions are published as new versions.</Text></HStack>}
      <DetailDrawer title={selected ? `Version ${selected.version_number}` : "Version details"} isOpen={Boolean(selected)} onClose={() => setSelected(null)} footer={selected ? <>
        <Button label="Test this version" variant="secondary" onClick={() => void openTest(selected)} />
        {selected.id !== current?.id && <Button label="Restore this version" variant="secondary" onClick={() => { setSelected(null); setConfirm(selected); }} />}
      </> : undefined}>
        {selected && (
          <VStack gap={3}>
            <DetailRow label="Published">{dateTime(selected.published_at)}</DetailRow>
            <DetailRow label="Publisher">{selected.published_by ? "Owner" : "Business owner"}</DetailRow>
            <DetailRow label="Changed areas">{selected.changedAreas.join(" · ")}</DetailRow>
            <DetailRow label="Status">{selected.id === current?.id ? "Current" : "Immutable historical version"}</DetailRow>
          </VStack>
        )}
      </DetailDrawer>
      <ConfirmDialog isOpen={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={() => void restore()} title={confirm ? `Restore Version ${confirm.version_number}?` : "Restore version"} description={confirm ? "A new published version will be created. Existing history will remain available." : ""} confirmLabel={busy ? "Restoring…" : `Restore Version ${confirm?.version_number || ""}`} destructive={false} loading={busy} />
      <TestKioskDialog open={Boolean(test)} business={(test?.snapshot.snapshot.business || business || {}) as unknown as Business} products={(test?.snapshot.snapshot.products || []) as Product[]} categories={(test?.snapshot.snapshot.categories || []) as Category[]} startContext="welcome" historicalLabel={test ? `Testing Version ${test.version.version_number}` : undefined} onClose={() => setTest(null)} onCompleted={() => setTest(null)} />
    </DashboardPage>
  );
}
