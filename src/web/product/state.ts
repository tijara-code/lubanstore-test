/**
 * The product page's state (the port of main.js's closure variables) and the few helpers
 * every part of the page shares. ES modules cannot reassign another module's binding, so
 * what main.js reassigned (SIZES, SCENTS, QTY, PICK) lives on the one `P` object.
 */
import { LM } from "../core";
import type { CartLine } from "../core";

/** a size as the page draws it (ingest(): every string escaped, ids slugs, colours hex) */
export interface PSize {
  id: string;
  name: string;
  weight: string;
  tag: string;
  tagColor: string;
  soldOut: boolean;
  open: boolean;
}

/** a scent as the page draws it (ingest()) */
export interface PScent {
  id: string;
  name: string;
  notes: string;
  accent: string;
  art: string;
  tag: string;
  tagColor: string;
  stars: number;
  soldOut: boolean;
  soldOutSizes: string[];
}

/** the chosen size (null until one is opened), the gallery frame, the chosen large row, the set chosen (v403) */
export const st: { size: PSize | null; slide: number; tier: string | null; set: boolean } = {
  size: null,
  slide: 0,
  tier: null,
  set: false,
};

/** what main.js reassigned: the market's sizes and scents, the counts, each open size's panel */
export const P: {
  SIZES: PSize[];
  SCENTS: PScent[];
  /** sizeId -> { scentId -> quantity } */
  QTY: Record<string, Record<string, number>>;
  /** each open size's panel, while it is drawn */
  PICK: Record<string, HTMLElement>;
} = { SIZES: [], SCENTS: [], QTY: {}, PICK: {} };

export function qOf(sizeId: string, scentId: string): number {
  const m = P.QTY[sizeId];
  return (m && m[scentId]) || 0;
}

/* one fixed gallery — the scent choice never swaps the photos.
   Gallery order: the white box open, the resin close-up, then the closed white box between
   the brass blocks (v205). The duo and the red box left the gallery then; they are still the
   bundle's and the small box's packshots — in the size tiles, the basket and the delivery
   suggestion — just not frames here. Selecting a size jumps to that size's frame. */
export const IMAGES = ["white-box-open", "resin-macro", "box-front"];

/* Which frame each size owns. Large is the white box (frame 1). The small box and the bundle
   have no frame of their own since v205, so choosing one leaves the gallery where it is. */
export const SIZE_SLIDE: Record<string, number> = { large: 0 };

export const KEY = "lm_cart";

/** document.querySelector, typed loosely the way the page uses it */
export function $<T extends Element = HTMLElement>(s: string): T | null {
  return document.querySelector(s) as T | null;
}

/** the store's one safe basket reader (v336) */
export function read(): CartLine[] {
  return LM.readCart();
}

export function rtl(): boolean {
  return getComputedStyle(document.documentElement).direction === "rtl";
}

/** (v440) the phone's layout, where the owner's v440 grid rules apply */
export function phoneGrid(): boolean {
  return !!(window.matchMedia && window.matchMedia("(max-width: 767px)").matches);
}

/* ---- the other page scripts, met only through their window globals (as in the original) ---- */
export interface PageGlobals {
  /** pixel.js */
  LMPX?: { addCart?: (line: CartLine) => void; viewContent?: (sizeId: string, scentId: string) => void; [k: string]: unknown };
  /** stats.js — the first-party events */
  LMEV?: { track?: (name: string, item?: string) => void; [k: string]: unknown };
  /** cart.js — the drawer */
  lmCart?: { refresh?: () => void; [k: string]: unknown };
  /** header.js — the delivery band, with the page's preview amount */
  lmShip?: (amount: number) => void;
}
export function G(): PageGlobals {
  return window as unknown as PageGlobals;
}
