/**
 * The clock, the offers' windows, the large-box offers and delivery. The window
 * arithmetic is the till's own (src/shared/pricing/offers.ts, tiers.ts), called with the
 * server-corrected clock, so the page and the till cannot disagree about when an offer
 * ends. What the page adds on top is kept here exactly as store.js had it — e.g. LM.offer()
 * also needs the set to be PRICED in this market, and the set ships free only while it is
 * on sale here.
 */
import { LM } from "./self";
import { L } from "./lang";
import { codeOf, outOfStock, pick, scentOut } from "./util";
import {
  anchorOf,
  cycleMs,
  freeDealOf,
  isBundle as sharedIsBundle,
  offerEndsAt as sharedOfferEndsAt,
  offerOf,
  setFreeEndsAt as sharedSetFreeEndsAt,
  setShipsFree as sharedSetShipsFree,
  tiersEndsAt,
  tiersLive,
  tiersOf,
  tiersUnstarted,
} from "../../shared/pricing/offers";
import { canonical, counts, isTier as sharedIsTier } from "../../shared/pricing/tiers";
import type { LmApi } from "./types";

/** server clock minus device clock, in ms — measured off the catalogue's Date header */
let SKEW = 0;
export function setSkew(ms: number): void {
  SKEW = ms;
}

type OfferPart = Pick<
  LmApi,
  | "now" | "ship" | "freeDeal" | "freeOver" | "cod" | "codOn" | "setFree" | "setShipsFree" | "setFreeEndsAt"
  | "offerCycleMs" | "offerAnchor" | "offerEndsAt" | "isBundle" | "offerCfg" | "offerHere" | "offer" | "offerLeftMs"
  | "offerEnded" | "offWords" | "bundleSize" | "bundleOnlySize" | "bundleSizeId" | "bundleSellable" | "bundleScents" | "bundleOpen"
  | "isTier" | "tierN" | "tierCfg" | "tierSize" | "tierClockShown" | "tierUnstarted" | "tierEndsAt" | "tierLive" | "tierOn"
  | "tierWas" | "tierId" | "tierCounts"
>;

export const offers: OfferPart = {
  /**
   * Server time, via the offset measured when the catalogue loaded (the device clock if no
   * Date header came back). A device set a day ahead cannot see an offer the till closed.
   */
  now() {
    return Date.now() + SKEW;
  },

  /* ---------------- delivery ---------------- */

  ship() {
    return +(LM.c.ship as number) || 0;
  },
  /**
   * THE FREE-DELIVERY OFFER in this market, if one is running now: { over, end } — `over`
   * the lower threshold (0 is every order), `end` the last instant (midnight Muscat on its
   * last day) or null for no end. The till's freeDealOf, on the server clock.
   */
  freeDeal() {
    return freeDealOf(LM.cfg, LM.c, LM.now());
  },
  /** the threshold in force: the market's own, or the offer's, never higher (freeOverFor) */
  freeOver() {
    const base = +(LM.c.freeOver as number) || 0;
    const d = LM.freeDeal();
    if (!d) return base;
    return base > 0 ? Math.min(base, d.over) : d.over;
  },
  cod() {
    return +(LM.c.cod as number) || 0;
  },
  /**
   * Whether this market takes cash at the door at all. Absent means yes — a missing flag
   * must not switch a working market off. The till reads it the same way.
   */
  codOn() {
    return !LM.c || LM.c.codOn !== false;
  },

  /**
   * THE SET SHIPS FREE (v408): a basket with the set in it travels free whatever its total,
   * while the set is on sale here (LM.offer: live, here, priced), inside its own window
   * (v411/v413) and in the markets ticked for it (v410). setShipsFree on the till.
   */
  setFree(cart) {
    if (!LM.setShipsFree()) return false;
    return (cart || []).some((l) => !!l && String(l.sizeId) === "bundle");
  },
  /** the switch alone: the set's row says it ships free (here and now) */
  setShipsFree() {
    const o = LM.cfg && LM.cfg.offer;
    if (!(o && o.freeShip === true && LM.offer("bundle"))) return false;
    return sharedSetShipsFree(LM.cfg, LM.c, LM.now());
  },
  /** the last instant of the set's free delivery: null for no end, NaN before the server stamped a start */
  setFreeEndsAt() {
    return sharedSetFreeEndsAt(LM.cfg, LM.now());
  },

  /* ---------------- the set's window ---------------- */

  /** the cycle's length in ms — `hours` from /admin, or the older `repeat` word */
  offerCycleMs(o) {
    return cycleMs(o);
  },
  /** the instant cycles are measured from (a scheduled start opens the first window) */
  offerAnchor(o) {
    return anchorOf(o);
  },
  /**
   * The current window's last instant, re-derived from the clock on every call — so the
   * tick after a window closes already sees the next one (nothing is scheduled).
   */
  offerEndsAt(o) {
    return sharedOfferEndsAt(o, LM.now());
  },

  /** "bundle" is cfg.offer (three small boxes); "bundle2" the retired large set */
  isBundle(id) {
    return sharedIsBundle(id);
  },
  /** v309: the large set ("bundle2") is retired — never on the page, never sellable */
  offerCfg(id) {
    return id === "bundle2" ? null : offerOf(LM.cfg, "bundle");
  },
  /** whether this market gets the set at all; an empty list is every market */
  offerHere(id) {
    const o = LM.offerCfg(id);
    const list = o && Array.isArray(o.countries) ? o.countries : [];
    if (!list.length) return true;
    return !!LM.c && list.indexOf(codeOf(LM.c)) > -1;
  },
  /** the set, but only while it is switched on, here, started, in date — and priced here */
  offer(id) {
    const o = LM.offerCfg(id);
    if (!o || o.active === false) return null;
    if (!LM.offerHere(id)) return null;
    const s = Date.parse(String(o.startsAt || ""));
    if (Number.isFinite(s) && LM.now() < s) return null;
    const ends = LM.offerEndsAt(o);
    if (ends && ends.getTime() < LM.now()) return null;
    const p = ((LM.c && LM.c.prices) || {})[String(o.id || "bundle")];
    if (!p || !p.now) return null;
    return o;
  },
  /**
   * Milliseconds left in the current window, or null for an offer with no deadline.
   * Deliberately NOT cached: on a rolling cycle the deadline re-derives from the clock.
   */
  offerLeftMs(id) {
    const ends = LM.offerEndsAt(LM.offerCfg(id));
    if (!ends) return null;
    return Math.max(0, ends.getTime() - LM.now());
  },
  /** (v336) an offer line (duo/trio, the set, the retired bundle2) whose offer is off, not started, or past its window */
  offerEnded(line) {
    const id = String((line && line.sizeId) || "");
    if (LM.isTier(id)) {
      const t = LM.tierCfg();
      return !t || t.active === false || !LM.tierLive();
    }
    if (!LM.isBundle(id)) return false;
    const o = LM.offerCfg(id);
    if (!o || o.active === false) return true;
    const s = Date.parse(String(o.startsAt || ""));
    if (Number.isFinite(s) && LM.now() < s) return true;
    const ends = LM.offerEndsAt(o);
    return !!ends && ends.getTime() < LM.now();
  },
  /**
   * Why a line is off, in words: a single small box while the small size is sold only as
   * the set (v309); an offer that ended (v336); a live set one of its scents ran out of;
   * anything else is the market's.
   */
  offWords(line) {
    const only = LM.bundleOnlySize();
    if (only && line && String(line.sizeId) === only) return L("يُباع ضمن الباقة فقط");
    if (LM.offerEnded(line)) return L("انتهى العرض");
    const bid = line && String(line.sizeId);
    if (bid && LM.isBundle(bid) && LM.offer(bid) && !LM.bundleSellable(bid)) return L("نفدت الكمية");
    return L("غير متوفر في بلدك");
  },
  /** THE SMALL SIZE IS SOLD ONLY AS THE SET (v309): the size the set is packed from */
  bundleSize() {
    const o = LM.offerCfg("bundle");
    return String((o && o.sizeId) || "small");
  },
  /** the size, while the shop sells it only inside the set (offer.only); "" otherwise */
  bundleOnlySize() {
    const o = LM.offerCfg("bundle");
    return o && o.only === true ? LM.bundleSize() : "";
  },
  /** the size a set is packed from */
  bundleSizeId(id) {
    return String((LM.offerCfg(id) || {}).sizeId || (id === "bundle2" ? "large" : "small"));
  },
  /**
   * The set can be packed here: its size is not out (a market that never carried that size
   * id is judged on the scents alone), at least one ACTIVE scent is in that size (the shop
   * packs what it has, v336), and no scent the set holds is capped at 0 on the shelf.
   */
  bundleSellable(id) {
    const want = LM.bundleSizeId(id);
    const size = LM.listFor("sizes").filter((x) => x.id === want)[0];
    if (size && outOfStock(size)) return false;
    const list = LM.bundleScents(id);
    return list.length > 0 && list.every((s) => !(LM.stockCap && LM.stockCap(s.id, want) === 0));
  },
  /** the active scents a set is packed from right now (v336) */
  bundleScents(id) {
    const want = LM.bundleSizeId(id);
    const size = LM.listFor("sizes").filter((x) => x.id === want)[0];
    const sz = size ? want : null;
    return LM.scents().filter((s) => !scentOut(s, sz));
  },
  bundleOpen() {
    return !!LM.offer("bundle") && LM.bundleSellable("bundle");
  },

  /* ---------------- the large-box offers (v303) ----------------
     Two boxes, and three for the price of two, in the shopper's own mix of scents. A line
     is { sizeId: "duo"|"trio", mix: ["oud","oud","amber"], qty } and its item id
     "trio:oud.oud.amber" — the scents in the market's order, so one mix is one line. */

  isTier(id) {
    return sharedIsTier(id);
  },
  tierN(id) {
    return id === "trio" ? 3 : id === "duo" ? 2 : 1;
  },
  tierCfg() {
    return tiersOf(LM.cfg);
  },
  tierSize() {
    const t = LM.tierCfg();
    return String((t && t.sizeId) || "large");
  },
  /** the countdown pill is the panel's choice (v312); off hides the pill, the window still ends the offers */
  tierClockShown() {
    const t = LM.tierCfg();
    return !t || t.clock !== false;
  },
  /** a window with a length but no anchor yet has not started */
  tierUnstarted() {
    return tiersUnstarted(LM.tierCfg());
  },
  tierEndsAt() {
    return tiersEndsAt(LM.cfg, LM.now());
  },
  tierLive() {
    return tiersLive(LM.cfg, LM.now());
  },
  /** this offer, here and now: live, in this market, priced, and the large box on sale here */
  tierOn(id) {
    if (!LM.isTier(id) || !LM.tierLive()) return false;
    const t = LM.tierCfg()!;
    const list = Array.isArray(t.countries) ? t.countries : [];
    if (list.length && (!LM.c || list.indexOf(codeOf(LM.c)) < 0)) return false;
    if (!(pick(id).now > 0)) return false;
    const want = LM.tierSize();
    const size = LM.sizes().filter((z) => z.id === want)[0];
    return !!size && !outOfStock(size);
  },
  /** what the same boxes cost one at a time */
  tierWas(id) {
    return LM.tierN(id) * (pick(LM.tierSize()).now || 0);
  },
  tierId(id, mix) {
    return canonical(id, mix || [], LM.listFor("scents").map((s) => s.id));
  },
  /** { oud: 2, amber: 1 }, in the market's scent order */
  tierCounts(mix) {
    const id = LM.tierId("x", mix).slice(2);
    return counts(id ? id.split(".") : []);
  },
};
