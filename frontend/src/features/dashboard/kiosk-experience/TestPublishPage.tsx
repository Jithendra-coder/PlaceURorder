"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, History, Info, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { KioskRuntime, type KioskExperienceData } from "@/features/kiosk/KioskApp";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { ConfirmationDialog, DetailsDrawer, Skeleton } from "@/components/ui/DashboardUI";
import { VirtualKioskFrame } from "@/components/onboarding/VirtualKioskFrame";
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
  business: { title: "Kiosk Screens", summary: (count) => `${count} kiosk setting${count === 1 ? "" : "s"} changed`, href: editorHref("/dashboard/kiosk-experience/screens") },
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

export function TestPublishSkeleton() { return <div className="mt-test-publish-page" aria-busy="true"><Skeleton lines={2} label="Loading Test & Publish" /><Skeleton lines={7} label="Loading release checkpoint" /><div className="mt-test-publish-skeleton-grid"><Skeleton lines={9} label="Loading changes" /><Skeleton lines={9} label="Loading readiness" /></div></div>; }

export function TestPublishPage({ business, products, categories, setup, reload, initialTestOpen = false }: TestPublishProps) {
  const { locations } = useBusiness();
  const [testOpen, setTestOpen] = useState(initialTestOpen);
  const [testStart, setTestStart] = useState<"welcome" | "menu">("welcome");
  const [selectedChange, setSelectedChange] = useState<ChangeGroup | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const testButtonRef = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => changeGroups(setup), [setup]);
  const checks = useMemo(() => readiness(setup), [setup]);
  const blockers = checks.filter((check) => check.state === "block");
  const unpublished = setup?.unpublishedChanges || 0;
  const canPublish = Boolean(setup && unpublished > 0 && !blockers.length);
  const scope = locations.length ? `${locations.length} location${locations.length === 1 ? "" : "s"}` : "Business-wide kiosk";

  useEffect(() => { if (!testOpen) testButtonRef.current?.focus(); }, [testOpen]);

  const publish = async () => {
    if (!setup || !canPublish || busy) return;
    setBusy(true); setMessage("");
    try { await dataApi.publishKioskSetup(business.id, setup.setup.revision || 0, true); setConfirmOpen(false); setMessage("Published successfully. Your customer-facing kiosks now use this configuration."); await reload(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Publish failed. The saved draft is unchanged."); }
    finally { setBusy(false); }
  };

  const openTest = (start: "welcome" | "menu") => { setTestStart(start); setTestOpen(true); };
  return <main className="mt-test-publish-page">
    <header className="mt-test-publish-header"><div><h1>Test &amp; Publish</h1><p>Review, test and publish your latest kiosk changes.</p></div><div className="mt-test-publish-header__actions">{unpublished > 0 && <span className="mt-test-publish-unpublished">{unpublished} unpublished change{unpublished === 1 ? "" : "s"}</span>}<Link className="mt-button mt-button--secondary" href="/dashboard/kiosk-experience/publish-history"><History size={15} /> Publish history <ChevronRight size={14} /></Link></div></header>
    <section className={`mt-test-publish-hero ${blockers.length ? "is-blocked" : ""}`}><div className="mt-test-publish-hero__top"><div><span className="mt-eyebrow">{blockers.length ? `${blockers.length} issue${blockers.length === 1 ? "" : "s"} to fix` : unpublished ? "Ready for final review" : "Everything is up to date"}</span><h2>{blockers.length ? "Resolve blocking issues before publishing" : unpublished ? "Your latest draft is ready" : "Your kiosk matches the latest published version"}</h2><p>{blockers.length ? "Complete the required kiosk setup before making this draft live." : unpublished ? "Test the saved draft, review its changes, then publish when you are ready." : "You can test the published kiosk or review earlier versions."}</p></div><strong className="mt-test-publish-hero__count">{unpublished ? `${unpublished} change${unpublished === 1 ? "" : "s"}` : "No changes"}</strong></div><div className="mt-test-publish-hero__actions"><button ref={testButtonRef} type="button" className="mt-button mt-button--secondary" onClick={() => openTest("welcome")}><Play size={16} /> Test kiosk</button>{canPublish && <button type="button" className="mt-button mt-button--primary" onClick={() => setConfirmOpen(true)} disabled={busy}>{busy ? "Publishing…" : "Publish changes"}</button>}</div><dl className="mt-test-publish-meta"><div><dt>Last tested</dt><dd>{setup?.lastSuccessfulTestAt ? dateTime(setup.lastSuccessfulTestAt) : "Not tested yet"}</dd></div><div><dt>Last published</dt><dd>{setup?.lastPublishedAt ? dateTime(setup.lastPublishedAt) : "Not published yet"}</dd></div><div><dt>Publish scope</dt><dd>{scope}</dd></div></dl></section>
    <div className="mt-test-publish-workspace"><section className="mt-test-publish-surface"><header><div><h2>Changes to publish</h2><p>Only saved changes compared with the published kiosk are shown.</p></div><strong>{groups.reduce((sum, group) => sum + group.count, 0)} total</strong></header>{groups.length ? <div className="mt-test-publish-change-list">{groups.map((group) => <div className="mt-test-publish-change-row" key={group.title}><div><strong>{group.title}</strong><span>{group.summary}</span></div><b>{group.count}</b><button type="button" onClick={() => setSelectedChange(group)}>View <ChevronRight size={14} /></button></div>)}</div> : <div className="mt-test-publish-empty"><Check size={18} /><strong>No unpublished changes</strong><span>Save an editor change to review it here.</span></div>}</section><aside className="mt-test-publish-surface mt-test-publish-readiness"><header><div><h2>Publish readiness</h2><p>Can this draft safely go live?</p></div><ShieldCheck size={20} /></header><div className="mt-test-publish-checks">{checks.map((check) => <div className={`mt-test-publish-check is-${check.state}`} key={check.key}><span aria-hidden="true">{check.state === "pass" ? "✓" : check.state === "warning" ? "!" : "×"}</span><span>{check.label}</span>{check.href && check.state === "block" && <Link href={check.href}>Fix <ChevronRight size={13} /></Link>}</div>)}</div>{!blockers.length && checks.some((check) => check.state === "warning") && <p className="mt-test-publish-warning"><AlertTriangle size={14} /> Testing is recommended, but it does not block publishing.</p>}</aside></div>
    <footer className="mt-test-publish-strip"><span><Info size={14} /> {message || (setup?.status.testStale ? "Draft changed since last test." : setup?.lastSuccessfulTestAt ? `Tested ${dateTime(setup.lastSuccessfulTestAt)}.` : "Test the saved draft before publishing.")}</span>{canPublish && <button type="button" onClick={() => setConfirmOpen(true)}>Publish <ChevronRight size={14} /></button>}</footer>
    <DetailsDrawer open={Boolean(selectedChange)} onClose={() => setSelectedChange(null)} title={selectedChange ? `${selectedChange.title} changes` : "Change details"} footer={selectedChange ? <><Link className="mt-button mt-button--secondary" href={selectedChange.href}>Edit {selectedChange.title}</Link><button className="mt-button mt-button--secondary" type="button" onClick={() => setSelectedChange(null)}>Done</button></> : null}>{selectedChange && <div className="mt-test-publish-detail"><p>{selectedChange.summary} are included in this saved draft.</p><p>Review the owning editor for the exact configuration, then return here to recalculate readiness.</p></div>}</DetailsDrawer>
    <ConfirmationDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={() => void publish()} title={`Publish ${unpublished} change${unpublished === 1 ? "" : "s"}?`} description={`These changes will become visible on your ${scope}. The last successful test is ${setup?.lastSuccessfulTestAt ? dateTime(setup.lastSuccessfulTestAt) : "not available"}.`} confirmLabel={busy ? "Publishing…" : "Publish now"} loading={busy} />
    <TestKioskDialog open={testOpen} business={business} products={products} categories={categories} startContext={testStart} onClose={() => setTestOpen(false)} onCompleted={() => { setMessage("Test completed successfully. Ready for final review."); void reload(); }} />
  </main>;
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
    const task = window.setTimeout(() => { setSessionReady(false); setCompleted(false); setError(""); void dataApi.createKioskTestSession(business.id).then(({ session }) => dataApi.exchangeKioskTestSession(session.token || "")).then(() => { if (active) setSessionReady(true); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not start the isolated test session."); }); }, 0);
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
  return <DetailsDrawer open={open} onClose={() => void end(false)} title={historicalLabel || "Test saved kiosk draft"} variant="dialog" className="mt-test-kiosk-overlay" footer={<><span className="mt-test-kiosk-footer-note"><ShieldCheck size={14} /> Test mode · no real orders or payments</span><button className="mt-button mt-button--secondary" type="button" onClick={() => void end(false)}>Close</button><button className="mt-button mt-button--primary" type="button" disabled={!completed} onClick={() => void end(true)}>Done testing</button></>}><div className="mt-test-kiosk-dialog"><div className="mt-test-kiosk-dialog__toolbar"><div className="mt-test-kiosk-contexts"><button type="button" className={startContext === "welcome" ? "is-selected" : ""} onClick={() => { setRuntimeKey((value) => value + 1); }}>Welcome</button><button type="button" className={startContext === "menu" ? "is-selected" : ""} onClick={() => { setRuntimeKey((value) => value + 1); }}>Menu</button></div><div className="mt-test-kiosk-orientation"><button type="button" aria-pressed={orientation === "portrait"} onClick={() => setOrientation("portrait")}>Portrait</button><button type="button" aria-pressed={orientation === "landscape"} onClick={() => setOrientation("landscape")}>Landscape</button></div><button type="button" className="mt-test-kiosk-restart" onClick={() => { setCompleted(false); setRuntimeKey((value) => value + 1); }}><RotateCcw size={14} /> Restart</button></div><div className="mt-test-kiosk-dialog__stage">{error ? <div className="mt-test-kiosk-error" role="alert"><strong>Test kiosk unavailable</strong><span>{error}</span><button type="button" className="mt-button mt-button--secondary" onClick={() => setRuntimeKey((value) => value + 1)}>Retry</button></div> : sessionReady ? <VirtualKioskFrame orientation={orientation} interactive size="test" label={`Interactive ${orientation} test kiosk`}><KioskRuntime key={`${runtimeKey}-${startContext}-${orientation}`} routeSlug={business.slug} operationalMode="test" sessionId={`publish-${business.id}`} experienceData={experienceData} contained forcedOrientation={orientation} initialView={startContext === "menu" ? "menu" : "start"} onKioskEvent={(event, payload) => { if (event === "test-payment-completed" && payload?.success === true) setCompleted(true); if (event === "kiosk-error") setError(String(payload?.message || "Test order failed.")); }} /></VirtualKioskFrame> : <Skeleton lines={8} label="Preparing isolated test kiosk" />}</div>{completed && <p className="mt-test-kiosk-complete" role="status"><Check size={15} /> Test checkout complete. No production order was created.</p>}</div></DetailsDrawer>;
}
