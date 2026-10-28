/**
 * THE PAYMENTS TAB'S DATA — card money taken on the website, from our own card orders (Thawani
 * has no list: every /payments query must name a checkout invoice or a payment intent), with
 * only the gaps looked up. Plus the two writes the tab makes: a refund (domain/payments/refunds.ts)
 * and "mark paid by hand" with Thawani's payment id.
 *
 * Every figure from Thawani is BAISA and is converted once, here at the edge; everything
 * downstream is OMR. "Ask Thawani" refreshes what the page shows and settles nothing.
 *
 * (The admin area wires these to its routes; see docs/notes/payments.md for the actions.)
 */
import { and, desc, eq } from "drizzle-orm";
import { baisaToOmr, r3 } from "../../../shared/money";
import type { Deps } from "../../core/deps";
import { fail } from "../../core/http";
import { orders, type OrderRow } from "../../db/schema";
import { fieldsOf, isPaidStatus, pickPayment, ThawaniError, type ThawaniPayment } from "../../services/thawani";
import { reportPurchase } from "../purchase";
import { markPaid, paidPatch } from "./settle";
import { readOrder } from "./verify";

export const isPaid = (p: ThawaniPayment | null | undefined) => !!p && isPaidStatus(p.status);

/** A payment carrying its refunds rather than the flag counts as refunded too. */
export function refunded(p: ThawaniPayment | null | undefined): boolean {
  if (!p) return false;
  if (p.refunded === true) return true;
  return (p.refunds || []).some((r) => String((r && r.status) || "").toLowerCase() === "successful");
}

export interface PaymentRow {
  orderId?: string;
  customer?: string;
  country?: string;
  orderTotal?: number | null;
  orderCur?: string;
  paymentId: string;
  invoice: string;
  session?: string;
  intent: string;
  status: string;
  paid: boolean;
  refunded: boolean;
  amount: number;
  fee: number;
  net: number;
  card: string;
  cardType: string;
  at: string | null;
  reason: string;
  refunds: Array<{ id: string; amount: number; status: string; reason: string; at: string | null }>;
  stale?: boolean;
  invoiceKey?: string;
  pay?: "card" | "cod";
  source?: string;
}

/** One row of Thawani's ledger, in our shape and our currency. */
export function row(p: ThawaniPayment | null | undefined): PaymentRow {
  const amount = p && p.amount != null ? baisaToOmr(p.amount) : 0;
  const fee = p && p.fee != null ? baisaToOmr(p.fee) : 0;
  return {
    paymentId: String((p && (p.payment_id || p.id)) || ""),
    invoice: String((p && p.checkout_invoice) || ""),
    intent: String((p && p.payment_intent) || ""),
    status: String((p && p.status) || ""),
    paid: isPaid(p),
    refunded: refunded(p),
    amount: Number.isFinite(amount) ? amount : 0,
    fee: Number.isFinite(fee) ? fee : 0,
    // what reaches the bank (Thawani's portal calls it Net)
    net: Number.isFinite(amount - fee) ? r3(amount - fee) : 0,
    card: String((p && p.masked_card) || ""),
    cardType: String((p && p.card_type) || ""),
    at: (p && p.created_at) || null,
    reason: String((p && p.reason) || ""),
    refunds: ((p && p.refunds) || []).map((x) => ({
      id: String((x && (x.refund_id || x.id)) || ""),
      amount: x && x.amount != null ? baisaToOmr(x.amount) : 0,
      status: String((x && x.status) || ""),
      reason: String((x && x.reason) || ""),
      at: (x && x.created_at) || null,
    })),
  };
}

/** A row from OUR order (what pay-verify and the webhook wrote) — the common case costs no call. */
export function fromOrder(o: OrderRow): PaymentRow {
  const gross = Number(o.omr) || 0;
  const fee = o.gatewayFee == null ? null : Number(o.gatewayFee);
  // a payment refunded through the panel was taken, then returned: a paid row that is refunded
  const paid = o.paymentStatus === "paid" || o.paymentStatus === "refunded";
  return {
    orderId: o.id,
    customer: o.name || "",
    country: o.countryCode || "",
    orderTotal: o.total == null ? null : Number(o.total),
    orderCur: o.cur || "",
    paymentId: String(o.paymentId || ""),
    invoice: String(o.invoiceNo || ""),
    session: String(o.sessionId || ""),
    intent: "",
    status: paid ? "successful" : o.paymentStatus === "cancelled" ? "cancelled" : o.status === "pending" ? "inProccess" : String(o.paymentStatus || ""),
    paid,
    refunded: !!o.refunded || o.paymentStatus === "refunded",
    amount: gross,
    fee: fee == null ? 0 : fee,
    net: fee == null ? gross : r3(gross - fee),
    card: String(o.maskedCard || ""),
    cardType: String(o.cardType || ""),
    at: (o.paidAt || o.createdAt || null) && new Date((o.paidAt || o.createdAt)!).toISOString(),
    reason: String(o.lastPaymentError || ""),
    refunds: [],
    // the gateway knows more than we do: an invoice but never the payment (abandoned, declined)
    stale: !o.paymentId && !!(o.invoiceNo || o.sessionId),
    // the same key the invoice and the WhatsApp reminder carry: the page's pay link for anything unpaid
    invoiceKey: String(o.invoiceKey || ""),
    pay: o.pay === "cod" ? "cod" : "card",
    source: o.pay === "cod" ? "cod" : "order",
  };
}

/** Fold a live payment onto the order's row: the gateway wins on its own charge. */
export function enrich(base: PaymentRow, p: ThawaniPayment | null): PaymentRow {
  if (!p) return base;
  const live = row(p);
  return {
    ...base,
    paymentId: live.paymentId || base.paymentId,
    invoice: live.invoice || base.invoice,
    intent: live.intent || base.intent,
    status: live.status || base.status,
    paid: live.paid,
    refunded: live.refunded || base.refunded,
    amount: live.amount || base.amount,
    fee: live.fee || base.fee,
    net: live.amount ? live.net : base.net,
    card: live.card || base.card,
    cardType: live.cardType || base.cardType,
    at: live.at || base.at,
    reason: live.reason || base.reason,
    refunds: live.refunds,
    stale: false,
    source: "gateway",
  };
}

/** May this be refunded? Every answer a refusal with a reason. */
export function refundable(p: ThawaniPayment | null | undefined): { ok: true } | { ok: false; why: "no_such_payment" | "not_successful" | "already_refunded" } {
  if (!p) return { ok: false, why: "no_such_payment" };
  if (!isPaid(p)) return { ok: false, why: "not_successful" };
  if (refunded(p)) return { ok: false, why: "already_refunded" };
  return { ok: true };
}

/** A reason is required (a refund nobody can explain in three months is a bad line); full refund only — no amount. */
export function refundBody(paymentId: string, reason: string, meta: Record<string, unknown> = {}) {
  return { payment_id: String(paymentId), reason: String(reason).trim().slice(0, 200), metadata: meta || {} };
}

const NOT_CARD: Record<string, 1> = { cod: 1, offline: 1, "website-offline": 1 };
const isCard = (r: PaymentRow) => !NOT_CARD[String(r.source || "")];

export interface Totals {
  n: number; gross: number; fees: number; net: number; refunded: number; refundedN: number; failed: number;
  cash: number; owed: number; owedN: number;
}

/** The figures above the table: settled, owed and failed — only a card payment can fail. */
export function totals(rows: PaymentRow[]): Totals {
  const t: Totals = { n: 0, gross: 0, fees: 0, net: 0, refunded: 0, refundedN: 0, failed: 0, cash: 0, owed: 0, owedN: 0 };
  for (const r of rows || []) {
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
      t.refunded += r.refunds.reduce((s, x) => s + (x.amount || 0), 0) || r.amount;
    }
  }
  t.gross = r3(t.gross); t.fees = r3(t.fees); t.net = r3(t.net); t.refunded = r3(t.refunded); t.cash = r3(t.cash); t.owed = r3(t.owed);
  return t;
}

export const SCAN = 5000;
export const MAX_LOOKUPS = 12;

/**
 * The Payments tab. `lookups`: how many gaps to ask Thawani about — 0 means none (the panel's
 * quiet refresh), missing means up to 12 ("Ask Thawani now"). `from`/`to` (ms) filter by the
 * row's date, so the figures follow the range.
 */
export async function listPayments(deps: Deps, q: { limit?: unknown; skip?: unknown; lookups?: unknown; from?: unknown; to?: unknown }) {
  const th = deps.services.thawani;
  // not a hard stop: a missing key costs the card details, not the page
  const gateway = th.configured();
  const limit = Math.min(100, Math.max(1, parseInt(String(q.limit), 10) || 50));
  const skip = Math.max(0, parseInt(String(q.skip), 10) || 0);

  const list = await deps.db
    .select()
    .from(orders)
    .where(and(eq(orders.pay, "card"), eq(orders.trashed, false)))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(SCAN);
  let all = list.map(fromOrder);
  const from = Number(q.from);
  const to = Number(q.to);
  if (Number.isFinite(from) || Number.isFinite(to)) {
    all = all.filter((r) => {
      const t = Date.parse(String(r.at || ""));
      return (!Number.isFinite(from) || t >= from) && (!Number.isFinite(to) || t < to);
    });
  }
  all.sort((a, b) => Date.parse(String(b.at || 0)) - Date.parse(String(a.at || 0)));
  const total = all.length;
  const rows = all.slice(skip, skip + limit);

  const gaps: number[] = [];
  let looked = 0;
  let take: number[] = [];
  if (gateway) {
    rows.forEach((r, i) => { if (r.stale && r.invoice) gaps.push(i); });
    const asked = parseInt(String(q.lookups), 10);
    take = gaps.slice(0, Number.isFinite(asked) ? Math.max(0, Math.min(MAX_LOOKUPS, asked)) : MAX_LOOKUPS);
    await Promise.all(take.map(async (i) => {
      const hit = await th.paymentsForInvoice(rows[i]!.invoice);
      if (hit) { rows[i] = enrich(rows[i]!, hit.payment); looked++; }
    }));
  }
  return {
    ok: true, rows, totals: totals(rows), limit, skip, more: skip + limit < total, total,
    gateway, lookedUp: looked, pending: Math.max(0, gaps.length - take.length), mode: gateway ? th.mode() : "",
  };
}

/** "Ask Thawani" about one order: its charges, folded onto its row. Settles nothing, writes nothing. */
export async function askThawani(deps: Deps, id: string) {
  const o = await readOrder(deps, id);
  if (!o) throw fail("no_such_order", 404, { id });
  const th = deps.services.thawani;
  if (!th.configured()) throw fail("thawani_not_configured", 409);
  const base = fromOrder(o);
  if (!o.invoiceNo) return { ok: true, row: base, payments: [] as ReturnType<typeof row>[] };
  let list: ThawaniPayment[];
  try {
    list = await th.listPayments({ invoice: o.invoiceNo, limit: 10 });
  } catch (e) {
    throw fail("gateway_error", 502, { detail: e instanceof ThawaniError ? e.message : "no answer" });
  }
  return { ok: true, row: enrich(base, pickPayment(list)), payments: list.map(row) };
}

const PAYMENT_ID = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Mark a card order paid by hand — only with Thawani's payment id, read back from Thawani: it
 * must be a successful charge on this order's invoice (or name no invoice) and, unless the
 * person confirmed a different figure (`acceptAmount`), for the amount the order recorded.
 * Settled exactly as the webhook settles it; the Purchase is reported when the row changed.
 */
export async function markPaidByHand(deps: Deps, body: { id?: unknown; paymentId?: unknown; acceptAmount?: unknown }, actor: string) {
  const id = String(body.id || "");
  const pid = String(body.paymentId || "").trim();
  if (!/^LM-\d{4,12}$/.test(id)) throw fail("no_id", 400);
  if (!PAYMENT_ID.test(pid)) throw fail("bad_payment_id", 400);
  const th = deps.services.thawani;
  if (!th.configured()) throw fail("thawani_not_configured", 409);
  const o = await readOrder(deps, id);
  if (!o) throw fail("no_such_order", 404, { id });
  if (o.paymentStatus === "paid") throw fail("already_paid", 409);
  if (o.paymentStatus === "refunded" || o.refunded) throw fail("refunded", 409);
  if (o.trashed) throw fail("trashed", 409);

  let p: ThawaniPayment | null;
  try {
    p = await th.paymentById(pid);
  } catch {
    throw fail("gateway_error", 502);
  }
  if (!p) throw fail("no_such_payment", 404);
  if (!isPaid(p)) throw fail("not_successful", 409);
  if (p.checkout_invoice && o.invoiceNo && String(p.checkout_invoice) !== String(o.invoiceNo)) {
    // a reopened link opens a new invoice: accept a charge on any session this order had
    const sessions = await th.sessionByReference(id).catch(() => null);
    const inv = sessions && sessions.session && sessions.session.invoice;
    if (String(inv || "") !== String(p.checkout_invoice)) throw fail("other_invoice", 409, { invoice: p.checkout_invoice });
  }
  const paidBaisa = Number(p.amount || 0);
  if (paidBaisa !== Number(o.amountBaisa || 0) && body.acceptAmount !== true) {
    throw fail("amount_mismatch", 409, { expected_baisa: Number(o.amountBaisa || 0), paid_baisa: paidBaisa });
  }
  const gross = baisaToOmr(paidBaisa);
  const enriched = { raw: { success: true, data: [p] }, payment: p, fields: fieldsOf(p) };
  const settled = await markPaid(
    deps, id, "settleable",
    // built from the row under its lock; the amount it is held to, again
    (fresh) => (paidBaisa !== Number(fresh.amountBaisa || 0) && body.acceptAmount !== true
      ? null
      : paidPatch(fresh, { invoice: p.checkout_invoice ? String(p.checkout_invoice) : fresh.invoiceNo, enriched, gross, now: deps.now(), gateway: { marked_by_hand: { by: actor, at: new Date(deps.now()).toISOString(), payment: p } } })),
    "admin", { via: "hand", actor, paymentId: pid },
  );
  if (!settled.changed || !settled.order) throw fail("stale", 409, { id });
  try {
    await reportPurchase(deps, settled.order);
  } catch {
    /* measurement only */
  }
  return { ok: true, id, paymentId: pid, amount: gross };
}
