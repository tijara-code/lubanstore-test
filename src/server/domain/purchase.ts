/**
 * A SALE, TOLD TO META, SNAP AND GA4 — once, in one shape, from whichever path confirmed it
 * (port of the original purchase.js + pixels/capi.js + the GA4 half of pixels/ga4.js).
 *
 * Every path that sees the money calls this: the cash till, the card's return (pay-verify),
 * Thawani's webhook, a reminder link confirmed as cash. Each asks for the claim `purchase-<id>`:
 * the first reports, the rest stand aside (a database that cannot be asked reports anyway — the
 * platforms fold a repeat by the order id; losing the sale is the worse error).
 *
 * The event id is the order id on every platform — what the browser pixel sends too — so each
 * platform keeps one copy. The value is the order's own OMR total (3 dp), never a figure from a
 * request; line prices go in OMR at the order's rate.
 *
 * The request context: the shopper's own request when there is one (`live`), the `client`
 * captured on the order filling what it lacks — and ONLY the captured one on the webhook, whose
 * caller is Thawani (its IP and agent are never the shopper's).
 *
 * GA4 has its own claim (`ga4-<id>`): GA4, unlike Meta and Snap, is not promised to fold a second
 * copy. A failed send marks the claim FAILED (never gives it back, so no path forgets it has to
 * send), and the next path that confirms the sale takes a failed claim over and sends.
 *
 * Never throws: the money is already recorded.
 */
import { and, eq } from "drizzle-orm";
import { r3 } from "../../shared/money";
import { CATEGORY, BRAND, CURRENCY } from "../../shared/pixels/catalogue";
import { clickId, gaCid, gaSid, isHash, normPhone, phoneId, splitName, type PixelUser } from "../../shared/pixels/identity";
import type { ClientSignals, OrderLine } from "../../shared/orders/types";
import type { Deps } from "../core/deps";
import { claim, markClaim } from "../core/ops";
import { claims, type OrderRow } from "../db/schema";
import type { EventItem, EventSpec } from "./pixels/build";
import { sendGa4, sendMeta, sendSnap } from "./pixels/send";

/** The request that confirmed the purchase (the shopper's own request when there is one). */
export interface LiveRequest {
  ip?: string;
  ua?: string;
  url?: string;
  /** fresh signals from this request's page (the cash till has them), over the stored ones */
  signals?: ClientSignals;
}

export interface PurchaseReport {
  /** who sends GA4's purchase: the server did (or will), or the page must */
  ga4: "server" | "page";
  /** this call sent Meta/Snap (false: another path already had) */
  reported?: boolean;
}

/** The order's lines as both platforms take them: id, quantity, OMR unit price at the order's rate. */
export function itemsOmr(items: readonly OrderLine[] | null | undefined, rate: number): EventItem[] {
  const k = Number(rate) > 0 ? Number(rate) : 1;
  return (Array.isArray(items) ? items : []).map((i) => {
    const p = Number(i && i.price);
    return {
      id: String((i && i.itemId) || ""),
      qty: Number(i && i.qty) || 1,
      price: i && i.price != null && Number.isFinite(p) ? r3(p * k) : null,
    };
  });
}

/** The customer, once, for every platform: one set of normalisers, external_id = [phone hash, visitor id]. */
export async function customerOf(row: Pick<OrderRow, "name" | "phone" | "phoneKey" | "email" | "city" | "region" | "countryCode"> | Record<string, any>, vid?: unknown): Promise<PixelUser> {
  const r = row as Record<string, any>;
  const { firstName, lastName } = splitName(r.name);
  /* the international digits the CRM keys on; the stored phone when there is no key */
  const phone = r.phoneKey || r.phone_key || (normPhone(r.phone) ?? r.phone) || "";
  return {
    phone,
    email: r.email || "",
    firstName,
    lastName,
    city: r.city || "",
    region: r.region || "",
    country: r.countryCode || r.country_code || "",
    externalId: [await phoneId(phone), isHash(vid) ? (vid as string) : ""],
  };
}

function clientOf(order: OrderRow): ClientSignals {
  const c = order && order.client;
  return c && typeof c === "object" ? c : {};
}

/** The page the sale happened on: the one captured at checkout, else the checkout page. */
function urlOf(deps: Deps, order: OrderRow, live?: LiveRequest): string {
  const c = clientOf(order);
  const ok = (u: unknown) => typeof u === "string" && /^https?:\/\//i.test(u) ? u : "";
  const site = deps.env.siteUrl;
  return ok(live?.signals?.url) || ok(c.url) || ok(live?.url) || (site ? site + "/checkout.html" : "");
}

/** A failed GA4 claim taken over, on the row as read: two paths racing for it get it once. */
async function takeOverFailed(deps: Deps, key: string): Promise<boolean> {
  const rows = await deps.db
    .update(claims)
    .set({ state: "taken", at: new Date(deps.now()) })
    .where(and(eq(claims.key, key), eq(claims.state, "failed")))
    .returning({ key: claims.key });
  return rows.length === 1;
}

async function ga4Claim(deps: Deps, id: string): Promise<boolean> {
  const key = "ga4-" + id;
  try {
    if (await claim(deps.db, key, new Date(deps.now()))) return true;
    return await takeOverFailed(deps, key);
  } catch {
    /* a database that cannot be asked is not a reason to drop the sale */
    return true;
  }
}

function anonCid(now: number): string {
  let n = 0;
  try {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    n = a[0]! % 2147483647;
  } catch {
    n = Math.floor(Math.random() * 2147483647);
  }
  return n + "." + Math.floor(now / 1000);
}

async function ga4Purchase(deps: Deps, order: OrderRow, items: EventItem[], sig: ClientSignals): Promise<void> {
  if (!deps.services.pixels.ga4.configured() || !order.id) return;
  if (!(await ga4Claim(deps, order.id))) return;
  const now = deps.now();
  const params: Record<string, unknown> = {
    transaction_id: String(order.id),
    value: r3(order.omr) || 0,
    currency: CURRENCY,
    items: items.map((i) => {
      const parts = String(i.id || "").split("-");
      return {
        item_id: String(i.id || ""),
        item_name: String(i.id || ""),
        item_brand: BRAND,
        item_category: CATEGORY,
        item_variant: parts.length > 1 ? parts[parts.length - 1] : undefined,
        price: Number(i.price) || 0,
        quantity: Number(i.qty) || 1,
      };
    }),
    /* both needed for the sale to show in the standard reports and join its visit */
    engagement_time_msec: 1,
  };
  const s = gaSid(sig.gsid);
  if (s) params.session_id = s;
  if (order.pay) params.payment_type = order.pay === "card" ? "card" : "cod";
  const r = await sendGa4(deps, {
    client_id: gaCid(sig.gcid) || anonCid(now),
    timestamp_micros: now * 1000,
    events: [{ name: "purchase", params }],
  });
  if (!r.ok) {
    try { await markClaim(deps.db, "ga4-" + order.id, "failed"); } catch { /* one lost copy, never two */ }
  }
}

export async function reportPurchase(deps: Deps, order: OrderRow, live?: LiveRequest): Promise<PurchaseReport> {
  let ga4: "server" | "page" = "page";
  try { ga4 = deps.services.pixels.ga4.configured() ? "server" : "page"; } catch { ga4 = "page"; }
  if (!order || !order.id) return { ga4 };
  let reported = false;
  try {
    let mine = true;
    try { mine = await claim(deps.db, "purchase-" + order.id, new Date(deps.now())); } catch { mine = true; }

    const stored = clientOf(order);
    const sig: ClientSignals = { ...stored, ...(live?.signals || {}) };
    for (const k of Object.keys(sig)) if (sig[k] === undefined || sig[k] === null || sig[k] === "") sig[k] = stored[k];
    const items = itemsOmr(order.items, order.omrRate);

    const jobs: Array<Promise<unknown>> = [ga4Purchase(deps, order, items, sig).catch(() => {})];
    if (mine) {
      reported = true;
      const who = await customerOf(order, sig.vid);
      const request: EventSpec["request"] = {};
      const ip = String(live?.ip || stored.ip || "").trim();
      const ua = String(live?.ua || stored.ua || "").trim();
      if (ip) request.client_ip_address = ip;
      if (ua) request.client_user_agent = ua;
      const spec: Omit<EventSpec, "name"> = {
        id: order.id,
        orderId: order.id,
        time: deps.now(),
        category: CATEGORY,
        url: urlOf(deps, order, live) || undefined,
        currency: CURRENCY,
        value: r3(order.omr) || 0,
        numItems: items.reduce((t, i) => t + (Number(i.qty) || 1), 0),
        items,
        request,
      };
      jobs.push(
        sendSnap(deps, [{ ...spec, name: "PURCHASE", user: who, scid: String(sig.scid || "") || undefined, sccid: String(sig.sccid || "") || undefined }]),
        /* whole or not at all (clickId): a clipped id stored by an older row is dropped, never sent */
        sendMeta(deps, [{ ...spec, name: "Purchase", user: { ...who, fbp: clickId(sig.fbp), fbc: clickId(sig.fbc) } }]),
      );
    }
    await Promise.all(jobs);
  } catch {
    /* measurement only */
  }
  return { ga4, reported };
}
