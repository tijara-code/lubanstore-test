/**
 * The Payments tab end to end against the fake Thawani: a card order paid through the real
 * till and the emulator's hosted page shows Settled with its card and fee; an unpaid attempt
 * ("inProccess") shows Pending, not Failed; a row's detail and Ask Thawani (nothing written); a
 * refund (reason required) cancels and refunds the order; mark paid by hand with an id Thawani
 * does not know is refused in words; the page never scrolls sideways.
 * Ported UI checks of test-payments, test-admin-tweaks (Payments), test-v446, test-v447.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { OrderDetailAnswer } from "../../src/shared/admin/api";
import { adminGet, BASE, openBrowser, pageWidth, runTag, signIn, type Session } from "./admin-helpers";

let s: Session;
let page: Page;
const tag = runTag();
let paidId = "";
let openId = "";

async function cardOrder(name: string, phone: string): Promise<{ id: string; session_id: string }> {
  const r = await page.request.post(BASE() + "/api/pay/session", {
    headers: { Origin: BASE(), "Content-Type": "application/json" },
    data: {
      order: {
        name, phone, country: "عمان", countryCode: "OM", city: "مسقط", region: "الخوير", pay: "card",
        items: [{ scent: "عود الافندر", size: "كبير", price: 25, qty: 2, itemId: "oud-large" }],
        cur: "OMR", ship: 0, codFee: 0, total: 50, omr: 50, omrRate: 1, dedupeId: crypto.randomUUID(),
      },
    },
  });
  const j = (await r.json()) as { ok: boolean; id: string; session_id: string };
  if (!j.ok) throw new Error("till refused: " + JSON.stringify(j));
  return j;
}

beforeAll(async () => {
  s = await openBrowser({ ip: "198.51.100.61" });
  page = s.page;
  await signIn(page);
  const paid = await cardOrder(tag + " Paid", "+968 91112223");
  paidId = paid.id;
  // the emulator's hosted page: Pay (settles through the signed webhook)
  await page.request.post(BASE() + "/__fake/thawani/pay/" + paid.session_id + "/pay", { maxRedirects: 0 });
  openId = (await cardOrder(tag + " Open", "+968 91112224")).id;
});
afterAll(async () => {
  await s.browser.close();
});

const toast = async (re: RegExp) => expect.poll(() => page.textContent(".toast"), { timeout: 10000 }).toMatch(re);
const rowOf = (id: string) => page.locator(`tr.row[data-pay="${id}"]`);

describe("the payments", () => {
  it("a paid card order is Settled with its card and fee; an open attempt is Pending (\"inProccess\"), never Failed", async () => {
    await page.goto(BASE() + "/admin/#payments?q=" + tag);
    await page.reload();
    await rowOf(paidId).waitFor();
    await expect.poll(() => rowOf(paidId).locator(".pill").textContent()).toBe("Settled");
    expect(await rowOf(paidId).textContent()).toMatch(/XXXX XXXX XXXX 4242/); // the masked card
    expect(await rowOf(openId).locator(".pill").textContent()).toBe("Pending");
    expect(await page.textContent(".kpi:has-text('Failed') b")).toBe("0");
    expect(await page.textContent(".kpi:has-text('Transactions') b")).toBe("2");
    // the states filter
    await page.click(".pay-bar .seg button:has-text('Pending')");
    await expect.poll(() => page.$$eval("tr.row", (r) => r.length)).toBe(1);
    expect(page.url()).toContain("state=pending");
    await page.click(".pay-bar .seg button:has-text('All')");
  });

  it("the detail: session, invoice, payment id, fee and net, the stored payload; Ask Thawani changes nothing", async () => {
    await rowOf(paidId).locator("td.p-total").click();
    const det = page.locator(`tr.detail[data-pay-detail="${paidId}"]`);
    await det.waitFor();
    const text = (await det.textContent()) || "";
    expect(text).toMatch(/Sessioncheckout_/);
    expect(text).toMatch(/Payment id\S+/);
    expect(text).toMatch(/Net to the bank\d/);
    await det.locator("summary:has-text('Gateway record')").click();
    await expect.poll(() => det.locator("pre").first().textContent()).toMatch(/session/);
    const before = await adminGet<OrderDetailAnswer>(page, "/orders/" + paidId);
    await det.locator("button:has-text('Ask Thawani')").click();
    await toast(/Thawani answered/);
    await det.locator("summary:has-text(\"Thawani's answer\")").waitFor();
    const after = await adminGet<OrderDetailAnswer>(page, "/orders/" + paidId);
    expect(after.order.updatedAt).toBe(before.order.updatedAt);
  });

  it("refund: a reason is required; the order becomes Cancelled and Refunded", async () => {
    await rowOf(paidId).locator("button:has-text('Refund')").first().click();
    const dlg = page.locator("[role=dialog]");
    await dlg.locator("button:has-text('Refund 50 OMR')").click();
    expect(await dlg.locator("[role=alert]").textContent()).toBe("A refund needs a reason.");
    await dlg.locator("textarea").fill("Customer changed their mind");
    await dlg.locator("button:has-text('Refund 50 OMR')").click();
    await toast(new RegExp("Refunded 50 OMR · order " + paidId + " cancelled and marked refunded"));
    await expect.poll(() => rowOf(paidId).locator(".pill").textContent(), { timeout: 10000 }).toBe("Refunded");
    const d = await adminGet<OrderDetailAnswer>(page, "/orders/" + paidId);
    expect([d.order.status, d.order.paymentStatus, d.order.refunded]).toEqual(["void", "refunded", true]);
  });

  it("mark paid by hand: an id Thawani does not know is refused in words, nothing changes", async () => {
    await rowOf(openId).locator("td.p-total").click();
    const det = page.locator(`tr.detail[data-pay-detail="${openId}"]`);
    await det.locator("button:has-text('Mark paid by hand')").click();
    const dlg = page.locator("[role=dialog]");
    await dlg.locator("input").fill("pay_000000000001");
    await dlg.locator("button:has-text('Check with Thawani')").click();
    await expect.poll(() => dlg.locator("[role=alert]").textContent()).toBe("Thawani has no payment with that id.");
    await page.keyboard.press("Escape");
    const d = await adminGet<OrderDetailAnswer>(page, "/orders/" + openId);
    expect(d.order.paymentStatus).toBe("unpaid");
  });

  it("no sideways scroll at 360, 768 and 1366", async () => {
    for (const w of [360, 768, 1366]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(150);
      const { scroll, client } = await pageWidth(page);
      expect(scroll, "at " + w).toBeLessThanOrEqual(client);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    // the one 404 is the refusal asked for above (Thawani has no such payment)
    expect(s.errors.filter((e) => !/status of 404/.test(e))).toEqual([]);
  });
});
