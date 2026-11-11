"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LinkProvider } from "@astryxdesign/core/Link";
import { Theme } from "@astryxdesign/core/theme";
import { defaultThemeSlug, themes } from "@/astryx-themes";

export function AstryxDashboardProviders({ children }: { children: ReactNode }) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <LinkProvider component={Link}>{children}</LinkProvider>
    </Theme>
  );
}
