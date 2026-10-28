import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { logs, orderEvents, shipments } from "../../../src/server/db/schema";
import { loadCatalogue } from "../../../src/server/domain/catalogue";
import { adopt, cancelPushed, pushOrder, sweep, PUSH_NEED_MS, SWEEP_MAX } from "../../../src/server/domain/empower/push";
import { applyHook } from "../../../src/server/domain/empower/sync";
import { pushOne, pushMany, takeOff } from "../../../src/server/domain/empower/admin";
import { HttpError } from "../../../src/server/core/http";
import { empowerHarness } from "./_helpers";

const err = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return e instanceof HttpError ? { status: e.status, error: e.code, ...e.extra } : e;
  }
};

describe("pushing an order to Empower", () => {
  // from test-empower.js: Push to Empower, from any country
  it("keeps to the routing unless a person asks; one push, one row, Preparing; never twice", async () => {
    const h = await empowerHarness({ routes: { QA: "manual" } });
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const cfg = await loadCatalogue(h.deps, { fresh: true });
    const a1 = await h.order({ countryCode: "QA", phone: "+974 3312 3456", city: "الدوحة", region: "West Bay", cur: "QAR" });
    let r: any = await pushOrder(h.deps, a1, cfg);
    expect(r.skipped).toBe("routed_to_manual");
    r = await pushOrder(h.deps, a1, cfg, { anyMarket: true });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("prep");
    expect(r.sentId).toBe(a1.id);
    expect(r.row).toBe("omf-" + a1.id);
    expect((await h.get(a1.id)).status).toBe("prep");
    const rows = await h.rows(a1.id);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ carrier: "empower", sentId: a1.id, reference: "OMF-1", status: "Sent to Omniful", cod: 250 });
    r = await pushOrder(h.deps, a1, cfg, { anyMarket: true });
    expect(r.skipped).toBe("already_pushed");
    expect(h.posts()).toEqual([a1.id]);
    // the Create Order body went to the hub with the mapped code
    expect(h.omf.orders[a1.id]!.body.hub_code).toBe("FAKE-HUB");
    expect(h.omf.orders[a1.id]!.body.order_items[0].sku_code).toBe("LM3001");
    // the push and the move are on the order's record
    const ev = await h.db.select().from(orderEvents).where(eq(orderEvents.orderId, a1.id));
    expect(ev.map((e) => e.kind + ":" + e.to).sort()).toEqual(["empower:pushed", "status:prep"]);
  });

  // from test-empower.js / test-v314.js / test-v317.js: never twice
  it("refuses a waybill on the order, a parcel row of any kind, a Shipped or Delivered or cancelled order", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const cfg = await loadCatalogue(h.deps, { fresh: true });
    const withTracking = await h.order({ tracking: "291700000020", carrier: "SMSA" });
    expect(await pushOrder(h.deps, withTracking, cfg)).toEqual({ skipped: "already_pushed", awb: "291700000020", carrier: "SMSA" });
    const done = await h.order({ status: "done" });
    expect(await pushOrder(h.deps, done, cfg)).toEqual({ skipped: "not_shippable" });
    const shipped = await h.order({ status: "ship" });
    expect(await pushOrder(h.deps, shipped, cfg)).toEqual({ skipped: "not_shippable" });
    const voided = await h.order({ status: "void" });
    expect(await pushOrder(h.deps, voided, cfg)).toEqual({ skipped: "not_shippable" });
    const refunded = await h.order({ status: "new", pay: "card", paymentStatus: "refunded", refunded: true });
    expect(await pushOrder(h.deps, refunded, cfg)).toEqual({ skipped: "not_shippable" });
    const other = await h.order();
    await h.db.insert(shipments).values({ id: "manual-1", orderId: other.id, carrier: "manual", sentId: "x", status: "Booked" });
    expect(await pushOrder(h.deps, other, cfg)).toMatchObject({ skipped: "already_pushed", row: "manual-1", carrier: "manual" });
    expect(h.posts()).toEqual([]);
  });

  it("a person and the auto run at the same second: one of them is busy", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const cfg = await loadCatalogue(h.deps, { fresh: true });
    const o = await h.order();
    const [a, b] = await Promise.all([pushOrder(h.deps, o, cfg), pushOrder(h.deps, o, cfg)]);
    const outcomes = [a, b].map((r: any) => r.ok ? "ok" : r.skipped).sort();
    expect(outcomes[0]).toBe("busy");
    expect(outcomes[1]).toBe("ok");
    expect(h.posts()).toEqual([o.id]);
  });

  // from test-v319.js: a box with no Empower code
  it("names a box with no Empower code, refuses without calling Omniful, and logs which code to add", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const cfg = await loadCatalogue(h.deps, { fresh: true });
    const o = await h.order({ items: [{ itemId: "oud-large", scent: "", size: "", qty: 1, price: 20 }, { itemId: "burner", scent: "", size: "", qty: 1, price: 5 }] });
    const p: any = await pushOrder(h.deps, o, cfg);
    expect(p.error + " " + p.codes.join(",")).toBe("sku_not_set burner");
    expect(h.omfCalls().length).toBe(0);
    const rows = await h.db.select().from(logs);
    expect(rows.some((l) => l.orderId === o.id && /Incense burner \(burner\)/.test(l.message))).toBe(true);
    // with no SKU map at all, nothing is sent under default codes
    const bare = await empowerHarness();
    const o2 = await bare.order();
    expect(((await pushOrder(bare.deps, o2, await loadCatalogue(bare.deps, { fresh: true }))) as any).error).toBe("sku_not_set");
  });

  // from test-v319.js: Omniful's own refusal
  it("\"Sku Not Valid\" carries the codes sent; a refusal is noted on the order's row or the log", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    h.omf.knownSkus = ["LM9999"];
    const o = await h.order();
    const p: any = await pushOrder(h.deps, o, await loadCatalogue(h.deps, { fresh: true }));
    expect(p.error).toBe("omniful_rejected");
    expect(p.detail).toMatch(/Sku Not Valid — sent LM3001 ×1 \(oud-large\)/);
    expect(p.status).toBe(400);
    expect((await h.get(o.id)).status).toBe("new");
  });

  // from test-empower.js: an order taken off Empower can be pushed again
  it("take-off cancels at Omniful, removes our row, spends the id, puts it back to New; the re-send goes as -2, then -3", async () => {
    const h = await empowerHarness({ routes: { QA: "manual" } });
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order({ countryCode: "QA", phone: "+974 3312 3456", cur: "QAR" });
    let j: any = await pushOne(h.deps, { id: o.id, any: true });
    expect(j.sentId).toBe(o.id);
    expect((await h.get(o.id)).status).toBe("prep");
    j = await takeOff(h.deps, { id: o.id });
    expect(j).toEqual({ ok: true, cancelled: true, sentId: o.id, status: "new" });
    expect(h.omf.orders[o.id]!.status).toBe("cancelled");
    expect((await h.get(o.id)).status).toBe("new");
    expect(await h.rows(o.id)).toEqual([]);
    expect((await h.op("omniful_retired"))[o.id]).toEqual([o.id]);
    j = await pushOne(h.deps, { id: o.id, any: true });
    expect(j.ok).toBe(true);
    expect(h.posts()).toEqual([o.id, o.id + "-2"]);
    expect((await h.rows(o.id)).map((r) => r.id)).toEqual(["omf-" + o.id + "-2"]);
    expect((await h.get(o.id)).status).toBe("prep");

    // the webhook: news about -2 reaches the order; a late word about the cancelled first send changes nothing
    let hk: any = await applyHook(h.deps, { data: { order_id: o.id + "-2", order_status: "ready_to_ship" } });
    expect(hk.ok + " " + hk.orderId + " " + (await h.rows(o.id))[0]!.status).toBe("true " + o.id + " ready to ship");
    hk = await applyHook(h.deps, { data: { order_id: o.id, order_status: "cancelled" } });
    expect(hk.ignored).toBe("unknown_order");
    expect((await h.rows(o.id))[0]!.status).toBe("ready to ship");

    await takeOff(h.deps, { id: o.id });
    expect(h.world.calls.filter((c) => c.method === "PUT").map((c) => c.path.split("/")[5])).toEqual([o.id, o.id + "-2"]);
    await pushOne(h.deps, { id: o.id, any: true });
    expect(h.posts().slice(-1)[0]).toBe(o.id + "-3");
    // a parcel already with a courier moved the order to Shipped: it is never pushed again (deliberate: v314 "never twice")
    await applyHook(h.deps, { data: { order_id: o.id + "-3", order_status: "out_for_delivery" } });
    expect((await h.get(o.id)).status).toBe("ship");
    await takeOff(h.deps, { id: o.id });
    expect(await pushOne(h.deps, { id: o.id, any: true })).toEqual({ ok: true, skipped: "not_shippable" });
  });

  // from test-empower.js: taking an order back off Empower
  it("take-off: not pushed is left alone; a delivered parcel is not taken back; Omniful's no is a 409 and the mark stays; mark only", async () => {
    const h = await empowerHarness();
    const o = await h.order({ status: "prep" });
    expect(await takeOff(h.deps, { id: o.id })).toEqual({ ok: true, skipped: "not_pushed" });
    await h.db.insert(shipments).values({ id: "omf-" + o.id, orderId: o.id, carrier: "empower", sentId: o.id, deliveredAt: new Date(h.clock.t) });
    expect(await err(takeOff(h.deps, { id: o.id }))).toMatchObject({ status: 409, error: "already_delivered" });
    const o2 = await h.order({ status: "prep" });
    await h.db.insert(shipments).values({ id: "omf-" + o2.id, orderId: o2.id, carrier: "empower", sentId: o2.id });
    // Omniful never had it under that id: their refusal, in their words
    expect(await err(takeOff(h.deps, { id: o2.id }))).toMatchObject({ status: 409, error: "omniful_rejected", detail: "order not found", upstream: 404 });
    expect((await h.rows(o2.id)).length).toBe(1);
    expect(await takeOff(h.deps, { id: o2.id, markOnly: true })).toEqual({ ok: true, cancelled: false, sentId: o2.id, status: "new" });
    expect(await h.rows(o2.id)).toEqual([]);
    expect(await err(takeOff(h.deps, { id: "nope" }))).toMatchObject({ status: 400, error: "no_id" });
  });

  it("take-off leaves a status set further on, and takes the parcel's waybill off the order", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order();
    await pushOne(h.deps, { id: o.id });
    await applyHook(h.deps, { data: { order_id: o.id, order_status: "packed", awb_number: "AWB9" } });
    expect((await h.get(o.id)).tracking).toBe("AWB9");
    const r: any = await takeOff(h.deps, { id: o.id });
    expect(r.status).toBe("new");
    expect((await h.get(o.id)).tracking).toBe(null);
  });

  // from test-empower.js (v184): taken off before spent ids were kept
  it("an id Omniful already has is reported as that; fresh sends the next id and keeps the refused one as spent", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order();
    h.omf.orders[o.id] = { id: "OMF-old", order_id: o.id, status: "cancelled", awb: "", carrier: "", body: {} };
    expect(await err(pushOne(h.deps, { id: o.id }))).toMatchObject({ status: 409, error: "omniful_duplicate", duplicate: true, sentId: o.id });
    expect((await h.rows(o.id)).length + " " + (await h.get(o.id)).status).toBe("0 new");
    const j: any = await pushOne(h.deps, { id: o.id, fresh: true });
    expect(j.ok + " " + j.sentId).toBe("true " + o.id + "-2");
    expect((await h.op("omniful_retired"))[o.id]).toEqual([o.id]);
  });

  // from test-v402.js: a push with no answer
  it("no answer is not a no: noted, and the next push hears 'already taken' and records it", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order();
    h.omf.dropAnswer = () => true;
    expect(await err(pushOne(h.deps, { id: o.id, any: true }))).toMatchObject({ status: 502, error: "omniful_unsure", unsure: true });
    h.omf.dropAnswer = null;
    expect((await h.op("omniful_unsure"))[o.id].sentId).toBe(o.id);
    expect((await h.get(o.id)).status + " " + (await h.rows(o.id)).length).toBe("new 0");
    const n0 = h.posts().length;
    const r: any = await pushOne(h.deps, { id: o.id, any: true });
    expect(r.ok + " " + r.adopted + " " + r.status).toBe("true true prep");
    expect(h.posts().length - n0 + " " + Object.keys(h.omf.orders).length).toBe("1 1");
    expect((await h.rows(o.id)).length + " " + (await h.get(o.id)).status).toBe("1 prep");
    expect((await h.op("omniful_unsure"))[o.id]).toBe(undefined);
  });

  it("a connection refused is not unsure (nothing reached Omniful)", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order();
    h.world.fail((c) => (/omniful/.test(c.host) ? "refused" : null));
    const r: any = await pushOrder(h.deps, o, await loadCatalogue(h.deps, { fresh: true }));
    h.world.fail(null);
    expect(r.error).toBe("omniful_unreachable");
    expect(await h.op("omniful_unsure")).toBe(undefined);
  });

  // from test-v402.js: 'already taken' with nothing on record
  it("'already taken' with no note: a person decides; adopt records it and sends nothing", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order();
    h.omf.orders[o.id] = { id: "OMF-78", order_id: o.id, status: "new", awb: "", carrier: "", body: {} };
    expect(await err(pushOne(h.deps, { id: o.id, any: true }))).toMatchObject({ status: 409, error: "omniful_duplicate" });
    expect((await h.get(o.id)).status).toBe("new");
    const r: any = await pushOne(h.deps, { id: o.id, any: true, adopt: true });
    expect(r.ok + " " + r.adopted + " " + (await h.get(o.id)).status + " " + (await h.rows(o.id)).length).toBe("true true prep 1");
    // 'record' and 'send fresh' never together: fresh wins, adopt is ignored
    const o2 = await h.order();
    h.omf.orders[o2.id] = { id: "OMF-79", order_id: o2.id, status: "cancelled", awb: "", carrier: "", body: {} };
    const r2: any = await pushOne(h.deps, { id: o2.id, adopt: true, fresh: true });
    expect(r2.adopted).toBe(undefined);
    expect(r2.sentId).toBe(o2.id + "-2");
  });

  // from test-v402.js: the clock
  it("never starts a push that cannot finish; a sweep out of time names what is left", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const cfg = await loadCatalogue(h.deps, { fresh: true });
    const o3 = await h.order();
    expect(PUSH_NEED_MS).toBe(4500);
    expect(await pushOrder(h.deps, o3, cfg, { deadline: h.clock.t + 2000 })).toEqual({ skipped: "no_time" });
    expect(h.posts()).toEqual([]);
    const o4 = await h.order();
    const o5 = await h.order();
    let r: any = await sweep(h.deps, { ids: [o3.id, o4.id, o5.id], deadline: h.clock.t + 2000 });
    expect(r.pushed + " " + JSON.stringify(r.left)).toBe("0 " + JSON.stringify([o3.id, o4.id, o5.id]));
    r = await sweep(h.deps, { ids: r.left });
    expect(r.pushed + " " + r.left.length).toBe("3 0");
  });

  // from test-empower.js (v183): nothing is pushed that nobody named
  it("Push all pushes exactly the named New orders, six a call", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    expect(await sweep(h.deps, { ids: [] })).toMatchObject({ error: "no_ids" });
    expect(await err(pushMany(h.deps, {}))).toMatchObject({ status: 400, error: "no_ids" });
    const w1 = await h.order({ createdAt: new Date("2026-08-01T10:00:00Z") });
    const w2 = await h.order({ createdAt: new Date("2026-09-20T10:00:00Z") });
    const r: any = await pushMany(h.deps, { ids: [w2.id] });
    expect(r.ok).toBe(true);
    expect(h.posts()).toEqual([w2.id]);
    expect((await h.get(w1.id)).status).toBe("new");
    expect(await h.op("omniful_sweep")).toMatchObject({ pushed: 1, considered: 1 });
    expect(SWEEP_MAX).toBe(6);
    // a Preparing order is not on the Waiting list: Push all leaves it
    const p = await h.order({ status: "prep" });
    expect(((await sweep(h.deps, { ids: [p.id] })) as any).pushed).toBe(0);
  });

  // from test-v402.js: on Empower but still New
  it("an order on Empower but still New is moved on, and sent nothing", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order();
    await h.db.insert(shipments).values({ id: "omf-" + o.id, orderId: o.id, carrier: "empower", sentId: o.id, status: "Sent to Omniful" });
    const r: any = await sweep(h.deps, { ids: [o.id] });
    expect(r.healed).toBe(1);
    expect((await h.get(o.id)).status).toBe("prep");
    expect(h.posts()).toEqual([]);
  });

  // from test-v314.js: accepted, the row lost
  it("Omniful accepted and the row could not be written: said, tried twice, kept in ops; the next push writes it and sends nothing", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order();
    const realInsert = h.db.insert.bind(h.db);
    let hits = 0;
    const spy = vi.spyOn(h.db, "insert").mockImplementation(((t: unknown) => {
      if (t === shipments) {
        hits++;
        const down = () => Promise.reject(new Error("down"));
        return { values: () => ({ onConflictDoUpdate: down, onConflictDoNothing: down }) };
      }
      return realInsert(t as never);
    }) as never);
    const r: any = await pushOrder(h.deps, o, await loadCatalogue(h.deps, { fresh: true }));
    spy.mockRestore();
    expect(r.error + " " + hits).toBe("db_write_failed 2");
    expect(r.detail).toMatch(/do not push it again/);
    const note = (await h.op("omniful_unrecorded"))[o.id];
    expect(note).toMatchObject({ sentId: o.id, ref: r.ref });
    const before = h.posts().length;
    const again: any = await pushOrder(h.deps, o, await loadCatalogue(h.deps, { fresh: true }));
    expect(again.skipped + " " + (h.posts().length - before) + " " + (await h.rows(o.id)).length).toBe("already_pushed 0 1");
    expect((await h.op("omniful_unrecorded"))[o.id]).toBe(undefined);
  });

  // from test-v301.js: a push through the runner expires the kept reading
  it("a push expires the kept shelf reading", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    await h.setOp("omniful_stock", { left: { large: 1 }, tracker: [], at: new Date(h.clock.t).toISOString(), source: "omniful" });
    const o = await h.order();
    expect(((await pushOrder(h.deps, o, await loadCatalogue(h.deps, { fresh: true }))) as any).ok).toBe(true);
    expect((await h.op("omniful_stock")).expired).toBe(true);
  });

  it("the admin push: no id 400, not set up 409, no such order 404", async () => {
    const h = await empowerHarness();
    expect(await err(pushOne(h.deps, { id: "x" }))).toMatchObject({ status: 400, error: "no_id" });
    expect(await err(pushOne(h.deps, { id: "LM-1234567" }))).toMatchObject({ status: 404, error: "no_such_order" });
    const off = await empowerHarness({ env: { OMNIFUL_API_TOKEN: "" } });
    expect(await err(pushOne(off.deps, { id: "LM-1234567" }))).toMatchObject({ status: 409, error: "omniful_not_configured" });
  });

  it("adopt is idempotent and does not walk an order back", async () => {
    const h = await empowerHarness();
    const o = await h.order({ status: "ship" });
    const r: any = await adopt(h.deps, o, o.id, "R1", "test");
    expect(r.status).toBe("ship");
    await adopt(h.deps, o, o.id, "R1", "test");
    expect((await h.rows(o.id)).length).toBe(1);
  });

  it("cancelPushed reports a database failure plainly", async () => {
    const h = await empowerHarness();
    const r = await cancelPushed(h.deps, "LM-1");
    expect(r).toEqual({ skipped: "not_pushed" });
  });
});
