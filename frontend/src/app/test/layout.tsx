import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kiosk and operations demo",
  description: "Preview the PlaceURorder kiosk, counter POS, and kitchen display workflows.",
};

export default function TestRuntimeLayout({ children }: { children: React.ReactNode }) {
  return <main className="test-runtime-shell">{children}</main>;
}
