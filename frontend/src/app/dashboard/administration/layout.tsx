import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Business administration",
  description: "Manage business settings, payment providers, locations, team access, and integrations.",
};

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
