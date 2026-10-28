/**
 * The Analytics tab end to end: events sent through the real collector (/api/ev, with the
 * edge's country and city headers) show in Live now (the map's outlines loaded, the pin, the
 * visitor's line) and in the figures; the range buttons and the calendar ask the server for the
 * right window; the filters ride along; the reset asks and clears; no sideways scroll; no
 * console errors. Ported UI checks of test-v338-live, test-v408, test-v411, test-v446, test-v209.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { adminPost, BASE, openBrowser, pageWidth, signIn, type Session } from "./admin-helpers";

let s: Session;
let page: Page;

async function ev(name: string, sid: string, extra: Record<string, unknown> = {}) {
  const geo = Buffer.from(JSON.stringify({ city: "Riyadh", latitude: 24.7136, longitude: 46.6753, country: { code: "SA" } })).toString("base64");
  const r = await page.request.post(BASE() + "/api/ev", {
    headers: { Origin: BASE(), "Content-Type": "application/json", "x-nf-country": "SA", "x-nf-geo": geo, "x-forwarded-for": "203.0.113.77" },
    data: { name, sid, ...extra },
  });
  expect(r.status()).toBe(204);
}

beforeAll(async () => {
  s = await openBrowser({ ip: "198.51.100.63" });
  page = s.page;
  await signIn(page);
  // the e2e server is shared by every suite: start from no analytics, so the counts are this suite's own
  await adminPost(page, "POST", "/analytics/reset", { confirm: "events" });
  await ev("session_start", "e2eLive01", { land: { search: "?utm_source=instagram&utm_medium=paid_social", referrer: "" } });
  await ev("page_view", "e2eLive01", { item: "home" });
  await ev("offer_add", "e2eLive01", { item: "bundle" });
});
afterAll(async () => {
  await s.browser.close();
});

describe("analytics", () => {
  it("Live now: 1h by default, the visitor on the map (outlines loaded) and in the list at the furthest step", async () => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/admin/analytics/")) asked.push(r.url());
    });
    await page.goto(BASE() + "/admin/#analytics");
    await page.reload();
    await page.waitForSelector(".live-row");
    expect(await page.getAttribute("[data-live-min='60']", "aria-pressed")).toBe("true");
    expect(asked.some((u) => /analytics\/live\?minutes=60/.test(u))).toBe(true);
    await expect.poll(() => page.$$eval(".live-map svg path", (p) => p.length)).toBeGreaterThan(100);
    expect(await page.textContent(".live-row .w")).toBe("Riyadh, Saudi Arabia");
    expect(await page.textContent(".live-row .d")).toMatch(/^In the cart · added the bundle/);
    expect(await page.getAttribute(".live-pin", "aria-label")).toBe("Riyadh, Saudi Arabia: 1 visitor, furthest in the cart");
    await page.hover(".live-pin");
    expect(await page.textContent(".live-tip")).toMatch(/Riyadh, Saudi Arabia1 visitor1In the cart/);
    await page.click("[data-live-min='today']");
    await expect.poll(() => asked.some((u) => /analytics\/live\?minutes=today/.test(u))).toBe(true);
  });

  it("the figures; the range buttons and the calendar ask for their window; the filters ride along", async () => {
    await page.waitForSelector(".kpi");
    expect(await page.textContent(".kpi:has-text('Sessions') b")).toBe("1");
    expect(await page.textContent(".kpi:has-text('Carts started') b")).toBe("1");
    expect(await page.textContent(".stats-stamp")).toMatch(/^Last 7 days · \d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/);
    const summary = page.waitForRequest((r) => /analytics\/summary\?range=30/.test(r.url()));
    await page.click(".stats-bar .seg button:has-text('30 days')");
    await summary;
    await expect.poll(() => page.textContent(".stats-stamp")).toMatch(/^Last 30 days/);
    const filtered = page.waitForRequest((r) => /analytics\/summary\?range=30&country=SA/.test(r.url()));
    await page.selectOption("select[aria-label=Country]", "SA");
    await filtered;
    await expect.poll(() => page.textContent(".stats-stamp")).toMatch(/· filtered$/);
    await page.click("button[aria-label='Clear filters']");
    // the calendar: two days picked release the buttons
    await page.click(".stats-bar .drp-btn");
    const days = page.locator(".drp-pop .drp-days button:not([disabled])");
    const n = await days.count();
    await days.nth(n - 3).click();
    const custom = page.waitForRequest((r) => /analytics\/summary\?from=\d{4}-\d{2}-\d{2}&to=/.test(r.url()));
    await days.nth(n - 1).click();
    await custom;
    await expect.poll(() => page.textContent(".stats-stamp")).toMatch(/^Custom · 3 days/);
    expect(await page.$$eval(".stats-bar > .seg button[aria-pressed=true]", (b) => b.length)).toBe(0);
  });

  it("no sideways scroll at 360, 768 and 1366; no console errors", async () => {
    for (const w of [360, 768, 1366]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(200);
      const { scroll, client } = await pageWidth(page);
      expect(scroll, "at " + w).toBeLessThanOrEqual(client);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    expect(s.errors).toEqual([]);
  });

  it("Reset analytics data asks, then clears every event", async () => {
    await page.click(".stats-foot button:has-text('Reset analytics data')");
    await page.click("[role=dialog] button:has-text('Delete every event')");
    await expect.poll(() => page.textContent(".toast")).toBe("Analytics cleared");
    await page.click(".stats-bar .seg button:has-text('7 days')");
    await expect.poll(() => page.textContent(".kpi:has-text('Sessions') b")).toBe("0");
  });
});
