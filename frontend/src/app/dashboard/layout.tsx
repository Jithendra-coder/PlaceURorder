import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AstryxDashboardProviders } from "@/components/dashboard/AstryxDashboardProviders";
import { BusinessProvider } from "@/components/layout/BusinessProvider";
import { ProtectedRouteGate } from "@/components/layout/ProtectedRouteGate";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Merchant dashboard",
  description: "Manage your menu, kiosk, staff, orders, and business performance with PlaceURorder.",
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <BusinessProvider><AstryxDashboardProviders><AppShell><ProtectedRouteGate area="dashboard">{children}</ProtectedRouteGate></AppShell></AstryxDashboardProviders></BusinessProvider>;
}
