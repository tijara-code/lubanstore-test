/**
 * Server-side pricing: the only place an order's money is decided.
 *
 * The browser posts what the shopper CHOSE (item ids, quantities, country, cash or card).
 * Every figure is looked up in the catalogue; anything the browser sends about money is
 * ignored. The storefront imports the same availability rules, so the page cannot offer
 * what the till refuses.
 */
import { r3 } from "../money";
import type { Catalogue, Country, Extra, Scent, Size } from "../catalogue/types";
import { bundleOnly, bundleSizeId, countsFree, freeDealOf, freeOverFor, isBundle, offerIn, offerLive, offerOf, setShipsFree, tiersLive } from "./offers";
import { NAME as TIER_NAME, canonical, isTier, mixWords, parseTier, tierInMarket, tierSizeOf, type ParsedTier } from "./tiers";

/** The only codes priceOrder throws: facts about the basket the shopper can be told. */
export const REFUSALS = {
  unknown_country: 1,
  no_items: 1,
  unknown_item: 1,
  unavailable_here: 1,
  offer_closed: 1,
  unpriced_item: 1,
  cod_not_offered: 1,
} as const;
export type RefusalCode = keyof typeof REFUSALS;

export class PricingRefusal extends Error {
  readonly code: RefusalCode;
  readonly item: string | null;
  constructor(code: RefusalCode, item: unknown = null) {
    super(code);
    this.name = "PricingRefusal";
    this.code = code;
    this.item = item == null ? null : String(item);
  }
}

export function isRefusal(e: unknown): e is PricingRefusal {
  return e instanceof PricingRefusal || !!(e && typeof e === "object" && (e as { code?: string }).code && (e as { code: string }).code in REFUSALS);
}

export function countryFor(cfg: Catalogue | null | undefined, code: unknown): Country | null {
  const want = String(code || "").toUpperCase();
  return (cfg?.countries || []).filter((c) => c.code === want)[0] || null;
}

type ListKind = "sizes" | "scents" | "extras";
type ListOf<K extends ListKind> = K extends "sizes" ? Size[] : K extends "scents" ? Scent[] : Extra[];

/** A market's own list, else the shared one. */
export function listFor<K extends ListKind>(cfg: Catalogue | null | undefined, country: Country | null | undefined, kind: K): ListOf<K> {
  const own = country && (country[kind] as unknown);
  if (Array.isArray(own) && own.length) return own as ListOf<K>;
  return ((cfg && (cfg[kind] as unknown)) || []) as ListOf<K>;
}

/** Strict: a catalogue carrying the string "false" must not read as out of stock. */
export function outOfStock(item: { soldOut?: unknown } | null | undefined): boolean {
  return !!item && (item.soldOut === true || item.soldOut === "true");
}

export function isHidden(item: { hidden?: unknown } | null | undefined): boolean {
  return !!item && (item.hidden === true || item.hidden === "true");
}

function legacyOff(country: Country | null | undefined, kind: "sizes" | "scents", id: string): boolean {
  const list = country?.off?.[kind];
  return Array.isArray(list) && list.indexOf(id) > -1;
}

/** A scent in one size: `soldOut` = every size; `soldOutSizes` = just those. Null size = the scent as a whole. */
export function scentOut(scent: Scent | null | undefined, sizeId: string | null): boolean {
  if (outOfStock(scent)) return true;
  if (!sizeId) return false;
  const list = Array.isArray(scent && scent.soldOutSizes) ? scent!.soldOutSizes! : [];
  return list.indexOf(sizeId) > -1;
}

export interface ParsedItem {
  /** "bundle", "duo"/"trio", an extra's id, or a size id */
  sizeId: string;
  scentId: string | null;
  size?: Size;
  scent?: Scent;
  extra?: Extra;
  tier?: ParsedTier;
  /** canonical tier item id */
  itemId?: string;
  mixWords?: string;
}

/**
 * itemId is "bundle", "<scentId>-<sizeId>" (e.g. "oud-small"), an add-on's id, or an offer
 * ("duo:oud.amber"). `any` (a hand-typed admin order) skips availability, not existence.
 */
export function parseItemId(cfg: Catalogue, itemId: unknown, country: Country, any = false): ParsedItem | null {
  const id = String(itemId || "").trim();
  if (isBundle(id)) return { sizeId: id, scentId: null };

  const tp = parseTier(id);
  if (tp) {
    const sizeId = tierSizeOf(cfg);
    const size = listFor(cfg, country, "sizes").filter((s) => s && s.id === sizeId)[0];
    if (!size) return null;
    const scents = listFor(cfg, country, "scents");
    const byId: Record<string, Scent> = {};
    scents.forEach((s) => {
      if (s && s.id) byId[s.id] = s;
    });
    for (const sid of tp.mix) {
      const sc = byId[sid];
      if (!sc) return null;
      if (!any && (sc.active === false || scentOut(sc, sizeId))) return null;
    }
    if (!any && (outOfStock(size) || isHidden(size))) return null;
    const canon = canonical(tp.tier, tp.mix, scents.map((s) => s.id));
    const parsed = parseTier(canon)!;
    return {
      sizeId: tp.tier,
      scentId: null,
      tier: parsed,
      size,
      itemId: canon,
      mixWords: mixWords(parsed.mix, (sid) => (byId[sid] && byId[sid]!.name) || sid),
    };
  }

  const extra = listFor(cfg, country, "extras").filter((x) => x && x.id === id)[0];
  if (extra) {
    if (!any && (extra.active === false || outOfStock(extra))) return null;
    return { sizeId: id, scentId: null, extra };
  }

  // "<scentId>-<sizeId>": split on the longest size id this market sells that the item ends with.
  const sizes = listFor(cfg, country, "sizes");
  const size = sizes
    .filter((s) => s && s.id && id.length > String(s.id).length + 1 && id.slice(-(String(s.id).length + 1)) === "-" + s.id)
    .sort((a, b) => String(b.id).length - String(a.id).length)[0];
  if (!size) return null;
  const sizeId = size.id;
  const scentId = id.slice(0, id.length - sizeId.length - 1);
  const scent = listFor(cfg, country, "scents").filter((s) => s.id === scentId)[0];
  if (!scent || (!any && scent.active === false)) return null;
  if (!any && (outOfStock(size) || scentOut(scent, sizeId))) return null;
  // Hidden in the admin: off the store, so off the till (still packs a set).
  if (!any && isHidden(size)) return null;
  return { sizeId, scentId, size, scent };
}

/** Can this market sell this line right now (bundles, tiers, legacy switches)? */
export function sellableIn(cfg: Catalogue, country: Country, sizeId: string, scentId: string | null): boolean {
  if (isTier(sizeId)) return tierInMarket(cfg, country, sizeId);
  if (isBundle(sizeId)) {
    if (!offerIn(cfg, country && country.code, sizeId)) return false;
    const want = bundleSizeId(cfg, sizeId);
    const size = listFor(cfg, country, "sizes").filter((s) => s.id === want)[0];
    if (size && outOfStock(size)) return false;
    if (size && legacyOff(country, "sizes", want)) return false;
    const sz = size ? want : null;
    const active = listFor(cfg, country, "scents").filter((s) => s && s.active !== false && !legacyOff(country, "scents", s.id));
    return active.some((s) => !scentOut(s, sz));
  }
  if (legacyOff(country, "sizes", sizeId)) return false;
  if (scentId && legacyOff(country, "scents", scentId)) return false;
  return true;
}

/** A market's OMR rate: its stated toOmr, else 1 for an OMR market, else 0 (unpriceable). */
export function rateOf(c: Pick<Country, "toOmr" | "cur"> | null | undefined): number {
  const r = Number(c && c.toOmr);
  if (Number.isFinite(r) && r > 0) return r;
  return String((c && c.cur) || "").trim().toUpperCase() === "OMR" ? 1 : 0;
}

export type PayMethod = "cod" | "card" | "transfer";

export interface PriceInput {
  countryCode: unknown;
  items: Array<{ itemId?: unknown; qty?: unknown }> | unknown;
  pay?: PayMethod | string;
  /** a hand-typed order from the admin: availability rules do not apply */
  manual?: boolean;
  /** re-pricing an order placed earlier (cash switch, admin re-quote) */
  existing?: boolean;
}

export interface QuoteLine {
  itemId: string;
  scent: string;
  size: string;
  price: number;
  was: number;
  qty: number;
}

export interface Quote {
  country: Country;
  items: QuoteLine[];
  cur: string;
  sub: number;
  /** what counts toward free delivery (samples excluded) */
  freeSub: number;
  ship: number;
  codFee: number;
  total: number;
  wasSub: number;
  saved: number;
  omrRate: number;
  omr: number;
}

export const MAX_QTY = 99;
export const MAX_LINES = 40;

/** Price a basket. Throws PricingRefusal on anything that does not price cleanly. */
export function priceOrder(cfg: Catalogue, input: PriceInput, now: number = Date.now()): Quote {
  const manual = !!input.manual;
  const c = countryFor(cfg, input.countryCode);
  if (!c) throw new PricingRefusal("unknown_country");

  const posted = Array.isArray(input.items) ? (input.items as Array<{ itemId?: unknown; qty?: unknown }>).slice(0, MAX_LINES) : [];
  if (!posted.length) throw new PricingRefusal("no_items");

  let freeSub = 0;
  let setFree = false;
  const lines: QuoteLine[] = posted.map((i) => {
    const parsed = parseItemId(cfg, i.itemId, c, manual);
    if (!parsed) throw new PricingRefusal("unknown_item", i.itemId);

    if (!manual && !sellableIn(cfg, c, parsed.sizeId, parsed.scentId)) throw new PricingRefusal("unavailable_here", i.itemId);

    // The set's size is sold only as the set (manual and existing orders excepted).
    if (
      !manual && !input.existing && bundleOnly(cfg) && !isBundle(parsed.sizeId) && !parsed.tier && !parsed.extra &&
      String(parsed.sizeId) === bundleSizeId(cfg, "bundle")
    ) {
      throw new PricingRefusal("unavailable_here", i.itemId);
    }
    if (!manual && isBundle(parsed.sizeId) && !offerLive(cfg, parsed.sizeId, now)) throw new PricingRefusal("offer_closed");
    if (!manual && parsed.tier && !tiersLive(cfg, now)) throw new PricingRefusal("offer_closed");

    const p = (c.prices || {})[parsed.sizeId] || (manual ? { now: 0, was: 0 } : null);
    if (!p || (!manual && !(Number(p.now) > 0))) throw new PricingRefusal("unpriced_item", i.itemId);

    const qty = Math.max(1, Math.min(MAX_QTY, parseInt(String(i.qty), 10) || 1));
    if (countsFree(parsed.extra)) freeSub += Number(p.now) * qty;
    if (String(parsed.sizeId) === "bundle" && !parsed.tier && !parsed.extra && setShipsFree(cfg, c, now)) setFree = true;

    const offer = isBundle(parsed.sizeId) ? offerOf(cfg, parsed.sizeId) || {} : null;
    const scent = parsed.extra
      ? parsed.extra.name
      : parsed.tier
        ? TIER_NAME[parsed.tier.tier]!
        : parsed.scentId
          ? parsed.scent!.name
          : (offer && offer.name) || "باقة";
    const size = parsed.extra
      ? parsed.extra.note || ""
      : parsed.tier
        ? parsed.mixWords || ""
        : offer
          ? offer.note || ""
          : parsed.size!.name + (parsed.size!.weight ? " " + parsed.size!.weight : "");

    // Reference price for the savings line: only when genuinely higher than what is charged.
    let was = Number(p.was) > Number(p.now) ? Number(p.was) : Number(p.now);
    if (parsed.tier) {
      const one = Number(((c.prices || {})[tierSizeOf(cfg)] || {}).now) || 0;
      const ref = one * parsed.tier.n;
      was = ref > Number(p.now) ? ref : Number(p.now);
    }

    return {
      itemId: parsed.extra ? parsed.extra.id : parsed.tier ? parsed.itemId! : parsed.scentId ? parsed.scentId + "-" + parsed.sizeId : parsed.sizeId,
      scent,
      size,
      price: Number(p.now),
      was,
      qty,
    };
  });

  const sub = lines.reduce((t, i) => t + i.price * i.qty, 0);
  const wasSub = lines.reduce((t, i) => t + i.was * i.qty, 0);
  const over = freeOverFor(cfg, c, now);
  // freeOver 0 means "no free delivery" — free with no threshold only while a 0-offer runs.
  const free = setFree || (over > 0 ? freeSub >= over : !!freeDealOf(cfg, c, now));
  const ship = free ? 0 : Number(c.ship) || 0;
  if (!manual && input.pay === "cod" && c.codOn === false) throw new PricingRefusal("cod_not_offered");
  const cod = input.pay === "cod" ? Number(c.cod) || 0 : 0;

  const total = r3(sub + ship + cod);
  const rate = rateOf(c);
  if (!rate) throw new PricingRefusal("unpriced_item", null);

  return {
    country: c,
    items: lines,
    cur: c.cur,
    sub: r3(sub),
    freeSub: r3(freeSub),
    ship,
    codFee: cod,
    total,
    wasSub: r3(wasSub),
    saved: r3(Math.max(0, wasSub - sub)),
    omrRate: rate,
    omr: r3(total * rate),
  };
}
