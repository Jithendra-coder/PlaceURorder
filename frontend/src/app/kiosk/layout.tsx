import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Self-service kiosk",
  description: "Browse a business menu, customize items, and place an order with the PlaceURorder kiosk.",
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return children;
}
