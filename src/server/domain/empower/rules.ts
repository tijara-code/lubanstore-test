/**
 * Empower's pure rules: who carries a market, what a parcel's status words mean, the order
 * as Omniful's Create Order call takes it, and the ids an order is sent under. No network,
 * no database.
 */
import { r3 } from "../../../shared/money";
import { DIAL, nationalDigits } from "../../../shared/orders/phone";
import { isLive, type MovableOrder } from "../../../shared/orders/status";
import type { Catalogue } from "../../../shared/catalogue/types";
import type { OrderRow } from "../../db/schema";
import { cityEnglish } from "./cities";
import type { WarehouseLine } from "./lines";

/* ---------------- who carries a market ---------------- */

/**
 * SMSA and the Oman local courier are gone: a market is shipped by Empower ("omniful") or
 * by hand ("manual": a person moves it through the status flow with a tracking number).
 * A market with no route, or one the catalogue names wrongly, is EMPOWER'S — the live shop
 * had all six markets on Omniful, and Empower is the main shipping route.
 */
export const OMNIFUL = "omniful";
export const MANUAL = "manual";
export const COURIERS = [OMNIFUL, MANUAL] as const;
export type Courier = (typeof COURIERS)[number];
export const DEFAULT_COURIER: Courier = OMNIFUL;
export const LABEL: Record<Courier, string> = { omniful: "Empower (Omniful)", manual: "Shipped by hand" };

function asCourier(v: unknown): Courier | null {
  const want = String(v || "").trim().toLowerCase();
  return (COURIERS as readonly string[]).indexOf(want) > -1 ? (want as Courier) : null;
}

export function courierFor(countryCode: unknown, cfg: Catalogue | null | undefined): Courier {
  const cc = String(countryCode || "").trim().toUpperCase();
  const row = ((cfg && cfg.countries) || []).find((c) => String((c && c.code) || "").toUpperCase() === cc);
  return asCourier(row && row.courier) || DEFAULT_COURIER;
}

export function isEmpowerMarket(countryCode: unknown, cfg: Catalogue | null | undefined): boolean {
  return courierFor(countryCode, cfg) === OMNIFUL;
}

export interface MarketRoute {
  code: string;
  name: string;
  courier: Courier;
  /** false = nobody chose this; it is the default */
  chosen: boolean;
}

export function routing(cfg: Catalogue | null | undefined): MarketRoute[] {
  return ((cfg && cfg.countries) || []).map((c) => {
    const set = asCourier(c && c.courier);
    const code = String((c && c.code) || "").toUpperCase();
    return { code, name: String((c && c.name_en) || (c && c.name) || code), courier: set || DEFAULT_COURIER, chosen: !!set };
  });
}

/** The two-letter codes of the markets Empower ships. */
export function empowerMarkets(cfg: Catalogue | null | undefined): string[] {
  return routing(cfg).filter((r) => r.courier === OMNIFUL && /^[A-Z]{2}$/.test(r.code)).map((r) => r.code);
}

/** A parcel at all: not binned, cancelled, awaiting its card money, or refunded. */
export function shippable(o: MovableOrder): boolean {
  return isLive(o);
}

/* ---------------- what a parcel's status words mean ---------------- */

export type Stage = "created" | "picked" | "transit" | "attempt" | "delivered" | "failed" | "returned";

/** stage → what the shopper is shown; step -1 = stopped rather than progressed */
export const STAGES: Record<Stage, { step: number; ar: string }> = {
  created: { step: 0, ar: "تم استلام الطلب" },
  picked: { step: 1, ar: "استلمته شركة الشحن" },
  transit: { step: 2, ar: "في الطريق إليك" },
  attempt: { step: 2, ar: "محاولة تسليم" },
  delivered: { step: 3, ar: "تم التسليم" },
  failed: { step: -1, ar: "تعذر التسليم — سنتواصل معك" },
  returned: { step: -1, ar: "أعيدت الشحنة" },
};

const RULES: Array<[RegExp, Stage]> = [
  /* (v447) a delivery that did NOT happen is read first, and a return is a return */
  [/undeliver|not deliver|fail(ed)? (to )?deliver|deliver(y)? (attempt )?fail|unable to deliver/, "failed"],
  [/return|\brto\b/, "returned"],
  [/deliver(ed)?$|^delivered/, "delivered"],
  [/out for delivery|with courier|dispatch/, "transit"],
  [/refus|cancel|undeliver/, "failed"],
  [/no response|no answer|awaiting consignee/, "attempt"],
  [/picked ?up|collected|in transit|received at|departed|arrived|shipped/, "picked"],
  [/info received|created|manifest|booked/, "created"],
];

export function stageOf(carrierStatus: unknown): Stage {
  const s = String(carrierStatus || "").trim().toLowerCase().replace(/_/g, " ");
  if (!s) return "created";
  for (const [re, stage] of RULES) if (re.test(s)) return stage;
  return "created";
}

export function shown(carrierStatus: unknown): { stage: Stage; step: number; text: string } {
  const stage = stageOf(carrierStatus);
  return { stage, step: STAGES[stage].step, text: STAGES[stage].ar };
}

/** The order status a parcel's stage implies (failed / returned imply nothing: a person looks). */
export const IMPLIED: Partial<Record<Stage, "ship" | "done">> = { picked: "ship", transit: "ship", attempt: "ship", delivered: "done" };
/** a parcel that is over: not asked about again */
export function finished(status: unknown, deliveredAt: unknown): boolean {
  if (deliveredAt) return true;
  return /cancel|return|\brto\b/i.test(String(status || ""));
}

/* ---------------- the ids an order is sent under ---------------- */

/** Omniful takes an order_id once, ever: a re-send goes as LM-…-2, -3. */
export function baseId(sentId: unknown): string {
  const m = /^(LM-\d{4,12})(?:-\d{1,3})?$/.exec(String(sentId || "").trim());
  return m ? m[1]! : String(sentId || "").trim();
}

export function nextSentId(orderId: string, spent: readonly string[] | null | undefined, now: number): string {
  const used = new Set(spent || []);
  if (!used.has(orderId)) return orderId;
  for (let n = 2; n < 100; n++) if (!used.has(orderId + "-" + n)) return orderId + "-" + n;
  return orderId + "-" + now.toString(36);
}

/** our shipment row's key: the id it was SENT as */
export function rowKey(sentId: string): string {
  return "omf-" + String(sentId || "").trim();
}

export function isOrderId(v: unknown): v is string {
  return typeof v === "string" && /^LM-\d{4,12}$/.test(v);
}

/** Omniful saying the id is taken: a 4xx about the ORDER (id) being there already — not a SKU. */
export function isDuplicate(e: { status?: number | null; message?: string } | null | undefined): boolean {
  if (!e || !(Number(e.status) >= 400 && Number(e.status) < 500)) return false;
  const m = String(e.message || "");
  return /order/i.test(m) && !/sku/i.test(m) && /already|exist|duplicat|unique|in use|been used|taken/i.test(m);
}

/* ---------------- the order, as Create Order takes it ---------------- */

/** full names: their `country` must match the code beside it */
export const COUNTRY_NAMES: Record<string, string> = {
  AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait", BH: "Bahrain", OM: "Oman",
};

/** "+971 50 123 4567" → { code: "+971", number: "501234567" } */
export function splitPhone(phone: unknown, countryCode?: unknown): { code: string; number: string } {
  const raw = String(phone == null ? "" : phone).trim();
  const m = /^\+(\d{1,4})[\s-]+(.+)$/.exec(raw);
  if (m) return { code: "+" + m[1], number: m[2]!.replace(/\D/g, "") };
  /* no "+code " prefix: the market's dial code and the national digits */
  const dial = DIAL[String(countryCode || "").toUpperCase()];
  if (dial) return { code: "+" + dial, number: nationalDigits(raw, countryCode) };
  return { code: "", number: raw.replace(/\D/g, "") };
}

export function splitName(name: unknown): { first: string; last: string } {
  const parts = String(name == null ? "" : name).trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || "Customer", last: parts.slice(1).join(" ") };
}

export class EmpowerRuleError extends Error {
  constructor(readonly code: "omniful_no_hub" | "omniful_no_lines", message: string) {
    super(message);
    this.name = "EmpowerRuleError";
  }
}

type BodyOrder = Pick<OrderRow, "id" | "name" | "phone" | "email" | "country" | "countryCode" | "city" | "region" | "note" | "cur" | "total" | "paymentStatus" | "pay" | "origin" | "refunded">;

/**
 * POST /sales-channel/public/v1/orders. Required: order_id, hub_code, order_items[{sku_code,
 * selling_price, quantity}], billing/shipping address {address1, city, country}, invoice
 * {currency, total}, customer {id, first_name}, payment_method, is_cash_on_delivery, type.
 *
 * MONEY: items + shipping − discount = total. Shipping is everything the customer pays beyond
 * the items (delivery + the cash fee); a hand-typed amount below the items (a WhatsApp price)
 * is the discount. A refunded order is never cash on delivery.
 */
export function orderBody(o: BodyOrder, lines: WarehouseLine[], hub: string, sentId?: string): Record<string, any> {
  const s = (v: unknown, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  if (!String(hub || "").trim()) {
    throw new EmpowerRuleError("omniful_no_hub", "No warehouse is set — add OMNIFUL_HUB_CODE (your hub code in Omniful) and redeploy.");
  }
  if (!lines.length) throw new EmpowerRuleError("omniful_no_lines", "This order has nothing on it the warehouse can pick.");

  const cc = s(o.countryCode, 2).toUpperCase();
  const phone = splitPhone(o.phone, cc);
  const who = splitName(o.name);
  const city = cityEnglish(o.city) || s(o.city, 80);
  const area = s(o.region, 200);
  const address = {
    address1: area || city,
    city,
    country: COUNTRY_NAMES[cc] || s(o.country, 60),
    country_code: cc,
    first_name: who.first,
    last_name: who.last,
    phone: (phone.code ? phone.code + "-" : "") + phone.number,
    area,
    /* Oman's "city" is its governorate — the state, to them */
    state: cc === "OM" ? city : "",
  };

  const total = r3(Number(o.total) || 0);
  const subtotal = r3(lines.reduce((t, l) => t + (Number(l.item_total) || 0), 0));
  const refunded = o.paymentStatus === "refunded" || o.refunded === true;
  const paid = o.paymentStatus === "paid";
  const cod = !paid && !refunded;

  const body: Record<string, any> = {
    order_id: s(sentId || o.id, 60),
    hub_code: String(hub).trim(),
    order_items: lines.map((l) => ({
      sku_code: s(l.seller_sku_code, 120),
      name: s(l.name, 200),
      display_price: r3(Number(l.display_price) || Number(l.unit_price) || 0),
      selling_price: r3(Number(l.unit_price) || 0),
      is_substituted: false,
      quantity: Math.max(1, Math.floor(Number(l.quantity)) || 1),
      tax_percent: 0,
      tax: 0,
      unit_price: r3(Number(l.unit_price) || 0),
      subtotal: r3(Number(l.item_total) || 0),
      total: r3(Number(l.item_total) || 0),
      discount: 0,
      tax_inclusive: true,
    })),
    billing_address: address,
    shipping_address: address,
    invoice: {
      currency: s(o.cur, 3).toUpperCase(),
      subtotal,
      shipping_price: r3(Math.max(0, total - subtotal)),
      shipping_refund: 0,
      tax: 0,
      discount: r3(Math.max(0, subtotal - total)),
      total,
      total_paid: cod ? 0 : total,
      total_due: cod ? total : 0,
      total_refunded: 0,
      payment_mode: paid ? (o.pay === "card" ? "card" : "bank transfer") : refunded ? "card" : "cash",
      tax_percent: 0,
      shipping_tax: 0,
      sub_total_tax_inclusive: true,
      sub_total_discount_inclusive: true,
      shipping_tax_inclusive: true,
      shipping_discount_inclusive: true,
    },
    customer: {
      /* ours, stable per person: the same phone is the same customer */
      id: "LM-" + (phone.number.slice(-9) || s(o.id, 60)),
      first_name: who.first,
      last_name: who.last,
      mobile: phone.number,
      mobile_code: phone.code,
      email: s(o.email, 120),
    },
    payment_method: cod ? "postpaid" : "prepaid",
    is_cash_on_delivery: cod,
    type: "b2c",
    delivery_type: "normal_delivery",
    note: s(o.note, 500),
    labels: [String(o.origin || "") === "whatsapp_order" ? "whatsapp" : "website"],
  };
  if (!body.customer.email) delete body.customer.email;
  if (!body.note) delete body.note;
  return body;
}
