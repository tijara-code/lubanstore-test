/**
 * WHAT OMNIFUL TELLS US — their webhook, or our poll asking — applied to the parcel it was
 * SENT as (LM-…-2 is the second send of LM-…: news about a cancelled earlier send can never
 * land on the parcel that replaced it), and the order follows its parcel, forward only:
 * Shipped once a courier has it, Delivered when it arrives. A failure or a return moves
 * nothing (a person looks); a stale "picked up" after "delivered" changes nothing.
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { STAGE } from "../../../shared/orders/status";
import type { Deps } from "../../core/deps";
import { orders, shipments, type OrderRow, type ShipmentRow } from "../../db/schema";
import { readHook, type HookNews, OmnifulError } from "../../services/omniful";
import { moveOrder } from "../orders";
import { adopt, CARRIER } from "./push";
import { baseId, IMPLIED, isOrderId, rowKey, stageOf, type Stage } from "./rules";
import { omf, readRetired } from "./store";

export const POLL_MAX = 6;

/** The order follows its parcel, forward only. → the status it moved to, or null. */
export async function followParcel(deps: Deps, orderId: string, parcelStatus: string | null | undefined): Promise<"ship" | "done" | null> {
  const to = IMPLIED[stageOf(parcelStatus)];
  if (!to) return null;
  let o: Pick<OrderRow, "status" | "trashed" | "shippedAt"> | undefined;
  try {
    o = (await deps.db.select({ status: orders.status, trashed: orders.trashed, shippedAt: orders.shippedAt }).from(orders).where(eq(orders.id, orderId)).limit(1))[0];
  } catch {
    return null;
  }
  if (!o || o.trashed) return null;
  const from = STAGE[o.status];
  /* pending and void are not on the ladder: an unpaid or cancelled order is not delivered because a driver said so */
  if (from == null || o.status === "pending" || from >= STAGE[to]!) return null;
  const at = new Date(deps.now());
  const patch: Partial<OrderRow> = to === "ship" ? { shippedAt: at } : { deliveredAt: at, ...(o.shippedAt ? {} : { shippedAt: at }) };
  try {
    const r = await moveOrder(deps, orderId, to, "courier", { patch, detail: { parcel: String(parcelStatus || "") } });
    return r.changed ? to : null;
  } catch {
    return null;
  }
}

export type StatusResult =
  | { ok: true; orderId: string; stage: Stage; awb: string; moved: "ship" | "done" | null; adopted?: boolean }
  | { ignored: "no_order_reference" | "already_delivered" | "unknown_order" | "retired_id"; orderId?: string }
  | { error: string };

/** One status, from either direction. `keepTimes`: a poll reading the same status again. */
export async function applyStatus(deps: Deps, h: HookNews, opts: { keepTimes?: boolean } = {}): Promise<StatusResult> {
  if (!h || !h.orderId) return { ignored: "no_order_reference" };
  const sent = h.orderId.trim();
  const orderId = baseId(sent);
  const key = rowKey(sent);
  const stage = stageOf(h.status);
  const now = new Date(deps.now());

  let cur: ShipmentRow | undefined;
  try {
    cur = (await deps.db.select().from(shipments).where(and(eq(shipments.id, key), eq(shipments.orderId, orderId))).limit(1))[0];
  } catch {
    return { error: "db_read_failed" };
  }
  if (cur && cur.deliveredAt && h.status && stage !== "returned" && stage !== "failed") {
    /* delivered: make sure the ORDER is too (a repeat is what puts a lost move right) */
    await followParcel(deps, orderId, cur.status || "Delivered");
    return { ignored: "already_delivered" };
  }

  let adopted = false;
  if (!cur) {
    /* (v402) news about an order we never recorded — a push it took while we gave up waiting */
    let order: OrderRow | undefined;
    let other: Array<{ id: string }> = [];
    let spent: string[] = [];
    try {
      order = (await deps.db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
      if (order) other = await deps.db.select({ id: shipments.id }).from(shipments).where(eq(shipments.orderId, orderId)).limit(1);
      spent = (await readRetired(deps))[orderId] || [];
    } catch {
      return { error: "db_read_failed" };
    }
    if (!order || order.trashed || other.length || !isOrderId(orderId)) return { ignored: "unknown_order", orderId };
    /* a send we took off ourselves, or news that it is over: never recorded as a parcel */
    if (spent.indexOf(sent) > -1 || stage === "failed" || stage === "returned") return { ignored: "retired_id", orderId };
    const rec = await adopt(deps, order, sent, h.ref || null, "its first status from Omniful", "webhook");
    if (!("ok" in rec)) return { error: rec.error };
    adopted = true;
    cur = (await deps.db.select().from(shipments).where(eq(shipments.id, key)).limit(1))[0];
    if (!cur) return { ok: true, orderId, stage, awb: h.awb || "", moved: null, adopted };
  }

  const patch: Partial<ShipmentRow> = { updatedAt: now, syncedAt: now };
  if (h.status) patch.status = h.status;
  if (h.ref) patch.reference = h.ref;
  if (h.awb) patch.awb = h.awb;
  if (h.carrier) patch.courierName = h.carrier;
  if (h.status && !opts.keepTimes) {
    if ((stage === "picked" || stage === "transit") && !cur.pickedUpAt) patch.pickedUpAt = now;
    if (stage === "delivered" && !cur.deliveredAt) patch.deliveredAt = now;
  }
  try {
    await deps.db.update(shipments).set(patch).where(eq(shipments.id, key));
  } catch {
    return { error: "db_write_failed" };
  }
  /* their waybill belongs on the order too: the tracking page and the customer's message read it */
  if (h.awb) {
    await deps.db.update(orders).set({ tracking: h.awb, updatedAt: now }).where(eq(orders.id, orderId)).catch(() => {});
  }
  const moved = await followParcel(deps, orderId, patch.status || cur.status);
  return { ok: true, orderId, stage, awb: h.awb || "", moved, ...(adopted ? { adopted } : {}) };
}

export async function applyHook(deps: Deps, payload: unknown): Promise<StatusResult> {
  return applyStatus(deps, readHook(payload));
}

export interface PollResult {
  tracked: number;
  updated: number;
  moved: number;
  considered: number;
  errors: Array<{ id: string | null; error: string; detail: string }>;
}

/**
 * ASKING OMNIFUL, for when no webhook comes: up to POLL_MAX parcels still in flight (not
 * delivered, cancelled or returned, with their id known), least recently checked first. Read
 * only — nothing is pushed or changed at Omniful. One it cannot answer about goes to the
 * back of the queue, so it never starves the rest.
 */
export async function pollStatuses(deps: Deps, opts: { max?: number; deadline?: number } = {}): Promise<PollResult | { skipped: "not_configured" } | { error: string }> {
  const client = omf(deps);
  if (!client.configured()) return { skipped: "not_configured" };
  let rows: ShipmentRow[];
  try {
    rows = await deps.db
      .select()
      .from(shipments)
      .where(
        and(
          eq(shipments.carrier, CARRIER),
          isNull(shipments.deliveredAt),
          isNotNull(shipments.reference),
          sql`coalesce(${shipments.status}, '') not ilike '%cancel%'`,
          sql`coalesce(${shipments.status}, '') not ilike '%return%'`,
          sql`coalesce(${shipments.status}, '') not ilike '%rto%'`,
        ),
      )
      .orderBy(sql`${shipments.syncedAt} asc nulls first`, asc(shipments.id))
      .limit(Math.max(1, opts.max || POLL_MAX));
  } catch {
    return { error: "db_read_failed" };
  }
  let tracked = 0;
  let updated = 0;
  let moved = 0;
  const errors: PollResult["errors"] = [];
  for (const r of rows) {
    if (opts.deadline && opts.deadline - deps.now() < 1000) break;
    let h: HookNews;
    try {
      h = readHook(await client.getOrder(String(r.reference), { deadline: opts.deadline }));
    } catch (e) {
      const err = e as OmnifulError;
      errors.push({ id: r.orderId, error: err.code || "omniful_rejected", detail: err.message || "" });
      await deps.db.update(shipments).set({ syncedAt: new Date(deps.now()) }).where(eq(shipments.id, r.id)).catch(() => {});
      continue;
    }
    tracked++;
    /* the id it is held under is the one this row was sent as */
    h.orderId = r.sentId;
    const before = String(r.status || "");
    const res = await applyStatus(deps, h, { keepTimes: !!h.status && h.status === before });
    if ("ok" in res) {
      if (h.status && h.status !== before) updated++;
      if (res.moved) moved++;
    }
  }
  return { tracked, updated, moved, considered: rows.length, errors };
}
