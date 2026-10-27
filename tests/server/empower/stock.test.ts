import { describe, expect, it } from "vitest";
import { shipments } from "../../../src/server/db/schema";
import { readShelf, expireShelf, FRESH_MS, CACHE_KEY } from "../../../src/server/domain/empower/shelf";
import { enforceStock, heldOrders, net, publicStock, readShelfForGate, reserved, stockStatus, HELD_HOURS, HELD_DAYS_MANUAL, PENDING_MINUTES } from "../../../src/server/domain/stock";
import { loadCatalogue } from "../../../src/server/domain/catalogue";
import { HttpError } from "../../../src/server/core/http";
import { ALL_SKUS, empowerHarness, type EH } from "./_helpers";

const short = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof HttpError) return e.code + ":" + (e.extra as any).left + ":" + (e.extra as any).item + ":" + e.status;
    throw e;
  }
};

const cfgOf = (h: EH) => loadCatalogue(h.deps, { fresh: true });

describe("reading the shelf", () => {
  // from test-v207.js: the read, cached a moment, kept an hour
  it("off: nothing asked; on: read, kept, reused for the minute, re-asked when fresh; down: the kept answer, then none", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", ALL_SKUS);
    h.omf.inventory = { LM2001: 16, LM3001: 4 };
    let cfg = await cfgOf(h);
    expect(JSON.stringify(await readShelf(h.deps, cfg))).toBe('{"left":{},"at":null,"source":"off"}');
    expect(h.omfCalls().length).toBe(0);
    await h.publish({ ...cfg, stockLive: true });
    cfg = await cfgOf(h);
    let r = await readShelf(h.deps, cfg);
    expect(r.source + " " + JSON.stringify(r.left)).toBe('omniful {"large":4,"small":16}');
    expect(r.tracker!.length).toBe(6);
    expect((await h.op(CACHE_KEY)).left).toEqual({ large: 4, small: 16 });
    const n = h.omfCalls().length;
    r = await readShelf(h.deps, cfg);
    expect(r.source + " " + (h.omfCalls().length - n)).toBe("cached 0");
    r = await readShelf(h.deps, cfg, { fresh: true });
    expect(r.source + " " + (h.omfCalls().length - n)).toBe("omniful 1");
    h.clock.advance(10 * 60e3);
    h.world.fail((c) => (/omniful/.test(c.host) ? { status: 503, body: {} } : null));
    r = await readShelf(h.deps, cfg);
    expect(r.source).toBe("cached");
    expect(r.error).toMatch(/Omniful/);
    expect(r.left).toEqual({ large: 4, small: 16 });
    h.clock.advance(2 * 3600e3);
    r = await readShelf(h.deps, cfg);
    expect(r.source + " " + JSON.stringify(r.left)).toBe("none {}");
    expect(FRESH_MS).toBe(45e3);
  });

  // from test-v207.js: through the reading, the per-SKU note rides to the panel
  it("the hub code refused: a good read per SKU, carrying the note and the shelf's hub", async () => {
    const h = await empowerHarness({ change: (c) => (c.stockLive = true) });
    await h.setOp("omniful_skus", ALL_SKUS);
    h.omf.inventory = { LM2001: 16, LM6002: 24, LM9002: 23, LM3001: 4, LM7002: 13, LM8001: 14 };
    h.omf.refuseHub = true;
    h.omf.hubCode = "EMPOWER-MCT";
    const r = await readShelf(h.deps, await cfgOf(h), { fresh: true });
    expect(r.source + " " + JSON.stringify(r.left) + " " + /per SKU/.test(r.note!) + " " + r.hubs!.join()).toBe('omniful {"large":31,"small":63} true EMPOWER-MCT');
  });

  // from test-v209.js: untrustworthy readings hide nothing
  it("a reading that cannot be trusted is not a reading of 0, and never overwrites a good one", async () => {
    const h = await empowerHarness({ change: (c) => (c.stockHide = { "oud-small": true, "lemon-small": true, "amber-small": true }) });
    const cfg = await cfgOf(h);
    // the shelf's codes are not ours
    h.omf.inventory = { X1: 5, X2: 5 };
    let r = await readShelf(h.deps, cfg, { fresh: true });
    expect(r.source).toBe("none");
    expect(r.error).toMatch(/X1, X2/);
    expect(await h.op(CACHE_KEY)).toBe(undefined);
    // a shape it cannot read
    h.world.fail((c) => (/inventory\/hubs/.test(c.path) ? { status: 200, body: { data: [{ id: 1, qty_free: 2 }] } } : null));
    r = await readShelf(h.deps, cfg, { fresh: true });
    expect(r.source + " " + JSON.stringify(r.fields)).toBe('none ["id","qty_free"]');
    h.world.fail(null);
    // a good reading (oud-small at 0) hides it, and is kept
    h.omf.inventory = { "OUD-SMALL": 0, "LEMON-SMALL": 4, "AMBER-SMALL": 4 };
    let s = await publicStock(h.deps);
    expect(s.body.hide).toEqual({ items: ["oud-small"], sizes: [] });
    expect((await h.op(CACHE_KEY)).source).toBe("omniful");
    // then a bad one: the good one stands, with an error
    h.omf.inventory = { X1: 1 };
    r = await readShelf(h.deps, cfg, { fresh: true });
    expect(r.source + " " + !!r.error + " " + r.tracker!.find((t) => t.id === "oud-small")!.available).toBe("cached true 0");
    expect((await h.op(CACHE_KEY)).tracker.find((t: any) => t.id === "lemon-small").available).toBe(4);
    // the good one two hours old + a bad read: nothing hidden
    h.clock.advance(2 * 3600e3);
    h.clock.advance(1);
    s = await publicStock(h.deps);
    expect(s.body.hide).toEqual({ items: [], sizes: [] });
  });

  it("an expired reading is re-asked at once", async () => {
    const h = await empowerHarness({ change: (c) => (c.stockLive = true) });
    h.omf.inventory = { "OUD-LARGE": 3 };
    const cfg = await cfgOf(h);
    await readShelf(h.deps, cfg);
    expect(await expireShelf(h.deps)).toBe(true);
    expect(await expireShelf(h.deps)).toBe(false);
    const n = h.omfCalls().length;
    expect((await readShelf(h.deps, cfg)).source).toBe("omniful");
    expect(h.omfCalls().length - n).toBe(1);
    expect((await h.op(CACHE_KEY)).expired).toBe(undefined);
  });
});

describe("what open orders hold", () => {
  // from test-v319.js: held here
  it("only New and payable card orders in Empower markets, with no parcel, in the window", async () => {
    const h = await empowerHarness({ routes: { AE: "manual" }, change: (c) => (c.stockLive = true) });
    await h.setOp("omniful_auto", { on: true });
    await h.setOp("omniful_skus", ALL_SKUS);
    h.omf.inventory = { LM3001: 20, LM2001: 20, LM6002: 20, LM9002: 20, LM7002: 20, LM8001: 20 };
    const om = { countryCode: "OM", phone: "+968 91234567", cur: "OMR", items: [{ itemId: "oud-large", scent: "", size: "", qty: 1, price: 20 }] };
    await h.order({ ...om, id: "LM-1000001", createdAt: h.ago(60) });
    await h.order({ ...om, id: "LM-1000002", status: "pending", pay: "card", paymentStatus: "unpaid", createdAt: h.ago(60), expireAt: new Date(h.clock.t + 30 * 60e3) });
    await h.order({ ...om, id: "LM-1000003", status: "prep" });
    await h.order({ ...om, id: "LM-1000004", createdAt: h.ago(5 * 24 * 60) });
    await h.order({ ...om, id: "LM-1000005" });
    await h.db.insert(shipments).values({ id: "omf-LM-1000005", orderId: "LM-1000005", carrier: "empower", sentId: "LM-1000005", status: "Created" });
    await h.order({ ...om, id: "LM-1000006", countryCode: "AE" });
    const cfg = await cfgOf(h);
    expect((await heldOrders(h.deps, cfg)).map((x) => x.id).sort().join(",")).toBe("LM-1000001,LM-1000002");
    const r = await net(h.deps, cfg, await readShelf(h.deps, cfg, { fresh: true }));
    const t = r.tracker!.find((x) => x.id === "oud-large")!;
    expect([t.shelf, t.reserved, t.available].join(" ")).toBe("20 2 18");
    expect(r.held!.map((x) => x.id + ":" + JSON.stringify(x.boxes)).sort()).toEqual(['LM-1000001:{"oud-large":1}', 'LM-1000002:{"oud-large":1}']);
    const st = await stockStatus(h.deps, { fresh: true });
    expect(st.held.length + " " + st.heldHours).toBe("2 72");
    expect(st.tracker.find((x) => x.id === "oud-large")!.available).toBe(18);
    expect(st.items["oud-large"]).toBe("LM3001");
    expect(st.bySize.small).toEqual(["LM2001", "LM6002", "LM9002"]);
    expect(HELD_HOURS).toBe(72);
  });

  // from test-v334.js and test-v336-server.js: the windows
  it("auto push off: two weeks; a pending card holds an hour without a session, or until its expiry", async () => {
    const h = await empowerHarness();
    const cfg = await cfgOf(h);
    await h.order({ id: "LM-1100005", createdAt: h.ago(5 * 1440) });
    await h.order({ id: "LM-1100030", createdAt: h.ago(30 * 1440) });
    await h.order({ id: "LM-1100010", status: "pending", pay: "card", paymentStatus: "unpaid", createdAt: h.ago(10) });
    await h.order({ id: "LM-1100061", status: "pending", pay: "card", paymentStatus: "unpaid", createdAt: h.ago(61) });
    await h.order({ id: "LM-1100120", status: "pending", pay: "card", paymentStatus: "unpaid", createdAt: h.ago(120), expireAt: new Date(h.clock.t + 10 * 60e3) });
    await h.order({ id: "LM-1102880", createdAt: h.ago(2 * 1440) });
    expect((await heldOrders(h.deps, cfg)).map((x) => x.id).sort()).toEqual(["LM-1100005", "LM-1100010", "LM-1100120", "LM-1102880"]);
    await h.setOp("omniful_auto", { on: true });
    expect((await heldOrders(h.deps, cfg)).map((x) => x.id).sort()).toEqual(["LM-1100010", "LM-1100120", "LM-1102880"]);
    expect([HELD_DAYS_MANUAL, PENDING_MINUTES]).toEqual([14, 60]);
  });

  // from test-v318.js: held counts only Empower markets
  it("counts only the markets Empower ships; none routed holds nothing", async () => {
    const h = await empowerHarness({ routes: { AE: "manual", SA: "manual" }, change: (c) => (c.stockLive = true) });
    h.omf.inventory = { "OUD-SMALL": 10, "LEMON-SMALL": 10, "AMBER-SMALL": 10, "OUD-LARGE": 20 };
    const om = { countryCode: "OM", phone: "+968 91234567", cur: "OMR" };
    await h.order({ ...om, items: [{ itemId: "bundle", scent: "", size: "", qty: 1, price: 29 }] });
    await h.order({ ...om, items: [{ itemId: "oud-large", scent: "", size: "", qty: 2, price: 25 }] });
    const pushed = await h.order({ ...om, items: [{ itemId: "oud-large", scent: "", size: "", qty: 5, price: 25 }] });
    await h.db.insert(shipments).values({ id: "omf-" + pushed.id, orderId: pushed.id, carrier: "empower", sentId: pushed.id });
    await h.order({ countryCode: "AE", items: [{ itemId: "oud-small", qty: 4, scent: "", size: "", price: 1 }] });
    await h.order({ countryCode: "SA", items: [{ itemId: "bundle", qty: 4, scent: "", size: "", price: 1 }] });
    const res = await h.fetchGet("/api/stock");
    const body = await res.json();
    expect(body.left).toEqual({ large: 18, small: 27 });
    const none = await empowerHarness({ routes: { AE: "manual", SA: "manual", QA: "manual", OM: "manual", BH: "manual", KW: "manual" } });
    await none.order({ countryCode: "OM" });
    expect(await reserved(none.deps, await cfgOf(none), { "oud-large": 0 })).toEqual({});
  });

  // from test-v301.js: the stock tracker follows the orders
  it("an order placed is off the count at once; a push moves it to Omniful's own figure", async () => {
    const h = await empowerHarness({ change: (c) => ((c.stockLive = true), (c.stockCap = { "oud-small": true })) });
    await h.setOp("omniful_skus", ALL_SKUS);
    h.omf.inventory = { LM2001: 10, LM6002: 4, LM3001: 7 };
    const cfg = await cfgOf(h);
    let r = await net(h.deps, cfg, await readShelf(h.deps, cfg, { fresh: true }));
    const by = (id: string) => r.tracker!.find((x) => x.id === id)!;
    expect(by("oud-small").available + " " + r.left.small).toBe("10 14");
    const om = { countryCode: "OM", phone: "+968 91234567", cur: "OMR" };
    const l1 = await h.order({ ...om, items: [{ itemId: "oud-small", qty: 2, scent: "", size: "", price: 10 }] });
    await h.order({ ...om, items: [{ itemId: "bundle", qty: 1, scent: "", size: "", price: 29 }] });
    const calls = h.omfCalls().length;
    r = await net(h.deps, cfg, await readShelf(h.deps, cfg));
    expect(by("oud-small").shelf + " " + by("oud-small").reserved + " " + by("oud-small").available).toBe("10 3 7");
    expect(r.left.small).toBe(10);
    expect((await publicStock(h.deps)).body.cap["oud-small"]).toBe(7);
    expect(h.omfCalls().length - calls).toBe(0);
    // pushed: no longer held (Omniful's figure has it), and the shelf is re-asked
    await h.db.insert(shipments).values({ id: "omf-" + l1.id, orderId: l1.id, carrier: "empower", sentId: l1.id });
    h.omf.inventory = { LM2001: 8, LM6002: 4, LM3001: 7 };
    await expireShelf(h.deps);
    r = await net(h.deps, cfg, await readShelf(h.deps, cfg));
    expect(by("oud-small").reserved + " " + by("oud-small").available).toBe("1 7");
    // the gate agrees with the count shown
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 7 }]))).toBe("ok");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 8 }]))).toBe("stock_short:7:oud-small:409");
  });

  it("a failed parcel read holds every order", async () => {
    const h = await empowerHarness();
    const o = await h.order();
    await h.db.insert(shipments).values({ id: "omf-" + o.id, orderId: o.id, carrier: "empower", sentId: o.id });
    const cfg = await cfgOf(h);
    expect((await heldOrders(h.deps, cfg)).length).toBe(0);
    const real = h.db.select.bind(h.db);
    let n = 0;
    (h.db as any).select = (...a: unknown[]) => {
      n++;
      if (n === 3) throw new Error("down");
      return (real as any)(...a);
    };
    const held = await heldOrders(h.deps, cfg);
    (h.db as any).select = real;
    expect(held.map((x) => x.id)).toEqual([o.id]);
  });
});

describe("the till's gate", () => {
  // from test-v211.js: the till's gate
  async function gateWorld() {
    const h = await empowerHarness({ change: (c) => (c.stockCap = { "oud-small": true, "lemon-small": true, "amber-small": true, "oud-large": true }) });
    await h.setOp("omniful_skus", ALL_SKUS);
    h.omf.inventory = { LM2001: 3, LM6002: 0, LM9002: 12, LM3001: 5, LM7002: 9 };
    return { h, cfg: await cfgOf(h) };
  }
  it("refuses past the cap, naming the box and what is left; never an unticked box", async () => {
    const { h, cfg } = await gateWorld();
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 3 }]))).toBe("ok");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 4 }]))).toBe("stock_short:3:oud-small:409");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "lemon-small", qty: 1 }]))).toBe("stock_short:0:lemon-small:409");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "lemon-large", qty: 50 }]))).toBe("ok");
    // a set is one box of each scent in its size
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "bundle", qty: 1 }]))).toBe("stock_short:0:lemon-small:409");
    h.omf.inventory.LM6002 = 2;
    await expireShelf(h.deps);
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "bundle", qty: 2 }]))).toBe("ok");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "bundle", qty: 3 }]))).toBe("stock_short:2:lemon-small:409");
    // a large-box offer is its boxes: a trio of two oud and an amber against oud-large 5
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "trio:oud.oud.amber", qty: 3 }]))).toBe("stock_short:5:oud-large:409");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "trio:oud.oud.amber", qty: 2 }, { itemId: "oud-large", qty: 1 }]))).toBe("ok");
  });

  it("nets open orders not yet on Empower; `except` forgets an order only with its own dedupe id (A5)", async () => {
    const { h, cfg } = await gateWorld();
    const om = { countryCode: "OM", phone: "+968 91234567", cur: "OMR" };
    const lm1 = await h.order({ ...om, dedupeId: "d-1", items: [{ itemId: "oud-small", qty: 2, scent: "", size: "", price: 10 }] });
    const lm2 = await h.order({ ...om, items: [{ itemId: "oud-small", qty: 2, scent: "", size: "", price: 10 }] });
    await h.db.insert(shipments).values({ id: "omf-" + lm2.id, orderId: lm2.id, carrier: "empower", sentId: lm2.id });
    await h.order({ ...om, items: [{ itemId: "bundle", qty: 1, scent: "", size: "", price: 29 }] });
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 1 }]))).toBe("stock_short:0:oud-small:409");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "amber-small", qty: 11 }]))).toBe("ok");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 2 }], { id: lm1.id, dedupeId: "d-1" }))).toBe("ok");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 2 }], { id: lm1.id, dedupeId: "d-other" }))).toBe("stock_short:0:oud-small:409");
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 2 }], { id: lm1.id, dedupeId: null }))).toBe("ok");
  });

  it("inside the till's transaction: the shelf read beforehand, only the open orders read through the tx", async () => {
    const { h, cfg } = await gateWorld();
    const om = { countryCode: "OM", phone: "+968 91234567", cur: "OMR" };
    await h.order({ ...om, items: [{ itemId: "oud-small", qty: 2, scent: "", size: "", price: 10 }] });
    expect((await readShelfForGate(h.deps, cfg, "OM", [{ itemId: "lemon-large", qty: 1 }])).asked).toEqual([]);
    const pre = await readShelfForGate(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 2 }]);
    expect(pre.asked).toEqual(["oud-small"]);
    const calls = h.omfCalls().length;
    const inTx = await h.db
      .transaction(async (tx) => short(enforceStock({ ...h.deps, db: tx as never }, cfg, "OM", [{ itemId: "oud-small", qty: 2 }], null, tx, pre)))
      .catch((e) => String(e));
    expect(inTx).toBe("stock_short:1:oud-small:409");
    expect(h.omfCalls().length).toBe(calls);
    // a tx and no reading handed over: the kept reading only, never Omniful
    const cold = await gateWorld();
    const n = cold.h.omfCalls().length;
    const r = await cold.h.db.transaction(async (tx) => short(enforceStock({ ...cold.h.deps, db: tx as never }, cold.cfg, "OM", [{ itemId: "oud-small", qty: 9 }], null, tx)));
    expect(r + " " + (cold.h.omfCalls().length - n)).toBe("ok 0");
  });

  it("an unreadable shelf refuses nothing; no capped box asks nothing", async () => {
    const { h, cfg } = await gateWorld();
    h.world.fail((c) => (/omniful/.test(c.host) ? "refused" : null));
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "oud-small", qty: 99 }]))).toBe("ok");
    h.world.fail(null);
    const n = h.omfCalls().length;
    expect(await short(enforceStock(h.deps, cfg, "OM", [{ itemId: "lemon-large", qty: 1 }]))).toBe("ok");
    expect(h.omfCalls().length).toBe(n);
  });

  // from test-v314.js (A5/A42): the shelf's cap at the till
  it("through the till: the last box sells; another basket naming that id is refused; the same submission is the same order", async () => {
    const h = await empowerHarness({ change: (c) => ((c.stockCap = { "oud-large": true }), (c.stockLive = true)) });
    h.omf.inventory = { "OUD-LARGE": 1, "OUD-SMALL": 5, "AMBER-SMALL": 5, "LEMON-SMALL": 5, "AMBER-LARGE": 5, "LEMON-LARGE": 5 };
    let ip = 1;
    const post = async (o: Record<string, unknown>) => {
      const r = await h.post("/api/order", { order: { name: "Ahmed Al Balushi", phone: "+971 50 123 4567", countryCode: "AE", city: "دبي", region: "Al Barsha", items: [{ itemId: "oud-large", qty: 1 }], pay: "cod", ...o } }, { "x-nf-client-connection-ip": "10.77.0." + ip++ });
      return { s: r.status, j: (await r.json()) as Record<string, any> };
    };
    // the product page's own read keeps the shelf warm (the till never asks Omniful inside its lock)
    expect((await h.fetchGet("/api/stock")).status).toBe(200);
    let r = await post({ id: "LM-4000001", dedupeId: "d-first" });
    expect(r.s + " " + r.j.id).toBe("200 LM-4000001");
    r = await post({ id: "LM-4000001", dedupeId: "d-other" });
    expect(r.s + " " + r.j.error).toBe("409 stock_short");
    r = await post({ id: "LM-4000001", dedupeId: "d-first" });
    expect(r.s + " " + r.j.id + " " + r.j.already).toBe("200 LM-4000001 true");
    await h.order({ id: "LM-4000009", countryCode: "AE", createdAt: h.ago(5 * 1440), items: [{ itemId: "oud-large", qty: 1, scent: "", size: "", price: 250 }] });
    await h.db.execute(("delete from orders where id = 'LM-4000001'") as never);
    r = await post({ id: "LM-4000002", dedupeId: "d-third" });
    expect(r.s + " " + r.j.error).toBe("409 stock_short");
  });
});

describe("GET /api/stock", () => {
  // from test-v207.js / test-v211.js
  it("answers { left, hide, cap }, CDN-cached a minute", async () => {
    const h = await empowerHarness({ change: (c) => ((c.stockLive = true), (c.stockCap = { "oud-small": true, "amber-small": true })) });
    await h.setOp("omniful_skus", ALL_SKUS);
    h.omf.inventory = { LM2001: 3, LM9002: 12, LM3001: 4, LM6002: 1 };
    const res = await h.fetchGet("/api/stock");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ left: { large: 4, small: 16 }, hide: { items: [], sizes: [] }, cap: { "oud-small": 3, "amber-small": 12 } });
    expect(res.headers.get("netlify-cdn-cache-control")).toBe("public, durable, s-maxage=60, stale-while-revalidate=300");
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });

  it("the counter off: no pieces left, but hides and caps still come", async () => {
    const h = await empowerHarness({ change: (c) => (c.stockHide = { "oud-small": true }) });
    h.omf.inventory = { "OUD-SMALL": 0, "LEMON-SMALL": 3 };
    expect(await (await h.fetchGet("/api/stock")).json()).toEqual({ left: {}, hide: { items: ["oud-small"], sizes: [] }, cap: {} });
    const off = await empowerHarness();
    expect(await (await off.fetchGet("/api/stock")).json()).toEqual({ left: {}, hide: { items: [], sizes: [] }, cap: {} });
    expect(off.omfCalls().length).toBe(0);
  });

  // from test-v319.js: the database blinks
  it("answers from its last good read for ten minutes when the database does not answer, then shows nothing", async () => {
    const h = await empowerHarness({ change: (c) => (c.stockLive = true) });
    h.omf.inventory = { "OUD-LARGE": 4 };
    expect((await h.fetchGet("/api/stock")).status).toBe(200);
    const real = h.db.select.bind(h.db);
    (h.db as any).select = () => {
      throw new Error("db down");
    };
    h.clock.advance(61_000);
    const blink = await h.fetchGet("/api/stock");
    expect(blink.status).toBe(200);
    expect((await blink.json()).left).toEqual({ large: 4, small: 0 });
    expect(blink.headers.get("netlify-cdn-cache-control")).toBe("public, s-maxage=15, stale-while-revalidate=60");
    h.clock.advance(11 * 60e3);
    const gone = await h.fetchGet("/api/stock");
    (h.db as any).select = real;
    expect(gone.status + " " + JSON.stringify(await gone.json())).toBe('200 {"left":{},"hide":{"items":[],"sizes":[]},"cap":{}}');
  });
});
