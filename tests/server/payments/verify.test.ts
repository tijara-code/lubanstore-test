/**
 * GET /api/pay/verify — the shopper's return. The redirect proves nothing: only Thawani's own
 * answer, for the recorded amount, settles an order; only an open card attempt (or a card
 * attempt switched to cash whose old page was then paid) is acted on; the amount is told only
 * to the payer's own browser.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServices } from "../../../src/server/services";
import type { Deps } from "../../../src/server/core/deps";
import type { FetchLike } from "../../../src/server/core/outbound";
import { verifyPayment } from "../../../src/server/domain/payments/verify";
import { handleWebhook } from "../../../src/server/domain/payments/webhook";
import { completedEvent, signDelivery } from "../../../src/server/services/thawani/fake";
import { KEY, payHarness, SECRET, type PayHarness } from "./_helpers";

let h: PayHarness;
beforeAll(async () => { h = await payHarness(); });
afterEach(async () => { await h.reset(); });

/** a card order opened through the till, its session in the emulator */
async function opened(extra: Record<string, unknown> = {}) {
  const r = await h.openCard(extra);
  return { id: r.j.id as string, sid: r.j.session_id as string };
}

describe("the return", () => {
  it("unpaid at Thawani: paid false, status unpaid, the order left as it is", async () => {
    const { id } = await opened();
    const v = await h.verify({ ref: id });
    expect(v.j).toEqual({ ok: true, paid: false, status: "unpaid", id });
    expect((await h.row(id)).status).toBe("pending");
  });

  it("paid at Thawani for the recorded amount: settled with the card and the fee, the Purchase once", async () => {
    const { id, sid } = await opened();
    h.th().payByReference(id, { fee: 660 });
    const v = await h.verify({ ref: id, sid }, { "x-nf-client-connection-ip": "7.7.7.7", "user-agent": "Back/2.0" });
    expect(v.status).toBe(200);
    expect(v.j).toEqual({ ok: true, paid: true, id, ga4: "server", status: "paid", amount_omr: 28 });
    const o = await h.row(id);
    expect([o.status, o.paymentStatus, o.gatewayFee, o.netAmount, o.maskedCard, o.cardType]).toEqual(["new", "paid", 0.66, 27.34, "XXXX XXXX XXXX 4242", "debit"]);
    expect(o.paidAt!.getTime()).toBe(h.clock.t);
    expect(h.purchases()).toBe(1);
    // from test-pixel-parity.js: the shopper's own request leads (IP and browser)
    const meta = h.world.calls.filter((c) => c.host === "graph.facebook.com").pop()!;
    expect(meta.rawBody).toMatch(/7\.7\.7\.7/);
    expect(meta.rawBody).toMatch(/Back\/2\.0/);
    // a refresh on the success URL: idempotent, no second Purchase
    const again = await h.verify({ ref: id, sid });
    expect(again.j).toEqual({ ok: true, paid: true, id, already: true, status: "paid", amount_omr: 28 });
    expect(h.purchases()).toBe(1);
  });

  // from test-v314.js (audit A22): what pay-verify tells a stranger
  it("by the order number alone: paid or not, nothing else; the session's own browser (or the key) is told the amount", async () => {
    await h.seed({ id: "LM-600001", paymentStatus: "paid", status: "new", sessionId: "sess_61" });
    let v = await h.verify({ ref: "LM-600001" });
    expect(JSON.stringify(v.j)).toBe('{"ok":true,"paid":true,"id":"LM-600001","already":true}');
    v = await h.verify({ ref: "LM-600001", sid: "sess_61" });
    expect(v.j.amount_omr).toBe(26.175);
    v = await h.verify({ ref: "LM-600001", sid: "sess_other" });
    expect(v.j.amount_omr).toBeUndefined();
    v = await h.verify({ ref: "LM-600001", k: KEY });
    expect([v.j.status, v.j.amount_omr]).toEqual(["paid", 26.175]);
    v = await h.verify({ ref: "LM-600001", k: "b".repeat(32) });
    expect(v.j.amount_omr).toBeUndefined();
    // a fresh settle answered to a stranger carries no amount and no card
    const { id } = await opened();
    h.th().payByReference(id);
    v = await h.verify({ ref: id });
    expect(v.j).toEqual({ ok: true, paid: true, id, ga4: "server" });
  });

  it("cancelled on the hosted page: recorded as void/cancelled so it is told apart from an abandon", async () => {
    const { id, sid } = await opened();
    h.th().cancel(sid);
    const v = await h.verify({ ref: id });
    expect(v.j).toEqual({ ok: true, paid: false, status: "cancelled", id });
    const o = await h.row(id);
    expect([o.status, o.paymentStatus]).toEqual(["void", "cancelled"]);
  });

  it("a voided attempt whose money then arrives revives: the money is in", async () => {
    const { id, sid } = await opened();
    h.th().cancel(sid);
    await h.verify({ ref: id });
    h.th().paySession(sid);
    const v = await h.verify({ ref: id });
    expect(v.j.paid).toBe(true);
    const o = await h.row(id);
    expect([o.status, o.paymentStatus]).toEqual(["new", "paid"]);
  });

  it("an amount that disagrees: 409 amount_mismatch, the order left pending; the figures only to the payer (A22)", async () => {
    const { id, sid } = await opened();
    const s = h.th().sessionFor(id)!;
    s.total_amount = 100;
    s.payment_status = "paid";
    const v = await h.verify({ ref: id, sid });
    expect(v.status).toBe(409);
    expect(v.j).toEqual({ ok: false, error: "amount_mismatch", expected_baisa: 28000, paid_baisa: 100, id });
    // (review-fixes) anyone else with the order number is told no amounts
    const other = await h.verify({ ref: id });
    expect([other.status, other.j]).toEqual([409, { ok: false, error: "amount_mismatch", id }]);
    expect((await h.row(id)).paymentStatus).toBe("unpaid");
  });

  it("junk is 400 bad_ref; an order that is not ours 404 unknown_order", async () => {
    expect((await h.verify({ ref: "LM-12" })).j).toEqual({ ok: false, error: "bad_ref" });
    expect((await h.verify({ ref: "<script>" })).status).toBe(400);
    const v = await h.verify({ ref: "LM-482913" });
    expect([v.status, v.j.error]).toEqual([404, "unknown_order"]);
  });

  it("Thawani does not answer: 502 gateway_error (the page asks again), nothing written", async () => {
    const { id } = await opened();
    h.world.fail((c) => (/thawani/.test(c.host) ? "refused" : null));
    const v = await h.verify({ ref: id });
    expect([v.status, v.j.error]).toEqual([502, "gateway_error"]);
    expect((await h.row(id)).status).toBe("pending");
  });

  it("the /payments lookup fails: still paid, just without the fee", async () => {
    const { id } = await opened();
    h.th().payByReference(id);
    h.world.fail((c) => (/thawani/.test(c.host) && c.path.startsWith("/api/v1/payments") ? { status: 500, body: { success: false } } : null));
    const v = await h.verify({ ref: id });
    expect(v.j.paid).toBe(true);
    const o = await h.row(id);
    expect([o.paymentStatus, o.gatewayFee, o.paymentId]).toEqual(["paid", null, null]);
  });

  it("the database: a failed read 502 db_read_failed, a failed write 502 db_write_failed", async () => {
    const { id } = await opened();
    h.th().payByReference(id);
    const down = { ...h.deps, db: { select() { throw new Error("db down"); } } } as unknown as Deps;
    expect(await verifyPayment(down, { ref: id }, {})).toEqual({ status: 502, body: { ok: false, error: "db_read_failed" } });
    const noWrite = { ...h.deps, db: new Proxy(h.db, { get: (t, p) => (p === "transaction" ? () => Promise.reject(new Error("db down")) : Reflect.get(t, p)) }) } as unknown as Deps;
    expect(await verifyPayment(noWrite, { ref: id }, {})).toEqual({ status: 502, body: { ok: false, error: "db_write_failed" } });
    expect((await h.row(id)).paymentStatus).toBe("unpaid");
  });
});

// from test-bugcheck.js: settled orders are left alone
describe("only an open attempt is acted on", () => {
  it("a refunded order is not revived, whatever Thawani says", async () => {
    const { id } = await opened();
    h.th().payByReference(id);
    await h.db.execute(`update orders set payment_status = 'refunded', refunded = true, status = 'void' where id = '${id}'` as never);
    const v = await h.verify({ ref: id });
    expect(v.j).toEqual({ ok: true, paid: false, id, settled: true });
    const o = await h.row(id);
    expect(o.paymentStatus + "/" + o.status).toBe("refunded/void");
  });

  it("a cash order that began as a card attempt is not voided by its old session's cancel", async () => {
    const { id, sid } = await opened();
    h.th().cancel(sid);
    await h.db.execute(`update orders set pay = 'cod', payment_status = 'cod', status = 'prep' where id = '${id}'` as never);
    const v = await h.verify({ ref: id, sid });
    expect(v.j).toEqual({ ok: true, paid: false, id, settled: true, status: "cod" });
    expect((await h.row(id)).status).toBe("prep");
  });

  it("a binned attempt is not settled by its old page", async () => {
    const { id } = await opened();
    h.th().payByReference(id);
    await h.db.execute(`update orders set trashed = true where id = '${id}'` as never);
    expect((await h.verify({ ref: id })).j).toEqual({ ok: true, paid: false, id, settled: true });
    expect((await h.row(id)).paymentStatus).toBe("unpaid");
  });

  it("a cash order that never had a card session is not asked about", async () => {
    await h.seed({ id: "LM-3361002", pay: "cod", paymentStatus: "cod", status: "new", amountBaisa: null, countryCode: "OM", cur: "OMR", total: 29, omr: 29, omrRate: 1 });
    const n0 = h.thawaniCalls().length;
    const v = await h.verify({ ref: "LM-3361002" });
    expect([v.j.paid, v.j.settled, h.thawaniCalls().length - n0]).toEqual([false, true, 0]);
  });
});

// from test-v336-server.js §8: a cash order paid on its old card page
describe("a card attempt switched to cash, then paid on its old card page", () => {
  it("not paid: the cash order stands; cancelled: not voided; paid: settled as card at the charged figure", async () => {
    const { id, sid } = await opened();
    const ro = await h.row(id);
    const res = await h.request("/resume/" + id + "?k=" + ro.invoiceKey + "&cod=1", { method: "POST" });
    expect(res.status).toBe(200);
    let o = await h.row(id);
    expect([o.pay, o.paymentStatus, o.status, o.total, o.codFee]).toEqual(["cod", "cod", "new", 29, 1]);

    let v = await h.verify({ ref: id, sid });
    expect([v.j.paid, v.j.settled, (await h.row(id)).pay, (await h.row(id)).status]).toEqual([false, true, "cod", "new"]);
    h.th().cancel(sid);
    v = await h.verify({ ref: id });
    o = await h.row(id);
    expect([v.j.paid, o.status, o.paymentStatus]).toEqual([false, "new", "cod"]);

    h.th().sessionFor(id)!.hosted = "open";
    h.th().paySession(sid);
    v = await h.verify({ ref: id, sid });
    o = await h.row(id);
    expect([v.j.paid, o.pay, o.paymentStatus, o.omr, o.total, o.codFee]).toEqual([true, "card", "paid", 28, 28, 0]);
    v = await h.verify({ ref: id, sid });
    expect([v.j.paid, v.j.already]).toEqual([true, true]);
  });
});

// from test-v327.js: settled once — the return whose write lost the race
describe("the return and the webhook together", () => {
  it("the webhook settles between the return's read and its write: the return answers paid/already, one Purchase", async () => {
    const { id, sid } = await opened();
    h.th().payByReference(id);
    let raced = false;
    const wrapped: FetchLike = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!raced && /\/payments\?/.test(url)) {
        raced = true;
        const d = signDelivery(completedEvent(h.th().sessionFor(id)!), SECRET);
        await handleWebhook(h.deps, d.body, { timestamp: d.headers["thawani-timestamp"], signature: d.headers["thawani-signature"] });
      }
      return h.world.fetch(input, init);
    };
    const deps = { ...h.deps, fetch: wrapped, services: createServices({ env: h.deps.env, fetch: wrapped, now: h.deps.now }) };
    const v = await verifyPayment(deps, { ref: id, sid }, {});
    expect(raced).toBe(true);
    expect(v.body).toEqual({ ok: true, paid: true, id, already: true, ga4: "server", status: "paid", amount_omr: 28 });
    expect(h.purchases()).toBe(1);
    expect((await h.hooks()).map((e) => e.applied)).toEqual(["paid"]);
  });
});
