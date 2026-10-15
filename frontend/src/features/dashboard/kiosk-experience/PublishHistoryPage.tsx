"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronRight, History, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { ConfirmationDialog, DetailsDrawer, Skeleton } from "@/components/ui/DashboardUI";
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
    setLoading(true); setError("");
    try {
      const rows = (await api.kioskVersions(business.id)).versions;
      setVersions(rows.map((row, index) => ({ ...row, changedAreas: row.changed_areas?.length ? row.changed_areas : index === rows.length - 1 ? ["Kiosk configuration"] : ["Published configuration"] })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t load publish history."); }
    finally { setLoading(false); }
  }, [business]);
  useEffect(() => { const task = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(task); }, [load]);

  const filtered = useMemo(() => versions.filter((version) => !search || `version ${version.version_number} ${version.changedAreas.join(" ")}`.toLowerCase().includes(search.toLowerCase())), [search, versions]);
  const current = versions[0];
  const previous = versions[1];

  const openTest = async (version: VersionView) => {
    if (!business) return;
    try { setMessage(""); setTest({ version, snapshot: await api.kioskVersionSnapshot(business.id, version.id) }); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Couldn’t load this version for testing."); }
  };
  const restore = async () => {
    if (!business || !confirm) return;
    setBusy(true); setMessage("");
    try {
      const setup = await api.kioskSetup(business.id);
      const draft = await api.restoreKioskVersion(business.id, confirm.id, setup.setup.revision || 0);
      await api.publishKioskSetup(business.id, draft.setup?.revision || (setup.setup.revision || 0) + 1, true);
      setConfirm(null); setMessage(`Version ${confirm.version_number} restored as a new published version.`); await load();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Couldn’t restore this version. The current published kiosk is unchanged."); }
    finally { setBusy(false); }
  };

  return <div className="mt-publish-history-page"><header className="mt-publish-history-topbar"><Link href="/dashboard/kiosk-experience/publish"><ArrowLeft size={16} /> Back to Test &amp; Publish</Link><strong>Publish History</strong><span /></header><main className="mt-publish-history-content"><header className="mt-publish-history-header"><div><span className="mt-eyebrow">Version control</span><h1>Publish History</h1><p>View and restore previous kiosk versions.</p></div><div className="mt-publish-history-header__actions">{previous && <button type="button" className="mt-button mt-button--secondary" onClick={() => setConfirm(previous)}><RotateCcw size={15} /> Restore previous publish</button>}</div></header>{message && <div className="mt-publish-history-message" role="status"><ShieldCheck size={15} /> {message}</div>}{loading ? <div className="mt-publish-history-timeline" aria-busy="true"><Skeleton lines={8} label="Loading publish history" /><Skeleton lines={8} label="Loading version timeline" /></div> : error ? <div className="mt-publish-history-empty" role="alert"><AlertTriangle size={18} /><strong>Couldn’t load publish history.</strong><span>{error}</span><button className="mt-button mt-button--secondary" type="button" onClick={() => void load()}>Retry</button></div> : !versions.length ? <div className="mt-publish-history-empty"><History size={18} /><strong>No publish history yet.</strong><span>Your published versions will appear here after your first publish.</span><Link className="mt-button mt-button--secondary" href="/dashboard/kiosk-experience/publish">Back to Test &amp; Publish</Link></div> : <>{current && <section className="mt-publish-history-current"><div><span className="mt-eyebrow">Currently published</span><h2>Version {current.version_number}</h2><p>{dateTime(current.published_at)} · {current.changedAreas.join(" · ")}</p><small>Published version records are immutable.</small></div><div className="mt-publish-history-current__actions"><button type="button" className="mt-button mt-button--secondary" onClick={() => void openTest(current)}>Test version</button><button type="button" className="mt-button mt-button--secondary" onClick={() => setSelected(current)}>View details <ChevronRight size={14} /></button></div></section>}<div className="mt-publish-history-toolbar"><label><Search size={15} /><span className="sr-only">Search versions</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search versions" /></label><span>{filtered.length} version{filtered.length === 1 ? "" : "s"}</span></div><section className="mt-publish-history-timeline" aria-label="Published versions">{filtered.map((version, index) => <article className={`mt-publish-history-row ${index === 0 ? "is-current" : ""}`} key={version.id}><span className="mt-publish-history-dot" aria-hidden="true" /><div className="mt-publish-history-row__content"><header><div><strong>Version {version.version_number}</strong>{index === 0 && <span className="mt-status-pill mt-status-pill--success">CURRENT</span>}</div><time dateTime={version.published_at}>{dateTime(version.published_at)}</time></header><p>{version.changedAreas.join(" · ")}</p><footer><button type="button" onClick={() => void openTest(version)}>Test version</button><button type="button" onClick={() => setSelected(version)}>View details <ChevronRight size={14} /></button>{index > 0 && <button type="button" onClick={() => setConfirm(version)}>Restore version</button>}</footer></div></article>)}</section></>}</main><DetailsDrawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `Version ${selected.version_number}` : "Version details"} footer={selected ? <><button type="button" className="mt-button mt-button--secondary" onClick={() => void openTest(selected)}>Test this version</button>{selected.id !== current?.id && <button type="button" className="mt-button mt-button--secondary" onClick={() => { setSelected(null); setConfirm(selected); }}>Restore this version</button>}</> : null}>{selected && <dl className="mt-publish-history-details"><div><dt>Published</dt><dd>{dateTime(selected.published_at)}</dd></div><div><dt>Publisher</dt><dd>{selected.published_by ? "Owner" : "Business owner"}</dd></div><div><dt>Changed areas</dt><dd>{selected.changedAreas.join(" · ")}</dd></div><div><dt>Status</dt><dd>{selected.id === current?.id ? "Current" : "Immutable historical version"}</dd></div></dl>}</DetailsDrawer><ConfirmationDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={() => void restore()} title={confirm ? `Restore Version ${confirm.version_number}?` : "Restore version"} description={confirm ? "A new published version will be created. Existing history will remain available." : ""} confirmLabel={busy ? "Restoring…" : `Restore Version ${confirm?.version_number || ""}`} loading={busy} /><TestKioskDialog open={Boolean(test)} business={(test?.snapshot.snapshot.business || business || {}) as unknown as Business} products={(test?.snapshot.snapshot.products || []) as Product[]} categories={(test?.snapshot.snapshot.categories || []) as Category[]} startContext="welcome" historicalLabel={test ? `Testing Version ${test.version.version_number}` : undefined} onClose={() => setTest(null)} onCompleted={() => setTest(null)} /></div>;
}
