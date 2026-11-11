"use client";

import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { AstryxDashboardProviders } from "@/components/dashboard/AstryxDashboardProviders";
import { PlaceURorderLogo } from "@/components/onboarding/OnboardingTopBar";

// Device screens (pairing, session checks, link errors) share one frame: the Astryx theme, a centred card and the
// PlaceURorder mark. Running device apps (counter, kitchen, kiosk) are not wrapped in it; they fill the screen.

export function DeviceFrame({ children }: { children: ReactNode }) {
  return (
    <AstryxDashboardProviders>
      <Layout height="auto" style={{ minHeight: "100vh" }}>
        <LayoutContent padding={6}>
          <VStack gap={0} hAlign="center" vAlign="center" style={{ minHeight: "calc(100vh - 48px)" }}>
            {children}
          </VStack>
        </LayoutContent>
      </Layout>
    </AstryxDashboardProviders>
  );
}

export function DeviceCard({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <Card padding={6} elevation="med" width="100%" maxWidth={480}>
      <VStack gap={5}>
        <VStack gap={3} hAlign="center">
          <PlaceURorderLogo height={32} />
          <VStack gap={1} hAlign="center">
            <Heading level={1} weight="semibold">{title}</Heading>
            {description && <Text type="body" color="secondary">{description}</Text>}
          </VStack>
        </VStack>
        {children}
      </VStack>
    </Card>
  );
}

/** Shown while the device session is being checked. Same frame as every other device state. */
export function DeviceLoading({ title = "PlaceURorder device", message = "Securing device session" }: { title?: string; message?: string }) {
  return (
    <DeviceFrame>
      <DeviceCard title={title} description={message}>
        <HStack gap={2} hAlign="center" vAlign="center">
          <Spinner />
          <Text type="supporting" color="secondary">This only takes a moment.</Text>
        </HStack>
      </DeviceCard>
    </DeviceFrame>
  );
}
