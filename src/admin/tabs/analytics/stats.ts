/**
 * THE ANALYTICS TAB'S WORDS AND ARITHMETIC — pure functions over the server's answers
 * (GET /analytics/summary, /analytics/live), ported from the original panel (admin.js
 * ANALYTICS / THE FILTERS / BUSY HOURS / LIVE NOW / SOURCE / MEDIUM). Everything is already
 * aggregated by the server: the panel names, ranks and draws, it never counts events itself.
 */
import type { BusyGrid, LiveVisitor, StatsFilter, StatsSummary, SummaryAsk } from "../../data/insights";

/* ---------------- the range and the filters (kept in the address) ---------------- */

export type RangeWord = "today" | "7" | "30" | "90" | "all";
export const RANGES: Array<{ value: RangeWord; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All" },
];

export interface StatsView {
  /** a button, or "" while a custom range (from/to) is picked: the two release each other (v211) */
  range: RangeWord | "";
  from: string;
  to: string;
  filter: StatsFilter;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const PLATFORMS: Array<{ value: string; label: string }> = [
  { value: "", label: "All platforms" },
  { value: "meta", label: "Meta (Facebook, Instagram)" },
  { value: "snapchat", label: "Snapchat" },
  { value: "tiktok", label: "TikTok" },
  { value: "google", label: "Google" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "direct", label: "Direct" },
  { value: "other", label: "Other sites" },
];
export const PAID: Array<{ value: string; label: string }> = [
  { value: "", label: "Ads and unpaid" },
  { value: "paid", label: "Ads only" },
  { value: "unpaid", label: "Unpaid only" },
];

export function statsViewOf(p: Record<string, string>): StatsView {
  const from = DAY.test(p.from || "") ? p.from! : "";
  const to = DAY.test(p.to || "") ? p.to! : "";
  const custom = !!(from && to);
  const range = custom ? "" : RANGES.some((r) => r.value === p.range) ? (p.range as RangeWord) : "7";
  return {
    range,
    from: custom ? (from < to ? from : to) : "",
    to: custom ? (from < to ? to : from) : "",
    filter: {
      country: /^[A-Z]{2}$/.test(p.country || "") ? p.country! : "",
      platform: PLATFORMS.some((x) => x.value && x.value === p.platform) ? p.platform! : "",
      paid: p.paid === "paid" || p.paid === "unpaid" ? p.paid : "",
    },
  };
}

export function statsParamsOf(v: StatsView): Record<string, string | undefined> {
  return {
    range: v.range && v.range !== "7" ? v.range : undefined,
    from: v.range ? undefined : v.from || undefined,
    to: v.range ? undefined : v.to || undefined,
    country: v.filter.country || undefined,
    platform: v.filter.platform || undefined,
    paid: v.filter.paid || undefined,
  };
}

/** The request for a view: the range (or the custom days) and the filters riding with it (v408). */
export function askOf(v: StatsView): SummaryAsk {
  const a: SummaryAsk = v.range ? { range: v.range } : { from: v.from, to: v.to };
  if (v.filter.country) a.country = v.filter.country;
  if (v.filter.platform) a.platform = v.filter.platform;
  if (v.filter.paid) a.paid = v.filter.paid;
  return a;
}

/** "|OM,meta," when anything is filtered, else "" (the original's filterKey: part of the cache key) */
export function filterKey(f: Partial<StatsFilter> | null | undefined): string {
  const x = f || {};
  return x.country || x.platform || x.paid ? "|" + [x.country || "", x.platform || "", x.paid || ""].join(",") : "";
}

/** The cache key of a view: one range on screen, the last one asked for. */
export function viewKey(v: StatsView): string {
  return (v.range ? v.range : v.from + ".." + v.to) + filterKey(v.filter);
}

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const niceDay = (d: string, year: boolean) => (d ? +d.slice(8, 10) + " " + MON3[+d.slice(5, 7) - 1] + (year ? " " + d.slice(0, 4) : "") : "");

/** The name of what was asked for, before its answer is in (the stamp while loading). */
export function rangeName(v: Pick<StatsView, "range" | "from" | "to">): string {
  if (!v.range && v.from && v.to) return v.from === v.to ? niceDay(v.from, true) : niceDay(v.from, v.from.slice(0, 4) !== v.to.slice(0, 4)) + " – " + niceDay(v.to, true);
  if (v.range === "all") return "All time";
  if (v.range === "today") return "Today";
  return "Last " + (v.range || "7") + " days";
}

/**
 * The date caption — named from the PAYLOAD, the range these figures ARE for, not the button
 * pressed since (v209): "Last 7 days · 2026-10-21 → 2026-10-27 · filtered".
 */
export function stampOf(d: Pick<StatsSummary, "custom" | "all" | "days" | "span" | "from" | "to" | "daily" | "filter">): string {
  const first = d.from || (d.daily && d.daily.length ? d.daily[0]!.day : "");
  const last = d.to || (d.daily && d.daily.length ? d.daily[d.daily.length - 1]!.day : "");
  const dd = d.all ? 0 : +d.days;
  const name = d.custom
    ? "Custom" + (d.span ? " · " + d.span + " day" + (d.span === 1 ? "" : "s") : "")
    : dd === 0
      ? "All time" + (d.span ? " · " + d.span + " days" : "")
      : dd === 1
        ? "Today"
        : "Last " + dd + " days";
  return name + (first ? " · " + (first === last ? first : first + " → " + last) : "") + (filterKey(d.filter) ? " · filtered" : "");
}

/* ---------------- the figures ---------------- */

export const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

export interface StatsKpis {
  visits: number;
  sessions: number;
  carts: number;
  orders: number;
  /** "14%" or "—" without sessions */
  conversion: string;
}

/**
 * THE ORDERS FIGURE IS THE LEDGER'S, not the pixel's (an order typed in or from a shopper who
 * blocks the collector fires no event); the tracked one only when the orders could not be read.
 * CONVERSION DIVIDES THE SAME DAYS: the orders placed while visits were recorded, per session.
 */
export function kpisOf(d: Pick<StatsSummary, "uniqueByEvent" | "orders" | "sessions">): StatsKpis {
  const u = d.uniqueByEvent || {};
  const ord = d.orders || ({} as StatsSummary["orders"]);
  const tracked = u.order_placed || 0;
  const orders = ord.total == null ? tracked : ord.total;
  const sess = d.sessions || 0;
  const wv = ord.withVisits;
  const conv = ord.total != null && wv && wv.from ? wv.total : orders;
  return { visits: u.page_view || 0, sessions: sess, carts: u.add_cart || 0, orders, conversion: sess ? pct(conv, sess) + "%" : "—" };
}

/** What the figures do not cover, said rather than left for a flat line to imply. */
export function notesOf(d: Pick<StatsSummary, "capped" | "coveredFrom" | "orders" | "from">): string[] {
  const out: string[] = [];
  const ord = d.orders || ({} as StatsSummary["orders"]);
  if (d.capped) out.push("Latest events only, from " + (d.coveredFrom || "the most recent days") + ".");
  if (ord.capped) out.push("The Orders figure is capped for this range.");
  if (ord.error) out.push("Orders could not be read, so that figure is the tracked one.");
  const wv = ord.withVisits;
  if (wv && wv.from && d.from && wv.from > d.from && ord.total != null && wv.total !== ord.total) {
    out.push("Visits are kept for 90 days, so this range's first recorded visit is " + wv.from + ". Conversion uses the " + wv.total + " orders from that day on, not all " + ord.total + ".");
  }
  return out;
}

export const EV_LABEL: Record<string, string> = {
  page_view: "Page views", size_open: "Size opened", add_cart: "Add to cart (single)", cart_open: "Cart opened",
  checkout_view: "Checkout viewed", pay_method: "Payment method chosen", order_placed: "Order placed",
  whatsapp_click: "WhatsApp clicked", track_lookup: "Order tracked", offer_add: "Add to cart (bundle)",
  suggest_add: "Add to cart (checkout suggestion)", extra_add: "Add to cart (checkout add-on)", session_start: "Sessions started",
};
/** the items rank is keyed on the item id, and "bundle" is not a scent */
export const ITEM_LABEL: Record<string, string> = {
  bundle: "Bundle · 3 scents", bundle2: "Large bundle · 3 scents", duo: "2 large boxes (offer)", trio: "3 large boxes · 2 + 1 (offer)",
};

export interface RankRow {
  key: string;
  n: number;
}
/** All events, biggest first. */
export function eventRows(events: Record<string, number> | null | undefined): RankRow[] {
  const e = events || {};
  return Object.keys(e)
    .map((k) => ({ key: k, n: e[k]! }))
    .sort((a, b) => b.n - a.n);
}
/** "Visits by country": the top six (v333). */
export const topCountries = (d: Pick<StatsSummary, "countries">) => (d.countries || []).slice(0, 6);

/** The daily series, in the Sessions KPI's unit (so the chart and the tile agree), MM-DD labels. */
export function dailyRows(d: Pick<StatsSummary, "daily">): Array<{ label: string; n: number }> {
  return (d.daily || []).map((x) => ({ label: String(x.day || "").slice(5), n: x.sessions != null ? x.sessions : x.views || 0 }));
}

/* ---------------- source / medium ---------------- */

export const SM_NOTE: Record<string, string> = {
  "(direct) / (none)": "typed in, a bookmark, or an app that hides where it came from",
  "(not set) / (not set)": "before tracking, or no landing on record",
  "whatsapp / chat": "typed in from a WhatsApp chat in the panel",
};
export const rateWord = (r: number | null) => (r == null ? "—" : r.toFixed(r < 10 ? 2 : 1) + "%");

/* ---------------- busy hours (v408) ---------------- */

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Muscat's weekday and hour now (UTC+4, no daylight saving). */
export function muscatClock(now: number): { dow: number; hour: number } {
  const d = new Date(now + 4 * 3600e3);
  return { dow: d.getUTCDay(), hour: d.getUTCHours() };
}
export function hourWord(h: number): string {
  const x = h % 12 === 0 ? 12 : h % 12;
  return x + (h < 12 ? " am" : " pm");
}
export const busyNum = (v: number) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

/** A typical day of the weekday (−1 = every day): each hour's total over how many of that weekday the range has. */
export function busyValues(b: BusyGrid | null | undefined, what: "visits" | "orders", day: number): { vals: number[]; days: number } {
  const grid = (b && b[what]) || [];
  const wk = (b && b.weekdays) || [];
  const n = day < 0 ? wk.reduce((t, x) => t + (+x || 0), 0) : +(wk[day] || 0);
  const vals: number[] = [];
  for (let h = 0; h < 24; h++) {
    let t = 0;
    if (day < 0) for (let i = 0; i < 7; i++) t += (grid[i] && +grid[i]![h]!) || 0;
    else t = (grid[day] && +grid[day]![h]!) || 0;
    vals.push(n ? t / n : 0);
  }
  return { vals, days: n };
}

/** The line under the bars: the busiest hour, and how many had nobody (or the quietest). */
export function busyNote(vals: number[], days: number, day: number, unit: string): { peak: number; text: string; strong: string[] } {
  const max = Math.max(...vals);
  if (!(max > 0)) {
    return {
      peak: -1,
      strong: [],
      text: days ? "No " + unit + " on " + (day < 0 ? "any day" : DOW_LONG[day] + "s") + " in this range." : "This range has no " + (day < 0 ? "days" : DOW_LONG[day]) + ".",
    };
  }
  const peak = vals.indexOf(max);
  let lo = -1;
  vals.forEach((x, h) => {
    if (x > 0 && (lo < 0 || x < vals[lo]!)) lo = h;
  });
  const empty = vals.filter((x) => x === 0).length;
  const span = (h: number) => hourWord(h) + "–" + hourWord((h + 1) % 24);
  return {
    peak,
    strong: [span(peak), lo > -1 ? span(lo) : ""],
    text:
      "Busiest: " + span(peak) + " (about " + busyNum(max) + " " + unit + "). " +
      (empty ? empty + " hour" + (empty === 1 ? "" : "s") + " with none." : lo > -1 ? "Quietest: " + span(lo) + "." : ""),
  };
}

/* ---------------- live now (v338, v446) ---------------- */

/** v446: the last hour (the default), three, six, and today (since Muscat's midnight) */
export const LIVE_WINDOWS: Array<{ value: string; label: string; title: string }> = [
  { value: "60", label: "1h", title: "Active in the last hour" },
  { value: "180", label: "3h", title: "Active in the last 3 hours" },
  { value: "360", label: "6h", title: "Active in the last 6 hours" },
  { value: "today", label: "Today", title: "Active since midnight, Muscat time" },
];
export const LIVE_EVERY = 15000;
export const LIVE_STEPS: Array<[string, string]> = [
  ["Landed", "on the site"],
  ["Viewing a box", "opened a size"],
  ["In the cart", "added a box"],
  ["At checkout", "form or payment"],
  ["Ordered", "placed an order"],
];
/** one blue, light to dark: a further step is a darker pin (an ordinal ramp) */
export const LIVE_COLOR = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
/** [x, y, w, h] in the outline file's units (10 a degree, x from 180°W, y from 90°N) */
export const LIVE_VIEWS: Record<"gulf" | "world", [number, number, number, number]> = { gulf: [2105, 555, 384, 240], world: [0, 120, 3600, 1500] };

export interface MapCountry {
  /** ISO code */
  a: string;
  /** path data, in the file's units */
  d: string;
  /** [lng, lat] of its middle */
  ll: [number, number];
}

export const liveProject = (lng: number, lat: number): [number, number] => [(lng + 180) * 10, (90 - lat) * 10];

export function liveAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  return m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
}
/** 60 → "hour", 180 → "3 hours" */
export function liveSpan(m: number): string {
  const n = Number(m) || 0;
  if (n >= 60 && n % 60 === 0) return n === 60 ? "hour" : n / 60 + " hours";
  return n + " minutes";
}

let regionNames: Intl.DisplayNames | null | undefined;
export function regionName(code: string): string {
  if (!code) return "Unknown";
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return (regionNames && regionNames.of(code)) || code;
  } catch {
    return code;
  }
}

export interface LivePlace {
  key: string;
  ll: [number, number];
  name: string;
  country: boolean;
}
/** A visitor's place: their city's point, or their country's middle (no city known). */
export function livePlace(v: Pick<LiveVisitor, "ll" | "city" | "country">, map: readonly MapCountry[]): LivePlace | null {
  if (v.ll && Number.isFinite(v.ll[0]) && Number.isFinite(v.ll[1])) {
    return { key: v.ll.join(","), ll: v.ll, name: (v.city ? v.city + ", " : "") + regionName(v.country), country: false };
  }
  const c = map.find((x) => x.a && x.a === v.country);
  if (!c) return null;
  return { key: "c:" + v.country, ll: c.ll, name: regionName(v.country), country: true };
}

export interface PinGroup extends LivePlace {
  n: number;
  steps: number[];
  /** the furthest step any of them has reached */
  best: number;
  /** someone there did something in the last minute */
  fresh: boolean;
}
/** One pin per place: the size its visitors, the colour the furthest step; the busiest drawn last (on top). */
export function pinGroups(visitors: readonly LiveVisitor[], map: readonly MapCountry[], now: number): { groups: PinGroup[]; unplaced: number } {
  const by: Record<string, PinGroup> = {};
  const order: PinGroup[] = [];
  let placed = 0;
  for (const v of visitors) {
    const p = livePlace(v, map);
    if (!p) continue;
    placed++;
    let g = by[p.key];
    if (!g) {
      g = by[p.key] = { ...p, n: 0, steps: [0, 0, 0, 0, 0], best: 0, fresh: false };
      order.push(g);
    }
    g.n++;
    g.steps[v.step] = (g.steps[v.step] || 0) + 1;
    if (v.step > g.best) g.best = v.step;
    if (now - Date.parse(v.last) < 60e3) g.fresh = true;
  }
  order.sort((a, b) => a.n - b.n || a.best - b.best);
  return { groups: order, unplaced: visitors.length - placed };
}

/** Where a pin sits in the view (percent), or null outside it. */
export function pinXY(ll: [number, number], view: [number, number, number, number]): { x: number; y: number } | null {
  const [px, py] = liveProject(ll[0], ll[1]);
  const x = ((px - view[0]) / view[2]) * 100;
  const y = ((py - view[1]) / view[3]) * 100;
  return x < 0 || x > 100 || y < 0 || y > 100 ? null : { x, y };
}
export const pinSize = (n: number) => Math.min(44, Math.round(14 + 6 * Math.sqrt(n - 1)));

/** A visitor's line: the step, the finer word unless it only repeats the step, how many added. */
export function liveLine(v: Pick<LiveVisitor, "step" | "detail" | "adds">): string {
  const step = LIVE_STEPS[v.step] ? LIVE_STEPS[v.step]![0] : LIVE_STEPS[0]![0];
  const bits = v.detail && v.detail.toLowerCase() !== step.toLowerCase() ? [v.detail] : [];
  if (v.adds > 1) bits.push(v.adds + " added");
  return [step, ...bits].join(" · ");
}

/* ---------------- numbered reads (v209) ---------------- */

/**
 * ONE RANGE ON SCREEN: THE LAST ONE ASKED FOR. Every read takes a number; an answer is drawn only
 * if it is for the view on screen and no newer read of it has been drawn — a slow "All" landing
 * after a quick "7 days" never puts its figures under the button pressed since.
 */
export function createSeq() {
  let n = 0;
  let drawn = 0;
  return {
    /** a new read's number */
    next: () => ++n,
    /** the newest number handed out */
    get newest() {
      return n;
    },
    /** may an answer numbered `my` be drawn? (and mark it drawn) */
    accept(my: number): boolean {
      if (my < drawn) return false;
      drawn = my;
      return true;
    },
  };
}
