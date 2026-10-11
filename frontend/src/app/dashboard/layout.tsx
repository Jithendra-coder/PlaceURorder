import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { BusinessProvider } from "@/components/layout/BusinessProvider";
import { ProtectedRouteGate } from "@/components/layout/ProtectedRouteGate";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Merchant dashboard",
  description: "Manage your menu, kiosk, staff, orders, and business performance with PlaceURorder.",
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <BusinessProvider><ProtectedRouteGate area="dashboard"><AppShell>{children}</AppShell></ProtectedRouteGate></BusinessProvider>;
}
