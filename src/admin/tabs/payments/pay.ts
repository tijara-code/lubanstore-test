/**
 * THE PAYMENTS TAB'S ARITHMETIC — pure functions over the rows GET /payments answers (our card
 * orders, with what the gateway wrote on them). Ported from the original panel (v446): ONE
 * state per transaction, read by the filter, the pill and the tiles alike.
 *
 *   settled    the money is in
 *   pending    a card payment still in progress — Thawani spells it "inProccess" — or cash on
 *              delivery still to collect (none on this page: it lists card orders only)
 *   failed     a card attempt that did not go through (declined, cancelled, abandoned)
 *   refunded   taken, then given back
 *
 * The totals are the server's `totals()` (domain/payments/admin.ts) over the rows on screen, so
 * narrowing the dates or the state narrows the figures: tests/web/admin/payments/pay.test.ts
 * runs both over the same rows (test-payments: "client/server totals agree").
 */
import type { PaymentRow } from "../../data/insights";
import { ApiError } from "../../data/api";
import { explain } from "../../lib/words";
import { money } from "../../lib/format";

export type PayKind = "settled" | "pending" | "failed" | "refunded";
export type PayFilter = "all" | PayKind;
export const PAY_FILTERS: Array<{ value: PayFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "settled", label: "Settled" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

/* a deny-list: a row off the gateway carries no source, and defaulting it to cash would understate the card takings */
const NOT_CARD: Record<string, 1> = { cod: 1, offline: 1, "website-offline": 1 };
export const isCard = (r: Pick<PaymentRow, "source">) => !NOT_CARD[String(r.source || "")];

export function payKind(r: Pick<PaymentRow, "paid" | "refunded" | "status" | "source">): PayKind {
  if (r.refunded) return "refunded";
  if (r.paid) return "settled";
  // the server spells it Thawani's way, "inProccess": in progress, NOT failed (v447)
  if (!isCard(r) || /proc+ess|pending/i.test(String(r.status || ""))) return "pending";
  return "failed";
}

/** The pill: its tint and its word. */
export function payState(r: Pick<PaymentRow, "paid" | "refunded" | "status" | "source">): { c: string; t: string } {
  const k = payKind(r);
  if (k === "refunded") return { c: "refunded", t: "Refunded" };
  if (k === "settled") return { c: "paid", t: "Settled" };
  if (k === "pending") return { c: "pending", t: isCard(r) ? "Pending" : "To collect" };
  return { c: "unpaid", t: "Failed" };
}

export interface Kinds {
  all: number;
  settled: number;
  pending: number;
  pendingOmr: number;
  failed: number;
  refunded: number;
}
/** The tiles' counts: how many of each, and what is still pending (OMR). */
export function payKinds(rows: ReadonlyArray<Pick<PaymentRow, "paid" | "refunded" | "status" | "source" | "amount">>): Kinds {
  const k: Kinds = { all: 0, settled: 0, pending: 0, pendingOmr: 0, failed: 0, refunded: 0 };
  for (const r of rows) {
    const x = payKind(r);
    k.all++;
    k[x]++;
    if (x === "pending") k.pendingOmr += Number(r.amount) || 0;
  }
  k.pendingOmr = Math.round(k.pendingOmr * 1000) / 1000;
  return k;
}

export interface Totals {
  n: number; gross: number; fees: number; net: number; refunded: number; refundedN: number; failed: number;
  cash: number; owed: number; owedN: number;
}
/** Settled, owed and failed — the server's totals(): only a card payment can fail. */
export function payTotals(rows: ReadonlyArray<PaymentRow>): Totals {
  const t: Totals = { n: 0, gross: 0, fees: 0, net: 0, refunded: 0, refundedN: 0, failed: 0, cash: 0, owed: 0, owedN: 0 };
  for (const r of rows) {
    if (!r.paid) {
      if (isCard(r)) t.failed++;
      else { t.owedN++; t.owed += r.amount; }
      continue;
    }
    t.n++;
    t.gross += r.amount;
    if (isCard(r)) { t.fees += r.fee; t.net += r.net; } else t.cash += r.amount;
    if (r.refunded) {
      t.refundedN++;
      t.refunded += (r.refunds || []).reduce((s, x) => s + (x.amount || 0), 0) || r.amount;
    }
  }
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  t.gross = r3(t.gross); t.fees = r3(t.fees); t.net = r3(t.net); t.refunded = r3(t.refunded); t.cash = r3(t.cash); t.owed = r3(t.owed);
  return t;
}

/** The rows the state filter and the search let through (order, invoice, payment id, card, customer, status). */
export function payRows(rows: readonly PaymentRow[], f: { kind: PayFilter; q: string }): PaymentRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.kind !== "all" && payKind(r) !== f.kind) return false;
    if (!q) return true;
    return [r.orderId, r.invoice, r.paymentId, r.card, r.customer, r.status, r.session].join(" ").toLowerCase().indexOf(q) > -1;
  });
}

/** Only a settled, un-refunded charge with a payment id can be sent back. */
export const canRefund = (r: PaymentRow) => r.paid && !r.refunded && !!r.paymentId;
/** An unpaid card order (not refunded) can be marked paid — with Thawani's payment id. */
export const canMarkPaid = (r: PaymentRow) => !r.paid && !r.refunded && isCard(r) && !!r.orderId;
/** The /resume link the WhatsApp reminder carries: an unpaid card order with its invoice key. */
export const payLinkOf = (r: PaymentRow, origin: string) =>
  !r.paid && !r.refunded && r.pay === "card" && r.invoiceKey && r.orderId
    ? origin.replace(/\/+$/, "") + "/resume/" + encodeURIComponent(r.orderId) + "?k=" + encodeURIComponent(r.invoiceKey)
    : "";

export const PAY_CSV_HEAD = ["Payment ID", "Invoice", "Order", "Customer", "Status", "State", "Refunded", "Total OMR", "Fee OMR", "Net OMR", "Card", "Type", "Date"];
export function payCsv(rows: readonly PaymentRow[]): Array<Array<string | number>> {
  return [PAY_CSV_HEAD, ...rows.map((r) => [r.paymentId, r.invoice, r.orderId || "", r.customer || "", r.status, payState(r).t, r.refunded ? "yes" : "", r.amount, r.fee, r.net, r.card, r.cardType, r.at || ""])];
}

/* ---------------- refusals, in words ---------------- */

const SAY: Record<string, string> = {
  already_refunded: "Thawani says this payment has already been refunded.",
  not_successful: "Thawani says that payment did not go through: only a successful payment counts.",
  reason_required: "A refund needs a reason.",
  thawani_not_configured: "No Thawani keys are set on the server.",
  no_such_payment: "Thawani has no payment with that id.",
  bad_payment_id: "That is not a Thawani payment id.",
  no_id: "That is not an order number.",
  already_paid: "That order is already paid.",
  refunded: "That order was refunded: it cannot be marked paid.",
  trashed: "That order is in the trash. Restore it first.",
  gateway_error: "Thawani did not answer. Try again in a moment.",
  other_invoice: "That payment belongs to another checkout, not this order's.",
};

export function payRefusal(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "refund_failed") return "Thawani refused the refund" + (e.extra.detail ? ": " + String(e.extra.detail) : ".");
    if (e.code === "amount_mismatch") {
      const exp = Number(e.extra.expected_baisa) / 1000, paid = Number(e.extra.paid_baisa) / 1000;
      return "Thawani's charge is " + money(paid, "OMR") + "; the order recorded " + money(exp, "OMR") + ".";
    }
    if (e.code === "other_invoice" && e.extra.invoice) return SAY.other_invoice!.replace(".", " (invoice " + String(e.extra.invoice) + ").");
    if (SAY[e.code]) return SAY[e.code]!;
  }
  return explain(e);
}
