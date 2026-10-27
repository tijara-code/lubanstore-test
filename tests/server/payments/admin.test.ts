/**
 * The Payments tab's data: Thawani's ledger in our currency, the page built from our own card
 * orders with only the gaps looked up, refunds (refused for every reason there is), and
 * marking an order paid by hand with Thawani's payment id.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { orderEvents } from "../../../src/server/db/schema";
import {
  askThawani, fromOrder, isPaid, listPayments, markPaidByHand, refundable, refundBody, refunded, row, totals,
} from "../../../src/server/domain/payments/admin";
import { refundPayment } from "../../../src/server/domain/payments/refunds";
import type { ThawaniPayment } from "../../../src/server/services/thawani";
import { transition, isLive } from "../../../src/shared/orders/status";
import { payHarness, type PayHarness } from "./_helpers";

/** one row exactly as Thawani's /payments returns it */
const payment = (o: Partial<ThawaniPayment> = {}): ThawaniPayment => ({
  activity: "Luban and Musk", payment_id: "20260907021600", masked_card: "XXXX XXXX XXXX 4242", card_type: "credit",
  status: "successful", amount: 32352, fee: 647, refunded: false, refunds: [], checkout_invoice: "20260907479048840",
  created_at: "2026-09-07T11:09:00Z", ...o,
});

// from test-payments.js
describe("the ledger's arithmetic", () => {
  it("baisa to OMR, once, at the edge; never NaN", () => {
    const r = row(payment());
    expect([r.amount, r.fee, r.net]).toEqual([32.352, 0.647, 31.705]);
    expect([row({}).amount, row({}).net]).toEqual([0, 0]);
  });

  it("paid and refunded", () => {
    expect(isPaid(payment())).toBe(true);
    expect(isPaid(payment({ status: "inProccess" }))).toBe(false);
    expect(refunded(payment({ refunded: true }))).toBe(true);
    expect(refunded(payment({ refunds: [{ status: "successful" }] }))).toBe(true);
    expect(refunded(payment({ refunds: [{ status: "failed" }] }))).toBe(false);
  });

  it("refundable: each refusal with its reason", () => {
    expect(refundable(payment())).toEqual({ ok: true });
    expect(refundable(payment({ status: "failed" }))).toEqual({ ok: false, why: "not_successful" });
    expect(refundable(payment({ status: "inProccess" }))).toEqual({ ok: false, why: "not_successful" });
    expect(refundable(payment({ refunded: true }))).toEqual({ ok: false, why: "already_refunded" });
    expect(refundable(payment({ refunds: [{ status: "successful" }] }))).toEqual({ ok: false, why: "already_refunded" });
    expect(refundable(null)).toEqual({ ok: false, why: "no_such_payment" });
  });

  it("the refund body: a trimmed, capped reason, the order in metadata, no amount (full refund only)", () => {
    const b = refundBody("20260907021600", "  Damaged in transit  ", { order_id: "LM-932325" });
    expect(b).toEqual({ payment_id: "20260907021600", reason: "Damaged in transit", metadata: { order_id: "LM-932325" } });
    expect(refundBody("p", "x".repeat(300)).reason.length).toBe(200);
    expect("amount" in b).toBe(false);
  });

  it("totals: failed attempts are not money, a refund is not subtracted from gross", () => {
    const t = totals([
      row(payment()),
      row(payment({ payment_id: "2", amount: 19900, fee: 398 })),
      row(payment({ payment_id: "3", status: "failed", amount: 78000, fee: 0 })),
      row(payment({ payment_id: "4", amount: 9900, fee: 198, refunded: true })),
    ]);
    expect([t.n, t.failed, t.gross, t.fees, t.net, t.refunded]).toEqual([3, 1, 62.152, 1.243, 60.909, 9.9]);
    expect(totals([]).gross).toBe(0);
  });
});

let h: PayHarness;
beforeAll(async () => { h = await payHarness(); });
afterEach(async () => { await h.reset(); });

describe("the Payments tab (thawani.payments)", () => {
  it("lists our card orders only; a settled one costs no gateway call", async () => {
    await h.seed({ id: "LM-932325", paymentStatus: "paid", status: "new", omr: 32.352, paymentId: "20260907021600", maskedCard: "XXXX 4242", cardType: "credit", gatewayFee: 0.647, netAmount: 31.705, invoiceNo: "20260907479048840", paidAt: new Date(h.clock.t) });
    await h.seed({ id: "LM-932326", pay: "cod", paymentStatus: "cod", status: "new" });
    await h.seed({ id: "LM-932327", trashed: true });
    const r = await listPayments(h.deps, {});
    expect(r.rows.length).toBe(1);
    expect(h.thawaniCalls().length).toBe(0);
    const x = r.rows[0]!;
    expect([x.paymentId, x.amount, x.fee, x.net, x.orderId, x.stale]).toEqual(["20260907021600", 32.352, 0.647, 31.705, "LM-932325", false]);
    expect(r.totals.gross).toBe(32.352);
    expect([r.mode, r.gateway]).toEqual(["uat", true]);
    expect(JSON.stringify(r)).not.toMatch(/fake-thawani-secret|fake-thawani-publishable/);
  });

  it("an unsettled one is looked up by its invoice; the gateway's values win", async () => {
    const opened = await h.openCard();
    h.th().payByReference(opened.j.id, { fee: 600 });
    const before = h.thawaniCalls().length;
    const r = await listPayments(h.deps, {});
    const calls = h.thawaniCalls().slice(before);
    expect(calls.length).toBe(1);
    expect(calls[0]!.path).toBe("/api/v1/payments?limit=5&skip=0&checkout_invoice=" + opened.j.invoice);
    expect(calls[0]!.headers["thawani-api-key"]).toBe("fake-thawani-secret");
    const x = r.rows[0]!;
    expect([x.stale, x.paid, x.fee, x.source, r.lookedUp]).toEqual([false, true, 0.6, "gateway", 1]);
    // it settles nothing
    expect((await h.row(opened.j.id)).paymentStatus).toBe("unpaid");
    // the row carries the key for the page's pay link
    expect(x.invoiceKey).toMatch(/^[a-f0-9]{32}$/);
  });

  // from test-payments.js and test-v300.js: 0 means none
  it("30 gaps: only 12 asked; lookups 0 asks nothing; 3 asks three", async () => {
    for (let i = 0; i < 30; i++) await h.seed({ id: "LM-90000" + String(i).padStart(2, "0"), invoiceNo: "inv-" + i, createdAt: new Date(h.clock.t - i * 60e3) });
    let n0 = h.thawaniCalls().length;
    const r = await listPayments(h.deps, { limit: 50 });
    expect([h.thawaniCalls().length - n0, r.pending, r.rows.filter((x) => x.stale).length]).toEqual([12, 18, 30]);
    n0 = h.thawaniCalls().length;
    await listPayments(h.deps, { lookups: 0 });
    expect(h.thawaniCalls().length - n0).toBe(0);
    await listPayments(h.deps, { lookups: 3 });
    expect(h.thawaniCalls().length - n0).toBe(3);
  });

  it("sorted by date before paging; a date range the figures follow", async () => {
    for (let i = 0; i < 5; i++) await h.seed({ id: "LM-91000" + i, createdAt: new Date(h.clock.t - i * 86400e3) });
    const r = await listPayments(h.deps, { limit: 2, skip: 1, lookups: 0 });
    expect(r.rows.map((x) => x.orderId)).toEqual(["LM-910001", "LM-910002"]);
    expect([r.more, r.total]).toEqual([true, 5]);
    const w = await listPayments(h.deps, { from: h.clock.t - 1.5 * 86400e3, lookups: 0 });
    expect(w.rows.map((x) => x.orderId)).toEqual(["LM-910000", "LM-910001"]);
  });

  it("no Thawani key does not blank the page: the gaps are just not looked up", async () => {
    const g = await payHarness({ env: { THAWANI_SECRET_KEY: "" } });
    await g.seed({ id: "LM-920001", invoiceNo: "inv-1" });
    const r = await listPayments(g.deps, {});
    expect([r.rows.length, r.gateway, r.mode, g.thawaniCalls().length]).toEqual([1, false, "", 0]);
  });

  it("fromOrder: a refunded payment is a paid row that is refunded; a pending one is in progress", async () => {
    const o = await h.seed({ id: "LM-920002", paymentStatus: "refunded", refunded: true, status: "void" });
    expect([fromOrder(o).paid, fromOrder(o).refunded, fromOrder(o).status]).toEqual([true, true, "successful"]);
    const p = await h.seed({ id: "LM-920003" });
    expect(fromOrder(p).status).toBe("inProccess");
    expect(totals([fromOrder(p)]).failed).toBe(1);
  });

  it("Ask Thawani about one order: its charges folded on, nothing written", async () => {
    const opened = await h.openCard();
    h.th().decline(opened.j.session_id, "Insufficient funds");
    const a = await askThawani(h.deps, opened.j.id);
    expect(a.payments.map((p) => p.status)).toEqual(["failed"]);
    expect([a.row.paid, a.row.reason]).toEqual([false, "Insufficient funds"]);
    expect((await h.row(opened.j.id)).lastPaymentError).toBeNull();
  });
});

describe("a refund (thawani.refund)", () => {
  async function paidOrder(status: "new" | "prep" | "done" = "prep") {
    const opened = await h.openCard();
    const { payment: p } = h.th().payByReference(opened.j.id);
    await h.verify({ ref: opened.j.id });
    if (status !== "new") await h.db.execute(`update orders set status = '${status}' where id = '${opened.j.id}'` as never);
    return { id: opened.j.id as string, pid: String(p.payment_id) };
  }

  // from test-payments.js and test-v314.js (A1): a refund is the end of the sale
  it("re-reads the charge, refunds it, and the order is refunded AND cancelled — never fulfilled after", async () => {
    const { id, pid } = await paidOrder("prep");
    const n0 = h.thawaniCalls().length;
    const r = await refundPayment(h.deps, { paymentId: pid, reason: "customer cancelled" }, "shopkeeper");
    expect(r).toEqual({ ok: true, refundId: "ref_1", orderId: id, amount: 28 });
    const calls = h.thawaniCalls().slice(n0);
    expect(calls.map((c) => c.method + " " + c.path.split("?")[0])).toEqual(["GET /api/v1/payments/" + pid, "POST /api/v1/refunds"]);
    expect(calls[1]!.body).toEqual({ payment_id: pid, reason: "customer cancelled", metadata: { order_id: id } });
    const o = await h.row(id);
    expect([o.refunded, o.paymentStatus, o.status]).toEqual([true, "refunded", "void"]);
    expect(isLive(o)).toBe(false);
    expect(transition(o, "new", "admin")).toBe("refunded");
    expect(transition(o, "prep", "push")).not.toBeNull();
    const ev = (await h.db.select().from(orderEvents).where(eq(orderEvents.orderId, id))).pop()!;
    expect([ev.kind, ev.by, (ev.detail as { reason: string }).reason]).toEqual(["refund", "admin", "customer cancelled"]);
  });

  it("a delivered order refunded keeps its status (a return)", async () => {
    const { id, pid } = await paidOrder("done");
    await refundPayment(h.deps, { paymentId: pid, reason: "returned" }, "shopkeeper");
    const o = await h.row(id);
    expect(o.status + " " + o.paymentStatus).toBe("done refunded");
  });

  it("refused: already refunded (re-read says so), a failed charge, no reason, a bad id — before any money moves", async () => {
    const { pid } = await paidOrder();
    await refundPayment(h.deps, { paymentId: pid, reason: "first" }, "a");
    await expect(refundPayment(h.deps, { paymentId: pid, reason: "again" }, "a")).rejects.toMatchObject({ code: "already_refunded", status: 409 });
    const opened = await h.openCard();
    const failed = h.th().decline(opened.j.session_id);
    await expect(refundPayment(h.deps, { paymentId: String(failed.payment_id), reason: "x y z" }, "a")).rejects.toMatchObject({ code: "not_successful" });
    const n0 = h.thawaniCalls().length;
    await expect(refundPayment(h.deps, { paymentId: pid, reason: "  " }, "a")).rejects.toMatchObject({ code: "reason_required", status: 400 });
    await expect(refundPayment(h.deps, { paymentId: "../orders", reason: "valid" }, "a")).rejects.toMatchObject({ code: "bad_payment_id", status: 400 });
    await expect(refundPayment(h.deps, { paymentId: "pay_missing1", reason: "valid" }, "a")).rejects.toMatchObject({ code: "no_such_payment", status: 404 });
    expect(h.thawaniCalls().slice(n0).filter((c) => c.method === "POST").length).toBe(0);
    expect(h.th().state.refunds.length).toBe(1);
  });

  it("an order found by the payment's own invoice when the payment id was never stored", async () => {
    const opened = await h.openCard();
    const { payment: p } = h.th().payByReference(opened.j.id);
    const r = await refundPayment(h.deps, { paymentId: String(p.payment_id), reason: "never came back" }, "a");
    expect(r.orderId).toBe(opened.j.id);
    expect((await h.row(opened.j.id)).paymentStatus).toBe("refunded");
  });
});

describe("marking paid by hand", () => {
  it("only with Thawani's payment id, read back from Thawani; settled as the webhook settles; the Purchase once", async () => {
    const opened = await h.openCard();
    const { payment: p } = h.th().payByReference(opened.j.id, { fee: 500 });
    const r = await markPaidByHand(h.deps, { id: opened.j.id, paymentId: p.payment_id }, "shopkeeper");
    expect(r).toEqual({ ok: true, id: opened.j.id, paymentId: p.payment_id, amount: 28 });
    const o = await h.row(opened.j.id);
    expect([o.status, o.paymentStatus, o.paymentId, o.gatewayFee, o.netAmount]).toEqual(["new", "paid", p.payment_id, 0.5, 27.5]);
    expect(h.purchases()).toBe(1);
    await expect(markPaidByHand(h.deps, { id: opened.j.id, paymentId: p.payment_id }, "x")).rejects.toMatchObject({ code: "already_paid" });
  });

  it("refused without a real successful charge for the recorded amount", async () => {
    const opened = await h.openCard();
    await expect(markPaidByHand(h.deps, { id: opened.j.id, paymentId: "x" }, "a")).rejects.toMatchObject({ code: "bad_payment_id" });
    await expect(markPaidByHand(h.deps, { id: opened.j.id, paymentId: "pay_nothere" }, "a")).rejects.toMatchObject({ code: "no_such_payment" });
    const failed = h.th().decline(opened.j.session_id);
    await expect(markPaidByHand(h.deps, { id: opened.j.id, paymentId: failed.payment_id }, "a")).rejects.toMatchObject({ code: "not_successful" });
    const { payment: p } = h.th().payByReference(opened.j.id, { amount: 27000 });
    await expect(markPaidByHand(h.deps, { id: opened.j.id, paymentId: p.payment_id }, "a")).rejects.toMatchObject({ code: "amount_mismatch", extra: { expected_baisa: 28000, paid_baisa: 27000 } });
    expect((await h.row(opened.j.id)).paymentStatus).toBe("unpaid");
    // a person who checked the figure may accept it
    await markPaidByHand(h.deps, { id: opened.j.id, paymentId: p.payment_id, acceptAmount: true }, "a");
    expect((await h.row(opened.j.id)).paymentStatus).toBe("paid");
  });

  it("a charge on another order's invoice is refused", async () => {
    const a = await h.openCard();
    const b = await h.openCard();
    const { payment: p } = h.th().payByReference(b.j.id);
    await expect(markPaidByHand(h.deps, { id: a.j.id, paymentId: p.payment_id }, "a")).rejects.toMatchObject({ code: "other_invoice" });
  });
});
