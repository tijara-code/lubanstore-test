/**
 * The Payments tab's arithmetic (src/admin/tabs/payments/pay.ts): one state per transaction, the
 * tiles, the totals agreeing with the server's, the filter, the refund/mark-paid/pay-link rules,
 * the CSV and the refusals in words.
 */
import { describe, expect, it } from "vitest";
import { fromOrder, row as gatewayRow, totals as serverTotals } from "../../../src/server/domain/payments/admin";
import type { OrderRow } from "../../../src/server/db/schema";
import { ApiError } from "../../../src/admin/data/api";
import type { PaymentRow } from "../../../src/admin/data/insights";
import {
  canMarkPaid, canRefund, payCsv, payKind, payKinds, payLinkOf, payRefusal, payRows, payState, payTotals, PAY_CSV_HEAD, PAY_FILTERS,
} from "../../../src/admin/tabs/payments/pay";

const R = (over: Partial<PaymentRow>): PaymentRow => ({
  paymentId: "", invoice: "", intent: "", status: "", paid: false, refunded: false, amount: 0, fee: 0, net: 0, card: "", cardType: "", at: null, reason: "", refunds: [],
  source: "order", pay: "card", ...over,
});

describe("one state per transaction (v446)", () => {
  // from test-v446.js: 2. payments: one state per transaction
  const rows = [
    R({ paid: true, amount: 10, status: "successful" }),
    R({ paid: true, refunded: true, amount: 7, status: "successful" }),
    R({ amount: 5, status: "inProccess" }),
    R({ amount: 4, status: "cancelled" }),
    R({ amount: 3, status: "unpaid" }),
    R({ source: "cod", amount: 6, status: "cod" }),
  ];
  it("settled, refunded, pending (Thawani's own spelling), failed, failed, to collect", () => {
    expect(rows.map(payKind).join(",") + " " + payState(rows[5]!).t).toBe("settled,refunded,pending,failed,failed,pending To collect");
  });
  it("the tiles' counts", () => {
    expect(payKinds(rows)).toEqual({ all: 6, settled: 1, pending: 2, pendingOmr: 11, failed: 2, refunded: 1 });
  });
  it("the five filters, and the filter reads the same state as the pill", () => {
    expect(PAY_FILTERS.map((f) => f.value).join(",")).toBe("all,settled,pending,failed,refunded");
    expect(payRows(rows, { kind: "failed", q: "" }).map((r) => r.amount)).toEqual([4, 3]);
    expect(payRows(rows, { kind: "pending", q: "" }).map((r) => r.amount)).toEqual([5, 6]);
  });
  // from test-v447.js: Payments' "inProccess" is in progress, not a failed attempt
  it("an in-progress card payment is never counted as failed", () => {
    expect(payKind(R({ status: "inProccess" }))).toBe("pending");
    expect(payKind(R({ status: "inprocess" }))).toBe("pending");
    expect(payState(R({ status: "inProccess" }))).toEqual({ c: "pending", t: "Pending" });
    expect(payKinds([R({ status: "inProccess", amount: 35 })]).failed).toBe(0);
  });
  it("the pills' tints", () => {
    expect(payState(R({ paid: true, status: "successful" }))).toEqual({ c: "paid", t: "Settled" });
    expect(payState(R({ paid: true, refunded: true }))).toEqual({ c: "refunded", t: "Refunded" });
    expect(payState(R({ status: "cancelled" }))).toEqual({ c: "unpaid", t: "Failed" });
  });
});

describe("the totals agree with the server's", () => {
  // from test-payments.js: the totals
  it("three charges, one failed (not money), fees summed, net = gross − fees, refunds counted apart", () => {
    const pay = (o: Record<string, unknown>) => gatewayRow({ payment_id: "20260907021600", checkout_invoice: "1", status: "successful", amount: 32352, fee: 647, ...o } as never);
    const many = [
      pay({}),
      pay({ payment_id: "2", amount: 19900, fee: 398 }),
      pay({ payment_id: "3", status: "failed", amount: 78000, fee: 0 }),
      pay({ payment_id: "4", amount: 9900, fee: 198, refunded: true, refunds: [{ status: "successful", amount: 9900 }] }),
    ] as PaymentRow[];
    const t = payTotals(many);
    expect(t.n).toBe(3);
    expect(t.failed).toBe(1);
    expect(t.gross).toBe(62.152);
    expect(t.fees).toBe(1.243);
    expect(t.net).toBe(Math.round((t.gross - t.fees) * 1000) / 1000);
    expect(t.refunded).toBe(9.9);
    expect(payTotals([]).gross).toBe(0);
    expect(payTotals(many)).toEqual(serverTotals(many as never));
  });

  // from test-payments.js: client/server totals agree (rows from fromOrder)
  it("over rows made from orders, key by key, with identical key sets", () => {
    const o = (x: Record<string, unknown>) =>
      fromOrder({ status: "done", pay: "card", cur: "OMR", countryCode: "OM", refunded: false, trashed: false, createdAt: new Date("2026-10-01T10:00:00Z"), paidAt: null, ...x } as unknown as OrderRow);
    const rows = [
      o({ id: "LM-1", omr: 20, gatewayFee: 0.6, paymentStatus: "paid", paymentId: "p1", total: 20 }),
      o({ id: "LM-9", omr: 11, paymentStatus: "unpaid", status: "void", total: 11 }),
      o({ id: "LM-2", omr: 9, gatewayFee: 0.18, paymentStatus: "paid", paymentId: "p2", total: 9 }),
    ] as unknown as PaymentRow[];
    const a = serverTotals(rows as never);
    const b = payTotals(rows);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    expect(b).toEqual(a);
    expect(a.failed).toBe(1);
    expect(a.owedN).toBe(0);
    expect(a.gross).toBe(29);
    expect(a.fees).toBe(0.78);
    expect(a.net).toBe(28.22);
    expect(a.cash).toBe(0);
    expect(Math.round((a.net + a.fees) * 1000) / 1000).toBe(a.gross);
  });
});

describe("what a row offers", () => {
  // from test-payments.js (panel): refund only when paid && !refunded
  it("refund: a settled, un-refunded charge with its payment id", () => {
    expect(canRefund(R({ paid: true, paymentId: "p1" }))).toBe(true);
    expect(canRefund(R({ paid: true, refunded: true, paymentId: "p1" }))).toBe(false);
    expect(canRefund(R({ paid: false, paymentId: "p1" }))).toBe(false);
    expect(canRefund(R({ paid: true, paymentId: "" }))).toBe(false);
  });
  it("mark paid by hand: an unpaid card order not refunded", () => {
    expect(canMarkPaid(R({ orderId: "LM-1" }))).toBe(true);
    expect(canMarkPaid(R({ orderId: "LM-1", paid: true }))).toBe(false);
    expect(canMarkPaid(R({ orderId: "LM-1", refunded: true }))).toBe(false);
    expect(canMarkPaid(R({ orderId: "LM-1", source: "cod" }))).toBe(false);
  });
  // from test-payments.js: an unpaid card row offers the same /resume link (not on paid, not COD, not without a key)
  it("the pay link is the reminder's /resume link", () => {
    const k = "a".repeat(32);
    expect(payLinkOf(R({ orderId: "LM-123", invoiceKey: k }), "https://lubanmusk.com/")).toBe("https://lubanmusk.com/resume/LM-123?k=" + k);
    expect(payLinkOf(R({ orderId: "LM-123", invoiceKey: k, paid: true }), "https://x")).toBe("");
    expect(payLinkOf(R({ orderId: "LM-123", invoiceKey: k, pay: "cod" }), "https://x")).toBe("");
    expect(payLinkOf(R({ orderId: "LM-123" }), "https://x")).toBe("");
  });
  it("search: order, invoice, payment id, card, customer, status", () => {
    const rows = [R({ orderId: "LM-1", invoice: "2026", card: "4242", customer: "سالم" }), R({ orderId: "LM-2", paymentId: "pay_9" })];
    expect(payRows(rows, { kind: "all", q: "4242" }).length).toBe(1);
    expect(payRows(rows, { kind: "all", q: "PAY_9" })[0]!.orderId).toBe("LM-2");
    expect(payRows(rows, { kind: "all", q: "سالم" })[0]!.orderId).toBe("LM-1");
  });
});

describe("the CSV and the refusals", () => {
  // from test-payments.js: CSV export thawani-payments.csv; v334: Net = settled − fee (here the row's net)
  it("the export's columns, and Net is what reaches the bank", () => {
    const out = payCsv([R({ paymentId: "p1", invoice: "i1", orderId: "LM-1", paid: true, amount: 20, fee: 0.6, net: 19.4, status: "successful", card: "4242", cardType: "Visa", at: "2026-10-01T10:00:00.000Z" })]);
    expect(out[0]).toEqual(PAY_CSV_HEAD);
    expect(out[1]).toEqual(["p1", "i1", "LM-1", "", "successful", "Settled", "", 20, 0.6, 19.4, "4242", "Visa", "2026-10-01T10:00:00.000Z"]);
  });
  it("every refusal in words", () => {
    expect(payRefusal(new ApiError("already_refunded", 409))).toBe("Thawani says this payment has already been refunded.");
    expect(payRefusal(new ApiError("reason_required", 400))).toBe("A refund needs a reason.");
    expect(payRefusal(new ApiError("refund_failed", 502, { detail: "Invalid payment" }))).toBe("Thawani refused the refund: Invalid payment");
    expect(payRefusal(new ApiError("amount_mismatch", 409, { expected_baisa: 30000, paid_baisa: 29000 }))).toBe("Thawani's charge is 29 OMR; the order recorded 30 OMR.");
    expect(payRefusal(new ApiError("other_invoice", 409, { invoice: "77" }))).toBe("That payment belongs to another checkout, not this order's (invoice 77).");
    expect(payRefusal(new ApiError("no_such_payment", 404))).toBe("Thawani has no payment with that id.");
    expect(payRefusal(new ApiError("thawani_not_configured", 409))).toBe("No Thawani keys are set on the server.");
  });
});
