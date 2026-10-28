/**
 * The Orders tab end to end: the list, its filters and search, opening an order, the status
 * flow (forward, and back with a confirmation), tracking by hand, editing the customer and
 * the items, a WhatsApp order typed in, a push to Empower (the fake Omniful), the flag and the
 * bulk bar, the Aramex link (never for Oman), the WhatsApp reminder's links, the CSV export.
 * Ported UI checks of test-admin-boot/-tweaks/-batch, test-empower (panel), v402, v408,
 * v418/v419, test-resume (message), test-order-items (panel).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { adminGet, adminPost, BASE, openBrowser, runTag, seedOrders, signIn, type Session } from "./admin-helpers";
import type { OrderDetailAnswer } from "../../src/shared/admin/api";

let s: Session;
let page: Page;
const tag = runTag();
let ids: Record<string, string> = {};

const OM_LINE = [{ itemId: "oud-large", scent: "عود الافندر", size: "كبير 300 جم", price: 25, qty: 1 }];

beforeAll(async () => {
  s = await openBrowser({ ip: "198.51.100.33" });
  page = s.page;
  await signIn(page);
  const list = await seedOrders(page, [
    { name: tag + " Salim", phone: "+968 91234567", city: "مسقط", region: "الخوير", items: OM_LINE, sub: 25, ship: 3, codFee: 1, total: 29, omr: 29 },
    { name: tag + " Fatma", countryCode: "AE", country: "الإمارات", cur: "AED", phone: "+971 501234567", city: "دبي", region: "Marina", total: 290, omr: 30.34, status: "ship", shipment: { awb: "44123456789", status: "picked_up" } },
    { name: tag + " Muna", phone: "+968 92345678", city: "صحار", region: "x", status: "ship", shipment: { awb: "44999000111", status: "picked_up" } },
    { name: tag + " Layla", countryCode: "AE", country: "الإمارات", cur: "AED", phone: "+971 509876543", city: "دبي", region: "JLT", pay: "card", status: "pending", paymentStatus: "unpaid", total: 250, omr: 26.175, amountBaisa: 26175 },
    { name: tag + " Hamed", phone: "+968 93456789", city: "مسقط", region: "روي", items: OM_LINE, sub: 25, ship: 3, codFee: 1, total: 29, omr: 29 },
    { name: tag + " Push", phone: "+968 94567890", city: "مسقط", region: "روي", items: OM_LINE, sub: 25, ship: 3, codFee: 1, total: 29, omr: 29 },
    { name: tag + " Bulk1", phone: "+968 95678901", city: "مسقط", region: "روي" },
    { name: tag + " Bulk2", phone: "+968 96789012", city: "مسقط", region: "روي" },
  ]);
  ids = { salim: list[0]!, fatma: list[1]!, muna: list[2]!, layla: list[3]!, hamed: list[4]!, push: list[5]!, bulk1: list[6]!, bulk2: list[7]! };
});
afterAll(async () => {
  await s.browser.close();
});

/** Orders, searched for one order (by number), its row opened. */
async function openOrder(id: string) {
  await page.goto(BASE() + "/admin/#orders?q=" + id);
  await page.reload();
  await page.waitForSelector(`tr.row[data-row="${id}"]`);
  if (!(await page.$(`tr.detail[data-detail="${id}"]`))) await page.click(`tr.row[data-row="${id}"] td.total`);
  await page.waitForSelector(`tr.detail[data-detail="${id}"] .timeline`);
  return page.locator(`tr.detail[data-detail="${id}"]`);
}
const toast = async (re: RegExp) => expect.poll(() => page.textContent(".toast"), { timeout: 10000 }).toMatch(re);
const detailOf = (id: string) => adminGet<OrderDetailAnswer>(page, "/orders/" + id);

describe("the list", () => {
  it("search finds by name; the status filter (Empower's words) and the country filter narrow it; page 1 each time", async () => {
    await page.goto(BASE() + "/admin/#orders?page=1");
    await page.reload();
    await page.fill(".toolbar input[type=search]", tag);
    await expect.poll(() => page.url()).toContain("q=" + tag);
    await expect.poll(() => page.$$eval("tr.row", (r) => r.length)).toBe(8);
    await page.click(".msel-btn");
    await page.click(".msel-row:has-text('Shipped') input");
    await page.click(".msel-done");
    await expect.poll(() => page.$$eval("tr.row", (r) => r.length)).toBe(2);
    expect(await page.textContent(".msel-btn")).toBe("Shipped");
    await page.selectOption("select[aria-label=Country]", "AE");
    await expect.poll(() => page.$$eval("tr.row", (r) => r.map((x) => x.getAttribute("data-row")))).toEqual([ids.fatma]);
    // Empower parcel outside Oman: Aramex; the Oman parcel: no tracking button (ruling 21)
    expect(await page.getAttribute(`tr.row[data-row="${ids.fatma}"] a.trk`, "href")).toBe("https://www.aramex.com/track/results?ShipmentNumber=44123456789");
    await page.selectOption("select[aria-label=Country]", "OM");
    await page.waitForSelector(`tr.row[data-row="${ids.muna}"]`);
    expect(await page.$(`tr.row[data-row="${ids.muna}"] a.trk`)).toBeNull();
    // the pills: the status in Empower's words, the payment, Empower
    expect(await page.$$eval(`tr.row[data-row="${ids.muna}"] .pill`, (p) => p.map((x) => x.textContent))).toEqual(["Shipped", "Cash on delivery", "Empower"]);
  });

  it("the CSV export carries the list's filters", async () => {
    const href = (await page.getAttribute("a[download]", "href"))!;
    expect(href).toContain("country=OM");
    expect(href).toContain("status=ship");
    const r = await page.request.get(BASE() + href);
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text.split("\r\n")[0]).toMatch(/^Order,Placed \(Muscat\),Status/);
    expect(text).toContain(ids.muna);
    expect(text).not.toContain(ids.fatma);
  });
});

describe("one order", () => {
  it("opens with its customer, items, payment and history", async () => {
    const d = await openOrder(ids.salim);
    await expect.poll(() => d.textContent()).toContain(tag + " Salim");
    const text = (await d.textContent())!;
    expect(text).toContain("+968 91234567");
    expect(text).toContain("Governorate");
    expect(text).toContain("عود الافندر · كبير 300 جم × 1");
    expect(text).toContain("Cash on delivery");
    expect(text).toContain("Order placed");
    // the confirmation on WhatsApp: a wa.me link with the order's message
    const wa = (await d.locator("a:has-text('WhatsApp: Confirmation')").getAttribute("href"))!;
    expect(wa.startsWith("https://wa.me/96891234567?text=")).toBe(true);
    expect(decodeURIComponent(wa)).toContain("تم تأكيد طلبك وجاري تجهيزه.");
  });

  it("moves along the flow, and back only after a confirmation", async () => {
    let d = await openOrder(ids.salim);
    await d.locator(".flow button:has-text('Preparing')").click();
    await toast(/→ Preparing/);
    await expect.poll(async () => (await detailOf(ids.salim)).order.status).toBe("prep");
    d = await openOrder(ids.salim);
    await d.locator(".flow button:has-text('Shipped')").click();
    await toast(/→ Shipped/);
    d = await openOrder(ids.salim);
    await expect.poll(() => d.locator(".step.here").textContent()).toBe("Shipped");
    await d.locator(".flow button:has-text('New')").click();
    await page.waitForSelector("[role=dialog]:has-text('back')");
    await page.click("[role=dialog] button:has-text('Move back')");
    await toast(/→ New/);
    const det = await detailOf(ids.salim);
    expect(det.order.status).toBe("new");
    expect(det.events.filter((e) => e.kind === "status").map((e) => e.from + ">" + e.to)).toEqual(["new>prep", "prep>ship", "ship>new"]);
  });

  it("is shipped by hand with a tracking number and carrier; the shop's tracking page is offered", async () => {
    const d = await openOrder(ids.hamed);
    await d.locator("button:has-text('Ship by hand instead')").click();
    await d.locator(".hand label:has-text('Tracking number') input").fill("DHL55501");
    await d.locator(".hand label:has-text('Carrier') input").fill("DHL");
    await d.locator("button:has-text('Save & mark shipped')").click();
    await toast(/→ Shipped · DHL55501/);
    const det = await detailOf(ids.hamed);
    expect(det.order).toMatchObject({ status: "ship", tracking: "DHL55501", carrier: "DHL" });
    const d2 = await openOrder(ids.hamed);
    expect(await d2.locator("a:has-text('Tracking page')").getAttribute("href")).toBe(BASE() + "/?track=" + ids.hamed);
  });

  it("the customer is corrected (only what changed is sent) and the items re-quoted by the server", async () => {
    let d = await openOrder(ids.salim);
    await d.locator("button[aria-label^='Edit the customer']").click();
    await d.locator(".cust-edit label:has-text('Name') input").fill(tag + " Salim Al Harthi");
    await d.locator(".cust-edit button:has-text('Save')").click();
    await toast(/Customer details saved/);
    await expect.poll(async () => (await detailOf(ids.salim)).order.name).toBe(tag + " Salim Al Harthi");
    d = await openOrder(ids.salim);
    await d.locator("button[aria-label^='Edit the items']").click();
    await d.locator(".item-line").first().waitFor();
    await d.locator("[aria-label='One more']").click();
    await d.locator("button:has-text('Re-quote & save')").click();
    await toast(/Total is now/);
    const det = await detailOf(ids.salim);
    expect(det.order.items.map((i) => i.itemId + "×" + i.qty)).toEqual(["oud-large×2"]);
    expect(det.order.total).toBeGreaterThan(29);
  });

  it("an unpaid card order is owed the payment reminder, with the card and the cash links", async () => {
    const d = await openOrder(ids.layla);
    const wa = decodeURIComponent((await d.locator("a:has-text('WhatsApp: Payment reminder')").getAttribute("href"))!);
    expect(wa).toContain("للدفع بالبطاقة:\n" + BASE() + "/resume/" + ids.layla + "?k=");
    expect(wa).toMatch(/أو الدفع عند الاستلام \(\d+ AED\) — أكد طلبك من هنا:\n.*&cod=1/);
    expect(await d.locator(".flow button:not([disabled])").allTextContents()).toEqual(["Cancel order"]);
  });

  it("is pushed to Empower (the fake Omniful) and shows On Empower", async () => {
    const skus = await adminPost<{ ok: boolean }>(page, "PUT", "/empower/skus", { skus: { "oud-large": "LM3001", "amber-large": "LM3002", "lemon-large": "LM3003", bundle: "LM5001" } });
    expect(skus.ok).toBe(true);
    const d = await openOrder(ids.push);
    await d.locator("button:has-text('Push to Empower')").click();
    await page.click("[role=dialog] button:has-text('Push to Empower')");
    await toast(/sent to Empower · Preparing/);
    const det = await detailOf(ids.push);
    expect(det.order.status).toBe("prep");
    expect(det.shipments.length).toBe(1);
    const d2 = await openOrder(ids.push);
    await expect.poll(() => d2.textContent()).toMatch(/On Empower/);
    expect(await page.$$eval(`tr.row[data-row="${ids.push}"] .pill`, (p) => p.map((x) => x.textContent))).toContain("Empower");
    expect(await d2.textContent()).toContain("Pushed to Empower");
  });
});

describe("a WhatsApp order typed in", () => {
  it("is priced by the server as it is filled, created, and found in the list", async () => {
    await page.goto(BASE() + "/admin/#orders");
    await page.reload();
    await page.click("button:has-text('New order')");
    const dlg = page.locator("[role=dialog]");
    await dlg.locator("label:has-text('Country') select").selectOption("OM");
    await dlg.locator(".item-line").first().waitFor();
    await dlg.locator("label:has-text('Name') input").fill(tag + " Typed");
    await dlg.locator("input[aria-label=Phone]").fill("97771234");
    await dlg.locator("label:has-text('Governorate') select").selectOption("مسقط");
    await dlg.locator("label:has-text('Area') input").fill("الخوير");
    await expect.poll(() => dlg.locator(".wa-total").textContent()).toMatch(/^Total \d/);
    await dlg.locator("button:has-text('Create order')").click();
    await toast(/^Created LM-\d+ · /);
    const id = /Created (LM-\d+)/.exec((await page.textContent(".toast"))!)![1]!;
    await page.waitForSelector(`tr.detail[data-detail="${id}"]`);
    const det = await detailOf(id);
    expect(det.order).toMatchObject({ origin: "whatsapp_order", status: "new", paymentStatus: "cod", countryCode: "OM", city: "مسقط" });
    expect(det.order.name).toBe(tag + " Typed");
  });
});

describe("the flag and the bulk bar", () => {
  it("flags one order from its row; flags, trashes and restores a selection", async () => {
    await page.goto(BASE() + "/admin/#orders?q=" + tag + " Bulk");
    await page.reload();
    await expect.poll(() => page.$$eval("tr.row", (r) => r.length)).toBe(2);
    await page.click(`tr.row[data-row="${ids.bulk1}"] button.flag`);
    await toast(/Flagged/);
    await expect.poll(() => page.getAttribute(`tr.row[data-row="${ids.bulk1}"] button.flag`, "aria-pressed")).toBe("true");
    await page.check(`tr.row[data-row="${ids.bulk1}"] input[type=checkbox]`);
    await page.check(`tr.row[data-row="${ids.bulk2}"] input[type=checkbox]`);
    await page.click("#bulkBar button:has-text('Flag')");
    await toast(/Flagged 2 orders/);
    // Flagged is a tick of the status filter, the last one
    expect((await detailOf(ids.bulk2)).order.flagged).toBe(true);
    await page.check(`tr.row[data-row="${ids.bulk1}"] input[type=checkbox]`);
    await page.check(`tr.row[data-row="${ids.bulk2}"] input[type=checkbox]`);
    await page.click("#bulkBar button:has-text('Trash')");
    await toast(/2 orders moved to trash/);
    await expect.poll(() => page.$$eval("tr.row", (r) => r.length)).toBe(0);
    await page.click(".toolbar button:has-text('Trash')");
    await expect.poll(() => page.$$eval("tr.row", (r) => r.length)).toBe(2);
    await page.click("thead input[type=checkbox]");
    await page.click("#bulkBar button:has-text('Restore')");
    await toast(/2 orders restored/);
    expect((await detailOf(ids.bulk1)).order.trashed).toBe(false);
    expect(s.errors).toEqual([]);
  });
});
