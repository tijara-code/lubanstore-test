/**
 * GET /api/track?id=LM-…  →  { ok, id, stage, step, text, dates }
 *
 * Public: the shopper who asks has only their order number, so the answer is the least that
 * answers "where is it": a stage, its Arabic words, the progress rail's step, and dates.
 * Deliberately NOT returned: the waybill or tracking number (with it anyone could read the
 * delivery address on the carrier's site), the name, phone, address or what was in the box.
 *
 * An unknown id and a binned one answer identically (404 not_found), so probing cannot tell
 * which order numbers exist. A cancelled order is its own answer (step -1, no rail) before
 * any parcel is looked at. The stage comes from the newest Empower parcel (`shipments`), or —
 * for an order shipped by hand with a manual tracking number — from the order's own status.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Deps } from "../core/deps";
import { orders, shipments } from "../db/schema";
import { isOrderId } from "./intake";

/** stage → what the shopper sees; `step` drives the rail, -1 = stopped rather than progressed */
export const STAGES: Record<string, { step: number; ar: string }> = {
  created: { step: 0, ar: "تم استلام الطلب" },
  picked: { step: 1, ar: "استلمته شركة الشحن" },
  transit: { step: 2, ar: "في الطريق إليك" },
  attempt: { step: 2, ar: "محاولة تسليم" },
  delivered: { step: 3, ar: "تم التسليم" },
  failed: { step: -1, ar: "تعذر التسليم — سنتواصل معك" },
  returned: { step: -1, ar: "أعيدت الشحنة" },
};

/**
 * The carrier's words (kept verbatim on the shipment) → a stage. By substring, lower case;
 * Omniful's snake_case is read with spaces ("out_for_delivery" → "out for delivery").
 * A delivery that did NOT happen is read first ("Undelivered", "Failed to deliver" end in
 * "delivered"), and a return ("RTO delivered") is a return.
 */
const RULES: Array<[RegExp, string]> = [
  [/undeliver|not deliver|fail(ed)? (to )?deliver|deliver(y)? (attempt )?fail|unable to deliver/, "failed"],
  [/return|\brto\b/, "returned"],
  [/deliver(ed)?$|^delivered/, "delivered"],
  [/out for delivery|with courier|dispatch/, "transit"],
  [/refus|cancel|undeliver/, "failed"],
  [/no response|no answer|awaiting consignee/, "attempt"],
  [/picked ?up|collected|in transit|received at|departed|arrived|shipped/, "picked"],
  [/info received|created|manifest|booked/, "created"],
];

export function stageOf(carrierStatus: unknown): string {
  const s = String(carrierStatus || "").replace(/_/g, " ").trim().toLowerCase();
  if (!s) return "created";
  for (const [re, stage] of RULES) if (re.test(s)) return stage;
  return "created";
}

export function shown(carrierStatus: unknown): { stage: string; step: number; text: string } {
  const stage = stageOf(carrierStatus);
  const st = STAGES[stage] || STAGES.created!;
  return { stage, step: st.step, text: st.ar };
}

/**
 * What people type: "lm 482913", "LM482913", "482913", "lm-482913" → "LM-482913"; null when
 * it is not an order number at all (the page's own normaliser, applied by the server too).
 */
export function normaliseOrderId(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim().toUpperCase();
  const m = /^(?:LM[\s-]*)?(\d{4,12})$/.exec(s);
  if (!m) return null;
  const id = "LM-" + m[1];
  return isOrderId(id) ? id : null;
}

export type TrackAnswer =
  | { status: 200; body: { ok: true; id: string; stage: string; step: number; text: string; dates: Record<string, string | null> } }
  | { status: 400 | 404; body: { ok: false; error: string } };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function trackOrder(deps: Pick<Deps, "db">, rawId: unknown): Promise<TrackAnswer> {
  const id = normaliseOrderId(rawId);
  if (!id) return { status: 400, body: { ok: false, error: "bad_id" } };
  const rows = await deps.db
    .select({
      id: orders.id,
      status: orders.status,
      trashed: orders.trashed,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  const o = rows[0];
  if (!o || o.trashed) return { status: 404, body: { ok: false, error: "not_found" } };

  if (o.status === "void") {
    return { status: 200, body: { ok: true, id, dates: {}, stage: "cancelled", step: -1, text: "تم إلغاء الطلب" } };
  }

  // The newest parcel that is still a parcel: a send taken off Empower (cancelled) is not
  // where this order is.
  let ship: typeof shipments.$inferSelect | undefined;
  try {
    const sh = await deps.db
      .select()
      .from(shipments)
      .where(and(eq(shipments.orderId, id)))
      .orderBy(desc(shipments.updatedAt))
      .limit(5);
    ship = sh.find((s) => !/cancel/i.test(String(s.status || "")));
  } catch {
    ship = undefined; // fall through to the order's own state
  }

  if (ship) {
    let view = shown(ship.status);
    // marked delivered by hand while the parcel's news lags: the order's word wins
    if (o.status === "done" && view.step >= 0 && view.step < 3) view = { stage: "delivered", step: 3, text: STAGES.delivered!.ar };
    return {
      status: 200,
      body: {
        ok: true,
        id,
        stage: view.stage,
        step: view.step,
        text: view.text,
        dates: {
          created: iso(ship.createdAt),
          picked: iso(ship.pickedUpAt) || iso(o.shippedAt),
          attempt: null,
          delivered: iso(ship.deliveredAt) || iso(o.deliveredAt),
        },
      },
    };
  }

  // Shipped by hand (a manual tracking number and carrier): the order's status is the news.
  if (o.status === "ship" || o.status === "done") {
    const st = o.status === "done" ? "delivered" : "transit";
    return {
      status: 200,
      body: {
        ok: true,
        id,
        stage: st,
        step: STAGES[st]!.step,
        text: STAGES[st]!.ar,
        dates: { created: null, picked: iso(o.shippedAt), attempt: null, delivered: iso(o.deliveredAt) },
      },
    };
  }

  const preparing =
    o.status === "pending"
      ? { stage: "awaiting_payment", step: 0, text: "بانتظار إتمام الدفع" }
      : { stage: "preparing", step: 0, text: "قيد التحضير" };
  return { status: 200, body: { ok: true, id, dates: {}, ...preparing } };
}
