/** Small helpers the core's modules share (not part of LM unless store.js exposed them). */
import { LM } from "./self";
import type { Country, Price, Scent } from "../../shared/catalogue/types";

/** Digits render as Latin (0-9) everywhere; a number goes through here so there is one place to change that. */
export function toAr(n: unknown): string {
  return String(n);
}

/**
 * Catalogue strings are editable in /admin and therefore data, not markup — anything that
 * reaches innerHTML goes through esc.
 */
export function esc(v: unknown): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => map[c]!);
}

export function $(s: string): Element | null {
  return document.querySelector(s);
}

/** A catalogue colour reaches a style attribute only if it really is a hex colour. */
export function hexOr(v: unknown, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(v || "")) ? String(v) : fallback;
}

/**
 * Strict, matching outOfStock() on the till: a catalogue carrying the string "false" must
 * not read as out of stock, and a missing entry must.
 */
export function outOfStock(item: unknown): boolean {
  const i = item as { soldOut?: unknown } | null | undefined;
  return !i || i.soldOut === true || i.soldOut === "true";
}

/**
 * A scent, in one size. `soldOut` on the scent means every size of it; `soldOutSizes` is
 * the finer answer (out in the large box, still there in the small). A null size asks
 * about the scent as a whole, which is what a market that does not carry that size gets.
 */
export function scentOut(scent: Scent, sizeId: string | null | undefined): boolean {
  if (outOfStock(scent)) return true;
  if (!sizeId) return false;
  const list = Array.isArray(scent.soldOutSizes) ? scent.soldOutSizes : [];
  return list.indexOf(sizeId) > -1;
}

/** This market's price entry for an id, or { now: 0, was: 0 }. */
export function pick(sizeId: unknown): Price {
  const p = ((LM.c && LM.c.prices) || {})[String(sizeId)];
  return p || { now: 0, was: 0 };
}

export function byCode(code: unknown): Country | null {
  const list = (LM.cfg && LM.cfg.countries) || [];
  for (let i = 0; i < list.length; i++) if (list[i]!.code === code) return list[i]!;
  return null;
}

/** The market's code, upper case ("" without a market). */
export function codeOf(c: Country | null | undefined): string {
  return String((c && c.code) || "").toUpperCase();
}
