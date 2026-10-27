/**
 * The shelf's cap on the card paths (the shelf itself is the Empower area's: domain/stock.ts
 * is replaced here by a one-box shelf for oud-large that counts what open orders hold).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import { KEY, payHarness, type PayHarness } from "./_helpers";

const seen: Array<{ except: unknown }> = [];

vi.mock("../../../src/server/domain/stock", async () => {
  const { fail } = await import("../../../src/server/core/http");
  const schema = await import("../../../src/server/db/schema");
  const { inArray } = await import("drizzle-orm");
  return {
    async readShelfForGate() {
      return { asked: ["oud-large"], reading: null, autoOn: false };
    },
    async enforceStock(deps: any, cfg: any, _cc: string, lines: any[], except?: { id: string; dedupeId: string | null } | null) {
      seen.push({ except: except || null });
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

const capped = () => {
  const c = bundledCatalogue() as ReturnType<typeof bundledCatalogue> & { countries: Array<Record<string, any>> };
  c.stockCap = { "oud-large": true };
  c.countries.find((x) => x.code === "AE")!.ship = 0;
  return c;
};

let h: PayHarness;
beforeAll(async () => { h = await payHarness({ catalogue: capped() }); });
afterEach(async () => { seen.length = 0; await h.reset(capped()); });

describe("the card till and the shelf", () => {
  it("the last capped box: the card session opens; the next basket is refused 409 stock_short, no session, nothing written", async () => {
    const a = await h.openCard({ id: "LM-5100001" });
    expect(a.status).toBe(200);
    expect(seen[0]!.except).toEqual({ id: "LM-5100001", dedupeId: expect.any(String) });
    const b = await h.openCard({ id: "LM-5100002" });
    expect(b.status).toBe(409);
    expect(b.j).toEqual({ ok: false, error: "stock_short", item: "oud-large", left: 0 });
    expect(h.th().state.sessions.length).toBe(1);
    expect((await h.verify({ ref: "LM-5100002" })).status).toBe(404);
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
    expect(seen.pop()!.except).toEqual({ id: "LM-123456", dedupeId: "d-own" });
    expect((await h.row("LM-123456")).status).toBe("void");
  });

  it("the order's own box is its own: with nothing else held it converts", async () => {
    await h.seed({ id: "LM-123456", dedupeId: "d-own" });
    const res = await h.request("/resume/LM-123456?k=" + KEY + "&cod=1", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await h.row("LM-123456")).paymentStatus).toBe("cod");
  });

  it("opening the cash link (GET) never asks the shelf", async () => {
    await h.seed({ id: "LM-123456" });
    await h.request("/resume/LM-123456?k=" + KEY + "&cod=1");
    expect(seen.length).toBe(0);
  });
});
