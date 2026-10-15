import { expect, test } from "@playwright/test";
import { filterMenuProducts, formatMenuPrice, itemAttentionIssues } from "../src/features/dashboard/kiosk-experience/ManageMenuPage";
import type { Product } from "../src/lib/types";

const rows = [
  { id: "burger", name: "Classic Burger", sku: "BG-1", price: 12, category_id: "mains", menu_status: "shown", item_type: "non_veg", primary_image_path: "/burger.png", is_available: true, track_stock: true, stock_quantity: 0 },
  { id: "salad", name: "Garden Salad", sku: "VG-2", price: 8, category_id: null, menu_status: "draft", item_type: "veg", is_available: true, track_stock: false },
] as Product[];

test("Manage Menu combines search, category, status, and dietary filters", () => {
  expect(filterMenuProducts(rows, "bg-1", "mains", "shown", "non_veg").map((item) => item.id)).toEqual(["burger"]);
  expect(filterMenuProducts(rows, "", "all", "draft", "veg").map((item) => item.id)).toEqual(["salad"]);
  expect(filterMenuProducts(rows, "pizza", "all", "all", "all")).toEqual([]);
  expect(filterMenuProducts(rows, "", "all", "all", "all", "unavailable").map((item) => item.id)).toEqual(["burger"]);
  expect(filterMenuProducts(rows, "", "all", "all", "all", "attention").map((item) => item.id)).toEqual(["salad"]);
  expect(itemAttentionIssues(rows[1])).toEqual(["Missing category", "Missing image", "Draft changes"]);
  expect(formatMenuPrice(199, "INR")).toBe("₹199.00");
});
