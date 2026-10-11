import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kitchen display",
  description: "Track new, preparing, and ready orders in the PlaceURorder kitchen display.",
};

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
