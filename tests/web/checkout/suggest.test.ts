/**
 * The free-delivery bar's rows (header module): the one-tap scent suggestion (RANK, boxFor,
 * the packshot + chip), the offer step (v310), and the shop's add-ons and sampler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootPage, catalogueFile, json, LINE } from "./_page";
import type { CartLine, Country, LmApi } from "../../../src/web/core/types";
import { G as W } from "../../../src/web/checkout/contracts";

let LM: LmApi;
let base: Country;
let repaints = 0;
const $ = <E extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as E;
const setCart = (c: unknown[]) => sessionStorage.setItem("lm_cart", JSON.stringify(c));
const getCart = (): CartLine[] => JSON.parse(sessionStorage.getItem("lm_cart") || "[]");
const shown = () => (!$("#freeAdd").hidden ? $("#faName").textContent : null);
const art = () => $("#faArt").innerHTML;
const nameOf = (id: string) => LM.listFor("scents").filter((s) => s.id === id)[0]!.name;
const roomy = () => (LM.c = { ...base, freeOver: 1e6 });
/* innerHTML as the DOM writes it (self-closing SVG tags opened) */
const norm = (h: string) => {
  const d = document.createElement("div");
  d.innerHTML = h;
  return d.innerHTML;
};

/* the checkout module is the page's repaint hook; these tests count it as the original did */
async function boot(url = "/checkout.html?country=OM", extra: Record<string, unknown> = {}) {
  const p = await bootPage({ url, cart: [LINE("oud", "large")], ...extra });
  LM = p.LM;
  base = LM.c;
  repaints = 0;
  W().lmOnCartChange = () => {
    repaints++;
    W().lmShip!(0);
  };
  return p;
}

beforeEach(async () => {
  await boot();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// from test-suggest-scent.js
describe("the ranking: oud, amber, lemon — the scent the basket has least of", () => {
  it("walks down the ranking and comes back round", () => {
    roomy();
    const cases: Array<[unknown[], string]> = [
      [[], "oud"],
      [[LINE("oud", "small")], "amber"],
      [[LINE("oud", "large")], "amber"],
      [[LINE("oud", "small"), LINE("amber", "large")], "lemon"],
      [[LINE("oud", "small"), LINE("amber", "small"), LINE("lemon", "small")], "oud"],
      [[LINE("oud", "small", 2), LINE("amber", "small"), LINE("lemon", "small")], "amber"],
      [[LINE("oud", "small", 2), LINE("amber", "small", 2), LINE("lemon", "small")], "lemon"],
      [[LINE("amber", "small")], "oud"],
      [[LINE("lemon", "small")], "oud"],
    ];
    for (const [cart, want] of cases) {
      setCart(cart);
      W().lmShip!(0);
      expect(shown(), JSON.stringify(cart)).toBe(nameOf(want));
    }
  });

  it("a scent sold out: it still has something to offer", () => {
    LM.c = { ...base, freeOver: 1e6, scents: LM.listFor("scents").map((s) => ({ ...s, soldOut: s.id === "lemon" })) };
    setCart([LINE("oud", "small"), LINE("amber", "small")]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("oud"));
  });

  it("the set is one of every scent; a loose oud beside it makes amber the fewest", () => {
    roomy();
    setCart([{ scentId: "bundle", scent: "باقة", sizeId: "bundle", size: "x", price: 29, qty: 1 }]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("oud"));
    setCart([{ scentId: "bundle", sizeId: "bundle", price: 29, qty: 1 }, LINE("oud", "small")]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("amber"));
  });

  it("an offer line counts its mix (v310)", () => {
    roomy();
    setCart([{ sizeId: "trio", scentId: null, mix: ["oud", "amber", "amber"], qty: 1, price: 1 }]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("lemon"));
  });

  it("a scent the rank does not name is still reachable, after the ranked ones, in catalogue order", () => {
    const scents = [...LM.listFor("scents"), { id: "rose", name: "ورد", active: true }];
    LM.c = { ...base, freeOver: 1e6, scents, prices: { ...base.prices } };
    setCart([LINE("oud", "small"), LINE("amber", "small"), LINE("lemon", "small")]);
    W().lmShip!(0);
    expect(shown()).toBe("ورد");
  });
});

describe("it stops at free delivery", () => {
  it("short: offers; past the threshold: hidden (not empty); a preview does not silence it", () => {
    LM.c = base;
    const small = LM.price("small"), need = LM.freeOver();
    setCart([LINE("oud", "small")]);
    W().lmShip!(0);
    expect(shown() !== null).toBe(true);
    setCart([LINE("oud", "small", Math.ceil(need / small) + 1)]);
    W().lmShip!(0);
    expect(shown()).toBe(null);
    expect($("#freeAdd").hidden).toBe(true);
    setCart([LINE("oud", "small")]);
    W().lmShip!(need);
    expect(shown() !== null).toBe(true);
  });
});

describe("it never offers what the till would refuse", () => {
  const out = (ids: string[]) => ({ ...LM.c, scents: LM.listFor("scents").map((s) => ({ ...s, soldOut: ids.indexOf(s.id) > -1 })) });
  it("oud out → amber; oud and amber out → lemon; all out → nothing — the cart's own rule", () => {
    roomy();
    LM.c = out(["oud"]);
    setCart([]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("amber"));
    LM.c = out(["oud", "amber"]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("lemon"));
    LM.c = out(["oud", "amber", "lemon"]);
    W().lmShip!(0);
    expect(shown()).toBe(null);
    LM.c = out(["oud"]);
    expect(LM.lineOffered({ scentId: "oud", sizeId: "small" } as CartLine)).toBe(false);
  });

  // from test-v208.js (a hidden box), test-v211.js (a box at its cap)
  it("a box the shelf hides, or one the basket holds up to its cap, is not offered (lm:stock repaints)", async () => {
    const p = await boot("/checkout.html?country=OM", {
      answer: (url: string) =>
        url.indexOf("/api/stock") === 0 ? json({ left: {}, hide: { items: ["oud-small"], sizes: [] }, cap: { "amber-small": 1 } }) : null,
      catalogue: { ...catalogueFile(), stockHide: { "oud-small": true }, stockCap: { "amber-small": true } },
    });
    roomy();
    setCart([LINE("amber", "small")]);
    p.LM.loadStock();
    await new Promise((r) => setTimeout(r, 20));
    W().lmShip!(0);
    expect(p.LM.stockHidden("oud", "small")).toBe(true);
    {
      /* oud: the small box is hidden → its large box; amber is at its cap of 1 in the small box */
      expect(shown()).toBe(nameOf("oud"));
      expect($("#faNote").textContent).toBe(LM.txt(LM.listFor("sizes").filter((z) => z.id === "large")[0], "weight"));
      setCart([LINE("amber", "small"), LINE("oud", "large")]);
      W().lmShip!(0);
      expect($("#faArt").getAttribute("data-k")).toBe("lemon-small");
    }
    /* lm:stock repaints the row (checkout only) */
    const spy = vi.fn();
    const real = W().lmShip!;
    W().lmShip = (x?: number) => {
      spy(x);
      real(x);
    };
    window.dispatchEvent(new Event("lm:stock"));
    expect(spy).toHaveBeenCalledWith(0);
  });
});

describe("no small box: the large one, in the same sequence", () => {
  const note = () => $("#faNote").textContent;
  const large = () => LM.listFor("sizes").filter((z) => z.id === "large")[0]!;
  it("unpriced small → oud large: its weight, its price, the white box with oud's chip; tap adds the large box", () => {
    LM.c = { ...base, freeOver: 1e6, prices: { ...base.prices, small: { now: 0 } } };
    setCart([]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("oud"));
    expect(note()).toBe(LM.txt(large(), "weight"));
    expect($("#faPrice").innerHTML).toBe(LM.moneyHTML(LM.price("large")));
    expect(/white-box-open-sm\.jpg/.test(art())).toBe(true);
    expect(art().indexOf(norm(LM.scentMark("oud"))) > -1).toBe(true);
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("amber"));
    $("#freeAdd").click();
    const added = getCart().filter((l) => l.scentId === "amber")[0]!;
    expect([added.sizeId, added.price, added.size]).toEqual(["large", LM.price("large"), large().name]);
  });

  it("a hidden, removed or sold-out small box → large; neither box → nothing", () => {
    const sizesWith = (fn: (z: Record<string, unknown>) => Record<string, unknown>) => LM.listFor("sizes").map((z) => fn({ ...z }));
    const scents = LM.listFor("scents");
    for (const sizes of [
      sizesWith((z) => (z.id === "small" ? { ...z, hidden: true } : z)),
      sizesWith((z) => z).filter((z) => z.id !== "small"),
      sizesWith((z) => (z.id === "small" ? { ...z, soldOut: true } : z)),
    ]) {
      LM.c = { ...base, freeOver: 1e6, sizes: sizes as Country["sizes"], scents };
      setCart([]);
      W().lmShip!(0);
      expect(shown() + " / " + note()).toBe(nameOf("oud") + " / " + LM.txt(large(), "weight"));
    }
    LM.c = { ...base, freeOver: 1e6, prices: { ...base.prices, small: { now: 0 }, large: { now: 0 } } };
    W().lmShip!(0);
    expect(shown()).toBe(null);
  });

  it("box by box: oud out in the small box only → oud large, then amber back in the small red box", () => {
    LM.c = { ...base, freeOver: 1e6, scents: LM.listFor("scents").map((s) => ({ ...s, soldOutSizes: s.id === "oud" ? ["small"] : [] })) };
    setCart([]);
    W().lmShip!(0);
    expect(note()).toBe(LM.txt(large(), "weight"));
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("amber"));
    expect(note()).toBe(LM.txt(LM.listFor("sizes").filter((z) => z.id === "small")[0], "weight"));
    expect(/red-box-open-sm\.jpg/.test(art()) && !/white-box/.test(art())).toBe(true);
  });
});

describe("the picture is the box, with the scent's chip (v187)", () => {
  it("the small red packshot in avif/webp/jpg with the cache key, the chip, the thumb frame; untouched on a repaint", () => {
    roomy();
    setCart([]);
    W().lmShip!(0);
    expect(/assets\/img\/red-box-open-sm\.jpg/.test(art())).toBe(true);
    expect(/red-box-open-sm\.avif/.test(art()) && /red-box-open-sm\.webp/.test(art())).toBe(true);
    expect(art().indexOf(norm(LM.scentMark("oud"))) > -1).toBe(true);
    expect(/^<span class="thumb"><picture>/.test(art())).toBe(true);
    expect(art().indexOf("-sm.jpg" + LM.v) > -1).toBe(true);
    expect(art()).toContain('width="36" height="36"');
    const drawn = art();
    $("#faArt").innerHTML = "UNTOUCHED";
    W().lmShip!(0);
    expect(art()).toBe("UNTOUCHED");
    $("#faArt").innerHTML = drawn;
    setCart([LINE("oud", "small")]);
    W().lmShip!(0);
    expect(art().indexOf(norm(LM.scentMark("amber"))) > -1).toBe(true);
    expect($("#faArt").getAttribute("data-k")).toBe("amber-small");
  });
});

describe("one tap, one box", () => {
  it("adds one small amber at the catalogue price with the size's name and no img; repaints; moves on", () => {
    const added: unknown[] = [];
    const ev: unknown[][] = [];
    (window as unknown as Record<string, unknown>).LMPX = { addCart: (l: unknown) => added.push(l), purchase() {}, startCheckout() {} };
    (window as unknown as Record<string, unknown>).LMEV = { track: (...a: unknown[]) => ev.push(a) };
    roomy();
    setCart([LINE("oud", "small")]);
    W().lmShip!(0);
    expect(shown()).toBe(nameOf("amber"));
    $("#freeAdd").click();
    const cart = getCart();
    expect(cart.length).toBe(2);
    expect([cart[1]!.scentId, cart[1]!.sizeId, cart[1]!.qty, cart[1]!.price]).toEqual(["amber", "small", 1, LM.price("small")]);
    expect(cart[1]!.size).toBe(LM.listFor("sizes").filter((z) => z.id === "small")[0]!.name);
    expect(cart[1]!.img).toBe(undefined);
    expect(cart[1]!.scent).toBe(nameOf("amber"));
    expect(repaints > 0).toBe(true);
    expect(shown()).toBe(nameOf("lemon"));
    expect(added).toEqual([cart[1]]);
    expect(ev).toEqual([["suggest_add", "amber-small"]]);
    /* bound once: three repaints later a tap still adds one line */
    const before = getCart().length;
    W().lmShip!(0);
    W().lmShip!(0);
    W().lmShip!(0);
    $("#freeAdd").click();
    expect(getCart().length).toBe(before + 1);
  });

  it("the same suggestion twice raises the quantity, never a second line (capped at 99)", () => {
    LM.c = { ...base, freeOver: 1e6, scents: LM.listFor("scents").map((s) => ({ ...s, soldOut: s.id !== "oud" })) };
    setCart([LINE("oud", "small", 98)]);
    W().lmShip!(0);
    $("#freeAdd").click();
    $("#freeAdd").click();
    expect(getCart().filter((l) => l.scentId === "oud" && l.sizeId === "small").map((l) => l.qty)).toEqual([99]);
  });

  it("without the checkout's hook the tap repaints the bar itself", () => {
    delete W().lmOnCartChange;
    roomy();
    setCart([]);
    W().lmShip!(0);
    $("#freeAdd").click();
    expect(shown()).toBe(nameOf("amber"));
  });
});

// from test-v310.js (the offer step)
describe("one more box, at the offer's price (v310)", () => {
  async function tiersOn() {
    const c = catalogueFile();
    c.tiers = { active: true, sizeId: "large", countries: [] };
    await boot("/checkout.html?country=OM", { catalogue: c });
    LM.c = { ...base, freeOver: 1e6 };
  }
  it("a single large box → the two-box offer: named علبتان, + the next scent, priced at the difference; the tap swaps the line", async () => {
    await tiersOn();
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    expect($("#faName").textContent).toBe("علبتان");
    expect($("#faNote").textContent).toBe("+ " + nameOf("amber"));
    expect($("#faPrice").innerHTML).toBe(LM.moneyHTML(Math.round((LM.price("duo") - LM.price("large")) * 1000) / 1000));
    expect($("#faArt").getAttribute("data-k")).toBe("up-amber-duo");
    expect(/white-box-open-sm\.jpg/.test(art())).toBe(true);
    $("#freeAdd").click();
    const cart = getCart();
    expect(cart.length).toBe(1);
    expect([cart[0]!.sizeId, cart[0]!.mix, cart[0]!.qty, cart[0]!.price, cart[0]!.scent]).toEqual(["duo", ["oud", "amber"], 1, LM.price("duo"), "علبتان"]);
    expect(cart[0]!.size).toBe(LM.lineLabel(cart[0]!).size);
  });

  it("a duo → the trio (3 علب); merged into the same mix when the basket already has it", async () => {
    await tiersOn();
    setCart([{ sizeId: "duo", scentId: null, mix: ["oud", "amber"], qty: 2, price: 1 }, { sizeId: "trio", scentId: null, mix: ["oud", "amber", "lemon"], qty: 1, price: 1 }]);
    W().lmShip!(0);
    expect($("#faName").textContent).toBe("3 علب");
    $("#freeAdd").click();
    const cart = getCart();
    expect(cart.map((l) => l.sizeId + ":" + l.qty)).toEqual(["duo:1", "trio:2"]);
  });

  it("the set is never a step; with the offers off the row offers a plain box", async () => {
    await tiersOn();
    setCart([{ scentId: "bundle", sizeId: "bundle", qty: 1, price: 1 }]);
    W().lmShip!(0);
    expect($("#faName").textContent).toBe(nameOf("oud"));
    await boot();
    roomy();
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    expect($("#faName").textContent).toBe(nameOf("amber"));
  });
});

describe("the bar's rows are independent", () => {
  it("no threshold: progress hidden, suggestion shown, bar up; a full basket still gets one; free delivery silences it", () => {
    LM.c = { ...base, freeOver: 0 };
    setCart([LINE("oud", "small")]);
    W().lmShip!(0);
    expect([$("#freeProg").hidden, $("#freeAdd").hidden, $("#freeBar").hidden]).toEqual([true, false, false]);
    setCart([LINE("oud", "small"), LINE("amber", "small"), LINE("lemon", "small")]);
    W().lmShip!(0);
    expect($("#freeAdd").hidden).toBe(false);
    LM.c = { ...base, freeOver: 10 };
    W().lmShip!(0);
    expect($("#freeAdd").hidden).toBe(true);
    LM.c = base;
    setCart([LINE("oud", "small")]);
    W().lmShip!(0);
    expect($("#freeBar").hidden).toBe(false);
  });

  it("the card hides only when every row has nothing (no threshold, nothing to suggest, no add-ons)", () => {
    LM.c = { ...base, freeOver: 0, scents: LM.listFor("scents").map((s) => ({ ...s, soldOut: true })), prices: { ...base.prices, burner: { now: 0 }, samples: { now: 0 } } };
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    expect($("#freeBar").hidden).toBe(true);
  });
});

// from test-extras.js (the checkout shelf)
describe("the shop's add-ons and the sampler", () => {
  it("OM: the burner in the delivery card (its photograph), the sampler in its own block (the scents' dots)", () => {
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    const box = $("#freeExtras"), sbox = $("#sampleBox");
    expect(box.hidden).toBe(false);
    expect(box.querySelectorAll("[data-extra]").length).toBe(1);
    expect(box.innerHTML).toContain('<button type="button" class="free-add ex-row" data-extra="burner"><span class="ex-art"><picture>');
    expect(box.innerHTML).toContain('<img src="assets/img/burner-sm.jpg' + LM.v + '" alt="" loading="lazy" decoding="async">');
    expect(box.querySelector(".fa-txt b")!.textContent).toBe("مبخرة");
    expect(box.querySelector(".fa-cta")!.innerHTML).toBe("أضف " + LM.moneyHTML(6));
    expect(sbox.hidden).toBe(false);
    expect(sbox.querySelector("[data-extra]")!.getAttribute("data-extra")).toBe("samples");
    /* oud is in the basket: its dot greys */
    expect(sbox.innerHTML).toContain(norm(LM.extraArt(LM.extras().filter((x) => x.id === "samples")[0]!, { oud: true })));
  });

  it("a tap adds one line (scentId empty, the add-on's name, note, price); once in, it is no longer offered", () => {
    const added: unknown[] = [];
    const ev: unknown[][] = [];
    (window as unknown as Record<string, unknown>).LMPX = { addCart: (l: unknown) => added.push(l), purchase() {}, startCheckout() {} };
    (window as unknown as Record<string, unknown>).LMEV = { track: (...a: unknown[]) => ev.push(a) };
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    ($("#freeExtras").querySelector("[data-extra]") as HTMLElement).click();
    const l = getCart()[1]!;
    expect(l).toEqual({ scentId: "", scent: "مبخرة", sizeId: "burner", size: "مبخرة معدنية بقاعدة خشبية وملقط", price: 6, qty: 1 });
    expect(LM.itemId(l)).toBe("burner");
    expect(added).toEqual([{ ...l, qty: 1 }]);
    expect(ev).toEqual([["extra_add", "burner"]]);
    expect($("#freeExtras").hidden).toBe(true);
    expect(repaints).toBe(1);
    /* the sampler's block is wired to the same handler */
    ($("#sampleBox").querySelector("[data-extra]") as HTMLElement).click();
    expect(getCart().map((x) => x.sizeId)).toEqual(["large", "burner", "samples"]);
    expect($("#sampleBox").hidden).toBe(true);
  });

  it("an add-on that is not `once` stays and a second tap raises its quantity", () => {
    LM.c = { ...base, extras: LM.extras().map((x) => (x.id === "burner" ? { ...x, once: false } : x)) };
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    ($("#freeExtras").querySelector("[data-extra]") as HTMLElement).click();
    ($("#freeExtras").querySelector("[data-extra]") as HTMLElement).click();
    expect(getCart().filter((x) => x.sizeId === "burner").map((x) => x.qty)).toEqual([2]);
  });

  it("every scent tried: no sampler; it does not keep the delivery card open", () => {
    LM.c = { ...base, freeOver: 1, extras: LM.extras().filter((x) => x.id === "samples") };
    setCart([LINE("oud", "large"), LINE("amber", "large"), LINE("lemon", "large")]);
    W().lmShip!(0);
    expect($("#sampleBox").hidden).toBe(true);
    expect($("#sampleBox").innerHTML).toBe("");
    LM.c = { ...base, freeOver: 0, scents: LM.listFor("scents").map((s) => ({ ...s, soldOut: true })), extras: LM.extras().filter((x) => x.id === "samples") };
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    expect($("#sampleBox").hidden).toBe(false);
    expect($("#freeBar").hidden).toBe(true);
  });

  it("an add-on with neither photograph nor drawing gets a neutral tile; catalogue text is escaped", () => {
    LM.c = { ...base, extras: [{ id: "tongs", name: '<b>x</b>', note: '"q"', img: "", art: "", active: true, once: true }], prices: { ...base.prices, tongs: { now: 2, was: 0 } } };
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    const h = $("#freeExtras").innerHTML;
    expect(LM.extras().length).toBe(1);
    {
      expect(h).toContain('<span class="ex-art ex-art-none" aria-hidden="true"></span>');
      expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
      expect($("#freeExtras").querySelector("b b")).toBe(null);
    }
  });

  it("AE: the unpriced sampler is not offered", async () => {
    const c = catalogueFile();
    delete c.countries.find((x) => x.code === "AE")!.prices!.samples;
    await boot("/checkout.html?country=AE", { catalogue: c });
    setCart([LINE("oud", "large")]);
    W().lmShip!(0);
    expect($("#sampleBox").hidden).toBe(true);
    expect($("#freeExtras").querySelector("[data-extra]")!.getAttribute("data-extra")).toBe("burner");
  });
});
