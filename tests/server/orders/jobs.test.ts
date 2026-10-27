/**
 * The orders area's jobs: retention (personal data, 12 months) and maintenance (the purges).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "../../helpers/harness";
import { claims, logs, orders, rateLimits, webhookEvents } from "../../../src/server/db/schema";
import { getOp } from "../../../src/server/core/ops";
import { JOBS, runJob } from "../../../src/server/jobs";
import { BROWSER_LOG_CAP, LOG_CAP, monthsAgo, runMaintenance, runRetention, scrubGateway } from "../../../src/server/jobs/orders";
import * as A from "../../../src/server/domain/order-admin";
import { seedOrders } from "./fixtures";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => h.reset());
afterAll(async () => h.reset());

const get = async (id: string) => (await h.db.select().from(orders).where(eq(orders.id, id)))[0]!;
const DAY = 86400e3;

describe("retention", () => {
  it("is registered: daily, and hourly maintenance", () => {
    expect(JOBS.retention?.everyMin).toBe(1440);
    expect(JOBS.maintenance?.everyMin).toBe(60);
  });

  // from DATA.md retention + 2026-10-pii-retention.sql / 2026-10-fixes.sql (purge_order_pii)
  it("clears the customer on orders delivered or cancelled more than 12 months ago; keeps the money and the key", async () => {
    const t = h.clock.t;
    const old = new Date(t - 400 * DAY);
    await seedOrders(h, [
      { id: "LM-0001", status: "done", createdAt: old, deliveredAt: old, client: { ip: "1.2.3.4", fbp: "fb.1.1.1" },
        gateway: { session: { metadata: { order_id: "LM-0001", customer: "Ahmed", phone: "+971", city: "Dubai" } }, client: { ip: "1.2.3.4" } } },
      { id: "LM-0002", status: "void", createdAt: old },
      { id: "LM-0003", status: "new", createdAt: old }, // still open: kept whatever its age
      { id: "LM-0004", status: "done", createdAt: new Date(t - 300 * DAY) },
      { id: "LM-0005", status: "done", createdAt: old, deliveredAt: new Date(t - 30 * DAY) }, // delivered last month
      { id: "LM-0006", status: "done", createdAt: old, phoneKey: null, phone: "+٩٦٨ ٩١٢٣ ٤٥٦٧", countryCode: "OM" },
    ]);
    const r = await runRetention(h.deps);
    expect(r).toEqual({ cleared: 3, more: false });
    const a = await get("LM-0001");
    expect([a.name, a.phone, a.email, a.city, a.region, a.note, a.client]).toEqual([null, null, null, null, null, null, null]);
    expect([a.total, a.omr, a.items.length, a.status, a.phoneKey, a.piiClearedAt?.getTime()]).toEqual([260, 27.222, 1, "done", "971501234567", t]);
    expect(a.gateway).toEqual({ session: { metadata: { order_id: "LM-0001" } } });
    expect((await get("LM-0002")).name).toBe(null);
    for (const id of ["LM-0003", "LM-0004", "LM-0005"]) expect((await get(id)).name).toBe("Ahmed Al Balushi");
    // an older row with no key: derived (Arabic digits read) before the phone goes
    expect([(await get("LM-0006")).phoneKey, (await get("LM-0006")).phone]).toEqual(["96891234567", null]);
    // run again: nothing left to do
    expect(await runRetention(h.deps)).toEqual({ cleared: 0, more: false });
  });

  it("the repeat-customer figure survives the purge (the key is kept)", async () => {
    const old = new Date(h.clock.t - 400 * DAY);
    await seedOrders(h, [{ id: "LM-0011", status: "done", createdAt: old, deliveredAt: old }, { id: "LM-0012" }]);
    await runRetention(h.deps);
    const c = (await A.listCustomers(h.deps)).customers;
    expect(c.length).toBe(1);
    expect([c[0]!.orders, c[0]!.live, c[0]!.name]).toEqual([2, 2, "Ahmed Al Balushi"]);
  });

  it("runs through runJob and is on record", async () => {
    await runJob(h.deps, "retention");
    const rec = await getOp<Record<string, unknown>>(h.db, "job:retention");
    expect(rec?.data).toMatchObject({ cleared: 0 });
  });

  it("monthsAgo / scrubGateway", () => {
    expect(monthsAgo(Date.parse("2026-10-20T08:00:00Z"), 12).toISOString()).toBe("2025-10-20T08:00:00.000Z");
    expect(scrubGateway({ client: { ip: "x" }, paid: { metadata: { name: "a", order_id: "LM-1" }, amount: 1 } })).toEqual({ paid: { metadata: { order_id: "LM-1" }, amount: 1 } });
  });
});

describe("maintenance", () => {
  it("purges old logs, webhook deliveries, claims and spent rate-limit counters", async () => {
    const t = h.clock.t;
    await h.db.insert(logs).values([
      { at: new Date(t - 61 * DAY), message: "old" },
      { at: new Date(t - 59 * DAY), message: "kept" },
    ]);
    await h.db.insert(webhookEvents).values([
      { receivedAt: new Date(t - 91 * DAY), provider: "thawani", payload: {} },
      { receivedAt: new Date(t - 89 * DAY), provider: "thawani", payload: {} },
    ]);
    await h.db.insert(claims).values([
      { key: "purchase-LM-1", at: new Date(t - 61 * DAY) },
      { key: "purchase-LM-2", at: new Date(t - DAY) },
    ]);
    await h.db.insert(rateLimits).values([
      { key: "order:old", count: 3, resetAt: new Date(t - 2 * 3600e3) },
      { key: "order:now", count: 3, resetAt: new Date(t + 600e3) },
    ]);
    const r = await runMaintenance(h.deps);
    expect(r).toEqual({ logs: 1, webhookEvents: 1, claims: 1 });
    expect((await h.db.select().from(logs)).map((l) => l.message)).toEqual(["kept"]);
    expect((await h.db.select().from(claims)).map((c) => c.key)).toEqual(["purchase-LM-2"]);
    expect((await h.db.select().from(rateLimits)).map((c) => c.key)).toEqual(["order:now"]);
  });

  // from test-v336-server.js §6 / 2026-10-storefront.sql: the browser's rows are capped apart from the server's
  it("caps the browser's rows apart, so a flood cannot push the server's out", async () => {
    const t = h.clock.t;
    await h.db.insert(logs).values([{ at: new Date(t), side: "server", message: "server error" }]);
    const n = BROWSER_LOG_CAP + 30;
    for (let i = 0; i < n; i += 5000) {
      await h.db.insert(logs).values(Array.from({ length: Math.min(5000, n - i) }, (_, k) => ({ at: new Date(t), side: "browser", message: "b" + (i + k) })));
    }
    const r = await runMaintenance(h.deps);
    expect(r.logs).toBe(30);
    const left = await h.db.select({ side: logs.side, message: logs.message }).from(logs);
    expect(left.filter((l) => l.side === "browser").length).toBe(BROWSER_LOG_CAP);
    expect(left.some((l) => l.message === "server error")).toBe(true);
    expect(left.some((l) => l.message === "b0")).toBe(false); // the oldest went
    expect(LOG_CAP).toBe(20000);
  }, 60_000);
});
