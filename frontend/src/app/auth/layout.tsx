import { AuthLayout } from "@/components/AuthShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account access",
  description: "Sign in, create a PlaceURorder account, or recover access to your business workspace.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}
