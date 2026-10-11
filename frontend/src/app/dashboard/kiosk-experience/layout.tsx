import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kiosk and menu settings",
  description: "Manage the customer menu, kiosk screens, promotions, branding, and publishing.",
};

export default function KioskExperienceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
