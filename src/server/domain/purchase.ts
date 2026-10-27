/**
 * (STUB — owned by the tracking area.) Reports a Purchase to Meta, Snap and GA4 from the
 * server, once per order, with the order id as the event id.
 */
import type { Deps } from "../core/deps";
import type { OrderRow } from "../db/schema";

/** The request that confirmed the purchase (shopper's own request when there is one). */
export interface LiveRequest {
  ip?: string;
  ua?: string;
  url?: string;
}

export interface PurchaseReport {
  /** who sends GA4's purchase: the server did, or the page must */
  ga4: "server" | "page";
}

export async function reportPurchase(deps: Deps, order: OrderRow, live?: LiveRequest): Promise<PurchaseReport> {
  void deps; void order; void live;
  return { ga4: "page" };
}
