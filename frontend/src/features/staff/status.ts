export type KitchenStage = "pending" | "preparing" | "ready";

export function kitchenStage(order: { status: string; kitchen?: { stage?: KitchenStage; is_held?: boolean } }): KitchenStage | null {
  const stage = order.kitchen?.stage || order.status;
  return stage === "pending" || stage === "preparing" || stage === "ready" ? stage : null;
}

export function kitchenLabel(stage: KitchenStage): string {
  return stage === "pending" ? "New" : stage === "preparing" ? "Preparing" : "Ready";
}

export function connectionLabel(online: boolean, queued: number, unavailable = false): string {
  if (!online) return "Offline";
  if (unavailable) return "Status unavailable";
  return queued ? `${queued} pending sync` : "Connected";
}

export function elapsedLabel(value?: string | null, now = Date.now()): string {
  if (!value) return "—";
  const elapsed = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Where an order came from: customers on the QR link, the kiosk, or the counter. */
export function orderSourceLabel(source?: string | null): string {
  if (source === "qr") return "Online (QR)";
  if (source === "counter") return "Counter";
  return "Kiosk";
}

export const isOnlineOrder = (source?: string | null) => source === "qr";
