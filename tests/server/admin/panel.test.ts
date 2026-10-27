import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminAudit, catalogueChanges, events, ops } from "../../../src/server/db/schema";
import { getOpData } from "../../../src/server/core/ops";
import { createHarness, type Harness } from "../../helpers/harness";
import { seedOrders } from "../orders/fixtures";
import { adminClient, trail, type AdminClient } from "./_helpers";

let h: Harness;
let a: AdminClient;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  a = await adminClient(h);
});
const actions = async () => (await trail(h)).map((r) => r.action).filter((x) => x !== "session.login");

describe("panel settings", () => {
  // from test-v211.js: pages shown in the nav, shared by every admin, stored server-side
  it("hides pages: Overview and unknown names dropped, the canonical order, the old names read", async () => {
    expect((await a.get("/settings/ui")).body).toEqual({ ok: true, ui: { hidden: [] }, dismissed: [] });
    const r = await a.put("/settings/ui", { hidden: ["stats", "overview", "nope", "local"] });
    expect(r.body).toEqual({ ok: true, ui: { hidden: ["analytics"] }, dismissed: [] });
    expect(await getOpData(h.db, "admin_ui", {})).toEqual({ hidden: ["analytics"], dismissed: [] });
    expect((await a.get("/settings/ui")).body.ui.hidden).toEqual(["analytics"]);
    const r2 = await a.put("/settings/ui", { hidden: ["empower", "orders", "pay"] });
    expect(r2.body.ui.hidden).toEqual(["orders", "payments", "empower"]);
  });

  // from test-v411.js §2: a dismissed warning never comes back
  it("keeps only well-formed dismissed codes; each part of a save changes only itself", async () => {
    await a.put("/settings/ui", { hidden: ["payments"] });
    const long = "warn:" + "x".repeat(95);
    const r = await a.put("/settings/ui", { dismissed: ["warn:omniful_hook_unsigned", "schema:14", "bad code", long] });
    expect(r.body).toEqual({ ok: true, ui: { hidden: ["payments"] }, dismissed: ["warn:omniful_hook_unsigned", "schema:14"] });
    expect((await a.get("/settings/ui")).body).toEqual(r.body);
    expect(await actions()).toEqual(["settings.ui", "settings.ui"]);
  });
});

describe("the Overview", () => {
  // from test-v333.js: KPI total = every order not in the trash; "33% of all orders"
  it("adds up every order not binned, all time and this week", async () => {
    await seedOrders(h, [
      { id: "LM-1000000001", omr: 10 },
      { id: "LM-1000000002", omr: 20, status: "done", paymentStatus: "paid" },
      { id: "LM-1000000003", omr: 30, status: "void" },
      { id: "LM-1000000004", omr: 999, trashed: true },
    ]);
    const r = await a.get("/overview");
    expect(r.status).toBe(200);
    const o = r.body.orders;
    expect(o.n).toBe(3);
    expect(o.all.total).toBe(3);
    expect(o.all.orders).toBe(2);
    expect(o.all.gross).toBe(30);
    expect(o.all.cancelledPct).toBe(33);
    expect(o.week.orders).toBe(2);
    expect(typeof o.delta).toBe("number");
    expect(Object.keys(o.byDay).length).toBe(30);
    expect((await a.get("/orders/summary")).body.all.total).toBe(3);
  });

  // from test-v408.js §2 / test-v411.js §2: warnings by code, dismissed server-side
  it("codes the warnings; a dismissed one stays gone, a missing key cannot be dismissed", async () => {
    const h2 = await createHarness({ env: { OMNIFUL_HOOK_SECRET: "", THAWANI_WEBHOOK_SECRET: "" } });
    const b = await adminClient(h2);
    let r = await b.get("/overview");
    const codes = r.body.warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain("warn:omniful_hook_unsigned");
    // every job has never run: stale
    expect(codes).toContain("stale:admin-audit");
    expect(r.body.warnings.find((w: { code: string }) => w.code === "warn:thawani_webhook_secret_missing")).toMatchObject({ dismissible: false });
    await b.put("/settings/ui", { dismissed: ["warn:omniful_hook_unsigned", "stale:admin-audit", "warn:thawani_webhook_secret_missing"] });
    r = await b.get("/overview");
    const after = r.body.warnings.map((w: { code: string }) => w.code);
    expect(after).not.toContain("warn:omniful_hook_unsigned");
    expect(after).not.toContain("stale:admin-audit");
    expect(r.body.dismissedN).toBe(2);
    // a key that is missing is not a notice: it stays
    expect(after).toContain("warn:thawani_webhook_secret_missing");
    expect(r.body.health.db.ok).toBe(true);
  });
});

describe("analytics", () => {
  it("answers the summary, live, busy hours and tracking health", async () => {
    await h.db.insert(events).values([
      { at: new Date(h.clock.t - 60e3), name: "page_view", sid: "s1", country: "OM", city: "Muscat", lat: 23.6, lng: 58.4 },
      { at: new Date(h.clock.t - 30e3), name: "add_cart", item: "oud-large", sid: "s1", country: "OM" },
    ]);
    const s = await a.get("/analytics/summary?range=7");
    expect(s.status).toBe(200);
    expect(s.body.ok).toBe(true);
    const l = await a.get("/analytics/live?minutes=60");
    expect(l.body.ok).toBe(true);
    const b = await a.get("/analytics/busy?weekday=every&metric=visits");
    expect(b.body).toMatchObject({ ok: true, metric: "visits", weekday: "every" });
    expect(b.body.hours).toHaveLength(24);
    expect((await a.get("/analytics/tracking")).body).toMatchObject({ ok: true, warnings: [] });
    expect((await a.get("/analytics/links")).body.ok).toBe(true);
    expect((await a.get("/analytics/summary?range=forever")).status).toBe(400);
  });

  it("lists errors and exports them as CSV", async () => {
    await h.deps.log.error("http", "something broke", { path: "/api/x" });
    const r = await a.get("/analytics/errors?days=7");
    expect(r.body.rows.map((x: { message: string }) => x.message)).toContain("something broke");
    const res = await h.request("/api/admin/analytics/errors.csv?days=7", { headers: { cookie: a.cookie } });
    expect(res.headers.get("content-disposition")).toContain('filename="errors-7d.csv"');
    expect(await res.text()).toContain("something broke");
  });

  // from test-v333.js: changes.clear empties the log, leaves the store alone, is on the trail
  it("lists, deletes and clears the storefront changes; resets analytics only when named", async () => {
    await h.db.insert(catalogueChanges).values([
      { at: new Date(h.clock.t - 86400e3), actor: "shopkeeper", what: "AE small 120→110 AED" },
      { at: new Date(h.clock.t - 3600e3), actor: "shopkeeper", what: "bundle off" },
    ]);
    const list = await a.get("/analytics/changes?winDays=7");
    expect(list.body.changes.map((c: { what: string }) => c.what)).toEqual(["bundle off", "AE small 120→110 AED"]);
    const id = list.body.changes[0].id;
    expect((await a.del("/analytics/changes/" + id)).body).toEqual({ ok: true, id });
    expect((await a.del("/analytics/changes/" + id)).status).toBe(404);
    expect((await a.post("/analytics/changes/clear", {})).status).toBe(400);
    expect((await a.post("/analytics/changes/clear", { confirm: "changes" })).body).toEqual({ ok: true, deleted: 1, left: 0 });
    expect((await h.db.select().from(catalogueChanges)).length).toBe(0);
    await h.db.insert(events).values([{ name: "page_view", sid: "s1" }]);
    expect((await a.post("/analytics/reset", { confirm: "orders" })).status).toBe(400);
    expect((await a.post("/analytics/reset", { confirm: "events" })).body).toEqual({ ok: true, deleted: 1 });
    expect(await actions()).toEqual(["changes.delete", "changes.clear", "analytics.reset"]);
  });
});

describe("payments, Empower and the Stock Tracker", () => {
  it("lists card payments without asking Thawani on the quiet refresh", async () => {
    await seedOrders(h, [{ id: "LM-1000000001", pay: "card", paymentStatus: "paid", invoiceNo: "12345678901234", omr: 27.2 }]);
    h.world.calls.length = 0;
    const r = await a.get("/payments?lookups=0");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, total: 1, lookedUp: 0 });
    expect(r.body.totals).toBeTruthy();
    expect(h.world.calls.length).toBe(0);
    expect((await a.get("/payments?from=2026-10-01&to=2026-10-20")).body.total).toBe(1);
    expect((await a.get("/payments?from=2026-10-21")).body.total).toBe(0);
  });

  it("refuses a refund without a reason or a real payment", async () => {
    expect((await a.post("/payments/refund", { paymentId: "pay_abc123", reason: "" })).status).toBe(400);
    const r = await a.post("/payments/refund", { paymentId: "pay_nothere1", reason: "customer asked" });
    expect(r.body.error).toBe("no_such_payment");
    expect((await a.post("/payments/mark-paid", { id: "LM-1000000001", paymentId: "x" })).body.error).toBe("bad_input");
    expect((await a.get("/payments/ask/LM-9999999999")).body.error).toBe("no_such_order");
    expect(await actions()).toEqual([]);
  });

  it("reads the Empower tab, saves the SKU map, pushes in calls of six with `left`", async () => {
    const s = await a.get("/empower");
    expect(s.body.ok).toBe(true);
    expect(Array.isArray(s.body.routing)).toBe(true);
    expect((await a.put("/empower/skus", { skus: { "oud-large": "LM3001", "lemon-small": "" } })).body).toEqual({ ok: true, skus: { "oud-large": "LM3001" } });
    expect((await a.get("/empower/skus")).body.skus).toEqual({ "oud-large": "LM3001" });
    expect((await a.put("/empower/skus", { skus: { "bad code!": "x" } })).body.error).toBe("bad_code");
    const ids = Array.from({ length: 8 }, (_, i) => "LM-200000000" + i);
    const r = await a.post("/empower/push-many", { ids });
    expect(r.status).toBe(200);
    expect(r.body.left).toEqual(ids.slice(6));
    expect((await a.put("/empower/routes/OM", { courier: "smsa" })).status).toBe(400);
    expect((await a.put("/empower/routes/OM", { courier: "manual" })).body).toEqual({ ok: true, code: "OM", courier: "manual" });
    expect((await a.put("/empower/routes/XX", { courier: "manual" })).body.error).toBe("no_such_market");
    const st = await a.get("/stock");
    expect(st.body).toMatchObject({ ok: true });
    expect(await actions()).toEqual(["empower.skus", "empower.push_many", "empower.route"]);
  });
});

describe("audit, jobs, health", () => {
  it("runs a job by name (admin only), and the audit purge keeps 180 days", async () => {
    await h.db.insert(adminAudit).values([
      { at: new Date(h.clock.t - 200 * 86400e3), actor: "x", action: "old.thing" },
      { at: new Date(h.clock.t - 10 * 86400e3), actor: "x", action: "recent.thing" },
    ]);
    expect((await a.post("/jobs/nope/run")).status).toBe(404);
    expect((await a.post("/jobs/constructor/run")).status).toBe(404);
    const r = await a.post("/jobs/admin-audit/run");
    expect(r.body).toMatchObject({ ok: true, name: "admin-audit", result: { purged: 1, days: 180 } });
    const rest = (await trail(h)).map((x) => x.action);
    expect(rest).not.toContain("old.thing");
    expect(rest).toContain("recent.thing");
    expect(rest).toContain("jobs.run");
    const jobs = await a.get("/jobs");
    expect(jobs.body.jobs["admin-audit"]).toMatchObject({ everyMin: 1440, stale: false });
    const job = (await h.db.select().from(ops)).find((o) => o.key === "job:admin-audit");
    expect(job).toBeTruthy();
    // the trail's own window
    const list = await a.get("/audit?days=30");
    expect(list.body.rows.map((x: { action: string }) => x.action)).not.toContain("old.thing");
  });

  it("answers the full health picture (booleans, never values)", async () => {
    const r = await a.get("/health");
    expect(r.body.ok === true || r.body.ok === false).toBe(true);
    expect(r.body.gateway.configured).toBe(true);
    expect(r.text).not.toContain("fake-thawani-secret");
    expect(r.text).not.toContain("test-session-secret");
  });
});
