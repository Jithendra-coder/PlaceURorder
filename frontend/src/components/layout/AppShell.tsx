"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell as AstryxAppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { BarChart3, Bell, Check, FlaskConical, House, LogOut, MapPin, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Sparkles, UserRound, Zap, type LucideIcon } from "lucide-react";
import { AskAiPanel } from "@/components/assistant/AskAiPanel";
import { useBusiness } from "@/components/layout/BusinessProvider";
import { PlaceURorderLogo } from "@/components/onboarding/OnboardingTopBar";
import { api as dashboardApi, assetUrl } from "@/lib/api";
import { api as authApi } from "@/services/api";

type ModuleId = "insights" | "operations" | "kiosk" | "administration";
type NavItem = { label: string; href: string };
type NavModule = { id: ModuleId; label: string; icon: LucideIcon; path: string; items: NavItem[] };
type AlertPreview = { id: string; title?: string | null; message?: string | null; status?: string | null };

// The four modules below Home keep their order, labels and routes. Opening a module lands on its first page.
const modules: NavModule[] = [
  {
    id: "insights", label: "Insights", icon: BarChart3, path: "/dashboard/insights",
    items: [
      { label: "Sales & Orders", href: "/dashboard/insights/sales-reports" },
      { label: "Menu Performance", href: "/dashboard/insights/menu-performance" },
      { label: "Trends", href: "/dashboard/insights/analytics" },
      { label: "Reports", href: "/dashboard/insights/overview" },
    ],
  },
  {
    id: "operations", label: "Operations", icon: Zap, path: "/dashboard/operations",
    items: [
      { label: "Live Orders", href: "/dashboard/operations/live-orders" },
      { label: "Order History", href: "/dashboard/operations/order-history" },
      { label: "Kitchen Display", href: "/dashboard/operations/kitchen-display" },
      { label: "Counter POS", href: "/dashboard/operations/counter-pos" },
      { label: "Inventory", href: "/dashboard/operations/inventory" },
      { label: "Devices", href: "/dashboard/operations/devices" },
      { label: "Alerts", href: "/dashboard/operations/alerts" },
    ],
  },
  {
    id: "kiosk", label: "Kiosk & Menu", icon: Sparkles, path: "/dashboard/kiosk-experience",
    items: [
      { label: "Manage Menu", href: "/dashboard/kiosk-experience/menu?mode=items" },
      { label: "Availability", href: "/dashboard/kiosk-experience/availability" },
      { label: "Promotions", href: "/dashboard/kiosk-experience/promotions" },
      { label: "Kiosk Screens", href: "/dashboard/kiosk-experience/screens" },
      { label: "Welcome Screen", href: "/dashboard/kiosk-experience/welcome-screen" },
      { label: "Branding & Theme", href: "/dashboard/kiosk-experience/branding" },
      { label: "QR Codes", href: "/dashboard/kiosk-experience/qr-codes" },
      { label: "Preview Kiosk", href: "/dashboard/kiosk-experience/preview" },
      { label: "Test & Publish", href: "/dashboard/kiosk-experience/publish" },
    ],
  },
  {
    id: "administration", label: "Administration", icon: Settings, path: "/dashboard/administration",
    items: [
      { label: "Business Settings", href: "/dashboard/administration/business-settings" },
      { label: "Payments", href: "/dashboard/administration/payments" },
      { label: "Locations", href: "/dashboard/administration/locations" },
      { label: "Team & Access", href: "/dashboard/administration/team" },
      { label: "Integrations", href: "/dashboard/administration/integrations" },
      { label: "Activity Log", href: "/dashboard/administration/activity-log" },
    ],
  },
];

const homeHref = "/dashboard";
const testHref = "/dashboard/test";
const samePath = (href: string, pathname: string) => href.split("?")[0] === pathname;

function AppShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { business, locations, locationsLoading, locationsError, selectedLocationId, setSelectedLocationId } = useBusiness();
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(collapsed);
  const fullAnalyticsRef = useRef(false);
  const previousCollapsedRef = useRef<boolean | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertPreview[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alertsError, setAlertsError] = useState("");
  // A module the user collapsed on a page stays collapsed there; moving to another page opens the current module again.
  const [collapsedModule, setCollapsedModule] = useState<{ pathname: string; id: ModuleId } | null>(null);

  const pathModule = modules.find((module) => pathname.startsWith(module.path)) ?? null;
  const fullAnalytics = pathname === "/dashboard/insights/analytics" && searchParams.get("full") === "1";
  const selectedLocation = locations.find((location) => location.id === selectedLocationId) || null;
  const logoUrl = business?.logo_path ? assetUrl(business.logo_path) : null;
  const accountName = business?.name || "Account";
  const accountInitials = accountName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A";
  const currentItem = modules.flatMap((module) => module.items.map((item) => ({ module, item }))).find(({ item }) => samePath(item.href, pathname));
  const crumbs = pathname === homeHref
    ? [{ label: "Home", href: homeHref }]
    : pathname === testHref
      ? [{ label: "Home", href: homeHref }, { label: "Test Device", href: testHref }]
      : currentItem
        ? [{ label: "Home", href: homeHref }, { label: currentItem.module.label, href: currentItem.module.items[0].href }, { label: currentItem.item.label, href: currentItem.item.href }]
        : pathModule
          ? [{ label: "Home", href: homeHref }, { label: pathModule.label, href: pathModule.items[0].href }]
          : [{ label: "Home", href: homeHref }];

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
    if (!notificationsOpen || !business?.id) return;
    let active = true;
    void dashboardApi.alerts(business.id).then((result) => { if (active) { setAlerts(result.alerts.slice(0, 5)); setUnreadCount(result.summary.unresolved_count); setAlertsError(""); } }).catch((cause) => { if (active) setAlertsError(cause instanceof Error ? cause.message : "Notifications are temporarily unavailable."); });
    return () => { active = false; };
  }, [business?.id, notificationsOpen]);

  // The publish history page is a focused workspace without navigation chrome.
  if (pathname === "/dashboard/kiosk-experience/publish-history") return <>{children}</>;

  const locationItems = locations.length
    ? [
        { label: "All locations", endContent: !selectedLocationId ? <Check size={16} aria-hidden="true" /> : undefined, onClick: () => setSelectedLocationId(null) },
        ...locations.map((location) => ({ label: location.name, endContent: selectedLocationId === location.id ? <Check size={16} aria-hidden="true" /> : undefined, onClick: () => setSelectedLocationId(location.id) })),
      ]
    : [{ label: locationsError ? "Locations are temporarily unavailable" : "No locations created", isDisabled: true }];

  const sideNav = (
    <SideNav
      data-dashboard-sidebar
      data-collapsed={String(collapsed)}
      collapsible={{ isCollapsed: collapsed, onCollapsedChange: setCollapsed, hasButton: false }}
      footer={
        <SideNavSection title="Tools" isHeaderHidden>
          <SideNavItem label="Test Device" icon={FlaskConical} href={testHref} isSelected={pathname === testHref} />
        </SideNavSection>
      }
    >
      <SideNavSection title="Workspace" isHeaderHidden>
        <SideNavItem label="Home" icon={House} href={homeHref} isSelected={pathname === homeHref} />
      </SideNavSection>
      <SideNavSection title="Modules" isHeaderHidden>
        {modules.map((module) => {
          const isCurrentModule = pathModule?.id === module.id;
          const isOpen = isCurrentModule && !(collapsedModule?.id === module.id && collapsedModule.pathname === pathname);
          return (
            <SideNavItem
              key={module.id}
              label={module.label}
              icon={module.icon}
              isSelected={isCurrentModule}
              collapsible={{
                isCollapsed: !isOpen,
                onCollapsedChange: (isCollapsed) => {
                  if (isCollapsed) {
                    setCollapsedModule({ pathname, id: module.id });
                    return;
                  }
                  setCollapsedModule(null);
                  router.push(module.items[0].href);
                },
              }}
            >
              {module.items.map((item) => (
                <SideNavItem key={item.label} label={item.label} href={item.href} isSelected={samePath(item.href, pathname)} />
              ))}
            </SideNavItem>
          );
        })}
      </SideNavSection>
    </SideNav>
  );

  const topNav = (
    <TopNav
      label="Dashboard header"
      heading={<TopNavHeading logo={<PlaceURorderLogo height={26} />} headingHref={homeHref} />}
      startContent={
        <HStack gap={3} vAlign="center">
          <IconButton
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            icon={collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            variant="ghost"
            onClick={() => setCollapsed((value) => !value)}
          />
          <Breadcrumbs label="Breadcrumb">
            {crumbs.map((crumb, index) => (
              <BreadcrumbItem key={`${index}-${crumb.label}`} href={crumb.href} isCurrent={index === crumbs.length - 1}>{crumb.label}</BreadcrumbItem>
            ))}
          </Breadcrumbs>
        </HStack>
      }
      endContent={
        <HStack gap={2} vAlign="center">
          <DropdownMenu
            button={{ label: "Business location", children: selectedLocation?.name || (locationsLoading ? "Loading locations" : "All locations"), variant: "secondary", size: "sm", icon: <MapPin size={16} aria-hidden="true" /> }}
            items={locationItems}
            placement="below"
            alignment="end"
          />
          <Popover
            label="Notifications"
            placement="below"
            alignment="end"
            width={360}
            isOpen={notificationsOpen}
            onOpenChange={setNotificationsOpen}
            content={
              <VStack gap={3}>
                <Heading level={3}>Notifications</Heading>
                {alertsError ? <Text type="body" color="secondary">{alertsError}</Text> : alerts.length ? alerts.map((alert) => (
                  <VStack gap={1} key={alert.id}>
                    <Text type="label">{alert.title || "Alert"}</Text>
                    <Text type="supporting">{alert.message || "Open Operations Alerts for details."}</Text>
                  </VStack>
                )) : <Text type="body" color="secondary">No active notifications.</Text>}
                <Button label="Open Alerts" variant="secondary" href="/dashboard/operations/alerts" />
              </VStack>
            }
          >
            <IconButton label={unreadCount ? `Notifications, ${unreadCount} unresolved` : "Notifications"} icon={<Bell size={18} aria-hidden="true" />} variant="ghost" />
          </Popover>
          {unreadCount > 0 && <Badge variant="error" label={String(unreadCount)} />}
          <DropdownMenu
            button={{ label: "Account", children: accountName, variant: "ghost", size: "sm", icon: logoUrl ? <Avatar size="xsm" src={logoUrl} name={accountName} tooltip={false} /> : <Avatar size="xsm" name={accountInitials} tooltip={false} /> }}
            header={<Text type="supporting">Owner</Text>}
            items={[
              { label: "Profile & business settings", href: "/dashboard/administration/business-settings", icon: <UserRound size={16} aria-hidden="true" /> },
              { label: "Security & active sessions", href: "/dashboard/administration/team?tab=Sessions", icon: <ShieldCheck size={16} aria-hidden="true" /> },
              { label: "Sign out", icon: <LogOut size={16} aria-hidden="true" />, variant: "destructive", onClick: () => void authApi.logout().finally(() => router.replace("/auth/sign-in")) },
            ]}
            placement="below"
            alignment="end"
          />
        </HStack>
      }
    />
  );

  return (
    <>
      <AstryxAppShell height="fill" variant="elevated" contentPadding={0} topNav={topNav} sideNav={sideNav}>
        {children}
      </AstryxAppShell>
      <AskAiPanel businessId={business?.id ?? null} />
    </>
  );
}

export function AppShell(props: { children: ReactNode }) {
  return <Suspense fallback={props.children}><AppShellInner {...props} /></Suspense>;
}
