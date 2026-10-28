/**
 * The shelf's cap on the card paths — the REAL gate (domain/stock.ts over the fake Omniful's
 * shelf): oud-large capped, one box left in the warehouse.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ops } from "../../../src/server/db/schema";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import { omnifulFake } from "../../../src/server/services/omniful/fake";
import { ALL_SKUS } from "../empower/_helpers";
import { KEY, payHarness, type PayHarness } from "./_helpers";

const capped = () => {
  const c = bundledCatalogue() as ReturnType<typeof bundledCatalogue> & { countries: Array<Record<string, any>> };
  c.stockCap = { "oud-large": true };
  c.countries.find((x) => x.code === "AE")!.ship = 0;
  return c;
};

let h: PayHarness;
const omfCalls = () => h.world.calls.filter((c) => /omniful/.test(c.host)).length;
beforeAll(async () => { h = await payHarness({ catalogue: capped() }); });
beforeEach(async () => {
  await h.db.insert(ops).values({ key: "omniful_skus", data: ALL_SKUS, updatedAt: new Date(h.clock.t) }).onConflictDoUpdate({ target: ops.key, set: { data: ALL_SKUS } });
  omnifulFake(h.world).inventory = { LM3001: 1 };
});
afterEach(async () => { await h.reset(capped()); });

describe("the card till and the shelf", () => {
  it("the last capped box: the card session opens; the next basket is refused 409 stock_short, no session, nothing written", async () => {
    const a = await h.openCard({ id: "LM-5100001", countryCode: "AE", phone: "+971 50 123 4567" });
    expect(a.status).toBe(200);
    const b = await h.openCard({ id: "LM-5100002", countryCode: "AE", phone: "+971 50 123 4567" });
    expect(b.status).toBe(409);
    expect(b.j).toEqual({ ok: false, error: "stock_short", item: "oud-large", left: 0 });
    expect(h.th().state.sessions.length).toBe(1);
    expect((await h.verify({ ref: "LM-5100002" })).status).toBe(404);
  });

  // (review-fixes, finding 4) the open attempt's id posted again without its dedupe id is not its own
  it("a basket naming the open card attempt's id with no dedupe id is refused", async () => {
    expect((await h.openCard({ id: "LM-5100003", countryCode: "AE", phone: "+971 50 123 4567" })).status).toBe(200);
    const b = await h.openCard({ id: "LM-5100003", dedupeId: "", countryCode: "AE", phone: "+971 50 123 4567" });
    expect([b.status, b.j.error]).toEqual([409, "stock_short"]);
  });
});

// from test-v314.js (A14): the cash switch from the reminder link keeps the cap
describe("the cash switch from the reminder link", () => {
  it("its own boxes set aside, another open order's held: refused with a page, nothing written", async () => {
    await h.seed({ id: "LM-123456", status: "void", paymentStatus: "cancelled", dedupeId: "d-own" });
    await h.seed({ id: "LM-123457", pay: "cod", paymentStatus: "cod", status: "new", invoiceKey: "c".repeat(32) });
    const res = await h.request("/resume/LM-123456?k=" + KEY + "&cod=1", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/الكمية المتوفرة من أحد المنتجات أقل مما في طلبك/);
    expect((await h.row("LM-123456")).status).toBe("void");
  });

  it("the order's own box is its own (a known order, by id — even with no dedupe id): with nothing else held it converts", async () => {
    await h.seed({ id: "LM-123456", dedupeId: null });
    const res = await h.request("/resume/LM-123456?k=" + KEY + "&cod=1", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await h.row("LM-123456")).paymentStatus).toBe("cod");
  });

  it("opening the cash link (GET) never asks the shelf", async () => {
    await h.seed({ id: "LM-123456" });
    const before = omfCalls();
    await h.request("/resume/LM-123456?k=" + KEY + "&cod=1");
    expect(omfCalls() - before).toBe(0);
  });
});
