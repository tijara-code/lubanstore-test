/**
 * The shelf as the shop sells from it: Omniful's available count (empower/shelf.ts) less what
 * open orders not yet sent to Empower already hold; the public answer the product page reads
 * (GET /api/stock); the panel's Stock Tracker; and THE TILL'S GATE — the one place stock
 * refuses an order, box by box, only where the shop ticked "cap at stock".
 *
 * HELD (v319/v334/v336): Omniful's Available already nets every order pushed to it, so only
 * the orders it will be sent and has not been are held here: New or awaiting a card, in a
 * market Empower ships, with no parcel row, placed in the last 72 h while the auto push is
 * on (14 days while it is off — orders then wait for a person, often longer). An unpaid card
 * attempt holds its boxes only while it can still be paid (its expire_at, else an hour).
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Catalogue } from "../../shared/catalogue/types";
import type { QuoteLine } from "../../shared/pricing/price";
import type { Deps } from "../core/deps";
import { cdn, fail } from "../core/http";
import type { DbOrTx } from "../db/client";
import { orders, shipments } from "../db/schema";
import { loadCatalogue } from "./catalogue";
import { boxesOf } from "./empower/lines";
import { empowerMarkets } from "./empower/rules";
import { capSet, capped, hidden, hideSet, readShelf, skuByItem, skusBySize, type ShelfReading, type TrackerRow } from "./empower/shelf";
import { autoSetting, readSkus } from "./empower/store";

export const HELD_HOURS = 72;
export const HELD_DAYS_MANUAL = 14;
/** how long an unpaid card session is open when the gateway did not say */
export const PENDING_MINUTES = 60;

export interface HeldOrder {
  id: string;
  countryCode: string;
  items: Array<{ itemId?: string; qty?: number }>;
  dedupeId: string | null;
  status: string;
  createdAt: Date;
  expireAt: Date | null;
}

export function payableUntil(o: { expireAt?: Date | null; createdAt: Date }): number {
  const until = o.expireAt ? o.expireAt.getTime() : NaN;
  if (Number.isFinite(until)) return until;
  return o.createdAt.getTime() + PENDING_MINUTES * 60e3;
}

/** The open orders Empower does not know about yet (see the head of this file). */
export async function heldOrders(deps: Deps, cfg: Catalogue, tx?: DbOrTx, autoOn?: boolean): Promise<HeldOrder[]> {
  const mine = empowerMarkets(cfg);
  if (!mine.length) return [];
  const db = tx || deps.db;
  const now = deps.now();
  const auto = autoOn != null ? { on: autoOn } : await autoSetting(deps, db).catch(() => ({ on: false }));
  const floor = new Date(now - (auto.on ? HELD_HOURS * 3600e3 : HELD_DAYS_MANUAL * 86400e3));
  const rows = await db
    .select({
      id: orders.id,
      countryCode: orders.countryCode,
      items: orders.items,
      dedupeId: orders.dedupeId,
      status: orders.status,
      createdAt: orders.createdAt,
      expireAt: orders.expireAt,
    })
    .from(orders)
    .where(and(eq(orders.trashed, false), inArray(orders.status, ["new", "pending"]), inArray(orders.countryCode, mine), gte(orders.createdAt, floor)))
    .orderBy(desc(orders.createdAt), desc(orders.id));
  const open = rows.filter((o) => (o.status === "pending" ? payableUntil(o) > now : true)) as HeldOrder[];
  if (!open.length) return [];
  /* in pieces; a piece whose parcel read fails is held whole (a box counted twice is a sale
     refused; a box not counted is a box sold twice) */
  const pushed = new Set<string>();
  for (let i = 0; i < open.length; i += 200) {
    const ids = open.slice(i, i + 200).map((o) => o.id);
    try {
      const had = await db.select({ orderId: shipments.orderId }).from(shipments).where(inArray(shipments.orderId, ids));
      for (const r of had) if (r.orderId) pushed.add(r.orderId);
    } catch {
      /* held */
    }
  }
  return open.filter((o) => !pushed.has(o.id));
}

const linesOfOrder = (o: HeldOrder) => (o.items || []).map((i) => ({ itemId: i.itemId, qty: i.qty }));

/**
 * The boxes open orders hold, of those named in `boxes`. `except`: this order's own row —
 * by id alone for a known order; for the till only when the row also carries this
 * submission's dedupe id (A5: the browser proposes the id).
 */
export async function reserved(
  deps: Deps,
  cfg: Catalogue,
  boxes: Record<string, unknown>,
  except?: { id: string; dedupeId: string | null } | null,
  rows?: HeldOrder[],
  tx?: DbOrTx,
  autoOn?: boolean,
): Promise<Record<string, number>> {
  const list = rows || (await heldOrders(deps, cfg, tx, autoOn));
  const taken: Record<string, number> = {};
  for (const o of list) {
    if (except && except.id && o.id === except.id && (!except.dedupeId || (o.dedupeId && o.dedupeId === except.dedupeId))) continue;
    const need = boxesOf(cfg, o.countryCode, linesOfOrder(o));
    for (const k of Object.keys(need)) if (boxes[k] != null) taken[k] = (taken[k] || 0) + need[k]!;
  }
  return taken;
}

export interface HeldListItem {
  id: string;
  status: string;
  at: string;
  boxes: Record<string, number>;
}

export interface NetReading extends ShelfReading {
  reserved?: Record<string, number>;
  held?: HeldListItem[];
}

/** The shelf less what open orders hold — what the panel and the page show. */
export async function net(deps: Deps, cfg: Catalogue, r: ShelfReading): Promise<NetReading> {
  const tracker = r.tracker || [];
  if (!tracker.length) return r;
  const boxes: Record<string, number> = {};
  for (const t of tracker) boxes[t.id] = 0;
  let held: HeldOrder[] = [];
  let taken: Record<string, number> = {};
  try {
    held = await heldOrders(deps, cfg);
    taken = await reserved(deps, cfg, boxes, null, held);
  } catch {
    held = [];
    taken = {};
  }
  const rows: TrackerRow[] = tracker.map((t) => {
    const h = taken[t.id] || 0;
    return { ...t, shelf: t.available, reserved: h, available: Math.max(0, t.available - h) };
  });
  const out: NetReading = {
    ...r,
    tracker: rows,
    reserved: taken,
    held: held.map((o) => ({ id: o.id, status: o.status, at: o.createdAt.toISOString(), boxes: boxesOf(cfg, o.countryCode, linesOfOrder(o)) })),
  };
  if (r.left && typeof r.left === "object") {
    const left: Record<string, number> = {};
    for (const sz of Object.keys(r.left)) {
      left[sz] = rows.filter((t) => t.id.slice(-(sz.length + 1)) === "-" + sz).reduce((n, t) => n + t.available, 0);
    }
    out.left = left;
  }
  return out;
}

/** What the gate needs from outside the till's transaction: the shelf, read (perhaps from Omniful) BEFORE the lock. */
export interface GateShelf {
  /** the capped boxes this basket asks for ([] = nothing to check) */
  asked: string[];
  reading: ShelfReading | null;
  autoOn: boolean;
}

/**
 * Read what the gate needs through the ordinary handle, before the till opens its locked
 * transaction: the shelf (kept ≤ 45 s, else asked of Omniful — never while the lock is
 * held) and the auto push switch. Cheap when nothing in the basket is capped (no read).
 */
export async function readShelfForGate(deps: Deps, cfg: Catalogue, countryCode: string, lines: Array<Pick<QuoteLine, "itemId" | "qty">>): Promise<GateShelf> {
  const set = capSet(cfg);
  const need = set.length ? boxesOf(cfg, countryCode, lines) : {};
  const asked = Object.keys(need).filter((k) => set.indexOf(k) > -1);
  if (!asked.length) return { asked, reading: null, autoOn: false };
  const [reading, auto] = await Promise.all([readShelf(deps, cfg, { only: asked }), autoSetting(deps).catch(() => ({ on: false }))]);
  return { asked, reading, autoOn: auto.on };
}

/**
 * THE TILL'S GATE. For every capped box a basket asks for — directly, or inside a set or a
 * large-box offer — the shelf less what other open orders hold must cover it. Throws
 * stock_short (409) { item, left } naming the first box short. Refuses NOTHING when the shelf
 * cannot be read (an unknown shelf is not an empty one), or when no capped box is asked for
 * (then nothing is read at all).
 *
 * `tx`: the till's locked transaction — only the open-order reads go through it. `pre`: the
 * shelf read beforehand (readShelfForGate). With a `tx` and no `pre`, the shelf comes from
 * the kept reading only (no Omniful call while the lock is held).
 */
export async function enforceStock(
  deps: Deps,
  cfg: Catalogue,
  countryCode: string,
  lines: Array<Pick<QuoteLine, "itemId" | "qty">>,
  except?: { id: string; dedupeId: string | null } | null,
  tx?: DbOrTx,
  pre?: GateShelf | null,
): Promise<void> {
  const set = capSet(cfg);
  if (!set.length) return;
  const need = boxesOf(cfg, countryCode, lines);
  const asked = Object.keys(need).filter((k) => set.indexOf(k) > -1);
  if (!asked.length) return;
  const r = pre && pre.reading ? pre.reading : await readShelf(deps, cfg, { only: asked, cacheOnly: !!tx && !pre });
  if (!r.tracker || !r.tracker.length) return;
  const taken = await reserved(deps, cfg, need, except, undefined, tx, pre ? pre.autoOn : undefined).catch(() => ({}) as Record<string, number>);
  const have = capped(cfg, r.tracker);
  for (const k of asked) {
    const left = Math.max(0, (have[k] != null ? have[k]! : 0) - (taken[k] || 0));
    if (need[k]! > left) throw fail("stock_short", 409, { item: k, left });
  }
}

/* ---------------- GET /api/stock ---------------- */

export interface PublicStock {
  left: Record<string, number>;
  hide: { items: string[]; sizes: string[] };
  cap: Record<string, number>;
}

const LAST_OK_MS = 10 * 60e3;
const LAST = new WeakMap<object, { body: PublicStock; at: number }>();

/** The product page's answer, with the CDN headers to send it with. */
export async function publicStock(deps: Deps): Promise<{ body: PublicStock; headers: Record<string, string> }> {
  try {
    const cfg = await loadCatalogue(deps);
    const shelf = await readShelf(deps, cfg);
    const last = LAST.get(deps.db as unknown as object);
    /* nothing readable (the database or Omniful blinked): the minute-old answer, briefly */
    if (shelf.source === "none" && last && deps.now() - last.at < LAST_OK_MS) return { body: last.body, headers: cdn(15, 60, false) };
    const r = await net(deps, cfg, shelf);
    const body: PublicStock = {
      left: cfg.stockLive === true ? r.left || {} : {},
      hide: hidden(cfg, r.tracker || []),
      cap: capped(cfg, r.tracker),
    };
    LAST.set(deps.db as unknown as object, { body, at: deps.now() });
    return { body, headers: cdn(60, 300, true) };
  } catch (e) {
    const last = LAST.get(deps.db as unknown as object);
    if (last && deps.now() - last.at < LAST_OK_MS) return { body: last.body, headers: cdn(15, 60, false) };
    /* no number is better than a wrong one: the page shows no line */
    await deps.log.error("stock", String((e as Error)?.stack || e), { path: "/api/stock" });
    throw fail("upstream", 502);
  }
}

/* ---------------- the panel's Stock Tracker ---------------- */

export async function stockStatus(deps: Deps, opts: { fresh?: boolean } = {}) {
  const cfg = await loadCatalogue(deps, { fresh: true });
  const live: Catalogue = { ...cfg, stockLive: true };
  const r = await net(deps, live, await readShelf(deps, live, { fresh: opts.fresh === true }));
  const skuMap = await readSkus(deps);
  return {
    ok: true as const,
    on: cfg.stockLive === true,
    hideSet: hideSet(cfg),
    capSet: capSet(cfg),
    cap: capped(cfg, r.tracker),
    left: r.left || {},
    at: r.at || null,
    source: r.source,
    error: r.error || null,
    note: r.note || null,
    hubs: r.hubs || null,
    fields: r.fields || null,
    skus: r.skus == null ? null : r.skus,
    tracker: r.tracker || [],
    held: r.held || [],
    heldHours: HELD_HOURS,
    heldDaysManual: HELD_DAYS_MANUAL,
    hide: hidden(cfg, r.tracker || []),
    items: skuByItem(cfg, skuMap),
    bySize: skusBySize(cfg, skuMap),
  };
}
