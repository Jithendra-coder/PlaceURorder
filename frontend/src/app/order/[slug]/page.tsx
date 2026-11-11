import { Suspense } from "react";
import { QrOrderApp } from "@/features/order/QrOrderApp";

export const metadata = { title: "Order online · PlaceURorder" };

export default function Page() {
  return (
    <Suspense fallback={<main style={{ padding: 24, fontFamily: "inherit" }}>Loading the menu…</main>}>
      <QrOrderApp />
    </Suspense>
  );
}
