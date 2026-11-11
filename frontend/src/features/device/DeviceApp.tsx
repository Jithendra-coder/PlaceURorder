"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { DeviceCard, DeviceFrame, DeviceLoading } from "@/components/device/DeviceFrame";
import { NoticeBanner } from "@/components/dashboard/kit";
import { CounterApp } from "@/features/counter/CounterApp";
import { KitchenApp } from "@/features/kitchen/KitchenApp";
import { api } from "@/lib/api";

export function DeviceApp() {
  const router = useRouter();
  const [type, setType] = useState<"counter" | "kitchen" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api.liveDeviceSessionContext()
      .then((context) => {
        if (context.device.device_type === "counter" || context.device.device_type === "kitchen") setType(context.device.device_type);
        else router.replace("/device/start");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Device session unavailable."));
  }, [router]);

  if (error) {
    return (
      <DeviceFrame>
        <DeviceCard title="Device session required" description="This device is not connected to PlaceURorder right now.">
          <VStack gap={4}>
            <NoticeBanner tone="danger" title="Could not verify this device" description={error} role="alert" />
            <Button label="Pair or recover device" variant="primary" width="100%" onClick={() => router.replace("/device/start")} />
          </VStack>
        </DeviceCard>
      </DeviceFrame>
    );
  }
  if (!type) return <DeviceLoading message="Securing device session" />;
  switch (type) {
    case "counter": return <CounterApp />;
    case "kitchen": return <KitchenApp />;
    default:
      return (
        <DeviceFrame>
          <DeviceCard title="Unsupported device" description="This device type does not have an application.">
            <Button label="Pair or recover device" variant="secondary" width="100%" onClick={() => router.replace("/device/start")} />
          </DeviceCard>
        </DeviceFrame>
      );
  }
}
