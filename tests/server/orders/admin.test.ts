/**
 * The panel's order rules (domain/order-admin.ts), called as the admin API will call them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "../../helpers/harness";
import { HttpError } from "../../../src/server/core/http";
import { orderEvents, orders } from "../../../src/server/db/schema";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import * as A from "../../../src/server/domain/order-admin";
import { moveOrder } from "../../../src/server/domain/orders";
import { priceOrder } from "../../../src/shared/pricing/price";
import type { Catalogue } from "../../../src/shared/catalogue/types";
import type { OrderLine } from "../../../src/shared/orders/types";
import { seedOrders, seedShipment } from "./fixtures";

let h: Harness;
/** the catalogue these suites use: the deploy's, its small box sold singly too (test-order-items.js) */
const CFG = (): Catalogue => {
  const c = bundledCatalogue();
  c.offer!.only = false;
  return c;
};
beforeAll(async () => {
  h = await createHarness({ catalogue: CFG() });
});
beforeEach(async () => h.reset(CFG()));
afterAll(async () => h.reset(CFG()));

/** the refusal a call throws: "status code" */
async function refused(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "no refusal";
  } catch (e) {
    if (e instanceof HttpError) return e.status + " " + e.code;
    throw e;
  }
}
async function extra(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p;
    return {};
  } catch (e) {
    return (e as HttpError).extra;
  }
}
const get = async (id: string) => (await h.db.select().from(orders).where(eq(orders.id, id)))[0]!;
const events = async (id: string) => h.db.select().from(orderEvents).where(eq(orderEvents.orderId, id));
const q = (items: Array<{ itemId: string; qty: number }>, pay = "cod", cc = "OM") =>
  priceOrder(CFG(), { countryCode: cc, pay, items, existing: true }, h.clock.t);

/** Oman, cash on delivery, one large oud — the order every item case starts from */
async function omOrder(extra: Record<string, unknown> = {}) {
  const quote = q([{ itemId: "oud-large", qty: 1 }]);
  await seedOrders(h, [
    {
      id: "LM-100001", countryCode: "OM", country: "عمان", cur: "OMR", pay: "cod", paymentStatus: "cod", omrRate: 1,
      sub: quote.sub, ship: quote.ship, codFee: quote.codFee, total: quote.total, omr: quote.omr, items: quote.items as OrderLine[],
      phone: "+968 9123 4567", phoneKey: "96891234567", ...extra,
    },
  ]);
  return get("LM-100001");
}

describe("what may be put on an order (orders.options)", () => {
  // from test-order-items.js §1
  it("lists what the market sells", async () => {
    const o = await A.orderOptions(h.deps, "OM");
    expect([o.ok, o.cur]).toEqual([true, "OMR"]);
    expect(o.sizes.map((s) => s.id).join(",")).toBe("large,small");
    expect(o.scents.map((s) => s.id).join(",")).toBe("oud,lemon,amber");
    expect(o.offer?.id).toBe("bundle");
    expect(await refused(A.orderOptions(h.deps, "ZZ"))).toBe("400 unknown_country");
    const gone = CFG();
    gone.countries.find((c) => c.code === "OM")!.sizes = gone.sizes.map((s) => (s.id === "small" ? { ...s, soldOut: true } : s));
    await h.publish(gone);
    expect((await A.orderOptions(h.deps, "OM")).sizes.map((s) => s.id).join(",")).toBe("large");
    expect((await A.orderOptions(h.deps, "OM", true)).sizes.map((s) => s.name).join(",")).toContain("— sold out");
  });
});

describe("re-quoting (orders.items)", () => {
  // from test-order-items.js §2
  it("re-prices from the catalogue, stores the catalogue's names, reports the old total", async () => {
    const o = await omOrder();
    const before = o.total;
    let r = await A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-large", qty: 3 }] });
    const want3 = q([{ itemId: "oud-large", qty: 3 }]);
    expect(r.total).toBe(want3.total);
    let row = await get("LM-100001");
    expect([row.total, row.omr, row.items[0]!.scent]).toEqual([want3.total, want3.omr, want3.items[0]!.scent]);
    expect(r.was).toBe(before);
    r = await A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-large", qty: 1 }, { itemId: "lemon-small", qty: 2 }] });
    const want2 = q([{ itemId: "oud-large", qty: 1 }, { itemId: "lemon-small", qty: 2 }]);
    row = await get("LM-100001");
    expect([r.total, row.items.length, row.ship]).toEqual([want2.total, 2, want2.ship]);
    // nothing else on the order is written: not the customer, not how it was paid
    expect([row.name, row.phone, row.city, row.pay, row.paymentStatus]).toEqual([o.name, o.phone, o.city, "cod", "cod"]);
    const ev = (await events("LM-100001")).filter((e) => e.kind === "items");
    expect(ev.length).toBe(2);
  });

  // from test-order-items.js §3
  it("a paid card order may be re-quoted; the payment record is not touched; a refunded one stays refunded", async () => {
    await omOrder({ paymentStatus: "paid", pay: "card", paymentId: "2026090702", invoiceNo: "inv-1", codFee: 0 });
    const r = await A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-large", qty: 9 }] });
    expect(r.ok).toBe(true);
    const row = await get("LM-100001");
    expect([row.paymentId, row.paymentStatus, row.invoiceNo]).toEqual(["2026090702", "paid", "inv-1"]);
    await h.reset(CFG());
    await omOrder({ refunded: true });
    expect((await A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-large", qty: 9 }] })).ok).toBe(true);
    expect((await get("LM-100001")).refunded).toBe(true);
  });

  it("refuses what the storefront refuses, and writes nothing", async () => {
    const o = await omOrder();
    const e = await extra(A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "nonsense-huge", qty: 1 }] }));
    expect(e.item).toBe("nonsense-huge");
    expect(await refused(A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "nonsense-huge", qty: 1 }] }))).toBe("400 unknown_item");
    const soldOut = CFG();
    soldOut.countries.find((c) => c.code === "OM")!.sizes = soldOut.sizes.map((s) => (s.id === "small" ? { ...s, soldOut: true } : s));
    await h.publish(soldOut);
    expect(await refused(A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "lemon-small", qty: 1 }] }))).toMatch(/^400 (unavailable_here|unknown_item)$/);
    expect(await refused(A.requoteItems(h.deps, "LM-100001", { items: [] }))).toBe("400 no_items");
    expect(await refused(A.requoteItems(h.deps, "LM-999999", { items: [{ itemId: "oud-large", qty: 1 }] }))).toBe("404 no_such_order");
    expect(await refused(A.requoteItems(h.deps, "../orders", { items: [{ itemId: "oud-large", qty: 1 }] }))).toBe("400 no_id");
    expect((await get("LM-100001")).total).toBe(o.total);
    expect((await events("LM-100001")).length).toBe(0);
  });

  it("clamps the quantity and ignores any price posted with the items", async () => {
    await omOrder();
    await A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-large", qty: 1e9 }] });
    expect((await get("LM-100001")).items[0]!.qty).toBe(99);
    await A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-large", qty: -4 }] });
    expect((await get("LM-100001")).items[0]!.qty).toBe(1);
    await A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-large", qty: 1, price: 0.001, total: 0.001 }], total: 0.001, omr: 0.001 } as never);
    const honest = q([{ itemId: "oud-large", qty: 1 }]);
    const row = await get("LM-100001");
    expect([row.total, row.omr, row.items[0]!.price]).toEqual([honest.total, honest.omr, honest.items[0]!.price]);
  });

  // from test-v314.js A2/A12/A14/A41
  it("not under an open payment page, nor once Empower has it, nor after delivery; a paid order's net follows", async () => {
    const later = new Date(h.clock.t + 3600e3);
    await seedOrders(h, [
      { id: "LM-300001", pay: "card", paymentStatus: "unpaid", status: "pending", amountBaisa: 26175, sessionId: "sess_1", expireAt: later },
      { id: "LM-300002", status: "prep" },
      { id: "LM-300003", status: "done" },
      { id: "LM-300004", pay: "card", paymentStatus: "paid", status: "new", amountBaisa: 26175, gatewayFee: 0.25, netAmount: 25.925, codFee: 0 },
      { id: "LM-300005", status: "ship" },
    ]);
    await seedShipment(h, { orderId: "LM-300002", sentId: "LM-300002", awb: "291700000010", courierName: "Aramex", status: "created" });
    const items = [{ itemId: "oud-large", qty: 2 }];
    expect(await refused(A.requoteItems(h.deps, "LM-300001", { items }))).toBe("409 payment_open");
    expect((await extra(A.requoteItems(h.deps, "LM-300001", { items }))).until).toBe(later.toISOString());
    expect(await refused(A.requoteItems(h.deps, "LM-300002", { items }))).toBe("409 parcel_booked");
    expect(await extra(A.requoteItems(h.deps, "LM-300002", { items }))).toEqual({ awb: "291700000010", carrier: "Aramex" });
    expect(await refused(A.requoteItems(h.deps, "LM-300003", { items }))).toBe("409 already_shipped");
    expect(await refused(A.requoteItems(h.deps, "LM-300005", { items }))).toBe("409 already_shipped");
    const r = await A.requoteItems(h.deps, "LM-300004", { items });
    expect((await get("LM-300004")).netAmount).toBe(Math.round((r.omr - 0.25) * 1000) / 1000);
    // its page lapsed: the basket may change, and the amount the card is asked for moves with it
    h.clock.advance(2 * 3600e3);
    const r2 = await A.requoteItems(h.deps, "LM-300001", { items });
    const row = await get("LM-300001");
    const want = priceOrder(CFG(), { countryCode: "AE", pay: "card", items, existing: true }, h.clock.t);
    expect(row.amountBaisa).toBe(Math.round(want.total * want.omrRate * 1000));
    expect(r2.omr).toBe(row.amountBaisa! / 1000);
  });

  it("a send taken off Empower (cancelled) does not hold the basket", async () => {
    await omOrder();
    await seedShipment(h, { orderId: "LM-100001", status: "cancelled" });
    expect((await A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-large", qty: 2 }] })).ok).toBe(true);
  });

  // from test-v189.js: manual (Empower's adjust before push) and the agreed cash amount
  it("manual: sold out allowed, unknown not; manual must be a real true", async () => {
    await omOrder();
    const out = CFG();
    out.countries.find((c) => c.code === "OM")!.sizes = out.sizes.map((s) => (s.id === "small" ? { ...s, soldOut: true } : s));
    await h.publish(out);
    expect(await refused(A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-small", qty: 2 }] }))).not.toBe("no refusal");
    expect(await refused(A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-small", qty: 2 }], manual: "yes" }))).not.toBe("no refusal");
    const r = await A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "oud-small", qty: 2 }], manual: true });
    expect(r.total).toBe(priceOrder(out, { countryCode: "OM", pay: "cod", manual: true, existing: true, items: [{ itemId: "oud-small", qty: 2 }] }, h.clock.t).total);
    expect((await get("LM-100001")).items[0]).toMatchObject({ itemId: "oud-small", qty: 2 });
    expect(await refused(A.requoteItems(h.deps, "LM-100001", { items: [{ itemId: "nope-small", qty: 1 }], manual: true }))).toBe("400 unknown_item");
  });

  it("the agreed amount to collect on an unpaid cash order", async () => {
    await omOrder();
    const items = [{ itemId: "oud-large", qty: 1 }];
    let r = await A.requoteItems(h.deps, "LM-100001", { items, manual: true, codAmount: "20.5" });
    expect([r.total, r.omr, r.catalogueTotal, r.codAmount]).toEqual([20.5, 20.5, q(items).total, 20.5]);
    expect((await get("LM-100001")).total).toBe(20.5);
    r = await A.requoteItems(h.deps, "LM-100001", { items, manual: true, codAmount: "١٥" });
    expect(r.total).toBe(15);
    r = await A.requoteItems(h.deps, "LM-100001", { items, manual: true, codAmount: "" });
    expect([r.total, r.codAmount]).toEqual([q(items).total, null]);
    expect(await refused(A.requoteItems(h.deps, "LM-100001", { items, codAmount: "abc" }))).toBe("400 bad_cod_amount");
    await h.reset(CFG());
    await omOrder({ pay: "card", paymentStatus: "paid" });
    expect(await refused(A.requoteItems(h.deps, "LM-100001", { items, codAmount: "20" }))).toBe("400 cod_amount_not_cod");
  });

  // from test-v447 (audit): the typed figure is converted at the quote's own rate
  it("an AED cash amount is converted at the market's rate, rounded to whole dirhams", async () => {
    await seedOrders(h, [{ id: "LM-500001" }]);
    const r = await A.requoteItems(h.deps, "LM-500001", { items: [{ itemId: "oud-large", qty: 1 }], codAmount: "200.4" });
    expect([r.total, r.omr]).toEqual([200, Math.round(200 * 0.1047 * 1000) / 1000]);
  });
});

describe("who and where (orders.customer)", () => {
  // from test-order-items.js §5
  it("corrects the delivery fields only, and moves the CRM key with the phone", async () => {
    const o = await omOrder({ name: "سالم", phone: "+968 9123 4567", email: "a@b.com", city: "صحار", region: "", note: "" });
    const r = await A.updateCustomer(h.deps, "LM-100001", {
      name: "سالم البلوشي", phone: "+968 9999 8888", city: "شمال الباطنة", region: "الحي التجاري", note: "leave with the guard",
    }, { actor: "shopkeeper" });
    expect(r.ok).toBe(true);
    const row = await get("LM-100001");
    expect([row.name, row.phone, row.city, row.region, row.note]).toEqual(["سالم البلوشي", "+968 9999 8888", "شمال الباطنة", "الحي التجاري", "leave with the guard"]);
    expect(row.phoneKey).toBe("96899998888");
    expect([row.total, row.items, row.pay, row.paymentStatus, row.status, row.countryCode]).toEqual([o.total, o.items, o.pay, o.paymentStatus, o.status, o.countryCode]);
    // the event names the fields, never their values (test-v334.js)
    const ev = (await events("LM-100001")).find((e) => e.kind === "customer")!;
    expect(ev.detail).toEqual({ fields: ["name", "phone", "city", "region", "note"], actor: "shopkeeper" });
    expect(JSON.stringify(ev)).not.toMatch(/9999|سالم/);
  });

  it("refuses an empty name or a phone that is no phone; writes nothing", async () => {
    await omOrder();
    expect(await refused(A.updateCustomer(h.deps, "LM-100001", { name: "  " }))).toBe("400 name_required");
    expect(await refused(A.updateCustomer(h.deps, "LM-100001", { phone: "12" }))).toBe("400 bad_phone");
    expect(await refused(A.updateCustomer(h.deps, "LM-100001", {}))).toBe("400 nothing_to_update");
    expect(await refused(A.updateCustomer(h.deps, "x", { name: "a" }))).toBe("400 no_id");
    expect(await refused(A.updateCustomer(h.deps, "LM-999999", { name: "a" }))).toBe("404 no_such_order");
    expect((await events("LM-100001")).length).toBe(0);
  });

  it("an address that is not one is stored as nothing; a real one lower-cased; limits are the checkout's", async () => {
    await omOrder();
    await A.updateCustomer(h.deps, "LM-100001", { email: "not an address" });
    expect((await get("LM-100001")).email).toBe(null);
    await A.updateCustomer(h.deps, "LM-100001", { email: "  SALEM@Example.COM " });
    expect((await get("LM-100001")).email).toBe("salem@example.com");
    await A.updateCustomer(h.deps, "LM-100001", { name: "x".repeat(400), note: "y".repeat(900) });
    const row = await get("LM-100001");
    expect([row.name!.length, row.note!.length]).toEqual([120, 500]);
  });
});

describe("the status flow", () => {
  // from test-v314.js A3/A4/A7
  it("the panel's status field", async () => {
    await seedOrders(h, [
      { id: "LM-200001", status: "done" },
      { id: "LM-200002", pay: "card", paymentStatus: "paid", status: "new", amountBaisa: 26175 },
      { id: "LM-200003", pay: "card", paymentStatus: "unpaid", status: "pending", amountBaisa: 26175 },
      { id: "LM-200004", status: "prep" },
    ]);
    await seedShipment(h, { orderId: "LM-200004", sentId: "LM-200004", awb: "291700000009", courierName: "Aramex", status: "created" });
    expect(await refused(A.setStatus(h.deps, "LM-200001", "delivered"))).toBe("400 bad_status");
    expect(await refused(A.setStatus(h.deps, "LM-200001", "new"))).toBe("409 moving_back");
    expect((await A.setStatus(h.deps, "LM-200001", "new", { force: true })).ok).toBe(true);
    expect((await get("LM-200001")).status).toBe("new");
    expect(await refused(A.setStatus(h.deps, "LM-200002", "pending"))).toBe("400 bad_status");
    expect(await refused(A.setPayment(h.deps, "LM-200002", "unpaid"))).toBe("400 bad_payment_status");
    expect(await refused(A.setPayment(h.deps, "LM-200002", "cod"))).toBe("409 card_payment_is_the_gateways");
    expect(await refused(A.setStatus(h.deps, "LM-200003", "prep"))).toBe("409 awaiting_payment");
    expect(await refused(A.setStatus(h.deps, "LM-200004", "void"))).toBe("409 parcel_live");
    expect((await extra(A.setStatus(h.deps, "LM-200004", "void"))).detail).toBe("Aramex 291700000009");
    expect((await A.setStatus(h.deps, "LM-200004", "void", { force: true })).ok).toBe(true);
    expect((await get("LM-200004")).status).toBe("void");
    const bulk = A.bulkSetStatus(h.deps, ["LM-200001", "LM-200003"], "ship");
    expect(await refused(bulk)).toBe("409 awaiting_payment");
    expect((await extra(A.bulkSetStatus(h.deps, ["LM-200001", "LM-200003"], "ship"))).ids).toEqual(["LM-200003"]);
  });

  // from test-v328.js / test-v334.js
  it("moves by hand along the table; back only with force; refunded never to the queue", async () => {
    await seedOrders(h, [
      { id: "LM-1001", status: "ship" },
      { id: "LM-1002", status: "new" },
      { id: "LM-1003", status: "done" },
      { id: "LM-1004", status: "void", refunded: true, paymentStatus: "refunded", pay: "card" },
      { id: "LM-1005", status: "void", pay: "card", paymentStatus: "cancelled" },
      { id: "LM-1006", status: "void" },
    ]);
    expect(await refused(A.setStatus(h.deps, "LM-1001", "new"))).toBe("409 moving_back");
    expect((await get("LM-1001")).status).toBe("ship");
    await A.setStatus(h.deps, "LM-1001", "new", { force: true });
    expect((await get("LM-1001")).status).toBe("new");
    // new → delivered by hand goes, and stamps the delivery
    await A.setStatus(h.deps, "LM-1002", "done");
    const d = await get("LM-1002");
    expect([d.status, d.deliveredAt?.getTime()]).toEqual(["done", h.clock.t]);
    expect(await refused(A.bulkSetStatus(h.deps, ["LM-1001", "LM-1003"], "prep"))).toBe("409 moving_back");
    expect((await extra(A.bulkSetStatus(h.deps, ["LM-1001", "LM-1003"], "prep"))).ids).toEqual(["LM-1003"]);
    expect((await get("LM-1001")).status).toBe("new"); // refused whole
    expect(await refused(A.setStatus(h.deps, "LM-1004", "new"))).toBe("409 refunded");
    expect(await refused(A.setStatus(h.deps, "LM-1005", "new"))).toBe("409 awaiting_payment");
    expect(await refused(A.setStatus(h.deps, "LM-1005", "ship"))).toBe("409 awaiting_payment");
    await A.setStatus(h.deps, "LM-1006", "new"); // a cancelled cash order comes back by hand
    expect((await get("LM-1006")).status).toBe("new");
    expect(await refused(A.setStatus(h.deps, "LM-9999", "new"))).toBe("404 no_such_order");
    expect(await refused(A.setPayment(h.deps, "LM-9999", "paid"))).toBe("404 no_such_order");
  });

  it("every move is on record: from, to, by, the actor", async () => {
    await seedOrders(h, [{ id: "LM-1101", status: "new" }]);
    await A.setStatus(h.deps, "LM-1101", "prep", { actor: "shopkeeper" });
    const ev = (await events("LM-1101")).filter((e) => e.kind === "status");
    expect(ev.map((e) => [e.from, e.to, e.by, (e.detail as Record<string, unknown>).actor])).toEqual([["new", "prep", "admin", "shopkeeper"]]);
  });

  // from test-v326.js: written as read
  it("a move is conditional on the status read: an order moved meanwhile is stale, not written over", async () => {
    await seedOrders(h, [{ id: "LM-1201", status: "ship" }]);
    const r = await moveOrder(h.deps, "LM-1201", "prep", "admin", { from: "new" });
    expect([r.changed, r.refusal]).toEqual([false, "stale"]);
    expect((await get("LM-1201")).status).toBe("ship");
    expect((await events("LM-1201")).length).toBe(0);
    expect((await moveOrder(h.deps, "LM-9999", "prep", "admin")).refusal).toBe("not_found");
    // a job is checked as the mover it says it is
    await seedOrders(h, [{ id: "LM-1202", status: "new" }]);
    expect((await moveOrder(h.deps, "LM-1202", "ship", "job:empower-poll", { as: "courier" })).changed).toBe(true);
    expect((await moveOrder(h.deps, "LM-1202", "prep", "job:empower-poll", { as: "courier" })).refusal).toBe("not_yours");
  });

  it("the bulk bar: each row as it was read; the rest named stale", async () => {
    await seedOrders(h, [{ id: "LM-1301", status: "new" }, { id: "LM-1302", status: "new" }]);
    const r = await A.bulkSetStatus(h.deps, ["LM-1301", "LM-1302", "LM-1399"], "prep");
    expect([r.updated, r.stale]).toEqual([2, ["LM-1399"]]);
    expect(await refused(A.bulkSetStatus(h.deps, [], "prep"))).toBe("400 no_ids");
  });

  it("manual shipping: the tracking number and carrier; Shipped stamps shipped_at; the number alone moves nothing", async () => {
    await seedOrders(h, [{ id: "LM-1401", status: "prep" }, { id: "LM-1402", status: "new" }]);
    await A.setStatus(h.deps, "LM-1401", "ship", { tracking: " TRK-1 ", carrier: "Aramex" });
    let row = await get("LM-1401");
    expect([row.status, row.tracking, row.carrier, row.shippedAt?.getTime()]).toEqual(["ship", "TRK-1", "Aramex", h.clock.t]);
    await A.setTracking(h.deps, "LM-1402", { tracking: "TRK-2", carrier: "DHL" });
    row = await get("LM-1402");
    expect([row.status, row.tracking, row.carrier]).toEqual(["new", "TRK-2", "DHL"]);
    h.clock.advance(60e3);
    await A.setTracking(h.deps, "LM-1402", { tracking: "TRK-3", ship: true });
    row = await get("LM-1402");
    expect([row.status, row.tracking, row.carrier, row.shippedAt?.getTime()]).toEqual(["ship", "TRK-3", "DHL", h.clock.t]);
    expect((await events("LM-1402")).map((e) => e.kind)).toEqual(["tracking", "status"]);
  });

  it("a cash order's payment by hand: cod ↔ paid", async () => {
    await seedOrders(h, [{ id: "LM-1501" }]);
    await A.setPayment(h.deps, "LM-1501", "paid");
    let row = await get("LM-1501");
    expect([row.paymentStatus, row.paidAt?.getTime()]).toEqual(["paid", h.clock.t]);
    await A.setPayment(h.deps, ["LM-1501"], "cod");
    row = await get("LM-1501");
    expect([row.paymentStatus, row.paidAt]).toEqual(["cod", null]);
  });
});

describe("the shop's marks", () => {
  // from test-v408.js §3
  it("the flag, with its time; cleared in bulk", async () => {
    await seedOrders(h, [{ id: "LM-4080001" }, { id: "LM-4080002" }]);
    await A.setFlag(h.deps, "LM-4080001", true);
    let row = await get("LM-4080001");
    expect([row.flagged, row.flaggedAt?.getTime(), row.status]).toEqual([true, h.clock.t, "new"]);
    const r = await A.setFlag(h.deps, ["LM-4080001", "LM-4080002"], false);
    expect(r.updated).toBe(2);
    row = await get("LM-4080001");
    expect([row.flagged, row.flaggedAt]).toEqual([false, null]);
  });

  it("the shop's note", async () => {
    await seedOrders(h, [{ id: "LM-4090001" }]);
    await A.setNote(h.deps, "LM-4090001", "call first");
    expect((await get("LM-4090001")).adminNote).toBe("call first");
  });

  // from test-trash.js
  it("trash and restore keep the row", async () => {
    await seedOrders(h, [{ id: "LM-9001" }, { id: "LM-9002", pay: "card", paymentStatus: "paid", paymentId: "p1" }]);
    await A.setTrashed(h.deps, ["LM-9001"], true);
    let row = await get("LM-9001");
    expect([row.trashed, row.trashedAt?.getTime()]).toEqual([true, h.clock.t]);
    await A.setTrashed(h.deps, ["LM-9001"], false);
    row = await get("LM-9001");
    expect([row.trashed, row.trashedAt]).toEqual([false, null]);
    expect((await A.setTrashed(h.deps, ["LM-9002"], true)).updated).toBe(1); // a paid order can be binned
    expect(await refused(A.setTrashed(h.deps, [], true))).toBe("400 no_ids");
  });

  // from test-trash.js + test-audit-fixes.js
  it("purge: never a paid, refunded or charged order; only from the bin; refused whole", async () => {
    await seedOrders(h, [
      { id: "LM-9001", trashed: true },
      { id: "LM-9002", pay: "card", paymentStatus: "paid", paymentId: "p2", trashed: true },
      { id: "LM-9003" },
      { id: "LM-9004", pay: "card", paymentStatus: "refunded", refunded: true, trashed: true },
      { id: "LM-9005", pay: "card", paymentStatus: "cancelled", status: "void", paymentId: "p5", trashed: true },
    ]);
    expect(await refused(A.purgeOrders(h.deps, ["LM-9002"]))).toBe("409 paid_orders_cannot_be_deleted");
    expect(await refused(A.purgeOrders(h.deps, ["LM-9004"]))).toBe("409 paid_orders_cannot_be_deleted");
    expect(await refused(A.purgeOrders(h.deps, ["LM-9005"]))).toBe("409 paid_orders_cannot_be_deleted");
    expect(await refused(A.purgeOrders(h.deps, ["LM-9003"]))).toBe("409 must_be_trashed_first");
    expect(await refused(A.purgeOrders(h.deps, ["LM-9001", "LM-9002"]))).toBe("409 paid_orders_cannot_be_deleted");
    expect((await h.db.select().from(orders)).length).toBe(5);
    expect(await A.purgeOrders(h.deps, ["LM-9001"])).toEqual({ ok: true, deleted: 1 });
    expect((await h.db.select().from(orders)).length).toBe(4);
    expect(await refused(A.purgeOrders(h.deps, []))).toBe("400 no_ids");
  });
});

describe("the list and one order", () => {
  it("newest first, the working list by default, filtered, searched, a page at a time", async () => {
    const t = h.clock.t;
    await seedOrders(h, [
      { id: "LM-8001", createdAt: new Date(t - 3000), phone: "+968 9123 4567", phoneKey: "96891234567", countryCode: "OM", name: "Salim" },
      { id: "LM-8002", createdAt: new Date(t - 2000), status: "prep", gateway: { mode: "uat" }, pay: "card", paymentStatus: "paid" },
      { id: "LM-8003", createdAt: new Date(t - 1000), trashed: true },
      { id: "LM-8004", createdAt: new Date(t), flagged: true, name: "", region: "" },
    ]);
    let r = await A.listOrders(h.deps);
    expect(r.orders.map((o) => o.id)).toEqual(["LM-8004", "LM-8002", "LM-8001"]);
    expect(r.total).toBe(3);
    const two = r.orders.find((o) => o.id === "LM-8002")!;
    expect(["gateway" in two, two.hasGateway, "client" in two]).toEqual([false, true, false]);
    expect(r.orders.find((o) => o.id === "LM-8004")!.check).toEqual(["name", "area"]);
    expect((await A.listOrders(h.deps, { trashed: true })).orders.map((o) => o.id)).toEqual(["LM-8003"]);
    expect((await A.listOrders(h.deps, { status: "prep" })).orders.map((o) => o.id)).toEqual(["LM-8002"]);
    expect((await A.listOrders(h.deps, { country: "om" })).orders.map((o) => o.id)).toEqual(["LM-8001"]);
    expect((await A.listOrders(h.deps, { flagged: true })).orders.map((o) => o.id)).toEqual(["LM-8004"]);
    expect((await A.listOrders(h.deps, { q: "9123 4567" })).orders.map((o) => o.id)).toEqual(["LM-8001"]);
    expect((await A.listOrders(h.deps, { q: "salim" })).orders.map((o) => o.id)).toEqual(["LM-8001"]);
    r = await A.listOrders(h.deps, { limit: 2, offset: 2 });
    expect([r.orders.map((o) => o.id), r.total]).toEqual([["LM-8001"], 3]);
  });

  it("each row carries its newest Empower send; one order in full with its events", async () => {
    await seedOrders(h, [{ id: "LM-7007" }]);
    await seedShipment(h, { orderId: "LM-7007", sentId: "LM-7007", reference: "R7", status: "picked_up" });
    const r = await A.listOrders(h.deps);
    expect(r.orders[0]!.shipment).toMatchObject({ sentId: "LM-7007", reference: "R7", status: "picked_up" });
    await A.setStatus(h.deps, "LM-7007", "prep");
    const d = await A.orderDetail(h.deps, "LM-7007");
    expect(d.events.map((e) => e.kind)).toEqual(["status"]);
    expect(d.shipments.length).toBe(1);
    expect(await refused(A.orderDetail(h.deps, "LM-7008"))).toBe("404 no_such_order");
  });
});

describe("the WhatsApp order (orders.create)", () => {
  const form = (extra: Record<string, unknown> = {}) => ({
    name: "Fatma", phone: "9123 4567", countryCode: "OM", city: "Muscat", region: "Al Khuwair",
    items: [{ itemId: "oud-large", qty: 1 }], ...extra,
  });

  it("a real order: priced by the till's engine, origin whatsapp_order, attribution whatsapp / chat, no Purchase reported", async () => {
    const pixels = () => h.world.calls.filter((c) => /facebook|snapchat|google-analytics/.test(c.host)).length;
    const r = await A.createManualOrder(h.deps, form(), { actor: "shopkeeper" });
    expect(r.ok).toBe(true);
    expect(r.id).toMatch(/^LM-\d{10}$/);
    const row = await get(r.id);
    expect([row.status, row.pay, row.paymentStatus, row.origin, row.phone, row.phoneKey]).toEqual(["new", "cod", "cod", "whatsapp_order", "+968 91234567", "96891234567"]);
    expect(row.attribution).toEqual({ source: "whatsapp", medium: "chat", how: "panel" });
    expect([row.total, r.total]).toEqual([29, 29]);
    expect(row.invoiceKey).toMatch(/^[a-f0-9]{32}$/);
    expect(pixels()).toBe(0);
    const ev = await events(r.id);
    expect(ev.map((e) => [e.kind, e.by])).toEqual([["created", "admin"]]);
  });

  it("availability is the shop's call (manual): a single small box, a sold-out one", async () => {
    const out = bundledCatalogue(); // offer.only on
    out.countries.find((c) => c.code === "OM")!.sizes = out.sizes.map((s) => (s.id === "small" ? { ...s, soldOut: true } : s));
    await h.publish(out);
    const r = await A.createManualOrder(h.deps, form({ items: [{ itemId: "oud-small", qty: 2 }] }));
    expect((await get(r.id)).items[0]).toMatchObject({ itemId: "oud-small", qty: 2 });
    expect(await refused(A.createManualOrder(h.deps, form({ items: [{ itemId: "rose-small", qty: 1 }] })))).toBe("400 unknown_item");
  });

  it("paid by transfer: no cash fee, paid now; an agreed cash amount for cod", async () => {
    let r = await A.createManualOrder(h.deps, form({ pay: "transfer" }));
    let row = await get(r.id);
    expect([row.pay, row.paymentStatus, row.paidAt?.getTime(), row.codFee, row.total]).toEqual(["transfer", "paid", h.clock.t, 0, 28]);
    r = await A.createManualOrder(h.deps, form({ payment: "paid" }));
    expect((await get(r.id)).pay).toBe("transfer");
    r = await A.createManualOrder(h.deps, form({ codAmount: "22.5" }));
    row = await get(r.id);
    expect([r.total, r.catalogueTotal, r.codAmount, row.total, row.omr]).toEqual([22.5, 29, 22.5, 22.5, 22.5]);
    expect(await refused(A.createManualOrder(h.deps, form({ codAmount: "x" })))).toBe("400 bad_cod_amount");
  });

  it("the number as typed, in whatever digits, without its country code or a local zero", async () => {
    for (const phone of ["+968 9123 4567", "0096891234567", "96891234567", "091234567", "٩١٢٣٤٥٦٧"]) {
      const r = await A.createManualOrder(h.deps, form({ phone }));
      expect([phone, (await get(r.id)).phone]).toEqual([phone, "+968 91234567"]);
    }
    expect(await refused(A.createManualOrder(h.deps, form({ phone: "123" })))).toBe("400 bad_phone");
    expect(await refused(A.createManualOrder(h.deps, form({ name: " " })))).toBe("400 no_name");
    expect(await refused(A.createManualOrder(h.deps, form({ city: "" })))).toBe("400 no_city");
    expect(await refused(A.createManualOrder(h.deps, form({ countryCode: "ZZ" })))).toBe("400 unknown_country");
  });

  it("the same form sent twice is one order", async () => {
    const a = await A.createManualOrder(h.deps, form({ dedupeId: "wa-1" }));
    const b = await A.createManualOrder(h.deps, form({ dedupeId: "wa-1", items: [{ itemId: "oud-large", qty: 5 }] }));
    expect([b.id, b.already, b.total]).toEqual([a.id, true, 29]);
    expect((await h.db.select().from(orders)).length).toBe(1);
  });

  it("the form's running total (orders.quote) writes nothing", async () => {
    const r = await A.quoteManualOrder(h.deps, form({ items: [{ itemId: "oud-large", qty: 2 }] }));
    expect([r.total, r.ship, r.codFee]).toEqual([51, 0, 1]);
    expect((await h.db.select().from(orders)).length).toBe(0);
  });
});

describe("customers (CRM)", () => {
  // from test-customers.js (the orders-based rules)
  it("orders added up per person; a cancelled order lists them with nothing live and nothing spent; the bin is out", async () => {
    const t = h.clock.t;
    await seedOrders(h, [
      { id: "LM-1", phoneKey: "96891234567", countryCode: "OM", omr: 9, createdAt: new Date(t - 3 * 86400e3), name: "Old Name" },
      { id: "LM-2", phoneKey: "96891234567", countryCode: "OM", omr: 9, createdAt: new Date(t - 2 * 86400e3), name: "Salim" },
      { id: "LM-3", phoneKey: "96891234567", countryCode: "AE", omr: 9, createdAt: new Date(t - 86400e3), name: null, phone: null },
      { id: "LM-4", phoneKey: "97450000000", countryCode: "QA", omr: 30, status: "void" },
      { id: "LM-5", phoneKey: "97450000000", countryCode: "QA", omr: 99, trashed: true },
      { id: "LM-6", phoneKey: "96600000000", countryCode: "SA", omr: 40, pay: "card", paymentStatus: "refunded", refunded: true },
    ]);
    await A.saveCrm(h.deps, "96891234567", { note: "prefers evening delivery", tags: ["VIP", "vip", " repeat "] });
    const r = await A.listCustomers(h.deps, { sort: "spend" });
    const salim = r.customers.find((c) => c.phoneKey === "96891234567")!;
    expect(salim).toMatchObject({ name: "Salim", orders: 3, live: 3, spend: 27, countries: ["AE", "OM"], note: "prefers evening delivery", tags: ["vip", "repeat"] });
    expect(salim.first).toBe(new Date(t - 3 * 86400e3).toISOString());
    expect(salim.last).toBe(new Date(t - 86400e3).toISOString());
    const qa = r.customers.find((c) => c.phoneKey === "97450000000")!;
    expect([qa.orders, qa.live, qa.spend]).toEqual([1, 0, 0]);
    expect(r.customers.find((c) => c.phoneKey === "96600000000")!.spend).toBe(0);
    expect(r.customers[0]!.phoneKey).toBe("96891234567");
    expect((await A.listCustomers(h.deps, { country: "QA" })).customers.map((c) => c.phoneKey)).toEqual(["97450000000"]);
    expect((await A.listCustomers(h.deps, { q: "9123 4567" })).customers.map((c) => c.phoneKey)).toEqual(["96891234567"]);
  });

  it("notes and tags: read back by key; both empty removes the row; a key that is no phone is refused", async () => {
    await A.saveCrm(h.deps, "96891234567", { note: "<b>call</b>", tags: [] });
    expect((await A.listCrm(h.deps)).crm).toEqual({ "96891234567": { note: "bcall/b", tags: [] } });
    await A.saveCrm(h.deps, "96891234567", { note: "", tags: [] });
    expect((await A.listCrm(h.deps)).crm).toEqual({});
    expect(await refused(A.saveCrm(h.deps, "abc", { note: "x" }))).toBe("400 bad_phone_key");
  });
});

describe("the export", () => {
  it("one row per order with the list's filters; CSV that a spreadsheet cannot run", async () => {
    await seedOrders(h, [{ id: "LM-1", name: "=HYPERLINK(\"x\")", note: "a, \"b\"" }, { id: "LM-2", trashed: true }]);
    const r = await A.exportOrders(h.deps);
    expect(r.rows.length).toBe(1);
    expect(r.columns[0]).toBe("Order");
    const csv = A.toCsv(r.columns, r.rows);
    expect(csv.split("\r\n")[0]).toBe(A.EXPORT_COLUMNS.join(","));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("عود الافندر كبير 300 جم ×1");
  });
});
