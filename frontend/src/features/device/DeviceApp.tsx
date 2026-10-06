"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CounterApp } from "@/features/counter/CounterApp";
import { KitchenApp } from "@/features/kitchen/KitchenApp";
import { api } from "@/lib/api";

export function DeviceApp() {
  const router = useRouter();
  const [type, setType] = useState<"counter" | "kitchen" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void api.liveDeviceSessionContext().then((context) => { if (context.device.device_type === "counter" || context.device.device_type === "kitchen") setType(context.device.device_type); else router.replace("/device/start"); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Device session unavailable.")); }, [router]);
  if (error) return <main className="counter-auth"><section><h1>PlaceURorder Device</h1><p>{error}</p><button onClick={() => router.replace("/device/start")}>Pair or recover device</button></section></main>;
  if (!type) return <main className="counter-auth"><p>Securing device session…</p></main>;
  switch (type) {
    case "counter": return <CounterApp />;
    case "kitchen": return <KitchenApp />;
    default: return <main className="counter-auth"><p>Unsupported device application.</p></main>;
  }
}
