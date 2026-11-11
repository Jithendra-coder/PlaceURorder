"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { DeviceCard, DeviceFrame, DeviceLoading } from "@/components/device/DeviceFrame";
import { NoticeBanner } from "@/components/dashboard/kit";
import { api } from "@/lib/api";
import type { LiveDeviceContext } from "@/lib/types";

type DeviceType = "kiosk" | "counter" | "kitchen";

const STORAGE_KEY = "menutap.device.session";

export function LiveDeviceBootstrap({ deviceToken, expectedType }: { deviceToken: string; expectedType: DeviceType }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const cleanPath = cleanLivePath(expectedType);

  useEffect(() => {
    let active = true;
    async function exchange() {
      try {
        const context = await api.exchangeLiveDeviceToken(deviceToken, expectedType);
        if (!active) return;
        saveDeviceSnapshot(context);
        router.replace(context.launch_path || cleanPath);
      } catch (err) {
        if (!active) return;
        try {
          window.localStorage.removeItem(STORAGE_KEY);
          await api.clearLiveDeviceSession().catch(() => undefined);
        } catch {
          // Storage/cookie cleanup is best effort before showing the repair path.
        }
        setError(err instanceof Error ? err.message : "This device link is invalid or disabled. Pair this device again.");
      }
    }
    void exchange();
    return () => {
      active = false;
    };
  }, [cleanPath, deviceToken, expectedType, router]);

  if (error) {
    return (
      <DeviceFrame>
        <DeviceCard title="Device link unavailable" description="This link can no longer open the device.">
          <VStack gap={4}>
            <NoticeBanner tone="danger" title="The link did not connect" description={error} role="alert" />
            <Button label="Pair this device" variant="primary" width="100%" onClick={() => router.replace("/device/start")} />
          </VStack>
        </DeviceCard>
      </DeviceFrame>
    );
  }

  return <DeviceLoading message="Securing device session" />;
}

export function saveDeviceSnapshot(context: LiveDeviceContext) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        device_type: context.device.device_type,
        launch_path: context.launch_path || cleanLivePath(context.device.device_type as DeviceType),
        device_id: context.device.id,
        device_name: context.device.name,
      })
    );
  } catch {
    // Snapshot is non-secret convenience only; the httpOnly cookie is authoritative.
  }
}

function cleanLivePath(deviceType: DeviceType | string) {
  if (deviceType === "counter") return "/device";
  if (deviceType === "kitchen") return "/device";
  return "/kiosk/live";
}
