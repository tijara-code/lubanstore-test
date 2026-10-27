import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { logs } from "../../../src/server/db/schema";
import {
  catalogueChangeLines, clearCatalogueChanges, deleteCatalogueChange, listCatalogueChanges, liveVisitors, logsCsv, logsList, recordCatalogueChange,
} from "../../../src/server/domain/analytics";
import { createHarness } from "../../helpers/harness";
import { addEvents, addOrder } from "./_fixtures";

// from test-v338-live.js: stats.live
describe("live visitors", () => {
  it("the furthest step per visitor, no session token, newest first", async () => {
    const h = await createHarness();
    const ago = (min: number) => h.clock.t - min * 60e3;
    await addEvents(h, [
      { sid: "sidAAAA", name: "session_start", item: "instagram|paid|oct", country: "SA", city: "Riyadh", lat: 24.7, lng: 46.7, at: ago(20) },
      { sid: "sidAAAA", name: "page_view", item: "home", country: "SA", city: "Riyadh", lat: 24.7, lng: 46.7, at: ago(20) },
      { sid: "sidAAAA", name: "offer_add", item: "bundle", country: "SA", city: "Riyadh", lat: 24.7, lng: 46.7, at: ago(8) },
      { sid: "sidAAAA", name: "page_view", item: "home", country: "SA", city: "Riyadh", lat: 24.7, lng: 46.7, at: ago(1) },
      { sid: "sidBBBB", name: "page_view", item: "checkout", country: "OM", at: ago(3) },
      { sid: "sidBBBB", name: "pay_method", item: "card", country: "OM", at: ago(2) },
      { sid: "sidCCCC", name: "order_placed", item: "cod", country: "AE", city: "Dubai", lat: 25.2, lng: 55.3, at: ago(0.5) },
      { sid: "sidDDDD", name: "size_open", item: "large", country: "QA", city: "Doha", lat: 25.3, lng: 51.5, at: ago(12) },
      { sid: null, name: "page_view", item: "home", country: "KW", at: ago(1) },
    ]);
    let j = await liveVisitors(h.deps, {});
    expect(j.minutes + " " + j.visitors.length).toBe("5 3");
    const riyadh = j.visitors.find((v) => v.city === "Riyadh")!;
    expect(riyadh.stage).toBe("cart");
    expect(riyadh.src + " " + riyadh.adds + " " + riyadh.detail).toBe("instagram / paid 1 added the bundle");
    const om = j.visitors.find((v) => v.country === "OM")!;
    expect(om.stage + " " + om.detail + " " + JSON.stringify(om.ll)).toBe("checkout chose payment null");
    const ae = j.visitors.find((v) => v.country === "AE")!;
    expect(ae.stage + " " + JSON.stringify(ae.ll)).toBe("ordered [55.3,25.2]");
    expect(j.visitors.map((v) => v.country).join(",")).toBe("AE,SA,OM");
    expect(j.steps).toEqual([0, 0, 1, 1, 1]);
    expect(j.stepWords).toEqual(["landed", "viewing a box", "in the cart", "at checkout", "ordered"]);
    expect(/sid[A-D]{4}/.test(JSON.stringify(j)) || j.visitors.some((v) => "sid" in v)).toBe(false);
    expect(j.visitors[0]!.k.length).toBe(10);
    expect((await liveVisitors(h.deps, {})).visitors[0]!.k).toBe(j.visitors[0]!.k);
    j = await liveVisitors(h.deps, { minutes: 15 });
    expect(j.visitors.length + " " + j.visitors.some((v) => v.city === "Doha")).toBe("4 true");
    expect((await liveVisitors(h.deps, { minutes: 999 })).minutes).toBe(5);
    expect((await liveVisitors(h.deps, { minutes: 180 })).minutes).toBe(180);
    const today = await liveVisitors(h.deps, { minutes: "today" });
    expect(today.today).toBe(true);
    expect(today.visitors.length).toBe(4);
    expect(j.geo).toBe(true);
  });
  it("at most 300 visitors, and says when it cut", async () => {
    const h = await createHarness();
    await addEvents(h, Array.from({ length: 305 }, (_, i) => ({ sid: "sid" + i, name: "page_view", at: h.clock.t - 60e3 + i })));
    const j = await liveVisitors(h.deps, {});
    expect(j.visitors.length + " " + j.capped).toBe("300 true");
  });
});

// from test-admin-data.js: the logs, grouped, exported
describe("the error log", () => {
  it("groups by side, kind and message with the orders, counts visitors without naming them, exports oldest first", async () => {
    const h = await createHarness();
    await h.post("/api/log", { kind: "error", message: "TypeError: x is null", sid: "abcd1234", detail: "at a.js:1:2" }, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17) AppleWebKit Safari/604.1" });
    h.clock.advance(1000);
    await h.post("/api/log", { kind: "error", message: "TypeError: x is null", sid: "efgh5678" }, { "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile" });
    h.clock.advance(1000);
    await h.deps.log.error("pay-verify", "db_write_failed", { orderId: "LM-1234567", detail: { why: "statement timeout" } });
    const L = await logsList(h.deps, { days: 7 });
    expect(L.rows.length).toBe(3);
    expect(L.cap).toBe(2000);
    expect((await logsList(h.deps, { full: true })).cap).toBe(20000);
    const g = L.groups.find((x) => x.side === "browser")!;
    expect([g.kind, g.message, g.n, g.visitors, g.browsers.sort().join("|")]).toEqual(["error", "TypeError: x is null", 2, 2, "Chrome Android|iOS Safari"]);
    const srv = L.groups.find((x) => x.side === "server")!;
    expect([srv.kind, srv.message, srv.orderIds]).toEqual(["pay-verify", "db_write_failed", ["LM-1234567"]]);
    expect(JSON.stringify(L)).not.toMatch(/abcd1234|efgh5678/);
    expect((await logsList(h.deps, { side: "browser" })).rows.length).toBe(2);
    expect((await logsList(h.deps, { side: "server" })).rows.length).toBe(1);
    const csv = logsCsv(L.rows).trim().split("\n");
    expect(csv[0]).toBe("at,side,kind,message,order,page,country,browser,user agent,detail,visitor");
    expect(csv.length).toBe(4);
    expect(csv[1]).toContain("TypeError: x is null");
    expect(csv[1]).toContain("at a.js:1:2");
    expect(csv[3]).toContain("db_write_failed");
    expect(csv.join("\n")).not.toMatch(/abcd1234|efgh5678/);
    // the window (the logger stamps its own time; an old row is written here directly)
    await h.db.insert(logs).values({ at: new Date(Date.now() - 30 * 86400e3), side: "browser", source: "error", message: "old" });
    expect((await logsList(h.deps, { days: 60 })).rows.some((r) => r.message === "old")).toBe(true);
    expect((await h.db.select().from(logs).orderBy(asc(logs.id))).length).toBe(4);
  });
});

// from test-admin-data.js: what a publish changed, kept and read against the orders
describe("changes on the storefront", () => {
  it("records a publish's lines, reads them with the orders a window either side, deletes and clears", async () => {
    const h = await createHarness();
    const was = { countries: [{ code: "AE", cur: "AED", prices: { small: { now: 120 } } }], offer: { active: true } };
    const now = { countries: [{ code: "AE", cur: "AED", prices: { small: { now: 110 } } }], offer: { active: false } };
    expect(await recordCatalogueChange(h.deps, "shopkeeper", catalogueChangeLines(was, was))).toBe(false);
    for (let i = 0; i < 3; i++) await addOrder(h, { id: "LM-B" + i, createdAt: new Date(h.clock.t - (i + 1) * 86400e3) });
    expect(await recordCatalogueChange(h.deps, "shopkeeper", catalogueChangeLines(was, now))).toBe(true);
    let L = await listCatalogueChanges(h.deps, { winDays: 7 });
    expect(L.changes.length).toBe(1);
    expect(L.changes[0]).toMatchObject({ actor: "shopkeeper", what: "AE small 120→110 AED; bundle off", lines: ["AE small 120→110 AED", "bundle off"], before: 3, after: 0, counting: true, delta: null });
    await addOrder(h, { id: "LM-A1", createdAt: new Date(h.clock.t + 86400e3) });
    await addOrder(h, { id: "LM-A2", createdAt: new Date(h.clock.t + 2 * 86400e3), status: "void" });
    h.clock.advance(8 * 86400e3);
    L = await listCatalogueChanges(h.deps, { winDays: 7 });
    expect([L.changes[0]!.before, L.changes[0]!.after, L.changes[0]!.counting, L.changes[0]!.delta]).toEqual([3, 1, false, -67]);
    await recordCatalogueChange(h.deps, "job:empower", "Empower auto push on");
    L = await listCatalogueChanges(h.deps, {});
    expect(L.changes.map((c) => c.what)).toEqual(["Empower auto push on", "AE small 120→110 AED; bundle off"]);
    expect(await deleteCatalogueChange(h.deps, L.changes[0]!.id)).toBe(true);
    expect(await deleteCatalogueChange(h.deps, L.changes[0]!.id)).toBe(false);
    expect(await clearCatalogueChanges(h.deps)).toBe(1);
  });
});
