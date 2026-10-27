/**
 * POST /api/pay/webhook — Thawani's word on a payment: verified over the raw body before
 * anything is read, idempotent, recorded, and the only path that reports a sale when the
 * shopper paid and closed the tab.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Deps } from "../../../src/server/core/deps";
import type { FetchLike } from "../../../src/server/core/outbound";
import { ops } from "../../../src/server/db/schema";
import { createServices } from "../../../src/server/services";
import { amountAgrees } from "../../../src/server/domain/payments/settle";
import { verifyPayment } from "../../../src/server/domain/payments/verify";
import { handleWebhook } from "../../../src/server/domain/payments/webhook";
import { completedEvent, paymentEvent, signDelivery } from "../../../src/server/services/thawani/fake";
import { payHarness, SECRET, type PayHarness } from "./_helpers";

let h: PayHarness;
beforeAll(async () => { h = await payHarness(); });
afterEach(async () => { await h.reset(); });

const completed = (id: string, invoice: string, total = 26175, over: Record<string, unknown> = {}) =>
  ({ event_type: "checkout.completed", data: { client_reference_id: id, invoice, payment_status: "paid", total_amount: total, ...over } });

async function rejects() {
  const day = "webhook_rejects_" + new Date(h.clock.t).toISOString().slice(0, 10);
  return ((await h.db.select().from(ops).where(eq(ops.key, day)))[0]?.data || {}) as Record<string, unknown>;
}

describe("the signature", () => {
  // from test-webhook.js
  it("unsigned, forged or signed with the wrong secret: 401, counted (one row a day, no body kept), nothing written", async () => {
    await h.seed({ id: "LM-482913", invoiceNo: "INV-1" });
    const res = await h.request("/api/pay/webhook", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([401, "bad_signature"]);
    expect((await h.deliver(completed("LM-482913", "INV-1"), { sig: "deadbeef" })).status).toBe(401);
    expect((await h.deliver(completed("LM-482913", "INV-1"), { secret: "not-the-secret" })).status).toBe(401);
    const r = await rejects();
    expect([r.n, r.reason]).toEqual([3, "bad_signature"]);
    expect(await h.hooks()).toEqual([]);
    expect((await h.row("LM-482913")).paymentStatus).toBe("unpaid");
  });

  it("no secret configured fails closed: 401, counted as no_secret_configured", async () => {
    const g = await payHarness({ env: { THAWANI_WEBHOOK_SECRET: "" } });
    await g.seed({ id: "LM-482913", invoiceNo: "INV-1" });
    const r = await g.deliver(completed("LM-482913", "INV-1"), { secret: "anything" });
    expect(r.status).toBe(401);
    const day = "webhook_rejects_" + new Date(g.clock.t).toISOString().slice(0, 10);
    expect(((await g.db.select().from(ops).where(eq(ops.key, day)))[0]!.data as { reason: string }).reason).toBe("no_secret_configured");
    expect((await g.row("LM-482913")).paymentStatus).toBe("unpaid");
  });

  it("the bytes are what is signed: a re-serialised body fails", async () => {
    await h.seed({ id: "LM-482913", invoiceNo: "INV-1" });
    const d = signDelivery(completed("LM-482913", "INV-1"), SECRET, "1700000000");
    const res = await h.request("/api/pay/webhook", { method: "POST", body: JSON.stringify(JSON.parse(d.body), null, 1), headers: d.headers });
    expect(res.status).toBe(401);
  });

  it("the portal's URL today reaches the same handler", async () => {
    await h.seed({ id: "LM-482913", invoiceNo: "INV-1" });
    const r = await h.deliver(completed("LM-482913", "INV-1"), { path: "/.netlify/functions/thawani-webhook" });
    expect([r.status, (await h.row("LM-482913")).paymentStatus]).toEqual([200, "paid"]);
    expect((await h.request("/.netlify/functions/thawani-webhook")).status).toBe(405);
  });
});

describe("checkout.completed", () => {
  // from test-webhook.js: the gap this was written for
  it("settles, moves into fulfilment and reports the Purchase from the stored context (not Thawani's)", async () => {
    await h.seed({ id: "LM-482913", invoiceNo: "INV-1", phone: "+968 76655565", countryCode: "OM", cur: "OMR", total: 32.9, omr: 32.9, omrRate: 1, amountBaisa: 32900,
      items: [{ itemId: "oud-small", scent: "عود", size: "صغير", qty: 2, price: 12 }], client: { ip: "5.6.7.8", ua: "Shopper/1.0", url: "https://lubanmusk.com/en/checkout.html" } });
    const r = await h.request("/api/pay/webhook", { method: "POST", ...signedInit(completed("LM-482913", "INV-1", 32900)), headers: { ...signedInit(completed("LM-482913", "INV-1", 32900)).headers, "x-nf-client-connection-ip": "9.9.9.9" } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, id: "LM-482913" });
    const o = await h.row("LM-482913");
    expect([o.paymentStatus, o.status]).toEqual(["paid", "new"]);
    expect(o.gateway!.webhook_completed_at).toBeTruthy();
    expect(h.purchases()).toBe(1);
    const snap = h.world.calls.filter((c) => c.host === "tr.snapchat.com").pop()!;
    expect(snap.rawBody).toMatch(/PURCHASE/);
    expect(snap.rawBody).toMatch(/"LM-482913"/);
    expect(snap.rawBody).not.toMatch(/76655565/);
    const meta = h.world.calls.filter((c) => c.host === "graph.facebook.com").pop()!;
    expect(meta.rawBody).toMatch(/5\.6\.7\.8/);
    expect(meta.rawBody).not.toMatch(/9\.9\.9\.9/);
    const rec = (await h.hooks()).pop()!;
    expect([rec.applied, rec.orderId, rec.invoice, rec.verified, rec.dedupeKey!.length]).toEqual(["paid", "LM-482913", "INV-1", true, 40]);
  });

  it("completed but not paid is ignored, no conversion", async () => {
    await h.seed({ id: "LM-482913", invoiceNo: "INV-1" });
    await h.deliver({ event_type: "checkout.completed", data: { client_reference_id: "LM-482913", total_amount: 26175 } });
    expect((await h.row("LM-482913")).paymentStatus).toBe("unpaid");
    expect(h.purchases()).toBe(0);
    expect((await h.hooks())[0]!.applied).toBe("ignored");
  });

  it("an underpayment: 200, left pending, the mismatch said on the order", async () => {
    await h.seed({ id: "LM-482913", invoiceNo: "INV-1" });
    const r = await h.deliver(completed("LM-482913", "INV-1", 100));
    expect(r.j).toEqual({ ok: true, note: "amount mismatch, left pending" });
    const o = await h.row("LM-482913");
    expect([o.paymentStatus, o.lastPaymentError]).toEqual(["unpaid", "amount_mismatch: paid 100 expected 26175"]);
    expect((await h.hooks())[0]!.applied).toBe("mismatch");
  });

  it("an unknown order: 200 (no retry storm), recorded unknown_order", async () => {
    const r = await h.deliver(completed("LM-999999", "INV-9"));
    expect(r.status).toBe(200);
    expect((await h.hooks())[0]!.applied).toBe("unknown_order");
  });

  it("an order named only by its invoice is found by it", async () => {
    await h.seed({ id: "LM-482914", invoiceNo: "INV-14" });
    await h.deliver({ event_type: "checkout.completed", data: { invoice: "INV-14", payment_status: "paid", total_amount: 26175 } });
    expect((await h.row("LM-482914")).paymentStatus).toBe("paid");
  });

  it("a refunded order is final: a late completed is refunded_ignored", async () => {
    await h.seed({ id: "LM-482915", invoiceNo: "INV-15", paymentStatus: "refunded", refunded: true, status: "void" });
    await h.deliver(completed("LM-482915", "INV-15"));
    expect((await h.row("LM-482915")).paymentStatus).toBe("refunded");
    expect((await h.hooks())[0]!.applied).toBe("refunded_ignored");
  });

  it("an unparseable (signed) body is acknowledged and recorded", async () => {
    const r = await h.deliver("{not json");
    expect(r.j).toEqual({ ok: true, note: "unparseable, acknowledged" });
    const rec = (await h.hooks())[0]!;
    expect([rec.eventType, rec.applied]).toEqual(["unparseable", "ignored"]);
  });
});

// from test-v314.js: A8/A9/A32/A33 — settlement
describe("settlement rules", () => {
  it("a binned attempt is not settled by its old session; the money is flagged on it (v334)", async () => {
    await h.seed({ id: "LM-500001", invoiceNo: "inv_51", trashed: true });
    const r = await h.deliver(completed("LM-500001", "inv_51"));
    expect(r.j.note).toBe("paid but not settled; flagged on the order");
    const o = await h.row("LM-500001");
    expect(o.paymentStatus).toBe("unpaid");
    expect(o.lastPaymentError).toMatch(/^paid_unsettled: invoice inv_51 paid 26175 baisa on a binned order/);
    expect((await h.hooks()).pop()!.applied).toBe("paid_unsettled");
  });

  it("a cash-switched order paid by its old card page is a card order, at the charged figure (A9)", async () => {
    await h.seed({ id: "LM-500002", pay: "cod", paymentStatus: "cod", status: "new", invoiceNo: "inv_52", total: 290, omr: 30.363, codFee: 10 });
    await h.deliver(completed("LM-500002", "inv_52"));
    const o = await h.row("LM-500002");
    expect([o.paymentStatus, o.pay, o.omr, o.codFee, o.status]).toEqual(["paid", "card", 26.175, 0, "new"]);
    expect(o.total).toBe(Math.round(26.175 * (290 / 30.363) * 1000) / 1000);
  });

  it("an event with no amount settles nothing; the mismatch note stays while the order is unpaid", async () => {
    await h.seed({ id: "LM-500003", invoiceNo: "inv_53" });
    const r = await h.deliver({ event_type: "checkout.completed", data: { client_reference_id: "LM-500003", invoice: "inv_53", payment_status: "paid" } });
    expect(r.j.note).toBe("amount mismatch, left pending");
    expect((await h.row("LM-500003")).paymentStatus).toBe("unpaid");
    await h.deliver({ event_type: "payment.succeeded", data: { client_reference_id: "LM-500003", invoice: "inv_53", payment_id: "p1", masked_card: "4242", card_type: "credit" } });
    expect((await h.row("LM-500003")).lastPaymentError).toMatch(/amount_mismatch/);
  });

  it("amountAgrees: a missing figure is not an agreement", () => {
    expect([amountAgrees(0, 26175), amountAgrees(26175, 0), amountAgrees(26175, 26175), amountAgrees(26175, 26176)]).toEqual([false, false, true, false]);
  });

  // from test-v334.js: a card page paid on a shipped or delivered cash order
  it("an old card page paid on a delivered or shipped cash order: the money lands, the status stays", async () => {
    const base = { pay: "cod" as const, paymentStatus: "cod" as const, countryCode: "OM", cur: "OMR", total: 20, omr: 20, omrRate: 1, amountBaisa: 20000 };
    await h.seed({ id: "LM-9101", ...base, status: "done", invoiceNo: "inv_LM-9101", sessionId: "s1" });
    await h.seed({ id: "LM-9102", ...base, status: "ship", invoiceNo: "inv_LM-9102", sessionId: "s2" });
    await h.deliver(completed("LM-9101", "inv_LM-9101", 20000));
    await h.deliver(completed("LM-9102", "inv_LM-9102", 20000));
    expect([(await h.row("LM-9101")).status + "/" + (await h.row("LM-9101")).paymentStatus, (await h.row("LM-9102")).status + "/" + (await h.row("LM-9102")).paymentStatus]).toEqual(["done/paid", "ship/paid"]);
  });
});

describe("the same payment twice", () => {
  // from test-v202.js: a second invoice on an already paid order is recorded
  it("a different checkout paid on a paid order is a second charge, said on the order", async () => {
    await h.seed({ id: "LM-700001", invoiceNo: "inv_71", paymentStatus: "paid", status: "new", paidAt: new Date(h.clock.t) });
    await h.deliver(completed("LM-700001", "inv_72"));
    const o = await h.row("LM-700001");
    expect(o.lastPaymentError).toBe("second_payment: invoice inv_72 paid 26175 baisa - refund one");
    expect((await h.hooks()).pop()!.applied).toBe("second_payment");
  });

  // from test-v327.js / test-v334.js
  it("a webhook for an order paid moments ago with no Purchase yet reports it once; the same checkout again is a duplicate", async () => {
    await h.seed({ id: "LM-700001", invoiceNo: "inv_71", paymentStatus: "paid", status: "new", paidAt: new Date(h.clock.t - 60e3) });
    const r = await h.deliver(completed("LM-700001", "inv_71"));
    expect([r.status, h.purchases()]).toEqual([200, 1]);
    await h.deliver(completed("LM-700001", "inv_71", 26175, { at: 2 }));
    expect(h.purchases()).toBe(1);
    expect((await h.hooks()).map((e) => e.applied)).toEqual(["duplicate", "duplicate"]);
    expect((await h.row("LM-700001")).paidAt!.getTime()).toBe(h.clock.t - 60e3);
  });

  it("the same bytes again: acknowledged as a replay, the order untouched, no second Purchase", async () => {
    await h.seed({ id: "LM-700002", invoiceNo: "inv_72", sessionId: "sess_72" });
    const evt = completed("LM-700002", "inv_72");
    const first = await h.deliver(evt);
    expect([first.status, (await h.row("LM-700002")).paymentStatus, h.purchases()]).toEqual([200, "paid", 1]);
    const again = await h.deliver(evt);
    expect(again.j).toEqual({ ok: true, replay: true, applied: "paid" });
    expect(h.purchases()).toBe(1);
    expect((await h.hooks()).map((e) => e.applied)).toEqual(["paid", "replay"]);
  });

  it("a delivery whose write failed answers 500 (Thawani retries); the retry of the same bytes is handled, not a replay", async () => {
    await h.seed({ id: "LM-700003", invoiceNo: "inv_73" });
    const d = signDelivery(completed("LM-700003", "inv_73"), SECRET, "1733807121");
    const broken = { ...h.deps, db: new Proxy(h.db, { get: (t, p) => (p === "transaction" ? () => Promise.reject(new Error("refused")) : Reflect.get(t, p)) }) } as unknown as Deps;
    const r = await handleWebhook(broken, d.body, { timestamp: d.headers["thawani-timestamp"], signature: d.headers["thawani-signature"] });
    expect(r).toEqual({ status: 500, body: { ok: false, error: "processing_failed" } });
    expect((await h.hooks())[0]!.applied).toMatch(/^error/);
    const retry = await h.deliver(completed("LM-700003", "inv_73"));
    expect([retry.status, retry.j.replay, (await h.row("LM-700003")).paymentStatus]).toEqual([200, undefined, "paid"]);
  });

  // from test-v334.js: the settling write landed but its answer was lost
  it("the write committed and its answer was lost: the retry reports the sale, once", async () => {
    await h.seed({ id: "LM-9601", invoiceNo: "inv_LM-9601", countryCode: "OM", cur: "OMR", total: 20, omr: 20, omrRate: 1, amountBaisa: 20000 });
    const d = signDelivery(completed("LM-9601", "inv_LM-9601", 20000), SECRET, "1733807121");
    const lost = { ...h.deps, db: new Proxy(h.db, { get: (t, p) => (p === "transaction" ? async (fn: never) => { await t.transaction(fn); throw new Error("timeout"); } : Reflect.get(t, p)) }) } as unknown as Deps;
    const r = await handleWebhook(lost, d.body, { timestamp: d.headers["thawani-timestamp"], signature: d.headers["thawani-signature"] });
    expect(r.status).toBe(500);
    expect([(await h.row("LM-9601")).paymentStatus, h.purchases()]).toEqual(["paid", 0]);
    await h.deliver(completed("LM-9601", "inv_LM-9601", 20000));
    await h.deliver(completed("LM-9601", "inv_LM-9601", 20000));
    expect(h.purchases()).toBe(1);
  });

  // from test-v300.js: the webhook and the return settle only what is still open
  it("paid by the shopper's return in the same moment: the webhook's write changes nothing, the return's record stands", async () => {
    const opened = await h.openCard();
    const id = opened.j.id as string;
    h.th().payByReference(id);
    let raced = false;
    const wrapped: FetchLike = async (input, init) => {
      if (!raced && /\/payments\?/.test(String(input))) {
        raced = true;
        await verifyPayment(h.deps, { ref: id }, {});
      }
      return h.world.fetch(input, init);
    };
    const deps = { ...h.deps, fetch: wrapped, services: createServices({ env: h.deps.env, fetch: wrapped, now: h.deps.now }) };
    const d = signDelivery(completedEvent(h.th().sessionFor(id)!), SECRET, "1733807121");
    const r = await handleWebhook(deps, d.body, { timestamp: d.headers["thawani-timestamp"], signature: d.headers["thawani-signature"] });
    expect(r.body).toEqual({ ok: true, id, note: "settled by the return a moment earlier" });
    const o = await h.row(id);
    expect([!!o.gateway!.verified_at, o.gateway!.webhook_completed_at]).toEqual([true, undefined]);
    expect(h.purchases()).toBe(1);
  });
});

describe("the other events", () => {
  it("payment.succeeded attaches the card and the fee; a late success never clears a refund (v202)", async () => {
    await h.seed({ id: "LM-800001", invoiceNo: "inv_81", paymentStatus: "paid", status: "new", lastPaymentError: "old decline" });
    await h.deliver(paymentEvent({ payment_id: "pay_81", checkout_invoice: "inv_81", status: "successful", amount: 26175, fee: 650, masked_card: "XXXX 4242", card_type: "credit" }));
    let o = await h.row("LM-800001");
    expect([o.paymentId, o.maskedCard, o.cardType, o.gatewayFee, o.netAmount, o.lastPaymentError]).toEqual(["pay_81", "XXXX 4242", "credit", 0.65, 25.525, null]);
    expect((await h.hooks()).pop()!.applied).toBe("enriched");
    await h.seed({ id: "LM-800002", invoiceNo: "inv_82", paymentStatus: "refunded", refunded: true, status: "void" });
    await h.deliver(paymentEvent({ payment_id: "pay_82", checkout_invoice: "inv_82", status: "successful", amount: 26175, fee: 650, refunded: false }));
    o = await h.row("LM-800002");
    expect([o.refunded, o.paymentStatus]).toEqual([true, "refunded"]);
  });

  it("payment.failed records the decline and leaves the order pending, so another card may settle it", async () => {
    await h.seed({ id: "LM-800003", invoiceNo: "inv_83" });
    await h.deliver(paymentEvent({ payment_id: "pay_83", checkout_invoice: "inv_83", status: "failed", reason: "Insufficient funds" }, "payment.failed"));
    const o = await h.row("LM-800003");
    expect([o.status, o.paymentStatus, o.lastPaymentError]).toEqual(["pending", "unpaid", "Insufficient funds"]);
    expect((await h.hooks()).pop()!.applied).toBe("failed");
    await h.deliver(completed("LM-800003", "inv_83"));
    expect((await h.row("LM-800003")).lastPaymentError).toBeNull();
  });

  it("checkout.created and payment.pending are ignored; anything else unhandled — all acknowledged", async () => {
    for (const t of ["checkout.created", "payment.pending", "something.new"]) expect((await h.deliver({ event_type: t, data: {} })).status).toBe(200);
    expect((await h.hooks()).map((e) => e.applied)).toEqual(["ignored", "ignored", "unhandled"]);
  });
});

// from test-resilience.js: a miss and a failure are not the same answer
describe("when we cannot act", () => {
  it("a database that cannot be read: 500 processing_failed, so Thawani retries", async () => {
    const d = signDelivery(completed("LM-123456", "inv-1", 12000), SECRET, "1733807121");
    const down = { ...h.deps, db: new Proxy(h.db, { get: (t, p) => (p === "select" ? () => { throw new Error("db_unreachable"); } : Reflect.get(t, p)) }) } as unknown as Deps;
    const r = await handleWebhook(down, d.body, { timestamp: d.headers["thawani-timestamp"], signature: d.headers["thawani-signature"] });
    expect(r).toEqual({ status: 500, body: { ok: false, error: "processing_failed" } });
  });
});

function signedInit(evt: unknown) {
  const d = signDelivery(evt, SECRET, "1700000000");
  return { body: d.body, headers: d.headers };
}
