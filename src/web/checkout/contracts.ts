/**
 * THE CONTRACTS BETWEEN THE PAGE SCRIPTS, as the original's separate files met: through
 * window globals and events. The ports keep them exactly (other modules — the product page,
 * the pixels, the stats — read and write the same names):
 *
 *   window.lmShip(preview)     header: repaint both delivery bars (+ the checkout's rows)
 *   window.lmOnCartChange()    checkout: the basket changed elsewhere, re-read it
 *   window.lmCart              cart: { open, close, refresh, warn }
 *   window.LMPX                pixel: addCart, addPaymentInfo, notePhone, signals, landing,
 *                              purchase, startCheckout
 *   window.LMEV                stats: track(name, label?, extra?)
 *   window.LMLanding()         stats: the landing source (older builds)
 *   "lm:cart"                  cart → product page (the set card's room under the caps)
 *   "lm:country", "lm:stock"   core → everyone
 *
 * Typed here as the shapes these three modules use; read through `G()` at call time, never
 * captured, so a module that sets one later is seen.
 */
import type { CartLine } from "../core/types";

export interface PixelApi {
  addCart?(line: CartLine | Record<string, unknown>): void;
  addPaymentInfo?(pay: string): void;
  notePhone?(phone: string): void;
  signals?(): Record<string, unknown>;
  landing?(): unknown;
  purchase(order: unknown, answer: unknown): void;
  startCheckout(): void;
  [k: string]: unknown;
}

export interface StatsApi {
  track(name: string, label?: string, extra?: unknown): void;
  [k: string]: unknown;
}

export interface CartApi {
  open(): void;
  close(): void;
  refresh(): void;
  /** true when the basket is sellable here; false = the dialog opened, stop */
  warn(): boolean;
}

export interface PageGlobals {
  lmShip?: (preview?: number) => void;
  lmOnCartChange?: () => void;
  lmCart?: CartApi;
  LMPX?: PixelApi;
  LMEV?: StatsApi;
  LMLanding?: () => unknown;
}

/** the window, seen through the contracts above */
export function G(): PageGlobals {
  return window as unknown as PageGlobals;
}

/** the basket's storage key (sessionStorage; the core's shim keeps it in window.name when blocked) */
export const KEY = "lm_cart";

/** write the basket (never throws: storage can be blocked) */
export function writeCart(c: unknown): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage blocked */
  }
}

/** the bin on the summary and drawer lines */
export const TRASH =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 6.4h15.6"/><path d="M9.6 6.4V4.7a1.3 1.3 0 0 1 1.3-1.3h2.2a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="M6.6 6.4 7.4 19a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.8-12.6"/><path d="M10.4 10.4v6.2M13.6 10.4v6.2"/></svg>';

/** resolves once the document is parsed (the original's `dom` promise in header.js / cart.js) */
export function domReady(): Promise<void> {
  return new Promise<void>((r) => {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => r());
    else r();
  });
}
