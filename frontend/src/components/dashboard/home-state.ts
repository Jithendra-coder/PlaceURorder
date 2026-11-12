import type { KioskSetupOverview, Product } from "@/lib/types";
import type { Business } from "@/services/api";

export type HomeMode = "setup" | "first_order" | "active";

export function resolveHomeMode(business: Business, setup: KioskSetupOverview, products: Product[], completedOrders: number): HomeMode {
  // A business that has already received completed orders is operating: show the full dashboard,
  // even if an optional setup step was never saved.
  if (completedOrders > 0) return "active";
  const status = setup.status;
  const payment = business.kiosk_order_settings?.default_payment_method || business.payment_summary?.default_payment_method;
  const needsOnlinePayment = Boolean(payment && !["cash", "counter", "pay_at_counter"].includes(payment));
  const essentialsComplete = status.businessComplete && status.menuComplete && status.kioskSettingsComplete && status.welcomeScreenComplete
    && products.some((product) => product.is_available && product.category_id)
    && (!needsOnlinePayment || Boolean(business.payment_summary?.enabled_methods?.length));
  return !essentialsComplete ? "setup" : completedOrders > 0 ? "active" : "first_order";
}
