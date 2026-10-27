import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { orders, shipments, webhookEvents } from "../../../src/server/db/schema";
import { runJob } from "../../../src/server/jobs";
import { applyHook, pollStatuses, POLL_MAX } from "../../../src/server/domain/empower/sync";
import { pushOne, syncNow, takeOff } from "../../../src/server/domain/empower/admin";
import { empowerHarness } from "./_helpers";

const SECRET = "hook-secret-for-tests";

describe("the webhook endpoint", () => {
  // from test-omniful.js / test-v327.js / test-v334.js: the hook
  it("is closed (404) with no secret set, and to a wrong or missing key", async () => {
    const closed = await empowerHarness({ env: { OMNIFUL_HOOK_SECRET: "" } });
    let res = await closed.post("/api/omniful/hook?k=anything", { data: { order_id: "LM-1", order_status: "delivered" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false });
    const h = await empowerHarness({ env: { OMNIFUL_HOOK_SECRET: SECRET } });
    res = await h.post("/api/omniful/hook?k=wrong", {});
    expect(res.status + " " + JSON.stringify(await res.json())).toBe('404 {"ok":false}');
    res = await h.post("/api/omniful/hook", {});
    expect(res.status).toBe(404);
    res = await h.request("/api/omniful/hook?k=" + SECRET);
    expect(res.status + " " + (await res.json()).error).toBe("405 method_not_allowed");
    res = await h.request("/api/omniful/hook", { method: "OPTIONS" });
    expect(res.status).toBe(204);
  });

  it("a trusted caller always gets 200 — bad JSON, nonsense, somebody else's order", async () => {
    const h = await empowerHarness({ env: { OMNIFUL_HOOK_SECRET: SECRET } });
    let res = await h.request("/api/omniful/hook?k=" + SECRET, { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
    expect(res.status + " " + JSON.stringify(await res.json())).toBe('200 {"ok":false,"error":"bad_json"}');
    res = await h.post("/api/omniful/hook?k=" + SECRET, {});
    expect(res.status + " " + JSON.stringify(await res.json())).toBe('200 {"ok":true,"ignored":"no_order_reference"}');
    res = await h.post("/api/omniful/hook?k=" + SECRET, { data: { order_id: "LM-999999", order_status: "packed" } });
    expect(await res.json()).toEqual({ ok: true, ignored: "unknown_order", orderId: "LM-999999" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("moves the order with its parcel, puts their waybill on it, and records the delivery", async () => {
    const h = await empowerHarness({ env: { OMNIFUL_HOOK_SECRET: SECRET } });
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order();
    await pushOne(h.deps, { id: o.id });
    h.omf.advance(o.id, "out_for_delivery", { awb: "AWB77", carrier: "Aramex" });
    const payload = h.omf.hookPayload(o.id);
    let res = await h.post("/api/omniful/hook?k=" + SECRET, payload);
    const j = await res.json();
    expect(res.status + " " + j.ok + " " + j.stage + " " + j.moved).toBe("200 true transit ship");
    const row = (await h.rows(o.id))[0]!;
    expect([row.status, row.reference, row.awb, row.courierName]).toEqual(["out for delivery", "OMF-1", "AWB77", "Aramex"]);
    expect(row.pickedUpAt).not.toBe(null);
    const ord = await h.get(o.id);
    expect(ord.status + " " + ord.tracking).toBe("ship AWB77");
    const ev = await h.db.select().from(webhookEvents);
    expect(ev.length).toBe(1);
    expect(ev[0]).toMatchObject({ provider: "omniful", orderId: o.id, verified: true, applied: "applied" });
    expect(ev[0]!.dedupeKey).toMatch(/^omniful:[0-9a-f]{64}$/);
    // the same delivery twice is one record, applied harmlessly
    res = await h.post("/api/omniful/hook?k=" + SECRET, payload);
    expect(res.status).toBe(200);
    expect((await h.db.select().from(webhookEvents)).length).toBe(1);
  });
});

describe("what Omniful tells us", () => {
  // from test-v185.js: Omniful status moves the order (forward only)
  it("shipped → Shipped, delivered → Delivered, never back; a cancelled order is not moved", async () => {
    const h = await empowerHarness();
    const o1 = await h.order({ status: "prep" });
    const o3 = await h.order({ status: "void" });
    for (const o of [o1, o3]) await h.db.insert(shipments).values({ id: "omf-" + o.id, orderId: o.id, carrier: "empower", sentId: o.id, reference: "R-" + o.id, status: "Sent to Omniful" });
    let r: any = await applyHook(h.deps, { data: { order_id: o1.id, order_status: "shipped", awb_number: "AWB1" } });
    expect((await h.get(o1.id)).status + " " + r.moved).toBe("ship ship");
    expect((await h.get(o1.id)).tracking).toBe("AWB1");
    await applyHook(h.deps, { data: { order_id: o1.id, order_status: "delivered" } });
    expect((await h.get(o1.id)).status).toBe("done");
    expect((await h.get(o1.id)).deliveredAt).not.toBe(null);
    await applyHook(h.deps, { data: { order_id: o1.id, order_status: "shipped" } });
    expect((await h.get(o1.id)).status).toBe("done");
    await applyHook(h.deps, { data: { order_id: o3.id, order_status: "delivered" } });
    expect((await h.get(o3.id)).status).toBe("void");
  });

  // from test-v314.js: a late status never walks a delivered parcel back
  it("a late 'picked up' after delivery is ignored", async () => {
    const h = await empowerHarness();
    const o = await h.order({ status: "done" });
    await h.db.insert(shipments).values({ id: "omf-" + o.id, orderId: o.id, carrier: "empower", sentId: o.id, status: "delivered", deliveredAt: new Date(h.clock.t), reference: "R4" });
    const r: any = await applyHook(h.deps, { data: { order_id: o.id, order_status: "picked_up" } });
    expect(r.ignored + " " + (await h.rows(o.id))[0]!.status).toBe("already_delivered delivered");
  });

  // from test-v334.js: a delivered hook whose order move failed; the redelivery moves it
  it("a repeat of 'delivered' puts a lost order move right", async () => {
    const h = await empowerHarness();
    const o = await h.order({ status: "prep" });
    await h.db.insert(shipments).values({ id: "omf-" + o.id, orderId: o.id, carrier: "empower", sentId: o.id, status: "Sent to Omniful" });
    const spy = vi.spyOn(h.db, "transaction").mockRejectedValueOnce(new Error("503"));
    await applyHook(h.deps, { data: { order_id: o.id, order_status: "delivered" } });
    spy.mockRestore();
    expect((await h.get(o.id)).status).toBe("prep");
    const r: any = await applyHook(h.deps, { data: { order_id: o.id, order_status: "delivered" } });
    expect(r.ignored).toBe("already_delivered");
    expect((await h.get(o.id)).status).toBe("done");
  });

  // from test-v447.js: a delivery that did not happen
  it("failures and returns are not read as delivered, and move nothing", async () => {
    const h = await empowerHarness();
    const o = await h.order({ status: "prep" });
    await h.db.insert(shipments).values({ id: "omf-" + o.id, orderId: o.id, carrier: "empower", sentId: o.id, reference: "R1", status: "Sent to Omniful" });
    for (const s of ["Undelivered", "Failed to deliver", "RTO Delivered"]) {
      const r: any = await applyHook(h.deps, { data: { order_id: o.id, order_status: s } });
      expect(r.moved).toBe(null);
    }
    const row = (await h.rows(o.id))[0]!;
    expect(row.deliveredAt).toBe(null);
    expect((await h.get(o.id)).status).toBe("prep");
    // the return is over: the poll no longer asks about it
    const r: any = await pollStatuses(h.deps);
    expect(r.considered).toBe(0);
  });

  // from test-v402.js: Omniful's news about an order we never wrote down
  it("records an order of ours from its first news; never one with another parcel, nor one we do not have", async () => {
    const h = await empowerHarness();
    const o8 = await h.order();
    const hk: any = await applyHook(h.deps, { data: { order_id: o8.id, order_status: "packed", id: "OMF-80" } });
    expect(hk.ok + " " + (await h.rows(o8.id)).length + " " + (await h.get(o8.id)).status).toBe("true 1 prep");
    expect((await h.rows(o8.id))[0]!.reference).toBe("OMF-80");
    const o9 = await h.order();
    await h.db.insert(shipments).values({ id: "manual-9", orderId: o9.id, carrier: "manual", sentId: "x", status: "Booked" });
    const hk2: any = await applyHook(h.deps, { data: { order_id: o9.id, order_status: "packed" } });
    expect(hk2.ignored + " " + (await h.rows(o9.id)).length).toBe("unknown_order 1");
    expect(((await applyHook(h.deps, { data: { order_id: "LM-999999", order_status: "packed" } })) as any).ignored).toBe("unknown_order");
  });

  it("clears the unsure note when it adopts; never adopts a send we took off, nor news that it is cancelled", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o = await h.order();
    await h.setOp("omniful_unsure", { [o.id]: { sentId: o.id, at: "x" } });
    await applyHook(h.deps, { data: { order_id: o.id, order_status: "new" } });
    expect((await h.op("omniful_unsure"))[o.id]).toBe(undefined);
    await takeOff(h.deps, { id: o.id, markOnly: true });
    const r: any = await applyHook(h.deps, { data: { order_id: o.id, order_status: "packed" } });
    expect(r.ignored).toBe("retired_id");
    const o2 = await h.order();
    expect(((await applyHook(h.deps, { data: { order_id: o2.id, order_status: "cancelled" } })) as any).ignored).toBe("retired_id");
    expect(await h.rows(o2.id)).toEqual([]);
  });
});

describe("the status poll", () => {
  // from test-v185.js: the check asks only about parcels in flight
  it("asks about parcels still in flight, by their id, and the answer reaches the parcel it was sent as", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const a = await h.order();
    const b = await h.order();
    const c = await h.order();
    await pushOne(h.deps, { id: a.id });
    await pushOne(h.deps, { id: b.id });
    await takeOff(h.deps, { id: b.id });
    await pushOne(h.deps, { id: b.id }); // b goes as -2
    await pushOne(h.deps, { id: c.id });
    await applyHook(h.deps, { data: { order_id: a.id, order_status: "delivered" } });
    h.omf.advance(b.id + "-2", "out_for_delivery", { awb: "AWB2" });
    // c has no Omniful id recorded: the poll cannot ask
    await h.db.update(shipments).set({ reference: null }).where(eq(shipments.orderId, c.id));
    h.world.calls.length = 0;
    const res: any = await syncNow(h.deps);
    const asked = h.world.calls.filter((x) => /seller\/orders\//.test(x.path)).map((x) => x.path.split("/").pop());
    expect(asked).toEqual([(await h.rows(b.id))[0]!.reference]);
    expect((await h.rows(b.id))[0]!.status).toBe("Out For Delivery");
    expect((await h.rows(b.id))[0]!.id).toBe("omf-" + b.id + "-2");
    expect((await h.get(b.id)).status).toBe("ship");
    expect((await h.get(b.id)).tracking).toBe("AWB2");
    expect(res.tracked + "/" + res.updated + "/" + res.moved).toBe("1/1/1");
    expect(await h.op("omniful_poll")).toMatchObject({ tracked: 1, updated: 1, moved: 1 });
    const again: any = await pollStatuses(h.deps, { max: 10 });
    expect(again.updated).toBe(0);
    // the poll never pushes
    expect(h.world.calls.filter((x) => x.method === "POST" && /orders$/.test(x.path)).length).toBe(0);
  });

  it("up to six, least recently checked first; one it cannot answer about goes to the back", async () => {
    const h = await empowerHarness();
    expect(POLL_MAX).toBe(6);
    for (let i = 0; i < 8; i++) {
      const o = await h.order({ status: "prep" });
      await h.db.insert(shipments).values({
        id: "omf-" + o.id, orderId: o.id, carrier: "empower", sentId: o.id, reference: "GONE-" + i, status: "Sent to Omniful",
        syncedAt: new Date(h.clock.t - (100 - i) * 60e3),
      });
    }
    const r: any = await pollStatuses(h.deps);
    expect(r.considered + " " + r.tracked + " " + r.errors.length).toBe("6 0 6");
    expect(r.errors[0]).toMatchObject({ error: "omniful_rejected", detail: "not found" });
    h.world.calls.length = 0;
    h.clock.advance(1000);
    await pollStatuses(h.deps);
    const asked = h.world.calls.filter((x) => /seller\/orders\//.test(x.path)).map((x) => x.path.split("/").pop());
    expect(asked.slice(0, 2)).toEqual(["GONE-6", "GONE-7"]);
  });

  it("the scheduled poll records what it did, naming no order ids", async () => {
    const h = await empowerHarness();
    const r = await runJob(h.deps, "empower-poll");
    expect(r).toMatchObject({ ok: true, tracked: 0, updated: 0, moved: 0, errors: [] });
    expect(await h.op("omniful_poll")).toMatchObject({ tracked: 0, considered: 0 });
    const off = await empowerHarness({ env: { OMNIFUL_API_TOKEN: "" } });
    expect(await runJob(off.deps, "empower-poll")).toEqual({ ok: true, skipped: "not_configured" });
    expect(await off.op("omniful_poll")).toEqual({ skipped: "not_configured" });
  });

  it("poll moves nothing for a trashed order", async () => {
    const h = await empowerHarness();
    const o = await h.order({ status: "prep" });
    await h.db.insert(shipments).values({ id: "omf-" + o.id, orderId: o.id, carrier: "empower", sentId: o.id, status: "x" });
    await h.db.update(orders).set({ trashed: true }).where(eq(orders.id, o.id));
    await applyHook(h.deps, { data: { order_id: o.id, order_status: "delivered" } });
    expect((await h.get(o.id)).status).toBe("prep");
  });
});
