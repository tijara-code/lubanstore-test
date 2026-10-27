import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogueFile, json, ready } from "./_boot";
import { boxesOf } from "../../../src/server/domain/empower/lines";
import type { CartLine, LmApi } from "../../../src/web/core/types";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** the core with a shelf that answers `stock` (and the counter switched on) */
async function withShelf(stock: unknown, mut?: (cfg: ReturnType<typeof catalogueFile>) => void) {
  const cfg = catalogueFile();
  cfg.stockLive = true;
  if (mut) mut(cfg);
  let asked = 0;
  const r = await ready({
    url: "/?country=OM",
    fetch: (url) => {
      if (url === "/api/settings") return Promise.resolve(json(cfg));
      if (url === "/api/stock") {
        asked++;
        return Promise.resolve(typeof stock === "function" ? (stock as () => Response)() : json(stock));
      }
      return Promise.reject(new Error("offline"));
    },
  });
  return { ...r, asked: () => asked };
}

// from test-v403.js: the count shown is 30% of the shelf
describe("pieces left", () => {
  it("30% of the shelf, never 0 while any are there; unknown stays unknown", async () => {
    const { LM } = await ready({});
    expect([LM.stockShown(120), LM.stockShown(47), LM.stockShown(10), LM.stockShown(2)]).toEqual([36, 14, 3, 1]);
    expect([LM.stockShown(0), LM.stockShown(null)]).toEqual([0, null]);
  });

  it("asked for only when the counter (or a hide/cap switch) is on; read through stockShown; caps read the real shelf", async () => {
    const off = await ready({});
    await tick(5);
    expect(off.calls.some((c) => c.url === "/api/stock")).toBe(false);
    expect(off.LM.stockPending()).toBe(false);
    expect(off.LM.stockLeft("large")).toBe(null);

    const heard = vi.fn();
    window.addEventListener("lm:stock", heard);
    const { LM, asked } = await withShelf({ left: { large: 120, small: 2, "bad id!": 5, neg: -1 }, cap: { "oud-small": 13, "x/y": 2 } });
    await tick(5);
    expect(asked()).toBe(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(LM.stockPending()).toBe(false);
    expect(LM.stockLeft("large")).toBe(36);
    expect(LM.stockLeft("small")).toBe(1);
    expect(LM.stockLeft("bad id!")).toBe(null);
    expect(LM.stockLeft("neg")).toBe(null);
    expect(LM.stockCap("oud", "small")).toBe(13);
    expect(LM.stockCap("lemon", "small")).toBe(null);
    // the same answer again: settled, no new event
    LM.loadStock();
    await tick(5);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("lm:stock", heard);
  });

  it("(v403) pending until the first answer, a failure, or 4 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cfg = catalogueFile();
    cfg.stockLive = true;
    const { LM } = await (async () => {
      const r = await import("./_boot").then((m) =>
        m.bootCore({
          url: "/?country=OM",
          fetch: (url) => (url === "/api/settings" ? Promise.resolve(json(cfg)) : url === "/api/stock" ? new Promise<Response>(() => {}) : Promise.reject(new Error("x"))),
        }),
      );
      await r.LM.ready;
      return r;
    })();
    const heard = vi.fn();
    window.addEventListener("lm:stock", heard);
    expect(LM.stockPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(4100);
    expect(LM.stockPending()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("lm:stock", heard);
  });

  it("a failed shelf settles at once", async () => {
    const { LM } = await withShelf(() => json({ error: "x" }, { status: 502 }));
    await tick(5);
    expect(LM.stockPending()).toBe(false);
    expect(LM.stockLeft("large")).toBe(null);
  });
});

// from test-v208.js: hiding at 0 is never a gate
describe("hiding at 0", () => {
  it("the page learns what to hide; that box in the basket is offered exactly as before; junk ids are dropped", async () => {
    const { LM } = await withShelf({ left: {}, hide: { items: ["oud-small", "../etc"], sizes: ["small"], junk: 1 } }, (cfg) => {
      cfg.stockHide = { "oud-small": true };
      delete cfg.stockLive;
    });
    await tick(5);
    expect([LM.stockHidden("oud", "small"), LM.stockHiddenSize("small"), LM.stockHiddenSize("large")]).toEqual([true, true, false]);
    expect(LM.stockHidden("..", "etc")).toBe(false);
    expect(LM.lineOffered({ sizeId: "small", scentId: "oud", qty: 1 })).toBe(true);
  });
});

// from test-v336-product.js / test-v303.js: every box a line holds, against the caps
describe("caps", () => {
  const trio: CartLine = { sizeId: "trio", scentId: null, mix: ["oud", "oud", "amber"], qty: 1 };
  const set: CartLine = { sizeId: "bundle", scentId: "bundle", qty: 1 };
  const capsOn = (LM: LmApi, caps: Record<string, number>) => {
    LM.stockCap = (sc, sz) => (caps[sc + "-" + sz] == null ? null : caps[sc + "-" + sz]!);
  };

  it("a line's boxes are the till's (boxesOf)", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    expect(JSON.stringify(LM.lineBoxes(trio))).toBe('{"oud-large":2,"amber-large":1}');
    expect(JSON.stringify(LM.lineBoxes(set))).toBe('{"oud-small":1,"lemon-small":1,"amber-small":1}');
    expect(LM.lineBoxes({ sizeId: "burner", qty: 1 })).toEqual({ burner: 1 });
    expect(LM.lineBoxes(null)).toEqual({});
    const basket: CartLine[] = [trio, set, { scentId: "oud", sizeId: "large", qty: 2 }];
    const server = boxesOf(LM.cfg, "OM", [{ itemId: "trio:oud.oud.amber", qty: 1 }, { itemId: "bundle", qty: 1 }, { itemId: "oud-large", qty: 2 }]);
    expect(LM.basketBoxes(basket)).toEqual(server);
  });

  it("no + past a cap; the set counts toward single boxes; no cap, no limit", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    capsOn(LM, { "oud-large": 3 });
    expect(LM.lineRoom(trio, [trio])).toBe(0);
    capsOn(LM, { "oud-large": 4 });
    expect(LM.lineRoom(trio, [trio])).toBe(1);
    capsOn(LM, { "amber-small": 1 });
    expect(LM.lineRoom(set, [set])).toBe(0);
    expect(LM.capRoom("amber", "small", [set])).toBe(0);
    capsOn(LM, {});
    expect(LM.lineRoom(set, [set])).toBe(null);
    expect(LM.capRoom("amber", "small", [set])).toBe(null);
    // an offer in the basket counts against a capped box (v303)
    LM.stockCap = () => 5;
    expect(LM.capRoom("oud", "large", [trio, { scentId: "oud", sizeId: "large", qty: 1 }])).toBe(2);
  });

  it("the set: packed from the active scents that are in; a scent capped at 0 stops it", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    expect(LM.bundleSellable("bundle")).toBe(true);
    LM.cfg.scents.find((s) => s.id === "amber")!.soldOutSizes = ["small"];
    expect(LM.bundleSellable("bundle") + " " + LM.bundleScents("bundle").map((s) => s.id).join(",")).toBe("true oud,lemon");
    LM.cfg.scents.forEach((s) => (s.soldOutSizes = ["small"]));
    expect(LM.bundleSellable("bundle")).toBe(false);
    LM.cfg = catalogueFile();
    LM.c = LM.cfg.countries.find((c) => c.code === "OM")!;
    capsOn(LM, { "lemon-small": 0 });
    expect(LM.bundleSellable("bundle")).toBe(false);
    capsOn(LM, {});
    LM.cfg.scents.find((s) => s.id === "amber")!.active = false;
    expect(LM.bundleSellable("bundle") + " " + Object.keys(LM.lineBoxes(set)).join()).toBe("true oud-small,lemon-small");
    // a set one of its scents ran out of says so; the market's own refusal otherwise
    LM.cfg.scents.forEach((s) => (s.soldOutSizes = ["small"]));
    expect(LM.offWords(set)).toBe("نفدت الكمية");
  });
});

// from test-v336-product.js: the one safe read of the basket
describe("the basket", () => {
  it("readCart keeps object lines with a string sizeId and a whole qty ≥ 1 (\"2\" reads 2)", async () => {
    const { LM } = await ready({});
    sessionStorage.setItem("lm_cart", JSON.stringify([{ sizeId: "a", qty: 0 }, { sizeId: "b", qty: -1 }, { sizeId: "c", qty: 1.5 }, { sizeId: "d", qty: "x" }, { sizeId: "e", qty: 3 }, null, [1], { sizeId: "", qty: 1 }, { sizeId: "f", qty: "2" }]));
    expect(LM.readCart().map((l) => l.sizeId + ":" + l.qty).join()).toBe("e:3,f:2");
    sessionStorage.setItem("lm_cart", "not json");
    expect(LM.readCart()).toEqual([]);
    sessionStorage.setItem("lm_cart", "{}");
    expect(LM.readCart()).toEqual([]);
  });

  it("the stored basket is repaired once at load", async () => {
    await ready({ session: { lm_cart: JSON.stringify([null, { sizeId: "large", scentId: "oud", qty: "2" }]) } });
    expect(sessionStorage.getItem("lm_cart")).toBe(JSON.stringify([{ sizeId: "large", scentId: "oud", qty: 2 }]));
    await ready({ session: { lm_cart: "garbage" } });
    expect(sessionStorage.getItem("lm_cart")).toBe(null);
    const ok = JSON.stringify([{ sizeId: "large", scentId: "oud", qty: 1 }]);
    await ready({ session: { lm_cart: ok } });
    expect(sessionStorage.getItem("lm_cart")).toBe(ok);
  });
});
