"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode, type SVGProps } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { api as dashboardApi, assetUrl } from "@/lib/api";
import { api as authApi } from "@/services/api";
import { PlaceURorderLogo } from "@/components/onboarding/OnboardingTopBar";

type ModuleId = "insights" | "operations" | "kiosk" | "administration";

const modules: { id: ModuleId; label: string; icon: IconName; items: string[] }[] = [
  { id: "insights", label: "Insights", icon: "analytics", items: ["Sales & Orders", "Menu Performance", "Trends", "Reports"] },
  { id: "operations", label: "Operations", icon: "lightning", items: ["Live Orders", "Order History", "Kitchen Display", "Counter POS", "Inventory", "Devices", "Alerts"] },
  { id: "kiosk", label: "Kiosk & Menu", icon: "sparkles", items: ["Manage Menu", "Availability", "Promotions", "Kiosk Screens", "Welcome Screen", "Branding & Theme", "QR Codes", "Preview Kiosk", "Test & Publish"] },
  { id: "administration", label: "Administration", icon: "settings", items: ["Business Settings", "Payments", "Locations", "Team & Access", "Integrations", "Activity Log"] },
];

const insightRoutes: Record<string, string> = {
  "Sales & Orders": "/dashboard/insights/sales-reports",
  Trends: "/dashboard/insights/analytics",
  Reports: "/dashboard/insights/overview",
  "Menu Performance": "/dashboard/insights/menu-performance",
};
const operationsRoutes: Record<string, string> = {
  "Live Orders": "/dashboard/operations/live-orders",
  "Order History": "/dashboard/operations/order-history",
  "Kitchen Display": "/dashboard/operations/kitchen-display",
  "Counter POS": "/dashboard/operations/counter-pos",
  Inventory: "/dashboard/operations/inventory",
  Devices: "/dashboard/operations/devices",
  Alerts: "/dashboard/operations/alerts",
};
const kioskRoutes: Record<string, string> = {
  "Manage Menu": "/dashboard/kiosk-experience/menu?mode=items",
  Availability: "/dashboard/kiosk-experience/availability",
  Promotions: "/dashboard/kiosk-experience/promotions",
  "Kiosk Screens": "/dashboard/kiosk-experience/screens",
  "Welcome Screen": "/dashboard/kiosk-experience/welcome-screen",
  "Branding & Theme": "/dashboard/kiosk-experience/branding",
  "QR Codes": "/dashboard/kiosk-experience/qr-codes",
  "Preview Kiosk": "/dashboard/kiosk-experience/preview",
  "Test & Publish": "/dashboard/kiosk-experience/publish",
};
const administrationRoutes: Record<string, string> = {
  "Business Settings": "/dashboard/administration/business-settings",
  Payments: "/dashboard/administration/payments",
  Locations: "/dashboard/administration/locations",
  "Team & Access": "/dashboard/administration/team",
  Integrations: "/dashboard/administration/integrations",
  "Activity Log": "/dashboard/administration/activity-log",
};

function AppShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { business, locations, locationsLoading, locationsError, selectedLocationId, setSelectedLocationId } = useBusiness();
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(collapsed);
  const fullAnalyticsRef = useRef(false);
  const previousCollapsedRef = useRef<boolean | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [flyout, setFlyout] = useState<ModuleId | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [alerts, setAlerts] = useState<Array<{ id: string; title?: string | null; message?: string | null; status?: string | null }>>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alertsError, setAlertsError] = useState("");
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const pathModule = pathname.startsWith("/dashboard/insights") ? "insights" : pathname.startsWith("/dashboard/operations") ? "operations" : pathname.startsWith("/dashboard/kiosk-experience") ? "kiosk" : pathname.startsWith("/dashboard/administration") ? "administration" : null;
  const selection: "home" | ModuleId = pathModule || "home";
  const selectedModule = modules.find((module) => module.id === selection);

  const fullAnalytics = pathname === "/dashboard/insights/analytics" && searchParams.get("full") === "1";

  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);
  useEffect(() => {
    if (fullAnalytics && !fullAnalyticsRef.current) {
      previousCollapsedRef.current = collapsedRef.current;
      fullAnalyticsRef.current = true;
      setCollapsed(true);
    } else if (!fullAnalytics && fullAnalyticsRef.current) {
      const previous = previousCollapsedRef.current;
      fullAnalyticsRef.current = false;
      previousCollapsedRef.current = null;
      if (previous !== null) setCollapsed(previous);
    }
  }, [fullAnalytics]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    if (drawer) document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setDrawer(false); setFlyout(null); setLocationOpen(false); setAccountOpen(false); setNotificationsOpen(false); } };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [drawer]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (flyoutRef.current && !flyoutRef.current.contains(event.target as Node)) setFlyout(null); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const accountWasOpen = useRef(false);
  useEffect(() => {
    if (accountWasOpen.current && !accountOpen) accountButtonRef.current?.focus();
    accountWasOpen.current = accountOpen;
  }, [accountOpen]);

  useEffect(() => {
    if (!notificationsOpen || !business?.id) return;
    let active = true;
    void dashboardApi.alerts(business.id).then((result) => { if (active) { setAlerts(result.alerts.slice(0, 5)); setUnreadCount(result.summary.unresolved_count); setAlertsError(""); } }).catch((cause) => { if (active) setAlertsError(cause instanceof Error ? cause.message : "Notifications are temporarily unavailable."); });
    return () => { active = false; };
  }, [business?.id, notificationsOpen]);

  const toggle = () => {
    if (window.innerWidth >= 1024) setCollapsed((value) => !value);
    else setDrawer((value) => !value);
  };
  const breadcrumb = pathname.startsWith("/dashboard/insights") ? `Insights / ${pathname.split("/").pop()?.replaceAll("-", " ")}` : pathname.startsWith("/dashboard/operations") ? `Operations / ${pathname.split("/").pop()?.replaceAll("-", " ")}` : pathname.startsWith("/dashboard/kiosk-experience") ? `Kiosk & Menu / ${pathname.split("/").pop()?.replaceAll("-", " ")}` : pathname.startsWith("/dashboard/administration") ? `Administration / ${pathname.split("/").pop()?.replaceAll("-", " ")}` : "Home";
  const logoUrl = business?.logo_path ? assetUrl(business.logo_path) : null;
  const accountInitials = (business?.name || "Account").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const selectedLocation = locations.find((location) => location.id === selectedLocationId) || null;

  if (pathname === "/dashboard/kiosk-experience/publish-history") return <div className="mt-focused-history-shell">{children}</div>;

  return (
    <div className="mt-dashboard-shell" data-collapsed={collapsed} data-drawer={drawer}>
      <button type="button" className="mt-dashboard-backdrop" onClick={() => setDrawer(false)} aria-label="Close navigation" />
      <aside className="mt-dashboard-sidebar" aria-label="Main Navigation">
        <div className="mt-dashboard-brand"><PlaceURorderLogo height={collapsed ? 28 : 38} /><button type="button" className="mt-dashboard-sidebar-toggle" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen size={18} strokeWidth={1.8} aria-hidden="true" /> : <PanelLeftClose size={18} strokeWidth={1.8} aria-hidden="true" />}</button></div>
        {!collapsed && <div className="mt-dashboard-location-wrap"><button type="button" className="mt-dashboard-location" aria-expanded={locationOpen} onClick={() => setLocationOpen((value) => !value)}><Icon name="pin" /><span>{selectedLocationId ? locations.find((location) => location.id === selectedLocationId)?.name || "Select location" : "Select location"}<small>{locationsLoading ? "Loading locations…" : locationsError ? "Locations unavailable" : locations.length ? "Choose a location" : "No locations created"}</small></span></button>{locationOpen && <div className="mt-dashboard-popover mt-dashboard-location-menu" role="listbox" aria-label="Business locations">{locations.length ? <>{<button type="button" role="option" aria-selected={!selectedLocationId} onClick={() => { setSelectedLocationId(null); setLocationOpen(false); }}>All locations</button>}{locations.map((location) => <button type="button" role="option" aria-selected={selectedLocationId === location.id} key={location.id} onClick={() => { setSelectedLocationId(location.id); setLocationOpen(false); }}>{location.name}</button>)}</> : <p>{locationsError ? "Locations are temporarily unavailable." : "No locations created"}</p>}</div>}</div>}
        {collapsed ? <>
          <nav className="mt-dashboard-rail" aria-label="Main navigation" ref={flyoutRef}>
            <Link href="/dashboard" className="mt-dashboard-rail-button" aria-label="Home" aria-current={pathname === "/dashboard" ? "page" : undefined} data-tooltip="Home"><Icon name="home" /></Link>
            {modules.map((module) => <div className="mt-dashboard-rail-module" key={module.id}><button type="button" className="mt-dashboard-rail-button" aria-label={`Open ${module.label}`} aria-pressed={selection === module.id} aria-expanded={flyout === module.id} data-tooltip={flyout === module.id ? undefined : module.label} onClick={() => setFlyout((value) => value === module.id ? null : module.id)}><Icon name={module.icon} /></button>{flyout === module.id && <nav className="mt-dashboard-rail-flyout" aria-label={`${module.label} navigation`}><strong>{module.label}</strong>{module.items.map((item) => { const href = insightRoutes[item] || operationsRoutes[item] || kioskRoutes[item] || administrationRoutes[item]; return href ? <Link href={href} aria-current={pathname === href.split("?")[0] ? "page" : undefined} onClick={() => setFlyout(null)} key={item}>{item}</Link> : <span key={item} aria-disabled="true">{item}</span>; })}</nav>}</div>)}
          </nav>
          <div className="mt-dashboard-test"><Link href="/dashboard/test" className="mt-dashboard-rail-button" aria-label="Test Device" aria-current={pathname === "/dashboard/test" ? "page" : undefined} data-tooltip="Test Device"><Icon name="flask" /></Link></div>
        </> : <>
          <Link href="/dashboard" className="mt-dashboard-home" aria-current={pathname === "/dashboard" ? "page" : undefined}><Icon name="home" /><span>Home</span></Link>
          <div className="mt-dashboard-modules" role="group" aria-label="Dashboard Modules">
            {modules.map((module) => <button type="button" key={module.id} aria-label={`Open ${module.label === "Kiosk & Menu" ? "Kiosk and Menu" : module.label}`} aria-pressed={selection === module.id} onClick={() => { if (module.id === "insights") router.push(insightRoutes["Sales & Orders"]); if (module.id === "operations") router.push(operationsRoutes["Live Orders"]); if (module.id === "kiosk") router.push(kioskRoutes["Manage Menu"]); if (module.id === "administration") router.push(administrationRoutes["Business Settings"]); }}><Icon name={module.icon} /><span>{module.label}</span></button>)}
          </div>
          {selectedModule && <nav className="mt-dashboard-context" aria-label={`${selectedModule.label} Navigation`}><h2>{selectedModule.label}</h2>{selectedModule.items.map((item) => { const href = insightRoutes[item] || operationsRoutes[item] || kioskRoutes[item] || administrationRoutes[item]; return href ? <Link href={href} aria-current={pathname === href.split("?")[0] ? "page" : undefined} key={item}>{item}</Link> : <button type="button" aria-disabled="true" title={`Planned: ${item}`} key={item}>{item}</button>; })}</nav>}
          <div className="mt-dashboard-test"><Link href="/dashboard/test"><Icon name="flask" /><span><strong>Test Device</strong><small>Test kiosk, kitchen &amp; counter</small></span><Icon name="chevron" /></Link></div>
        </>}
      </aside>
      <header className="mt-dashboard-topbar">
        <span className="mt-dashboard-context-label" title={breadcrumb} aria-label={breadcrumb}>{breadcrumb}</span>
        <span className="mt-dashboard-topbar__spacer" />
        <div className="mt-dashboard-control-wrap"><button type="button" className="mt-dashboard-topbar-location" data-empty={!selectedLocation} aria-label={selectedLocation ? `Change location: ${selectedLocation.name}` : "Select location"} aria-expanded={locationOpen} title={selectedLocation?.name || "No location selected"} onClick={() => setLocationOpen((value) => !value)}><Icon name="pin" />{selectedLocation && <span>{selectedLocation.name}</span>}<Icon name="chevron" /></button>{locationOpen && <div className="mt-dashboard-popover mt-dashboard-topbar-location-menu" role="listbox" aria-label="Business locations">{locations.length ? <>{<button type="button" role="option" aria-selected={!selectedLocationId} onClick={() => { setSelectedLocationId(null); setLocationOpen(false); }}>All locations</button>}{locations.map((location) => <button type="button" role="option" aria-selected={selectedLocationId === location.id} key={location.id} onClick={() => { setSelectedLocationId(location.id); setLocationOpen(false); }}>{location.name}</button>)}</> : <p>No locations created</p>}</div>}</div>
        <div className="mt-dashboard-control-wrap"><button type="button" className="mt-dashboard-icon-button" aria-label={unreadCount ? `Notifications, ${unreadCount} unresolved` : "Notifications"} aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((value) => !value); setAccountOpen(false); }}><Icon name="bell" />{unreadCount > 0 && <span className="mt-dashboard-notification-dot" aria-label={`${unreadCount} unresolved notifications`} />}</button>{notificationsOpen && <div className="mt-dashboard-popover mt-dashboard-notification-menu" role="dialog" aria-label="Notifications"><strong>Notifications</strong>{alertsError ? <p>{alertsError}</p> : alerts.length ? alerts.map((alert) => <Link href="/dashboard/operations/alerts" key={alert.id}><strong>{alert.title || "Alert"}</strong><span>{alert.message || "Open Operations Alerts for details."}</span></Link>) : <p>No active notifications.</p>}<Link className="mt-card-link" href="/dashboard/operations/alerts">Open Alerts</Link></div>}</div>
        <div className="mt-dashboard-control-wrap"><button ref={accountButtonRef} type="button" className="mt-dashboard-account" aria-label="Account" aria-expanded={accountOpen} onClick={() => { setAccountOpen((value) => !value); setNotificationsOpen(false); }}><span className="mt-dashboard-account-avatar" aria-hidden="true">{logoUrl ? <Image src={logoUrl} alt="" width={38} height={38} unoptimized /> : accountInitials || "A"}</span><span className="mt-dashboard-account-copy"><strong>{business?.name || "Account"}</strong><small>Owner</small></span><Icon name="chevron" /></button>{accountOpen && <div className="mt-dashboard-popover mt-dashboard-account-menu" role="menu"><Link href="/dashboard/administration/business-settings" role="menuitem">Profile & business settings</Link><Link href="/dashboard/administration/team?tab=Sessions" role="menuitem">Security & active sessions</Link><button type="button" role="menuitem" onClick={() => void authApi.logout().finally(() => router.replace("/auth/sign-in"))}>Sign out</button></div>}</div>
      </header>
      <main className="mt-dashboard-main">{children}</main>
    </div>
  );
}

export function AppShell(props: { children: ReactNode }) {
  return <Suspense fallback={props.children}><AppShellInner {...props} /></Suspense>;
}

type IconName = "analytics" | "lightning" | "sparkles" | "settings" | "pin" | "home" | "flask" | "menu" | "search" | "bell" | "user" | "chevron";

function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    analytics: <><path d="M4 19V9m6 10V5m6 14v-7m4 7H2" /></>,
    lightning: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    sparkles: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v11h14V10M9 21v-7h6v7" /></>,
    flask: <><path d="M9 3v4.3L3.8 17.5A2.3 2.3 0 0 0 5.8 21h12.4a2.3 2.3 0 0 0 2-3.5L15 7.3V3M6 14h12" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
  };
  return <svg {...props} className={`mt-dashboard-icon ${props.className || ""}`.trim()} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
