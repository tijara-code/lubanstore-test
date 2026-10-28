/**
 * GET /api/pay/verify?ref=LM-…  — the shopper is back on the success URL.
 *
 * The redirect proves nothing (anyone can type ?paid=LM-…), so an order is marked paid only
 * after asking Thawani what happened to it, and only if the amount it reports is the amount
 * recorded before the shopper left. Public: anyone with an order number may call it, so it
 * acts only on a card attempt still waiting for its money (or a card attempt switched to cash
 * whose old card page was then paid), and it tells the amount only to the browser that
 * opened the session (it sends back the session id it was given) or holds the order's key.
 *
 * Answers, as the original:
 *   { ok, paid:true, id, already:true [, status, amount_omr] }      already settled
 *   { ok, paid:false, id, settled:true [, status] }                 not ours to act on
 *   { ok, paid:false, status, id }                                  Thawani says not paid
 *   { ok, paid:true, id, ga4 [, status, amount_omr] }               settled now
 *   400 bad_ref · 404 unknown_order · 409 amount_mismatch · 502 gateway_error / db_read_failed /
 *   db_write_failed (the page asks again) · 503 gateway_not_configured
 */
import { and, eq } from "drizzle-orm";
import { baisaToOmr } from "../../../shared/money";
import type { Deps } from "../../core/deps";
import { errorText } from "../../core/log";
import { orders, type OrderRow } from "../../db/schema";
import { reportPurchase, type LiveRequest } from "../purchase";
import { isOrderId, recordEvent, sameSecret } from "./events";
import { amountAgrees, markPaid, paidPatch } from "./settle";

export interface Answer {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const ok = (body: Record<string, unknown>, status = 200): Answer => ({ status, body });

export async function readOrder(deps: Deps, id: string): Promise<OrderRow | null> {
  const rows = await deps.db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return rows[0] || null;
}

/** Who sends GA4's purchase when the server did not just report one. */
export function ga4Who(deps: Deps): "server" | "page" {
  return deps.env.GA4_MEASUREMENT_ID && deps.env.GA4_API_SECRET ? "server" : "page";
}

/** A card attempt still waiting for its money (or lapsed for want of it). */
function isOpen(o: OrderRow): boolean {
  return (o.paymentStatus === "unpaid" || o.paymentStatus === "cancelled") && !o.refunded && !o.trashed && o.pay !== "cod";
}
/** A card attempt switched to cash from the reminder link, still that cash order. */
function isCodCard(o: OrderRow): boolean {
  return o.pay === "cod" && o.paymentStatus === "cod" && !o.refunded && !o.trashed && !!(o.sessionId || o.invoiceNo) && Number(o.amountBaisa) > 0;
}

export async function verifyPayment(deps: Deps, q: { ref: string; sid?: string; k?: string }, live: LiveRequest): Promise<Answer> {
  const th = deps.services.thawani;
  if (!th.configured()) return ok({ ok: false, error: "gateway_not_configured" }, 503);
  const ref = String(q.ref || "").trim();
  if (!isOrderId(ref)) return ok({ ok: false, error: "bad_ref" }, 400);
  const sid = String(q.sid || "").trim().slice(0, 120);
  const key = String(q.k || "").trim().slice(0, 64);

  let order: OrderRow | null;
  try {
    order = await readOrder(deps, ref);
  } catch (e) {
    await deps.log.error("pay-verify", "could not read " + ref + ": " + errorText(e), { orderId: ref });
    return ok({ ok: false, error: "db_read_failed" }, 502);
  }
  if (!order) return ok({ ok: false, error: "unknown_order" }, 404);

  // (audit A22) the amount is told only to the payer's own browser
  const mine = !!(sid && order.sessionId && sid === order.sessionId) || (!!key && sameSecret(key, order.invoiceKey));
  const amountOmr = order.amountBaisa ? baisaToOmr(order.amountBaisa) : null;

  if (order.paymentStatus === "paid") {
    return ok({ ok: true, paid: true, id: ref, already: true, ...(mine ? { status: "paid", amount_omr: amountOmr } : {}) });
  }
  // a binned attempt is not settled by its old page either
  if (order.trashed) return ok({ ok: true, paid: false, id: ref, settled: true });

  // ONLY A CARD ATTEMPT STILL WAITING FOR ITS MONEY: a refunded order is never written back to
  // paid, and a cash order is never voided by its old session's "cancelled".
  const open = isOpen(order);
  // (v336) a card attempt turned into cash from the reminder link whose card page, still open,
  // was then paid: settled here as the webhook settles it, only if Thawani calls it paid.
  const codCard = !open && isCodCard(order);
  if (!open && !codCard) {
    return ok({ ok: true, paid: false, id: ref, settled: true, ...(mine ? { status: order.paymentStatus || "unknown" } : {}) });
  }

  let sess;
  let raw;
  try {
    const r = await th.sessionByReference(ref);
    sess = r.session || {};
    raw = r.raw;
  } catch (e) {
    await deps.log.error("pay-verify", "Thawani did not answer for " + ref + ": " + errorText(e), { orderId: ref });
    return ok({ ok: false, error: "gateway_error" }, 502);
  }
  const payStatus = String(sess.payment_status || "").toLowerCase();
  const paidBaisa = Number(sess.total_amount || 0);
  const invoice = sess.invoice ? String(sess.invoice) : null;

  if (payStatus !== "paid") {
    if (codCard) return ok({ ok: true, paid: false, id: ref, settled: true, ...(mine ? { status: order.paymentStatus } : {}) });
    // a cancellation recorded, so the dashboard tells it apart from an abandon — conditional,
    // so a payment landing between the read and this write is not voided
    if (payStatus === "cancelled" && order.paymentStatus !== "cancelled") {
      try {
        const at = new Date(deps.now());
        await deps.db.transaction(async (tx) => {
          const hit = await tx
            .update(orders)
            .set({ paymentStatus: "cancelled", status: "void", updatedAt: at })
            .where(and(eq(orders.id, ref), eq(orders.status, "pending"), eq(orders.paymentStatus, "unpaid")))
            .returning({ id: orders.id });
          if (hit[0]) await recordEvent(tx, { orderId: ref, kind: "payment", from: "pending/unpaid", to: "void/cancelled", by: "shopper", at, detail: { cancelled: true } });
        });
      } catch {
        /* the answer is the same either way */
      }
    }
    return ok({ ok: true, paid: false, status: payStatus || "unpaid", id: ref });
  }

  const expected = Number(order.amountBaisa || 0);
  if (!amountAgrees(expected, paidBaisa)) {
    await deps.log.warn("pay-verify", "amount_mismatch on " + ref + ": paid " + paidBaisa + " expected " + expected, { orderId: ref });
    // (A22) the figures only to the payer's own browser
    return ok({ ok: false, error: "amount_mismatch", id: ref, ...(mine ? { expected_baisa: expected, paid_baisa: paidBaisa } : {}) }, 409);
  }

  // card type, masked card, the fee — best effort: the order is marked paid without them
  const enriched = await th.paymentsForInvoice(invoice);
  const gross = baisaToOmr(paidBaisa || expected);
  let settled;
  try {
    // the row is read again under its lock and the condition chosen from THAT row: a cash
    // switch from the reminder link that committed since the read above is a card attempt
    // switched to cash whose card page was paid (v336) — settled as such, never answered
    // "already paid" while the order says cash
    settled = await markPaid(
      deps, ref,
      (fresh) => (isOpen(fresh) ? "open" : isCodCard(fresh) ? "cod_card" : null),
      (fresh) => (amountAgrees(fresh.amountBaisa, paidBaisa)
        ? paidPatch(fresh, {
          invoice, enriched, gross, now: deps.now(),
          gateway: { verified_at: new Date(deps.now()).toISOString(), paid_session: raw, payment: enriched ? enriched.raw : null },
        })
        : null),
      "shopper",
      { via: "verify" },
    );
  } catch (e) {
    await deps.log.error("pay-verify", "could not settle " + ref + ": " + errorText(e), { orderId: ref });
    return ok({ ok: false, error: "db_write_failed" }, 502);
  }
  const theirs = mine ? { status: "paid", amount_omr: gross } : {};
  if (!settled.changed || !settled.order) {
    // answered from the row as it stands now, never assumed
    const now = settled.fresh;
    // (v327) the webhook settled it first — its Purchase stands; this answer is the one the
    // shopper would get a moment later
    if (now && now.paymentStatus === "paid") return ok({ ok: true, paid: true, id: ref, already: true, ga4: ga4Who(deps), ...theirs });
    if (now && (isOpen(now) || isCodCard(now)) && !amountAgrees(now.amountBaisa, paidBaisa)) {
      await deps.log.warn("pay-verify", "amount_mismatch on " + ref + ": paid " + paidBaisa + " expected " + Number(now.amountBaisa || 0), { orderId: ref });
      return ok({ ok: false, error: "amount_mismatch", id: ref, ...(mine ? { expected_baisa: Number(now.amountBaisa || 0), paid_baisa: paidBaisa } : {}) }, 409);
    }
    return ok({ ok: true, paid: false, id: ref, settled: true, ...(mine && now ? { status: now.paymentStatus || "unknown" } : {}) });
  }

  // the Purchase: only on the transition to paid; this request is the shopper's own
  let ga4: "server" | "page" = "page";
  try {
    ga4 = (await reportPurchase(deps, settled.order, live)).ga4;
  } catch (e) {
    await deps.log.error("pay-verify", "the Purchase report failed for " + ref + ": " + errorText(e), { orderId: ref });
  }
  // (v338) Empower gets it from the auto push run, never from this answer
  return ok({ ok: true, paid: true, id: ref, ga4, ...theirs });
}
