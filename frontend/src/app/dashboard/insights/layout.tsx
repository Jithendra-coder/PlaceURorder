import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Business insights",
  description: "Review sales, order trends, and menu performance in PlaceURorder.",
};

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
