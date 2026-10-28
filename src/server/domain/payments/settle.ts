/**
 * THE MONEY IS IN — what a confirmed card payment writes on its order. Two paths confirm a
 * payment, the shopper's return (/api/pay/verify) and Thawani's webhook, and they routinely
 * arrive together; there is one patch, built from the row read under its lock (markPaid),
 * and each path's write carries its own condition, so whichever lands second changes nothing
 * (and reports nothing).
 */
import { and, eq, inArray, notInArray, type SQL } from "drizzle-orm";
import { r3 } from "../../../shared/money";
import type { Deps } from "../../core/deps";
import { orders, type NewOrderRow, type OrderRow } from "../../db/schema";
import type { Enriched } from "../../services/thawani";
import type { GatewayRecord } from "../../../shared/orders/types";
import { recordEvent, standing } from "./events";

/** Never accept a total that disagrees with what the shopper was asked to pay; a missing figure on either side is no agreement. */
export function amountAgrees(expectedBaisa: unknown, paidBaisa: unknown): boolean {
  const want = Number(expectedBaisa || 0);
  const got = Number(paidBaisa || 0);
  return want > 0 && got > 0 && got === want;
}

export type OrderPatch = Partial<NewOrderRow>;

/**
 * The patch for a payment that settled.
 *   invoice   the checkout invoice the money came in on
 *   enriched  thawani.paymentsForInvoice(): the card, the fee — or null
 *   gross     what was charged, OMR
 *   gateway   the path's own record, merged into order.gateway (never replacing it)
 */
export function paidPatch(order: OrderRow, o: { invoice: string | null; enriched: Enriched | null; gross: number; gateway: GatewayRecord; now: number }): OrderPatch {
  const patch: OrderPatch = {
    paymentStatus: "paid",
    paidAt: new Date(o.now),
    updatedAt: new Date(o.now),
    invoiceNo: o.invoice || order.invoiceNo || null,
    // a decline before the card that worked is history, not the state
    lastPaymentError: null,
    gateway: { ...((order.gateway && typeof order.gateway === "object" ? order.gateway : {}) as GatewayRecord), ...o.gateway },
  };
  // Only a card attempt still waiting (pending) or one that lapsed (void) becomes New on its
  // money. A cash order already in fulfilment, paid later through its old card page, keeps
  // its status: the money is recorded, the parcel is not sent again.
  if (order.status === "pending" || order.status === "void") patch.status = "new";
  // (audit A9) An order switched to cash from the reminder link and THEN paid through its old
  // card page is a card order after all: the cash fee it was re-priced with was never
  // charged, so the books carry what the gateway took.
  if (order.pay !== "card" && o.gross > 0) {
    patch.pay = "card";
    patch.omr = r3(o.gross);
    const rate = Number(order.omr) > 0 && Number(order.total) > 0 ? Number(order.total) / Number(order.omr) : null;
    if (rate) patch.total = r3(o.gross * rate);
    patch.codFee = 0;
  }
  const f = o.enriched && o.enriched.fields;
  if (f) {
    patch.paymentId = f.payment_id;
    patch.maskedCard = f.masked_card; // already masked by the gateway
    patch.cardType = f.card_type;
    patch.refunded = f.refunded;
    if (f.fee_omr != null) {
      patch.gatewayFee = f.fee_omr;
      patch.netAmount = r3((Number(o.gross) || 0) - f.fee_omr);
    }
  }
  return patch;
}

/**
 * Which orders a write may settle:
 *   open        a card attempt still waiting or lapsed (the shopper's return)
 *   cod_card    a card attempt switched to cash, still that cash order (the return, v336)
 *   settleable  anything not paid, not refunded, not binned (the webhook; a cash order is
 *               included on purpose — a card page reopened before the switch can still be paid)
 */
export type SettleCondition = "open" | "cod_card" | "settleable";

function conditionOf(c: SettleCondition): SQL {
  if (c === "open") {
    return and(inArray(orders.paymentStatus, ["unpaid", "cancelled"]), eq(orders.refunded, false), eq(orders.trashed, false))!;
  }
  if (c === "cod_card") {
    return and(eq(orders.paymentStatus, "cod"), eq(orders.pay, "cod"), eq(orders.refunded, false), eq(orders.trashed, false))!;
  }
  return and(notInArray(orders.paymentStatus, ["paid", "refunded"]), eq(orders.refunded, false), eq(orders.trashed, false))!;
}

/** The same conditions in the code, for the row read under the lock. */
export function matches(c: SettleCondition, o: Pick<OrderRow, "paymentStatus" | "pay" | "refunded" | "trashed">): boolean {
  if (o.refunded || o.trashed) return false;
  if (c === "open") return o.paymentStatus === "unpaid" || o.paymentStatus === "cancelled";
  if (c === "cod_card") return o.paymentStatus === "cod" && o.pay === "cod";
  return o.paymentStatus !== "paid" && o.paymentStatus !== "refunded";
}

export interface Settled {
  /** THIS write moved the row (only that path reports the Purchase) */
  changed: boolean;
  /** the row as written, when it was */
  order: OrderRow | null;
  /** the row as it stood under the lock (null: no such order) — what the caller answers from when nothing changed */
  fresh: OrderRow | null;
}

/**
 * The settling write. The row is read FOR UPDATE inside the transaction and the patch is
 * built from THAT row, so a writer that committed in between (the cash switch from the
 * reminder link, a refund, the other settling path) is seen, never written over from a stale
 * read: `cond` (a condition, or one chosen from the fresh row; null = not ours) is checked on
 * the fresh row, `build` makes the patch from it (null = refuse, e.g. the amount no longer
 * agrees), and the UPDATE repeats the condition. With its order_events row, in the same
 * transaction. Throws on a failed write.
 */
export async function markPaid(
  deps: Deps,
  id: string,
  cond: SettleCondition | ((fresh: OrderRow) => SettleCondition | null),
  build: (fresh: OrderRow) => OrderPatch | null,
  by: string,
  detail: Record<string, unknown> = {},
): Promise<Settled> {
  return deps.db.transaction(async (tx) => {
    const locked = await tx.select().from(orders).where(eq(orders.id, id)).limit(1).for("update");
    const fresh = locked[0] || null;
    if (!fresh) return { changed: false, order: null, fresh: null };
    const c = typeof cond === "function" ? cond(fresh) : cond;
    if (!c || !matches(c, fresh)) return { changed: false, order: null, fresh };
    const patch = build(fresh);
    if (!patch) return { changed: false, order: null, fresh };
    const rows = await tx.update(orders).set(patch).where(and(eq(orders.id, id), conditionOf(c))).returning();
    const row = rows[0] || null;
    if (row) {
      await recordEvent(tx, {
        orderId: id, kind: "payment", from: standing(fresh), to: standing(row), by, at: new Date(deps.now()),
        detail: { paid: true, invoice: row.invoiceNo, paymentId: row.paymentId, ...detail },
      });
    }
    return { changed: !!row, order: row, fresh };
  });
}

/** A note on the order (mismatch, second payment, money on a closed order); never throws. */
export async function noteOnOrder(deps: Deps, id: string, note: string, where?: SQL): Promise<void> {
  try {
    await deps.db
      .update(orders)
      .set({ lastPaymentError: note.slice(0, 300), updatedAt: new Date(deps.now()) })
      .where(where ? and(eq(orders.id, id), where) : eq(orders.id, id));
  } catch {
    /* the note is an explanation; its failure must not change the answer */
  }
}
