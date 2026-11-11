"use client";

import { Spinner } from "@astryxdesign/core/Spinner";
import { VStack } from "@astryxdesign/core/Stack";
import { AstryxDashboardProviders } from "@/components/dashboard/AstryxDashboardProviders";
import { PlaceURorderLogo } from "@/components/onboarding/OnboardingTopBar";

// Route transitions between different root layouts (for example sign-in to the dashboard) show this one neutral
// state: the logo and a spinner. It replaces the old full-page skeleton, which looked like a different app.
export default function RootLoading() {
  return (
    <AstryxDashboardProviders>
      <VStack gap={4} hAlign="center" vAlign="center" style={{ minHeight: "100vh" }}>
        <PlaceURorderLogo height={36} />
        <Spinner />
      </VStack>
    </AstryxDashboardProviders>
  );
}
