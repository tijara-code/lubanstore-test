/**
 * The size → scent picker as a catalogue WITHOUT the three-scent set draws it (the
 * pick-a-size page; with a set, on or off, the page is the stacked one — stacked.test.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cat, marketOf, openPage, step, tap, type LmApi, type Page } from "./_page";

/* from test-picker.js: amber out of the SMALL box, in stock in the large one; no set */
function pickerSetup(LM: LmApi) {
  const realScents = LM.scents;
  LM.scents = () => realScents.call(LM).map((s) => (s.id === "amber" ? Object.assign({}, s, { soldOutSizes: ["small"] }) : s));
  LM.offerCfg = () => null;
}
const panel = (p: Page) => p.$("#sizes")!.querySelector(".picker")!;
const row = (p: Page, id: string) => panel(p).querySelector('.prow[data-scent="' + id + '"]')!;
const count = (p: Page, id: string) => row(p, id).querySelector("[data-count]")!.textContent;

afterEach(() => vi.restoreAllMocks());

describe("from test-picker.js: tiles, one grid, steppers, add", () => {
  it("walks the picker end to end", async () => {
    const p = await openPage({ setup: pickerSetup });
    const tiles = () => p.$$(".tile");
    expect(tiles().length).toBe(2);
    // the best seller (first, large) is chosen from the start
    expect(tiles()[0]!.getAttribute("aria-checked")).toBe("true");
    expect(!!panel(p)).toBe(true);
    expect(!!p.$("#sizes")!.querySelector(".szcard")).toBe(true);
    expect(panel(p).querySelectorAll(".prow").length).toBe(3);
    expect(p.$<HTMLButtonElement>("#add")!.disabled).toBe(true);

    step(row(p, "oud"), 1);
    expect(count(p, "oud")).toBe("1");
    expect(row(p, "oud").classList.contains("on")).toBe(true);
    expect(p.$<HTMLButtonElement>("#add")!.disabled).toBe(false);

    step(row(p, "lemon"), 1);
    step(row(p, "lemon"), 1);
    expect(count(p, "lemon")).toBe("2");
    step(row(p, "oud"), -1);
    step(row(p, "oud"), -1);
    expect(count(p, "oud")).toBe("0"); // never below zero
    expect(row(p, "oud").classList.contains("on")).toBe(false);
    step(row(p, "lemon"), 1); // lemon -> 3

    tap(p.$("#add"));
    expect(p.basket().length).toBe(1);
    expect(p.basket()[0]!.scentId).toBe("lemon");
    expect(p.basket()[0]!.qty).toBe(3);
    expect(p.basket()[0]!.sizeId).toBe("large");
    expect(count(p, "lemon")).toBe("0");
    // the add's events: one LMPX.addCart and one LMEV add_cart per line
    expect(p.px.filter((c) => c[0] === "addCart").length).toBe(1);
    expect(p.ev).toContainEqual(["add_cart", "lemon-large"]);
    // the basket line holds the catalogue's own words and the gallery's first picture
    expect(p.basket()[0]).toMatchObject({ scent: "ليمون مسك", size: "كبير", img: "white-box-open", price: p.LM.price("large") });
  });

  it("fly to cart: one clone per scent, staggered, removed on animationend; none under reduced motion", async () => {
    const p = await openPage({ setup: pickerSetup });
    step(row(p, "oud"), 1);
    step(row(p, "amber"), 1);
    tap(p.$("#add"));
    const flies = p.$$(".fly");
    expect(flies.length).toBe(2);
    expect(flies[0]!.style.cssText).toMatch(/--dx:/);
    expect(flies[0]!.style.cssText).toMatch(/animation-delay:/);
    expect(flies[1]!.style.cssText).toMatch(/animation-delay: ?110ms/);
    flies[0]!.dispatchEvent(new Event("animationend"));
    expect(flies[0]!.parentNode).toBe(null);

    p.media.reduce = true;
    const before = p.basket().find((l) => l.scentId === "oud")!.qty;
    p.$$(".fly").forEach((f) => f.remove());
    step(row(p, "oud"), 1);
    tap(p.$("#add"));
    expect(p.$$(".fly").length).toBe(0);
    expect(p.basket().find((l) => l.scentId === "oud")!.qty).toBe(before + 1);
    p.media.reduce = false;

    step(row(p, "oud"), 1);
    step(row(p, "lemon"), 1);
    tap(p.$("#add"));
    expect(p.basket().length).toBe(3); // three distinct scents, three lines
  });

  it("switching size: the grid becomes the other size's, counts cleared; the chosen tile again changes nothing", async () => {
    const p = await openPage({ setup: pickerSetup });
    const tiles = () => p.$$(".tile");
    step(row(p, "oud"), 1);
    tap(tiles()[1]!);
    expect(tiles()[1]!.getAttribute("aria-checked")).toBe("true");
    expect(tiles()[0]!.getAttribute("aria-checked")).toBe("false");
    expect(p.$("#sizes")!.querySelectorAll(".picker").length).toBe(1);
    expect(Array.from(panel(p).querySelectorAll("[data-count]")).every((c) => c.textContent === "0")).toBe(true);
    expect(p.$<HTMLButtonElement>("#add")!.disabled).toBe(true);
    const before = panel(p);
    tap(tiles()[1]!);
    expect(panel(p)).toBe(before);
  });

  it("a scent out of THIS box is shut with no counter; adding the others still works end to end", async () => {
    const p = await openPage({ setup: pickerSetup });
    tap(p.$$(".tile")[1]!); // the small box
    const amber = row(p, "amber");
    expect(amber.classList.contains("shut")).toBe(true);
    expect(amber.querySelector("[data-count]")).toBe(null);
    // from test-store-look.js: the words in the stepper's slot, the middle cell always there
    expect(amber.innerHTML).toMatch(/<span class="prow-mid"><\/span><em class="sz-tag out">نفدت الكمية<\/em>$/);
    step(row(p, "oud"), 1);
    tap(p.$("#add"));
    expect(p.basket().some((l) => l.scentId === "oud" && l.sizeId === "small")).toBe(true);
    expect(p.$$(".fly").length).toBe(1);
    expect(count(p, "oud")).toBe("0");
    expect(p.$("#add")!.textContent).toContain("تمت");
  });

  it("sizesOpen is a no-op: still two tiles, one grid; the row is a radiogroup", async () => {
    const c = cat();
    (marketOf(c, "OM") as Record<string, unknown>).sizesOpen = true;
    const p = await openPage({ catalogue: c, setup: pickerSetup });
    expect(p.$$(".tile").length).toBe(2);
    expect(p.$$(".picker").length).toBe(1);
    expect(p.$(".sz-tiles")!.getAttribute("role")).toBe("radiogroup");
  });
});

describe("from test-v192.js / test-v205.js / test-v203.js: the tiles", () => {
  it("a sold-out tile is disabled, takes no tap, says so; the chosen one moves off it", async () => {
    const c = cat();
    const om = marketOf(c, "OM");
    om.sizes = JSON.parse(JSON.stringify(c.sizes));
    om.sizes!.find((s) => s.id === "large")!.soldOut = true;
    const p = await openPage({ catalogue: c, setup: pickerSetup });
    const shut = p.$$<HTMLButtonElement>(".tile.shut");
    expect(shut.length).toBe(1);
    expect(shut[0]!.disabled).toBe(true);
    expect(shut[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(shut[0]!.innerHTML).toContain('<em class="tile-tag out">نفدت الكمية</em>');
    tap(shut[0]!);
    expect(shut[0]!.getAttribute("aria-checked")).toBe("false");
    expect(p.$(".tile.open")!.querySelector(".tile-name")!.textContent).toBe("100 جم");
    // v311: the weight alone, no price on a tile
    expect(p.$(".tile")!.querySelector(".sz-price")).toBe(null);
  });

  it("--n = max(2, min(3, sizes)): one size does not stretch", async () => {
    for (const [n, want] of [
      [1, "2"],
      [2, "2"],
    ] as const) {
      const c = cat();
      const om = marketOf(c, "OM");
      om.sizes = JSON.parse(JSON.stringify(c.sizes)).slice(0, n);
      const p = await openPage({ catalogue: c, setup: pickerSetup });
      expect(p.$<HTMLElement>(".sz-tiles")!.style.getPropertyValue("--n")).toBe(want);
    }
  });

  it("the grid's head is the chosen size's label (sizeLabel), with what is left beside it", async () => {
    const p = await openPage({ setup: pickerSetup });
    expect(p.$(".s3card-head .s3-lbl")!.textContent).toBe("الحجم الكبير");
    expect(p.$<HTMLElement>("#sizeLeft")!.hidden).toBe(true);
  });
});

describe("from test-availability.js (storefront): KW with the small box and amber sold out", () => {
  it("tiles, rows, from price; AE after lm:country", async () => {
    const c = cat();
    const kw = marketOf(c, "KW");
    kw.sizes = JSON.parse(JSON.stringify(c.sizes));
    kw.sizes!.find((s) => s.id === "small")!.soldOut = true;
    kw.scents = JSON.parse(JSON.stringify(c.scents));
    kw.scents!.find((s) => s.id === "amber")!.soldOut = true;
    const p = await openPage({ catalogue: c, url: "/?country=KW", setup: (LM) => (LM.offerCfg = () => null) });
    expect(p.$$(".tile").length).toBe(2);
    const shut = p.$$<HTMLButtonElement>(".tile.shut");
    expect(shut.length).toBe(1);
    expect(shut[0]!.textContent).toContain("نفدت الكمية");
    expect(shut[0]!.textContent).toContain("100 جم");
    expect(shut[0]!.querySelector(".sz-price")).toBe(null);
    expect(shut[0]!.disabled).toBe(true);
    expect(p.LM.fromPrice()).toBe(p.LM.price("large"));
    expect(p.$('.prow[data-scent="amber"]')!.className).toBe("prow shut");
    expect(p.$('.prow[data-scent="oud"]')!.className).toBe("prow");

    p.LM.setCountry("AE");
    expect(p.$$(".tile.shut").length).toBe(0);
    expect(p.$$(".prow.shut").length).toBe(0);
  });
});

describe("from test-v209.js / test-v208.js: one rule for the rows and the add", () => {
  it("a market change carries counts and keeps the add button live (v209)", async () => {
    const p = await openPage({ setup: pickerSetup });
    step(row(p, "oud"), 1);
    p.LM.setCountry("AE");
    expect(count(p, "oud")).toBe("1");
    expect(p.$<HTMLButtonElement>("#add")!.disabled).toBe(false);
    expect(p.$("#addLabel")!.textContent).toContain(p.LM.money(p.LM.price("large")));
  });
});
