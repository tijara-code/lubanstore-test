/**
 * The admin's order helpers: the WhatsApp messages and links, the tracking message and link,
 * the English item names, the status words (src/admin/lib/order.ts, words.ts).
 */
import { describe, expect, it } from "vitest";
import type { OrderListRow } from "../../../src/shared/admin/api";
import {
  ARAMEX_TRACK, codTotal, invoiceUrl, itemEn, orderPhase, payUrl, trackingOf, trackLinkOf, trackMessage, waLink, waMessage, WA_LABEL,
} from "../../../src/admin/lib/order";
import { empStatus, empWord, explain, STATUS_FILTER } from "../../../src/admin/lib/words";
import { ApiError } from "../../../src/admin/data/api";
import { dayLabel, initials, money, splitUnit, waDigits } from "../../../src/admin/lib/format";

const KEY = "0123456789abcdef0123456789abcdef";
const ORIGIN = "https://lubanmusk.com";
const order = (over: Partial<OrderListRow>): OrderListRow =>
  ({ id: "LM-123456", name: "نورة الكندي", invoiceKey: KEY, cur: "AED", total: 250, countryCode: "AE", pay: "card", amountBaisa: 26175, items: [], status: "new", paymentStatus: "unpaid", refunded: false, ...over }) as OrderListRow;
const AE = { cod: 10 };
const msg = (over: Partial<OrderListRow>) => {
  const o = order(over);
  return { msg: waMessage(o, { country: AE, origin: ORIGIN }), phase: orderPhase(o) };
};

describe("the WhatsApp messages", () => {
  // from test-resume.js: the reminder links and which message an order is owed
  it("an abandoned card order: a reminder with the card and cash links, the COD total with the fee", () => {
    const m = msg({ paymentStatus: "unpaid", status: "pending" });
    expect(m.phase).toBe("abandoned");
    expect(m.msg).toMatch(/https:\/\/lubanmusk\.com\/resume\/LM-123456\?k=/);
    expect(m.msg).toMatch(/&cod=1/);
    expect(m.msg).toMatch(/260 AED/);
    expect(m.msg).toMatch(/250 AED/);
    expect(m.msg).not.toMatch(/استلمنا طلبك/);
    expect(m.msg).toMatch(/أهلا نورة/);
    expect(m.msg).toContain("للدفع بالبطاقة:\n" + ORIGIN + "/resume/LM-123456?k=" + KEY);
    expect(m.msg).toContain("\nأو الدفع عند الاستلام (260 AED) — أكد طلبك من هنا:\n" + ORIGIN + "/resume/LM-123456?k=" + KEY + "&cod=1");
    expect(m.msg.startsWith("LUBAN & MUSK 🌿\n\nأهلا نورة،\nطلبك محفوظ عندنا ولم يكتمل الدفع.")).toBe(true);
  });

  it("a cancelled card order: the win-back, both links", () => {
    const m = msg({ paymentStatus: "cancelled", status: "void" });
    expect(m.phase).toBe("expired");
    expect(m.msg).toMatch(/إعادة تفعيله/);
    expect(m.msg).toMatch(/resume\/LM-123456\?k=/);
    expect(m.msg).toMatch(/&cod=1/);
  });

  it("paid: the thank-you with the invoice, never a payment link", () => {
    const m = msg({ paymentStatus: "paid", status: "prep" });
    expect(m.phase).toBe("paid");
    expect(m.msg).toMatch(/استلمنا طلبك/);
    expect(m.msg).toMatch(/\/invoice\/LM-123456\?k=/);
    expect(m.msg).not.toMatch(/\/resume\//);
    expect(m.msg).toContain("يصلك خلال 3-5 أيام عمل.");
    expect(waMessage(order({ paymentStatus: "paid", countryCode: "OM" }), { origin: ORIGIN })).toContain("يصلك خلال 48-72 ساعة.");
  });

  it("cash on delivery: confirmed, what the courier collects, no payment link", () => {
    const m = msg({ paymentStatus: "cod", status: "new", pay: "cod" });
    expect(m.phase).toBe("cod");
    expect(m.msg).toMatch(/تم تأكيد طلبك/);
    expect(m.msg).toMatch(/المبلغ عند الاستلام/);
    expect(m.msg).not.toMatch(/\/resume\//);
    expect(msg({ paymentStatus: "cod", status: "void" }).phase).toBe("expired");
  });

  // from test-audit-fixes.js §6 and test-resume.js: a cash-only order has no card link; the fee once
  it("a cancelled COD order: no card link, its COD link, its own total (the fee not twice)", () => {
    const m = msg({ pay: "cod", amountBaisa: 0, paymentStatus: "cod", status: "void", total: 290 });
    expect(m.msg).not.toMatch(/للدفع بالبطاقة/);
    expect(m.msg).toMatch(/&cod=1/);
    expect(m.msg).toMatch(/\(290 AED\)/);
    expect(m.msg).not.toMatch(/300 AED/);
    const m2 = msg({ pay: "cod", amountBaisa: 0, paymentStatus: "cod", status: "void", total: 260 });
    expect(m2.msg).toMatch(/\(260 AED\)/);
    expect(m2.msg).not.toMatch(/270 AED/);
  });

  it("refunded: told the money went back, never asked to pay", () => {
    const m = msg({ paymentStatus: "refunded", status: "prep", refunded: true });
    expect(m.phase).toBe("refunded");
    expect(m.msg).not.toMatch(/\/resume\//);
    expect(m.msg).toMatch(/تم استرداد/);
  });

  it("no invoice key: no broken half-link; a market without cash on delivery: no COD link (test-cod-refusal)", () => {
    expect(msg({ paymentStatus: "unpaid", status: "pending", invoiceKey: "" }).msg).not.toMatch(/resume/);
    const o = order({ paymentStatus: "unpaid", status: "pending" });
    const noCod = waMessage(o, { country: { codOn: false, cod: 10 }, origin: ORIGIN });
    expect(noCod).not.toMatch(/&cod=1/);
    expect(noCod).toMatch(/للدفع بالبطاقة/);
  });

  it("every phase has a label; payUrl needs a card session; codTotal adds the fee to a card total only", () => {
    expect(Object.keys(WA_LABEL).sort()).toEqual(["abandoned", "cod", "expired", "paid", "refunded"]);
    expect(payUrl(order({ amountBaisa: 0 }), ORIGIN)).toBe("");
    expect(payUrl(order({}), ORIGIN)).toBe(ORIGIN + "/resume/LM-123456?k=" + KEY);
    expect(codTotal(order({}), AE)).toBe(260);
    expect(codTotal(order({ pay: "cod", paymentStatus: "cod", total: 260 }), AE)).toBe(260);
    expect(invoiceUrl(order({}), ORIGIN)).toBe(ORIGIN + "/invoice/LM-123456?k=" + KEY);
  });

  it("the wa.me link carries the international digits and the text", () => {
    expect(waLink("+968 9123 4567", "أهلا")).toBe("https://wa.me/96891234567?text=" + encodeURIComponent("أهلا"));
    expect(waLink("", "x")).toBe("");
    expect(waDigits("٠٠٩٦٨ ٩١٢٣")).toBe("9689123");
  });
});

describe("tracking", () => {
  const ship = (over: Record<string, unknown> = {}) => ({ id: "omf-LM-1", sentId: "LM-1234567890", reference: "OMF1", awb: "44123456789", courier: "Aramex", status: "picked_up", at: "2026-10-01T00:00:00Z", deliveredAt: null, ...over });
  const o = order({ id: "LM-1234567890", name: "Fahad Al Qahtani", tracking: "", countryCode: "AE", status: "ship" });

  // from test-v338.js: the Aramex tracking message
  it("the waybill of an Empower parcel, else the order's; none without a parcel", () => {
    expect(trackingOf({ ...o, shipment: ship() } as OrderListRow)).toBe("44123456789");
    expect(trackingOf({ ...o, tracking: "44999", shipment: ship({ awb: null }) } as OrderListRow)).toBe("44999");
    expect(trackingOf({ ...o, shipment: ship({ awb: null }) } as OrderListRow)).toBe("");
    expect(trackingOf(o)).toBe("");
    expect(trackingOf({ ...o, shipment: ship({ status: "cancelled" }) } as OrderListRow)).toBe("");
  });

  it("the message: the apology, the number, the waybill and the link, greeted by first name", () => {
    const m = trackMessage(o, "44123456789");
    expect(m).toMatch(/نعتذر عن تأخر وصول طلبك/);
    expect(m).toContain("رقم الطلب: LM-1234567890");
    expect(m).toContain("رقم الشحنة (أرامكس): 44123456789");
    expect(m).toContain("تتبع طلبك من هنا:\nhttps://www.aramex.com/track/results?ShipmentNumber=44123456789");
    expect(m.startsWith("LUBAN & MUSK 🌿\n\nأهلا Fahad،\n")).toBe(true);
    expect(trackMessage(order({ id: "LM-1", name: "" }), "1")).toMatch(/\nأهلا بك،\n/);
    expect(ARAMEX_TRACK).toBe("https://www.aramex.com/track/results?ShipmentNumber=");
  });

  // from test-v408.js, test-v418.js, test-v419.js (inventory ruling 21)
  it("the tracking link: Aramex for an Empower parcel with its waybill, never for Oman, none without a waybill", () => {
    const ae = trackLinkOf({ ...o, countryCode: "AE", shipment: ship({ awb: "44123" }) } as OrderListRow, ORIGIN);
    expect(ae).toEqual({ url: "https://www.aramex.com/track/results?ShipmentNumber=44123", label: "Track on Aramex", title: "Track 44123 on Aramex" });
    expect(trackLinkOf({ ...o, countryCode: "OM", shipment: ship() } as OrderListRow, ORIGIN)).toBeNull();
    expect(trackLinkOf({ ...o, shipment: ship({ awb: null }) } as OrderListRow, ORIGIN)).toBeNull();
    expect(trackLinkOf({ ...o, status: "new" }, ORIGIN)).toBeNull();
  });

  it("an order shipped by hand with a tracking number: the shop's own tracking page", () => {
    const l = trackLinkOf({ ...o, tracking: "KW123", carrier: "DHL", countryCode: "KW", status: "ship" }, ORIGIN);
    expect(l && l.url).toBe(ORIGIN + "/?track=LM-1234567890");
    expect(trackLinkOf({ ...o, tracking: "KW123", status: "prep" }, ORIGIN)).toBeNull();
  });
});

describe("names and words", () => {
  // from test-admin-data.js: best sellers in English (itemEn)
  it("itemEn", () => {
    expect(itemEn({ itemId: "oud-large" })).toBe("Oud · Large");
    expect(itemEn({ itemId: "bundle" })).toBe("3-scent bundle");
    expect(itemEn({ itemId: "burner" })).toBe("Incense Burner");
    expect(itemEn({ itemId: "rose-small" })).toBe("");
    expect(itemEn({ itemId: "duo:oud.oud" })).toBe("Oud ×2 · Large");
    expect(itemEn({ itemId: "trio:oud.lemon.amber" })).toBe("Oud · Lemon · Amber · Large");
  });

  // the Orders list's status in Empower's words (v446)
  it("empStatus / empWord", () => {
    const base = { status: "new" } as OrderListRow;
    expect(empStatus({ ...base, status: "pending" })).toBe("Awaiting Payment");
    expect(empStatus({ ...base, status: "void" })).toBe("Cancelled");
    expect(empStatus(base)).toBe("New Order");
    expect(empStatus({ ...base, status: "prep" })).toBe("In Packing");
    const sh = { id: "x", sentId: "x", reference: null, awb: null, courier: null, at: "", deliveredAt: null };
    expect(empStatus({ ...base, status: "prep", shipment: { ...sh, status: "in_picking" } })).toBe("In Picking");
    expect(empStatus({ ...base, status: "ship", shipment: { ...sh, status: "created" } })).toBe("Shipped");
    expect(empStatus({ ...base, status: "done", shipment: { ...sh, status: "picked_up" } })).toBe("Delivered");
    expect(empStatus({ ...base, status: "prep", shipment: { ...sh, status: "return_to_origin" } })).toBe("Return To Origin");
    expect(empWord("out_for_delivery")).toBe("Shipped");
    expect(empWord("on hold")).toBe("On Hold");
    expect(empWord("something new")).toBe("Something New");
  });

  it("the status filter keeps Flagged last (v408)", () => {
    expect(STATUS_FILTER[STATUS_FILTER.length - 1]!.value).toBe("flagged");
  });

  it("refusals in words", () => {
    expect(explain(new ApiError("moving_back", 409))).toMatch(/Moving it back needs a confirmation/);
    expect(explain(new ApiError("stock_short", 409, { item: "oud-large", left: 2 }))).toBe("Not enough stock for oud-large (2 left).");
    expect(explain(new ApiError("weird_code", 400, { detail: "x" }))).toBe("weird code: x");
    expect(explain(new ApiError("bad_input", 400, { issues: [{ path: "phone", message: "too long" }] }))).toBe("Not accepted: phone — too long");
  });

  it("money, units, initials, days", () => {
    expect(money(32, "OMR")).toBe("32 OMR");
    expect(money(1018.7214, "OMR")).toBe("1018.721 OMR");
    expect(money(0.5, "KWD")).toBe("0.5 KWD");
    // test-admin-look: a figure's trailing currency is its unit
    expect(splitUnit("1414.016 OMR")).toEqual(["1414.016", "OMR"]);
    expect(splitUnit("39")).toEqual(["39", ""]);
    expect(initials("shop keeper")).toBe("SK");
    expect(initials("e2e-keeper")).toBe("EK");
    expect(dayLabel("2026-10-01")).toBe("1 Oct");
  });
});
