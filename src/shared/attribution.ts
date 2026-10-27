/**
 * (STUB — owned by the tracking area.) The shop's UTM standard: where a visit or an order
 * came from, as source / medium / campaign (port of the original utm.js + origin.js).
 * Shared by the storefront (the 90-day last touch) and the server (the order's attribution).
 */
import type { Attribution } from "./orders/types";

/** What the page reports about the landing: url, referrer, and the kept last non-direct touch. */
export interface RefInput {
  url?: unknown;
  referrer?: unknown;
  touch?: unknown;
  [k: string]: unknown;
}

export function attribute(ref: RefInput | null | undefined, ownHost: string): Attribution {
  void ref; void ownHost;
  return { source: "(direct)", medium: "(none)", how: "direct" };
}

/** One word for where the shopper came from (the admin's Orders column). */
export function originOf(ref: RefInput | null | undefined, ownHost: string): string {
  void ref; void ownHost;
  return "direct";
}
