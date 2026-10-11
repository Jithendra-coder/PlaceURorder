import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Counter POS",
  description: "Take counter orders and send them to the PlaceURorder kitchen display.",
};

export default function CounterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
