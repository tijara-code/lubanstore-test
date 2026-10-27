/**
 * Products as the warehouse knows them: SKU codes, the boxes a basket line is, and an order
 * as the lines a picker picks. Shared by the push and the till's stock gate.
 *
 * SKU CODES are the shop's, set on the Empower tab (ops `omniful_skus`, item id → code);
 * an empty box means our own id in capitals (OUD-LARGE) — visibly ours.
 *
 * THE SET is one kit line when the shop gave it a SKU of its own (a kit in Omniful), else its
 * boxes: one of each ACTIVE scent in the set's size (an order placed with a scent out is made
 * up from the in-stock scents, the box count unchanged). A large-box offer (duo/trio) is the
 * boxes its id names — never a kit. Their money is spread across the boxes in whole minor
 * units, the odd unit to the first, so the lines add up to exactly what was charged.
 */
import { decimalsClamp, r3 } from "../../../shared/money";
import { bundleSizeId, isBundle, offerOf } from "../../../shared/pricing/offers";
import { countryFor, listFor, scentOut } from "../../../shared/pricing/price";
import { NAME_EN as TIER_NAME_EN, parseTier, tierBoxes } from "../../../shared/pricing/tiers";
import type { Catalogue, Country, Scent } from "../../../shared/catalogue/types";
import type { OrderLine } from "../../../shared/orders/types";

export type SkuMap = Record<string, string>;
export interface Box {
  code: string;
  qty: number;
}

export interface WarehouseLine {
  /** our id: oud-small, burner, bundle (a kit) */
  code: string;
  /** the code Omniful knows it by */
  seller_sku_code: string;
  name: string;
  quantity: number;
  unit_price: number;
  item_total: number;
  display_price: number;
}

export function defaultSku(code: string): string {
  return String(code || "").trim().toUpperCase();
}

export function skuOf(skus: SkuMap | null | undefined, code: string): string {
  const set = skus && typeof skus === "object" ? String(skus[code] || "").trim() : "";
  return set || defaultSku(code);
}

/** One box of each active scent in the set's size. `which`: "bundle" (or the retired "bundle2"). */
export function bundleBoxes(countryCode: unknown, cfg: Catalogue, which = "bundle"): Box[] {
  const c = countryFor(cfg, countryCode);
  const all: Scent[] = c && Array.isArray(c.scents) && c.scents.length ? c.scents : cfg.scents || [];
  const act = all.filter((s) => s && s.active !== false);
  const own = act.length ? act : all;
  const sizeId = bundleSizeId(cfg, which || "bundle");
  const open = own.filter((s) => !scentOut(s, sizeId));
  const pool = open.length ? open : own;
  const count: Record<string, number> = {};
  const order: string[] = [];
  for (let i = 0; i < own.length && pool.length; i++) {
    const id = pool[i % pool.length]!.id;
    if (!count[id]) {
      count[id] = 0;
      order.push(id);
    }
    count[id]!++;
  }
  return order.map((id) => ({ code: id + "-" + sizeId, qty: count[id]! }));
}

/** { "oud-small": 3, … } — the boxes a basket holds (sets and offers as their boxes). */
export function boxesOf(cfg: Catalogue, countryCode: unknown, lines: Array<{ itemId?: unknown; qty?: unknown }>): Record<string, number> {
  const need: Record<string, number> = {};
  for (const l of lines || []) {
    const id = String((l && l.itemId) || "");
    const qty = Math.max(0, parseInt(String(l && l.qty), 10) || 0);
    if (!id || !qty) continue;
    const boxes = isBundle(id) ? bundleBoxes(countryCode, cfg, id) : parseTier(id) ? tierBoxes(cfg, id) : [{ code: id, qty: 1 }];
    for (const b of boxes) need[b.code] = (need[b.code] || 0) + b.qty * qty;
  }
  return need;
}

/** the English name the warehouse reads, from the catalogue */
export function nameOf(cfg: Catalogue, country: Country | null, code: string): string {
  const t = parseTier(code);
  if (t) return TIER_NAME_EN[t.tier]!;
  if (isBundle(code)) {
    const o = offerOf(cfg, code) || {};
    return String(o.name_en || o.name || (code === "bundle2" ? "Large bundle" : "Bundle"));
  }
  const en = (i: { name_en?: string; name?: string; id?: string } | undefined) => (i ? String(i.name_en || i.name || i.id || "") : "");
  const x = listFor(cfg, country, "extras").find((i) => i.id === code);
  if (x) return en(x);
  const cut = code.lastIndexOf("-");
  if (cut < 1) return code;
  const sc = listFor(cfg, country, "scents").find((i) => i.id === code.slice(0, cut));
  const sz = listFor(cfg, country, "sizes").find((i) => i.id === code.slice(cut + 1));
  const w = sz ? String(sz.weight_en || sz.weight || "") : "";
  return [en(sc) || code.slice(0, cut), [en(sz) || code.slice(cut + 1), w].filter(Boolean).join(" ")].join(" · ");
}

interface Acc extends WarehouseLine {
  minor: number;
}

export function linesOf(order: { countryCode?: string | null; items?: OrderLine[] | null }, cfg: Catalogue, skus: SkuMap): WarehouseLine[] {
  const c = countryFor(cfg, order && order.countryCode);
  const f = Math.pow(10, decimalsClamp(c && c.dec));
  const out: Acc[] = [];
  const add = (code: string, qty: number, totalMinor: number, displayUnit: number) => {
    const prev = out.find((l) => l.code === code);
    if (prev) {
      prev.quantity += qty;
      prev.minor += totalMinor;
      prev.item_total = r3(prev.minor / f);
      prev.unit_price = r3(prev.item_total / prev.quantity);
      return;
    }
    out.push({
      code,
      seller_sku_code: skuOf(skus, code),
      name: nameOf(cfg, c, code),
      quantity: qty,
      minor: totalMinor,
      unit_price: r3(totalMinor / f / qty),
      item_total: r3(totalMinor / f),
      display_price: r3(displayUnit),
    });
  };
  for (const i of (order && order.items) || []) {
    const qty = Math.max(1, parseInt(String(i && i.qty), 10) || 1);
    const price = Number(i && i.price) || 0;
    const was = Number(i && i.was) > price ? Number(i.was) : price;
    const id = String((i && i.itemId) || "");
    if (!id) continue;
    const tier = parseTier(id);
    if (!tier && !isBundle(id)) {
      add(id, qty, Math.round(price * qty * f), was);
      continue;
    }
    /* the shop's own set SKU: one kit line */
    if (!tier && skus && String(skus[id] || "").trim()) {
      add(id, qty, Math.round(price * qty * f), was);
      continue;
    }
    const boxes = tier ? tierBoxes(cfg, id) : bundleBoxes(order.countryCode, cfg, id);
    const per = boxes.reduce((t, b) => t + b.qty, 0);
    if (!per) continue;
    const all = Math.round(price * qty * f);
    const units = per * qty;
    const each = Math.floor(all / units);
    let spare = all - each * units;
    for (const b of boxes) {
      const n = b.qty * qty;
      const give = Math.min(spare, n);
      spare -= give;
      add(b.code, n, each * n + give, was / per);
    }
  }
  return out.map(({ minor, ...l }) => {
    void minor;
    return l;
  });
}

export interface Unmapped {
  code: string;
  name: string;
  sku: string;
}

/** (v319) the lines whose box has no SKU set: named before anything is sent ("Sku Not Valid" says nothing). */
export function unmapped(lines: WarehouseLine[], skus: SkuMap | null | undefined): Unmapped[] {
  const set = skus && typeof skus === "object" ? skus : {};
  return (lines || [])
    .filter((l) => l && l.code && !String(set[l.code] || "").trim())
    .map((l) => ({ code: l.code, name: l.name || l.code, sku: l.seller_sku_code }));
}

export function unmappedText(list: Unmapped[]): string {
  return list.map((u) => u.name + " (" + u.code + ")").join(", ");
}
