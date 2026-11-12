"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table } from "@astryxdesign/core/Table";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ConfirmDialog, DashboardPage, DetailDrawer, DetailRow, EmptyBlock, LoadingBlock, Metric, NoticeBanner, PageHeader, Panel, StatusBadge, Toolbar, type Tone, useLiveTick, DashboardPageWithPanel } from "@/components/dashboard/kit";
import { DailyBars, RankedBars } from "@/components/dashboard/charts";
import { useSearchParams } from "next/navigation";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { api } from "@/lib/api";
import type { AdministrationActivity, BusinessLocation, DevicePairingRequest, DeviceRecord, PaymentAccount, PaymentRecord, StaffMember, StaffRole } from "@/lib/types";
import type { Business } from "@/services/api";

export type AdministrationMode = "overview" | "payments" | "locations" | "team" | "integrations" | "business-settings" | "activity-log";
type Row = Record<string, unknown>;
type Provider = (typeof providers)[number];
const providers = ["stripe", "razorpay", "paytm"] as const;
const roles: StaffRole[] = ["admin", "manager", "kitchen", "cashier", "salon_staff", "kiosk", "viewer"];
const human = (value: unknown) => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
const mask = (value?: string | null) => value ? `**** ${value.slice(-4)}` : "Unavailable";
const date = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Unavailable";
const state = (value: unknown): Tone => ["active", "connected", "open", "online", "healthy"].includes(String(value)) ? "success" : ["pending", "invited", "temporarily_closed", "setup_required"].includes(String(value)) ? "warning" : ["error", "offline", "inactive", "disabled", "restricted", "disconnected"].includes(String(value)) ? "danger" : "info";
// A provider counts as connected only when its account says so; a saved row alone is not a connection.
const connectedStatus = (account?: PaymentAccount) => ["connected", "active"].includes(String(account?.connection_status));

// Settled amount per day, from payments that have been paid.
function settledByDay(payments: PaymentRecord[]) {
  const byDay = new Map<string, number>();
  payments.filter((payment) => payment.status === "paid").forEach((payment) => {
    const day = payment.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + payment.amount);
  });
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ label: day.slice(5), value: amount }));
}

// Recorded changes per day for the activity log.
function eventsByDay(events: AdministrationActivity[]) {
  const byDay = new Map<string, number>();
  events.forEach((event) => {
    const day = event.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  });
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ label: dayLabel(day), value: count }));
}

// Short, readable day for axis labels, e.g. "11 Nov".
const dayLabel = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// Counts events per key, largest first, for the ranked breakdowns.
function tally(events: AdministrationActivity[], keyOf: (event: AdministrationActivity) => string, labelOf: (key: string) => string) {
  const counts = new Map<string, number>();
  events.forEach((event) => {
    const key = keyOf(event);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([key, value]) => ({ id: key, label: labelOf(key), value })).sort((a, b) => b.value - a.value);
}

const explain = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

// Loaders read the live tick, so they re-fetch in place. The page itself is never remounted by polling,
// which keeps open drawers, dialogs and unsaved drafts intact.
const AdminTickContext = createContext(0);
const useAdminTick = () => useContext(AdminTickContext);

export function AdministrationModule({ mode }: { mode: AdministrationMode }) {
  const { business, loading, error } = useBusiness();
  const [reload, setReload] = useState(0);
  const tick = useLiveTick(45000);
  if (loading) return <DashboardPage><LoadingBlock rows={4} /></DashboardPage>;
  if (error) return <DashboardPage><NoticeBanner tone="danger" title="Administration is unavailable" description="We could not load your Administration workspace." action={<Button label="Try again" variant="secondary" onClick={() => setReload((value) => value + 1)} />} /></DashboardPage>;
  if (!business) return <DashboardPage><NoticeBanner tone="warning" title="No business selected" description="Choose a business before opening Administration." /></DashboardPage>;
  return (
    <AdminTickContext.Provider value={tick}>
      <AdminPage key={`${mode}-${reload}`} business={business} mode={mode} refresh={() => setReload((value) => value + 1)} />
    </AdminTickContext.Provider>
  );
}

function AdminPage({ business, mode, refresh }: { business: Business; mode: AdministrationMode; refresh: () => void }) {
  if (mode === "overview") return <Overview business={business} refresh={refresh} />;
  if (mode === "payments") return <Payments business={business} />;
  if (mode === "locations") return <Locations business={business} />;
  if (mode === "team") return <Team business={business} />;
  if (mode === "integrations") return <Integrations business={business} />;
  if (mode === "business-settings") return <Settings business={business} />;
  return <Activity business={business} refresh={refresh} />;
}

function Overview({ business, refresh }: { business: Business; refresh: () => void }) {
  const tick = useAdminTick();
  const [checks, setChecks] = useState<Array<{ key: string; status: string; detail: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.administrationOverview(business.id).then((result) => setChecks(result.checks)).catch((cause) => setError(explain(cause, "Could not load the Administration overview."))).finally(() => setLoading(false));
  }, [business.id, tick]);

  return (
    <DashboardPage>
      <PageHeader title="Administration" description={`Business setup, access and configuration for ${business.name}.`} />
      {loading ? <LoadingBlock rows={4} /> : error ? (
        <NoticeBanner tone="danger" title="Could not load overview" description={error} action={<Button label="Retry" variant="secondary" onClick={refresh} />} />
      ) : (
        <Grid columns={{ minWidth: 300, repeat: "fit" }} gap={4}>
          {checks.map((check) => (
            <Panel key={check.key} title={human(check.key)} actions={<StatusBadge tone={state(check.status)}>{human(check.status)}</StatusBadge>}>
              <Text type="body" color="secondary">{check.detail}</Text>
            </Panel>
          ))}
        </Grid>
      )}
    </DashboardPage>
  );
}

function Payments({ business }: { business: Business }) {
  const tick = useAdminTick();
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(true);
  const [providerError, setProviderError] = useState(false);
  const [routingError, setRoutingError] = useState("");
  const [settlementError, setSettlementError] = useState(false);

  const load = useCallback(() => {
    void Promise.allSettled([api.paymentAccounts(business.id), api.payments(business.id), api.paymentLocationAssignments(business.id)]).then(([provider, settlement, routing]) => {
      setProviderError(provider.status === "rejected");
      if (provider.status === "fulfilled") setAccounts(provider.value.accounts);
      setSettlementError(settlement.status === "rejected");
      if (settlement.status === "fulfilled") setPayments(settlement.value.payments);
      setRoutingError(routing.status === "rejected" ? explain(routing.reason, "Payment routing is unavailable.") : "");
      if (routing.status === "fulfilled") setAssignments(routing.value.assignments);
      setLoading(false);
    });
  }, [business.id]);

  useEffect(() => { void Promise.resolve().then(load); }, [business.id, load, tick]);

  const setDefault = async (provider: Provider) => {
    try {
      const result = await api.updatePaymentAccount(business.id, provider, { is_default: true });
      setAccounts((current) => current.map((account) => account.provider === provider ? result.account : { ...account, is_default: false }));
    } catch (cause) {
      setRoutingError(explain(cause, "Payment routing is unavailable."));
    }
  };

  return (
    <DashboardPage>
      <PageHeader title="Payments" description="Connect and manage how your business accepts payments." />
      <Panel title="Payment providers" description="Each provider is connected separately and can be set as default.">
        {loading ? <LoadingBlock rows={3} /> : (
          <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4}>
            {providers.map((provider) => {
              const account = accounts.find((item) => item.provider === provider);
              return (
                <Panel key={provider} title={human(provider)} actions={<StatusBadge tone={providerError ? "danger" : state(account?.connection_status)}>{providerError ? "Status unavailable" : human(account?.connection_status || "not_connected")}</StatusBadge>}>
                  {providerError ? (
                    <VStack gap={3}>
                      <Text type="body" color="secondary">Could not load the current connection status.</Text>
                      <Button label="Retry" variant="ghost" onClick={load} />
                    </VStack>
                  ) : account ? (
                    <VStack gap={3}>
                      <Text type="body" color="secondary">{connectedStatus(account) ? (account.provider_account_id ? mask(account.provider_account_id) : "Account connected") : "Not connected yet. Connect to accept payments."}</Text>
                      <Button label={connectedStatus(account) ? `Manage ${human(provider)}` : `Connect ${human(provider)}`} variant={connectedStatus(account) ? "secondary" : "primary"} onClick={() => setSelected(provider)} />
                    </VStack>
                  ) : (
                    <VStack gap={3}>
                      <Text type="body" color="secondary">Connect {human(provider)} to start accepting payments.</Text>
                      <Button label={`Connect ${human(provider)}`} variant="primary" onClick={() => setSelected(provider)} />
                    </VStack>
                  )}
                </Panel>
              );
            })}
          </Grid>
        )}
      </Panel>
      <Grid columns={{ minWidth: 320, repeat: "fit" }} gap={4}>
        <Panel title="Payment routing">
          {routingError ? (
            <NoticeBanner tone="danger" title="Could not load payment routing" description={routingError} action={<Button label="Retry" variant="secondary" onClick={load} />} />
          ) : !accounts.some((account) => account.is_enabled !== false) ? (
            <EmptyBlock title="Connect a payment provider first" description="Choose a provider after it is connected." />
          ) : (
            <VStack gap={3}>
              <Selector label="Default provider" value={accounts.find((account) => account.is_default)?.provider || ""} placeholder="Choose a provider" onChange={(value) => { if (value) void setDefault(value as Provider); }} options={accounts.filter((account) => account.is_enabled !== false).map((account) => ({ value: account.provider, label: human(account.provider) }))} />
              <Text type="supporting" color="secondary">{assignments.length ? `${assignments.length} location overrides configured.` : "No location overrides configured."}</Text>
            </VStack>
          )}
        </Panel>
        <Panel title="Business payment defaults">
          <VStack gap={3}>
            <DetailRow label="Currency">{business.currency_code || "Unavailable"}</DetailRow>
            <DetailRow label="Payment capture">Provider-managed</DetailRow>
            <DetailRow label="Refund handling">Provider-managed</DetailRow>
          </VStack>
        </Panel>
      </Grid>
      <Panel title="Settlement details">
        {settlementError ? (
          <NoticeBanner tone="danger" title="Could not load settlement details" description="Try again to retrieve settlement information." action={<Button label="Retry" variant="secondary" onClick={load} />} />
        ) : payments.length ? (
          <VStack gap={4}>
          <DailyBars values={settledByDay(payments)} ariaLabel="Settled amount per day" format={(value) => business.currency_symbol + Math.round(value).toLocaleString()} />
          <Table
            idKey="id"
            data={payments.slice(0, 20) as Array<PaymentRecord & Record<string, unknown>>}
            columns={[
              { key: "reference", header: "Reference", renderCell: (row: PaymentRecord) => mask(row.provider_reference || row.provider_payment_id) },
              { key: "provider", header: "Provider", renderCell: (row: PaymentRecord) => human(row.provider) },
              { key: "status", header: "Status", renderCell: (row: PaymentRecord) => <StatusBadge tone={state(row.status)}>{human(row.status)}</StatusBadge> },
              { key: "account", header: "Account", renderCell: (row: PaymentRecord) => mask(row.provider_order_id) },
            ]}
          />
          </VStack>
        ) : <EmptyBlock title="No settlement activity yet" description="Settlement information will appear after a provider processes a payment." />}
      </Panel>
      {selected && <ProviderDrawer business={business} provider={selected} account={accounts.find((account) => account.provider === selected)} onClose={() => setSelected(null)} onChanged={load} />}
    </DashboardPage>
  );
}

function ProviderDrawer({ business, provider, account, onClose, onChanged }: { business: Business; provider: Provider; account?: PaymentAccount; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const run = async (action: () => Promise<unknown>, close = false) => {
    setBusy(true);
    try {
      await action();
      onChanged();
      if (close) onClose();
    } catch (cause) {
      setError(explain(cause, "Could not update this provider."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailDrawer title={`${human(provider)} provider`} isOpen onClose={onClose} footer={<Button label="Close" variant="secondary" onClick={onClose} />}>
      <StatusBadge tone={state(account?.connection_status)}>{human(account?.connection_status || "not_connected")}</StatusBadge>
      {account ? (
        <>
          <DetailRow label="Account">{mask(account.provider_account_id || account.provider_merchant_id)}</DetailRow>
          <DetailRow label="Connection health">{account.charges_enabled && account.payments_enabled ? "Healthy" : "Needs attention"}</DetailRow>
          <HStack gap={2} wrap="wrap">
            <Button label="Test connection" variant="secondary" isLoading={busy} onClick={() => void run(() => api.refreshPaymentAccount(business.id, provider))} />
            <Button label="Disconnect" variant="destructive" isDisabled={busy} onClick={() => setConfirm(true)} />
          </HStack>
        </>
      ) : (
        <Button label={`Connect ${human(provider)}`} variant="primary" isLoading={busy} onClick={() => void run(() => api.connectPaymentAccount(business.id, provider), true)} />
      )}
      {error && <NoticeBanner tone="danger" title="Provider action failed" description={error} action={<Button label="Dismiss" variant="ghost" onClick={() => setError("")} />} />}
      <ConfirmDialog isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={() => void run(() => api.disconnectPaymentAccount(business.id, provider), true)} title={`Disconnect ${human(provider)}?`} description="Payments will stop routing through this provider until it is connected again." confirmLabel="Disconnect provider" loading={busy} />
    </DetailDrawer>
  );
}

function Locations({ business }: { business: Business }) {
  const tick = useAdminTick();
  const [rows, setRows] = useState<BusinessLocation[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<BusinessLocation | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.administrationLocations(business.id, query).then((result) => { setRows(result.locations); setError(""); }).catch((cause) => setError(explain(cause, "Could not load locations.")) ).finally(() => setLoading(false));
  }, [business.id, query]);
  useEffect(() => { void Promise.resolve().then(load); }, [business.id, query, load, tick]);
  const visible = rows.filter((row) => filter === "all" || row.operating_status === filter);

  return (
    <DashboardPage>
      <PageHeader title="Locations" description="Manage business locations and where your kiosks operate." actions={<Button label="Add location" variant="primary" onClick={() => setSelected("new")} />}>
        <Toolbar>
          <TextInput type="search" label="Search locations" placeholder="Search locations" value={query} onChange={setQuery} />
          <Selector label="Status" value={filter} onChange={setFilter} options={[{ value: "all", label: "All statuses" }, { value: "open", label: "Open" }, { value: "temporarily_closed", label: "Temporarily closed" }, { value: "inactive", label: "Inactive" }]} />
        </Toolbar>
      </PageHeader>
      {loading ? <LoadingBlock rows={5} /> : error ? (
        <NoticeBanner tone="danger" title="Could not load locations" description="We could not retrieve your business locations." action={<Button label="Retry" variant="secondary" onClick={load} />} />
      ) : (
        <Panel padding={4}>
          {visible.length > 0 && <Table
            idKey="id"
            data={visible as Array<BusinessLocation & Record<string, unknown>>}
            columns={[
              { key: "name", header: "Location", renderCell: (row: BusinessLocation) => <Button label={`Open ${row.name}`} variant="ghost" size="sm" onClick={() => setSelected(row)}>{row.name}</Button> },
              { key: "status", header: "Status", renderCell: (row: BusinessLocation) => <StatusBadge tone={state(row.operating_status)}>{human(row.operating_status)}</StatusBadge> },
              { key: "devices", header: "Devices", renderCell: (row: BusinessLocation) => String(row.device_count ?? "Unavailable") },
            ]}
          />}
          {!visible.length && <EmptyBlock title={rows.length ? "No locations match these filters" : "No locations yet"} description={rows.length ? "Try a different status." : "Add your first location to start operating."} />}
        </Panel>
      )}
      {selected && <LocationDrawer businessId={business.id} location={selected} onClose={() => setSelected(null)} onSaved={(next) => { setRows((current) => current.some((row) => row.id === next.id) ? current.map((row) => row.id === next.id ? next : row) : [...current, next]); setSelected(next); }} />}
    </DashboardPage>
  );
}

function LocationDrawer({ businessId, location, onClose, onSaved }: { businessId: string; location: BusinessLocation | "new"; onClose: () => void; onSaved: (location: BusinessLocation) => void }) {
  const current = location === "new" ? undefined : location;
  const [form, setForm] = useState({ name: current?.name || "", address_line1: current?.address_line1 || "", city: current?.city || "", state: current?.state || "", postal_code: current?.postal_code || "", country: current?.country || "", timezone: current?.timezone || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((prior) => ({ ...prior, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) {
      setError("Location name is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = current ? await api.updateAdministrationLocation(businessId, current.id, form) : await api.createAdministrationLocation(businessId, form);
      onSaved(next);
    } catch (cause) {
      setError(explain(cause, "Could not save changes."));
    } finally {
      setBusy(false);
    }
  };
  const deactivate = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const next = await api.deactivateAdministrationLocation(businessId, current.id);
      onSaved(next);
      setConfirm(false);
    } catch (cause) {
      setError(explain(cause, "Could not deactivate location."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailDrawer title={current?.name || "Add location"} isOpen onClose={onClose} footer={<><Button label="Close" variant="secondary" onClick={onClose} /><Button label="Save location" variant="primary" isLoading={busy} onClick={() => void save()} /></>}>
      <TextInput label="Location name" isRequired value={form.name} onChange={set("name")} />
      <TextInput label="Address" value={form.address_line1} onChange={set("address_line1")} />
      <TextInput label="City" value={form.city} onChange={set("city")} />
      <TextInput label="State" value={form.state} onChange={set("state")} />
      <TextInput label="Postal code" value={form.postal_code} onChange={set("postal_code")} />
      <TextInput label="Country" value={form.country} onChange={set("country")} />
      <TextInput label="Time zone" value={form.timezone} onChange={set("timezone")} />
      {error && <NoticeBanner tone="danger" title="Could not save changes" description={error} />}
      {current && (
        <VStack gap={3}>
          <DetailRow label="Devices">{current.device_count ?? "Unavailable"}</DetailRow>
          <Button label="Deactivate location" variant="destructive" isDisabled={current.operating_status === "inactive"} onClick={() => setConfirm(true)} />
        </VStack>
      )}
      <ConfirmDialog isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={() => void deactivate()} title="Deactivate this location?" description="The location remains in historical records but stops accepting new operations." confirmLabel="Deactivate location" loading={busy} />
    </DetailDrawer>
  );
}

function Team({ business }: { business: Business }) {
  const search = useSearchParams();
  const [tab, setTab] = useState<"members" | "roles" | "invitations" | "security">(() => (search.get("tab") === "security" ? "security" : "members"));
  const [invite, setInvite] = useState(false);
  return (
    <DashboardPage>
      <PageHeader title="Team & Access" description="Manage who can access PlaceURorder and what they can do." actions={tab === "members" ? <Button label="Invite member" variant="primary" onClick={() => setInvite(true)} /> : undefined} />
      <TabList value={tab} onChange={(value) => setTab(value as typeof tab)} size="sm" layout="hug">
        <Tab value="members" label="Members" />
        <Tab value="roles" label="Roles" />
        <Tab value="invitations" label="Invitations" />
        <Tab value="security" label="Security & sessions" />
      </TabList>
      {tab === "members" ? <Members business={business} /> : tab === "roles" ? <Roles businessId={business.id} /> : tab === "security" ? <Security businessId={business.id} /> : <Invitations businessId={business.id} />}
      {invite && <Invite businessId={business.id} onClose={() => setInvite(false)} />}
    </DashboardPage>
  );
}

function Members({ business }: { business: Business }) {
  const tick = useAdminTick();
  const [rows, setRows] = useState<StaffMember[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<StaffMember | null>(null);
  useEffect(() => {
    api.staff(business.id).then((result) => setRows(result.staff)).catch((cause) => setError(explain(cause, "Could not load team members."))).finally(() => setLoading(false));
  }, [business.id, tick]);
  const visible = rows.filter((row) => `${row.full_name || ""} ${row.email || ""} ${row.role}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <VStack gap={4}>
      <Toolbar><TextInput type="search" label="Search team" placeholder="Search team" value={query} onChange={setQuery} /></Toolbar>
      {loading ? <LoadingBlock rows={5} /> : error ? <NoticeBanner tone="danger" title="Could not load team members" description="We could not retrieve team access." /> : (
        <Panel padding={4}>
          <Table
            idKey="id"
            data={visible as Array<StaffMember & Record<string, unknown>>}
            columns={[
              { key: "member", header: "Member", renderCell: (row: StaffMember) => <Button label={`Open ${row.full_name || row.email || "member"}`} variant="ghost" size="sm" onClick={() => setSelected(row)}>{row.full_name || row.email || "Unnamed member"}</Button> },
              { key: "email", header: "Email", renderCell: (row: StaffMember) => row.email || "Unavailable" },
              { key: "role", header: "Role", renderCell: (row: StaffMember) => human(row.role) },
              { key: "status", header: "Status", renderCell: () => <StatusBadge tone="success">Active</StatusBadge> },
            ]}
          />
          {!visible.length && <EmptyBlock title={rows.length ? "No members match this search" : "No additional team members yet"} description={rows.length ? "Try a different name or email." : "Invite someone to help manage your business."} />}
        </Panel>
      )}
      {selected && <MemberDrawer businessId={business.id} member={selected} onClose={() => setSelected(null)} onSaved={(next) => { setRows((current) => current.map((row) => row.id === next.id ? next : row)); setSelected(next); }} />}
    </VStack>
  );
}

function MemberDrawer({ businessId, member, onClose, onSaved }: { businessId: string; member: StaffMember; onClose: () => void; onSaved: (member: StaffMember) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = (role: StaffRole) => {
    setBusy(true);
    void api.updateStaff(businessId, member.id, { role }).then(onSaved).catch((cause) => setError(explain(cause, "Could not update member access."))).finally(() => setBusy(false));
  };
  return (
    <DetailDrawer title={member.full_name || member.email || "Member"} isOpen onClose={onClose} footer={<Button label="Close" variant="secondary" onClick={onClose} />}>
      <Selector label="Role" value={member.role} isDisabled={member.role === "owner"} onChange={(value) => change(value as StaffRole)} options={[member.role, ...roles.filter((role) => role !== member.role)].map((role) => ({ value: role, label: human(role) }))} />
      {member.role === "owner" && <NoticeBanner tone="info" title="Owner role protected" description="The owner cannot be changed here." />}
      {busy && <Text type="supporting" color="secondary">Saving access…</Text>}
      {error && <NoticeBanner tone="danger" title="Could not update member" description={error} />}
    </DetailDrawer>
  );
}

function Invite({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    setBusy(true);
    try {
      await api.createAdministrationInvitation(businessId, { email, role, location_ids: [] });
      onClose();
    } catch (cause) {
      setError(explain(cause, "Could not send invitation."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailDrawer title="Invite member" isOpen onClose={onClose} footer={<><Button label="Cancel" variant="secondary" onClick={onClose} /><Button label="Send invitation" variant="primary" isLoading={busy} onClick={() => void send()} /></>}>
      <TextInput label="Email" type="email" isRequired value={email} onChange={setEmail} status={error && !email ? { type: "error", message: error } : undefined} />
      <Selector label="Role" value={role} onChange={(value) => setRole(value as StaffRole)} options={roles.map((item) => ({ value: item, label: human(item) }))} />
      {error && <NoticeBanner tone="danger" title="Invitation not sent" description={error} />}
    </DetailDrawer>
  );
}

const permissionOptions: Array<{ value: string; label: string }> = [
  { value: "home.read", label: "View home" },
  { value: "insights.read", label: "View insights" },
  { value: "operations.read", label: "View operations" },
  { value: "kiosk.manage", label: "Manage kiosk & menu" },
  { value: "payments.manage", label: "Manage payments" },
  { value: "administration.manage", label: "Manage administration" },
  { value: "team.manage", label: "Manage team" },
  { value: "security.manage", label: "Manage security" },
];
const permissionLabel = (value: unknown) => permissionOptions.find((option) => option.value === value)?.label ?? human(value);

function Roles({ businessId }: { businessId: string }) {
  const tick = useAdminTick();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [createError, setCreateError] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(["home.read", "operations.read"]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.customRoles(businessId)
      .then((result) => { setRows(result.roles); setLoadError(""); })
      .catch((cause) => setLoadError(explain(cause, "Could not load roles.")))
      .finally(() => setLoading(false));
  }, [businessId, tick]);
  const create = async () => {
    setSaving(true);
    setCreateError("");
    try {
      const role = await api.createCustomRole(businessId, { name: name.trim(), permissions: picked });
      setRows((current) => [...current, role]);
      setName("");
    } catch (cause) {
      setCreateError(explain(cause, "Could not create role."));
    } finally {
      setSaving(false);
    }
  };
  const toggle = (value: string, checked: boolean) => setPicked((current) => checked ? [...new Set([...current, value])] : current.filter((item) => item !== value));
  return (
    <Panel title="Roles & permissions" description="Give a custom role only the areas it needs. The owner always keeps full access.">
      <VStack gap={4}>
        <Toolbar>
          <TextInput label="Custom role name" value={name} onChange={setName} />
          <Button label={saving ? "Creating…" : "Create role"} variant="primary" isDisabled={saving || name.trim().length < 2 || picked.length === 0} onClick={() => void create()} />
        </Toolbar>
        <Grid columns={{ minWidth: 220, repeat: "fit" }} gap={2}>
          {permissionOptions.map((option) => (
            <CheckboxInput key={option.value} label={option.label} value={picked.includes(option.value)} onChange={(checked) => toggle(option.value, checked)} />
          ))}
        </Grid>
        {createError && <NoticeBanner tone="danger" title="Could not create role" description={createError} />}
        {loading ? <LoadingBlock rows={3} /> : loadError ? <NoticeBanner tone="danger" title="Could not load roles" description={loadError} /> : rows.length ? (
          <Table
            idKey={(row) => String(row.id)}
            data={rows as Array<Row & Record<string, unknown>>}
            columns={[
              { key: "name", header: "Role", renderCell: (row: Row) => String(row.name || "Unnamed role") },
              { key: "permissions", header: "Permissions", renderCell: (row: Row) => Array.isArray(row.permissions) ? (row.permissions as unknown[]).map(permissionLabel).join(", ") : "Unavailable" },
            ]}
          />
        ) : <EmptyBlock title="No custom roles yet" description="Create a role above to group permissions for your team." />}
      </VStack>
    </Panel>
  );
}

type SecurityPolicy = { session_duration_minutes: number; reauthentication_minutes: number; invitation_expiry_days: number; inactive_account_days: number; two_factor_required: boolean };
type AdminSession = { id: string; email?: string | null; user_agent?: string | null; ip_address?: string | null; created_at?: string | null; last_active_at?: string | null; revoked_at?: string | null; is_current?: boolean };

// Short, readable device label from the browser user-agent string (Chrome is checked before Safari).
function deviceLabel(agent?: string | null) {
  if (!agent) return "Unknown device";
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const system = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "unknown system";
  return `${browser} on ${system}`;
}

function Security({ businessId }: { businessId: string }) {
  const tick = useAdminTick();
  const [saved, setSaved] = useState<SecurityPolicy | null>(null);
  const [draft, setDraft] = useState<SecurityPolicy | null>(null);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([api.securityPolicy(businessId), api.administrationSessions(businessId)])
      .then(([policy, result]) => {
        const next = policy as unknown as SecurityPolicy;
        setSaved(next);
        setDraft(next);
        setSessions(result.sessions as AdminSession[]);
        setError("");
      })
      .catch((cause) => setError(explain(cause, "Could not load security settings.")))
      .finally(() => setLoading(false));
  }, [businessId, tick]);
  const reloadSessions = async () => {
    const result = await api.administrationSessions(businessId);
    setSessions(result.sessions as AdminSession[]);
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.updateSecurityPolicy(businessId, { ...draft });
      setSaved(draft);
      setNotice("Security settings saved.");
    } catch (cause) {
      setError(explain(cause, "Could not save security settings."));
    } finally {
      setBusy(false);
    }
  };
  const signOut = async (sessionId: string | null) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (sessionId) await api.revokeAdministrationSession(businessId, sessionId);
      else await api.revokeOtherAdministrationSessions(businessId);
      await reloadSessions();
      setNotice(sessionId ? "Session signed out." : "Other sessions signed out.");
    } catch (cause) {
      setError(explain(cause, "Could not sign out that session."));
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <LoadingBlock rows={4} />;
  if (!draft || !saved) return <NoticeBanner tone="danger" title="Could not load security settings" description={error || "We could not retrieve security configuration."} />;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const active = sessions.filter((session) => !session.revoked_at);
  const others = active.filter((session) => !session.is_current).length;
  const numberField = (label: string, key: "session_duration_minutes" | "reauthentication_minutes" | "invitation_expiry_days" | "inactive_account_days") => (
    <TextInput label={label} value={String(draft[key])} onChange={(value) => setDraft({ ...draft, [key]: Math.max(1, Math.round(Number(value) || 0)) })} />
  );
  return (
    <VStack gap={4}>
      {error && <NoticeBanner tone="danger" title="Something needs attention" description={error} />}
      {notice && <NoticeBanner tone="success" title={notice} />}
      <Panel title="Sign-in & session policy" description="Applies to everyone who signs in to this business.">
        <VStack gap={4}>
          <Grid columns={{ minWidth: 220, repeat: "fit" }} gap={4}>
            {numberField("Session length (minutes)", "session_duration_minutes")}
            {numberField("Re-authenticate after (minutes)", "reauthentication_minutes")}
            {numberField("Invitation expires after (days)", "invitation_expiry_days")}
            {numberField("Deactivate inactive accounts after (days)", "inactive_account_days")}
          </Grid>
          <HStack gap={2} hAlign="end">
            <Button label="Discard" variant="ghost" isDisabled={!changed || busy} onClick={() => setDraft(saved)} />
            <Button label={busy ? "Saving…" : "Save changes"} variant="primary" isDisabled={!changed || busy} onClick={() => void save()} />
          </HStack>
        </VStack>
      </Panel>
      <Panel title="Active sessions" description="Devices currently signed in to this business account.">
        <VStack gap={4}>
          <Toolbar>
            <Button label="Sign out other sessions" variant="secondary" isDisabled={busy || others === 0} onClick={() => void signOut(null)} />
          </Toolbar>
          {active.length ? (
            <Table
              idKey="id"
              data={active as Array<AdminSession & Record<string, unknown>>}
              columns={[
                { key: "account", header: "Account", renderCell: (row: AdminSession) => row.email || "Unavailable" },
                { key: "device", header: "Device", renderCell: (row: AdminSession) => deviceLabel(row.user_agent) },
                { key: "ip", header: "IP address", renderCell: (row: AdminSession) => row.ip_address || "Unavailable" },
                { key: "signed", header: "Signed in", renderCell: (row: AdminSession) => date(row.created_at) },
                { key: "last", header: "Last active", renderCell: (row: AdminSession) => date(row.last_active_at) },
                { key: "action", header: "", align: "end", renderCell: (row: AdminSession) => row.is_current ? <StatusBadge tone="success">This device</StatusBadge> : <Button label="Sign out" variant="ghost" size="sm" isDisabled={busy} onClick={() => void signOut(row.id)} /> },
              ]}
            />
          ) : <EmptyBlock title="No active sessions" description="Devices appear here after someone signs in." />}
        </VStack>
      </Panel>
    </VStack>
  );
}

function Invitations({ businessId }: { businessId: string }) {
  const tick = useAdminTick();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.administrationInvitations(businessId).then((result) => setRows(result.invitations)).catch((cause) => setError(explain(cause, "Could not load invitations."))).finally(() => setLoading(false));
  }, [businessId, tick]);
  if (loading) return <LoadingBlock rows={3} />;
  if (error) return <NoticeBanner tone="danger" title="Could not load invitations" description="We could not retrieve pending invitations." />;
  return (
    <Panel padding={4}>
      <Table
        idKey={(row) => String(row.id)}
        data={rows as Array<Row & Record<string, unknown>>}
        columns={[
          { key: "email", header: "Email", renderCell: (row: Row) => row.email ? String(row.email) : "Unavailable" },
          { key: "role", header: "Role", renderCell: (row: Row) => human(row.role) },
          { key: "status", header: "Status", renderCell: (row: Row) => <StatusBadge tone={state(row.status)}>{human(row.status)}</StatusBadge> },
        ]}
      />
      {!rows.length && <EmptyBlock title="No pending invitations" />}
    </Panel>
  );
}

function Integrations({ business }: { business: Business }) {
  const [tab, setTab] = useState<"apps" | "devices">("apps");
  const [open, setOpen] = useState(false);
  return (
    <DashboardPage>
      <PageHeader title="Integrations" description="Connect supported services and pair devices." actions={tab === "apps" ? <Button label="Add integration" variant="primary" onClick={() => setOpen(true)} /> : undefined} />
      <TabList value={tab} onChange={(value) => setTab(value as typeof tab)} size="sm" layout="hug">
        <Tab value="apps" label="Apps & services" />
        <Tab value="devices" label="Devices" />
      </TabList>
      {tab === "apps" ? <Apps business={business} /> : <Devices business={business} />}
      {open && <IntegrationDrawer businessId={business.id} onClose={() => setOpen(false)} />}
    </DashboardPage>
  );
}

function Apps({ business }: { business: Business }) {
  const tick = useAdminTick();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.integrations(business.id).then((result) => setRows(result.integrations)).catch((cause) => setError(explain(cause, "Could not load integrations."))).finally(() => setLoading(false));
  }, [business.id, tick]);
  if (loading) return <LoadingBlock rows={3} />;
  if (error) return <NoticeBanner tone="danger" title="Could not load integrations" description="We could not retrieve connected services." />;
  if (!rows.length) return <EmptyBlock title="No integrations connected yet" description="Add a supported service when its contract is ready." />;
  return (
    <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4}>
      {rows.map((row) => (
        <Panel key={String(row.id)} title={String(row.name || "Unnamed integration")} actions={<StatusBadge tone={state(row.status)}>{human(row.status)}</StatusBadge>}>
          <Text type="body" color="secondary">{human(row.integration_type)}</Text>
          {row.last_error ? <NoticeBanner tone="danger" title="Needs attention" /> : null}
        </Panel>
      ))}
    </Grid>
  );
}

function IntegrationDrawer({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim() || !type.trim()) {
      setError("Service name and type are required.");
      return;
    }
    setBusy(true);
    try {
      await api.createIntegration(businessId, { name, integration_type: type, status: "disconnected", location_ids: [] });
      onClose();
    } catch (cause) {
      setError(explain(cause, "Could not add integration."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailDrawer title="Add integration" isOpen onClose={onClose} footer={<><Button label="Cancel" variant="secondary" onClick={onClose} /><Button label="Save integration" variant="primary" isLoading={busy} onClick={() => void save()} /></>}>
      <TextInput label="Service name" isRequired value={name} onChange={setName} />
      <TextInput label="Integration type" isRequired value={type} onChange={setType} />
      {error && <NoticeBanner tone="danger" title="Could not save integration" description={error} />}
    </DetailDrawer>
  );
}

function Devices({ business }: { business: Business }) {
  const tick = useAdminTick();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [requests, setRequests] = useState<DevicePairingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [code, setCode] = useState<DevicePairingRequest | null>(null);
  useEffect(() => {
    Promise.all([api.devices(business.id), api.devicePairingRequests(business.id)]).then(([deviceResult, requestResult]) => {
      setDevices(deviceResult.devices);
      setRequests(requestResult.requests);
    }).catch((cause) => setError(explain(cause, "Could not load devices."))).finally(() => setLoading(false));
  }, [business.id, tick]);
  const pair = async () => {
    try {
      setCode(await api.createDeviceActivationCode(business.id, { device_type: "kiosk", expires_in_minutes: 15 }));
    } catch (cause) {
      setError(explain(cause, "Could not create a pairing code."));
    }
  };
  if (loading) return <LoadingBlock rows={4} />;
  return (
    <VStack gap={4}>
      <Panel title="Paired devices" description="Physical monitoring remains in Operations." actions={<Button label="Pair device" variant="primary" onClick={() => void pair()} />}>
        {error && <NoticeBanner tone="danger" title="Could not load devices" description="We could not retrieve device status." />}
        <Table
          idKey="id"
          data={devices as Array<DeviceRecord & Record<string, unknown>>}
          columns={[
            { key: "name", header: "Device", renderCell: (row: DeviceRecord) => row.name || row.device_id },
            { key: "type", header: "Type", renderCell: (row: DeviceRecord) => human(row.device_type) },
            { key: "location", header: "Location", renderCell: (row: DeviceRecord) => row.location_label || "Not assigned" },
            { key: "status", header: "Status", renderCell: (row: DeviceRecord) => <StatusBadge tone={state(row.status)}>{human(row.status)}</StatusBadge> },
          ]}
        />
        {!devices.length && <EmptyBlock title="No devices paired yet" />}
      </Panel>
      <Panel title="Pairing requests">
        <Table
          idKey="id"
          data={requests as Array<DevicePairingRequest & Record<string, unknown>>}
          columns={[
            { key: "code", header: "Code", renderCell: (row: DevicePairingRequest) => mask(row.pairing_code) },
            { key: "device", header: "Device", renderCell: (row: DevicePairingRequest) => row.device_name || row.device_type },
            { key: "status", header: "Status", renderCell: (row: DevicePairingRequest) => <StatusBadge tone={state(row.status)}>{human(row.status)}</StatusBadge> },
          ]}
        />
        {!requests.length && <EmptyBlock title="No pending pairing requests" />}
      </Panel>
      {code && (
        <DetailDrawer title="Pairing code" isOpen onClose={() => setCode(null)} footer={<Button label="Done" variant="secondary" onClick={() => setCode(null)} />}>
          <Text type="label">{code.pairing_code}</Text>
          <Text type="supporting" color="secondary">{`Expires ${date(code.expires_at)}`}</Text>
        </DetailDrawer>
      )}
    </VStack>
  );
}

type SettingsDraft = { name?: string | null; contact_phone?: string | null; address_line1?: string | null; timezone?: string | null; country?: string | null; default_language?: string | null; currency_code?: string | null; tax_percent?: number | string | null; order_modes?: string[] | null };
type SettingsKey = keyof SettingsDraft;
type SettingsGroupId = "profile" | "regional" | "taxes" | "ordering";
type SettingsGroup = { id: SettingsGroupId; title: string; description: string; keys: SettingsKey[]; highImpact?: boolean };

const settingsGroups: SettingsGroup[] = [
  { id: "profile", title: "Business profile", description: "Name and contact details shown on receipts, invoices and kiosk welcome screens.", keys: ["name", "contact_phone", "address_line1"] },
  { id: "regional", title: "Regional", description: "Time zone and language control opening hours, order timestamps and reports.", keys: ["timezone", "country", "default_language"] },
  { id: "taxes", title: "Taxes & currency", description: "Changes apply to new orders only. Issued receipts keep the values they were created with.", keys: ["currency_code", "tax_percent"], highImpact: true },
  { id: "ordering", title: "Ordering defaults", description: "The order type pre-selected when a guest starts an order on a kiosk or at the counter.", keys: ["order_modes"] },
];
const allSettingsKeys = settingsGroups.flatMap((group) => group.keys);
const orderTypes = [
  { value: "takeaway", label: "Takeaway" },
  { value: "dine_in", label: "Dine in" },
  { value: "delivery", label: "Delivery" },
  { value: "pickup", label: "Pickup" },
];
const orderTypeLabel = (value?: string | null) => orderTypes.find((option) => option.value === value)?.label ?? "Takeaway";

// Tax is typed as text so decimals such as "5." survive while editing; it is converted only when saved.
const taxValue = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : Number(value));
const pickSettings = (source: SettingsDraft): SettingsDraft => Object.fromEntries(allSettingsKeys.map((key) => [key, source[key] ?? null])) as SettingsDraft;

// Compares values in their saved form, so a field that is typed back to its saved value is not "edited".
const comparable = (key: SettingsKey, value: unknown): string => {
  if (key === "order_modes") return JSON.stringify(value ?? []);
  if (key === "tax_percent") return String(taxValue(value) ?? 0);
  return String(value ?? "");
};

function validateSettings(draft: SettingsDraft): Partial<Record<SettingsKey, string>> {
  const errors: Partial<Record<SettingsKey, string>> = {};
  if (!draft.name?.trim()) errors.name = "Enter the business name.";
  if (!draft.currency_code) errors.currency_code = "Enter a 3-letter currency code, such as INR.";
  else if (!/^[A-Z]{3}$/.test(draft.currency_code)) errors.currency_code = "Use a 3-letter code, such as INR or USD.";
  const tax = taxValue(draft.tax_percent);
  if (tax !== null && !(Number.isFinite(tax) && tax >= 0 && tax <= 100)) errors.tax_percent = "Enter a percentage between 0 and 100.";
  return errors;
}

function SettingsFields({ group, draft, errors, update }: { group: SettingsGroupId; draft: SettingsDraft; errors: Partial<Record<SettingsKey, string>>; update: (patch: SettingsDraft) => void }) {
  const status = (key: SettingsKey) => (errors[key] ? { type: "error" as const, message: errors[key] as string } : undefined);
  if (group === "profile") {
    return (
      <>
        <TextInput label="Business name" isRequired value={draft.name ?? ""} onChange={(value) => update({ name: value })} status={status("name")} />
        <TextInput label="Contact phone" inputMode="tel" value={draft.contact_phone ?? ""} onChange={(value) => update({ contact_phone: value })} />
        <TextInput label="Address" description="Street and number, shown on receipts." value={draft.address_line1 ?? ""} onChange={(value) => update({ address_line1: value })} />
      </>
    );
  }
  if (group === "regional") {
    return (
      <>
        <TextInput label="Time zone" description="For example Asia/Kolkata." value={draft.timezone ?? ""} onChange={(value) => update({ timezone: value })} />
        <TextInput label="Country" description="Two-letter country code, for example IN." value={draft.country ?? ""} onChange={(value) => update({ country: value.toUpperCase().slice(0, 2) })} />
        <TextInput label="Default language" description="For example en-IN." value={draft.default_language ?? ""} onChange={(value) => update({ default_language: value })} />
      </>
    );
  }
  if (group === "taxes") {
    return (
      <>
        <TextInput label="Currency code" isRequired description="ISO 4217, for example INR or USD." value={draft.currency_code ?? ""} onChange={(value) => update({ currency_code: value.toUpperCase().slice(0, 3) })} status={status("currency_code")} />
        <TextInput label="Tax percentage" description="Added to every order at checkout. Use 0 for no tax." inputMode="decimal" value={draft.tax_percent == null ? "" : String(draft.tax_percent)} onChange={(value) => update({ tax_percent: value })} status={status("tax_percent")} />
      </>
    );
  }
  return (
    <Selector label="Default order type" description="Pre-selected for new orders on kiosks and at the counter." value={draft.order_modes?.[0] ?? "takeaway"} onChange={(value) => update({ order_modes: [value] })} options={orderTypes} />
  );
}

function Settings({ business }: { business: Business }) {
  const [saved, setSaved] = useState<SettingsDraft>(() => pickSettings(business));
  const [draft, setDraft] = useState<SettingsDraft>(() => pickSettings(business));
  const [busy, setBusy] = useState<SettingsGroupId | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; title: string; description?: string } | null>(null);
  const [pending, setPending] = useState<SettingsGroup | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const errors = validateSettings(draft);

  const update = (patch: SettingsDraft) => setDraft((current) => ({ ...current, ...patch }));
  const isDirty = (group: SettingsGroup) => group.keys.some((key) => comparable(key, draft[key]) !== comparable(key, saved[key]));

  const persist = async (group: SettingsGroup) => {
    const values = Object.fromEntries(group.keys.map((key) => [key, key === "tax_percent" ? taxValue(draft.tax_percent) : (draft[key] ?? null)])) as SettingsDraft;
    setBusy(group.id);
    setNotice(null);
    try {
      await api.updateBusiness(business.id, values as never);
      setSaved((current) => ({ ...current, ...values }));
      setLastSaved(new Date());
      setNotice({ tone: "success", title: `${group.title} saved`, description: "Kiosks and locations pick up the new values on their next load." });
    } catch (cause) {
      setNotice({ tone: "danger", title: `${group.title} was not saved`, description: explain(cause, "Check your connection and try again.") });
    } finally {
      setBusy(null);
    }
  };

  const discard = (group: SettingsGroup) => {
    setDraft((current) => ({ ...current, ...Object.fromEntries(group.keys.map((key) => [key, saved[key] ?? null])) }));
    setNotice(null);
  };

  const requestSave = (group: SettingsGroup) => {
    if (group.highImpact) setPending(group);
    else void persist(group);
  };

  const tax = taxValue(draft.tax_percent) ?? 0;
  const sampleTotal = (100 * (1 + tax / 100)).toFixed(2);

  return (
    <DashboardPageWithPanel
      panelLabel="Business summary"
      panel={
        <VStack gap={5}>
          <Panel title="At a glance" description="How this business is set up right now.">
            <VStack gap={3}>
              <DetailRow label="Business">{draft.name || "Not set"}</DetailRow>
              <DetailRow label="Currency">{draft.currency_code || "Not set"}</DetailRow>
              <DetailRow label="Tax">{`${tax}%`}</DetailRow>
              <DetailRow label="Time zone">{draft.timezone || "Not set"}</DetailRow>
              <DetailRow label="Default order type">{orderTypeLabel(draft.order_modes?.[0])}</DetailRow>
              <DetailRow label="Last saved">{lastSaved ? lastSaved.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "Not yet this session"}</DetailRow>
            </VStack>
          </Panel>
          <Panel title="Checkout example" description="What a 100 item costs with the tax above.">
            <Text type="body" color="primary">{`${draft.currency_code ? `${draft.currency_code} ` : ""}${sampleTotal} total`}</Text>
          </Panel>
        </VStack>
      }
    >
      <PageHeader eyebrow="Administration" title="Business Settings" description="Identity, regional defaults, tax and ordering for every location and kiosk." />
      {notice && <NoticeBanner tone={notice.tone} title={notice.title} description={notice.description} />}
      {settingsGroups.map((group) => {
        const dirty = isDirty(group);
        const invalid = group.keys.some((key) => Boolean(errors[key]));
        const busyHere = busy === group.id;
        return (
          <Panel
            key={group.id}
            title={group.title}
            description={group.description}
            actions={dirty ? <StatusBadge tone="warning">Unsaved changes</StatusBadge> : <StatusBadge tone="success">Up to date</StatusBadge>}
          >
            <Grid columns={{ minWidth: 260, repeat: "fit" }} gap={4}>
              <SettingsFields group={group.id} draft={draft} errors={errors} update={update} />
            </Grid>
            <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
              <Text type="supporting" color="secondary">{group.highImpact ? "Applies to new orders only." : "Applies to every location and kiosk."}</Text>
              <HStack gap={2} vAlign="center">
                <Button label="Discard" variant="ghost" isDisabled={!dirty || busy !== null} onClick={() => discard(group)} />
                <Button label="Save changes" variant="primary" isLoading={busyHere} isDisabled={!dirty || invalid || (busy !== null && !busyHere)} onClick={() => requestSave(group)} />
              </HStack>
            </HStack>
          </Panel>
        );
      })}
      <ConfirmDialog
        isOpen={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={() => { if (pending) void persist(pending); setPending(null); }}
        title="Apply currency and tax change?"
        description="New orders use these values immediately. Receipts already issued keep their original amounts."
        confirmLabel="Apply change"
        destructive={false}
      />
    </DashboardPageWithPanel>
  );
}

function Activity({ business, refresh }: { business: Business; refresh: () => void }) {
  const tick = useAdminTick();
  const [events, setEvents] = useState<AdministrationActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [selected, setSelected] = useState<AdministrationActivity | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    api.administrationActivity(business.id).then((result) => setEvents(result.events)).catch((cause) => setError(explain(cause, "Could not load activity."))).finally(() => setLoading(false));
  }, [business.id, tick]);
  const visible = useMemo(() => events.filter((event) => {
    const content = `${event.action} ${event.entity || ""} ${event.actor_name || ""} ${event.actor_email || ""}`.toLowerCase();
    const created = new Date(event.created_at);
    const age = now - created.getTime();
    return content.includes(query.toLowerCase()) && (area === "all" || String(event.entity || "").toLowerCase().includes(area)) && (dateFilter === "all" || (dateFilter === "today" ? created.toDateString() === new Date().toDateString() : age < 7 * 86400000));
  }), [events, query, area, dateFilter, now]);
  const days = useMemo(() => eventsByDay(visible), [visible]);
  const busiest = days.reduce<{ label: string; value: number } | null>((best, day) => (!best || day.value > best.value ? day : best), null);
  const areas = useMemo(() => tally(visible, (event) => event.entity || "administration", (key) => human(key)), [visible]);
  const people = useMemo(() => tally(visible, (event) => event.actor_name || event.actor_email || "System", (name) => name), [visible]);
  const changes = (count: number) => `${count} ${count === 1 ? "change" : "changes"}`;

  const exportLog = () => {
    const csv = ["created_at,actor,action,entity", ...visible.map((event) => [event.created_at, event.actor_name || event.actor_email || "System", event.action, event.entity || ""].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "activity-log.csv";
    link.click();
  };

  return (
    <DashboardPage>
      <PageHeader title="Activity Log" description="Review business settings updates, menu edits, team access changes, and operations history." actions={<Button label="Export" variant="secondary" onClick={exportLog} />}>
        <Toolbar>
          <TextInput type="search" label="Search activity" placeholder="Search activity" value={query} onChange={setQuery} />
          <Selector label="Area" value={area} onChange={setArea} options={[{ value: "all", label: "All areas" }, { value: "business", label: "Business settings" }, { value: "product", label: "Menu & items" }, { value: "payment", label: "Payments" }, { value: "location", label: "Locations" }, { value: "staff", label: "Team" }, { value: "integration", label: "Integrations" }]} />
          <Selector label="Date" value={dateFilter} onChange={setDateFilter} options={[{ value: "all", label: "All dates" }, { value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }]} />
        </Toolbar>
      </PageHeader>
      {loading ? <LoadingBlock rows={5} /> : error ? (
        <NoticeBanner tone="danger" title="Could not load activity" description={error} action={<Button label="Retry" variant="secondary" onClick={refresh} />} />
      ) : !visible.length ? (
        <EmptyBlock title={events.length ? "No activity matches these filters" : "No activity yet"} description={events.length ? "Try another filter." : "No actions have been recorded yet. Every activity that is performed across your business will report here."} />
      ) : (
        <VStack gap={4}>
        <Grid columns={{ minWidth: 150, repeat: "fit" }} gap={4} align="start">
          <Metric label="Events" value={visible.length} hint="In the selected filter" />
          <Metric label="Active days" value={days.length} hint="Days with recorded changes" />
          <Metric label="Busiest day" value={busiest ? busiest.label : "—"} hint={busiest ? changes(busiest.value) : "No changes yet"} />
          <Metric label="Most active" value={people[0] ? people[0].label : "—"} hint={people[0] ? changes(people[0].value) : "No changes yet"} />
        </Grid>
        <Panel title="Activity per day" description="Recorded changes per day in the selected filter.">
          <DailyBars values={days} ariaLabel="Activity per day" format={(value) => String(Math.round(value))} />
        </Panel>
        <Grid columns={{ minWidth: 300, repeat: "fit" }} gap={4} align="start">
          <Panel title="By area" description="Where the recorded changes happened.">
            <RankedBars ariaLabel="Changes by area" rows={areas} format={(value) => String(Math.round(value))} />
          </Panel>
          <Panel title="By person" description="Who made the recorded changes.">
            <RankedBars ariaLabel="Changes by person" rows={people} format={(value) => String(Math.round(value))} />
          </Panel>
        </Grid>
        <Panel padding={4}>
          <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 640 }}>
          <Table
            idKey="id"
            data={visible as Array<AdministrationActivity & Record<string, unknown>>}
            columns={[
              { key: "when", header: "When", renderCell: (row: AdministrationActivity) => date(row.created_at) },
              { key: "actor", header: "Actor", renderCell: (row: AdministrationActivity) => row.actor_name || row.actor_email || "System" },
              { key: "action", header: "Activity", renderCell: (row: AdministrationActivity) => <Button label={`Details for ${human(row.action)}`} variant="ghost" size="sm" onClick={() => setSelected(row)}>{human(row.action)}</Button> },
              { key: "entity", header: "Area", renderCell: (row: AdministrationActivity) => human(row.entity || "Administration") },
            ]}
          />
          </div>
          </div>
        </Panel>
        </VStack>
      )}
      {selected && (
        <DetailDrawer title="Activity details" isOpen onClose={() => setSelected(null)} footer={<Button label="Close" variant="secondary" onClick={() => setSelected(null)} />}>
          <DetailRow label="Activity">{human(selected.action)}</DetailRow>
          <DetailRow label="Actor">{selected.actor_name || selected.actor_email || "System"}</DetailRow>
          <DetailRow label="When">{date(selected.created_at)}</DetailRow>
          <Text type="label">Change details</Text>
          {selected.metadata && Object.keys(selected.metadata).length
            ? Object.entries(selected.metadata).map(([key, value]) => <DetailRow key={key} label={human(key)}>{/token|secret|key|password/i.test(key) ? "••••••••" : human(value)}</DetailRow>)
            : <Text type="supporting" color="secondary">No additional detail returned.</Text>}
        </DetailDrawer>
      )}
    </DashboardPage>
  );
}

