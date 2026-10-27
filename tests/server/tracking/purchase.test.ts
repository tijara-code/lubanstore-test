import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claims, type OrderRow } from "../../../src/server/db/schema";
import { customerOf, itemsOmr, reportPurchase } from "../../../src/server/domain/purchase";
import { pixelsFake } from "../../../src/server/services/pixels/fake";
import { createHarness, type Harness } from "../../helpers/harness";
import { addOrder } from "./_fixtures";

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const AED = 0.1047;
const PHONE = "+971 501234567";
const PHONE_HASH = sha("971501234567");
const VID = "b".repeat(64);

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.reset(); });
beforeEach(async () => { await h.reset(); pixelsFake(h.world).clear(); });
const px = () => pixelsFake(h.world);

/** an AE order: a large box and a burner, 250 + 60 AED, 33.504 OMR with the cash fee */
const aeOrder = (id: string, extra: Partial<OrderRow> = {}) => addOrder(h, {
  id, name: "Ahmed Al Balushi", phone: PHONE, phoneKey: "971501234567", email: "Test@Example.com",
  countryCode: "AE", city: "دبي", region: "Deira", pay: "cod", paymentStatus: "cod", status: "new",
  items: [{ itemId: "oud-large", scent: "عود", size: "كبير", price: 250, qty: 1 }, { itemId: "burner", scent: "مبخرة", size: "", price: 60, qty: 1 }],
  cur: "AED", sub: 310, total: 320, omrRate: AED, omr: 33.504,
  client: { ip: "5.6.7.8", ua: "Shopper/1.0", url: "https://lubanmusk.com/checkout.html", scid: "scid-cookie", sccid: "sc-click",
    fbp: "fb.1.1.2", fbc: "fb.1.1790534142169.IwAR", gcid: "1234567890.1759500000", gsid: "1759560000", vid: VID },
  ...extra,
});

// from test-pixel-parity.js: 3, 6. the cash sale, as both platforms receive it
describe("a sale told to Meta and Snap", () => {
  it("one customer, OMR lines, one value, one id — and each platform's own ids only", async () => {
    const o = await aeOrder("LM-4148696913");
    const r = await reportPurchase(h.deps, o, { ip: "5.6.7.8", ua: "Shopper/1.0" });
    expect(r).toEqual({ ga4: "server", reported: true });
    const cs = px().snap[0]!.event, cm = px().meta[0]!.event;
    expect([cs.event_name, cm.event_name]).toEqual(["PURCHASE", "Purchase"]);
    expect(cs.custom_data.contents.map((c: any) => c.item_price)).toEqual([r3(250 * AED), r3(60 * AED)]);
    expect(cm.custom_data.contents.map((c: any) => c.item_price)).toEqual([r3(250 * AED), r3(60 * AED)]);
    expect([cs.custom_data.value, cm.custom_data.value]).toEqual([33.504, 33.504]);
    expect([cs.custom_data.currency, cm.custom_data.currency]).toEqual(["OMR", "OMR"]);
    expect(cs.custom_data.content_ids).toEqual(cm.custom_data.content_ids);
    expect([cs.custom_data.num_items, cm.custom_data.num_items]).toEqual(["2", 2]);
    for (const k of ["em", "ph", "fn", "ln", "ct", "st", "country", "external_id"]) {
      expect(!!cs.user_data[k] && JSON.stringify(cs.user_data[k]) === JSON.stringify(cm.user_data[k])).toBe(true);
    }
    expect(cs.user_data.external_id).toEqual([PHONE_HASH, VID]);
    expect(cm.user_data.em).toEqual([sha("test@example.com")]);
    expect(/Ahmed|Balushi|دبي|Deira|501234567|example\.com/i.test(JSON.stringify(h.world.calls.map((c) => c.body)))).toBe(false);
    expect([cs.user_data.sc_cookie1, cs.user_data.sc_click_id, cs.user_data.fbp, cs.user_data.fbc]).toEqual(["scid-cookie", "sc-click", undefined, undefined]);
    expect([cm.user_data.fbp, cm.user_data.fbc, cm.user_data.sc_cookie1, cm.user_data.sc_click_id]).toEqual(["fb.1.1.2", "fb.1.1790534142169.IwAR", undefined, undefined]);
    // the order id is the event id, and the order_id (30-day window)
    expect([cm.event_id, cm.custom_data.order_id, cs.event_id, cs.custom_data.order_id]).toEqual(["LM-4148696913", "LM-4148696913", "LM-4148696913", "LM-4148696913"]);
    expect([cm.event_source_url, cs.event_source_url]).toEqual(["https://lubanmusk.com/checkout.html", "https://lubanmusk.com/checkout.html"]);
  });
  // from test-pixel-parity.js: 2. the card sale — the live request first, the captured client filling gaps
  it("the card's return: this request's IP and agent; the webhook: the SHOPPER's captured ones, never Thawani's", async () => {
    const o = await aeOrder("LM-1234567890", { pay: "card", paymentStatus: "paid", client: { ip: "5.6.7.8", ua: "Shopper/1.0", url: "https://lubanmusk.com/en/checkout.html", scid: "scid-2", sccid: "sc-click-2", fbp: "fb.1.9.9", fbc: "fb.1.9.8" } });
    await reportPurchase(h.deps, o, { ip: "7.7.7.7", ua: "Shopper/1.0" });
    for (const e of [px().snap[0]!.event, px().meta[0]!.event]) {
      expect(e.event_source_url).toBe("https://lubanmusk.com/en/checkout.html");
      expect([e.user_data.client_ip_address, e.user_data.client_user_agent]).toEqual(["7.7.7.7", "Shopper/1.0"]);
      expect(e.user_data.external_id).toEqual([PHONE_HASH]);
    }
    expect([px().snap[0]!.event.user_data.sc_cookie1, px().snap[0]!.event.user_data.sc_click_id]).toEqual(["scid-2", "sc-click-2"]);
    expect([px().meta[0]!.event.user_data.fbp, px().meta[0]!.event.user_data.fbc]).toEqual(["fb.1.9.9", "fb.1.9.8"]);

    const o2 = await aeOrder("LM-1234567891", { pay: "card", paymentStatus: "paid" });
    px().clear();
    await reportPurchase(h.deps, o2); // the webhook: no live request
    for (const e of [px().snap[0]!.event, px().meta[0]!.event]) {
      expect([e.user_data.client_ip_address, e.user_data.client_user_agent]).toEqual(["5.6.7.8", "Shopper/1.0"]);
    }
  });
  it("an order captured before the client existed: the checkout page stands in for the url, prices still OMR", async () => {
    const o = await aeOrder("LM-1234567892", { client: null });
    await reportPurchase(h.deps, o);
    const e = px().meta[0]!.event;
    expect(e.event_source_url).toBe("https://lubanmusk.test/checkout.html");
    expect(e.custom_data.contents.map((c: any) => c.item_price)).toEqual([r3(250 * AED), r3(60 * AED)]);
    expect(e.user_data.client_ip_address).toBeUndefined();
  });
  it("a clipped click id stored by an older row is dropped, never sent", async () => {
    const o = await aeOrder("LM-1234567893", { client: { fbc: "fb.1.1." + "x".repeat(2000) } });
    await reportPurchase(h.deps, o);
    expect(px().meta[0]!.event.user_data.fbc).toBeUndefined();
  });
  // from test-v300.js: both platforms together, never throwing
  it("sends both platforms at once and never throws", async () => {
    const o = await aeOrder("LM-1234567894");
    h.world.fail((c) => (c.host === "tr.snapchat.com" ? "refused" : c.host === "graph.facebook.com" ? { status: 500, body: { error: { message: "down" } } } : null));
    await expect(reportPurchase(h.deps, o)).resolves.toMatchObject({ ga4: "server" });
    h.world.fail(null);
    await expect(reportPurchase(h.deps, null as unknown as OrderRow)).resolves.toEqual({ ga4: "server" });
    const who = await customerOf({ name: "Salim Al Balushi", phone: "+968 91234567", countryCode: "OM" });
    expect(/^[a-f0-9]{64}$/.test((who.externalId as string[])[0]!)).toBe(true);
    expect([who.firstName, who.lastName]).toEqual(["Salim", "Al Balushi"]);
  });
  // from test-email-savings.js: the Purchase names the customer's email
  it("names the customer's email", async () => {
    expect((await customerOf({ name: "Sara Ali", phone: "96891234567", email: "sara@example.com" })).email).toBe("sara@example.com");
  });
  it("prices lines at the order's rate", () => {
    expect(itemsOmr([{ itemId: "oud-large", scent: "", size: "", price: 250, qty: 2 }], AED)).toEqual([{ id: "oud-large", qty: 2, price: 26.175 }]);
  });
});

// from test-v334.js: the Purchase is reported once per order, whichever path wins
describe("once per order", () => {
  it("the first path reports, the rest stand aside; the claim is purchase-<id>", async () => {
    const o = await aeOrder("LM-9601");
    const a = await reportPurchase(h.deps, o);
    const b = await reportPurchase(h.deps, o);
    const c = await reportPurchase(h.deps, o, { ip: "1.1.1.1" });
    expect([a.reported, b.reported, c.reported]).toEqual([true, false, false]);
    expect([px().meta.length, px().snap.length]).toEqual([1, 1]);
    expect((await h.db.select().from(claims).where(eq(claims.key, "purchase-LM-9601"))).length).toBe(1);
  });
});

// from test-v302.js: GA4 from the server, once per order, joined to the visit
describe("GA4's purchase", () => {
  it("goes to the Measurement Protocol with the stream and secret, joined to the visit", async () => {
    const o = await aeOrder("LM-300001", { pay: "card", paymentStatus: "paid", items: [{ itemId: "oud-large", scent: "", size: "", price: 26, qty: 2 }], omrRate: 1, omr: 52 });
    await reportPurchase(h.deps, o);
    const g = px().ga4;
    expect(g.length).toBe(1);
    expect([g[0]!.measurementId, g[0]!.apiSecret]).toEqual(["G-FAKE00001", "fake-ga4-secret"]);
    const ev = g[0]!.body.events[0];
    expect(ev.name + " " + ev.params.transaction_id).toBe("purchase LM-300001");
    expect(ev.params.value + " " + ev.params.currency + " " + ev.params.items[0].item_id + " " + ev.params.items[0].item_variant + " x" + ev.params.items[0].quantity).toBe("52 OMR oud-large large x2");
    expect(g[0]!.body.client_id + " " + ev.params.session_id).toBe("1234567890.1759500000 1759560000");
    expect(ev.params.engagement_time_msec).toBe(1);
    expect(ev.params.payment_type).toBe("card");
    expect(g[0]!.body.timestamp_micros).toBe(h.clock.t * 1000);
  });
  it("the same sale confirmed again is not sent twice", async () => {
    const o = await aeOrder("LM-300005");
    await reportPurchase(h.deps, o);
    await reportPurchase(h.deps, o);
    expect(px().ga4.length).toBe(1);
  });
  // A24: a failed send marks its claim failed, never gives it back — so the next path delivers it
  it("a failed send marks the claim failed, and the next path takes it over and sends", async () => {
    const o = await aeOrder("LM-300002");
    h.world.fail((c) => (c.host === "www.google-analytics.com" ? { status: 500, body: {} } : null));
    await reportPurchase(h.deps, o);
    h.world.fail(null);
    const cl = await h.db.select().from(claims).where(eq(claims.key, "ga4-LM-300002"));
    expect(cl[0]!.state).toBe("failed");
    await reportPurchase(h.deps, o);
    expect(px().ga4.filter((x) => x.body.events[0].params.transaction_id === "LM-300002").length).toBe(1);
    expect((await h.db.select().from(claims).where(eq(claims.key, "ga4-LM-300002")))[0]!.state).toBe("taken");
    // and Meta/Snap still once
    expect(px().meta.length).toBe(1);
  });
  it("no cookie ids: still counted, under a fresh client id and no session", async () => {
    const o = await aeOrder("LM-300003", { client: { gcid: "garbage", gsid: "x" } });
    await reportPurchase(h.deps, o);
    const b = px().ga4[0]!.body;
    expect(/^\d+\.\d+$/.test(b.client_id)).toBe(true);
    expect("session_id" in b.events[0].params).toBe(false);
  });
  it("no secret: the server sends nothing and tells the page to", async () => {
    const q = await createHarness({ env: { GA4_API_SECRET: "" } });
    const o = await addOrder(q, { id: "LM-300004" });
    expect((await reportPurchase(q.deps, o)).ga4).toBe("page");
    expect(pixelsFake(q.world).ga4.length).toBe(0);
    expect(pixelsFake(q.world).meta.length).toBe(1);
  });
});

// from test-v209.js: a card order confirmed as cash from the reminder link is a Purchase
describe("the reminder link's cash confirmation", () => {
  it("reports the cash total in OMR under the order id, with the shopper's tap", async () => {
    const o = await aeOrder("LM-123456", { pay: "cod", paymentStatus: "cod", omr: 27.222, client: { fbp: "fb.1.1700000000000.42", ip: "5.6.7.8", ua: "Shopper/1", scid: "sc-1" } });
    await reportPurchase(h.deps, o, { ip: "9.9.9.9", ua: "WhatsAppTap/1" });
    const m = px().meta[0]!.event;
    expect([m.event_name, m.event_id, m.custom_data.value, m.custom_data.currency].join(" ")).toBe("Purchase LM-123456 27.222 OMR");
    expect([m.user_data.client_ip_address, m.user_data.fbp, /^[a-f0-9]{64}$/.test(m.user_data.ph[0])].join(" ")).toBe("9.9.9.9 fb.1.1700000000000.42 true");
    expect(px().snap[0]!.event.event_name + " " + px().snap[0]!.event.event_id).toBe("PURCHASE LM-123456");
  });
});
