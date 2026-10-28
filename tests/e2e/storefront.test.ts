/**
 * The storefront end to end, in a real browser, against the built site and the real server
 * (fake services, in-memory database): a cash order and a card order placed from the product
 * page through the drawer and the checkout, the English store, the layout at four widths,
 * and no script errors anywhere. (The step-by-step comparison with the original store is in
 * tests/parity/*.browser.parity.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Browser, Page } from "playwright";

const base = inject("baseUrl");
let browser: Browser;

beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function open(path: string, width = 390): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, locale: "ar" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // nothing leaves for a third party (the ad pixels' libraries)
  await page.route("**/*", (r) => (new URL(r.request().url()).host === new URL(base).host ? r.continue() : r.abort()));
  await page.goto(base + path, { waitUntil: "networkidle" });
  return { page, errors, close: () => ctx.close() };
}

async function addLargeBoxAndCheckout(page: Page): Promise<void> {
  const plus = page.locator(".prow button:text-is('+'):visible").first();
  if (!(await plus.isVisible().catch(() => false))) await page.locator("label.tier:visible").first().click();
  await page.locator(".prow button:text-is('+'):visible").first().click();
  await page.click("#add");
  await page.waitForTimeout(400);
  if (await page.locator("#drawer").isHidden().catch(() => true)) await page.click(".cart");
  await Promise.all([page.waitForURL(/checkout\.html/), page.click("#drawerPay")]);
  await page.waitForLoadState("networkidle");
}

async function fillForm(page: Page, phone: string): Promise<void> {
  await page.fill("#name", "سالم الحارثي");
  await page.selectOption("#city", { index: 1 });
  await page.fill("#region", "الخوير شارع 18");
  await page.fill("#phone", phone);
  await page.locator("#phone").blur();
}

async function readOrder(id: string): Promise<{ ok: boolean; status?: string }> {
  const r = await fetch(base + "/api/track?id=" + encodeURIComponent(id), { headers: { "x-country": "OM" } });
  return (await r.json()) as { ok: boolean; status?: string };
}

describe("the storefront in a browser", () => {
  it("a cash order: product page → drawer → checkout → placed, priced by the server", async () => {
    const { page, errors, close } = await open("/?country=OM");
    await addLargeBoxAndCheckout(page);
    await fillForm(page, "91234567");
    await page.click('[data-pay="cod"]');
    const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/order")), page.click("#confirm")]);
    const j = (await res.json()) as { ok: boolean; id: string; omr: number };
    expect(res.status()).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.id).toMatch(/^LM-\d{10}$/);
    // 25 OMR large box + 3 delivery (under the 30 threshold) + 1 cash fee
    expect(j.omr).toBe(29);
    await page.waitForSelector("#done", { state: "visible" });
    expect(await page.locator("#done").innerText()).toContain(j.id);
    expect((await readOrder(j.id)).ok).toBe(true);
    // the basket is emptied once the order is placed
    expect(await page.evaluate(() => sessionStorage.getItem("lm_cart") || "[]")).toBe("[]");
    expect(errors).toEqual([]);
    await close();
  });

  it("a card order: to the (fake) Thawani page, paid, back to a confirmed order", async () => {
    const { page, errors, close } = await open("/?country=OM");
    await addLargeBoxAndCheckout(page);
    await fillForm(page, "91234568");
    await page.click('[data-pay="card"]');
    await Promise.all([page.waitForURL(/\/__fake\/thawani\/pay\//, { timeout: 20000 }), page.click("#confirm")]);
    expect(await page.locator("body").innerText()).toMatch(/28(\.000)? OMR/);
    await Promise.all([page.waitForURL(/checkout\.html\?paid=/, { timeout: 20000 }), page.click("button.pay")]);
    await page.waitForSelector("#done", { state: "visible", timeout: 20000 });
    expect(await page.locator("#done").innerText()).toMatch(/LM-\d{10}/);
    expect(errors).toEqual([]);
    await close();
  });

  it("a card payment cancelled at the gateway keeps the basket, with cash still on offer", async () => {
    const { page, errors, close } = await open("/?country=OM");
    await addLargeBoxAndCheckout(page);
    await fillForm(page, "91234569");
    await page.click('[data-pay="card"]');
    await Promise.all([page.waitForURL(/\/__fake\/thawani\/pay\//, { timeout: 20000 }), page.click("#confirm")]);
    await Promise.all([page.waitForURL(/checkout\.html\?cancelled=/, { timeout: 20000 }), page.click("button.cancel")]);
    await page.waitForLoadState("networkidle");
    const basket = await page.evaluate(() => JSON.parse(sessionStorage.getItem("lm_cart") || "[]") as unknown[]);
    expect(basket.length).toBeGreaterThan(0);
    expect(await page.locator('[data-pay="cod"]').isVisible()).toBe(true);
    expect(errors).toEqual([]);
    await close();
  });

  it("the English store: left to right, English words, prices from the same catalogue", async () => {
    const { page, errors, close } = await open("/en/?country=AE");
    expect(await page.getAttribute("html", "dir")).toBe("ltr");
    expect(await page.getAttribute("html", "lang")).toBe("en");
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/[؀-ۿ]{4,}/); // no Arabic sentences on the English page
    expect(text).toMatch(/Scented Salalah Frankincense/);
    expect(text).toMatch(/UAE/);
    expect(errors).toEqual([]);
    await close();
  });

  for (const width of [320, 390, 768, 1366]) {
    it(`no sideways scroll and no script errors at ${width}px (AR + EN, product + checkout + privacy + 404)`, async () => {
      for (const path of ["/", "/checkout.html", "/privacy.html", "/no-such-page", "/en/", "/en/checkout.html", "/en/privacy.html"]) {
        const { page, errors, close } = await open(path, width);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, path).toBeLessThanOrEqual(0);
        expect(errors, path).toEqual([]);
        await close();
      }
    });
  }

  it("the security headers are on every page", async () => {
    const r = await fetch(base + "/");
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'self'/);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const a = await fetch(base + "/admin/");
    expect(a.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(a.headers.get("cache-control")).toBe("no-store");
  });
});
