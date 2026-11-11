import { Suspense } from "react";
import { DeviceApp } from "@/features/device/DeviceApp";
import { DeviceLoading } from "@/components/device/DeviceFrame";

export default function DevicePage() {
  return (
    <Suspense fallback={<DeviceLoading message="Securing device session" />}>
      <DeviceApp />
    </Suspense>
  );
}
