import { describe, expect, it } from "vitest";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import {
  baseId,
  courierFor,
  DEFAULT_COURIER,
  isDuplicate,
  isEmpowerMarket,
  nextSentId,
  orderBody,
  routing,
  rowKey,
  shippable,
  splitName,
  splitPhone,
  stageOf,
  MANUAL,
  OMNIFUL,
} from "../../../src/server/domain/empower/rules";
import { boxesOf, bundleBoxes, linesOf, skuOf, unmapped } from "../../../src/server/domain/empower/lines";
import { matchSku, matchSkus } from "../../../src/server/domain/empower/admin";
import { capped, capSet, hidden, hideSet, HIDE_SIZES, skusBySize, stockOn, sumBySize, trackerRows } from "../../../src/server/domain/empower/shelf";
import { explain, expOf, inventoryRow, omnifulBase, omnifulEnv, HOSTS, Pacer, readHook, refOf, words, MIN_GAP_MS, BURST } from "../../../src/server/services/omniful";
import { checkOf } from "../../../src/shared/orders/phone";
import type { Catalogue } from "../../../src/shared/catalogue/types";
import type { OrderRow } from "../../../src/server/db/schema";

const CFG = bundledCatalogue();
const cfg4 = (routes: Record<string, string> = {}): Catalogue =>
  ({
    countries: [{ code: "OM", name: "Oman" }, { code: "AE", name: "UAE" }, { code: "SA", name: "Saudi" }, { code: "QA", name: "Qatar" }].map((c) =>
      routes[c.code] ? { ...c, courier: routes[c.code] } : c,
    ),
  }) as unknown as Catalogue;

const order = (o: Partial<OrderRow> = {}) =>
  ({
    id: "LM-100001",
    name: "Ahmed",
    phone: "+971 50 123 4567",
    country: "الإمارات",
    countryCode: "AE",
    city: "Dubai",
    region: "",
    note: "",
    email: null,
    cur: "AED",
    total: 249,
    pay: "cod",
    paymentStatus: "cod",
    status: "prep",
    trashed: false,
    refunded: false,
    origin: null,
    items: [{ itemId: "oud-large", scent: "", size: "", qty: 2, price: 125 }],
    ...o,
  }) as OrderRow;

describe("routing per market", () => {
  // from test-omniful.js: one courier per market (SMSA and the local courier are dropped; the default is Empower)
  it("defaults every market to Empower, and lets the shop move one to manual", () => {
    expect(DEFAULT_COURIER).toBe("omniful");
    expect(courierFor("OM", cfg4())).toBe("omniful");
    expect(courierFor("", cfg4())).toBe("omniful");
    expect(courierFor("ZZ", cfg4())).toBe("omniful");
    const moved = cfg4({ AE: "manual", SA: "MANUAL" });
    expect(courierFor("AE", moved)).toBe("manual");
    expect(courierFor("ae", moved)).toBe("manual");
    expect(courierFor("SA", moved)).toBe("manual");
    expect(courierFor("QA", moved)).toBe("omniful");
    // a courier nobody has heard of (or SMSA, now dropped) falls back to the default
    expect(courierFor("AE", cfg4({ AE: "dhl" }))).toBe("omniful");
    expect(courierFor("AE", cfg4({ AE: "smsa" }))).toBe("omniful");
    expect(courierFor("AE", cfg4({ AE: "" }))).toBe("omniful");
  });

  it("lists every market, saying which are choices and which are defaults", () => {
    const r = routing(cfg4({ AE: "manual" }));
    expect(r.length).toBe(4);
    const by = Object.fromEntries(r.map((x) => [x.code, x]));
    expect(by.AE!.chosen).toBe(true);
    expect(by.AE!.courier).toBe("manual");
    expect(by.QA!.chosen).toBe(false);
    expect(by.QA!.courier).toBe("omniful");
  });

  it("exactly one route claims any order, in any catalogue", () => {
    for (const c of [cfg4(), cfg4({ AE: "manual" }), cfg4({ AE: "dhl" }), { countries: [] } as unknown as Catalogue, {} as Catalogue]) {
      for (const cc of ["OM", "AE", "SA", "QA", "ZZ", "", "om"]) {
        const claims = [OMNIFUL, MANUAL].filter((w) => courierFor(cc, c) === w);
        expect(claims.length).toBe(1);
      }
    }
    expect(isEmpowerMarket("AE", cfg4({ AE: "manual" }))).toBe(false);
  });

  // from test-omniful.js: what is not a parcel
  it("a cancelled, unpaid, binned or refunded order is not a parcel", () => {
    expect(shippable(order({ status: "void" }))).toBe(false);
    expect(shippable(order({ status: "pending" }))).toBe(false);
    expect(shippable(order({ trashed: true }))).toBe(false);
    expect(shippable(order({ paymentStatus: "refunded" }))).toBe(false);
    expect(shippable(order())).toBe(true);
  });
});

describe("status words", () => {
  // from test-omniful.js and test-v447.js
  it("maps the courier's words onto stages, failures and returns first", () => {
    expect(stageOf("out for delivery")).toBe("transit");
    expect(stageOf("shipped")).toBe("picked");
    expect(stageOf("picked_up")).toBe("picked");
    expect(["Undelivered", "Not Delivered", "Failed to deliver", "Delivery attempt failed"].map(stageOf).join(",")).toBe("failed,failed,failed,failed");
    expect(["RTO Delivered", "Returned to shipper"].map(stageOf).join(",")).toBe("returned,returned");
    expect(["Delivered", "Shipment delivered", "Out For Delivery"].map(stageOf).join(",")).toBe("delivered,delivered,transit");
    expect(stageOf("cancelled")).toBe("failed");
    expect(stageOf("")).toBe("created");
  });
});

describe("the details check (checkOf)", () => {
  // from test-v316.js: the check
  const sa = (o: Record<string, unknown> = {}) => ({ name: "Fahad Al Qahtani", phone: "+966 501234567", countryCode: "SA", city: "الرياض", region: "حي النرجس، شارع 12", ...o });
  it("names what a courier would lack", () => {
    expect(checkOf(sa()).join(",")).toBe("");
    expect(checkOf(sa({ phone: "+966 50123456" })).join(",")).toBe("phone");
    expect(checkOf(sa({ phone: "+966 5012345678" })).join(",")).toBe("phone");
    expect(checkOf(sa({ phone: "+966 0501234567" })).join(",")).toBe("");
    expect(checkOf(sa({ phone: "+٩٦٦ ٥٠١٢٣٤٥٦٧" })).join(",")).toBe("");
    expect(checkOf(sa({ countryCode: "OM", phone: "+968 91234567" })).join(",") + "|" + checkOf(sa({ countryCode: "OM", phone: "+968 9123456" })).join(",")).toBe("|phone");
    expect(checkOf(sa({ region: " ", city: "", name: "x" })).join(",")).toBe("name,city,area");
  });
});

describe("sent ids", () => {
  // from test-empower.js / test-v314.js
  it("a re-send goes as LM-…-2, -3; the base id maps back", () => {
    expect(nextSentId("LM-7200001", [], 0)).toBe("LM-7200001");
    expect(nextSentId("LM-7200001", ["LM-7200001"], 0)).toBe("LM-7200001-2");
    expect(nextSentId("LM-7200001", ["LM-7200001", "LM-7200001-2"], 0)).toBe("LM-7200001-3");
    expect(baseId("LM-7200001-2")).toBe("LM-7200001");
    expect(baseId("LM-7200001")).toBe("LM-7200001");
    expect(rowKey("LM-7200001-2")).toBe("omf-LM-7200001-2");
  });
  it("an unknown SKU is not a taken id; a taken id is", () => {
    expect(isDuplicate({ status: 422, message: "sku_code LM9999 does not exist in hub" })).toBe(false);
    expect(isDuplicate({ status: 422, message: "Order with order_id LM-1 already exists" })).toBe(true);
    expect(isDuplicate({ status: 400, message: "order_id has already been taken" })).toBe(true);
    expect(isDuplicate({ status: 500, message: "order already exists" })).toBe(false);
  });
});

describe("Omniful's words", () => {
  // from test-empower.js: refusals in words
  it("reads an object, an array or a string, never [object Object]", () => {
    expect(explain(400, { message: { order_id: ["has already been taken"] } })).toBe("order id has already been taken");
    expect(explain(422, { errors: [{ message: "sku_code invalid" }, { message: "hub missing" }] })).toBe("sku_code invalid; hub missing");
    expect(explain(400, { message: "Bad hub" })).toBe("Bad hub");
    expect(explain(429, {})).toMatch(/rate-limiting/);
    expect(words(null)).toBe("");
  });

  // from test-omniful.js: the webhook
  it("readHook ties news back to our id, defensively", () => {
    const h = readHook({ data: { order: { seller_sales_channel_order_id: "LM-100001", status: "Out for Delivery", awb_number: "3300000123", shipping_partner: "Aramex" }, id: "OMF-9001" } });
    expect([h.orderId, h.ref, h.awb]).toEqual(["LM-100001", "OMF-9001", "3300000123"]);
    const blank = readHook({});
    expect(blank.orderId + "|" + blank.awb + "|" + blank.ref).toBe("||");
    expect(readHook(null).orderId).toBe("");
    const hostile = readHook({ data: { order: { seller_sales_channel_order_id: { evil: 1 }, awb_number: ["x"] } } });
    expect(typeof hostile.orderId + "/" + typeof hostile.awb).toBe("string/string");
    const real = readHook({
      event_name: "order.update.event",
      data: { order_id: "LM-2000001", omniful_order_id: "68932b51", order_status: "out_for_delivery", shipment: { awb_number: "AWB77", shipping_partner_name: "Aramex" } },
    });
    expect(real.orderId).toBe("LM-2000001");
    expect(real.ref).toBe("68932b51");
    expect(real.status).toBe("out for delivery");
    expect(stageOf(real.status)).toBe("transit");
    expect(real.awb + "/" + real.carrier).toBe("AWB77/Aramex");
    // from test-v185.js: their Get Order answer
    const got = readHook({ is_success: true, data: { order_id: "LM-9200002-2", omniful_order_id: "R2", status_code: "out_for_delivery", display_status: "Out For Delivery", shipment: { awb_number: "AWB2" } } });
    expect(got.status).toBe("Out For Delivery");
    expect(got.ref).toBe("R2");
  });

  it("refOf is their id, never ours echoed", () => {
    expect(refOf({ is_success: true, data: { order_id: "LM-2000001", omniful_order_id: "6a33abc" } })).toBe("6a33abc");
    expect(refOf({ data: { id: "OMF-1", order_id: "LM-1" } })).toBe("OMF-1");
    expect(refOf(null)).toBe("");
  });

  // from test-v207.js: the shelf, read from Omniful
  it("inventoryRow reads a shelf row in any of its spellings", () => {
    const row = (r: unknown) => JSON.stringify(inventoryRow(r));
    expect(row({ sku_code: "LM2001", available_quantity: 16, on_hand_quantity: 17 })).toBe('{"sku_code":"LM2001","available":16,"onHand":17}');
    expect(row({ seller_sku_code: "LM3001", available_qty: "4" })).toBe('{"sku_code":"LM3001","available":4,"onHand":4}');
    expect(row({ sku: { code: "LM7002" }, inventory: { available: 13 } })).toBe('{"sku_code":"LM7002","available":13,"onHand":13}');
    expect(row({ name: "oud" }) + " " + row({ sku_code: "X", available_quantity: "lots" }) + " " + row(null)).toBe("null null null");
    expect(row({ sku_code: "A", available_quantity: -3 }) + " " + row({ sku_code: "B", available_quantity: 2.7 })).toBe(
      '{"sku_code":"A","available":0,"onHand":0} {"sku_code":"B","available":2,"onHand":2}',
    );
  });
});

describe("the token and the hosts", () => {
  // from test-omniful.js
  const jwt = (expSec: number) => "h." + Buffer.from(JSON.stringify({ exp: expSec })).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") + ".s";
  it("reads a token's expiry from the token", () => {
    expect(expOf(jwt(2000000000))).toBe(2000000000 * 1000);
    expect(expOf("plain-token")).toBe(0);
  });
  it("production by default, staging opt-in, OMNIFUL_BASE overrides", () => {
    expect(HOSTS.production).toBe("https://prodapi.omniful.com");
    expect(HOSTS.staging).toBe("https://api.staging.omniful.com");
    expect(omnifulEnv({ OMNIFUL_ENV: "staging" })).toBe("staging");
    expect(omnifulEnv({ OMNIFUL_ENV: "nonsense" as never })).toBe("production");
    expect(omnifulBase({ OMNIFUL_BASE: "https://example.test/" })).toBe("https://example.test");
  });
  // the pacing bucket (v300): three at once, then one a second
  it("paces to a bucket of three, then one a second", () => {
    let t = 1_000_000;
    const p = new Pacer(() => t);
    expect(MIN_GAP_MS).toBe(1000);
    expect(BURST).toBe(3);
    expect([p.take(), p.take(), p.take()]).toEqual([0, 0, 0]);
    expect(p.take()).toBe(1000);
    expect(p.take()).toBe(2000);
    t += 5000;
    expect(p.take()).toBe(0);
  });
});

describe("the order, as Omniful's Create Order takes it", () => {
  // from test-omniful.js: the order body
  const wa = order({
    id: "LM-2000001",
    name: "Ahmed Al Balushi",
    phone: "+971 50 123 4567",
    city: "دبي",
    region: "Al Barsha, street 5",
    email: "a@example.com",
    cur: "AED",
    total: 339,
    paymentStatus: "cod",
    note: "call first",
    items: [{ itemId: "bundle", scent: "", size: "", qty: 1, price: 299, was: 360 }],
  });
  const lines = linesOf(wa, CFG, { "oud-small": "LM-OUD-100" });
  const body = orderBody(wa, lines, "HUB-TEST");

  it("refuses with no warehouse set, and with nothing to pick", () => {
    expect(() => orderBody(wa, lines, "")).toThrow(/OMNIFUL_HUB_CODE/);
    try {
      orderBody(wa, lines, "");
    } catch (e) {
      expect((e as { code: string }).code).toBe("omniful_no_hub");
    }
    try {
      orderBody(wa, [], "HUB");
    } catch (e) {
      expect((e as { code: string }).code).toBe("omniful_no_lines");
    }
  });

  it("carries every required field", () => {
    for (const v of [
      body.order_id, body.hub_code, body.order_items[0].sku_code, body.order_items[0].selling_price, body.order_items[0].quantity,
      body.billing_address.address1, body.billing_address.city, body.billing_address.country, body.shipping_address.address1,
      body.shipping_address.city, body.shipping_address.country, body.invoice.currency, body.invoice.total, body.customer.id,
      body.customer.first_name, body.payment_method, body.type,
    ]) {
      expect(v !== undefined && v !== null && v !== "").toBe(true);
    }
    expect(typeof body.is_cash_on_delivery).toBe("boolean");
  });

  it("is the order, field by field", () => {
    expect(body.order_id).toBe("LM-2000001");
    expect(body.hub_code).toBe("HUB-TEST");
    expect(body.order_items.map((i: any) => i.sku_code).join(",")).toBe("LM-OUD-100,LEMON-SMALL,AMBER-SMALL");
    expect(body.order_items[1].name).toBe("Lemon Musk · Small 100 g");
    expect(body.order_items.reduce((t: number, i: any) => t + i.total, 0)).toBe(299);
    expect(Math.round((body.invoice.subtotal + body.invoice.shipping_price) * 1000) / 1000).toBe(339);
    expect(body.invoice.currency).toBe("AED");
    expect(body.payment_method + "/" + body.invoice.total_due).toBe("postpaid/339");
    expect(body.is_cash_on_delivery).toBe(true);
    const paid = orderBody({ ...wa, paymentStatus: "paid", pay: "transfer" }, lines, "HUB-TEST");
    expect(paid.payment_method + "/" + paid.invoice.total_due).toBe("prepaid/0");
    expect(paid.is_cash_on_delivery).toBe(false);
    expect(body.shipping_address.city).toBe("Dubai");
    expect(body.shipping_address.country + "/" + body.shipping_address.country_code).toBe("United Arab Emirates/AE");
    expect(body.shipping_address.address1).toBe("Al Barsha, street 5");
    expect(body.customer.mobile_code + " " + body.customer.mobile).toBe("+971 501234567");
    expect(body.customer.first_name + "|" + body.customer.last_name).toBe("Ahmed|Al Balushi");
    expect(body.customer.id).toBe("LM-501234567");
    const om = orderBody(order({ countryCode: "OM", city: "مسقط", cur: "OMR", total: 12 }), linesOf(order({ countryCode: "OM" }), CFG, {}), "H");
    expect(om.shipping_address.state).toBe("Muscat");
    expect(orderBody({ ...wa, origin: "whatsapp_order" }, lines, "H").labels[0]).toBe("whatsapp");
    expect(body.labels[0]).toBe("website");
  });

  it("a re-send carries the id it is sent as", () => {
    expect(orderBody(wa, lines, "H", "LM-2000001-2").order_id).toBe("LM-2000001-2");
  });

  // from test-empower.js: the COD amount
  it("a typed COD amount below the items reaches Omniful as a discount, still adding up", () => {
    const typed = order({ countryCode: "AE", total: 199, items: [{ itemId: "oud-large", scent: "", size: "", qty: 1, price: 250 }] });
    const low = orderBody(typed, linesOf(typed, CFG, {}), "HUB");
    expect(Math.round((low.invoice.subtotal + low.invoice.shipping_price - low.invoice.discount) * 1000) / 1000).toBe(199);
    expect(low.invoice.discount).toBe(51);
  });

  it("a refunded order is never cash on delivery", () => {
    const r = orderBody({ ...wa, paymentStatus: "refunded", refunded: true }, lines, "H");
    expect(r.is_cash_on_delivery).toBe(false);
    expect(r.payment_method).toBe("prepaid");
  });

  it("splits phones and names the way their customer takes them", () => {
    expect(splitPhone("+971 50 123 4567")).toEqual({ code: "+971", number: "501234567" });
    expect(splitPhone("0501234567", "AE")).toEqual({ code: "+971", number: "501234567" });
    expect(splitName("  ")).toEqual({ first: "Customer", last: "" });
  });
});

describe("the lines, as the warehouse picks them", () => {
  // from test-omniful.js / test-empower.js / test-v185.js
  it("two sets and a loose box of the same scent share a line, and add up", () => {
    const two = linesOf(order({ items: [{ itemId: "bundle", scent: "", size: "", qty: 2, price: 299 }, { itemId: "oud-small", scent: "", size: "", qty: 1, price: 120 }] }), CFG, {});
    expect(two.map((l) => l.code + "x" + l.quantity).join(",")).toBe("oud-smallx3,lemon-smallx2,amber-smallx2");
    expect(two.reduce((t, l) => t + l.item_total, 0)).toBe(598 + 120);
  });
  it("a rial set splits to the baisa", () => {
    const om = linesOf(order({ countryCode: "OM", items: [{ itemId: "bundle", scent: "", size: "", qty: 1, price: 29.9 }] }), CFG, {});
    expect(Math.round(om.reduce((t, l) => t + l.item_total, 0) * 1000) / 1000).toBe(29.9);
  });
  it("a scent out in the set's size is made up from the others", () => {
    const short = bundledCatalogue();
    const ae = short.countries.find((c) => c.code === "AE")!;
    ae.scents = short.scents.map((x) => (x.id === "lemon" ? { ...x, soldOutSizes: ["small"] } : x));
    expect(bundleBoxes("AE", short).map((b) => b.code + "x" + b.qty).join(",")).toBe("oud-smallx2,amber-smallx1");
  });
  it("an add-on is its own line; an empty SKU box falls back to our code", () => {
    expect(linesOf(order({ items: [{ itemId: "burner", scent: "", size: "", qty: 1, price: 60 }] }), CFG, {})[0]!.seller_sku_code).toBe("BURNER");
    expect(skuOf({ "oud-small": "  " }, "oud-small")).toBe("OUD-SMALL");
  });
  it("the set goes as one kit line when it has a SKU, else as its boxes", () => {
    const kit = linesOf({ countryCode: "AE", items: [{ itemId: "bundle", scent: "", size: "", qty: 2, price: 299 }] }, CFG, { bundle: "LM5001" });
    expect(kit.map((l) => l.seller_sku_code + "x" + l.quantity + "=" + l.item_total).join(",")).toBe("LM5001x2=598");
    expect(linesOf({ countryCode: "AE", items: [{ itemId: "bundle", scent: "", size: "", qty: 1, price: 299 }] }, CFG, { bundle: " " }).length).toBe(3);
  });
  it("a past large set (bundle2) is its large boxes, or its own kit", () => {
    const old = linesOf(order({ items: [{ itemId: "bundle2", scent: "", size: "", qty: 1, price: 600 }] }), CFG, {});
    expect(old.map((l) => l.code + " x" + l.quantity).join(", ")).toBe("oud-large x1, lemon-large x1, amber-large x1");
    expect(old.reduce((t, l) => t + l.item_total, 0)).toBe(600);
    expect(linesOf(order({ items: [{ itemId: "bundle2", scent: "", size: "", qty: 1, price: 600 }] }), CFG, { bundle2: "LM5002", bundle: "LM5001" })[0]!.seller_sku_code).toBe("LM5002");
  });
  it("a large-box offer is the boxes its id names, its money spread", () => {
    const t = linesOf(order({ items: [{ itemId: "trio:oud.oud.amber", scent: "", size: "", qty: 1, price: 499 }] }), CFG, {});
    expect(t.map((l) => l.code + "x" + l.quantity).join(",")).toBe("oud-largex2,amber-largex1");
    expect(t.reduce((s, l) => s + l.item_total, 0)).toBe(499);
  });
  // from test-v319.js: a box with no Empower code is named
  it("names the boxes with no SKU set", () => {
    const l = linesOf(order({ items: [{ itemId: "oud-large", scent: "", size: "", qty: 1, price: 20 }, { itemId: "burner", scent: "", size: "", qty: 1, price: 5 }] }), CFG, {});
    expect(unmapped(l, { "oud-large": "LM3001" }).map((u) => u.code + ":" + u.name)).toEqual(["burner:Incense burner"]);
  });
  // from test-v211.js: boxesOf
  it("counts a set as one box of each scent in its size, and an offer as its boxes", () => {
    expect(JSON.stringify(boxesOf(CFG, "OM", [{ itemId: "bundle", qty: 2 }, { itemId: "oud-small", qty: 1 }]))).toBe('{"oud-small":3,"lemon-small":2,"amber-small":2}');
    expect(boxesOf(CFG, "OM", [{ itemId: "duo:oud.amber", qty: 1 }])).toEqual({ "oud-large": 1, "amber-large": 1 });
  });
});

describe("the stock switches and the tracker", () => {
  const SKUS = { "oud-small": "LM2001", "lemon-small": "LM6002", "amber-small": "LM9002", "oud-large": "LM3001", "lemon-large": "LM7002", "amber-large": "LM8001", bundle: "LM5001" };
  // from test-v207.js: per size, through the Empower SKU codes
  it("adds the shelf up per size", () => {
    const by = skusBySize(CFG, SKUS);
    expect(by.small!.join("+")).toBe("LM2001+LM6002+LM9002");
    expect(by.large!.join("+")).toBe("LM3001+LM7002+LM8001");
    expect(JSON.stringify(by).indexOf("LM5001")).toBe(-1);
    expect(skusBySize(CFG, {}).small!.join("+")).toBe("OUD-SMALL+LEMON-SMALL+AMBER-SMALL");
    const rows = [
      { sku_code: "LM2001", available: 16, onHand: 17 }, { sku_code: "LM6002", available: 24, onHand: 24 }, { sku_code: "LM9002", available: 23, onHand: 23 },
      { sku_code: "LM3001", available: 4, onHand: 8 }, { sku_code: "LM5001", available: 9, onHand: 9 },
    ];
    expect(JSON.stringify(sumBySize(CFG, SKUS, rows))).toBe('{"large":4,"small":63}');
    expect(JSON.stringify(sumBySize(CFG, SKUS, [{ sku_code: "lm2001", available: 5 }]))).toBe('{"large":0,"small":5}');
  });

  // from test-v208.js: tracker rows and hide at 0
  it("one tracker row per box; a SKU not on the shelf reads 0/0; the same SKU twice adds up", () => {
    const shelf = [
      { sku_code: "LM3001", available: 4, onHand: 8 }, { sku_code: "LM7002", available: 13, onHand: 13 }, { sku_code: "LM8001", available: 14, onHand: 15 },
      { sku_code: "LM2001", available: 0, onHand: 1 }, { sku_code: "LM6002", available: 24, onHand: 25 }, { sku_code: "LM9002", available: 23, onHand: 23 },
    ];
    const t = trackerRows(CFG, SKUS, shelf);
    expect(t.map((r) => r.id + " " + r.sku + " " + r.available + "/" + r.onHand).join(", ")).toBe(
      "oud-large LM3001 4/8, lemon-large LM7002 13/13, amber-large LM8001 14/15, oud-small LM2001 0/1, lemon-small LM6002 24/25, amber-small LM9002 23/23",
    );
    expect(trackerRows(CFG, SKUS, []).find((r) => r.id === "oud-small")!.available).toBe(0);
    const twice = trackerRows(CFG, SKUS, [{ sku_code: "LM2001", available: 2, onHand: 3 }, { sku_code: "lm2001", available: 1, onHand: 1 }]);
    expect(twice.find((r) => r.id === "oud-small")!.available + "/" + twice.find((r) => r.id === "oud-small")!.onHand).toBe("3/4");

    const all = (ids: string[]) => ({ ...CFG, stockHide: Object.fromEntries(ids.map((i) => [i, true])) }) as Catalogue;
    expect(JSON.stringify(hidden(CFG, t))).toBe('{"items":[],"sizes":[]}');
    expect(JSON.stringify(hidden(all(t.map((r) => r.id)), t))).toBe('{"items":["oud-small"],"sizes":[]}');
    expect(JSON.stringify(hidden(all(["lemon-small"]), t))).toBe('{"items":[],"sizes":[]}');
    expect(hideSet({ stockHide: { "oud-small": true, x: "yes", "a b": true } } as unknown as Catalogue)).toEqual(["oud-small"]);
    const smallOut = t.map((r) => (r.id.endsWith("-small") ? { ...r, available: 0 } : r));
    const smalls = ["oud-small", "lemon-small", "amber-small"];
    expect(hidden(all(smalls), smallOut)).toEqual({ items: smalls, sizes: ["small"] });
    expect(hidden(all(["oud-small", "lemon-small"]), smallOut).sizes).toEqual([]);
    const largeOut = t.map((r) => (r.id.endsWith("-large") ? { ...r, available: 0 } : r));
    const larges = ["oud-large", "lemon-large", "amber-large"];
    expect(hidden(all(larges), largeOut)).toEqual({ items: larges, sizes: [] });
    expect(HIDE_SIZES).toEqual(["small"]);
  });

  // from test-v211.js: the cap set and the reading
  it("caps only ticked boxes; the counter, a hide or a cap asks the shelf", () => {
    expect(capSet({ stockCap: { "oud-small": true, "x y": true, "lemon-small": "yes" } } as unknown as Catalogue)).toEqual(["oud-small"]);
    expect(stockOn({ stockCap: { "oud-small": true } } as unknown as Catalogue)).toBe(true);
    expect(stockOn({} as Catalogue)).toBe(false);
    const cfg = { ...CFG, stockCap: { "oud-large": true, "oud-small": true, "lemon-small": true, "amber-small": true } } as Catalogue;
    const t = trackerRows(cfg, SKUS, [
      { sku_code: "LM2001", available: 3 }, { sku_code: "LM6002", available: 0 }, { sku_code: "LM9002", available: 12 },
      { sku_code: "LM3001", available: 5 }, { sku_code: "LM7002", available: 9 },
    ]);
    expect(JSON.stringify(capped(cfg, t))).toBe('{"oud-large":5,"oud-small":3,"lemon-small":0,"amber-small":12}');
    expect(capped(cfg, null)).toEqual({});
    expect(capped(CFG, t)).toEqual({});
  });
});

describe("Match from Omniful", () => {
  // from test-empower.js: omfMatch
  const CAT = [{ sku_code: "LM3001", name: "oud-large", type: "simple", status: "active" }, { sku_code: "LM5001", name: "3-bundle", type: "simple", status: "active" }];
  it("swaps a name for its code, matches an empty box by our code, finds the set's kit", () => {
    expect(matchSku(CAT, "oud-large", "oud-large")!.sku_code).toBe("LM3001");
    expect(matchSku(CAT, "oud-large", "")!.sku_code).toBe("LM3001");
    expect(matchSku(CAT, "bundle", "")!.sku_code).toBe("LM5001");
    expect(matchSku(CAT, "oud-large", "LM3001")!.sku_code).toBe("LM3001");
    const m = matchSkus(CAT, ["oud-large", "lemon-large"], { "oud-large": "oud-large", "lemon-large": "NOPE" });
    expect(m["oud-large"]).toEqual({ sku: "LM3001", problem: "That is the Omniful name. Its SKU code is LM3001" });
    expect(m["lemon-large"]!.problem).toBe("Omniful has no SKU with this code");
  });
});
