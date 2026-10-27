/**
 * THE ANALYTICS TAB — every figure aggregated HERE, not in the browser (port of the original
 * stats.summary). The browser gets counts, never a visitor's session token.
 *
 * WINDOWS are Muscat calendar days: Today is from local midnight, "7 days" is today and the six
 * before, so the KPIs, the funnel, the ranks and the chart describe the same days. A custom range
 * is two Muscat days (inclusive; put in order; a `to` past today ends today). "All" starts at
 * the first thing on record — the earliest event, kept hour (event_hours) or order — never an
 * arbitrary 90 days, so a reset of the events cannot shrink the orders.
 *
 * THE FILTERS narrow every figure at once: a market, a platform, ads or not. A session's platform
 * and paid-ness come from its session_start (the landing, placed by the UTM standard); an
 * order's from its attribution, or — for an order with none — its origin word (no paid/unpaid
 * there: an origin cannot tell an ad from a post). A session whose start is outside the window
 * drops out while a platform is asked for.
 *
 * ORDERS COME FROM THE ORDERS TABLE (the ledger), counted live as the Overview counts them
 * (shared/kpi isLive) — the browser's order_placed event never fires for an order typed in or a
 * shopper who blocks the collector; it is still returned (events.order_placed) beside it.
 */
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { PLATFORMS, paidOf, platformOf, type Platform } from "../../../shared/attribution";
import { compute, isLive, type KpiResult } from "../../../shared/kpi";
import { r3 } from "../../../shared/money";
import { ADD_TO_CART } from "../../../shared/pixels/catalogue";
import { DAY_MS, GULF_MS, dayStart, muscatDay, muscatMidnight } from "../../../shared/time";
import type { Attribution } from "../../../shared/orders/types";
import type { Deps } from "../../core/deps";
import { orders } from "../../db/schema";
import { firstOnRecord, rollup, type RolledRow } from "./rollup";

export interface StatsFilter {
  country: string;
  platform: Platform | "";
  paid: "paid" | "unpaid" | "";
}

export interface SummaryOptions {
  /** today | 7 | 30 | 90 | all (or a number of days, 1–90; 0 = all) */
  range?: string | number;
  /** the original's word for range */
  days?: string | number;
  /** a custom window: Muscat days, inclusive */
  from?: string;
  to?: string;
  country?: string;
  platform?: string;
  /** "paid" (ads only) | "unpaid" */
  paid?: string;
  adsOnly?: boolean;
  unpaidOnly?: boolean;
}

export interface BusyGrid {
  /** [weekday 0=Sun][hour 0–23] sessions active in that hour (Muscat) */
  visits: number[][];
  /** [weekday][hour] live orders placed */
  orders: number[][];
  /** how many of each weekday the window holds */
  weekdays: number[];
}

export interface SmRow {
  key: string;
  source: string;
  medium: string;
  campaign?: string;
  sessions: number;
  n: number;
  live: number;
  omr: number;
  rate: number | null;
}

const isDay = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && Number.isFinite(dayStart(String(v)));

export function filterOf(o: SummaryOptions): StatsFilter {
  const cc = String(o.country || "").toUpperCase();
  const pf = String(o.platform || "").toLowerCase().trim();
  let pd = String(o.paid || "").toLowerCase();
  if (o.adsOnly === true) pd = "paid";
  else if (o.unpaidOnly === true) pd = "unpaid";
  return {
    country: /^[A-Z]{2}$/.test(cc) ? cc : "",
    platform: (PLATFORMS as readonly string[]).indexOf(pf) > -1 ? (pf as Platform) : "",
    paid: pd === "paid" || pd === "unpaid" ? pd : "",
  };
}

function grid(): number[][] {
  return [0, 1, 2, 3, 4, 5, 6].map(() => new Array<number>(24).fill(0));
}

function slotOf(t: number): { dow: number; hour: number } | null {
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + GULF_MS);
  return { dow: d.getUTCDay(), hour: d.getUTCHours() };
}

interface OrderLite {
  id: string;
  createdAt: Date;
  countryCode: string;
  origin: string | null;
  attribution: Attribution | null;
  status: string;
  omr: number;
  paymentStatus: string;
  pay: string;
  refunded: boolean;
  trashed: boolean;
}

/** The window a request names: { since, until (exclusive, custom only), span, days, all, custom, endGulf }. */
export function windowOf(o: SummaryOptions, now: number) {
  const todayGulf = muscatMidnight(now);
  const custom = isDay(o.from) && isDay(o.to);
  const raw = o.range !== undefined ? o.range : o.days;
  const word = String(raw ?? "").toLowerCase();
  const wantAll = !custom && (word === "0" || word === "all");
  let days = wantAll || custom ? 0 : word === "today" ? 1 : Math.max(1, Math.min(90, parseInt(word, 10) || 7));
  let span = days;
  let endGulf = todayGulf;
  let until: number | null = null;
  if (custom) {
    let a = dayStart(String(o.from)), b = dayStart(String(o.to));
    if (a > b) { const t = a; a = b; b = t; }
    if (b > todayGulf) b = todayGulf;
    if (a > b) a = b;
    endGulf = b;
    span = Math.max(1, Math.min(1100, Math.round((b - a) / DAY_MS) + 1));
    days = span;
    until = b + DAY_MS;
  }
  return { todayGulf, custom, wantAll, days, span, endGulf, until };
}

export async function statsSummary(deps: Deps, o: SummaryOptions = {}) {
  const now = deps.now();
  const w = windowOf(o, now);
  let { span } = w;
  const { custom, wantAll, endGulf, until, todayGulf } = w;
  if (wantAll) {
    const first = await firstOnRecord(deps.db).catch(() => NaN);
    const from = Number.isFinite(first) ? muscatMidnight(first) : todayGulf;
    span = Math.max(1, Math.min(1100, Math.round((todayGulf - from) / DAY_MS) + 1));
  }
  const days = wantAll ? 0 : w.days;
  const since = endGulf - (span - 1) * DAY_MS;
  const F = filterOf(o);
  const filtering = !!(F.country || F.platform || F.paid);

  /* the orders of the same window, read alongside the events */
  const ordersRead = (async () => {
    const cond = [gte(orders.createdAt, new Date(since)), eq(orders.trashed, false)];
    if (until != null) cond.push(lt(orders.createdAt, new Date(until)));
    const rows = await deps.db
      .select({
        id: orders.id, createdAt: orders.createdAt, countryCode: orders.countryCode, origin: orders.origin,
        attribution: orders.attribution, status: orders.status, omr: orders.omr, paymentStatus: orders.paymentStatus,
        pay: orders.pay, refunded: orders.refunded, trashed: orders.trashed,
      })
      .from(orders)
      .where(and(...cond))
      .orderBy(asc(orders.createdAt));
    return { rows: rows as OrderLite[] };
  })().catch((error: unknown) => ({ error }));

  let rows: RolledRow[] = await rollup(deps.db, new Date(since), until != null ? new Date(until) : null);

  if (filtering) {
    const land: Record<string, { platform: string; paid: boolean }> = {};
    for (const r of rows) {
      if (r.name !== "session_start" || !r.sid || !r.item) continue;
      const p = r.item.split("|");
      land[r.sid] = { platform: platformOf(p[0]), paid: paidOf(p[1]) };
    }
    rows = rows.filter((r) => {
      if (F.country && r.country.toUpperCase() !== F.country) return false;
      if (F.platform || F.paid) {
        const l = r.sid ? land[r.sid] : null;
        if (!l) return false;
        if (F.platform && l.platform !== F.platform) return false;
        if (F.paid && l.paid !== (F.paid === "paid")) return false;
      }
      return true;
    });
  }

  const busy: BusyGrid = { visits: grid(), orders: grid(), weekdays: [0, 0, 0, 0, 0, 0, 0] };
  const busySeen = new Set<string>();
  const byName: Record<string, number> = {};
  const byItem: Record<string, number> = {};
  const byCountry: Record<string, Set<string>> = {};
  const byDay: Record<string, { day: string; events: number; views: number; sids: Set<string> }> = {};
  const sids: Record<string, Set<string>> = {};
  const sessions = new Set<string>();
  let seq = 0;
  /* an event with no session still represents one visitor we cannot group: a key of its own */
  const anon = () => "e" + ++seq;

  type Acc = { key: string; source: string; medium: string; campaign?: string; sids: Set<string>; n: number; live: number; omr: number };
  const SM: Record<string, Acc> = {};
  const CM: Record<string, Acc> = {};
  let smFirst: number | null = null;
  const smOf = (src?: string, med?: string): Acc => {
    const s = src || "(not set)", m = med || "(not set)", k = s + " / " + m;
    return (SM[k] = SM[k] || { key: k, source: s, medium: m, sids: new Set(), n: 0, live: 0, omr: 0 });
  };
  const cmOf = (src: string | undefined, med: string | undefined, camp: string): Acc => {
    const s = src || "(not set)", m = med || "(not set)", k = s + " / " + m + " / " + camp;
    return (CM[k] = CM[k] || { key: k, source: s, medium: m, campaign: camp, sids: new Set(), n: 0, live: 0, omr: 0 });
  };

  /* every day of the range, zero or not */
  for (let i = span - 1; i >= 0; i--) {
    const d = muscatDay(endGulf + 3600e3 - i * DAY_MS);
    byDay[d] = { day: d, events: 0, views: 0, sids: new Set() };
  }

  let total = 0;
  let oldest = Infinity;
  for (const r of rows) {
    const t = r.hh * 3600e3;
    const n = r.n;
    if (t < oldest) oldest = t;
    total += n;
    byName[r.name] = (byName[r.name] || 0) + n;
    const day = muscatDay(t);
    const sl = slotOf(t);
    if (sl) {
      if (r.sid) {
        const bk = r.sid + "|" + day + "|" + sl.hour;
        if (!busySeen.has(bk)) { busySeen.add(bk); busy.visits[sl.dow]![sl.hour]!++; }
      } else busy.visits[sl.dow]![sl.hour]! += n;
    }
    if (r.country) {
      const set = (byCountry[r.country] = byCountry[r.country] || new Set());
      if (r.sid) set.add(r.sid); else for (let i = 0; i < n; i++) set.add(anon());
    }
    const b = byDay[day];
    if (b) {
      b.events += n;
      if (r.name === "page_view") b.views += n;
      if (r.sid) b.sids.add(r.sid);
    }
    if (r.sid) {
      sessions.add(r.sid);
      (sids[r.name] = sids[r.name] || new Set()).add(r.sid);
      if (ADD_TO_CART[r.name]) (sids.add_cart = sids.add_cart || new Set()).add(r.sid);
    }
    if (ADD_TO_CART[r.name] && r.item) byItem[r.item] = (byItem[r.item] || 0) + n;
    if (r.name === "session_start" && r.item) {
      const p = r.item.split("|");
      const whos = r.sid ? [r.sid] : Array.from({ length: n }, anon);
      for (const who of whos) {
        smOf(p[0], p[1]).sids.add(who);
        if (p[2]) cmOf(p[0], p[1], p[2]).sids.add(who);
      }
      if (smFirst == null || t < smFirst) smFirst = t;
    }
  }

  const uniqueByEvent: Record<string, number> = {};
  for (const k of Object.keys(sids)) uniqueByEvent[k] = sids[k]!.size;

  const top = (obj: Record<string, number | Set<string>>, n: number) =>
    Object.keys(obj)
      .map((k) => { const v = obj[k]!; return { key: k, n: v instanceof Set ? v.size : v }; })
      .sort((a, b) => b.n - a.n)
      .slice(0, n);

  /* ---- the orders ---- */
  let ordered: {
    total: number | null;
    byDay: Record<string, number>;
    withVisits?: { from: string | null; total: number };
    capped?: boolean;
    origins?: Array<{ key: string; n: number; live: number; omr: number }>;
    error?: string;
  };
  let ords: OrderLite[] = [];
  const got = await ordersRead;
  if ("error" in got) {
    ordered = { total: null, byDay: {}, error: "orders_unavailable" };
  } else {
    ords = !filtering ? got.rows : got.rows.filter((x) => {
      if (F.country && String(x.countryCode || "").toUpperCase() !== F.country) return false;
      const at = x.attribution && typeof x.attribution === "object" ? x.attribution : null;
      if (F.platform && platformOf(at && at.source ? at.source : x.origin) !== F.platform) return false;
      if (F.paid && (!at || paidOf(at.medium) !== (F.paid === "paid"))) return false;
      return true;
    });
    const perDay: Record<string, number> = {};
    const byOrigin: Record<string, { n: number; live: number; omr: number }> = {};
    for (const x of ords) {
      const live = isLive(x as unknown as Record<string, unknown>);
      const t = x.createdAt.getTime();
      const d = muscatDay(t);
      if (live) {
        perDay[d] = (perDay[d] || 0) + 1;
        const os = slotOf(t);
        if (os) busy.orders[os.dow]![os.hour]!++;
      }
      const k = x.origin || "unknown";
      const bo = (byOrigin[k] = byOrigin[k] || { n: 0, live: 0, omr: 0 });
      bo.n++;
      if (live) { bo.live++; bo.omr += Number(x.omr) || 0; }
      const at = x.attribution && typeof x.attribution === "object" ? x.attribution : null;
      const hit = [smOf(at?.source, at?.medium)];
      if (at && at.campaign) hit.push(cmOf(at.source, at.medium, at.campaign));
      for (const h of hit) { h.n++; if (live) { h.live++; h.omr += Number(x.omr) || 0; } }
    }
    /* conversion needs both halves over the same days: the orders from the first day with visits */
    const firstVisit = Number.isFinite(oldest) ? muscatDay(oldest) : null;
    const overlap = firstVisit ? ords.filter((x) => isLive(x as unknown as Record<string, unknown>) && muscatDay(x.createdAt.getTime()) >= firstVisit).length : 0;
    ordered = {
      total: ords.filter((x) => isLive(x as unknown as Record<string, unknown>)).length,
      byDay: perDay,
      withVisits: { from: firstVisit, total: overlap },
      capped: false,
      origins: Object.keys(byOrigin)
        .map((k) => ({ key: k, n: byOrigin[k]!.n, live: byOrigin[k]!.live, omr: r3(byOrigin[k]!.omr) }))
        .sort((a, b) => b.n - a.n),
    };
  }

  /* ---- the series: weekly past a quarter, a week's sessions the UNION of its days ---- */
  const dayKeys = Object.keys(byDay).sort();
  const grain: "day" | "week" = dayKeys.length > 92 ? "week" : "day";
  const step = grain === "week" ? 7 : 1;
  const daily: Array<{ day: string; events: number; views: number; sessions: number; orders: number }> = [];
  for (let i = dayKeys.length; i > 0; i -= step) {
    const chunk = dayKeys.slice(Math.max(0, i - step), i);
    const union = new Set<string>();
    let ev = 0, vw = 0, ord = 0;
    for (const d of chunk) {
      ev += byDay[d]!.events; vw += byDay[d]!.views;
      ord += ordered.byDay[d] || 0;
      byDay[d]!.sids.forEach((s) => union.add(s));
    }
    daily.unshift({ day: chunk[0]!, events: ev, views: vw, sessions: union.size, orders: ord });
  }
  for (const d of dayKeys) busy.weekdays[new Date(d + "T12:00:00Z").getUTCDay()]!++;

  const smRows = (obj: Record<string, Acc>): SmRow[] =>
    Object.keys(obj)
      .map((k) => {
        const x = obj[k]!, ss = x.sids.size;
        const r: SmRow = { key: x.key, source: x.source, medium: x.medium, sessions: ss, n: x.n, live: x.live, omr: r3(x.omr),
          rate: ss ? Math.round((x.live / ss) * 10000) / 100 : null };
        if (x.campaign) r.campaign = x.campaign;
        return r;
      })
      .sort((a, b) => b.live - a.live || b.sessions - a.sessions);

  const from = dayKeys[0] || null;
  const to = dayKeys[dayKeys.length - 1] || null;
  const kpi: KpiResult = compute(ords as unknown as Array<Record<string, unknown>>, from && to ? { from, to } : null, { sessions: sessions.size });
  const countries = top(byCountry, 30);
  const funnel = [
    { step: "visits", sessions: sessions.size },
    { step: "viewed a box", sessions: uniqueByEvent.size_open || 0 },
    { step: "added to cart", sessions: uniqueByEvent.add_cart || 0 },
    { step: "at checkout", sessions: uniqueByEvent.checkout_view || 0 },
    { step: "ordered", sessions: uniqueByEvent.order_placed || 0 },
  ];

  return {
    ok: true as const,
    days, all: wantAll, custom, span,
    since: new Date(since).toISOString(),
    until: until != null ? new Date(until).toISOString() : null,
    sourceMedium: { rows: smRows(SM), campaigns: smRows(CM).slice(0, 60), sessionsFrom: smFirst != null ? muscatDay(smFirst) : null },
    filter: F, platforms: PLATFORMS, busy,
    from, to,
    total,
    capped: false, coveredFrom: null,
    sessions: sessions.size,
    events: byName,
    uniqueByEvent,
    /** sessions that put anything in the basket (all four add events folded in) */
    addedToCart: uniqueByEvent.add_cart || 0,
    funnel,
    orders: ordered,
    kpi,
    items: top(byItem, 30),
    countries,
    /** the Analytics card's "visits by country": the six biggest */
    countriesTop: countries.slice(0, 6),
    grain,
    daily,
  };
}

export type StatsSummary = Awaited<ReturnType<typeof statsSummary>>;

/** The typical day for one weekday (0 = Sunday) or every day (-1), hour by hour: the count over how many of that weekday. */
export function busyValues(busy: BusyGrid, metric: "visits" | "orders", day: number): number[] {
  const g = busy[metric] || [];
  const wk = busy.weekdays || [];
  const n = day < 0 ? wk.reduce((t, x) => t + (+x || 0), 0) : +(wk[day] || 0);
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    let t = 0;
    if (day < 0) for (let i = 0; i < 7; i++) t += (g[i] && +g[i]![h]!) || 0;
    else t = (g[day] && +g[day]![h]!) || 0;
    out.push(n ? t / n : 0);
  }
  return out;
}

/** BUSY HOURS (Google Maps' "Popular times"): a typical day in Muscat time over the window asked. */
export async function busyHours(deps: Deps, o: SummaryOptions & { weekday?: number | "every"; metric?: "visits" | "orders" } = {}) {
  const s = await statsSummary(deps, o);
  const metric = o.metric === "orders" ? "orders" : "visits";
  const nowSlot = slotOf(deps.now())!;
  const day = o.weekday === "every" ? -1 : Number.isInteger(o.weekday) && Number(o.weekday) >= 0 && Number(o.weekday) <= 6 ? Number(o.weekday) : nowSlot.dow;
  return { ok: true as const, metric, weekday: day < 0 ? ("every" as const) : day, hours: busyValues(s.busy, metric, day), busy: s.busy, now: nowSlot, from: s.from, to: s.to };
}
