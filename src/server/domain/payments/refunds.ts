/**
 * A REFUND — real money leaving a real account, with no undo. Every guard is a refusal with a
 * reason, and the payment is re-read from Thawani first: a stale list in someone's browser is
 * not authority to refund.
 *
 * After Thawani refunds, the order is told: refunded, payment_status "refunded" — and, when
 * it has not left yet (pending/new/prep), cancelled with the money, so it is never pushed or
 * shipped afterwards (status.ts's isLive/transition refuse a refunded order from then on). One
 * already shipped or delivered keeps its status (a return).
 */
import { errorText } from "../../core/log";
import { and, eq, inArray } from "drizzle-orm";
import type { Deps } from "../../core/deps";
import { fail } from "../../core/http";
import { orders, type OrderRow } from "../../db/schema";
import { ThawaniError, type ThawaniPayment } from "../../services/thawani";
import { refundBody, refundable, row } from "./admin";
import { recordEvent, standing } from "./events";

export async function refundPayment(deps: Deps, body: { paymentId?: unknown; reason?: unknown }, actor: string) {
  const th = deps.services.thawani;
  if (!th.configured()) throw fail("thawani_not_configured", 409);
  const pid = String(body.paymentId || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(pid)) throw fail("bad_payment_id", 400);
  const why = String(body.reason || "").trim();
  if (why.length < 3) throw fail("reason_required", 400);

  // which order: its invoice for the fallback lookup, its id for the refund's metadata
  let order: OrderRow | null = (await deps.db.select().from(orders).where(eq(orders.paymentId, pid)).limit(1))[0] || null;

  // re-read the charge: /payments/<id>, else the invoice-scoped query Thawani always honours
  let p: ThawaniPayment | null = null;
  try {
    p = await th.paymentById(pid);
  } catch {
    p = null;
  }
  if (!p && order && order.invoiceNo) {
    try {
      p = (await th.listPayments({ invoice: order.invoiceNo, limit: 10 })).filter((x) => String(x.payment_id) === pid)[0] || null;
    } catch {
      p = null;
    }
  }
  if (!p) throw fail("no_such_payment", 404);
  // not found by payment id (an order that never came back through verify): the payment names its checkout
  if (!order && p.checkout_invoice) {
    order = (await deps.db.select().from(orders).where(eq(orders.invoiceNo, String(p.checkout_invoice))).limit(1))[0] || null;
  }

  const may = refundable(p);
  if (!may.ok) throw fail(may.why, 409);
  const r = row(p);

  let out;
  try {
    out = await th.refund(refundBody(pid, why, order ? { order_id: order.id } : {}));
  } catch (e) {
    throw fail("refund_failed", 502, { detail: e instanceof ThawaniError ? e.message : String((e as Error)?.message || e) });
  }
  const data = (out && out.data) || {};
  const refundId = String(data.refund_id || data.id || "");

  // best effort: the refund has happened and must not be reported as a failure for a slow write
  if (order) {
    const o = order;
    const at = new Date(deps.now());
    try {
      await deps.db.transaction(async (tx) => {
        const a = await tx
          .update(orders)
          .set({ refunded: true, paymentStatus: "refunded", lastPaymentError: null, updatedAt: at })
          .where(eq(orders.id, o.id))
          .returning();
        const b = await tx
          .update(orders)
          .set({ status: "void", updatedAt: at })
          .where(and(eq(orders.id, o.id), inArray(orders.status, ["pending", "new", "prep"])))
          .returning();
        const now = b[0] || a[0];
        await recordEvent(tx, {
          orderId: o.id, kind: "refund", from: standing(o), to: now ? standing(now) : null, by: "admin", at,
          detail: { actor, paymentId: pid, refundId, amount: r.amount, reason: why },
        });
      });
    } catch (e) {
      await deps.log.error("refund", "refunded at Thawani but the order was not updated: " + o.id + " " + errorText(e), { orderId: o.id });
    }
  }
  return { ok: true, refundId, orderId: order ? order.id : null, amount: r.amount };
}
