/**
 * The large-box offers: one box, two boxes ("duo"), three boxes ("trio") in the shopper's
 * own mix. Item ids: "duo:oud.amber", "trio:oud.oud.amber" — scents in the market's scent
 * order, so one mix is always one id (and one basket line).
 */
import type { Catalogue, Country } from "../catalogue/types";
import { tiersOf } from "./offers";

export const TIERS: Record<string, number> = { duo: 2, trio: 3 };
export const ID_RE = /^(duo|trio):([a-z0-9_-]{1,40}(?:\.[a-z0-9_-]{1,40}){1,2})$/i;
/** Arabic names, as the order row, the panel and the invoice print them. */
export const NAME: Record<string, string> = { duo: "علبتان", trio: "3 علب" };
export const NAME_EN: Record<string, string> = { duo: "Two boxes", trio: "Three boxes" };

export interface ParsedTier {
  tier: "duo" | "trio";
  n: number;
  mix: string[];
}

export function isTier(id: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(TIERS, String(id || ""));
}

export function parseTier(id: unknown): ParsedTier | null {
  const m = ID_RE.exec(String(id || "").trim());
  if (!m) return null;
  const tier = m[1]!.toLowerCase() as "duo" | "trio";
  const mix = m[2]!.toLowerCase().split(".");
  if (mix.length !== TIERS[tier]) return null;
  return { tier, n: TIERS[tier]!, mix };
}

/** The same mix in the market's order ("amber.oud" and "oud.amber" are one product). */
export function canonical(tier: string, mix: readonly string[], order: readonly string[]): string {
  const rank: Record<string, number> = {};
  (order || []).forEach((id, i) => (rank[id] = i));
  const sorted = mix.slice().sort((a, b) => {
    const x = rank[a] == null ? 999 : rank[a]!;
    const y = rank[b] == null ? 999 : rank[b]!;
    return x - y || (a < b ? -1 : a > b ? 1 : 0);
  });
  return tier + ":" + sorted.join(".");
}

/** { oud: 2, amber: 1 } in mix order. */
export function counts(mix: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  (mix || []).forEach((s) => (out[s] = (out[s] || 0) + 1));
  return out;
}

export function tierSizeOf(cfg: Catalogue | null | undefined): string {
  const t = tiersOf(cfg);
  return String((t && t.sizeId) || "large");
}

/** Offered in this market: listed (or no list) and priced here. */
export function tierInMarket(cfg: Catalogue | null | undefined, country: Country | null | undefined, tier: string): boolean {
  const t = tiersOf(cfg);
  if (!t || !country) return false;
  const list = Array.isArray(t.countries) ? t.countries : [];
  if (list.length && list.indexOf(String(country.code || "").toUpperCase()) < 0) return false;
  const p = (country.prices || {})[tier];
  return !!p && Number(p.now) > 0;
}

/** The boxes ONE of this line is: [{ code: "oud-large", qty: 2 }, …]. */
export function tierBoxes(cfg: Catalogue | null | undefined, id: string): Array<{ code: string; qty: number }> {
  const p = parseTier(id);
  if (!p) return [];
  const size = tierSizeOf(cfg);
  const c = counts(p.mix);
  return Object.keys(c).map((s) => ({ code: s + "-" + size, qty: c[s]! }));
}

/** "عود الافندر ×2 · عنبر توت" */
export function mixWords(mix: readonly string[], nameOf?: (scentId: string) => string): string {
  const c = counts(mix);
  return Object.keys(c)
    .map((s) => {
      const n = nameOf ? nameOf(s) : s;
      return c[s]! > 1 ? n + " ×" + c[s] : n;
    })
    .join(" · ");
}
