import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Business operations",
  description: "Monitor orders, inventory, kitchen displays, and devices in PlaceURorder.",
};

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
