import { describe, expect, it } from "vitest";
import { getOp } from "../../../src/server/core/ops";
import type { PxHealth } from "../../../src/server/domain/pixels/health";
import { trackingHealth } from "../../../src/server/domain/pixels/health";
import { sendMeta } from "../../../src/server/domain/pixels/send";
import { createHarness } from "../../helpers/harness";

// from test-v331.js: tracking health
describe("tracking health", () => {
  it("notes a success, then at most every five minutes; every Purchase with its match-field NAMES; every failure", async () => {
    const h = await createHarness();
    const spec = (name: string) => ({ name, id: "e-" + name + h.clock.t, time: h.clock.t,
      user: { phone: "+968 91234567", email: "a@b.co", firstName: "Sara", country: "om" } });
    const px = async () => (await getOp<PxHealth>(h.db, "px:meta"))!.data;

    await sendMeta(h.deps, [spec("PageView")]);
    let d = await px();
    expect(d.sent + " " + d.lastEvent + " " + !!d.lastOkAt).toBe("1 PageView true");
    await sendMeta(h.deps, [spec("ViewContent")]);
    await sendMeta(h.deps, [spec("AddToCart")]);
    expect((await px()).sent).toBe(1);
    await sendMeta(h.deps, [spec("Purchase")]);
    d = await px();
    expect(d.lastEvent + " " + d.purchase!.fields.join(",")).toBe("Purchase country,em,fn,ph");
    expect(JSON.stringify(d).indexOf("91234567") < 0 && JSON.stringify(d).indexOf("a@b.co") < 0).toBe(true);

    h.world.fail((c) => (c.host === "graph.facebook.com" ? { status: 400, body: { error: { message: "Invalid parameter" } } } : null));
    for (let i = 0; i < 3; i++) await sendMeta(h.deps, [spec("ViewContent")]);
    h.world.fail(null);
    d = await px();
    expect(d.failed + " " + /Invalid parameter/.test(d.lastError || "")).toBe("3 true");

    // the Tracking health card: today's failures, three within the hour is a warning
    let t = await trackingHealth(h.deps);
    expect(t.meta!.failedToday + " " + t.meta!.sent).toBe("3 2");
    expect(t.meta!.purchase!.fields).toContain("ph");
    expect(t.snap).toBeNull();
    expect(t.warnings).toEqual(["pixel_failures:meta"]);
    h.clock.advance(2 * 3600e3);
    t = await trackingHealth(h.deps);
    expect(t.warnings).toEqual([]);

    // after five minutes a success is written again
    await sendMeta(h.deps, [spec("PageView")]);
    expect((await px()).sent).toBe(3);

    // the next Muscat day counts afresh; yesterday's failures are not today's
    h.clock.advance(24 * 3600e3);
    t = await trackingHealth(h.deps);
    expect(t.meta!.failedToday).toBe(0);
    await sendMeta(h.deps, [spec("PageView")]);
    d = await px();
    expect(d.sent + " " + d.failed + " " + !!d.purchase).toBe("1 0 true");
  });
});
