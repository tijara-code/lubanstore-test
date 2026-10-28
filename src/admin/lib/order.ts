/**
 * WHAT THE PANEL BUILDS FROM AN ORDER: the customer's links (invoice, the /resume card and cash
 * links), the WhatsApp messages (confirmation, payment reminder, win-back, refund note — the
 * original's Arabic, v338/v447 wording kept exactly), the Aramex tracking message, the
 * tracking link, the English name of a line. Pure functions of the order (and the market from
 * the catalogue, for cash on delivery), so they are tested without a page.
 */
import type { OrderListRow } from "../../shared/admin/api";
import type { Country } from "../../shared/catalogue/types";
import type { OrderLine } from "../../shared/orders/types";
import { money, waDigits } from "./format";
import { empowerOf } from "./words";

export type Order = OrderListRow;

const originOf = (origin?: string) => origin ?? (typeof location !== "undefined" ? location.origin : "");

export function orderTotal(o: Pick<Order, "total" | "items">): number {
  if (typeof o.total === "number") return o.total;
  return (o.items || []).reduce((t, i) => t + Number(i.price) * Number(i.qty), 0);
}

/* ---------------- the customer's links ---------------- */

/** Absolute: it is pasted into WhatsApp and must work from someone else's phone. */
export function invoiceUrl(o: Order, origin?: string): string {
  const k = String(o.invoiceKey || "");
  if (!k) return "";
  return originOf(origin) + "/invoice/" + encodeURIComponent(o.id) + "?k=" + encodeURIComponent(k);
}
export function resumeUrl(o: Order, origin?: string): string {
  const k = String(o.invoiceKey || "");
  if (!k) return "";
  return originOf(origin) + "/resume/" + encodeURIComponent(o.id) + "?k=" + encodeURIComponent(k);
}
/** Only for an order that once had a card session: /resume charges the amount recorded then. */
export function payUrl(o: Order, origin?: string): string {
  return Number(o.amountBaisa) >= 100 ? resumeUrl(o, origin) : "";
}
/** Empty for a market with cash on delivery switched off (the link would land on a refusal). */
export function codUrl(o: Order, country?: Pick<Country, "codOn"> | null, origin?: string): string {
  if (country && country.codOn === false) return "";
  const u = resumeUrl(o, origin);
  return u ? u + "&cod=1" : "";
}
/** What the courier would collect if this order became cash on delivery (the fee once). */
export function codTotal(o: Order, country?: Pick<Country, "cod"> | null): number {
  if (o.pay === "cod" || o.paymentStatus === "cod") return orderTotal(o);
  return orderTotal(o) + (country ? Number(country.cod) || 0 : 0);
}

/* ---------------- the WhatsApp messages ---------------- */

export type Phase = "paid" | "refunded" | "cod" | "expired" | "abandoned";

/** Which message this order is owed. */
export function orderPhase(o: Pick<Order, "paymentStatus" | "refunded" | "status">): Phase {
  if (o.paymentStatus === "paid") return "paid";
  if (o.paymentStatus === "refunded" || o.refunded) return "refunded";
  if (o.paymentStatus === "cod") return o.status === "void" ? "expired" : "cod";
  return o.status === "void" ? "expired" : "abandoned";
}

export const WA_LABEL: Record<Phase, string> = {
  paid: "Confirmation",
  cod: "Confirmation",
  abandoned: "Payment reminder",
  expired: "Win-back message",
  refunded: "Refund note",
};

function hello(o: Order): string {
  const first = String(o.name || "").trim().split(/\s+/)[0] || "";
  return first ? "أهلا " + first + "،" : "أهلا بك،";
}

/** The message, in the original's Arabic (admin.js waMessage). */
export function waMessage(o: Order, opts: { country?: Pick<Country, "codOn" | "cod"> | null; origin?: string } = {}): string {
  const hi = hello(o);
  const phase = orderPhase(o);
  let lines: Array<string | null>;
  if (phase === "refunded") {
    lines = [
      "LUBAN & MUSK 🌿",
      "",
      hi,
      "تم استرداد مبلغ طلبك.",
      "",
      "رقم الطلب: " + o.id,
      "المبلغ: " + money(orderTotal(o), o.cur),
      "",
      "قد يستغرق ظهوره في حسابك بضعة أيام حسب البنك.",
      "",
      "لأي استفسار راسلنا هنا في أي وقت 🙏",
    ];
  } else if (phase === "abandoned" || phase === "expired") {
    const pay = payUrl(o, opts.origin);
    const cod = codUrl(o, opts.country, opts.origin);
    lines = [
      "LUBAN & MUSK 🌿",
      "",
      hi,
      phase === "expired" ? "انتهت مهلة دفع طلبك، ويمكننا إعادة تفعيله الآن." : "طلبك محفوظ عندنا ولم يكتمل الدفع.",
      "",
      "رقم الطلب: " + o.id,
      "الإجمالي: " + money(orderTotal(o), o.cur),
      "",
      pay ? "للدفع بالبطاقة:\n" + pay : null,
      cod ? "\nأو الدفع عند الاستلام (" + money(codTotal(o, opts.country), o.cur) + ") — أكد طلبك من هنا:\n" + cod : null,
      pay || cod ? "" : null,
      "المنتج متوفر ومحجوز لك.",
      "",
      "لأي استفسار راسلنا هنا في أي وقت 🙏",
    ];
  } else {
    const url = invoiceUrl(o, opts.origin);
    lines = [
      "شكرا لطلبك من LUBAN & MUSK 🌿",
      "",
      hi,
      phase === "cod" ? "تم تأكيد طلبك وجاري تجهيزه." : "استلمنا طلبك وجاري تجهيزه.",
      "",
      "رقم الطلب: " + o.id,
      phase === "cod" ? "المبلغ عند الاستلام: " + money(orderTotal(o), o.cur) : "الإجمالي: " + money(orderTotal(o), o.cur),
      "",
      o.countryCode === "OM" ? "يصلك خلال 48-72 ساعة." : "يصلك خلال 3-5 أيام عمل.",
      url ? "\nفاتورتك:\n" + url : null,
      "",
      "لأي استفسار راسلنا هنا في أي وقت 🙏",
    ];
  }
  return lines.filter((l): l is string => l !== null).join("\n");
}

/* ---------------- tracking ---------------- */

export const ARAMEX_TRACK = "https://www.aramex.com/track/results?ShipmentNumber=";

/** The Aramex waybill of the order's Empower parcel ("" when none). */
export function trackingOf(o: Order): string {
  const s = empowerOf(o);
  if (!s) return "";
  return String(s.awb || o.tracking || "").trim();
}

/** The apology for the wait, with the number and a link to follow it (v338). */
export function trackMessage(o: Order, awb: string): string {
  return [
    "LUBAN & MUSK 🌿",
    "",
    hello(o),
    "نعتذر عن تأخر وصول طلبك، ونشكرك على صبرك 🙏",
    "طلبك الآن مع أرامكس في الطريق إليك.",
    "",
    "رقم الطلب: " + o.id,
    "رقم الشحنة (أرامكس): " + awb,
    "",
    "تتبع طلبك من هنا:",
    ARAMEX_TRACK + encodeURIComponent(awb),
    "",
    "لأي استفسار راسلنا هنا في أي وقت 🙏",
  ].join("\n");
}

export interface TrackLink {
  url: string;
  label: string;
  title: string;
}

/**
 * The tracking page for the order, one tap (v408, v419): an Empower parcel with its waybill →
 * Aramex, never for Oman (inventory ruling 21); an order shipped by hand with a tracking
 * number → the shop's own tracking page (/?track=<id>).
 */
export function trackLinkOf(o: Order, origin?: string): TrackLink | null {
  const oman = String(o.countryCode || "").toUpperCase() === "OM";
  const e = empowerOf(o);
  if (e) {
    if (oman) return null;
    const a = trackingOf(o);
    return a ? { url: ARAMEX_TRACK + encodeURIComponent(a), label: "Track on Aramex", title: "Track " + a + " on Aramex" } : null;
  }
  if (String(o.tracking || "").trim() && (o.status === "ship" || o.status === "done")) {
    return { url: originOf(origin) + "/?track=" + encodeURIComponent(o.id), label: "Tracking page", title: "The shop's tracking page for " + o.id };
  }
  return null;
}

/** wa.me with the text filled in; "" without a phone. */
export function waLink(phone: unknown, text: string): string {
  const d = waDigits(phone);
  return d.length >= 7 ? "https://wa.me/" + d + "?text=" + encodeURIComponent(text) : "";
}

/* ---------------- lines ---------------- */

const EN_SCENT: Record<string, string> = { oud: "Oud", lemon: "Lemon", amber: "Amber" };
const EN_SIZE: Record<string, string> = { large: "Large", small: "Small" };
const EN_EXTRA: Record<string, string> = { burner: "Incense Burner", samples: "Sample Set" };

/** "Oud · Large", "3-scent bundle", "Oud ×2 · Amber · Large", "Incense Burner"; "" when unknown (test-admin-data itemEn). */
export function itemEn(line: Pick<OrderLine, "itemId">): string {
  const id = String(line.itemId || "");
  if (id === "bundle") return "3-scent bundle";
  if (id === "bundle2") return "3-scent bundle large";
  const tm = /^(duo|trio):([a-z0-9_.-]+)$/.exec(id);
  if (tm) {
    const n: Record<string, number> = {};
    for (const k of tm[2]!.split(".")) n[k] = (n[k] || 0) + 1;
    return Object.keys(n).map((k) => (EN_SCENT[k] || k) + (n[k]! > 1 ? " ×" + n[k] : "")).join(" · ") + " · Large";
  }
  if (EN_EXTRA[id]) return EN_EXTRA[id]!;
  const cut = id.lastIndexOf("-");
  if (cut > 0) {
    const s = EN_SCENT[id.slice(0, cut)];
    const z = EN_SIZE[id.slice(cut + 1)];
    if (s) return s + (z ? " · " + z : "");
  }
  return "";
}

/** A line as the order stores it: "عود · كبير" (Arabic, as the shopper chose). */
export function lineName(l: OrderLine): string {
  return [l.scent, l.size].filter(Boolean).join(" · ");
}
