/**
 * The shapes the tracking modules publish on `window` (the original's globals, kept by name:
 * other page modules, the core's parked-order queue and the inline head scripts reach them
 * there) and the ones they read (the ad platforms' stubs).
 */
import type { CartLine } from "../core/types";
import type { Landing } from "../../shared/attribution";

/** stats.js's shared queue: one POST to /api/beacon per page (`window.LMBeacon`). */
export interface Beacon {
  /** add one item ({ kind, body }); nothing from a page that is leaving for /en/ */
  queue(kind: string, body: unknown): void;
  /** send what is queued now (the holder's own items first) */
  flush(): void;
  /** hold the batch until `fn`'s owner lets go (or 8 s, or the page is left); `fn` is called first on a flush */
  hold(fn: (() => void) | null): void;
  /** let go of a hold: what waits goes on the usual short timer */
  release(): void;
  /** fill in what queued items of `kind` lacked when they were queued */
  patch(kind: string, fn: (body: Record<string, unknown>) => void): void;
}

/** the first-party events (`window.LMEV`); a no-op for a visitor who opted out (DNT / GPC) */
export interface Lmev {
  track(name: string, item?: string | null, land?: Landing): void;
}

/** an order as the checkout hands it to the Purchase */
export interface PurchaseOrder {
  id: string;
  omr?: number;
  pay?: string;
  phone?: unknown;
  name?: unknown;
  email?: unknown;
  city?: unknown;
  region?: unknown;
  items?: Array<{ itemId: string; qty: number; [k: string]: unknown }>;
  [k: string]: unknown;
}

/** the server's answer to the order / the verify ({ ga4: "server" | "page" } since v314) */
export interface PurchaseTold {
  ga4?: unknown;
  [k: string]: unknown;
}

/** what the order POST carries for the server's copy of the Purchase */
export interface Signals {
  scid?: string;
  sccid?: string;
  fbp?: string;
  fbc?: string;
  gcid?: string;
  gsid?: string;
  vid?: string;
}

/** pixel.js's api (`window.LMPX`) */
export interface Lmpx {
  viewContent(sizeId: string, scentId: string): void;
  addCart(line: CartLine): void;
  startCheckout(): void;
  addPaymentInfo(method: string): void;
  purchase(order: PurchaseOrder, told?: PurchaseTold | null): void;
  landing(): Landing;
  signals(): Signals;
  notePhone(raw: unknown): void;
}

export type SnapFn = (cmd: string, ...args: unknown[]) => void;
export type FbqFn = (cmd: string, ...args: unknown[]) => void;
export type GtagFn = (...args: unknown[]) => void;
