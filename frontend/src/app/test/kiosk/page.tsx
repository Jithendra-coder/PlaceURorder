"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KioskRuntime } from "@/app/kiosk/[id]/page";
import { api } from "@/lib/api";
import { testSessionStateMessage } from "@/features/test-runtime";

export default function TestKioskPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api.testRuntimeContext("kiosk")
      .then(() => { if (active) setReady(true); })
      .catch((cause) => { if (active) setError(testSessionStateMessage(cause)); });
    return () => { active = false; };
  }, []);

  if (error) return <main className="staff-recovery"><section><h1>PlaceURorder Test Kiosk</h1><p>{error}</p><button onClick={() => router.push("/dashboard/test")}>Return to Test Hub</button></section></main>;
  if (!ready) return <main className="staff-recovery"><p>Securing isolated Test Kiosk…</p></main>;
  return <KioskRuntime routeSlug="test-runtime" operationalMode="test" sessionId="standalone-test" initialView="start" />;
}
