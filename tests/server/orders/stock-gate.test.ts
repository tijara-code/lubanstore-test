/**
 * The till's stock gate (the shelf itself is the Empower area's: domain/stock.ts is replaced
 * here by a one-box shelf for oud-large that counts what open orders hold).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "../../helpers/harness";
import { orders } from "../../../src/server/db/schema";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";

const seen: { db: unknown; except: unknown }[] = [];
let broken = false;

vi.mock("../../../src/server/domain/stock", async () => {
  const { fail } = await import("../../../src/server/core/http");
  const schema = await import("../../../src/server/db/schema");
  const { inArray } = await import("drizzle-orm");
  return {
    async enforceStock(deps: any, cfg: any, _cc: string, lines: any[], except?: { id: string; dedupeId: string | null } | null) {
      seen.push({ db: deps.db, except: except || null });
      if (broken) throw new Error("the shelf could not be read");
      if (!cfg.stockCap || !cfg.stockCap["oud-large"]) return;
      const want = lines.filter((l) => l.itemId === "oud-large").reduce((t, l) => t + l.qty, 0);
      if (!want) return;
      const open = await deps.db.select().from(schema.orders).where(inArray(schema.orders.status, ["new", "prep", "pending"]));
      const held = open
        .filter((o: any) => !(except && o.id === except.id && o.dedupeId === except.dedupeId))
        .reduce((t: number, o: any) => t + o.items.filter((i: any) => i.itemId === "oud-large").reduce((s: number, i: any) => s + i.qty, 0), 0);
      const left = Math.max(0, 1 - held);
      if (want > left) throw fail("stock_short", 409, { item: "oud-large", left });
    },
  };
});

let h: Harness;
const capped = () => {
  const c = bundledCatalogue();
  c.stockCap = { "oud-large": true };
  return c;
};
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
  h = await createHarness({ catalogue: capped() });
});
beforeEach(async () => {
  broken = false;
  seen.length = 0;
  await h.reset(capped());
});
afterAll(async () => h.reset(capped()));

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

  it("the proposed id counts as this order's own only with its dedupe id; no id, no exception", async () => {
    await post(basket({ id: "LM-4000002", dedupeId: "d-2" }));
    expect(seen[0]!.except).toEqual({ id: "LM-4000002", dedupeId: "d-2" });
    await post(basket({ dedupeId: "d-3" }));
    expect(seen[1]!.except).toBe(null);
  });

  it("the gate reads inside the write's transaction (never the outer handle)", async () => {
    await post(basket({ dedupeId: "d-4" }));
    expect(seen[0]!.db).not.toBe(h.db);
  });

  it("two shoppers at once cannot both take the last capped box", async () => {
    const [a, b] = await Promise.all([post(basket({ dedupeId: "race-a" })), post(basket({ dedupeId: "race-b" }))]);
    expect([a.s, b.s].sort()).toEqual([200, 409]);
    expect((await h.db.select().from(orders)).length).toBe(1);
  });

  // from test-v211 (inventory): a failing stock check (not a refusal) lets the cash order through
  it("a stock check that fails refuses nothing (and is logged)", async () => {
    broken = true;
    const r = await post(basket({ dedupeId: "d-5" }));
    expect(r.s).toBe(200);
  });
});
