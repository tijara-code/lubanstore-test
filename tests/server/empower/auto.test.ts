import { describe, expect, it } from "vitest";
import { shipments } from "../../../src/server/db/schema";
import { JOBS, runJob } from "../../../src/server/jobs";
import { autoPush, AUTO_AFTER_MIN, AUTO_EVERY_MIN, AUTO_MAX, AUTO_RETRY_H } from "../../../src/server/domain/empower/push";
import { autoSwitch, waitingList } from "../../../src/server/domain/empower/admin";
import { HttpError } from "../../../src/server/core/http";
import { catalogueChanges } from "../../../src/server/db/schema";
import { empowerHarness } from "./_helpers";

const tick = (h: { deps: any }) => runJob(h.deps, "empower-auto");

describe("the Empower auto push", () => {
  // from test-v316.js (with v338's three minutes, a run every minute)
  it("off by default; on, it sends complete website orders three minutes old, holds and flags the rest", async () => {
    const h = await empowerHarness({ routes: { AE: "manual" } });
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const o1 = await h.order({ id: "LM-900001" });
    await h.order({ id: "LM-900002", region: "" });
    await h.order({ id: "LM-900003", phone: "+966 5012" });
    await h.order({ id: "LM-900004", createdAt: h.ago(5) });
    await h.order({ id: "LM-900005", origin: "whatsapp_order" });
    await h.order({ id: "LM-900006", countryCode: "AE", phone: "+971 501234567", cur: "AED" });
    await h.order({ id: "LM-900007", status: "pending", pay: "card", paymentStatus: "unpaid" });
    await h.order({ id: "LM-900008", createdAt: h.ago(2) });

    let r: any = await tick(h);
    expect(r.skipped + " " + h.posts().length).toBe("off 0");
    expect(await h.op("omniful_auto_run")).toBe(undefined);
    r = await autoSwitch(h.deps, {});
    expect([r.on, r.afterMin, r.everyMin, r.retryH].join(" ")).toBe("false 3 1 6");
    r = await autoSwitch(h.deps, { on: true });
    expect(r.on).toBe(true);
    const log = await h.db.select().from(catalogueChanges);
    expect(log.some((c) => /Empower auto push on/.test(c.what))).toBe(true);

    r = await tick(h);
    expect(r).toEqual({ ok: true, skipped: undefined, pushed: 2, flagged: 2, failed: 0, ms: 0 });
    expect(h.posts()).toEqual(["LM-900001", "LM-900004"]);
    expect((await h.get(o1.id)).status).toBe("prep");
    const run = await h.op("omniful_auto_run");
    expect(run.flagged).toEqual([{ id: "LM-900002", missing: ["area"] }, { id: "LM-900003", missing: ["phone"] }]);
    await tick(h);
    expect(h.posts()).toEqual(["LM-900001", "LM-900004"]);

    // fixed, then sent
    await h.db.execute(("update orders set region = 'حي الملقا' where id = 'LM-900002'") as never);
    await tick(h);
    expect(h.posts()).toEqual(["LM-900001", "LM-900004", "LM-900002"]);
    // two more minutes and the newest is old enough
    h.clock.advance(2 * 60e3);
    await tick(h);
    expect(h.posts().slice(-1)[0]).toBe("LM-900008");

    // the Waiting list flags what is missing, and leaves a complete order unflagged
    const w = await waitingList(h.deps);
    const by = (id: string) => w.orders.find((o) => o.id === id);
    expect(by("LM-900003")!.check).toEqual(["phone"]);
    expect(by("LM-900005")!.check).toBe(undefined);
    expect(by("LM-900006")).toBe(undefined); // shipped by hand: not Empower's waiting list
    expect(by("LM-900005")!.lines).toEqual([{ code: "oud-large", sku: "LM3001", qty: 1 }]);

    // switched off
    await autoSwitch(h.deps, { on: false });
    await h.order({ id: "LM-900010" });
    const before = h.posts().length;
    r = await tick(h);
    expect(r.skipped + " " + (h.posts().length - before)).toBe("off 0");
    expect([AUTO_AFTER_MIN, AUTO_EVERY_MIN, AUTO_RETRY_H, AUTO_MAX]).toEqual([3, 1, 6, 10]);
    expect(JOBS["empower-auto"]!.everyMin).toBe(1);
    expect(JOBS["empower-poll"]!.everyMin).toBe(30);
  });

  it("the switch cannot be turned on while Omniful is not set up", async () => {
    const h = await empowerHarness({ env: { OMNIFUL_API_TOKEN: "" } });
    await expect(autoSwitch(h.deps, { on: true })).rejects.toBeInstanceOf(HttpError);
    expect((await autoSwitch(h.deps, { on: false })).on).toBe(false);
  });

  // from test-v319.js: a box with no Empower code is held back
  it("holds back an order with a box that has no code, flagged 'sku', and sends the complete ones", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    await h.setOp("omniful_auto", { on: true });
    await h.order({ id: "LM-1000001" });
    await h.order({ id: "LM-1000007", items: [{ itemId: "oud-large", scent: "", size: "", qty: 1, price: 20 }, { itemId: "burner", scent: "", size: "", qty: 1, price: 5 }] });
    const run: any = await autoPush(h.deps, {});
    expect(run.flagged.find((x: any) => x.id === "LM-1000007").missing.join(",")).toBe("sku");
    expect(run.ids).toEqual(["LM-1000001"]);
    const w = await waitingList(h.deps);
    const l7 = w.orders.find((o) => o.id === "LM-1000007")!;
    expect(JSON.stringify(l7.check) + " " + JSON.stringify(l7.skuMissing)).toBe('["sku"] ["burner"]');
  });

  it("an order Omniful refused waits six hours", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    await h.setOp("omniful_auto", { on: true });
    h.omf.knownSkus = ["OTHER"];
    await h.order({ id: "LM-1100001" });
    await tick(h);
    expect(h.posts().length).toBe(1);
    const run = await h.op("omniful_auto_run");
    expect(run.failed.map((f: any) => f.id + ":" + f.error)).toEqual(["LM-1100001:omniful_rejected"]);
    h.omf.knownSkus = null;
    h.clock.advance(60e3);
    await tick(h);
    expect(h.posts().length).toBe(1);
    expect((await h.op("omniful_auto_run")).failed.length).toBe(1);
    h.clock.advance(6 * 3600e3);
    await tick(h);
    expect(h.posts().length).toBe(2);
    expect((await h.get("LM-1100001")).status).toBe("prep");
  });

  // from test-v402.js: the auto run
  it("moves an order already on Empower to Preparing, and records a no-answer push on the next run", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    await h.setOp("omniful_auto", { on: true });
    const o6 = await h.order({ id: "LM-910006" });
    await h.db.insert(shipments).values({ id: "omf-" + o6.id, orderId: o6.id, carrier: "empower", sentId: o6.id, status: "Sent to Omniful" });
    await h.order({ id: "LM-910007", createdAt: h.ago(5) });
    h.omf.dropAnswer = (id) => id === "LM-910007";
    await tick(h);
    h.omf.dropAnswer = null;
    expect((await h.get("LM-910006")).status).toBe("prep");
    expect(h.posts().filter((x) => x === "LM-910006").length).toBe(0);
    const run1 = await h.op("omniful_auto_run");
    expect(run1.healed).toBe(1);
    expect((run1.failed || []).some((f: any) => f.id === "LM-910007")).toBe(false);
    h.clock.advance(60e3);
    await tick(h);
    expect((await h.get("LM-910007")).status).toBe("prep");
    expect((await h.rows("LM-910007")).length).toBe(1);
    expect(Object.keys(h.omf.orders).filter((k) => k === "LM-910007").length).toBe(1);
  });

  it("sends at most ten a run, oldest first", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    await h.setOp("omniful_auto", { on: true });
    for (let i = 0; i < 12; i++) await h.order({ id: "LM-12000" + String(i).padStart(2, "0"), createdAt: h.ago(60 - i) });
    await tick(h);
    expect(h.posts().length).toBe(10);
    expect(h.posts()[0]).toBe("LM-1200000");
  });

  it("no Empower market routed: nothing is read", async () => {
    const h = await empowerHarness({ routes: { AE: "manual", SA: "manual", QA: "manual", OM: "manual", BH: "manual", KW: "manual" } });
    await h.setOp("omniful_auto", { on: true });
    expect(await autoPush(h.deps)).toEqual({ skipped: "no_market_routed" });
  });
});
