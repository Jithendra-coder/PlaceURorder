import { expect, test } from "@playwright/test";

test("landing kiosk stays pinned through the order demo, then releases", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("#kioskChassis").waitFor();

  const range = await page.evaluate(() => {
    const kiosk = document.querySelector<HTMLElement>(".hero-kiosk-col")!;
    const parent = kiosk.parentElement!;
    const parentRect = parent.getBoundingClientRect();
    const stickyTop = Number.parseFloat(getComputedStyle(kiosk).top);
    const parentTop = parentRect.top + window.scrollY;
    return {
      start: parentTop + kiosk.offsetTop - stickyTop,
      end: parentRect.bottom + window.scrollY - stickyTop - kiosk.offsetHeight,
      stickyTop,
    };
  });

  expect(range.end).toBeGreaterThan(range.start);
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), range.start + (range.end - range.start) * 0.5);
  await expect.poll(() => page.locator(".hero-kiosk-col").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(Math.round(range.stickyTop));
  await expect.poll(() => page.locator(".story-stage-card.is-active").count()).toBeGreaterThan(0);

  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), range.end);
  await expect(page.locator("#viewSuccess")).toHaveClass(/active/);
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), range.end + 50);
  await expect.poll(() => page.locator(".hero-kiosk-col").evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(range.stickyTop - 10);
});
