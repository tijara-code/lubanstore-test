/**
 * The till's stock gate — the REAL gate (domain/stock.ts enforceStock over the fake Omniful's
 * shelf): oud-large capped at the shelf, one box left in the warehouse.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "../../helpers/harness";
import { orders } from "../../../src/server/db/schema";
import { ALL_SKUS, catalogue, withHelpers } from "../empower/_helpers";

let h: ReturnType<typeof withHelpers>;
const capped = () => catalogue({}, (c) => (c.stockCap = { "oud-large": true }));
const basket = (extra: Record<string, unknown> = {}) => ({
  name: "Sara",
  phone: "+971 50 123 4567",
  countryCode: "AE",
  items: [{ itemId: "oud-large", qty: 1 }],
  ...extra,
});
let ip = 1;
async function post(order: unknown) {
  const r = await h.post("/api/order", { order }, { "x-nf-client-connection-ip": "10.9.0." + ip++ });
  return { s: r.status, j: (await r.json()) as Record<string, any> };
}

beforeAll(async () => {
  h = withHelpers(await createHarness({ catalogue: capped() }));
});
beforeEach(async () => {
  await h.reset(capped());
  await h.setOp("omniful_skus", ALL_SKUS);
  h.omf.inventory = { LM3001: 1 };
  h.world.fail(null);
});

describe("the shelf's cap at the till", () => {
  // from test-v314.js A5/A42
  it("the last box sells; another basket naming that order's id is refused; the same submission is the same order", async () => {
    let r = await post(basket({ id: "LM-4000001", dedupeId: "d-first" }));
    expect(r.s + " " + r.j.id).toBe("200 LM-4000001");
    r = await post(basket({ id: "LM-4000001", dedupeId: "d-other" }));
    expect(r.s + " " + r.j.error).toBe("409 stock_short");
    expect(r.j).toEqual({ ok: false, error: "stock_short", item: "oud-large", left: 0 });
    r = await post(basket({ id: "LM-4000001", dedupeId: "d-first" }));
    expect(r.s + " " + r.j.id + " " + r.j.already).toBe("200 LM-4000001 true");
    expect((await h.db.select().from(orders)).length).toBe(1);
  });

  // (review-fixes, finding 4) the proposed id counts as this order's own only with its dedupe id
  it("a basket naming an open order's id WITHOUT a dedupe id is not excused that order's boxes", async () => {
    expect((await post(basket({ id: "LM-4000002", dedupeId: "d-2" }))).s).toBe(200);
    const r = await post(basket({ id: "LM-4000002" }));
    expect(r.s + " " + r.j.error + " " + r.j.left).toBe("409 stock_short 0");
    expect((await h.db.select().from(orders)).length).toBe(1);
  });

  it("no id, no exception: a second basket for the last box is refused", async () => {
    expect((await post(basket({ dedupeId: "d-3" }))).s).toBe(200);
    expect((await post(basket({ dedupeId: "d-4" }))).s).toBe(409);
  });

  // the gate's read and the insert are one step under the stock lock (on the pg project the
  // two posts really run at once)
  it("two shoppers at once cannot both take the last capped box", async () => {
    const [a, b] = await Promise.all([post(basket({ dedupeId: "race-a" })), post(basket({ dedupeId: "race-b" }))]);
    expect([a.s, b.s].sort()).toEqual([200, 409]);
    expect((await h.db.select().from(orders)).length).toBe(1);
  });

  // from test-v211 (inventory): a stock check that cannot read the shelf lets the cash order through
  it("a shelf that cannot be read refuses nothing", async () => {
    h.world.fail((c) => (/omniful/.test(c.host) ? { status: 503, body: {} } : null));
    expect((await post(basket({ dedupeId: "d-5" }))).s).toBe(200);
    expect((await post(basket({ dedupeId: "d-6" }))).s).toBe(200);
  });
});
