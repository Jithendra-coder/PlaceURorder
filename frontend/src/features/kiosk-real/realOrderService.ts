// This file is real kiosk production runtime only. It must not import preview sandbox files.
import { api } from "@/lib/api";

export function placeRealKioskOrder(
  slug: string,
  payload: {
    order_type: string;
    table_label?: string;
    customer_name?: string;
    customer_phone?: string;
    notes?: string;
    payment_method?: string;
    items: { product_id: string; quantity: number; notes?: string; customizations?: unknown[] }[];
  },
  idempotencyKey: string
) {
  return api.placeKioskOrder(slug, payload, idempotencyKey);
}
