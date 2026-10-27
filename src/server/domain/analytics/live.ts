/**
 * LIVE NOW — the Analytics tab's map (port of the original stats.live): who did something on
 * the site in the last few minutes, where from, and how far along the way to an order each has
 * come. The FURTHEST step wins (a journey is how far someone got, not where they are looking):
 * everything a visitor did in the last three hours counts, so one who added to the basket ten
 * minutes ago and reads the questions now is still "in the cart".
 *
 * No session token leaves: each visitor is a 10-character one-way key (stable across asks, so
 * the map does not flicker). City and a point rounded to ~10 km, from the edge — never an address.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, gte, inArray, isNotNull, max } from "drizzle-orm";
import { ADD_TO_CART } from "../../../shared/pixels/catalogue";
import { muscatMidnight } from "../../../shared/time";
import type { Deps } from "../../core/deps";
import { events } from "../../db/schema";

export const LIVE_STEPS = ["landed", "product", "cart", "checkout", "ordered"] as const;
export const LIVE_STEP_WORD: Record<(typeof LIVE_STEPS)[number], string> = {
  landed: "landed", product: "viewing a box", cart: "in the cart", checkout: "at checkout", ordered: "ordered",
};
const LIVE_STEP_OF: Record<string, number> = {
  page_view: 0, session_start: 0, whatsapp_click: 0, track_lookup: 0,
  size_open: 1,
  add_cart: 2, offer_add: 2, suggest_add: 2, extra_add: 2, cart_open: 2,
  checkout_view: 3, pay_method: 3,
  order_placed: 4,
};
const LIVE_DETAIL: Record<string, string> = {
  page_view: "browsing", session_start: "arrived", whatsapp_click: "opened WhatsApp", track_lookup: "tracked an order",
  size_open: "opened a size", add_cart: "added to cart", offer_add: "added the bundle", suggest_add: "added a suggestion",
  extra_add: "added an add-on", cart_open: "opened the cart", checkout_view: "on checkout", pay_method: "chose payment",
  order_placed: "ordered",
};
/** the panel offers 5 (Live), 30, 60, 180; 15 and 360 still answer; "today" is since Muscat midnight */
export const LIVE_WINDOWS = [5, 15, 30, 60, 180, 360];
export const LIVE_LOOKBACK_H = 3;
export const LIVE_MAX_VISITORS = 300;

export function liveKey(sid: string): string {
  return createHash("sha256").update("lm-live|" + sid).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
}

export interface LiveVisitor {
  k: string;
  step: number;
  stage: (typeof LIVE_STEPS)[number];
  detail: string;
  country: string;
  city: string;
  /** [lng, lat] to a tenth of a degree, or null (pinned to the country) */
  ll: [number, number] | null;
  src: string;
  page: string;
  adds: number;
  first: string;
  last: string;
}

export async function liveVisitors(deps: Deps, o: { minutes?: number | string } = {}) {
  const now = deps.now();
  const today = o.minutes === "today";
  const minutes = today
    ? Math.max(1, Math.ceil((now - muscatMidnight(now)) / 60e3))
    : LIVE_WINDOWS.indexOf(Number(o.minutes)) > -1 ? Number(o.minutes) : 5;
  const since = new Date(now - minutes * 60e3);
  const back = new Date(now - Math.max(LIVE_LOOKBACK_H * 3600e3, minutes * 60e3));

  /* 1. the tabs that did something in the window, newest first */
  const recent = await deps.db
    .select({ sid: events.sid, last: max(events.at) })
    .from(events)
    .where(and(gte(events.at, since), isNotNull(events.sid)))
    .groupBy(events.sid)
    .orderBy(desc(max(events.at)))
    .limit(LIVE_MAX_VISITORS + 1);
  const capped = recent.length > LIVE_MAX_VISITORS;
  const want = recent.slice(0, LIVE_MAX_VISITORS).map((r) => r.sid!).filter(Boolean);

  /* 2. what those tabs did in the look-back */
  const rows = want.length
    ? await deps.db
        .select({ sid: events.sid, at: events.at, name: events.name, item: events.item, country: events.country, city: events.city, lat: events.lat, lng: events.lng })
        .from(events)
        .where(and(inArray(events.sid, want), gte(events.at, back)))
        .orderBy(asc(events.at), asc(events.id))
    : [];

  /* 3. one line per visitor */
  type V = { step: number; detail: string; first: number; last: number; country: string; city: string; lat: number | null; lng: number | null; src: string; page: string; adds: number };
  const by: Record<string, V> = {};
  for (const r of rows) {
    const t = r.at.getTime();
    const sid = r.sid!;
    const v = (by[sid] = by[sid] || { step: -1, detail: "", first: t, last: t, country: "", city: "", lat: null, lng: null, src: "", page: "", adds: 0 });
    if (t < v.first) v.first = t;
    if (t > v.last) v.last = t;
    const st = Object.prototype.hasOwnProperty.call(LIVE_STEP_OF, r.name) ? LIVE_STEP_OF[r.name]! : 0;
    if (st >= v.step) { v.step = st; v.detail = LIVE_DETAIL[r.name] || r.name; }
    if (ADD_TO_CART[r.name]) v.adds++;
    if (r.name === "page_view" && r.item) v.page = String(r.item).slice(0, 20);
    if (r.name === "session_start" && r.item) {
      const p = String(r.item).split("|");
      v.src = [p[0], p[1]].filter(Boolean).join(" / ").slice(0, 60);
    }
    /* the latest place said wins — a phone moving between cells */
    if (r.country) v.country = String(r.country).slice(0, 2);
    if (r.city) v.city = String(r.city).slice(0, 60);
    if (r.lat != null && r.lng != null && Number.isFinite(r.lat) && Number.isFinite(r.lng)) { v.lat = Number(r.lat); v.lng = Number(r.lng); }
  }

  const steps = LIVE_STEPS.map(() => 0);
  const visitors: LiveVisitor[] = want
    .filter((sid) => by[sid] && by[sid]!.last >= since.getTime())
    .map((sid) => {
      const v = by[sid]!;
      const step = Math.max(0, v.step);
      steps[step]!++;
      return {
        k: liveKey(sid), step, stage: LIVE_STEPS[step]!, detail: v.detail || "browsing",
        country: v.country || "", city: v.city || "",
        ll: v.lat != null && v.lng != null ? [Math.round(v.lng * 10) / 10, Math.round(v.lat * 10) / 10] : null,
        src: v.src || "", page: v.page || "", adds: v.adds,
        first: new Date(v.first).toISOString(), last: new Date(v.last).toISOString(),
      };
    });
  visitors.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));

  return {
    ok: true as const, at: new Date(now).toISOString(), minutes, ...(today ? { today: true } : {}), geo: true,
    steps, stepNames: [...LIVE_STEPS], stepWords: LIVE_STEPS.map((s) => LIVE_STEP_WORD[s]), visitors, capped,
  };
}

