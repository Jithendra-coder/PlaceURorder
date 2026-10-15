import { expect, test } from "@playwright/test";
import { filterPromotions, promotionStatus } from "../src/features/dashboard/kiosk-experience/KioskExperiencePage";
import type { PromotionRecord } from "../src/lib/api";

const rows = [
  { id: "active", name: "Burger Weekend", status: "active", discount_type: "percentage", discount_value: 20 },
  { id: "draft", name: "Chef Pick", status: "draft", discount_type: "label", discount_value: 0 },
  { id: "scheduled", name: "Dinner Deal", status: "scheduled", discount_type: "fixed", discount_value: 100 },
] as PromotionRecord[];

test("promotion status and filters keep real states deterministic", () => {
  expect(promotionStatus(rows[0])).toBe("active");
  expect(promotionStatus(rows[1])).toBe("draft");
  expect(filterPromotions(rows, "burger", "all").map((row) => row.id)).toEqual(["active"]);
  expect(filterPromotions(rows, "", "scheduled").map((row) => row.id)).toEqual(["scheduled"]);
});
