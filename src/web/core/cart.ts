/**
 * (v336) THE ONE SAFE READ OF THE BASKET. Each page parsed lm_cart itself with
 * `JSON.parse(...) || []`, so a saved null line or a non-array threw inside the first
 * render and the product page drew no sizes at all. Kept: object lines with a string
 * sizeId and a whole qty of 1 or more ("2" is read as 2, so "2" + 1 is never "21"). The
 * stored basket is repaired once at load, so code that still parses it reads a clean one.
 */
import type { CartLine, LmApi } from "./types";

export const K_CART = "lm_cart";

export function cleanCart(v: unknown): CartLine[] {
  if (!Array.isArray(v)) return [];
  return v.filter((l: unknown) => {
    if (!l || typeof l !== "object" || Array.isArray(l)) return false;
    const line = l as Record<string, unknown>;
    if (typeof line.sizeId !== "string" || !line.sizeId) return false;
    const q = typeof line.qty === "string" && /^\d+$/.test(line.qty) ? Number(line.qty) : line.qty;
    if (typeof q !== "number" || !Number.isFinite(q) || q < 1 || Math.floor(q) !== q) return false;
    line.qty = q;
    return true;
  }) as CartLine[];
}

export const cart: Pick<LmApi, "readCart"> = {
  readCart() {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(K_CART);
    } catch {
      return [];
    }
    if (!raw) return [];
    try {
      return cleanCart(JSON.parse(raw));
    } catch {
      return [];
    }
  },
};

/** repair the stored basket once, at load */
export function repairCart(): void {
  try {
    const raw = sessionStorage.getItem(K_CART);
    if (raw == null) return;
    let v: unknown = null;
    try {
      v = JSON.parse(raw);
    } catch {
      /* junk: cleaned to nothing */
    }
    const c = cleanCart(v);
    const next = JSON.stringify(c);
    if (next === raw) return;
    if (c.length) sessionStorage.setItem(K_CART, next);
    else sessionStorage.removeItem(K_CART);
  } catch {
    /* storage blocked */
  }
}
