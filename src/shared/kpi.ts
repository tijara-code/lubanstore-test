/**
 * KPI — every figure the panel shows, defined once (port of the original netlify/lib/kpi.js).
 * The server (analytics, the orders summary) and the admin import this one module, so the
 * Overview, Sales, Analytics, Customers and the exports cannot disagree.
 *
 * Every money figure is `omr` — the order's value in Omani rial at the rate of the day it was
 * placed. Every window is cut on MUSCAT days (+04, no daylight saving).
 *
 *   live        not in the trash, not Cancelled (void), not still awaiting a card payment
 *               (pending), not refunded (payment status "refunded" or the refunded flag).
 *   orders      the live orders in the window.
 *   gross       Σ omr of the live orders: what was sold.
 *   settled     Σ omr of the live orders whose money is IN: card paid, or cash marked collected
 *               (payment status "paid"). A cash order still with the courier is `expected`.
 *   expected    Σ omr of the live orders not yet paid.
 *   net         settled − gateway fees (card).
 *   aov         gross ÷ orders.
 *   total       every order in the window not in the trash, any state.
 *   cancelled   status Cancelled (void) in the window — a cancelled order, or a card attempt
 *               that never paid and expired — not trashed. ("Cancelled or failed".)
 *   cancelledPct  cancelled ÷ total, a whole percentage ("% of all orders").
 *   refunded    orders whose money went back (the flag or the status), in the window.
 *   refundRate  refunded ÷ (orders + refunded).
 *   delivered   status Delivered (done) in the window, not trashed.
 *   deliveryHrs median hours from a parcel's booking to its delivery, delivered ones only.
 *   conversion  orders ÷ sessions over the same days (the caller supplies the sessions).
 *   repeatRate  customers with two or more live orders ÷ customers; a customer is the
 *               phone's last nine digits.
 *   cpp         ad spend ÷ orders — null until a spend figure exists.
 *
 * Windows: { from, to } as "YYYY-MM-DD" Muscat days, inclusive; null = all time. Functions that
 * need "today" take `now` (ms) — the server passes deps.now(), the panel its clock.
 */
export const GULF_MS = 4 * 3600e3;
export const DAY_MS = 86400e3;

export type KpiWindow = { from: string; to: string } | null;

export interface KpiOrder {
  _kpi: true;
  id: string;
  at: string | null;
  day: string;
  status: string;
  pay: string;
  payStatus: string;
  refunded: boolean;
  trashed: boolean;
  omr: number;
  fee: number;
  phone: string;
  cc: string;
  origin: string;
  ledger: boolean;
}

export interface KpiResult {
  window: KpiWindow;
  total: number;
  orders: number;
  gross: number;
  settled: number;
  expected: number;
  net: number;
  aov: number;
  cancelled: number;
  cancelledPct: number;
  refunded: number;
  refundRate: number;
  delivered: number;
  conversion: number | null;
  sessions: number | null;
  repeatRate: number;
  customers: number;
  cpp: number | null;
  deliveryHrs: number | null;
}

function toMs(t: unknown): number {
  if (t instanceof Date) return t.getTime();
  if (typeof t === "number") return t;
  return Date.parse(String(t || ""));
}

export function muscatDay(t: unknown): string {
  const n = toMs(t);
  return Number.isFinite(n) ? new Date(n + GULF_MS).toISOString().slice(0, 10) : "";
}

export function todayMuscat(now: number): string {
  return muscatDay(now);
}

export function shiftDay(day: string, n: number): string {
  const t = Date.parse(day + "T00:00:00Z");
  return new Date(t + n * DAY_MS).toISOString().slice(0, 10);
}

export const window = {
  /** the last n calendar days ending today */
  days(n: number, now: number): KpiWindow {
    const to = todayMuscat(now);
    return { from: shiftDay(to, -(Math.max(1, n) - 1)), to };
  },
  /** the current Muscat month */
  month(now: number): KpiWindow {
    const to = todayMuscat(now);
    return { from: to.slice(0, 8) + "01", to };
  },
  all(): KpiWindow {
    return null;
  },
  /** the window just before this one, the same length: for a delta */
  previous(w: KpiWindow): KpiWindow {
    if (!w) return null;
    const len = Math.round((Date.parse(w.to + "T00:00:00Z") - Date.parse(w.from + "T00:00:00Z")) / DAY_MS) + 1;
    return { from: shiftDay(w.from, -len), to: shiftDay(w.from, -1) };
  },
};

export function inWindow(day: string, w: KpiWindow): boolean {
  return !w || (!!day && day >= w.from && day <= w.to);
}

type AnyOrder = Record<string, unknown> | KpiOrder | null | undefined;

/**
 * ONE SHAPE for a database row (drizzle's createdAt / paymentStatus …, or snake_case
 * created_at / payment_status), the panel's adapted order (date, paymentStatus) and a ledger
 * row (at, paid, cancelled).
 */
export function norm(input: AnyOrder): KpiOrder | null {
  if (!input) return null;
  const o = input as Record<string, unknown>;
  if (o._kpi === true) return o as unknown as KpiOrder;
  const rawAt = o.createdAt ?? o.created_at ?? o.date ?? o.at ?? null;
  const atMs = toMs(rawAt);
  const at = Number.isFinite(atMs) ? new Date(atMs).toISOString() : null;
  const ps = (o.paymentStatus ?? o.payment_status ??
    (o.pay === "cod" ? "cod" : o.paid === true ? "paid" : o.paid === false ? "cod" : "unpaid")) as string;
  const status = (o.status as string) || (o.cancelled ? "void" : "new");
  const fee = o.gatewayFee != null ? o.gatewayFee : o.gateway_fee;
  return {
    _kpi: true,
    id: String(o.id ?? ""),
    at,
    day: muscatDay(atMs),
    status: String(status),
    pay: String(o.pay || (o.paid === true ? "card" : "cod")),
    payStatus: String(ps),
    refunded: o.refunded === true || ps === "refunded",
    trashed: !!o.trashed,
    omr: Number(o.omr) || 0,
    fee: Number(fee) || 0,
    phone: String(o.phone || o.phoneKey || o.phone_key || ""),
    cc: String(o.countryCode || o.country_code || o.country || ""),
    origin: String(o.origin || ""),
    ledger: o.paid !== undefined && o.payment_status === undefined && o.paymentStatus === undefined,
  };
}

export function all(list: readonly AnyOrder[] | null | undefined): KpiOrder[] {
  return (list || []).map(norm).filter((x): x is KpiOrder => !!x);
}

export function isLive(input: AnyOrder): boolean {
  const o = norm(input);
  return !!o && !o.trashed && o.status !== "void" && o.status !== "pending" && !o.refunded;
}

export function isSettled(input: AnyOrder): boolean {
  const o = norm(input);
  return isLive(o) && !!o && o.payStatus === "paid";
}

export function isExpected(input: AnyOrder): boolean {
  const o = norm(input);
  return isLive(o) && !!o && o.payStatus !== "paid";
}

/** a customer: the phone's last nine digits (Arabic digits read) */
export function phoneKey(phone: unknown): string {
  const d = String(phone || "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : d;
}

function sum(rows: KpiOrder[], f: (o: KpiOrder) => number): number {
  let t = 0;
  for (const r of rows) t += f(r);
  return Math.round(t * 1000) / 1000;
}

export interface ShipmentLike {
  booked_at?: unknown;
  bookedAt?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  delivered_at?: unknown;
  deliveredAt?: unknown;
  [k: string]: unknown;
}

/** median hours from booking to delivery, over the parcels delivered in the window */
export function deliveryHours(shipments: readonly ShipmentLike[] | null | undefined, w: KpiWindow): number | null {
  const hrs: number[] = [];
  for (const s of shipments || []) {
    if (!s) continue;
    const del = s.delivered_at ?? s.deliveredAt;
    const bk = s.booked_at ?? s.bookedAt ?? s.created_at ?? s.createdAt;
    if (!del || !bk) continue;
    if (!inWindow(muscatDay(del), w)) continue;
    const h = (toMs(del) - toMs(bk)) / 3600e3;
    if (Number.isFinite(h) && h >= 0) hrs.push(h);
  }
  if (!hrs.length) return null;
  hrs.sort((a, b) => a - b);
  const m = hrs.length % 2 ? hrs[(hrs.length - 1) / 2]! : (hrs[hrs.length / 2 - 1]! + hrs[hrs.length / 2]!) / 2;
  return Math.round(m * 10) / 10;
}

/** the figures for one window, in one pass */
export function compute(
  list: readonly AnyOrder[] | null | undefined,
  w: KpiWindow = null,
  extra: { sessions?: number | null; spend?: number | null; shipments?: readonly ShipmentLike[] } = {},
): KpiResult {
  const rows = all(list).filter((o) => inWindow(o.day, w));
  const live = rows.filter((o) => isLive(o));
  const settledRows = live.filter((o) => isSettled(o));
  const out: KpiResult = {
    window: w || null,
    total: rows.filter((o) => !o.trashed).length,
    orders: live.length,
    gross: sum(live, (o) => o.omr),
    settled: sum(settledRows, (o) => o.omr),
    expected: sum(live.filter((o) => isExpected(o)), (o) => o.omr),
    net: 0,
    aov: 0,
    cancelled: rows.filter((o) => !o.trashed && o.status === "void").length,
    cancelledPct: 0,
    refunded: rows.filter((o) => !o.trashed && o.refunded).length,
    refundRate: 0,
    delivered: rows.filter((o) => !o.trashed && o.status === "done").length,
    conversion: null,
    sessions: extra.sessions == null ? null : Number(extra.sessions),
    repeatRate: 0,
    customers: 0,
    cpp: null,
    deliveryHrs: null,
  };
  out.net = Math.round((out.settled - sum(settledRows, (o) => o.fee)) * 1000) / 1000;
  out.aov = out.orders ? Math.round((out.gross / out.orders) * 1000) / 1000 : 0;
  out.cancelledPct = out.total ? Math.round((out.cancelled / out.total) * 100) : 0;
  out.refundRate = out.orders + out.refunded ? Math.round((out.refunded / (out.orders + out.refunded)) * 1000) / 1000 : 0;
  if (out.sessions) out.conversion = Math.round((out.orders / out.sessions) * 10000) / 10000;
  const cust: Record<string, number> = {};
  for (const o of live) {
    const k = phoneKey(o.phone) || o.id;
    cust[k] = (cust[k] || 0) + 1;
  }
  const keys = Object.keys(cust);
  out.customers = keys.length;
  out.repeatRate = keys.length ? Math.round((keys.filter((k) => cust[k]! > 1).length / keys.length) * 1000) / 1000 : 0;
  if (extra.spend != null && Number.isFinite(Number(extra.spend))) {
    out.cpp = out.orders ? Math.round((Number(extra.spend) / out.orders) * 1000) / 1000 : null;
  }
  if (extra.shipments) out.deliveryHrs = deliveryHours(extra.shipments, w);
  return out;
}

/** live orders per Muscat day, zero-filled across the window */
export function byDay(list: readonly AnyOrder[] | null | undefined, w: KpiWindow): Record<string, number> {
  const out: Record<string, number> = {};
  if (w) for (let d = w.from; d <= w.to; d = shiftDay(d, 1)) out[d] = 0;
  for (const o of all(list)) if (isLive(o) && inWindow(o.day, w)) out[o.day] = (out[o.day] || 0) + 1;
  return out;
}

/** the change between two figures, as a signed whole percentage */
export function delta(now: number, before: number): number {
  if (!before) return now ? 100 : 0;
  return Math.round(((now - before) / before) * 100);
}

/** what an export's "Settled OMR" column holds: the money that is in */
export function settledOf(o: AnyOrder): number {
  return isSettled(o) ? norm(o)!.omr : 0;
}

/** The Overview's set: all time, the last seven Muscat days, the seven before, the delta, 30 days by day. */
export function overview(list: readonly AnyOrder[] | null | undefined, now: number) {
  const week = window.days(7, now);
  const allTime = compute(list, null);
  const thisWeek = compute(list, week);
  const before = compute(list, window.previous(week));
  return {
    all: allTime,
    week: thisWeek,
    before,
    delta: delta(thisWeek.orders, before.orders),
    byDay: byDay(list, window.days(30, now)),
  };
}
