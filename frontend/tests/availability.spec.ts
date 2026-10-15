import { expect, test } from "@playwright/test";
import { comboAvailability } from "../src/features/dashboard/kiosk-experience/AvailabilityPage";
import type { Combo } from "../src/lib/types";

const combo = {
  id: "combo", business_id: "business", name: "Lunch Combo", price: 12, status: "shown", sort_order: 0,
  availability_type: "always", available_days: [], tags: [], sections: [{ id: "drinks", combo_id: "combo", title: "Drinks", section_type: "included_items", required: true, min_select: 1, max_select: 1, sort_order: 0, options: [{ id: "cola-option", combo_id: "combo", section_id: "drinks", source_type: "existing_item", existing_item_id: "cola", quantity: 1, price_impact: 0, default_selected: true, removable: false, visible: true, sort_order: 0 }] }],
} as Combo;

test("combo availability follows required selection groups", () => {
  expect(comboAvailability(combo, new Map([["cola", false]]))).toEqual({ available: false, reason: "No available drinks selection" });
  expect(comboAvailability(combo, new Map([["cola", true]])).available).toBe(true);
});
