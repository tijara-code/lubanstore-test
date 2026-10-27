/**
 * The stacked page (v312/v335): the tiles as pictures, the large offers' list (v303) with the
 * scents opening under the chosen row, and the three-scent set as a choice (v403), with the
 * phone/desktop rules of v406/v407/v440.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cat, key, marketOf, openPage, step, tap, type Page } from "./_page";

/** the bundled catalogue with the large offers live (anchored an hour ago) */
function live(hoursAgo = 1, more: (c: ReturnType<typeof cat>) => void = () => {}) {
  const c = cat();
  c.tiers = Object.assign({}, c.tiers, { active: true, anchor: new Date(Date.now() - hoursAgo * 3600e3).toISOString() });
  more(c);
  return c;
}
const rowOf = (p: Page, id: string) => p.$('.tier[data-tier="' + id + '"]')!;
const radio = (p: Page, id: string) => rowOf(p, id).querySelector<HTMLInputElement>("input")!;
const choose = (p: Page, id: string) => {
  const r = radio(p, id);
  r.checked = true;
  r.dispatchEvent(new Event("change", { bubbles: true }));
};
const setRadio = (p: Page) => p.$<HTMLInputElement>('#offer input[name="tier"]')!;
const chooseSet = (p: Page) => {
  const r = setRadio(p);
  r.checked = true;
  r.dispatchEvent(new Event("change", { bubbles: true }));
};

afterEach(() => vi.restoreAllMocks());

describe("from test-v312.js / test-v335.js: the stacked page", () => {
  it("stacked whenever the catalogue has the set, on or off; tiles are pictures that say what is left", async () => {
    const p = await openPage({ catalogue: live() });
    expect(p.$$(".sz-tiles-still").length).toBe(1);
    const tiles = p.$$(".tile.still");
    expect(tiles.length).toBe(2);
    expect(tiles[0]!.tagName).toBe("DIV"); // not a choice
    expect(tiles.map((t) => t.querySelector(".tile-name")!.getAttribute("data-left"))).toEqual(["large", "small"]);
    expect(tiles.map((t) => t.querySelector(".tile-name")!.textContent)).toEqual(["300 جم", "100 جم"]);
    // the six points above the sizes (#ptsTop)
    expect(p.$<HTMLElement>("#ptsTop")!.hidden).toBe(false);
    expect(p.$("#ptsTop")!.querySelectorAll(".sz-perks li").length).toBe(6);
    // the set directly under the large offers, no heading over it
    const set = p.$("#offer")!;
    expect(set.parentElement!.className).toBe("szcard open s3card s3-bundle s3-bundle-under");
    expect(set.querySelector(".tiers-head")).toBe(null);
    expect(set.previousElementSibling).toBe(null);
    expect(set.parentElement!.previousElementSibling!.className).toMatch(/^szcard open s3card s3-big|^tiers/);

    const off = live(1, (c) => (c.offer!.active = false));
    const q = await openPage({ catalogue: off });
    expect(q.$$(".sz-tiles-still").length).toBe(1); // v335: still stacked
    expect(q.$$(".tile.still").length).toBe(2); // the small tile stays
    expect(q.$<HTMLElement>("#offer")!.hidden).toBe(true);
    expect(q.$<HTMLElement>(".s3-bundle-under")!.hidden).toBe(true);
  });

  it("v335: the from price is the large box with the set present (on or off); the cheapest box without one", async () => {
    const p = await openPage();
    expect(p.LM.fromPrice()).toBe(p.LM.price("large"));
    const c = cat();
    c.offer!.active = false;
    const q = await openPage({ catalogue: c });
    expect(q.LM.fromPrice()).toBe(q.LM.price("large"));
    const r = await openPage({ setup: (LM) => (LM.offerCfg = () => null) });
    expect(r.LM.fromPrice()).toBe(Math.min(r.LM.price("large"), r.LM.price("small")));
  });

  it("the view event reports a box the page sells (not the small one), with the first scent", async () => {
    const p = await openPage();
    expect(p.px.filter((c) => c[0] === "viewContent")).toEqual([["viewContent", "large", "oud"]]);
    // from test-audit-fixes.js: a market with no active scent does not throw, and reports nothing
    const c = cat();
    c.scents.forEach((s) => (s.active = false));
    const q = await openPage({ catalogue: c });
    expect(q.px.filter((x) => x[0] === "viewContent")).toEqual([]);
  });
});

describe("from test-v303.js / test-v309.js / test-v417.js / test-v404.js: the large offers' list", () => {
  it("rows trio, duo, single with their words, prices, struck prices and spoken names", async () => {
    const p = await openPage({ catalogue: live() });
    const LM = p.LM;
    expect(p.$$(".tier").map((r) => r.getAttribute("data-tier"))).toEqual(["trio", "duo", "single"]);
    expect(p.$(".tiers")!.getAttribute("aria-label")).toBe("عروض الحجم الكبير");
    expect(p.$(".tiers-head h3")!.textContent).toBe("كلما زدت، وفّرت");
    expect(rowOf(p, "trio").querySelector(".tier-badge")!.textContent).toBe("الأكثر توفيرًا");
    expect(rowOf(p, "duo").querySelector(".tier-badge")).toBe(null);
    expect(rowOf(p, "trio").querySelector(".tier-txt b")!.textContent).toBe("3 علب");
    expect(rowOf(p, "duo").querySelector(".tier-txt b")!.textContent).toBe("علبتان");
    // v417: the single box by its size, its weight alone, no price a box
    expect(rowOf(p, "single").querySelector(".tier-txt b")!.textContent).toBe("الحجم الكبير");
    expect(rowOf(p, "single").querySelector(".tier-size")!.textContent).toBe("300 جم");
    expect(rowOf(p, "single").querySelectorAll(".tier-txt > span").length).toBe(1);
    expect(rowOf(p, "trio").querySelector(".tier-size")!.textContent).toBe("الحجم الكبير · 300 جم لكل علبة");
    // v310: whole numbers a box for 2+ boxes
    const per = rowOf(p, "trio").querySelector(".tier-txt > span:nth-of-type(2)")!.innerHTML;
    expect(per).toBe(String(Math.round(LM.price("trio") / 3)) + " " + LM.moneyMark() + " للعلبة");
    expect(rowOf(p, "trio").querySelector(".tier-price b")!.innerHTML).toBe(LM.moneyHTML(LM.price("trio")));
    expect(rowOf(p, "trio").querySelector(".tier-price s")!.innerHTML).toBe(LM.moneyHTML(3 * LM.price("large")));
    expect(rowOf(p, "single").querySelector(".tier-shot b")!.textContent).toBe("×1");
    // v407: the spoken name
    expect(radio(p, "trio").getAttribute("aria-label")).toBe("3 علب · الحجم الكبير · " + LM.money(LM.price("trio")));
    // the clock pill, in the panel's unit (hours)
    expect(p.$("#tierClock")!.textContent).toBe("71 ساعة");
    expect(p.$(".tiers-clock")!.textContent).toBe("ينتهي العرض خلال71 ساعة");
  });

  it("a market without the offers (SA): the one-box row alone, no heading, no clock (v403)", async () => {
    const p = await openPage({ catalogue: live(), url: "/?country=SA" });
    expect(p.$(".tiers")!.className).toBe("tiers tiers-plain");
    expect(p.$(".tiers")!.getAttribute("aria-label")).toBe("الحجم الكبير");
    expect(p.$$(".tier").map((r) => r.getAttribute("data-tier"))).toEqual(["single"]);
    expect(p.$(".tiers-head")).toBe(null);
    expect(p.$("#tierClock")).toBe(null);
  });

  it("the countdown is the panel's choice (tiers.clock false → no pill)", async () => {
    const p = await openPage({ catalogue: live(1, (c) => (c.tiers!.clock = false)) });
    expect(p.$(".tiers-head h3")).not.toBe(null);
    expect(p.$("#tierClock")).toBe(null);
  });

  it("a row whose price reaches free delivery says so", async () => {
    const p = await openPage({ catalogue: live() }); // OM: free over 30, large 12.9 → duo/trio over it
    const LM = p.LM;
    const free = (id: string) => !!rowOf(p, id).querySelector(".tier-free");
    expect(free("single")).toBe(false);
    expect(free("trio")).toBe(LM.price("trio") >= LM.freeOver());
  });
});

describe("from test-v406.js / test-v440.js / test-v407.js: choosing, letting go, phone vs desktop", () => {
  it("desktop: nothing chosen at first; the scents drawn but waiting hidden", async () => {
    const p = await openPage({ catalogue: live() });
    expect(p.$$(".tier.on").length).toBe(0);
    const idle = p.$$(".szcard.s3-big").filter((c) => c.hidden);
    expect(idle.length).toBe(1);
    expect(idle[0]!.querySelectorAll(".prow").length).toBe(3);
    expect(p.$(".tier-scents")).toBe(null);
  });

  it("choosing a row opens its scents under it; the button counts 0/3; the offer takes three and no more", async () => {
    const p = await openPage({ catalogue: live() });
    choose(p, "trio");
    expect(rowOf(p, "trio").classList.contains("on")).toBe(true);
    const under = rowOf(p, "trio").nextElementSibling!;
    expect(under.className).toBe("szcard open s3card s3-big tier-scents");
    expect(p.$$(".szcard.s3-big").filter((c) => c.hidden).length).toBe(0);
    expect(p.$("#addLabel")!.textContent).toBe("اختر روائح ⁦0/3⁩");
    const r = (id: string) => under.querySelector('.prow[data-scent="' + id + '"]')!;
    step(r("oud"), 1);
    step(r("oud"), 1);
    expect(p.$("#addLabel")!.textContent).toBe("اختر روائح ⁦2/3⁩");
    expect(p.$<HTMLButtonElement>("#add")!.disabled).toBe(true);
    step(r("amber"), 1);
    step(r("lemon"), 1); // a fourth is refused
    expect(r("lemon").querySelector("[data-count]")!.textContent).toBe("0");
    expect(p.$("#addLabel")!.textContent).toBe("أضف 3 علب · " + p.LM.money(p.LM.price("trio")));
    expect(p.$<HTMLButtonElement>("#add")!.disabled).toBe(false);
    // the sticky price is the offer's
    expect(p.$("#sPrice")!.innerHTML).toBe(p.LM.moneyHTML(p.LM.price("trio")));
    expect(p.ship[p.ship.length - 1]).toBe(p.LM.price("trio"));
    tap(p.$("#add"));
    // ONE line, the mix in the market's order
    expect(p.basket()).toEqual([
      expect.objectContaining({ sizeId: "trio", scentId: null, mix: ["oud", "oud", "amber"], scent: "3 علب", qty: 1, img: "white-box-open", price: p.LM.price("trio") }),
    ]);
    expect(p.LM.itemId(p.basket()[0]!)).toBe("trio:oud.oud.amber");
    expect(p.ev).toContainEqual(["add_cart", "trio"]);
    // the same mix again is the same line
    const u2 = rowOf(p, "trio").nextElementSibling!;
    step(u2.querySelector('.prow[data-scent="amber"]'), 1);
    step(u2.querySelector('.prow[data-scent="oud"]'), 1);
    step(u2.querySelector('.prow[data-scent="oud"]'), 1);
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(1700);
    } finally {
      vi.useRealTimers();
    }
    tap(p.$("#add"));
    expect(p.basket().length).toBe(1);
    expect(p.basket()[0]!.qty).toBe(2);
  });

  it("duo: \"أضف علبتين\" once complete", async () => {
    const p = await openPage({ catalogue: live() });
    choose(p, "duo");
    const under = rowOf(p, "duo").nextElementSibling!;
    step(under.querySelector('.prow[data-scent="lemon"]'), 1);
    step(under.querySelector('.prow[data-scent="amber"]'), 1);
    expect(p.$("#addLabel")!.textContent).toBe("أضف علبتين · " + p.LM.money(p.LM.price("duo")));
  });

  it("desktop: the chosen row tapped again lets go, its counts with it (v406); Space too (v407)", async () => {
    const p = await openPage({ catalogue: live() });
    choose(p, "single");
    step(rowOf(p, "single").nextElementSibling!.querySelector('.prow[data-scent="oud"]'), 1);
    tap(rowOf(p, "single"));
    expect(p.$$(".tier.on").length).toBe(0);
    expect((await import("../../../src/web/product/state")).P.QTY.large).toBe(undefined);
    choose(p, "duo");
    const r = radio(p, "duo");
    r.focus();
    const e = key(r, " ");
    expect(e.defaultPrevented).toBe(true);
    expect(p.$$(".tier.on").length).toBe(0);
    // focus goes back to the new radio of the row it let go
    expect(document.activeElement).toBe(radio(p, "duo"));
  });

  it("phone: the large size opens chosen (trio when on) and a second tap or Space keeps it (v440)", async () => {
    const p = await openPage({ catalogue: live(), media: { phone: true } });
    expect(rowOf(p, "trio").classList.contains("on")).toBe(true);
    step(rowOf(p, "trio").nextElementSibling!.querySelector('.prow[data-scent="oud"]'), 1);
    tap(rowOf(p, "trio"));
    expect(rowOf(p, "trio").classList.contains("on")).toBe(true);
    expect((await import("../../../src/web/product/state")).P.QTY.large).toEqual({ oud: 1 });
    const e = key(radio(p, "trio"), " ");
    expect(e.defaultPrevented).toBe(false);
    expect(rowOf(p, "trio").classList.contains("on")).toBe(true);

    // offers off: "single" opens chosen on a phone
    const q = await openPage({ media: { phone: true } });
    expect(rowOf(q, "single").classList.contains("on")).toBe(true);
    // a desktop: nothing
    const d = await openPage();
    expect(d.$$(".tier.on").length).toBe(0);
  });

  it("v336: a change of row moves focus to the new radio when it (or the body) had it", async () => {
    const p = await openPage({ catalogue: live() });
    const r = radio(p, "duo");
    r.focus();
    choose(p, "duo");
    expect(document.activeElement).toBe(radio(p, "duo"));
    expect(radio(p, "duo")).not.toBe(r);
  });
});

describe("from test-v403.js / test-v406.js / test-v407.js / test-v440.js: the set as a choice", () => {
  it("a radio in the same group; choosing it lets the large rows go and clears their picks", async () => {
    const p = await openPage({ catalogue: live() });
    expect(setRadio(p).closest("label")!.className).toBe("ob-row");
    expect(p.$(".ob-card")!.className).toBe("ob-card pick");
    choose(p, "trio");
    step(rowOf(p, "trio").nextElementSibling!.querySelector('.prow[data-scent="oud"]'), 1);
    chooseSet(p);
    const S = await import("../../../src/web/product/state");
    expect(S.st.set).toBe(true);
    expect(S.st.tier).toBe(null);
    expect(S.P.QTY.large).toBe(undefined);
    expect(p.$$(".tier.on").length).toBe(0);
    expect(p.$(".ob-card")!.className).toBe("ob-card pick on");
    expect(setRadio(p).checked).toBe(true);
    expect(document.activeElement).toBe(setRadio(p));
    // the sticky price follows the chosen set
    expect(p.$("#sPrice")!.innerHTML).toBe(p.LM.moneyHTML(p.LM.price("bundle")));
    // its spoken name
    expect(setRadio(p).getAttribute("aria-label")).toBe("باقة الروائح الثلاث · الحجم الصغير · " + p.LM.money(p.LM.price("bundle")));
    // a large row chosen again: the set lets go
    choose(p, "duo");
    expect(S.st.set).toBe(false);
    expect(p.$(".ob-card")!.className).toBe("ob-card pick");
  });

  it("desktop: the chosen set tapped again, or Space, lets go; a phone keeps it", async () => {
    const p = await openPage({ catalogue: live() });
    chooseSet(p);
    tap(p.$("#offer .ob-row"));
    const S = await import("../../../src/web/product/state");
    expect(S.st.set).toBe(false);
    chooseSet(p);
    const e = key(setRadio(p), " ");
    expect(e.defaultPrevented).toBe(true);
    expect(S.st.set).toBe(false);

    const q = await openPage({ catalogue: live(), media: { phone: true } });
    const S2 = await import("../../../src/web/product/state");
    chooseSet(q);
    expect(S2.st.set).toBe(true);
    expect(q.$$(".tier.on").length).toBe(0); // v440: the set chosen, no large row
    tap(q.$("#offer .ob-row"));
    expect(S2.st.set).toBe(true);
    key(setRadio(q), " ");
    expect(S2.st.set).toBe(true);
  });
});

describe("from test-v336-product.js: sticky bar, ended offers, tiles", () => {
  it("9. the stacked page's sticky words and target; the price shown", async () => {
    const p = await openPage({ catalogue: live() });
    expect(p.$("#stickyAdd")!.textContent).toBe("اختر عرضك");
    const spy = vi.fn();
    p.$(".tiers")!.scrollIntoView = spy;
    tap(p.$("#stickyAdd"));
    expect(spy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(p.$("#sPrice")!.innerHTML).toBe(p.LM.moneyHTML(p.LM.fromPrice()));
    // the large box sold out, set open → the set's price; set not open → nothing
    const c = live(1, (k) => {
      const om = marketOf(k, "OM");
      om.sizes = JSON.parse(JSON.stringify(k.sizes));
      om.sizes!.find((s) => s.id === "large")!.soldOut = true;
    });
    const q = await openPage({ catalogue: c });
    expect(q.$("#sPrice")!.innerHTML).toBe(q.LM.moneyHTML(q.LM.price("bundle")));
    const spy2 = vi.fn();
    q.$("#offer")!.scrollIntoView = spy2;
    tap(q.$("#stickyAdd"));
    expect(spy2).toHaveBeenCalled(); // no .tiers: the visible set
    c.offer!.active = false;
    const r = await openPage({ catalogue: c });
    expect(r.$<HTMLElement>("#sPrice")!.hidden).toBe(true);
    expect(r.$("#sPrice")!.innerHTML).toBe("");
    // the pick-a-size page says "اختر حجمك"
    const s = await openPage({ setup: (LM) => (LM.offerCfg = () => null) });
    expect(s.$("#stickyAdd")!.textContent).toBe("اختر حجمك");
  });

  it("6. an offer that ends takes its picks; the step and the add redraw instead of counting", async () => {
    const p = await openPage({ catalogue: live(), media: { phone: true } });
    const S = await import("../../../src/web/product/state");
    const under = () => rowOf(p, "trio").nextElementSibling!;
    step(under().querySelector('.prow[data-scent="oud"]'), 1);
    expect(S.P.QTY.large).toEqual({ oud: 1 });
    const realOn = p.LM.tierOn;
    p.LM.tierOn = () => false; // the window ended between ticks
    step(p.$('.tier-scents .prow[data-scent="oud"]'), 1);
    expect(S.st.tier).toBe("single"); // the redraw (phone) opens the one-box row
    expect(S.P.QTY.large).toBe(undefined);
    expect(p.$$(".tier").map((r) => r.getAttribute("data-tier"))).toEqual(["single"]);
    p.LM.tierOn = realOn;
  });

  it("4. tileWords: 0 on sale → the weight; every scent hidden or capped at 0 → sold out; the set's size follows the set", async () => {
    const shelf = (left: Record<string, number>, hide: { items: string[]; sizes: string[] }, cap: Record<string, number> = {}) => ({ left, hide, cap });
    const c = cat();
    c.stockLive = true;
    let p = await openPage({ catalogue: c, stock: shelf({ large: 0, small: 0 }, { items: [], sizes: [] }) });
    await vi.waitFor(() => expect(p.LM.stockLeft("large")).toBe(0));
    const words = () => p.$$(".tile-name").map((t) => t.textContent);
    expect(words()).toEqual(["300 جم", "100 جم"]);
    c.stockHide = { "oud-large": true, "lemon-large": true, "amber-large": true };
    p = await openPage({ catalogue: c, stock: shelf({ large: 0, small: 0 }, { items: ["oud-large", "lemon-large", "amber-large"], sizes: [] }) });
    await vi.waitFor(() => expect(p.LM.stockLeft("large")).toBe(0));
    expect(words()).toEqual(["نفدت الكمية", "100 جم"]);
    c.stockCap = { "oud-small": true, "lemon-small": true, "amber-small": true };
    p = await openPage({ catalogue: c, stock: shelf({ large: 0, small: 0 }, { items: [], sizes: [] }, { "oud-small": 0, "lemon-small": 0, "amber-small": 0 }) });
    await vi.waitFor(() => expect(p.LM.stockLeft("small")).toBe(0));
    expect(words()).toEqual(["300 جم", "نفدت الكمية"]);
    // a positive count: leftWords of the shown 30%
    p = await openPage({ catalogue: c, stock: shelf({ large: 120, small: 47 }, { items: [], sizes: [] }) });
    await vi.waitFor(() => expect(p.LM.stockLeft("large")).toBe(36));
    expect(words()).toEqual(["36 قطعة متبقية", "14 قطعة متبقية"]);
    expect(p.$$(".tile-name").map((t) => t.classList.contains("is-left"))).toEqual([true, true]);
  });

  it("from test-v403.js: while the shelf has not answered, the tile holds its place blank", async () => {
    const c = cat();
    c.stockLive = true;
    const p = await openPage({ catalogue: c, answer: (u) => (u.indexOf("/api/stock") === 0 ? new Promise<Response>(() => {}) : null) });
    expect(p.$$(".tile-name").map((t) => t.textContent)).toEqual([" ", " "]);
  });
});
