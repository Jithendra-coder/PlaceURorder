import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Device setup",
  description: "Pair and activate a PlaceURorder kiosk or operations device.",
};

export default function DeviceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
