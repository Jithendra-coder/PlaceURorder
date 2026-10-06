"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function DeviceStartPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activate = async () => { setBusy(true); setError(""); try { const session = await api.activateDevice({ activation_code: code, device_name: "Counter device", user_agent: navigator.userAgent }); router.replace(session.session.launch_path || "/device"); } catch (err) { setError(err instanceof Error ? err.message : "Activation failed."); } finally { setBusy(false); } };
  return <main className="counter-auth"><section><h1>Pair PlaceURorder Counter</h1><p>Enter the activation code created for this Counter device.</p><input aria-label="Activation code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Activation code" className="mt-4 min-h-11 w-full rounded border px-3" /><button className="mt-4" disabled={!code || busy} onClick={() => void activate()}>Activate Counter</button>{error && <p className="mt-3 text-red-700">{error}</p>}</section></main>;
}
