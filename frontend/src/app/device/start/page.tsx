"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { DeviceCard, DeviceFrame } from "@/components/device/DeviceFrame";
import { NoticeBanner } from "@/components/dashboard/kit";
import { api } from "@/lib/api";

// Codes are typed in case-insensitively; spaces and dashes are ignored so a code copied with its separators still works.
const normalise = (value: string) => value.trim().toUpperCase().replace(/[\s-]/g, "");

// The code decides what the device is. The server returns that type and the name it was created with.
const typeLabels: Record<string, string> = { counter: "Counter", kitchen: "Kitchen", kiosk: "Kiosk" };

function DeviceStartForm() {
  const router = useRouter();
  const search = useSearchParams();
  // A pairing link from the dashboard carries the code, so it is already filled in when the device opens it.
  const [code, setCode] = useState(() => (search.get("code") || "").slice(0, 32));
  const [error, setError] = useState("");
  const [paired, setPaired] = useState<{ name: string; type: string; launchPath: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const cleaned = normalise(code);
  const valid = cleaned.length >= 6;

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      // No device name is sent: the server keeps the name chosen when the code was generated.
      const result = await api.activateDevice({ activation_code: cleaned, user_agent: navigator.userAgent });
      const type = result.session.device_type;
      const name = result.device?.display_name || result.device?.name || `${typeLabels[type] ?? "PlaceURorder"} device`;
      const launchPath = result.session.launch_path || "/device";
      setPaired({ name, type, launchPath });
      window.setTimeout(() => router.replace(launchPath), 1200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This code could not be activated. Check it and try again.");
      setBusy(false);
    }
  };

  if (paired) {
    return (
      <DeviceFrame>
        <DeviceCard title="Device paired" description={`${typeLabels[paired.type] ?? "PlaceURorder"} device connected.`}>
          <VStack gap={4}>
            <NoticeBanner tone="success" title={paired.name} description={`Opening the ${typeLabels[paired.type]?.toLowerCase() ?? ""} screen…`} role="status" />
          </VStack>
        </DeviceCard>
      </DeviceFrame>
    );
  }

  return (
    <DeviceFrame>
      <DeviceCard title="Pair this device" description="Enter the activation code. The code sets the device type, so a kitchen code pairs a kitchen.">
        <form onSubmit={activate} noValidate>
          <VStack gap={5}>
            {error && <NoticeBanner tone="danger" title="Activation failed" description={error} role="alert" />}
            <TextInput
              id="activation-code"
              label="Activation code"
              description="Generate it in PlaceURorder under Operations, Devices, Add Devices."
              placeholder="Enter the code"
              value={code}
              onChange={setCode}
              autoComplete="off"
              isDisabled={busy}
              width="100%"
            />
            <Button label="Pair device" type="submit" variant="primary" width="100%" isLoading={busy} isDisabled={!valid || busy} />
            <Text type="supporting" color="secondary">If a code no longer works, it has probably expired. Create a new one from the dashboard.</Text>
          </VStack>
        </form>
      </DeviceCard>
    </DeviceFrame>
  );
}

export default function DeviceStartPage() {
  return <Suspense fallback={null}><DeviceStartForm /></Suspense>;
}
