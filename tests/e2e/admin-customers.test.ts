/**
 * The Customers tab end to end: two orders under one phone (written differently) are one
 * customer with both counted; the band pill; search; a customer opened shows their orders, which
 * open on the Orders tab; the note and tags are saved and shown after a reload; no sideways scroll.
 * Ported UI checks of test-customers (one person per phone, bands, filters), test-admin-tweaks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { BASE, openBrowser, pageWidth, runTag, seedOrders, signIn, type Session } from "./admin-helpers";

let s: Session;
let page: Page;
const tag = runTag();
let ids: string[] = [];

beforeAll(async () => {
  s = await openBrowser({ ip: "198.51.100.62" });
  page = s.page;
  await signIn(page);
  ids = await seedOrders(page, [
    { name: tag + " Muna", phone: "+968 9345 6781", phoneKey: "96893456781", city: "مسقط", region: "روي", total: 20, omr: 20, status: "done", paymentStatus: "paid" },
    { name: tag + " Muna", phone: "93456781", phoneKey: "96893456781", city: "مسقط", region: "روي", total: 12, omr: 12 },
    { name: tag + " Ali", phone: "+968 9345 6799", phoneKey: "96893456799", city: "صحار", region: "x", total: 5, omr: 5, status: "void" },
  ]);
});
afterAll(async () => {
  await s.browser.close();
});

describe("the customers", () => {
  it("one row per phone; orders and spend added up; High from 26 OMR; a cancelled order lists the customer with nothing spent", async () => {
    await page.goto(BASE() + "/admin/#customers?q=" + tag);
    await page.reload();
    const muna = page.locator('tr.row[data-cust="96893456781"]');
    await muna.waitFor();
    expect(await page.$$eval("tr.row", (r) => r.length)).toBe(2);
    expect(await muna.locator(".c-spend").textContent()).toBe("32");
    expect(await muna.locator(".pill").first().textContent()).toBe("High");
    const ali = page.locator('tr.row[data-cust="96893456799"]');
    expect(await ali.locator(".c-spend").textContent()).toBe("0");
    expect(await ali.locator(".pill").count()).toBe(0);
  });

  it("opened: their orders (into Orders); the note and tags saved and shown after a reload", async () => {
    await page.click('tr.row[data-cust="96893456781"] .crm-name');
    const dlg = page.locator("[role=dialog]");
    await expect.poll(() => dlg.locator(".cust-orders .mini").count()).toBe(2);
    await dlg.locator("textarea").fill("يفضّل العنبر");
    await dlg.locator(".cust-note input").fill("VIP, gift");
    await dlg.locator("button:has-text('Save note and tags')").click();
    await expect.poll(() => page.textContent(".toast")).toBe("Saved. Orders untouched.");
    await page.keyboard.press("Escape");
    await page.reload();
    const muna = page.locator('tr.row[data-cust="96893456781"]');
    await muna.waitFor();
    expect(await muna.locator(".pill").allTextContents()).toEqual(["High", "vip", "gift"]);
    expect(await muna.locator("em.sub").first().textContent()).toBe("يفضّل العنبر");
    await page.click('tr.row[data-cust="96893456781"] .crm-name');
    await page.locator("[role=dialog] .cust-orders .mini").first().click();
    await page.waitForSelector("tr.detail .timeline");
    expect(page.url()).toMatch(/#orders\?q=LM-/);
    expect(ids.some((id) => page.url().includes(id))).toBe(true);
  });

  it("no sideways scroll at 360, 768 and 1366", async () => {
    await page.goto(BASE() + "/admin/#customers");
    await page.waitForSelector("tr.row");
    for (const w of [360, 768, 1366]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(150);
      const { scroll, client } = await pageWidth(page);
      expect(scroll, "at " + w).toBeLessThanOrEqual(client);
    }
    expect(s.errors).toEqual([]);
  });
});
