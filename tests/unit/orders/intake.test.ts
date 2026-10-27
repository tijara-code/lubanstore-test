import { describe, expect, it } from "vitest";
import {
  basketRefusal, email, idList, isOrderId, isOrderKey, parseIntake, phone, phoneLike, qtyOf, signalsOf, text,
} from "../../../src/server/domain/intake";
import { newOrderId, orderIdFrom } from "../../../src/server/domain/orders";
import { normaliseOrderId, shown, stageOf } from "../../../src/server/domain/track";
import { toCsv } from "../../../src/server/domain/order-admin";

describe("the small checks", () => {
  // from test-invoice.js
  it("order ids and keys", () => {
    expect(isOrderId("LM-123456")).toBe(true);
    expect(isOrderId("LM-12")).toBe(false);
    expect(isOrderId("../LM-123456")).toBe(false);
    expect(isOrderId("LM-1234567890123")).toBe(false);
    expect(isOrderKey("")).toBe(false);
    expect(isOrderKey("abc")).toBe(false);
    expect(isOrderKey("a".repeat(32))).toBe(true);
  });

  // from test-v336-server.js §7
  it("phone, text, email", () => {
    expect([phone("968-9123 4567"), phone("9123<4567"), text("a<b>c"), text({ toString: 1 })].join("|")).toBe("968-9123 4567||abc|");
    expect(email(" Sara.Ali+gift@Example.co ")).toBe("sara.ali+gift@example.co");
    expect(email('"><svg/onload=alert(1)>@evil.co')).toBe(null);
    expect(phoneLike("١٢٣٤٥٦٧")).toBe(true);
    expect(phoneLike("123456")).toBe(false);
    expect(idList(["LM-1", "", 3, { x: 1 }, null])).toEqual(["LM-1", "3"]);
  });

  // from test-v336-server.js §3
  it("qtyOf and the basket's shape", () => {
    expect([undefined, 3, "07", 99, 100, -1, "1.5", true].map(qtyOf).join(",")).toBe("1,3,7,99,0,0,0,0");
    expect(basketRefusal(undefined)).toBe(null);
    expect(basketRefusal([{ itemId: "a", qty: 99 }])).toBe(null);
    expect(basketRefusal([{ itemId: "a", qty: 50 }, { itemId: "b", qty: 50 }])).toEqual({ error: "too_many" });
    expect(basketRefusal([[1]])).toEqual({ error: "unknown_item", item: null });
  });
});

describe("parseIntake", () => {
  const base = { name: "Sara", phone: "+968 91234567", countryCode: "om", items: [{ itemId: "oud-large", qty: 2 }] };
  it("whitelists and caps; the proposed id only when it is one", () => {
    const r = parseIntake({ ...base, id: "LM-1234567890", price: 0.01, total: 0.01, lang: "en", dedupeId: "x".repeat(80) });
    if (!("intake" in r)) throw new Error("refused");
    expect(r.intake.items).toEqual([{ itemId: "oud-large", qty: 2 }]);
    expect(r.intake.countryCode).toBe("OM");
    expect(r.intake.proposedId).toBe("LM-1234567890");
    expect(r.intake.dedupeId!.length).toBe(64);
    expect(r.intake.lang).toBe("en");
    expect("price" in r.intake).toBe(false);
    const bad = parseIntake({ ...base, id: "LM-1; drop" });
    expect("intake" in bad && bad.intake.proposedId).toBe(null);
  });

  it("incomplete before the basket's shape", () => {
    expect(parseIntake({ ...base, name: "" })).toEqual({ refusal: { error: "incomplete" } });
    expect(parseIntake({ ...base, phone: "12345" })).toEqual({ refusal: { error: "incomplete" } });
    expect(parseIntake(null)).toEqual({ refusal: { error: "incomplete" } });
    expect(parseIntake({ ...base, items: [{ itemId: "x", qty: 0 }] })).toEqual({ refusal: { error: "bad_qty" } });
  });

  it("the page's signals: click ids never clipped (dropped when absurd), the rest capped", () => {
    const long = "fb.1.1700000000000." + "A".repeat(300);
    expect(signalsOf({ snap: { fbc: long, fbp: "fb.1.2.3", scid: "s".repeat(200), vid: "v-1", junk: "x" } })).toEqual({ fbc: long, fbp: "fb.1.2.3", scid: "s".repeat(128), vid: "v-1" });
    expect(signalsOf({ snap: { fbc: "x".repeat(1001) } })).toEqual({});
    expect(signalsOf({ signals: { gcid: "1.2" } })).toEqual({ gcid: "1.2" });
  });

  it("the landing is kept as plain data", () => {
    const r = parseIntake({ ...base, ref: { utm: { source: "IG", deep: { deeper: { deepest: { x: 1 } } } }, fbclid: true, ref: "https://l.instagram.com/" } });
    if (!("intake" in r)) throw new Error("refused");
    expect(r.intake.ref).toEqual({ utm: { source: "IG", deep: {} }, fbclid: true, ref: "https://l.instagram.com/" });
  });
});

describe("ids", () => {
  // from test-bugcheck.js: a fresh id is LM- and ten digits (seven of the clock, three random)
  it("newOrderId / orderIdFrom", () => {
    const id = newOrderId(Date.parse("2026-10-20T08:00:00Z"));
    expect(id).toMatch(/^LM-\d{10}$/);
    expect(id.slice(3, 10)).toBe(String(Date.parse("2026-10-20T08:00:00Z")).slice(-7));
    expect(orderIdFrom("LM-4000001", 0)).toBe("LM-4000001");
    expect(orderIdFrom("nope", 1)).toMatch(/^LM-\d{10}$/);
  });
});

describe("the tracking vocabulary", () => {
  // from test-track.js
  it.each([
    ["Delivered", "delivered"], ["Info received", "created"], ["Picked up", "picked"], ["Out for Delivery", "transit"],
    ["No Response", "attempt"], ["Returned", "returned"], ["Shipment Refused", "failed"], ["Awaiting consignee for collection", "attempt"],
    // v447: a delivery that did not happen, and a return, are not deliveries
    ["Undelivered", "failed"], ["Failed to deliver", "failed"], ["RTO delivered", "returned"],
    // Omniful's words
    ["out_for_delivery", "transit"], ["picked_up", "picked"], ["delivered", "delivered"], ["", "created"],
  ])("%s → %s", (word, stage) => expect(stageOf(word)).toBe(stage));

  it("shown", () => expect(shown("Out for Delivery")).toEqual({ stage: "transit", step: 2, text: "في الطريق إليك" }));

  // from test-audit-fixes.js: the tracking input normaliser
  it("normaliseOrderId", () => {
    expect(["lm 482913", "LM482913", "482913", "LM-482913", "lm-482913"].map(normaliseOrderId)).toEqual(Array(5).fill("LM-482913"));
    expect(["", "../../etc/passwd", "LM-1' or '1'='1", "LM-12", "XX-482913"].map(normaliseOrderId)).toEqual(Array(5).fill(null));
  });
});

describe("toCsv", () => {
  it("quotes what needs quoting and defuses formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", '"q"'], ["=1+1", 5], ["-2", null]])).toBe('a,b\r\n"x,y","""q"""\r\n\'=1+1,5\r\n\'-2,\r\n');
  });
});
