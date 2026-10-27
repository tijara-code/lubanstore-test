/**
 * Offer windows and free-delivery rules — ONE implementation, imported by the storefront
 * (with its server-corrected clock) and by the till. In the old code these lived twice
 * (store.js and price.js) and suites had to prove the copies agreed; here they cannot drift.
 *
 * Every function takes `now` (ms). The browser passes its server-corrected clock.
 */
import { muscatMidnight } from "../time";
import type { Catalogue, Country, Extra, Offer, Tiers } from "../catalogue/types";

const WEEK = 7 * 86400e3;
const H72 = 72 * 3600e3;
/**
 * The epoch every fixed-length cycle is measured from. Fixed on purpose: a window measured
 * from each visitor's first view would give everyone a private countdown that never ends.
 */
export const WEEK_ANCHOR = Date.parse("2026-01-01T00:00:00+04:00");

type Windowed = Pick<Offer, "hours" | "repeat" | "renew" | "anchor" | "startsAt" | "endsAt" | "until">;

/** The cycle's length in ms (`hours`, or the older `repeat` word), or 0. */
export function cycleMs(o: Windowed | null | undefined): number {
  const h = Number(o && o.hours);
  if (h > 0) return h * 3600e3;
  if (o && o.repeat === "72h") return H72;
  if (o && o.repeat === "weekly") return WEEK;
  return 0;
}

/**
 * The instant cycles are measured from. A date alone is Muscat midnight; a timestamp (what
 * Reset writes) is taken as is. A scheduled start later than the anchor opens the first window.
 */
export function anchorOf(o: Windowed | null | undefined): number {
  const a = String((o && o.anchor) || "").trim();
  let t = a ? Date.parse(a.indexOf("T") > -1 ? a : a + "T00:00:00+04:00") : WEEK_ANCHOR;
  if (!Number.isFinite(t)) t = WEEK_ANCHOR;
  const s = Date.parse(String((o && o.startsAt) || ""));
  return Number.isFinite(s) && s > t ? s : t;
}

/** The last instant of the current window, or null for an offer with no end. */
export function offerEndsAt(o: Windowed | null | undefined, now: number = Date.now()): Date | null {
  if (!o) return null;
  const e = Date.parse(String(o.endsAt || ""));
  const fixed = Number.isFinite(e) ? new Date(e) : o.until ? new Date(o.until + "T23:59:59+04:00") : null;
  let roll: Date;
  const len = cycleMs(o);
  if (o.repeat === "monthly" && !(Number(o.hours) > 0)) {
    const shifted = new Date(now + 4 * 3600e3);
    roll = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) - 4 * 3600e3 - 1);
  } else if (len) {
    const anchor = anchorOf(o);
    if (o.renew === "once") {
      roll = new Date(anchor + len - 1);
    } else {
      // max(1, …): an anchor at or a hair after now (what Reset writes) must not read as expired.
      const n = Math.max(1, Math.floor((now - anchor) / len) + 1);
      roll = new Date(anchor + n * len - 1);
    }
  } else {
    return fixed;
  }
  return fixed && fixed < roll ? fixed : roll;
}

/* ---------------- the three-scent set ("bundle") ---------------- */

export const BUNDLES = ["bundle", "bundle2"] as const;

export function isBundle(id: unknown): boolean {
  return BUNDLES.indexOf(String(id || "") as (typeof BUNDLES)[number]) > -1;
}

/** The set's offer row. "bundle2" (the large set) is retired: always null. */
export function offerOf(cfg: Catalogue | null | undefined, id: string = "bundle"): Offer | null {
  return (String(id || "bundle") === "bundle2" ? null : cfg && cfg.offer) || null;
}

/** Switched on, past its scheduled start, inside its window. */
export function offerLive(cfg: Catalogue | null | undefined, id: string = "bundle", now: number = Date.now()): boolean {
  const o = offerOf(cfg, id);
  if (!o || o.active === false) return false;
  const s = Date.parse(String(o.startsAt || ""));
  if (Number.isFinite(s) && now < s) return false;
  const ends = offerEndsAt(o, now);
  if (ends && ends.getTime() < now) return false;
  return true;
}

/** Offered in this market (an empty list = every market). */
export function offerIn(cfg: Catalogue | null | undefined, countryCode: string | null | undefined, id: string = "bundle"): boolean {
  const o = offerOf(cfg, id);
  const list = o && Array.isArray(o.countries) ? o.countries : [];
  if (!list.length) return true;
  return list.indexOf(String(countryCode || "").toUpperCase()) > -1;
}

/** Which size the set is packed from. */
export function bundleSizeId(cfg: Catalogue | null | undefined, id: string = "bundle"): string {
  const o = offerOf(cfg, id) || {};
  return String(o.sizeId || (String(id || "") === "bundle2" ? "large" : "small"));
}

/** The set's size is sold only inside the set (`offer.only`). */
export function bundleOnly(cfg: Catalogue | null | undefined): boolean {
  const o = offerOf(cfg, "bundle");
  return !!o && o.only === true;
}

/* ---------------- the free-delivery offer (per market, for N days) ---------------- */

/** Last instant of a market's free-delivery run: null = no limit, NaN = not published yet. */
export function freeEndOf(row: { days?: unknown; from?: unknown } | null | undefined): number | null {
  const days = Math.round(Number(row && row.days));
  if (!(days > 0)) return null;
  const from = Date.parse(String((row && row.from) || ""));
  if (!Number.isFinite(from)) return NaN;
  return muscatMidnight(from) + days * 86400e3 - 1;
}

export interface FreeDeal {
  over: number;
  end: number | null;
}

/** The free-delivery offer running in this market now, or null. */
export function freeDealOf(cfg: Catalogue | null | undefined, country: Country | null | undefined, now: number = Date.now()): FreeDeal | null {
  const fs = cfg && cfg.freeShip;
  if (!fs || fs.active === false || !country) return null;
  const row = (fs.countries || {})[String(country.code || "").toUpperCase()];
  if (!row || !row.on) return null;
  const over = Number(row.over);
  if (row.over === "" || row.over == null || !Number.isFinite(over) || over < 0) return null;
  const end = freeEndOf(row);
  if (end !== null && Number.isNaN(end)) return null;
  const from = Date.parse(String(row.from || ""));
  if (Number.isFinite(from) && now < from) return null;
  if (end !== null && now > end) return null;
  return { over, end };
}

/** The threshold in force: the market's own, or an offer's lower one. 0 = no free delivery (unless a 0-offer runs). */
export function freeOverFor(cfg: Catalogue | null | undefined, country: Country | null | undefined, now: number = Date.now()): number {
  const base = Number(country && country.freeOver) || 0;
  const d = freeDealOf(cfg, country, now);
  if (!d) return base;
  return base > 0 ? Math.min(base, d.over) : d.over;
}

/** Last instant of the set's own free-delivery window: null = no end, NaN = not published yet. */
export function setFreeEndsAt(cfg: Catalogue | null | undefined, now: number = Date.now()): number | null {
  const o = offerOf(cfg, "bundle");
  const hours = Number(o && o.freeShipHours) || 0;
  if (!(hours > 0)) return null;
  const a = Date.parse(String((o && o.freeShipAnchor) || ""));
  if (!Number.isFinite(a)) return NaN;
  const len = hours * 3600e3;
  if (o && o.freeShipRenew === "auto" && now >= a) return a + (Math.floor((now - a) / len) + 1) * len - 1;
  return a + len - 1;
}

/** A basket holding the set ships free (the set's own switch, window and markets). */
export function setShipsFree(cfg: Catalogue | null | undefined, country?: Country | null, now: number = Date.now()): boolean {
  const o = offerOf(cfg, "bundle");
  if (!(o && o.freeShip === true) || !offerLive(cfg, "bundle", now)) return false;
  const end = setFreeEndsAt(cfg, now);
  if (end !== null && !(now <= end)) return false;
  if (!country) return true;
  const fl = Array.isArray(o.freeShipIn) ? o.freeShipIn : [];
  const code = String(country.code || "").toUpperCase();
  return offerIn(cfg, code, "bundle") && (!fl.length || fl.indexOf(code) > -1);
}

/** Samples (countsFree: false) are charged but never count toward free delivery. */
export function countsFree(extra: Pick<Extra, "countsFree"> | null | undefined): boolean {
  return !(extra && extra.countsFree === false);
}

/* ---------------- the large-box offers' window (cfg.tiers) ---------------- */

export function tiersOf(cfg: Catalogue | null | undefined): Tiers | null {
  return cfg && cfg.tiers && typeof cfg.tiers === "object" ? cfg.tiers : null;
}

/** A window with a length but no anchor has not started. */
export function tiersUnstarted(t: Tiers | null | undefined): boolean {
  return Number(t && t.hours) > 0 && !String((t && t.anchor) || "").trim();
}

export function tiersEndsAt(cfg: Catalogue | null | undefined, now: number = Date.now()): number | null {
  const t = tiersOf(cfg);
  if (!t || tiersUnstarted(t)) return null;
  const e = offerEndsAt(t, now);
  return e ? e.getTime() : null;
}

/** Switched on, started, not ended. */
export function tiersLive(cfg: Catalogue | null | undefined, now: number = Date.now()): boolean {
  const t = tiersOf(cfg);
  if (!t || t.active === false || tiersUnstarted(t)) return false;
  const s = Date.parse(String(t.startsAt || ""));
  if (Number.isFinite(s) && now < s) return false;
  const a = Date.parse(String(t.anchor || ""));
  if (Number.isFinite(a) && now < a - 60e3) return false;
  const e = tiersEndsAt(cfg, now);
  if (e !== null && now > e) return false;
  return true;
}
