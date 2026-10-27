/**
 * The Thawani client and its emulator: base URL by mode, the key header, the hosted page's
 * URL, picking the charge that worked, Thawani's refusals — and the session's line items
 * (baisa, ≤ 40-character names, balanced to the total).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../../src/server/env";
import { FAKE_ENV } from "../../../src/server/services";
import { createWorld } from "../../../src/server/services/fakes/world";
import {
  createThawaniClient, isInProgressStatus, isPaidStatus, pickPayment, ThawaniError, type ThawaniPayment,
} from "../../../src/server/services/thawani";
import { installThawaniFake, thawaniFake } from "../../../src/server/services/thawani/fake";
import { balance, name40, productsFor, returnUrls } from "../../../src/server/domain/payments/session";
import { payHarness, type PayHarness } from "./_helpers";

function client(env: Record<string, string>, mode: "fake" | "live" = "live") {
  const world = createWorld();
  installThawaniFake(world);
  const e = loadEnv({ ...FAKE_ENV, SERVICES_MODE: mode, ...env });
  return { world, th: createThawaniClient({ env: e, fetch: world.fetch, now: () => Date.parse("2026-10-20T08:00:00Z") }) };
}

const body = (over: Record<string, unknown> = {}) => ({
  client_reference_id: "LM-482913", mode: "payment" as const,
  products: [{ name: "عود الافندر صغير", quantity: 2, unit_amount: 12000 }, { name: "باقة الروائح الثلاث", quantity: 1, unit_amount: 29000 }],
  success_url: "https://lubanmusk.com/checkout.html?paid=LM-482913", cancel_url: "https://lubanmusk.com/checkout.html?cancelled=LM-482913",
  expire_in_minutes: 60, metadata: { order_id: "LM-482913" }, ...over,
});

describe("the client", () => {
  it("talks to UAT by default and to checkout.thawani.om when THAWANI_MODE=live, with the key header", async () => {
    let c = client({});
    await c.th.createSession(body());
    expect(c.world.calls[0]!.host).toBe("uatcheckout.thawani.om");
    expect(c.world.calls[0]!.path).toBe("/api/v1/checkout/session");
    expect(c.world.calls[0]!.headers["thawani-api-key"]).toBe(FAKE_ENV.THAWANI_SECRET_KEY);
    expect(c.th.mode()).toBe("uat");
    c = client({ THAWANI_MODE: "live" });
    await c.th.createSession(body());
    expect(c.world.calls[0]!.host).toBe("checkout.thawani.om");
    expect(c.th.mode()).toBe("live");
  });

  it("the hosted page: Thawani's with the publishable key; in fake mode the dev page on the request's origin", () => {
    // from test-resume.js: the redirect goes to https://uatcheckout.thawani.om/pay/sess_1
    expect(client({ THAWANI_PUBLISHABLE_KEY: "pk_pub" }).th.payUrl("sess_1", "https://lubanmusk.com")).toBe("https://uatcheckout.thawani.om/pay/sess_1?key=pk_pub");
    expect(client({ THAWANI_MODE: "live", THAWANI_PUBLISHABLE_KEY: "pk_pub" }).th.payUrl("sess_1")).toBe("https://checkout.thawani.om/pay/sess_1?key=pk_pub");
    expect(client({ THAWANI_PUBLISHABLE_KEY: "pk_pub" }, "fake").th.payUrl("sess_1", "http://localhost:8888")).toBe("http://localhost:8888/__fake/thawani/pay/sess_1?key=pk_pub");
  });

  it("configured only with both keys", () => {
    expect(client({}).th.configured()).toBe(true);
    expect(client({ THAWANI_PUBLISHABLE_KEY: "" }).th.configured()).toBe(false);
    expect(createThawaniClient({ env: loadEnv({ SERVICES_MODE: "live" }), fetch: fetch, now: () => 0 }).configured()).toBe(false);
  });

  // from test-payments.js: what counts as paid
  it("a charge that worked, in any of Thawani's spellings; inProccess is in progress, not paid and not failed", () => {
    for (const s of ["successful", "succeeded", "success", "paid", "captured", "SUCCESSFUL"]) expect(isPaidStatus(s)).toBe(true);
    for (const s of ["failed", "inProccess", ""]) expect(isPaidStatus(s)).toBe(false);
    expect(isInProgressStatus("inProccess")).toBe(true);
    expect(isInProgressStatus("failed")).toBe(false);
  });

  it("paymentsForInvoice picks the successful charge over a decline before it, in OMR; null on any failure", async () => {
    const c = client({});
    const s = (await c.th.createSession(body())).data;
    const fake = thawaniFake(c.world);
    fake.decline(s.session_id, "Insufficient funds");
    fake.paySession(s.session_id, { fee: 1160 });
    const hit = await c.th.paymentsForInvoice(s.invoice);
    expect(hit!.fields.status).toBe("successful");
    expect(hit!.fields.fee_omr).toBe(1.16);
    expect(hit!.fields.amount_omr).toBe(53);
    expect(hit!.fields.masked_card).toBe("XXXX XXXX XXXX 4242");
    expect(pickPayment([{ status: "failed" }, { status: "inProccess" }] as ThawaniPayment[])!.status).toBe("failed");
    expect(await c.th.paymentsForInvoice(null)).toBeNull();
    c.world.fail(() => "refused");
    expect(await c.th.paymentsForInvoice(s.invoice)).toBeNull();
  });

  it("an unreachable gateway is a ThawaniError gateway_unreachable (504); a refusal carries Thawani's code", async () => {
    const c = client({});
    c.world.fail(() => "refused");
    const e1 = await c.th.createSession(body()).catch((e) => e);
    expect(e1).toBeInstanceOf(ThawaniError);
    expect([e1.code, e1.status, e1.unreachable]).toEqual(["gateway_unreachable", 504, true]);
    c.world.fail(null);
    const e2 = await c.th.createSession(body({ products: [{ name: "x", quantity: 1, unit_amount: 32.9 }] })).catch((e) => e);
    expect([e2.code, e2.status]).toEqual([4000, 400]);
  });

  it("Thawani has no list: an unscoped GET /payments is refused, and the client never sends one", async () => {
    const c = client({});
    await expect(c.th.listPayments({})).rejects.toBeInstanceOf(ThawaniError);
    expect(c.world.calls.length).toBe(0);
    const res = await c.world.fetch("https://uatcheckout.thawani.om/api/v1/payments?limit=10&skip=0", { headers: { "thawani-api-key": "k" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { description: string }).description).toMatch(/Missing required parameter/);
  });
});

describe("the emulator", () => {
  it("answers a session as Thawani documents it", async () => {
    const c = client({});
    const a = await c.th.createSession(body());
    expect([a.success, a.code, a.description]).toEqual([true, 2004, "Session generated successfully"]);
    expect(a.data.total_amount).toBe(53000);
    expect(a.data.payment_status).toBe("unpaid");
    expect(a.data.invoice).toMatch(/^\d{14}$/);
    expect(Date.parse(String(a.data.expire_at)) - Date.parse(String(a.data.created_at))).toBe(3600e3);
    const ref = await c.th.sessionByReference("LM-482913");
    expect(ref.session!.session_id).toBe(a.data.session_id);
  });

  it("refuses what Thawani refuses: a name over 40, a fractional or zero amount, under 100 baisa, no key", async () => {
    const c = client({});
    const long = "ا".repeat(41);
    for (const products of [
      [{ name: long, quantity: 1, unit_amount: 1000 }],
      [{ name: "x", quantity: 1, unit_amount: 32.9 }],
      [{ name: "x", quantity: 1, unit_amount: 0 }],
      [{ name: "x", quantity: 1, unit_amount: 99 }],
    ]) {
      const e = await c.th.createSession(body({ products })).catch((x) => x);
      expect(e).toBeInstanceOf(ThawaniError);
      expect(e.status).toBe(400);
    }
    const res = await c.world.fetch("https://uatcheckout.thawani.om/api/v1/checkout/session", { method: "POST", body: JSON.stringify(body()) });
    expect(res.status).toBe(401);
  });

  it("refunds a successful charge once", async () => {
    const c = client({});
    const s = (await c.th.createSession(body())).data;
    const p = thawaniFake(c.world).paySession(s.session_id).payment;
    const r = await c.th.refund({ payment_id: String(p.payment_id), reason: "damaged" });
    expect(r.data.status).toBe("successful");
    expect((await c.th.paymentById(String(p.payment_id)))!.refunded).toBe(true);
    await expect(c.th.refund({ payment_id: String(p.payment_id), reason: "again" })).rejects.toBeInstanceOf(ThawaniError);
    expect(await c.th.paymentById("pay_nothing")).toBeNull();
  });
});

describe("the session's lines", () => {
  // from test-bugcheck.js: Thawani lines add up to the amount, always
  it("balanced lines equal the total in every case tried, none zero or negative", () => {
    let worst = 0;
    let over = 0;
    for (let u = 1; u < 60; u++) for (let q = 2; q < 7; q++) for (let tot = u * q - 3; tot <= u * q + 3; tot++) {
      if (tot < 100) continue;
      const want = tot + 5000 + q * 111 + (u * 1000 - u) * q;
      const lines = balance([{ name: "a", quantity: 1, unit_amount: 5000 }, { name: "b", quantity: q, unit_amount: u * 1000 + 111 }], want);
      if (lines.reduce((t, p) => t + p.unit_amount * p.quantity, 0) !== want) worst++;
      if (lines.some((p) => p.unit_amount < 1 || p.quantity < 1)) over++;
    }
    expect(worst).toBe(0);
    expect(over).toBe(0);
  });

  it("the Bahraini case: two lines, the difference on one unit", () => {
    const bh = balance([{ name: "x", quantity: 2, unit_amount: 25563 }], 51125);
    expect(bh.map((p) => p.quantity + "×" + p.unit_amount).join(" + ")).toBe("1×25563 + 1×25562");
  });

  it("lines that cannot add up become one line that does", () => {
    expect(balance([{ name: "a", quantity: 1, unit_amount: 500 }], 100)).toEqual([{ name: "a", quantity: 1, unit_amount: 100 }]);
    const one = balance([{ name: "a", quantity: 1, unit_amount: 5 }, { name: "b", quantity: 1, unit_amount: 5 }], 3);
    expect(one).toEqual([{ name: "طلب لبان ومسك", quantity: 1, unit_amount: 3 }]);
  });

  it("names: ≤ 40 characters; the size only when it is a real size label; delivery and a cash fee as lines", () => {
    expect(name40("x".repeat(60)).length).toBe(40);
    expect(name40("  ")).toBe("منتج");
    const lines = productsFor(
      [{ scent: "عود الافندر", size: "صغير", price: 12, qty: 2 }, { scent: "باقة الروائح الثلاث", size: "٣ عبوات ١٠٠ جم، واحدة من كل رائحة", price: 29, qty: 1 }, { scent: "free", size: "", price: 0, qty: 1 }],
      3, 1, 1, 57000,
    );
    // walkthrough: "عود الافندر صغير" × 2 at 12000 baisa
    expect(lines).toEqual([
      { name: "عود الافندر صغير", quantity: 2, unit_amount: 12000 },
      { name: "باقة الروائح الثلاث", quantity: 1, unit_amount: 29000 },
      { name: "التوصيل", quantity: 1, unit_amount: 3000 },
      { name: "رسوم الدفع عند الاستلام", quantity: 1, unit_amount: 1000 },
    ]);
    expect(lines.every((p) => Number.isInteger(p.unit_amount) && p.name.length <= 40)).toBe(true);
  });

  it("back to the checkout in the shopper's language", () => {
    expect(returnUrls("https://lubanmusk.com/", "LM-1234", "ar")).toEqual({
      success_url: "https://lubanmusk.com/checkout.html?paid=LM-1234", cancel_url: "https://lubanmusk.com/checkout.html?cancelled=LM-1234",
    });
    expect(returnUrls("https://lubanmusk.com", "LM-1234", "en").success_url).toBe("https://lubanmusk.com/en/checkout.html?paid=LM-1234");
  });
});

describe("the dev pay page (fake mode only)", () => {
  let h: PayHarness;
  beforeAll(async () => { h = await payHarness(); });
  afterAll(async () => { await h.reset(); });

  it("shows the amount, pays through the emulator, delivers a signed webhook in-process, then returns", async () => {
    const r = await h.openCard();
    const path = new URL(r.j.url).pathname;
    expect(path).toBe("/__fake/thawani/pay/" + r.j.session_id);
    const page = await h.get(path);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toMatch(/Pay 28\.000 OMR/);
    expect(html).toMatch(/FAKE THAWANI/);
    const paid = await h.request(path + "/pay", { method: "POST" });
    expect(paid.status).toBe(302);
    expect(paid.headers.get("location")).toBe("https://lubanmusk.test/checkout.html?paid=" + r.j.id);
    const o = await h.row(r.j.id);
    expect([o.status, o.paymentStatus]).toEqual(["new", "paid"]);
    expect(o.paymentId).toMatch(/^pay_/);
    expect((await h.hooks()).map((e) => e.applied)).toEqual(["paid", "enriched"]);
    // paid twice: the page says so, nothing is charged again
    expect((await h.request(path + "/pay", { method: "POST" })).status).toBe(409);
    expect(await (await h.get(path)).text()).toMatch(/This session is paid/);
  });

  it("Cancel goes back to the cancel URL", async () => {
    const r = await h.openCard();
    const path = new URL(r.j.url).pathname;
    const res = await h.request(path + "/cancel", { method: "POST" });
    expect(res.headers.get("location")).toBe("https://lubanmusk.test/checkout.html?cancelled=" + r.j.id);
    const v = await h.verify({ ref: r.j.id });
    expect(v.j).toEqual({ ok: true, paid: false, status: "cancelled", id: r.j.id });
    expect((await h.row(r.j.id)).status).toBe("void");
  });

  it("an unknown session: 404", async () => {
    expect((await h.get("/__fake/thawani/pay/nope")).status).toBe(404);
  });
});
