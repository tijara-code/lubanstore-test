/**
 * Small shared pieces of the payments area: the order_events record, the per-order secret,
 * the request signals a server-side Purchase needs, and the order-id/key shapes.
 */
import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { OrderRow } from "../../db/schema";
import { clientIp } from "../../core/http";
import type { ClientSignals } from "../../../shared/orders/types";

/** every order id this shop has issued: LM- and 4 to 12 digits */
export const ORDER_ID = /^LM-\d{4,12}$/;
/** the per-order secret on invoice and reminder links */
export const ORDER_KEY = /^[a-f0-9]{16,64}$/;

export function isOrderId(v: unknown): v is string {
  return typeof v === "string" && ORDER_ID.test(v);
}

export { newInvoiceKey, recordEvent } from "../orders";

/** Constant-time comparison for a secret; an empty value never matches, even another empty one. */
export function sameSecret(a: unknown, b: unknown): boolean {
  const x = Buffer.from(String(a == null ? "" : a));
  const y = Buffer.from(String(b == null ? "" : b));
  if (!x.length || !y.length || x.length !== y.length) {
    timingSafeEqual(x.length ? x : Buffer.from("-"), x.length ? x : Buffer.from("-"));
    return false;
  }
  return timingSafeEqual(x, y);
}

/** "status/payment_status" — how an order stands, for an event's from/to. */
export function standing(o: Pick<OrderRow, "status" | "paymentStatus">): string {
  return o.status + "/" + o.paymentStatus;
}

const cut = (v: unknown, n: number): string | undefined => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return s ? s.slice(0, n) : undefined;
};

/** The shopper's own request, for a Purchase confirmed on it (pay-verify, the reminder link). */
export function liveOf(c: Context, url?: string | null): { ip?: string; ua?: string; url?: string } {
  const out: { ip?: string; ua?: string; url?: string } = {};
  const ip = clientIp(c);
  if (ip) out.ip = ip;
  const ua = cut(c.req.header("user-agent"), 400);
  if (ua) out.ua = ua;
  if (url && /^https?:\/\//i.test(url)) out.url = url.slice(0, 400);
  return out;
}

/**
 * What a card order carries so the confirmation — which happens on the shopper's return or
 * on Thawani's webhook, with no browser — can still name the shopper to Meta, Snap and GA4.
 * `live` is the request's own IP and browser; `signals` what the page sent (cookies, click
 * ids, visitor id). Click ids are kept whole or not at all (a clipped fbc is a wrong one).
 */
export function clientSignals(live: { ip?: string; ua?: string }, signals: ClientSignals | null | undefined, pageUrl: string | null | undefined): ClientSignals {
  const out: ClientSignals = {};
  if (live.ip) out.ip = live.ip.slice(0, 64);
  if (live.ua) out.ua = live.ua.slice(0, 400);
  if (pageUrl && /^https?:\/\//i.test(pageUrl)) out.url = pageUrl.slice(0, 400);
  const s = signals || {};
  for (const k of ["fbp", "fbc", "scid", "sccid", "gcid", "gsid", "vid"] as const) {
    const v = s[k];
    if (typeof v === "string" && v && v.length <= 500) out[k] = v;
  }
  return out;
}
