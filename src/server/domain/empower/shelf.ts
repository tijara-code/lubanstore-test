/**
 * THE SHELF AT EMPOWER — what Omniful says is available at our hub, per box, through the
 * Empower tab's SKU codes; and the catalogue's three stock switches that read it:
 *
 *   cfg.stockLive            the "pieces left" counter beside each size (display)
 *   cfg.stockHide[id]=true   that box leaves the page at 0 available; the small size leaves
 *                            when every box in it is hidden (the large never does)
 *   cfg.stockCap[id]=true    that box can be bought only up to what is available — the page's
 *                            stepper stops there and the till refuses more (domain/stock.ts)
 *
 * A READING THAT CANNOT BE TRUSTED IS NOT A READING OF 0: a SKU map that could not be read,
 * a shelf answer in a shape this cannot read, or codes that do not match the hub's hide
 * nothing and count nothing — the last good reading (≤ 1 h, with `error`) stands, and is
 * never written over. A good reading is kept in ops (`omniful_stock`) and reused for 45 s,
 * so Omniful is asked about once a minute however many shoppers look; a push marks it
 * expired (the shelf moved) so the next read asks again.
 */
import type { Catalogue } from "../../../shared/catalogue/types";
import type { Deps } from "../../core/deps";
import { getOpData, putOp } from "../../core/ops";
import type { ShelfRow } from "../../services/omniful";
import { skuOf, type SkuMap } from "./lines";
import { omf, readSkus } from "./store";

export const CACHE_KEY = "omniful_stock";
export const FRESH_MS = 45e3;
export const STALE_OK_MS = 3600e3;
/** only the small box hides as a size (the large box is the product; the shop restocks it) */
export const HIDE_SIZES = ["small"];

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function ticks(h: unknown): string[] {
  if (!h || typeof h !== "object" || Array.isArray(h)) return [];
  const o = h as Record<string, unknown>;
  return Object.keys(o).filter((k) => o[k] === true && ID_RE.test(k));
}

export function hideSet(cfg: Catalogue | null | undefined): string[] {
  return ticks(cfg && cfg.stockHide);
}
export function capSet(cfg: Catalogue | null | undefined): string[] {
  return ticks(cfg && cfg.stockCap);
}
/** is the shelf asked at all: the counter on, or any box ticked to hide or cap */
export function stockOn(cfg: Catalogue | null | undefined): boolean {
  return !!cfg && (cfg.stockLive === true || hideSet(cfg).length > 0 || capSet(cfg).length > 0);
}

export interface TrackerRow {
  /** <scent>-<size> */
  id: string;
  sku: string;
  /** what can still be sold (after net(): the shelf less what open orders hold) */
  available: number;
  onHand: number;
  /** after net(): Empower's own available figure */
  shelf?: number;
  /** after net(): held by open orders not yet on Empower */
  reserved?: number;
}

function idsOf(cfg: Catalogue, kind: "sizes" | "scents"): string[] {
  const seen: string[] = [];
  const lists = [cfg && cfg[kind], ...((cfg && cfg.countries) || []).map((c) => c && c[kind])];
  for (const l of lists) for (const x of Array.isArray(l) ? l : []) if (x && x.id && seen.indexOf(String(x.id)) < 0) seen.push(String(x.id));
  return seen;
}

/** every box the catalogue sells, with its SKU: { "oud-small": "LM2001" } (sizes first, then scents) */
export function skuByItem(cfg: Catalogue, skus: SkuMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sz of idsOf(cfg, "sizes")) for (const sc of idsOf(cfg, "scents")) out[sc + "-" + sz] = skuOf(skus, sc + "-" + sz);
  return out;
}

/** size id → its boxes' SKU codes (the set's kit is not a box) */
export function skusBySize(cfg: Catalogue, skus: SkuMap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const sz of idsOf(cfg, "sizes")) {
    out[sz] = [];
    for (const sc of idsOf(cfg, "scents")) {
      const code = skuOf(skus, sc + "-" + sz);
      if (code && out[sz]!.indexOf(code) < 0) out[sz]!.push(code);
    }
  }
  return out;
}

/** { large: 17, small: 9 } — every size answered, 0 when none of its SKUs are on the shelf */
export function sumBySize(cfg: Catalogue, skus: SkuMap, rows: Array<{ sku_code: string; available: number }>): Record<string, number> {
  const avail: Record<string, number> = {};
  for (const r of rows || []) if (r && r.sku_code) avail[String(r.sku_code).toUpperCase()] = (avail[String(r.sku_code).toUpperCase()] || 0) + (Number(r.available) || 0);
  const by = skusBySize(cfg, skus);
  const left: Record<string, number> = {};
  for (const sz of Object.keys(by)) left[sz] = by[sz]!.reduce((t, code) => t + (avail[code.toUpperCase()] || 0), 0);
  return left;
}

/** The Stock Tracker's rows: one per box, catalogue order; a SKU not on the shelf reads 0 / 0. */
export function trackerRows(cfg: Catalogue, skus: SkuMap, rows: Array<{ sku_code: string; available: number; onHand?: number }>): TrackerRow[] {
  const by: Record<string, { available: number; onHand: number }> = {};
  for (const r of rows || []) {
    if (!r || !r.sku_code) continue;
    const k = String(r.sku_code).toUpperCase();
    const prev = by[k] || { available: 0, onHand: 0 };
    by[k] = { available: prev.available + (Number(r.available) || 0), onHand: prev.onHand + (Number(r.onHand) || 0) };
  }
  const map = skuByItem(cfg, skus);
  return Object.keys(map).map((id) => {
    const got = by[map[id]!.toUpperCase()] || { available: 0, onHand: 0 };
    return { id, sku: map[id]!, available: got.available, onHand: got.onHand };
  });
}

/** What the page hides: each "hide at 0" box at 0 available; the small size when all of its boxes are hidden. */
export function hidden(cfg: Catalogue, tracker: TrackerRow[]): { items: string[]; sizes: string[] } {
  const set = hideSet(cfg);
  if (!set.length) return { items: [], sizes: [] };
  const items = (tracker || []).filter((r) => set.indexOf(r.id) > -1 && r.available <= 0).map((r) => r.id);
  const sizes = HIDE_SIZES.filter((sz) => {
    const mine = (tracker || []).filter((r) => r.id.slice(-(sz.length + 1)) === "-" + sz);
    return mine.length > 0 && mine.every((r) => items.indexOf(r.id) > -1);
  });
  return { items, sizes };
}

/** { "oud-small": 13 } — the available count of every capped box; nothing when the shelf is unknown. */
export function capped(cfg: Catalogue, tracker: TrackerRow[] | null | undefined): Record<string, number> {
  const set = capSet(cfg);
  const out: Record<string, number> = {};
  if (!set.length || !Array.isArray(tracker)) return out;
  for (const r of tracker) if (set.indexOf(r.id) > -1) out[r.id] = Math.max(0, Math.floor(Number(r.available) || 0));
  return out;
}

export interface ShelfReading {
  left: Record<string, number>;
  tracker?: TrackerRow[];
  at: string | null;
  source: "omniful" | "cached" | "none" | "off";
  error?: string;
  /** the first row's keys when nothing could be read */
  fields?: string[];
  note?: string;
  hubs?: string[];
  /** how many shelf rows were read */
  skus?: number;
  /** a reading of a basket's boxes only (never kept) */
  partial?: boolean;
  expired?: boolean;
}

async function readCache(deps: Deps): Promise<ShelfReading | null> {
  try {
    const d = await getOpData<ShelfReading | null>(deps.db, CACHE_KEY, null);
    return d && typeof d === "object" && !Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
}

async function writeCache(deps: Deps, data: ShelfReading): Promise<void> {
  try {
    await putOp(deps.db, CACHE_KEY, data, new Date(deps.now()));
  } catch {
    /* a cache; the answer still goes out */
  }
}

/** The shelf has moved (an order was pushed): the next read asks Omniful. → true when marked. */
export async function expireShelf(deps: Deps): Promise<boolean> {
  const cached = await readCache(deps);
  if (!cached || cached.expired) return false;
  await writeCache(deps, { ...cached, expired: true });
  return true;
}

/**
 * Read the shelf. `fresh`: ask Omniful now. `only`: the till asking about a basket's boxes —
 * when the shelf must be read per SKU, just those. Never throws.
 */
export async function readShelf(
  deps: Deps,
  cfg: Catalogue,
  opts: { fresh?: boolean; only?: string[]; cacheOnly?: boolean } = {},
): Promise<ShelfReading> {
  if (!stockOn(cfg)) return { left: {}, at: null, source: "off" };
  const cached = await readCache(deps);
  const age = cached && cached.at ? deps.now() - Date.parse(cached.at) : Infinity;
  if (!opts.fresh && cached && !cached.expired && age < FRESH_MS) return { ...cached, source: "cached" };
  const kept = (why: string, extra: Partial<ShelfReading> = {}): ShelfReading => {
    if (cached && age < STALE_OK_MS) return { ...cached, source: "cached", error: why, ...extra };
    return { left: {}, at: null, source: "none", error: why, ...extra };
  };
  /* inside a held lock: never a network call — the kept reading or nothing */
  if (opts.cacheOnly) return kept("no fresh reading kept (not asked inside the till's lock)");
  const client = omf(deps);
  if (!client.configured()) return kept("omniful_not_configured");
  let skus: SkuMap;
  try {
    skus = await readSkus(deps, { strict: true });
  } catch (e) {
    return kept("the SKU codes could not be read: " + String((e as Error)?.message || e));
  }
  const map = skuByItem(cfg, skus);
  const want = Array.isArray(opts.only) ? opts.only.filter((k) => map[k]) : Object.keys(map);
  let got;
  try {
    got = await client.hubInventory(5, want.map((k) => map[k]!));
  } catch (e) {
    return kept(String((e as Error)?.message || e));
  }
  let tracker = trackerRows(cfg, skus, got.rows);
  const onShelf = new Set(got.rows.map((r: ShelfRow) => String(r.sku_code).toUpperCase()));
  const partial = !!(opts.only && got.perSku);
  if (partial) tracker = tracker.filter((t) => want.indexOf(t.id) > -1);
  if (!tracker.some((t) => onShelf.has(t.sku.toUpperCase()))) {
    if (!got.rows.length) return kept("the shelf answered with no row the panel can read", { fields: got.fields || [] });
    const codes = [...onShelf];
    return kept(
      "none of the shelf's " + got.rows.length + " SKU codes match the Empower tab's (the shelf has " +
        codes.slice(0, 6).join(", ") + (codes.length > 6 ? ", …" : "") + ")",
    );
  }
  const at = new Date(deps.now()).toISOString();
  /* a reading of some boxes is an answer for the till, never a reading of the shelf */
  if (partial) return { left: {}, tracker, at, source: "omniful", partial: true };
  const out: ShelfReading = { left: sumBySize(cfg, skus, got.rows), tracker, at, source: "omniful", skus: got.rows.length };
  if (got.note) out.note = got.note;
  if (got.hubs && got.hubs.length) out.hubs = got.hubs;
  await writeCache(deps, out);
  return out;
}
