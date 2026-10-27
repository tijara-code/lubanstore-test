/**
 * The shelf on the page: hidden boxes (v208), one rule for rows and add (v209), caps on the
 * steppers (v211), redraws on lm:stock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cat, openPage, step, tap, type Page } from "./_page";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** a live large-offer catalogue with the counter on (the stacked page, scents under the single row on a phone) */
function shelfCat(more: (c: ReturnType<typeof cat>) => void = () => {}) {
  const c = cat();
  c.stockLive = true;
  more(c);
  return c;
}
const rows = (p: Page) => p.$$(".tier-scents .prow").map((r) => r.getAttribute("data-scent"));
const row = (p: Page, id: string) => p.$('.tier-scents .prow[data-scent="' + id + '"]')!;

describe("from test-v208.js: hide at 0 (display only)", () => {
  it("a hidden box is not a row; every row hidden → all shown; a hidden size leaves the tiles", async () => {
    const c = shelfCat((k) => (k.stockHide = { "amber-large": true }));
    const p = await openPage({ catalogue: c, media: { phone: true }, stock: { left: {}, hide: { items: ["amber-large"], sizes: [] }, cap: {} } });
    await vi.waitFor(() => expect(rows(p)).toEqual(["oud", "lemon"]));
    expect(p.$$('.prow.shut[data-scent="amber"]').length).toBe(0); // not a "sold out" row

    const all = shelfCat();
    const q = await openPage({ catalogue: all, media: { phone: true }, stock: { left: {}, hide: { items: ["oud-large", "lemon-large", "amber-large"], sizes: [] }, cap: {} } });
    await vi.waitFor(() => expect(q.LM.stockHidden("oud", "large")).toBe(true));
    expect(rows(q)).toEqual(["oud", "lemon", "amber"]);

    const r = await openPage({ catalogue: all, stock: { left: {}, hide: { items: ["oud-small", "lemon-small", "amber-small"], sizes: ["small"] }, cap: {} } });
    await vi.waitFor(() => expect(r.$$(".tile").length).toBe(1));
    expect(r.$(".tile .tile-name")!.getAttribute("data-left")).toBe("large");
  });

  it("from test-v209.js: a box that leaves the page takes its count; the add button follows", async () => {
    let shelf = { left: {}, hide: { items: [] as string[], sizes: [] as string[] }, cap: {} };
    const c = shelfCat();
    const p = await openPage({ catalogue: c, media: { phone: true }, answer: (u) => (u.indexOf("/api/stock") === 0 ? Promise.resolve(new Response(JSON.stringify(shelf))) : null) });
    await vi.waitFor(() => expect(p.LM.stockPending()).toBe(false));
    tap(p.$('.tier[data-tier="single"]')); // phone: chosen already; tapping keeps it
    step(row(p, "amber"), 1);
    step(row(p, "oud"), 1);
    expect(p.$("#addLabel")!.textContent).toContain(p.LM.money(2 * p.LM.price("large")));
    shelf = { left: {}, hide: { items: ["amber-large"], sizes: [] }, cap: {} };
    p.LM.loadStock();
    await vi.waitFor(() => expect(rows(p)).toEqual(["oud", "lemon"]));
    const S = await import("../../../src/web/product/state");
    expect(S.P.QTY.large).toEqual({ oud: 1 });
    expect(p.$("#addLabel")!.textContent).toContain(p.LM.money(p.LM.price("large")));
    tap(p.$("#add"));
    expect(p.basket().map((l) => l.scentId)).toEqual(["oud"]);
  });
});

describe("from test-v211.js / test-v303.js: caps on the steppers", () => {
  it("the stepper stops at the room left (basket counted) and says باقي {n} فقط for a moment", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const c = shelfCat((k) => (k.stockCap = { "oud-large": true }));
    const p = await openPage({
      catalogue: c,
      media: { phone: true },
      cart: [{ sizeId: "large", scentId: "oud", qty: 1 }],
      stock: { left: {}, hide: { items: [], sizes: [] }, cap: { "oud-large": 3 } },
    });
    await vi.waitFor(() => expect(p.LM.stockCap("oud", "large")).toBe(3));
    step(row(p, "oud"), 1);
    step(row(p, "oud"), 1);
    expect(row(p, "oud").querySelector(".cap-note")).toBe(null);
    step(row(p, "oud"), 1);
    expect(row(p, "oud").querySelector("[data-count]")!.textContent).toBe("2");
    const note = row(p, "oud").querySelector(".prow-mid .cap-note")!;
    expect(note.className).toBe("sz-tag out cap-note");
    expect(note.textContent).toBe("باقي 2 فقط");
    vi.advanceTimersByTime(2200);
    expect(row(p, "oud").querySelector(".cap-note")).toBe(null);
  });

  it("a cap at 0: نفدت الكمية; a live cap drop clamps the counted rows and redraws", async () => {
    let shelf = { left: {}, hide: { items: [] as string[], sizes: [] as string[] }, cap: { "oud-large": 5 } as Record<string, number> };
    const c = shelfCat((k) => (k.stockCap = { "oud-large": true }));
    const p = await openPage({ catalogue: c, media: { phone: true }, answer: (u) => (u.indexOf("/api/stock") === 0 ? Promise.resolve(new Response(JSON.stringify(shelf))) : null) });
    await vi.waitFor(() => expect(p.LM.stockCap("oud", "large")).toBe(5));
    step(row(p, "oud"), 1);
    step(row(p, "oud"), 1);
    step(row(p, "oud"), 1);
    shelf = { left: {}, hide: { items: [], sizes: [] }, cap: { "oud-large": 1 } };
    p.LM.loadStock();
    await vi.waitFor(() => expect(row(p, "oud").querySelector("[data-count]")!.textContent).toBe("1"));
    shelf = { left: {}, hide: { items: [], sizes: [] }, cap: { "oud-large": 0 } };
    p.LM.loadStock();
    await vi.waitFor(() => expect(row(p, "oud").querySelector("[data-count]")!.textContent).toBe("0"));
    step(row(p, "oud"), 1);
    expect(row(p, "oud").querySelector(".cap-note")!.textContent).toBe("نفدت الكمية");
  });

  it("offer boxes count against a capped box (a trio holding two)", async () => {
    const c = shelfCat((k) => {
      k.stockCap = { "oud-large": true };
      k.tiers = Object.assign({}, k.tiers, { anchor: new Date(Date.now() - 3600e3).toISOString() });
    });
    const p = await openPage({
      catalogue: c,
      media: { phone: true },
      cart: [{ sizeId: "trio", scentId: null, mix: ["oud", "oud", "amber"], qty: 1 }],
      stock: { left: {}, hide: { items: [], sizes: [] }, cap: { "oud-large": 3 } },
    });
    await vi.waitFor(() => expect(p.LM.stockCap("oud", "large")).toBe(3));
    step(row(p, "oud"), 1);
    step(row(p, "oud"), 1);
    expect(row(p, "oud").querySelector("[data-count]")!.textContent).toBe("1");
  });
});

describe("from test-v206.js / test-v207.js / test-v312.js: the counts repaint in place", () => {
  it("[data-left] rewritten on lm:stock without a redraw when nothing hides", async () => {
    let shelf = { left: { large: 100, small: 50 }, hide: { items: [], sizes: [] }, cap: {} };
    const p = await openPage({ catalogue: shelfCat(), answer: (u) => (u.indexOf("/api/stock") === 0 ? Promise.resolve(new Response(JSON.stringify(shelf))) : null) });
    await vi.waitFor(() => expect(p.$(".tile-name")!.textContent).toBe("30 قطعة متبقية"));
    const tile = p.$(".tile");
    shelf = { left: { large: 4, small: 50 }, hide: { items: [], sizes: [] }, cap: {} };
    p.LM.loadStock();
    await vi.waitFor(() => expect(p.$(".tile-name")!.textContent).toBe("قطعة واحدة متبقية"));
    expect(p.$(".tile")).toBe(tile);
    shelf = { left: { large: 0, small: 50 }, hide: { items: [], sizes: [] }, cap: {} };
    p.LM.loadStock();
    await vi.waitFor(() => expect(p.$(".tile-name")!.textContent).toBe("300 جم"));
    expect(p.$(".tile-name")!.classList.contains("is-left")).toBe(false);
  });
});
