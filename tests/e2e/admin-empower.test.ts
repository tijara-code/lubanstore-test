/**
 * The Empower tab end to end, against the real server and the fake Omniful: the Waiting list
 * (an order opened to what the warehouse will be told, edited before the push), Push, Push all
 * (every order, call after call), the auto push switch (asked first), Pushed (searched, opened,
 * taken off Empower), Check statuses, a route, the SKU codes, and the page at 360/768/1366.
 * Ported UI checks of test-v189, test-v316, test-v338, test-v402, test-empower (panel).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { adminGet, adminPost, BASE, openBrowser, pageWidth, runTag, seedOrders, signIn, type Session } from "./admin-helpers";

let s: Session;
let page: Page;
const tag = runTag();
let ids: string[] = [];
const LINE = [{ itemId: "oud-large", scent: "عود الافندر", size: "كبير 300 جم", price: 25, qty: 1 }];
const toast = async (re: RegExp) => expect.poll(() => page.textContent(".toast"), { timeout: 15000 }).toMatch(re);
const row = (id: string) => page.locator(`.omf-wait tbody tr.row:has(td.id:text-is("${id}"))`);

async function openTab() {
  await page.goto(BASE() + "/admin/#empower");
  await page.reload();
  await page.waitForSelector(".omf-wait");
}

beforeAll(async () => {
  s = await openBrowser({ ip: "198.51.100.62" });
  page = s.page;
  await signIn(page);
  await adminPost(page, "PUT", "/empower/skus", { skus: { "oud-large": "LM3001", "amber-large": "LM3002", "lemon-large": "LM3003", bundle: "LM5001" } });
  ids = await seedOrders(page, [
    { name: tag + " One", phone: "+968 91234567", city: "مسقط", region: "الخوير", items: LINE, sub: 25, ship: 3, codFee: 1, total: 29, omr: 29 },
    { name: tag + " Two", phone: "+968 92345678", city: "صحار", region: "x", items: LINE, sub: 25, ship: 3, codFee: 1, total: 29, omr: 29 },
    { name: tag + " Three", phone: "+968 93456789", city: "مسقط", region: "روي", items: LINE, sub: 25, ship: 3, codFee: 1, total: 29, omr: 29 },
    { name: tag + " Four", phone: "+968 94567890", city: "مسقط", region: "", items: LINE, sub: 25, ship: 3, codFee: 1, total: 29, omr: 29 },
  ]);
});
afterAll(async () => {
  await adminPost(page, "PUT", "/empower/auto", { on: false });
  await s.browser.close();
});

describe("waiting to be pushed", () => {
  it("lists the new orders; one opens to the order with its SKUs and the details check", async () => {
    await openTab();
    await row(ids[0]!).waitFor();
    expect(await row(ids[3]!).textContent()).toMatch(/Check: area/);
    await row(ids[0]!).locator("td.id").click();
    const det = page.locator(`#omf-det-${ids[0]}`);
    await expect.poll(() => det.textContent()).toMatch(/LM3001/);
    expect(await det.textContent()).toMatch(/Collect29 OMR on delivery/);
  });

  it("the area is added inside the row (Edit customer), before the push", async () => {
    await openTab();
    await row(ids[3]!).locator("td.id").click();
    const det = page.locator(`#omf-det-${ids[3]}`);
    await det.locator("button[aria-label^='Edit the customer']").click();
    await det.locator(".cust-edit label:has-text('Area') input").fill("روي");
    await det.locator(".cust-edit button:has-text('Save')").click();
    await toast(/Customer details saved/);
    await expect.poll(() => row(ids[3]!).textContent()).not.toMatch(/Check: area/);
  });

  it("Push sends one order: it leaves Waiting and is in Pushed", async () => {
    await openTab();
    await row(ids[0]!).locator("button:has-text('Push')").click();
    await toast(new RegExp(ids[0] + " sent to Empower · Preparing"));
    await expect.poll(() => row(ids[0]!).count()).toBe(0);
    await page.fill("input[aria-label='Search what was pushed']", ids[0]!);
    await expect.poll(() => page.locator(".omf-pushed tbody tr.row").count()).toBe(1);
  });

  it("Push all asks, then sends every order on the list", async () => {
    await openTab();
    await row(ids[1]!).waitFor();
    await page.click("button:has-text('Push all')");
    await expect.poll(() => page.textContent("[role=dialog]")).toMatch(/Push all \d+ waiting orders? to Omniful\?/);
    await page.click("[role=dialog] button:has-text('Push all')");
    await toast(/\d+ pushed · nothing waiting/);
    expect(await row(ids[1]!).count()).toBe(0);
    const w = await adminGet<{ orders: unknown[] }>(page, "/empower/waiting");
    expect(w.orders).toHaveLength(0);
  });

  it("Auto push asks before it goes on, and says what it does", async () => {
    await openTab();
    await page.click("button:has-text('Auto push: Off')");
    await page.click("[role=dialog] button:has-text('Turn on')");
    await toast(/Auto push on/);
    await expect.poll(() => page.textContent(".omf-auto-note")).toMatch(/On: complete website orders go to Empower/);
    expect((await adminGet<{ on: boolean }>(page, "/empower/auto")).on).toBe(true);
    await page.click("button:has-text('Auto push: On')");
    await toast(/Auto push off/);
  });
});

describe("pushed to Omniful", () => {
  it("a pushed order opens to Omniful's record; Check statuses; Take off Empower puts it back in Waiting", async () => {
    await openTab();
    await page.fill("input[aria-label='Search what was pushed']", ids[2]!);
    await page.locator(".omf-pushed tbody tr.row td.id").first().click();
    const det = page.locator(".omf-pushed .det");
    await expect.poll(() => det.textContent()).toMatch(/On Omniful/);
    expect(await det.textContent()).toMatch(/Their ref/);
    await page.click("button:has-text('Check statuses')");
    await toast(/Omniful: \d+ checked/);
    await det.locator("button:has-text('Take off Empower')").click();
    await page.click("[role=dialog] button:has-text('Take off Empower')");
    await toast(new RegExp("(" + ids[2] + " taken off Empower|Empower mark removed from " + ids[2] + ")"));
    await openTab();
    await row(ids[2]!).waitFor();
  });
});

describe("routes and SKU codes", () => {
  it("a market's route is a radio, saved at once", async () => {
    await openTab();
    await page.click("#omfRouteCard .fold-btn");
    await page.locator("[aria-label='Who carries Kuwait'] label:has-text('Shipped by hand')").click();
    await toast(/KW now goes by hand/);
    await page.locator("[aria-label='Who carries Kuwait'] label:has-text('Empower')").click();
    await toast(/KW now goes to Empower/);
  });

  it("the SKU codes are shown and saved", async () => {
    await openTab();
    await page.click("#omfSkuCard .fold-btn");
    const box = page.locator("input[aria-label^='Omniful SKU for'][aria-label*='Large']").first();
    await box.waitFor();
    await page.click("button:has-text('Save SKU codes')");
    await toast(/SKU codes saved/);
    const j = await adminGet<{ skus: Record<string, string> }>(page, "/empower/skus");
    expect(j.skus["oud-large"]).toBe("LM3001");
  });
});

describe("the page", () => {
  it("never scrolls sideways at 360, 768 and 1366 with rows open; no console errors", async () => {
    for (const w of [1366, 768, 360]) {
      await page.setViewportSize({ width: w, height: 900 });
      await openTab();
      await page.locator(".omf-pushed tbody tr.row td.id").first().click();
      await page.waitForSelector(".omf-pushed .det");
      for (const id of ["omfCard", "omfRouteCard", "omfSkuCard"]) await page.click(`#${id} .fold-btn`);
      const pw = await pageWidth(page);
      expect(pw.scroll, "empower at " + w).toBeLessThanOrEqual(pw.client);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    expect(s.errors).toEqual([]);
  });
});
