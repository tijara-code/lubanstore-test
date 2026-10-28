/**
 * PUSHING ORDERS TO EMPOWER — one copy of the push, shared by a person pressing Push, the
 * panel's "Push all" (named ids only) and the auto push, so an order is sent identically
 * whichever sent it. Every rule below is a refusal, because the failure that costs money and
 * cannot be undone is one order picked, packed and shipped twice:
 *
 *   - a market shipped by hand is not Empower's (unless a person asks: `anyMarket`)
 *   - a binned, cancelled, unpaid-card or refunded order is not a parcel
 *   - NEVER TWICE: any shipment row, a tracking number on the order, or a status already
 *     Shipped/Delivered refuses — read from the database, under a short lease, because a
 *     person and the auto run can press at the same second
 *   - a box with no Empower SKU is named and refused before Omniful is asked (sku_not_set)
 *   - a push is started only with PUSH_NEED_MS left (a push cut off half way is the worst
 *     outcome: Omniful has it, we have no record)
 *   - Omniful's "already taken": ours (adopted) only when we know we sent it (an earlier push
 *     got no answer — the `omniful_unsure` note) or a person says so (`adopt`); else asked
 *     (`omniful_duplicate`), and `fresh` sends it under the next id once a person confirms the
 *     old one is cancelled there
 *   - no answer is not a no: noted (`omniful_unsure`) so the next push records it
 *   - accepted but not recorded: the sent id is kept (`omniful_unrecorded`) and the next push
 *     writes the row instead of sending again
 *
 * After a push a New order moves to Preparing (moveOrder "push"); one already further on is
 * never walked back.
 */
import { errorText } from "../../core/log";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { checkOf } from "../../../shared/orders/phone";
import type { Catalogue } from "../../../shared/catalogue/types";
import type { Deps } from "../../core/deps";
import { claims, orderEvents, orders, shipments, type OrderRow, type ShipmentRow } from "../../db/schema";
import { OmnifulError } from "../../services/omniful";
import { loadCatalogue } from "../catalogue";
import { moveOrder } from "../orders";
import { linesOf, unmapped, unmappedText, type SkuMap } from "./lines";
import { courierFor, empowerMarkets, EmpowerRuleError, isDuplicate, isEmpowerMarket, isOrderId, nextSentId, orderBody, rowKey, shippable } from "./rules";
import { expireShelf } from "./shelf";
import {
  AUTO_RUN_KEY,
  autoSetting,
  omf,
  readNotes,
  readRetired,
  readRun,
  readSkus,
  retire,
  setNote,
  UNRECORDED_KEY,
  UNSURE_KEY,
} from "./store";

export const PUSH_NEED_MS = 4500;
export const SWEEP_MAX = 6;
export const AUTO_AFTER_MIN = 3;
export const AUTO_EVERY_MIN = 1;
export const AUTO_RETRY_H = 6;
export const AUTO_MAX = 10;
export const CARRIER = "empower";
const LEASE_MS = 60_000;
const SENT_STATUS = "Sent to Omniful";

export interface PushOpts {
  /** a person sending an order from any market (the Orders tab) */
  anyMarket?: boolean;
  /** Omniful has the next id and a person confirmed it was cancelled there: spend it, send the one after */
  fresh?: boolean;
  /** Omniful has the id and a person confirmed it came from our own push: record it, send nothing */
  adopt?: boolean;
  skus?: SkuMap;
  /** absolute ms (deps clock) the push must be finished by */
  deadline?: number;
  /** who: admin | job:empower-auto | … (order_events) */
  by?: string;
}

export interface PushOk {
  ok: true;
  ref: string | null;
  /** our shipment row: omf-<sentId> */
  row: string;
  sentId: string;
  status: string | null;
  adopted?: boolean;
  how?: string;
}
export interface PushSkipped {
  skipped: string;
  /** the row, waybill or tracking number that already stands */
  row?: string;
  awb?: string;
  carrier?: string;
}
export interface PushFailed {
  error: string;
  detail?: string;
  sentId?: string;
  ref?: string | null;
  status?: number | null;
  retryable?: boolean;
  duplicate?: boolean;
  unsure?: boolean;
  codes?: string[];
}
export type PushResult = PushOk | PushSkipped | PushFailed;

const iso = (deps: Deps) => new Date(deps.now()).toISOString();

async function event(deps: Deps, orderId: string, to: string, by: string, detail: Record<string, unknown>): Promise<void> {
  try {
    await deps.db.insert(orderEvents).values({ orderId, at: new Date(deps.now()), kind: "empower", to, by, detail });
  } catch {
    /* the record of a push is a help; the push stands without it */
  }
}

/** A short lease on pushing one order (a person and the auto run at the same second). */
async function lease(deps: Deps, orderId: string): Promise<boolean> {
  const key = "empower-push:" + orderId;
  const now = new Date(deps.now());
  const stale = new Date(deps.now() - LEASE_MS);
  const rows = await deps.db
    .insert(claims)
    .values({ key, at: now, state: "pushing" })
    .onConflictDoUpdate({ target: claims.key, set: { at: now, state: "pushing" }, setWhere: lte(claims.at, stale) })
    .returning({ key: claims.key });
  return rows.length === 1;
}
async function unlease(deps: Deps, orderId: string): Promise<void> {
  await deps.db.delete(claims).where(eq(claims.key, "empower-push:" + orderId)).catch(() => {});
}

/** The reason a push failed: on the order's shipment row when it has one, else the error log. */
export async function noteFailure(deps: Deps, orderId: string, message: string): Promise<void> {
  const text = String(message).slice(0, 300);
  let hit: Array<{ id: string }> = [];
  try {
    hit = await deps.db
      .update(shipments)
      .set({ lastError: text, updatedAt: new Date(deps.now()) })
      .where(eq(shipments.orderId, orderId))
      .returning({ id: shipments.id });
  } catch {
    hit = [];
  }
  if (hit.length) return;
  await deps.log.error("omniful-push", "Omniful push failed for " + orderId + ": " + text, { orderId, detail: { error: text } });
}

function shipmentRow(deps: Deps, order: OrderRow, sentId: string, ref: string | null, at?: string) {
  const when = at ? new Date(at) : new Date(deps.now());
  return {
    id: rowKey(sentId),
    orderId: order.id,
    carrier: CARRIER,
    sentId,
    reference: ref || null,
    status: SENT_STATUS,
    cod: order.paymentStatus === "cod" ? Number(order.total) || 0 : 0,
    createdAt: when,
    updatedAt: when,
    syncedAt: when,
    lastError: null,
  };
}

/** Pushed is Preparing. Only a New order moves; asked twice, a moment apart (v402). */
export async function moveToPrep(deps: Deps, orderId: string, by = "push"): Promise<boolean> {
  for (let n = 0; n < 2; n++) {
    try {
      const r = await moveOrder(deps, orderId, "prep", "push", { detail: { via: by } });
      return r.changed;
    } catch {
      /* once more */
    }
  }
  return false;
}

/** Omniful has it and we did not write it down: recorded now (row, Preparing, notes cleared). */
export async function adopt(deps: Deps, order: OrderRow, sentId: string, ref: string | null, how: string, by = "system"): Promise<PushOk | PushFailed> {
  try {
    await deps.db.insert(shipments).values(shipmentRow(deps, order, sentId, ref)).onConflictDoNothing();
  } catch {
    return { error: "db_write_failed", detail: "Omniful has " + sentId + " but the shipment row was not written. Push again to record it." };
  }
  await setNote(deps, UNSURE_KEY, order.id, null);
  await expireShelf(deps).catch(() => false);
  const moved = order.status === "new" ? await moveToPrep(deps, order.id, by) : false;
  await event(deps, order.id, "adopted", by, { sentId, ref, how });
  return { ok: true, adopted: true, how, ref: ref || null, row: rowKey(sentId), sentId, status: moved ? "prep" : order.status || null };
}

export async function pushOrder(deps: Deps, order: OrderRow, cfg: Catalogue, opts: PushOpts = {}): Promise<PushResult> {
  const by = opts.by || "admin";
  if (!opts.anyMarket && !isEmpowerMarket(order.countryCode, cfg)) return { skipped: "routed_to_" + courierFor(order.countryCode, cfg) };
  if (!shippable(order)) return { skipped: "not_shippable" };
  const client = omf(deps);
  if (!client.configured()) return { skipped: "not_configured" };

  let leased = false;
  try {
    leased = await lease(deps, order.id);
  } catch {
    return { error: "db_read_failed" };
  }
  if (!leased) return { skipped: "busy" };
  try {
    /* THE GUARD THAT MATTERS: the database's, read now */
    let current: OrderRow | undefined;
    let already: ShipmentRow[] = [];
    try {
      current = (await deps.db.select().from(orders).where(eq(orders.id, order.id)).limit(1))[0];
      already = await deps.db.select().from(shipments).where(eq(shipments.orderId, order.id)).limit(1);
    } catch {
      return { error: "db_read_failed" };
    }
    const o = current || order;
    if (!shippable(o)) return { skipped: "not_shippable" };
    if (String(o.tracking || "").trim()) return { skipped: "already_pushed", awb: String(o.tracking).trim(), carrier: String(o.carrier || "") };
    if (o.status === "ship" || o.status === "done") return { skipped: "not_shippable" };
    if (already.length) return { skipped: "already_pushed", row: already[0]!.id, awb: already[0]!.awb || undefined, carrier: already[0]!.carrier };
    /* v314: accepted once, the row not written: write it now, never send again */
    const unrec = (await readNotes(deps, UNRECORDED_KEY))[o.id];
    if (unrec && unrec.sentId) {
      try {
        await deps.db.insert(shipments).values(shipmentRow(deps, o, unrec.sentId, unrec.ref || null, unrec.at)).onConflictDoNothing();
        await setNote(deps, UNRECORDED_KEY, o.id, null);
      } catch {
        /* the note still stands; refused either way */
      }
      return { skipped: "already_pushed", row: rowKey(unrec.sentId), carrier: CARRIER };
    }

    let skus: SkuMap;
    try {
      skus = opts.skus || (await readSkus(deps, { strict: true }));
    } catch {
      return { error: "db_read_failed", detail: "the SKU codes could not be read — not sent with default codes" };
    }
    const lines = linesOf(o, cfg, skus);
    const noCode = unmapped(lines, skus);
    if (noCode.length) {
      const why = "no Empower SKU set for " + unmappedText(noCode) + " — add it on the Empower tab, then push";
      await noteFailure(deps, o.id, why);
      return { error: "sku_not_set", detail: why, codes: noCode.map((u) => u.code) };
    }

    let mine: string[];
    try {
      const spent = await readRetired(deps);
      mine = Array.isArray(spent[o.id]) ? spent[o.id]!.slice() : [];
      if (opts.fresh) {
        const was = nextSentId(o.id, mine, deps.now());
        await retire(deps, o.id, was);
        mine.push(was);
      }
    } catch {
      return { error: opts.fresh ? "db_write_failed" : "db_read_failed" };
    }
    const sentId = nextSentId(o.id, mine, deps.now());

    if (opts.deadline && opts.deadline - deps.now() < PUSH_NEED_MS) return { skipped: "no_time" };

    let body: Record<string, unknown>;
    try {
      body = orderBody(o, lines, client.hub(), sentId);
    } catch (e) {
      if (e instanceof EmpowerRuleError) return { error: e.code, detail: e.message };
      throw e;
    }

    let res: { ref: string };
    try {
      res = await client.createOrder(body, { deadline: opts.deadline });
    } catch (e) {
      const err = e instanceof OmnifulError ? e : new OmnifulError("omniful_rejected", errorText(e));
      if (isDuplicate(err)) {
        const un = (await readNotes(deps, UNSURE_KEY))[o.id];
        if ((un && un.sentId === sentId) || opts.adopt === true) {
          return adopt(deps, o, sentId, null, un && un.sentId === sentId ? "an earlier push got no answer" : "a person confirmed it came from our push", by);
        }
        return { error: "omniful_duplicate", duplicate: true, sentId, detail: "Omniful already has an order " + sentId + " — " + err.message };
      }
      if (err.code === "omniful_unreachable" && !err.unsent) {
        await setNote(deps, UNSURE_KEY, o.id, { sentId, at: iso(deps) });
        return {
          error: "omniful_unsure",
          unsure: true,
          sentId,
          detail: (err.message || "Omniful did not answer") + ". It may have the order: the next push checks and records it.",
        };
      }
      const said =
        (err.message || "Omniful refused the order") +
        (/sku/i.test(err.message || "") ? " — sent " + lines.map((l) => l.seller_sku_code + " ×" + l.quantity + " (" + l.code + ")").join(", ") : "");
      if (!err.unsent) await noteFailure(deps, o.id, said);
      return { error: err.code, detail: said, status: err.status, retryable: err.retryable };
    }

    const row = shipmentRow(deps, o, sentId, res.ref || null);
    let written = false;
    for (let attempt = 0; attempt < 2 && !written; attempt++) {
      try {
        await deps.db.insert(shipments).values(row).onConflictDoUpdate({ target: shipments.id, set: { reference: row.reference, updatedAt: row.updatedAt } });
        written = true;
      } catch {
        /* once more, then the note */
      }
    }
    if (!written) {
      await setNote(deps, UNRECORDED_KEY, o.id, { sentId, ref: res.ref || null, at: iso(deps) });
      return {
        error: "db_write_failed",
        ref: res.ref,
        detail: "Omniful accepted " + o.id + " (" + (res.ref || "no ref") + ") but the shipment row was not written — do not push it again",
      };
    }
    await expireShelf(deps).catch(() => false);
    await setNote(deps, UNSURE_KEY, o.id, null);
    const moved = o.status === "new" ? await moveToPrep(deps, o.id, by) : false;
    await event(deps, o.id, "pushed", by, { sentId, ref: res.ref || null });
    return { ok: true, ref: res.ref || null, row: row.id, sentId, status: moved ? "prep" : o.status || null };
  } finally {
    await unlease(deps, order.id);
  }
}

/* ---------------- New orders already on Empower (the move was lost) ---------------- */

async function rowsByOrder(deps: Deps, ids: string[]): Promise<Record<string, string>> {
  const seen: Record<string, string> = {};
  if (!ids.length) return seen;
  const had = await deps.db.select({ orderId: shipments.orderId, carrier: shipments.carrier }).from(shipments).where(inArray(shipments.orderId, ids));
  for (const s of had) if (s.orderId) seen[s.orderId] = s.carrier || "?";
  return seen;
}

async function heal(deps: Deps, rows: OrderRow[], seen: Record<string, string>, by: string): Promise<number> {
  let healed = 0;
  for (const o of rows) if (seen[o.id] === CARRIER && (await moveToPrep(deps, o.id, by))) healed++;
  return healed;
}

/* ---------------- Push all: the ids a person was shown and confirmed ---------------- */

export interface SweepResult {
  pushed: number;
  considered: number;
  healed: number;
  /** the ids not tried this time — the panel sends them again */
  left: string[];
  waiting: number;
  failed: Array<{ id: string; error: string; detail: string }>;
}

export async function sweep(
  deps: Deps,
  opts: { ids: unknown; deadline?: number; max?: number; by?: string },
): Promise<SweepResult | PushSkipped | PushFailed> {
  const ids = (Array.isArray(opts.ids) ? opts.ids : []).map((x) => String(x || "").trim()).filter(isOrderId);
  if (!ids.length) return { error: "no_ids", detail: "Name the orders to push" };
  if (!omf(deps).configured()) return { skipped: "not_configured" };
  const cfg = await loadCatalogue(deps, { fresh: true });
  const mine = empowerMarkets(cfg);
  if (!mine.length) return { skipped: "no_market_routed" };
  const by = opts.by || "admin";
  let rows: OrderRow[];
  let seen: Record<string, string>;
  try {
    rows = await deps.db
      .select()
      .from(orders)
      .where(and(inArray(orders.id, ids), eq(orders.status, "new"), eq(orders.trashed, false), inArray(orders.countryCode, mine)))
      .orderBy(asc(orders.createdAt), asc(orders.id))
      .limit(60);
    seen = await rowsByOrder(deps, rows.map((o) => o.id));
  } catch {
    return { error: "db_read_failed" };
  }
  if (!rows.length) return { pushed: 0, considered: 0, healed: 0, left: [], waiting: 0, failed: [] };
  const healed = await heal(deps, rows, seen, by);
  const waitingRows = rows.filter((o) => !seen[o.id]);
  const todo = waitingRows.slice(0, opts.max || SWEEP_MAX);
  let skus: SkuMap = {};
  try {
    if (todo.length) skus = await readSkus(deps, { strict: true });
  } catch {
    return { error: "db_read_failed", detail: "the SKU codes could not be read — nothing sent" };
  }
  let pushed = 0;
  let tried = 0;
  const failed: SweepResult["failed"] = [];
  for (const o of todo) {
    const r = await pushOrder(deps, o, cfg, { skus, deadline: opts.deadline, by });
    if ("skipped" in r && r.skipped === "no_time") break;
    tried++;
    if ("ok" in r) pushed++;
    else if ("error" in r) failed.push({ id: o.id, error: r.error, detail: r.detail || "" });
  }
  return {
    pushed,
    considered: tried,
    healed,
    left: todo.slice(tried).map((o) => o.id),
    waiting: Math.max(0, waitingRows.length - tried),
    failed,
  };
}

/* ---------------- the auto push (v316/v338/v402) ---------------- */

export interface AutoResult {
  pushed: number;
  ids: string[];
  considered: number;
  healed: number;
  flagged: Array<{ id: string; missing: string[] }>;
  failed: Array<{ id: string; error: string; detail: string; at: string }>;
}

/**
 * The switch on the Empower tab (off unless the shop turns it on). Every minute: WEBSITE
 * orders (never one typed in from WhatsApp) that are New, at least AUTO_AFTER_MIN old (time
 * for a cancel or a fix), in an Empower market, with no parcel, that pass the details check
 * (a name, a phone of the market's own shape, a city, an area, every box with a SKU). A
 * failing order is held back and flagged; one Omniful refused waits AUTO_RETRY_H hours; a
 * push with no answer is retried on the next run (that retry is what records it).
 */
export async function autoPush(deps: Deps, opts: { deadline?: number; max?: number } = {}): Promise<AutoResult | PushSkipped | PushFailed> {
  const by = "job:empower-auto";
  let set;
  try {
    set = await autoSetting(deps);
  } catch {
    return { error: "db_read_failed" };
  }
  if (!set.on) return { skipped: "off" };
  if (!omf(deps).configured()) return { skipped: "not_configured" };
  const cfg = await loadCatalogue(deps, { fresh: true });
  const mine = empowerMarkets(cfg);
  if (!mine.length) return { skipped: "no_market_routed" };
  const before = new Date(deps.now() - AUTO_AFTER_MIN * 60e3);
  let rows: OrderRow[];
  let seen: Record<string, string>;
  try {
    rows = await deps.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.status, "new"),
          eq(orders.trashed, false),
          lte(orders.createdAt, before),
          inArray(orders.countryCode, mine),
          or(sql`${orders.origin} is null`, sql`${orders.origin} <> 'whatsapp_order'`),
        ),
      )
      .orderBy(asc(orders.createdAt), asc(orders.id))
      .limit(60);
    if (!rows.length) return { pushed: 0, ids: [], considered: 0, healed: 0, flagged: [], failed: [] };
    seen = await rowsByOrder(deps, rows.map((o) => o.id));
  } catch {
    return { error: "db_read_failed" };
  }
  const healed = await heal(deps, rows, seen, by);

  const last = await readRun<{ failed?: AutoResult["failed"] }>(deps, AUTO_RUN_KEY).catch(() => null);
  const resting: Record<string, AutoResult["failed"][number]> = {};
  for (const f of (last && last.failed) || []) {
    if (f && f.id && deps.now() - Date.parse(f.at || "") < AUTO_RETRY_H * 3600e3) resting[f.id] = f;
  }

  let skus: SkuMap;
  try {
    skus = await readSkus(deps, { strict: true });
  } catch {
    return { error: "db_read_failed", detail: "the SKU codes could not be read — nothing sent" };
  }
  const flagged: AutoResult["flagged"] = [];
  const todo: OrderRow[] = [];
  for (const o of rows) {
    if (seen[o.id]) continue;
    const c = checkOf(o);
    if (unmapped(linesOf(o, cfg, skus), skus).length) c.push("sku");
    if (c.length) {
      flagged.push({ id: o.id, missing: c });
      continue;
    }
    if (resting[o.id]) continue;
    todo.push(o);
  }

  let pushed = 0;
  const done: string[] = [];
  const failed: AutoResult["failed"] = Object.values(resting);
  for (const o of todo) {
    if (pushed >= (opts.max || AUTO_MAX)) break;
    if (opts.deadline && opts.deadline - deps.now() < PUSH_NEED_MS) break;
    const r = await pushOrder(deps, o, cfg, { skus, deadline: opts.deadline, by });
    if ("skipped" in r && r.skipped === "no_time") break;
    if ("ok" in r) {
      pushed++;
      done.push(o.id);
      continue;
    }
    if ("error" in r) {
      /* no answer is retried on the next run, not held back for hours */
      if (r.error === "omniful_unsure" || r.error === "omniful_unreachable") continue;
      failed.push({ id: o.id, error: r.error, detail: String(r.detail || "").slice(0, 200), at: iso(deps) });
    }
  }
  return { pushed, ids: done, considered: rows.length, healed, flagged, failed };
}

/* ---------------- taking an order back off Empower ---------------- */

export type CancelResult =
  | { ok: true; cancelled: boolean; sentId: string; status: "new" | null }
  | { skipped: "not_pushed" }
  | { error: string; detail?: string; upstream?: number | null };

/**
 * Omniful is asked to cancel it; when it agrees, our row goes (so it can be pushed again —
 * under the next id, since Omniful never takes one twice), the order goes back to New when it
 * was Preparing, and a waybill the parcel put on the order comes off. `markOnly`: it is
 * already cancelled at Omniful (or they cannot find it) — only our mark goes. A delivered
 * parcel is never taken off.
 */
export async function cancelPushed(deps: Deps, orderId: string, opts: { markOnly?: boolean; reason?: string; by?: string } = {}): Promise<CancelResult> {
  const id = String(orderId || "");
  let rows: ShipmentRow[];
  try {
    rows = await deps.db
      .select()
      .from(shipments)
      .where(and(eq(shipments.orderId, id), eq(shipments.carrier, CARRIER)))
      .orderBy(sql`${shipments.createdAt} desc`)
      .limit(1);
  } catch {
    return { error: "db_read_failed" };
  }
  const row = rows[0];
  if (!row) return { skipped: "not_pushed" };
  if (row.deliveredAt) return { error: "already_delivered", detail: "Omniful has delivered it" };
  const sentId = row.sentId || id;
  if (!opts.markOnly) {
    const client = omf(deps);
    if (!client.configured()) return { error: "omniful_not_configured" };
    try {
      await client.cancelOrder(sentId, opts.reason || "Sent to the warehouse by mistake");
    } catch (e) {
      const err = e as OmnifulError;
      return { error: err.code || "omniful_rejected", detail: err.message, upstream: err.status ?? null };
    }
  }
  try {
    await deps.db.delete(shipments).where(and(eq(shipments.orderId, id), eq(shipments.carrier, CARRIER)));
  } catch {
    return { error: "db_write_failed", detail: (opts.markOnly ? "" : "Omniful cancelled " + id + " but ") + "the Empower mark could not be removed — try again" };
  }
  /* that id is spent: the next push goes under the next one */
  await retire(deps, id, sentId).catch(() => {});
  let back = false;
  try {
    back = (await moveOrder(deps, id, "new", "push", { detail: { via: "take-off" } })).changed;
  } catch {
    back = false;
  }
  if (row.awb) {
    await deps.db
      .update(orders)
      .set({ tracking: null, updatedAt: new Date(deps.now()) })
      .where(and(eq(orders.id, id), eq(orders.tracking, row.awb)))
      .catch(() => {});
  }
  await event(deps, id, opts.markOnly ? "mark_removed" : "taken_off", opts.by || "admin", { sentId });
  return { ok: true, cancelled: !opts.markOnly, sentId, status: back ? "new" : null };
}
