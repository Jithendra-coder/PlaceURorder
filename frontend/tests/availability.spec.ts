import { expect, test } from "@playwright/test";
import { comboAvailability } from "../src/features/dashboard/kiosk-experience/AvailabilityPage";
import { getStoreAvailability } from "../src/lib/store-schedule";
import type { Combo } from "../src/lib/types";

const combo = {
  id: "combo", business_id: "business", name: "Lunch Combo", price: 12, status: "shown", sort_order: 0,
  availability_type: "always", available_days: [], tags: [], sections: [{ id: "drinks", combo_id: "combo", title: "Drinks", section_type: "included_items", required: true, min_select: 1, max_select: 1, sort_order: 0, options: [{ id: "cola-option", combo_id: "combo", section_id: "drinks", source_type: "existing_item", existing_item_id: "cola", quantity: 1, price_impact: 0, default_selected: true, removable: false, visible: true, sort_order: 0 }] }],
} as Combo;

test("combo availability follows required selection groups", () => {
  expect(comboAvailability(combo, new Map([["cola", false]]))).toEqual({ available: false, reason: "No available drinks selection" });
  expect(comboAvailability(combo, new Map([["cola", true]])).available).toBe(true);
});

test("overnight store hours carry into the following local day", () => {
  const business = {
    id: "overnight-carry",
    is_active: true,
    timezone: "Asia/Kolkata",
    opening_time: "09:00",
    closing_time: "22:00",
    store_schedule: {
      weekly: {
        tuesday: { closed: false, slots: [{ open: "22:00", close: "02:00" }] },
        wednesday: { closed: false, slots: [{ open: "09:00", close: "17:00" }] },
      },
    },
  };

  expect(getStoreAvailability(business, new Date("2026-10-27T19:30:00Z")).isOpen).toBe(true);
});

test("overnight store hours do not start before opening on their configured day", () => {
  const business = {
    id: "overnight-no-early-open",
    is_active: true,
    timezone: "Asia/Kolkata",
    opening_time: "09:00",
    closing_time: "22:00",
    store_schedule: {
      weekly: {
        tuesday: { closed: false, slots: [{ open: "09:00", close: "17:00" }] },
        wednesday: { closed: false, slots: [{ open: "22:00", close: "02:00" }] },
      },
    },
  };

  expect(getStoreAvailability(business, new Date("2026-10-27T19:30:00Z")).isOpen).toBe(false);
});

test("legacy overnight store hours stay open through their closing time", () => {
  const business = {
    id: "legacy-overnight-carry",
    is_active: true,
    timezone: "Asia/Kolkata",
    opening_time: "22:00",
    closing_time: "02:00",
    store_schedule: { enabled: false },
  };

  expect(getStoreAvailability(business, new Date("2026-10-27T19:30:00Z")).isOpen).toBe(true);
});

test("a closed date override prevents the previous day's overnight carry", () => {
  const business = {
    id: "overnight-closed-override",
    is_active: true,
    timezone: "Asia/Kolkata",
    opening_time: "09:00",
    closing_time: "22:00",
    store_schedule: {
      weekly: {
        tuesday: { closed: false, slots: [{ open: "22:00", close: "02:00" }] },
      },
      overrides: [{ id: "closed-wednesday", date: "2026-10-28", label: "Holiday", closed: true, slots: [] }],
    },
  };

  expect(getStoreAvailability(business, new Date("2026-10-27T19:30:00Z")).isOpen).toBe(false);
});

test("the previous date override can define overnight store hours", () => {
  const business = {
    id: "overnight-previous-override",
    is_active: true,
    timezone: "Asia/Kolkata",
    opening_time: "09:00",
    closing_time: "22:00",
    store_schedule: {
      weekly: {
        tuesday: { closed: true, slots: [] },
        wednesday: { closed: false, slots: [{ open: "09:00", close: "17:00" }] },
      },
      overrides: [{ id: "open-tuesday", date: "2026-10-27", label: "Late service", closed: false, slots: [{ open: "22:00", close: "02:00" }] }],
    },
  };

  expect(getStoreAvailability(business, new Date("2026-10-27T19:30:00Z")).isOpen).toBe(true);
});
