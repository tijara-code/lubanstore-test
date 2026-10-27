/**
 * The hourly `orders-expire` job: card attempts unpaid after 72 hours are cancelled — never
 * a paid order, never a cash order, never one whose payment page is still open.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ops, orderEvents, webhookEvents } from "../../../src/server/db/schema";
import { expireUnpaid, HOURS } from "../../../src/server/domain/payments/expire";
import { JOBS, runJob } from "../../../src/server/jobs";
import { payHarness, type PayHarness } from "./_helpers";

let h: PayHarness;
beforeAll(async () => { h = await payHarness({ now: Date.parse("2026-09-10T12:00:00Z") }); });
afterEach(async () => { await h.reset(); h.clock.set(Date.parse("2026-09-10T12:00:00Z")); });

const ago = (hours: number) => new Date(h.clock.t - hours * 3600e3);

describe("orders-expire", () => {
  it("is registered hourly", () => {
    expect(JOBS["orders-expire"]!.everyMin).toBe(60);
    expect(HOURS).toBe(72);
  });

  // from test-admin-tweaks.js: the cutoff arithmetic
  it("cancels a card attempt from the 6th, not one from the 8th (now the 10th at noon: cutoff the 7th at noon)", async () => {
    await h.seed({ id: "LM-600001", createdAt: new Date("2026-09-06T10:00:00Z") });
    await h.seed({ id: "LM-600002", createdAt: new Date("2026-09-08T10:00:00Z") });
    const r = await expireUnpaid(h.deps);
    expect([r.cancelled, r.cutoff, r.ids]).toEqual([1, "2026-09-07T12:00:00.000Z", ["LM-600001"]]);
    const o = await h.row("LM-600001");
    expect([o.status, o.paymentStatus, o.adminNote]).toEqual(["void", "cancelled", "Cancelled automatically: no payment within 72 hours"]);
    expect((await h.row("LM-600002")).status).toBe("pending");
    const ev = (await h.db.select().from(orderEvents).where(eq(orderEvents.orderId, "LM-600001"))).pop()!;
    expect([ev.from, ev.to, ev.by]).toEqual(["pending", "void", "job:orders-expire"]);
  });

  // from test-bugcheck.js
  it("leaves an attempt whose reopened payment page is still open", async () => {
    await h.seed({ id: "LM-600001", createdAt: ago(80) });
    await h.seed({ id: "LM-600002", createdAt: ago(80), expireAt: new Date(h.clock.t + 30 * 60e3) });
    await h.seed({ id: "LM-600003", createdAt: ago(80), expireAt: new Date(h.clock.t - 60e3) });
    const r = await expireUnpaid(h.deps);
    expect(r.ids.sort()).toEqual(["LM-600001", "LM-600003"]);
    expect((await h.row("LM-600002")).status).toBe("pending");
  });

  it("never a paid order, a cash order, a binned one; a cancelled-at-Thawani attempt still pending is swept", async () => {
    await h.seed({ id: "LM-600011", createdAt: ago(80), paymentStatus: "paid" });
    await h.seed({ id: "LM-600012", createdAt: ago(80), pay: "cod", paymentStatus: "cod", status: "new" });
    await h.seed({ id: "LM-600013", createdAt: ago(80), trashed: true });
    await h.seed({ id: "LM-600014", createdAt: ago(80), paymentStatus: "cancelled" });
    const r = await expireUnpaid(h.deps);
    expect(r.ids).toEqual(["LM-600014"]);
    expect((await h.row("LM-600011")).status).toBe("pending");
    expect((await h.row("LM-600013")).status).toBe("pending");
  });

  // from test-v334.js: the hourly run is on record even when it cancelled nothing
  it("the run is on record every hour, whatever it did", async () => {
    const out = await runJob(h.deps, "orders-expire");
    expect(out.cancelled).toBe(0);
    const rec = (await h.db.select().from(ops).where(eq(ops.key, "job:orders-expire")))[0]!;
    expect((rec.data as { cancelled: number }).cancelled).toBe(0);
  });

  it("trims the webhook record to 90 days", async () => {
    await h.db.insert(webhookEvents).values([
      { provider: "thawani", payload: {}, applied: "paid", receivedAt: ago(91 * 24) },
      { provider: "thawani", payload: {}, applied: "paid", receivedAt: ago(10) },
    ]);
    const r = await expireUnpaid(h.deps);
    expect(r.purged).toBe(1);
    expect((await h.hooks()).length).toBe(1);
  });
});
