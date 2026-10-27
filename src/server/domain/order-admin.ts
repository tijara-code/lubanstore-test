/**
 * THE PANEL'S ORDER RULES — plain functions of `deps` the admin API calls (port of the
 * original lib/admin/orders.js + the CRM read in lib/admin/panel.js). No routes here.
 *
 * Each function answers like the original action did (`{ ok: true, … }`) and refuses by
 * throwing `fail(code, status, extra)` with the original codes. Every change to an order
 * writes an order_events row (kind, from, to, by "admin", detail incl. the actor); the
 * admin API audits the call on top.
 *
 * The panel moves an order through fulfilment and corrects who and where; it never sets a
 * price. A basket is re-quoted by the same pricing code the checkout runs; the only figure
 * a person may type is the cash amount to collect on an unpaid cash-on-delivery order.
 */
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { Catalogue } from "../../shared/catalogue/types";
import { asciiDigits, r3, roundTo, toBaisa, typedAmount } from "../../shared/money";
import { checkOf, phoneKey } from "../../shared/orders/phone";
import { isLive, transition, type Status } from "../../shared/orders/status";
import type { OrderLine } from "../../shared/orders/types";
import { bundleSizeId, offerOf, BUNDLES } from "../../shared/pricing/offers";
import { countryFor, isRefusal, priceOrder, type Quote } from "../../shared/pricing/price";
import { dayStart, muscatDay } from "../../shared/time";
import type { Deps } from "../core/deps";
import { fail, HttpError } from "../core/http";
import { crm, orderEvents, orders, shipments, type OrderRow, type ShipmentRow } from "../db/schema";
import { loadCatalogue } from "./catalogue";
import { email as cleanEmail, idList, isOrderId, phone as cleanPhone, phoneLike, str, text } from "./intake";
import { getOrder, moveOrder, newInvoiceKey, newOrderId, recordEvent, writeOrder } from "./orders";
import { enforceStock } from "./stock";

export interface Actor {
  /** the signed-in admin's user name, kept on the order_events row */
  actor?: string;
}

const by = "admin";
const at = (deps: Deps) => new Date(deps.now());
const who = (o: Actor) => (o.actor ? { actor: str(o.actor, 60) } : {});

/** An Empower send that is still a parcel (one taken off — cancelled — is not). */
function liveParcel(s: ShipmentRow): boolean {
  return !/cancel/i.test(String(s.status || ""));
}

async function parcelsOf(deps: Deps, ids: string[]): Promise<ShipmentRow[]> {
  if (!ids.length) return [];
  const rows = await deps.db.select().from(shipments).where(inArray(shipments.orderId, ids)).orderBy(desc(shipments.createdAt));
  return rows.filter(liveParcel);
}

/* ======================= the list ======================= */

export interface ListFilters {
  /** one status or several */
  status?: string | string[];
  pay?: string;
  paymentStatus?: string;
  country?: string;
  origin?: string;
  flagged?: boolean;
  /** false (default): the working list; true: the bin only; "all": both */
  trashed?: boolean | "all";
  /** search: an order number, a phone (any digits), a name, email, city, area or tracking number */
  q?: string;
  /** Muscat days, inclusive: "YYYY-MM-DD" */
  from?: string;
  to?: string;
}

function whereOf(f: ListFilters): SQL | undefined {
  const w: SQL[] = [];
  const statuses = (Array.isArray(f.status) ? f.status : f.status ? [f.status] : []).map(String).filter(Boolean);
  if (statuses.length) w.push(inArray(orders.status, statuses as Status[]));
  if (f.pay) w.push(eq(orders.pay, f.pay as OrderRow["pay"]));
  if (f.paymentStatus) w.push(eq(orders.paymentStatus, f.paymentStatus as OrderRow["paymentStatus"]));
  if (f.country) w.push(eq(orders.countryCode, String(f.country).toUpperCase()));
  if (f.origin) w.push(eq(orders.origin, String(f.origin)));
  if (f.flagged === true) w.push(eq(orders.flagged, true));
  if (f.trashed !== "all") w.push(eq(orders.trashed, f.trashed === true));
  const from = f.from ? dayStart(f.from) : NaN;
  const to = f.to ? dayStart(f.to) : NaN;
  if (Number.isFinite(from)) w.push(gte(orders.createdAt, new Date(from)));
  if (Number.isFinite(to)) w.push(lt(orders.createdAt, new Date(to + 86400e3)));
  const q = str(f.q, 80);
  if (q) {
    const like = "%" + q.replace(/[%_\\]/g, (m) => "\\" + m) + "%";
    const digits = asciiDigits(q).replace(/\D/g, "").replace(/^0+/, "");
    const any: SQL[] = [
      ilike(orders.id, like),
      ilike(orders.name, like),
      ilike(orders.email, like),
      ilike(orders.city, like),
      ilike(orders.region, like),
      ilike(orders.tracking, like),
    ];
    if (digits.length >= 4) {
      any.push(ilike(orders.phoneKey, "%" + digits + "%"));
      any.push(ilike(orders.id, "%" + digits + "%"));
    }
    w.push(or(...any)!);
  }
  return w.length ? and(...w) : undefined;
}

/** A row as the list shows it: no raw gateway payloads, no client signals (asked for one at a time). */
export function listRow(o: OrderRow, parcel?: ShipmentRow | null) {
  const { gateway, client, ...rest } = o;
  void client;
  const out: Record<string, unknown> = { ...rest, hasGateway: gateway != null };
  // what a courier would need and the order lacks (the auto push holds these back)
  if (o.status === "new" || o.status === "prep") {
    const c = checkOf(o);
    if (c.length) out.check = c;
  }
  if (parcel) {
    out.shipment = {
      id: parcel.id,
      sentId: parcel.sentId,
      reference: parcel.reference,
      awb: parcel.awb,
      courier: parcel.courierName,
      status: parcel.status,
      at: parcel.createdAt,
      deliveredAt: parcel.deliveredAt,
    };
  }
  return out;
}

/** The Orders tab: newest first, filtered, a page at a time; each row with its newest Empower send. */
export async function listOrders(deps: Deps, f: ListFilters & { limit?: number; offset?: number } = {}) {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(f.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(f.offset) || 0));
  const where = whereOf(f);
  const [rows, count] = await Promise.all([
    deps.db.select().from(orders).where(where).orderBy(desc(orders.createdAt), desc(orders.id)).limit(limit).offset(offset),
    deps.db.select({ n: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);
  const parcels = rows.length
    ? await deps.db.select().from(shipments).where(inArray(shipments.orderId, rows.map((r) => r.id))).orderBy(desc(shipments.createdAt))
    : [];
  const newest = new Map<string, ShipmentRow>();
  for (const p of parcels) if (p.orderId && !newest.has(p.orderId)) newest.set(p.orderId, p);
  return {
    ok: true as const,
    orders: rows.map((r) => listRow(r, newest.get(r.id))),
    total: count[0]?.n ?? 0,
    limit,
    offset,
  };
}

/** One order in full: the row (with its gateway record), every event, every Empower send. */
export async function orderDetail(deps: Deps, id: string) {
  if (!isOrderId(id)) throw fail("no_id", 400);
  const o = await getOrder(deps.db, id);
  if (!o) throw fail("no_such_order", 404, { id });
  const [events, sends] = await Promise.all([
    deps.db.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(asc(orderEvents.at), asc(orderEvents.id)),
    deps.db.select().from(shipments).where(eq(shipments.orderId, id)).orderBy(desc(shipments.createdAt)),
  ]);
  return { ok: true as const, order: { ...o, check: o.status === "new" || o.status === "prep" ? checkOf(o) : [] }, events, shipments: sends };
}

/* ======================= who and where ======================= */

const CUSTOMER: Record<string, number> = { name: 120, phone: 40, email: 120, city: 80, region: 120, note: 500 };

/**
 * Correct the customer's details: who and where, nothing else, one order at a time (there is
 * no version of "set the phone on these forty orders" that is not a mistake). Limits match
 * the checkout's. A name and a phone cannot be emptied (a courier needs both); an address
 * that is not one is stored as nothing. A changed phone moves the CRM key with it.
 */
export async function updateCustomer(deps: Deps, id: string, patchIn: Record<string, unknown>, o: Actor = {}) {
  if (!isOrderId(id)) throw fail("no_id", 400);
  const p = patchIn && typeof patchIn === "object" ? patchIn : {};
  const patch: Record<string, string | null> = {};
  for (const k of Object.keys(CUSTOMER)) {
    if (p[k] === undefined) continue;
    patch[k] = k === "phone" ? cleanPhone(p[k], CUSTOMER[k]) : k === "email" ? str(p[k], CUSTOMER[k]) : text(p[k] == null ? "" : p[k], CUSTOMER[k]);
  }
  if (!Object.keys(patch).length) throw fail("nothing_to_update", 400);
  if (patch.name !== undefined && !patch.name) throw fail("name_required", 400);
  if (patch.phone !== undefined && (!patch.phone || !phoneLike(patch.phone))) throw fail("bad_phone", 400);
  if (patch.email !== undefined) patch.email = cleanEmail(patch.email);

  return deps.db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw fail("no_such_order", 404, { id });
    const set: Partial<OrderRow> = { ...(patch as Partial<OrderRow>), updatedAt: at(deps) };
    if (patch.phone) set.phoneKey = phoneKey(patch.phone, row.countryCode) || row.phoneKey;
    await tx.update(orders).set(set).where(eq(orders.id, id));
    // the fields that changed, never their values
    const changed = Object.keys(patch).filter((k) => String((row as Record<string, unknown>)[k] ?? "") !== String(patch[k] ?? ""));
    await recordEvent(tx, { orderId: id, at: at(deps), kind: "customer", by, detail: { fields: changed, ...who(o) } });
    return { ok: true as const, patch };
  });
}

/* ======================= what is on it ======================= */

/**
 * Change what is on an order: item ids and quantities, re-quoted by the checkout's pricing.
 * Refused once the basket is in a box (shipped, delivered) or with Empower (a live send),
 * and while the shopper's card page is open for the old figure. `manual` (the Empower tab's
 * "adjust before push"): the shop decides what goes in the box — sold out or switched off
 * allowed, an unknown id not — and the shelf cap is not applied. `codAmount`: the figure
 * agreed with the customer for an unpaid cash order (empty = the catalogue's total).
 * An unpaid card order's gateway amount moves with the re-quote; a paid one's net follows.
 */
export async function requoteItems(
  deps: Deps,
  id: string,
  body: { items?: unknown; manual?: unknown; codAmount?: unknown },
  o: Actor = {},
) {
  if (!isOrderId(id)) throw fail("no_id", 400);
  const posted = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
  if (!posted.length) throw fail("no_items", 400);
  const order = await getOrder(deps.db, id);
  if (!order) throw fail("no_such_order", 404);
  if (order.status === "ship" || order.status === "done") throw fail("already_shipped", 409);
  const parcels = await parcelsOf(deps, [id]);
  if (parcels.length) {
    const p = parcels[0]!;
    throw fail("parcel_booked", 409, { awb: p.awb || p.sentId, carrier: p.courierName || p.carrier || "" });
  }
  if (order.status === "pending" && order.pay === "card" && order.paymentStatus !== "paid") {
    const until = order.expireAt ? order.expireAt.getTime() : NaN;
    if (order.sessionId && (!Number.isFinite(until) || until > deps.now())) {
      throw fail("payment_open", 409, { until: Number.isFinite(until) ? new Date(until).toISOString() : null });
    }
  }
  const was = Number(order.total) || 0;
  const manual = body.manual === true;
  const cfg = await loadCatalogue(deps, { fresh: true });
  let quote: Quote;
  try {
    quote = priceOrder(
      cfg,
      {
        countryCode: order.countryCode,
        pay: order.pay,
        manual,
        existing: true,
        items: posted.map((i) => {
          const line = (i && typeof i === "object" ? i : {}) as Record<string, unknown>;
          return { itemId: str(line.itemId, 80), qty: Math.max(1, Math.min(99, parseInt(String(line.qty), 10) || 1)) };
        }),
      },
      deps.now(),
    );
  } catch (e) {
    const r = e as { code?: string; item?: string | null };
    throw fail(isRefusal(e) ? r.code! : "cannot_price", 400, { item: r.item || null });
  }
  if (!manual) {
    try {
      await enforceStock(deps, cfg, quote.country.code, quote.items, { id: order.id, dedupeId: order.dedupeId });
    } catch (e) {
      if (e instanceof HttpError && e.code === "stock_short") throw e;
      const s = e as { code?: string; item?: unknown; left?: unknown };
      if (s && s.code === "stock_short") throw fail("stock_short", 409, { item: s.item, left: s.left });
    }
  }

  let total = quote.total;
  let omr = quote.omr;
  let codAmount: number | null = null;
  const typed = String(body.codAmount == null ? "" : body.codAmount).trim();
  if (typed !== "") {
    const unpaidCod = order.pay === "cod" && order.paymentStatus !== "paid" && !order.refunded;
    if (!unpaidCod) throw fail("cod_amount_not_cod", 400);
    const n = typedAmount(typed);
    if (!Number.isFinite(n)) throw fail("bad_cod_amount", 400);
    total = roundTo(n, quote.country.dec);
    omr = r3(total * quote.omrRate);
    codAmount = total;
  }
  const unpaidCard = order.pay === "card" && order.paymentStatus !== "paid" && order.paymentStatus !== "refunded" && !order.refunded;
  const set: Partial<OrderRow> = {
    items: quote.items as OrderLine[],
    cur: quote.cur,
    sub: quote.sub,
    ship: quote.ship,
    codFee: quote.codFee,
    total,
    omr,
    updatedAt: at(deps),
  };
  if (unpaidCard) {
    set.amountBaisa = toBaisa(quote.total * quote.omrRate);
    omr = set.amountBaisa / 1000;
    set.omr = omr;
  }
  if (order.pay === "card" && order.paymentStatus === "paid" && order.gatewayFee != null) {
    set.netAmount = r3(omr - (Number(order.gatewayFee) || 0));
  }
  await deps.db.transaction(async (tx) => {
    const hit = await tx
      .update(orders)
      .set(set)
      .where(and(eq(orders.id, id), eq(orders.status, order.status)))
      .returning({ id: orders.id });
    if (!hit[0]) throw fail("stale", 409, { id, was: order.status });
    await recordEvent(tx, {
      orderId: id,
      at: at(deps),
      kind: "items",
      by,
      detail: { was, total, omr, codAmount, manual, lines: quote.items.map((l) => l.itemId + "×" + l.qty), ...who(o) },
    });
  });
  return {
    ok: true as const,
    items: quote.items as OrderLine[],
    cur: quote.cur,
    ship: quote.ship,
    total,
    omr,
    catalogueTotal: quote.total,
    codAmount,
    was,
  };
}

/** What the item editor may offer for a market (`all`: the manual forms — sold out included). */
export async function orderOptions(deps: Deps, countryCode: string, all = false) {
  const cfg = await loadCatalogue(deps, { fresh: true });
  const c = countryFor(cfg, countryCode);
  if (!c) throw fail("unknown_country", 400);
  const list = (kind: "sizes" | "scents" | "extras") => {
    const own = c[kind];
    const items = (Array.isArray(own) && own.length ? own : (cfg[kind] as Array<Record<string, unknown>>) || []) as Array<Record<string, unknown>>;
    return items
      .filter((i) => all || (i.soldOut !== true && i.soldOut !== "true"))
      .map((i) => {
        const out = i.soldOut === true || i.soldOut === "true";
        return { id: String(i.id), name: String(i.name || "") + (all && out ? " — sold out" : ""), weight: String(i.weight || ""), active: i.active !== false };
      });
  };
  const offer = offerOf(cfg, "bundle");
  return {
    ok: true as const,
    cur: c.cur,
    dec: c.dec || 0,
    sizes: list("sizes"),
    scents: list("scents"),
    extras: list("extras").filter((x) => all || x.active),
    offer: offer && (all || offer.active) ? { id: "bundle", name: offer.name, sizeId: bundleSizeId(cfg, "bundle") } : null,
    offers: BUNDLES.map((bid) => {
      const of = offerOf(cfg, bid);
      return of && (all || of.active) ? { id: bid, name: of.name || "باقة" } : null;
    }).filter(Boolean),
  };
}

/* ======================= the status flow ======================= */

/** The panel's words: "pending" is the till's alone. */
export const PANEL_STATUS = ["new", "prep", "ship", "done", "void"] as const;

export interface StatusOptions extends Actor {
  /** a person who was told (it moves back, or abandons a live parcel) */
  force?: boolean;
  /** manual shipping: the tracking number and carrier, written with a move to "ship" */
  tracking?: string;
  carrier?: string;
}

/** The checks for a set of orders, refused whole (the original's checkPatch). → rows read, by id. */
async function checkMove(deps: Deps, ids: string[], to: string, opts: StatusOptions): Promise<Map<string, OrderRow>> {
  if ((PANEL_STATUS as readonly string[]).indexOf(to) < 0) throw fail("bad_status", 400, { allowed: PANEL_STATUS });
  const rows = await deps.db.select().from(orders).where(inArray(orders.id, ids));
  const seen = new Map(rows.map((r) => [r.id, r]));
  const verdicts = rows.map((r) => ({ r, why: transition(r, to, "admin", { force: opts.force === true }) }));
  const waiting = verdicts.filter((v) => v.r.status === "pending" && v.why).map((v) => v.r.id);
  if (waiting.length) throw fail("awaiting_payment", 409, { ids: waiting });
  const back = verdicts.filter((v) => v.why === "moving_back").map((v) => v.r.id);
  if (back.length) throw fail("moving_back", 409, { ids: back });
  const other = verdicts.filter((v) => v.why);
  if (other.length) throw fail(other[0]!.why!, 409, { ids: other.map((v) => v.r.id) });
  if (to === "void" && opts.force !== true) {
    const parcels = await parcelsOf(deps, rows.filter((r) => r.status !== "void").map((r) => r.id));
    if (parcels.length) {
      throw fail("parcel_live", 409, {
        detail: parcels.map((p) => (p.courierName || p.carrier || "parcel") + " " + (p.awb || p.sentId)).join(", "),
        ids: parcels.map((p) => p.orderId),
        parcels: parcels.map((p) => ({ id: p.orderId, awb: p.awb || p.sentId, carrier: p.courierName || p.carrier || "" })),
      });
    }
  }
  return seen;
}

function shipPatch(to: string, opts: StatusOptions): Partial<OrderRow> {
  const patch: Partial<OrderRow> = {};
  if (to === "ship" || opts.tracking !== undefined || opts.carrier !== undefined) {
    if (opts.tracking !== undefined) patch.tracking = str(opts.tracking, 80) || null;
    if (opts.carrier !== undefined) patch.carrier = str(opts.carrier, 60) || null;
  }
  return patch;
}

/**
 * Move one order (the Orders tab's status field). Conditional on the status read: an order
 * the courier's news or a job moved meanwhile is answered 409 stale, not written over.
 * "ship" may carry the manual tracking number and carrier and stamps shipped_at; "done"
 * stamps delivered_at.
 */
export async function setStatus(deps: Deps, id: string, to: string, opts: StatusOptions = {}) {
  if (!isOrderId(id)) throw fail("no_id", 400);
  const seen = await checkMove(deps, [id], to, opts);
  const row = seen.get(id);
  if (!row) throw fail("no_such_order", 404, { id });
  if (row.status === to) {
    const patch = shipPatch(to, opts);
    if (Object.keys(patch).length) await writeTracking(deps, row, patch, opts);
    return { ok: true as const, id, from: row.status, to, changed: false };
  }
  const r = await moveOrder(deps, id, to as Status, by, {
    force: opts.force === true,
    from: row.status,
    patch: shipPatch(to, opts),
    detail: who(opts),
  });
  if (r.refusal === "stale" || r.refusal === "not_found") {
    throw fail("stale", 409, { id, was: row.status, detail: "the order changed while you were looking at it — the list has been refreshed" });
  }
  if (r.refusal) throw fail(r.refusal, 409, { ids: [id] });
  return { ok: true as const, id, from: row.status, to, changed: r.changed };
}

/** The bulk bar: the same rules for the whole selection (refused whole), then each row as it was read. */
export async function bulkSetStatus(deps: Deps, idsIn: unknown, to: string, opts: StatusOptions = {}) {
  const ids = idList(idsIn).filter(isOrderId);
  if (!ids.length) throw fail("no_ids", 400);
  const seen = await checkMove(deps, ids, to, opts);
  let updated = 0;
  const stale: string[] = [];
  for (const id of ids) {
    const row = seen.get(id);
    if (!row) {
      stale.push(id);
      continue;
    }
    if (row.status === to) {
      updated++;
      continue;
    }
    const r = await moveOrder(deps, id, to as Status, by, { force: opts.force === true, from: row.status, patch: shipPatch(to, opts), detail: who(opts) });
    if (r.changed) updated++;
    else stale.push(id);
  }
  return { ok: true as const, updated, stale };
}

async function writeTracking(deps: Deps, row: OrderRow, patch: Partial<OrderRow>, o: Actor) {
  await deps.db.transaction(async (tx) => {
    await tx.update(orders).set({ ...patch, updatedAt: at(deps) }).where(eq(orders.id, row.id));
    await recordEvent(tx, {
      orderId: row.id,
      at: at(deps),
      kind: "tracking",
      by,
      from: row.tracking,
      to: patch.tracking === undefined ? row.tracking : patch.tracking,
      detail: { carrier: patch.carrier === undefined ? row.carrier : patch.carrier, ...who(o) },
    });
  });
}

/**
 * Manual shipping: the tracking number and carrier name for an order Empower does not carry.
 * `ship: true` also moves it to Shipped (stamping shipped_at) under the status rules.
 */
export async function setTracking(deps: Deps, id: string, body: { tracking?: unknown; carrier?: unknown; ship?: unknown }, o: Actor = {}) {
  if (!isOrderId(id)) throw fail("no_id", 400);
  const row = await getOrder(deps.db, id);
  if (!row) throw fail("no_such_order", 404, { id });
  const patch: Partial<OrderRow> = {
    tracking: str(body.tracking, 80) || null,
    carrier: body.carrier === undefined ? row.carrier : str(body.carrier, 60) || null,
  };
  if (body.ship === true && row.status !== "ship") {
    return setStatus(deps, id, "ship", { ...o, tracking: patch.tracking ?? "", carrier: patch.carrier ?? "" });
  }
  await writeTracking(deps, row, patch, o);
  return { ok: true as const, id, tracking: patch.tracking, carrier: patch.carrier };
}

/**
 * The cash order's payment by hand: cod ↔ paid (collected, or paid outside the gateway).
 * A card order's payment state is the gateway's.
 */
export async function setPayment(deps: Deps, idsIn: unknown, to: string, o: Actor = {}) {
  const ids = (typeof idsIn === "string" ? [idsIn] : idList(idsIn)).filter(isOrderId);
  if (!ids.length) throw fail("no_ids", 400);
  if (to !== "cod" && to !== "paid") throw fail("bad_payment_status", 400, { allowed: ["cod", "paid"] });
  const rows = await deps.db.select().from(orders).where(inArray(orders.id, ids));
  if (typeof idsIn === "string" && !rows.length) throw fail("no_such_order", 404, { id: idsIn });
  const card = rows.filter((r) => r.pay === "card" || (r.paymentStatus !== "cod" && r.paymentStatus !== "paid") || r.refunded);
  if (card.length) throw fail("card_payment_is_the_gateways", 409, { ids: card.map((r) => r.id) });
  let updated = 0;
  const stale: string[] = ids.filter((id) => !rows.some((r) => r.id === id));
  for (const r of rows) {
    if (r.paymentStatus === to) {
      updated++;
      continue;
    }
    const ok = await deps.db.transaction(async (tx) => {
      const hit = await tx
        .update(orders)
        .set({ paymentStatus: to, paidAt: to === "paid" ? r.paidAt || at(deps) : null, updatedAt: at(deps) })
        .where(and(eq(orders.id, r.id), eq(orders.paymentStatus, r.paymentStatus)))
        .returning({ id: orders.id });
      if (!hit[0]) return false;
      await recordEvent(tx, { orderId: r.id, at: at(deps), kind: "payment", by, from: r.paymentStatus, to, detail: who(o) });
      return true;
    });
    if (ok) updated++;
    else stale.push(r.id);
  }
  return { ok: true as const, updated, stale };
}

/* ======================= the shop's own marks ======================= */

async function markAll(
  deps: Deps,
  idsIn: unknown,
  set: Partial<OrderRow>,
  kind: string,
  detail: Record<string, unknown>,
): Promise<number> {
  const ids = (typeof idsIn === "string" ? [idsIn] : idList(idsIn)).filter(isOrderId);
  if (!ids.length) throw fail("no_ids", 400);
  return deps.db.transaction(async (tx) => {
    const hit = await tx.update(orders).set({ ...set, updatedAt: at(deps) }).where(inArray(orders.id, ids)).returning({ id: orders.id });
    if (hit.length) {
      await tx.insert(orderEvents).values(hit.map((h) => ({ orderId: h.id, at: at(deps), kind, from: null, to: null, by, detail })));
    }
    return hit.length;
  });
}

/** A mark to come back to (a customer to call, a parcel to chase). Changes nothing else. */
export async function setFlag(deps: Deps, ids: unknown, on: boolean, o: Actor = {}) {
  const updated = await markAll(deps, ids, { flagged: on, flaggedAt: on ? at(deps) : null }, on ? "flag" : "unflag", who(o));
  return { ok: true as const, updated, flagged: on };
}

/** The shop's own note on an order (never shown to the customer). */
export async function setNote(deps: Deps, ids: unknown, note: unknown, o: Actor = {}) {
  const v = str(note, 500);
  const updated = await markAll(deps, ids, { adminNote: v || null }, "note", { length: v.length, ...who(o) });
  return { ok: true as const, updated };
}

/** Soft delete: the row keeps its money, customer and gateway record; it leaves the working list. */
export async function setTrashed(deps: Deps, ids: unknown, trashed: boolean, o: Actor = {}) {
  const updated = await markAll(deps, ids, { trashed, trashedAt: trashed ? at(deps) : null }, trashed ? "trash" : "restore", who(o));
  return { ok: true as const, updated, trashed };
}

/**
 * Permanent delete, binned orders only. A paid order is an accounting record and a refunded
 * one a refund trail — any order that ever had a charge — they can be binned, never destroyed.
 * The batch is refused whole.
 */
export async function purgeOrders(deps: Deps, idsIn: unknown) {
  const ids = (typeof idsIn === "string" ? [idsIn] : idList(idsIn)).filter(isOrderId);
  if (!ids.length) throw fail("no_ids", 400);
  const rows = await deps.db.select().from(orders).where(inArray(orders.id, ids));
  const paid = rows.filter((r) => r.paymentStatus === "paid" || r.paymentStatus === "refunded" || r.refunded || !!r.paymentId);
  if (paid.length) throw fail("paid_orders_cannot_be_deleted", 409, { ids: paid.map((r) => r.id) });
  const live = rows.filter((r) => !r.trashed);
  if (live.length) throw fail("must_be_trashed_first", 409, { ids: live.map((r) => r.id) });
  if (!rows.length) return { ok: true as const, deleted: 0 };
  const gone = await deps.db.delete(orders).where(and(inArray(orders.id, rows.map((r) => r.id)), eq(orders.trashed, true))).returning({ id: orders.id });
  return { ok: true as const, deleted: gone.length };
}

/* ======================= the WhatsApp / typed-in order ======================= */

export interface ManualOrderInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  countryCode?: unknown;
  city?: unknown;
  region?: unknown;
  note?: unknown;
  items?: unknown;
  /** "cod" (collected by the courier) or "transfer" (paid outside the gateway); "paid" is read as transfer */
  pay?: unknown;
  payment?: unknown;
  /** the cash figure agreed on WhatsApp (cod only; empty = the catalogue's total) */
  codAmount?: unknown;
  /** one per filled form: the same form sent twice is one order */
  dedupeId?: unknown;
}

function manualPay(b: ManualOrderInput): "cod" | "transfer" {
  return b.pay === "transfer" || b.payment === "paid" || b.pay === "paid" ? "transfer" : "cod";
}

/** The form's running total: the same pricing as the till, availability the shop's call. */
export async function quoteManualOrder(deps: Deps, b: ManualOrderInput, cfgIn?: Catalogue) {
  const cfg = cfgIn || (await loadCatalogue(deps, { fresh: true }));
  const pay = manualPay(b);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((i) => {
    const line = (i && typeof i === "object" ? i : {}) as Record<string, unknown>;
    return { itemId: str(line.itemId, 60), qty: line.qty };
  });
  let quote: Quote;
  try {
    quote = priceOrder(cfg, { countryCode: str(b.countryCode, 4).toUpperCase(), items, pay, manual: true }, deps.now());
  } catch (e) {
    const r = e as { code?: string; item?: string | null };
    throw fail(isRefusal(e) ? r.code! : "pricing_failed", 400, { item: r.item || null });
  }
  const summary: {
    cur: string; sub: number; ship: number; codFee: number; total: number; omr: number; items: Quote["items"];
    catalogueTotal?: number; codAmount?: number;
  } = { cur: quote.cur, sub: quote.sub, ship: quote.ship, codFee: quote.codFee, total: quote.total, omr: quote.omr, items: quote.items };
  const typed = String(b.codAmount == null ? "" : b.codAmount).trim();
  if (pay === "cod" && typed !== "") {
    const n = typedAmount(typed);
    if (!Number.isFinite(n)) throw fail("bad_cod_amount", 400);
    summary.catalogueTotal = summary.total;
    summary.total = roundTo(n, quote.country.dec);
    summary.omr = r3(summary.total * quote.omrRate);
    summary.codAmount = summary.total;
  }
  return { ok: true as const, ...summary, quote, pay };
}

/**
 * A WHATSAPP ORDER typed in on the panel: a real order (an LM- number from the same writer,
 * priced by the same engine with `manual`), origin "whatsapp_order" (its own word — "whatsapp"
 * already means a website order from a wa.me link), attribution whatsapp / chat (how "panel").
 * Paid by transfer means paid outside the gateway: no cash fee, nothing to collect. It is
 * never reported as a Purchase to the ad platforms (no browser, no ad click — and the
 * platforms would count the shop's own typing as a conversion).
 */
export async function createManualOrder(deps: Deps, b: ManualOrderInput, o: Actor = {}) {
  const cfg = await loadCatalogue(deps, { fresh: true });
  const q = await quoteManualOrder(deps, b, cfg);
  const { quote, pay, ok: _ok, ...summary } = q;
  void _ok;
  const name = text(b.name, 120);
  if (!name) throw fail("no_name", 400);
  // the number as typed, in whatever digits, without its country code or a local leading zero
  const dial = String(quote.country.dial || "").replace(/\D/g, "");
  let digits = asciiDigits(b.phone == null ? "" : typeof b.phone === "string" || typeof b.phone === "number" ? String(b.phone) : "").replace(/\D/g, "");
  if (dial && digits.indexOf("00" + dial) === 0) digits = digits.slice(2 + dial.length);
  else if (dial && digits.indexOf(dial) === 0 && digits.length > dial.length + 7) digits = digits.slice(dial.length);
  digits = digits.replace(/^0+/, "");
  if (digits.length < 7 || digits.length > 12) throw fail("bad_phone", 400);
  const city = text(b.city, 80);
  if (!city) throw fail("no_city", 400);
  const phone = "+" + dial + " " + digits;
  const now = at(deps);
  const wrote = await writeOrder(
    deps,
    {
      id: newOrderId(deps.now()),
      createdAt: now,
      updatedAt: now,
      name,
      phone,
      phoneKey: phoneKey(phone, quote.country.code) || null,
      email: cleanEmail(b.email),
      country: str(quote.country.name, 60),
      countryCode: quote.country.code,
      city,
      region: text(b.region, 120),
      note: text(b.note, 500),
      pay,
      items: quote.items as OrderLine[],
      cur: quote.cur,
      sub: quote.sub,
      ship: quote.ship,
      codFee: quote.codFee,
      total: summary.total,
      omrRate: quote.omrRate,
      omr: summary.omr,
      dedupeId: str(b.dedupeId, 64) || null,
      invoiceKey: newInvoiceKey(),
      status: "new",
      paymentStatus: pay === "transfer" ? "paid" : "cod",
      paidAt: pay === "transfer" ? now : null,
      origin: "whatsapp_order",
      attribution: { source: "whatsapp", medium: "chat", how: "panel" },
    },
    { by, detail: { origin: "whatsapp_order", ...(summary.codAmount != null ? { codAmount: summary.codAmount } : {}), ...who(o) } },
  );
  if (!wrote.fresh) {
    return { ok: true as const, ...summary, id: wrote.id, already: true, total: wrote.order.total, cur: wrote.order.cur };
  }
  return { ok: true as const, id: wrote.id, already: false, ...summary };
}

/* ======================= customers (CRM) ======================= */

export interface CustomerRow {
  phoneKey: string;
  name: string | null;
  phone: string | null;
  /** every order not binned */
  orders: number;
  /** real ones (not cancelled, not awaiting payment, not refunded) */
  live: number;
  /** what the live orders came to, OMR */
  spend: number;
  first: string;
  last: string;
  countries: string[];
  note: string;
  tags: string[];
}

/**
 * The Customers tab: orders added up per person (the phone key — international digits, kept
 * after the retention purge clears the name and phone, so a repeat customer is still one).
 * A cancelled order lists the customer with nothing live and nothing spent.
 */
export async function listCustomers(
  deps: Deps,
  f: { q?: string; country?: string; sort?: "last" | "spend" | "orders"; limit?: number; offset?: number } = {},
) {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(f.limit) || 100)));
  const offset = Math.max(0, Math.floor(Number(f.offset) || 0));
  const liveCond = sql`(${orders.status} not in ('void','pending') and ${orders.paymentStatus} <> 'refunded' and not ${orders.refunded})`;
  const w: SQL[] = [eq(orders.trashed, false), sql`${orders.phoneKey} is not null and ${orders.phoneKey} <> ''`];
  const q = str(f.q, 80);
  if (q) {
    const digits = asciiDigits(q).replace(/\D/g, "").replace(/^0+/, "");
    const like = "%" + q.replace(/[%_\\]/g, (m) => "\\" + m) + "%";
    w.push(digits.length >= 4 ? ilike(orders.phoneKey, "%" + digits + "%") : ilike(orders.name, like));
  }
  const having = f.country ? sql`bool_or(${orders.countryCode} = ${String(f.country).toUpperCase()})` : undefined;
  const sort = f.sort === "spend" ? sql`spend desc` : f.sort === "orders" ? sql`live desc` : sql`last desc`;
  const base = deps.db
    .select({
      phoneKey: orders.phoneKey,
      name: sql<string | null>`(array_agg(${orders.name} order by ${orders.createdAt} desc) filter (where ${orders.name} is not null))[1]`.as("name"),
      phone: sql<string | null>`(array_agg(${orders.phone} order by ${orders.createdAt} desc) filter (where ${orders.phone} is not null))[1]`.as("phone"),
      orders: sql<number>`count(*)::int`.as("orders"),
      live: sql<number>`(count(*) filter (where ${liveCond}))::int`.as("live"),
      spend: sql<number>`coalesce(sum(${orders.omr}) filter (where ${liveCond}), 0)::float8`.as("spend"),
      first: sql<Date>`min(${orders.createdAt})`.as("first"),
      last: sql<Date>`max(${orders.createdAt})`.as("last"),
      countries: sql<string[]>`array_agg(distinct ${orders.countryCode})`.as("countries"),
    })
    .from(orders)
    .where(and(...w))
    .groupBy(orders.phoneKey);
  const grouped = having ? base.having(having) : base;
  const rows = await grouped.orderBy(sort).limit(limit).offset(offset);
  const keys = rows.map((r) => r.phoneKey!).filter(Boolean);
  const notes = keys.length ? await deps.db.select().from(crm).where(inArray(crm.phoneKey, keys)) : [];
  const byKey = new Map(notes.map((n) => [n.phoneKey, n]));
  const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : new Date(String(d)).toISOString());
  const customers: CustomerRow[] = rows.map((r) => ({
    phoneKey: r.phoneKey!,
    name: r.name,
    phone: r.phone,
    orders: Number(r.orders),
    live: Number(r.live),
    spend: r3(Number(r.spend)),
    first: iso(r.first),
    last: iso(r.last),
    countries: (r.countries || []).filter(Boolean).sort(),
    note: byKey.get(r.phoneKey!)?.note || "",
    tags: byKey.get(r.phoneKey!)?.tags || [],
  }));
  return { ok: true as const, customers, limit, offset };
}

/** Every CRM note and tag, by phone key (the original crm.list shape: { [key]: { note, tags } }). */
export async function listCrm(deps: Deps) {
  const rows = await deps.db.select().from(crm);
  const map: Record<string, { note: string; tags: string[] }> = {};
  for (const r of rows) map[r.phoneKey] = { note: r.note || "", tags: r.tags || [] };
  return { ok: true as const, crm: map };
}

/** Write a customer's note and tags; both empty removes the row (nothing kept that is not needed). */
export async function saveCrm(deps: Deps, key: unknown, body: { note?: unknown; tags?: unknown }) {
  const phoneKeyV = asciiDigits(str(key, 20)).replace(/\D/g, "");
  if (!/^\d{7,15}$/.test(phoneKeyV)) throw fail("bad_phone_key", 400);
  const note = text(body.note, 1000);
  const tags = Array.from(
    new Set((Array.isArray(body.tags) ? body.tags : []).map((t) => text(t, 40).toLowerCase()).filter(Boolean)),
  ).slice(0, 20);
  if (!note && !tags.length) {
    await deps.db.delete(crm).where(eq(crm.phoneKey, phoneKeyV));
    return { ok: true as const, phoneKey: phoneKeyV, note: "", tags: [] as string[], removed: true };
  }
  await deps.db
    .insert(crm)
    .values({ phoneKey: phoneKeyV, note: note || null, tags, updatedAt: at(deps) })
    .onConflictDoUpdate({ target: crm.phoneKey, set: { note: note || null, tags, updatedAt: at(deps) } });
  return { ok: true as const, phoneKey: phoneKeyV, note, tags };
}

/* ======================= the export ======================= */

export const EXPORT_COLUMNS = [
  "Order", "Placed (Muscat)", "Status", "Payment", "Pay", "Country", "City", "Area", "Customer", "Phone", "Email",
  "Items", "Currency", "Subtotal", "Delivery", "COD fee", "Total", "OMR", "Origin", "Source", "Medium", "Campaign",
  "Tracking", "Carrier", "Flagged", "Note", "Live",
] as const;

/** The Orders export: one row per order, the filters of the list, every page (capped at 20,000). */
export async function exportOrders(deps: Deps, f: ListFilters = {}) {
  const rows = await deps.db.select().from(orders).where(whereOf(f)).orderBy(desc(orders.createdAt), desc(orders.id)).limit(20000);
  const out = rows.map((o) => {
    const placed = new Date(o.createdAt.getTime() + 4 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
    return [
      o.id, placed, o.status, o.paymentStatus, o.pay, o.countryCode, o.city || "", o.region || "", o.name || "", o.phone || "", o.email || "",
      (o.items || []).map((i) => [i.scent, i.size].filter(Boolean).join(" ") + " ×" + i.qty).join(" + "),
      o.cur, o.sub, o.ship, o.codFee, o.total, o.omr, o.origin || "",
      o.attribution?.source || "", o.attribution?.medium || "", o.attribution?.campaign || "",
      o.tracking || "", o.carrier || "", o.flagged ? "yes" : "", o.adminNote || "", isLive(o) ? "yes" : "no",
    ] as Array<string | number>;
  });
  return { ok: true as const, columns: [...EXPORT_COLUMNS] as string[], rows: out, day: muscatDay(deps.now()) };
}

/** RFC 4180 CSV; a cell a spreadsheet would run as a formula (= + - @) is quoted with a leading '. */
export function toCsv(columns: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

