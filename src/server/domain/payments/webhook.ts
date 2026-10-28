/**
 * POST /api/pay/webhook (and /.netlify/functions/thawani-webhook, the URL in Thawani's portal).
 *
 * The authoritative record of a payment: a shopper can pay and close the tab before the
 * success URL loads, and only this reaches us then.
 *
 *   signature = HMAC-SHA256(rawBody + "-" + thawani-timestamp, THAWANI_WEBHOOK_SECRET)
 *
 * checked over the RAW body, constant-time, before anything is parsed. No secret configured
 * fails closed (401). No freshness window on the stamp, on purpose: Thawani re-delivers a
 * failed callback hours later with its original stamp, and every delivery is idempotent.
 *
 * Answers: 401 bad signature (Thawani retries — right when OUR secret is missing); 500 when we
 * could not act (the database), so Thawani retries; 200 for everything handled — an unknown
 * order, a mismatch, a refunded order included, where a retry cannot help.
 *
 * Every verified delivery is recorded in webhook_events with what was done (`applied`) and
 * dedupe_key = a hash of the body: the same bytes again, already handled to an outcome, are
 * acknowledged without touching the order. Rejected deliveries are counted (one ops row a
 * day), not stored.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNotNull, ne, notLike, lt } from "drizzle-orm";
import { baisaToOmr, r3 } from "../../../shared/money";
import type { Deps } from "../../core/deps";
import { errorText } from "../../core/log";
import { updateOp } from "../../core/ops";
import { orders, webhookEvents, type OrderRow } from "../../db/schema";
import type { GatewayRecord } from "../../../shared/orders/types";
import { reportPurchase } from "../purchase";
import { amountAgrees, markPaid, noteOnOrder, paidPatch } from "./settle";
import type { Answer } from "./verify";

export function signBody(body: string, timestamp: string, secret: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(Buffer.from(body + "-" + timestamp, "utf8")).digest("hex");
}

export function dedupeKeyOf(body: string): string {
  return createHash("sha256").update(String(body || ""), "utf8").digest("hex").slice(0, 40);
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) {
    timingSafeEqual(y, y);
    return false;
  }
  return timingSafeEqual(x, y);
}

/** the day's rejected deliveries: how many, the last stamp and signature prefix (enough to debug a secret mismatch) */
async function countReject(deps: Deps, reason: string, ts: string, sig: string): Promise<void> {
  const at = new Date(deps.now());
  const key = "webhook_rejects_" + at.toISOString().slice(0, 10);
  try {
    await updateOp<Record<string, unknown>>(deps.db, key, {}, (cur) => ({
      n: (Number(cur.n) || 0) + 1, reason, last_ts: ts.slice(0, 32), last_sig: sig.slice(0, 16), at: at.toISOString(),
    }), at);
  } catch {
    /* never the request */
  }
}

interface Entry {
  eventType: string;
  orderId: string | null;
  invoice: string | null;
  payload: unknown;
  dedupeKey: string | null;
}

/** Record a delivery and its outcome — never throws. The same body handled again updates its row. */
async function record(deps: Deps, e: Entry, applied: string): Promise<void> {
  const row = {
    provider: "thawani", eventType: e.eventType, orderId: e.orderId, invoice: e.invoice, verified: true,
    applied: applied.slice(0, 300), dedupeKey: e.dedupeKey, payload: e.payload as object, receivedAt: new Date(deps.now()),
  };
  try {
    if (e.dedupeKey) {
      await deps.db.insert(webhookEvents).values(row).onConflictDoUpdate({
        target: webhookEvents.dedupeKey,
        set: { applied: row.applied, orderId: row.orderId, receivedAt: row.receivedAt },
      });
    } else await deps.db.insert(webhookEvents).values(row);
  } catch {
    /* recording must not break the acknowledgement */
  }
}

/** A delivery already handled to an outcome (an "error: …" is not one: its retry is handled again). */
async function alreadyHandled(deps: Deps, key: string): Promise<{ applied: string | null; orderId: string | null } | null> {
  const rows = await deps.db
    .select({ applied: webhookEvents.applied, orderId: webhookEvents.orderId })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.dedupeKey, key), isNotNull(webhookEvents.applied), notLike(webhookEvents.applied, "error%")))
    .orderBy(desc(webhookEvents.id))
    .limit(1);
  return rows[0] || null;
}

/** A read that FAILS throws (→ 500, Thawani retries); one that finds nothing is null (→ 200). */
async function findOrder(deps: Deps, by: { id?: string | null; invoice?: string | null }): Promise<OrderRow | null> {
  const where = by.id ? eq(orders.id, by.id) : by.invoice ? eq(orders.invoiceNo, by.invoice) : null;
  if (!where) return null;
  const rows = await deps.db.select().from(orders).where(where).limit(1);
  return rows[0] || null;
}

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);

export async function handleWebhook(deps: Deps, body: string, headers: { timestamp?: string | null; signature?: string | null }): Promise<Answer> {
  const secret = String(deps.env.THAWANI_WEBHOOK_SECRET || "");
  const ts = String(headers.timestamp || "");
  const sig = String(headers.signature || "").trim().toLowerCase();

  // 1. verify before parsing
  const verified = !!(secret && ts && sig) && sameHex(sig, signBody(body, ts, secret));
  if (!verified) {
    await countReject(deps, !secret ? "no_secret_configured" : "bad_signature", ts, sig);
    return { status: 401, body: { ok: false, error: "bad_signature" } };
  }

  const dedupeKey = dedupeKeyOf(body);
  let evt: Record<string, unknown>;
  try {
    const v = JSON.parse(body || "{}");
    evt = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    await record(deps, { eventType: "unparseable", orderId: null, invoice: null, payload: { body: body.slice(0, 4000) }, dedupeKey }, "ignored");
    return { status: 200, body: { ok: true, note: "unparseable, acknowledged" } };
  }

  const type = String(evt.event_type || "").toLowerCase();
  const d = (evt.data && typeof evt.data === "object" ? evt.data : {}) as Record<string, unknown>;
  const meta = (d.metadata && typeof d.metadata === "object" ? d.metadata : {}) as Record<string, unknown>;
  const orderId = str(d.client_reference_id) || str(meta.order_id) || null;
  const invoice = str(d.invoice) || str(d.checkout_invoice) || null;
  const entry: Entry = { eventType: type, orderId, invoice, payload: evt, dedupeKey };

  try {
    const before = await alreadyHandled(deps, dedupeKey);
    if (before) {
      await record(deps, { ...entry, orderId: before.orderId || orderId, dedupeKey: null, payload: { replay_of: dedupeKey } }, "replay");
      return { status: 200, body: { ok: true, replay: true, applied: before.applied } };
    }

    switch (type) {
      case "checkout.created":
      case "payment.pending":
        await record(deps, entry, "ignored");
        return { status: 200, body: { ok: true } };

      case "checkout.completed":
        return await completed(deps, entry, evt, d, orderId, invoice);

      case "payment.succeeded": {
        const order = (await findOrder(deps, { invoice })) || (orderId ? await findOrder(deps, { id: orderId }) : null);
        if (!order) {
          await record(deps, entry, "unknown_order");
          return { status: 200, body: { ok: true } };
        }
        const fee = d.fee != null && Number.isFinite(Number(d.fee)) ? baisaToOmr(d.fee) : null;
        // read again under the row's lock and patched from that row: a refund (or a settle)
        // committed since the read above is kept, never written back from a stale copy
        await deps.db.transaction(async (tx) => {
          const fresh = (await tx.select().from(orders).where(eq(orders.id, order.id)).limit(1).for("update"))[0];
          if (!fresh) return;
          const patch: Partial<OrderRow> = {
            paymentId: str(d.payment_id),
            maskedCard: str(d.masked_card),
            cardType: str(d.card_type),
            gateway: { ...((fresh.gateway || {}) as GatewayRecord), webhook_payment: evt },
            updatedAt: new Date(deps.now()),
          };
          // a refund is final: a late delivery of the original charge never clears it (only sets it)
          if (d.refunded) patch.refunded = true;
          // a mismatch note on an order still unpaid is the panel's only explanation
          if (fresh.paymentStatus === "paid") patch.lastPaymentError = null;
          if (fee != null) {
            patch.gatewayFee = fee;
            patch.netAmount = r3((Number(fresh.omr) || 0) - fee);
          }
          await tx.update(orders).set(patch).where(eq(orders.id, fresh.id));
        });
        await record(deps, { ...entry, orderId: order.id }, "enriched");
        return { status: 200, body: { ok: true, id: order.id } };
      }

      // a declined attempt: the order stays pending — another card may still settle it
      case "payment.failed": {
        const order = (await findOrder(deps, { invoice })) || (orderId ? await findOrder(deps, { id: orderId }) : null);
        if (order && order.paymentStatus !== "paid") {
          await deps.db
            .update(orders)
            .set({
              lastPaymentError: String(d.reason || "declined").slice(0, 300),
              gateway: { ...((order.gateway || {}) as GatewayRecord), webhook_failed: evt },
              updatedAt: new Date(deps.now()),
            })
            .where(and(eq(orders.id, order.id), ne(orders.paymentStatus, "paid")));
        }
        await record(deps, { ...entry, orderId: order ? order.id : orderId }, "failed");
        return { status: 200, body: { ok: true } };
      }

      default:
        await record(deps, entry, "unhandled");
        return { status: 200, body: { ok: true } };
    }
  } catch (e) {
    // the database's own words only — never the failed query's parameters (customer details)
    const msg = errorText(e);
    await record(deps, entry, "error: " + msg);
    await deps.log.error("thawani-webhook", "a delivery could not be handled: " + msg, { orderId });
    // 500 asks Thawani to retry — better than losing the event
    return { status: 500, body: { ok: false, error: "processing_failed" } };
  }
}

/** checkout.completed — the event that settles an order. */
async function completed(deps: Deps, entry: Entry, evt: Record<string, unknown>, d: Record<string, unknown>, orderId: string | null, invoice: string | null): Promise<Answer> {
  if (String(d.payment_status || "").toLowerCase() !== "paid") {
    await record(deps, entry, "ignored");
    return { status: 200, body: { ok: true } };
  }
  const order = orderId ? await findOrder(deps, { id: orderId }) : invoice ? await findOrder(deps, { invoice }) : null;
  if (!order) {
    await record(deps, entry, "unknown_order");
    return { status: 200, body: { ok: true } };
  }
  const at = { ...entry, orderId: order.id };
  const paid = Number(d.total_amount || 0);

  if (order.paymentStatus === "paid") {
    // the same checkout again is a retry; a DIFFERENT checkout paid on a paid order is a second
    // charge (two payment pages open at once) — it must reach the panel
    const second = !!(invoice && order.invoiceNo && invoice !== order.invoiceNo);
    if (second) await noteOnOrder(deps, order.id, "second_payment: invoice " + invoice + " paid " + paid + " baisa - refund one");
    // (v334) the retry of a delivery whose write committed but whose answer was lost: the
    // sale is reported if no path has yet (reportPurchase is once per order)
    if (!second && order.paidAt && deps.now() - order.paidAt.getTime() < 86400e3) await report(deps, order);
    await record(deps, at, second ? "second_payment" : "duplicate");
    return { status: 200, body: { ok: true } };
  }
  // a refund is final: a replayed or late "completed" must not put it back into fulfilment
  if (order.paymentStatus === "refunded" || order.refunded) {
    await record(deps, at, "refunded_ignored");
    return { status: 200, body: { ok: true } };
  }
  const want = Number(order.amountBaisa || 0);
  if (!amountAgrees(want, paid)) {
    await record(deps, at, "mismatch");
    await noteOnOrder(deps, order.id, "amount_mismatch: paid " + paid + " expected " + want);
    return { status: 200, body: { ok: true, note: "amount mismatch, left pending" } };
  }

  // card + fee, best effort — a failure here must not lose the sale (asked before the row is locked)
  const enriched = await deps.services.thawani.paymentsForInvoice(invoice || order.invoiceNo);
  const gross = baisaToOmr(paid || want) || Number(order.omr) || 0;
  const rec: GatewayRecord = { webhook_completed_at: new Date(deps.now()).toISOString(), webhook_checkout: evt };
  if (enriched) rec.payment = enriched.raw;
  // the patch is built from the row as it stands under the lock: a cash switch from the
  // reminder link that committed since the read above is converted back to card (A9), not
  // left as cash with a fee the gateway never took
  const settled = await markPaid(
    deps, order.id, "settleable",
    (fresh) => (amountAgrees(fresh.amountBaisa, paid)
      ? paidPatch(fresh, { invoice: invoice || fresh.invoiceNo || null, enriched, gross, gateway: rec, now: deps.now() })
      : null),
    "webhook", { via: "webhook" },
  );
  if (!settled.changed || !settled.order) {
    // matched nothing: settled by the return a moment ago, or an order the write may not
    // settle (binned, refunded) — money taken and not recorded, said on the order (audit A8)
    const now = settled.fresh;
    if (now && now.paymentStatus === "paid") {
      await report(deps, now);
      await record(deps, at, "duplicate");
      return { status: 200, body: { ok: true, id: order.id, note: "settled by the return a moment earlier" } };
    }
    if (now && !now.trashed && !now.refunded && now.paymentStatus !== "refunded" && !amountAgrees(now.amountBaisa, paid)) {
      await record(deps, at, "mismatch");
      await noteOnOrder(deps, order.id, "amount_mismatch: paid " + paid + " expected " + Number(now.amountBaisa || 0));
      return { status: 200, body: { ok: true, note: "amount mismatch, left pending" } };
    }
    const why = now && now.trashed ? "binned" : now && (now.refunded || now.paymentStatus === "refunded") ? "refunded" : "closed";
    await noteOnOrder(deps, order.id, "paid_unsettled: invoice " + (invoice || "?") + " paid " + paid + " baisa on a " + why + " order - check and refund or restore");
    await record(deps, at, "paid_unsettled");
    return { status: 200, body: { ok: true, id: order.id, note: "paid but not settled; flagged on the order" } };
  }
  // The Purchase. Thawani is the caller here, so no live request: the order's stored client
  // signals (captured when the card session opened) name the shopper.
  await report(deps, settled.order);
  // (v338) Empower gets it from the auto push run, never from here
  await record(deps, at, "paid");
  return { status: 200, body: { ok: true, id: order.id } };
}

async function report(deps: Deps, order: OrderRow): Promise<void> {
  try {
    await reportPurchase(deps, order);
  } catch (e) {
    await deps.log.error("thawani-webhook", "the Purchase report failed for " + order.id + ": " + errorText(e), { orderId: order.id });
  }
}

/** The 90-day trim of the delivery record (the hourly job). */
export async function purgeWebhookEvents(deps: Deps, days = 90): Promise<number> {
  const rows = await deps.db
    .delete(webhookEvents)
    .where(and(eq(webhookEvents.provider, "thawani"), lt(webhookEvents.receivedAt, new Date(deps.now() - days * 86400e3))))
    .returning({ id: webhookEvents.id });
  return rows.length;
}
