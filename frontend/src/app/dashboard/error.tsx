"use client";

import { useEffect } from "react";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { DashboardPage, NoticeBanner, PageHeader } from "@/components/dashboard/kit";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Dashboard error caught by boundary:", error);
  }, [error]);

  return (
    <DashboardPage width={720}>
      <VStack gap={5}>
        <PageHeader title="Could not load this dashboard section" description="This section hit an unexpected problem. Try again, or return to Home." />
        <NoticeBanner
          tone="danger"
          title="Something went wrong"
          description={error.message || "This dashboard section encountered an unexpected error. Your data has not been changed."}
          action={<Button label="Try again" variant="secondary" onClick={reset} />}
        />
        <Heading level={3} weight="semibold">Need a fresh start?</Heading>
        <Text type="body" color="secondary">Reloading the page re-checks your connection and session.</Text>
        <Button label="Reload page" variant="ghost" onClick={() => window.location.reload()} />
      </VStack>
    </DashboardPage>
  );
}
