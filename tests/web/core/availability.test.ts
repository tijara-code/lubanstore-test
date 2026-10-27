import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { catalogueFile, read, ready, REPO } from "./_boot";
import { isRefusal, priceOrder } from "../../../src/shared/pricing/price";
import { tiersEndsAt } from "../../../src/shared/pricing/offers";
import type { Catalogue, CartLine, Country, LmApi } from "../../../src/web/core/types";

afterEach(() => vi.unstubAllGlobals());

let LM: LmApi;
beforeEach(async () => {
  LM = (await ready({ url: "/?country=OM" })).LM;
});

const at = (code: string) => {
  LM.c = LM.cfg.countries.find((c) => c.code === code)!;
};
/** the shipped catalogue with its large-box offers started an hour ago */
const live = (cfg: Catalogue) => {
  const t = cfg.tiers!;
  t.active = true;
  t.renew = "auto";
  t.anchor = t.startsAt = new Date(Date.now() - 3600e3).toISOString();
  return cfg;
};

// from test-cart-availability.js: a basket that outlived a country change
describe("a basket line, in this market", () => {
  const sizes = (out: boolean) => [
    { id: "large", name: "كبير", weight: "300 جم", soldOut: false },
    { id: "small", name: "صغير", weight: "100 جم", soldOut: out },
  ];
  const scents = (out: boolean) => [
    { id: "oud", name: "عود", notes: "", accent: "#6A5CA8", art: "lavender", soldOut: false },
    { id: "amber", name: "عنبر", notes: "", accent: "#9C464C", art: "amber", soldOut: out },
  ];
  const OFFER = { id: "bundle", active: true, hours: 72, renew: "auto", sizeId: "small", countries: [] };
  const OM = { code: "OM", cur: "OMR", dec: 3, name: "عمان", dial: "968", prices: { large: { now: 25 }, small: { now: 12 }, bundle: { now: 29 } }, sizes: sizes(false), scents: scents(false) } as Country;
  const KW = { code: "KW", cur: "KWD", dec: 3, name: "الكويت", dial: "965", prices: { large: { now: 20 }, small: { now: 10 }, bundle: { now: 24 } }, sizes: sizes(true), scents: scents(true) } as Country;
  const basket: CartLine[] = [
    { scentId: "oud", scent: "عود", sizeId: "small", size: "صغير", price: 12, qty: 2 },
    { scentId: "oud", scent: "عود", sizeId: "large", size: "كبير", price: 25, qty: 1 },
  ];

  it("Oman sells the whole basket; Kuwait, out of the small box, blocks exactly that line", () => {
    LM.cfg = { countries: [OM, KW], sizes: sizes(false), scents: scents(false), offer: OFFER } as Catalogue;
    LM.c = OM;
    expect(LM.blockedLines(basket).length).toBe(0);
    LM.c = KW;
    expect(LM.blockedLines(basket).length).toBe(1);
    expect(LM.blockedLines(basket)[0]!.sizeId).toBe("small");
    expect(LM.lineOffered(basket[1])).toBe(true);
    // a scent out here blocks every size of it; a size never carried reads the same
    expect(LM.lineOffered({ scentId: "amber", sizeId: "large", qty: 1 })).toBe(false);
    expect(LM.lineOffered({ scentId: "oud", sizeId: "travel", qty: 1 })).toBe(false);
    // the set needs its small box here
    expect(LM.lineOffered({ sizeId: "bundle", qty: 1 })).toBe(false);
    LM.c = OM;
    expect(LM.lineOffered({ sizeId: "bundle", qty: 1 })).toBe(true);
    expect(LM.lineOffered(null)).toBe(true);
  });

  it('the string "false" is not sold out; a missing entry is', () => {
    LM.cfg = { countries: [OM], sizes: sizes(false), scents: scents(false), offer: OFFER } as Catalogue;
    LM.c = { ...OM, sizes: [{ id: "large", name: "كبير", soldOut: "false" as never }] };
    expect(LM.lineOffered({ scentId: "oud", sizeId: "large", qty: 1 })).toBe(true);
    LM.c = { ...OM, sizes: [{ id: "large", name: "كبير", soldOut: "true" }] };
    expect(LM.lineOffered({ scentId: "oud", sizeId: "large", qty: 1 })).toBe(false);
  });

  it("hidden sizes and unpriced sizes are off; an extra is judged on its own entry", () => {
    LM.cfg = catalogueFile();
    at("AE");
    LM.c.sizes = LM.cfg.sizes.map((s) => (s.id === "large" ? { ...s, hidden: true } : s));
    expect(LM.lineOffered({ scentId: "oud", sizeId: "large", qty: 1 })).toBe(false);
    expect(LM.sizes().map((s) => s.id)).toEqual(["small"]);
    LM.cfg = catalogueFile();
    at("AE");
    delete LM.c.prices!.small;
    expect(LM.sizes().map((s) => s.id)).toEqual(["large"]);
    expect(LM.lineOffered({ scentId: "oud", sizeId: "small", qty: 1 })).toBe(false);
    expect(LM.lineOffered({ sizeId: "burner", qty: 1 })).toBe(true);
    expect(LM.extras().map((x) => x.id)).toEqual(["burner", "samples"]);
    LM.cfg.extras![0]!.active = false;
    expect(LM.lineOffered({ sizeId: "burner", qty: 1 })).toBe(false);
    expect(LM.extras().map((x) => x.id)).toEqual(["samples"]);
    delete LM.c.prices!.samples;
    expect(LM.extras().map((x) => x.id)).toEqual([]);
  });

  it("the set's size sold only inside the set (offer.only): a single box of it is off, and says why", () => {
    LM.cfg = catalogueFile();
    at("OM");
    LM.cfg.offer!.only = true;
    const one = { scentId: "oud", sizeId: "small", qty: 1 };
    expect(LM.bundleOnlySize()).toBe("small");
    expect(LM.lineOffered(one)).toBe(false);
    expect(LM.offWords(one)).toBe("يُباع ضمن الباقة فقط");
    LM.cfg.offer!.only = false;
    expect(LM.lineOffered(one)).toBe(true);
    expect(LM.offWords({ scentId: "oud", sizeId: "travel", qty: 1 })).toBe("غير متوفر في بلدك");
  });
});

// from test-availability.js (the storefront side): per-market stock, from-price, the set
describe("per-market stock and the headline figure", () => {
  const SIZES = () => [
    { id: "large", name: "كبير", weight: "300 جم", tag: "", soldOut: false },
    { id: "small", name: "صغير", weight: "100 جم", tag: "", soldOut: false },
  ];
  const SCENTS = () => [
    { id: "oud", name: "عود", notes: "", accent: "#6A5CA8", art: "lavender", soldOut: false },
    { id: "amber", name: "عنبر", notes: "", accent: "#9C464C", art: "amber", soldOut: false },
  ];
  const country = (code: string, mut?: (c: Country) => void) => {
    const c = { code, cur: "AED", dec: 0, dial: "971", name: code, prices: { large: { now: 250, was: 320 }, small: { now: 120, was: 160 } }, sizes: SIZES(), scents: SCENTS() } as Country;
    if (mut) mut(c);
    return c;
  };

  it("KW (small and amber out): from-price skips the closed box, the set is withdrawn; the UAE has everything", () => {
    const KW = country("KW", (c) => {
      c.sizes!.find((s) => s.id === "small")!.soldOut = true;
      c.scents!.find((s) => s.id === "amber")!.soldOut = true;
    });
    const AE = country("AE");
    LM.cfg = { countries: [KW, AE], sizes: SIZES(), scents: SCENTS() } as Catalogue;
    LM.c = KW;
    expect(LM.sizes().map((s) => s.id)).toEqual(["large", "small"]);
    expect(LM.fromPrice()).toBe(250);
    expect(LM.bundleSellable()).toBe(false);
    LM.c = AE;
    expect(LM.fromPrice()).toBe(120);
    expect(LM.bundleSellable()).toBe(true);
  });

  it("a country without its own lists falls back to the shared ones", () => {
    LM.cfg = catalogueFile();
    at("OM");
    expect(LM.listFor("sizes")).toBe(LM.cfg.sizes);
    LM.c.scents = [{ id: "oud", name: "x" }];
    expect(LM.listFor("scents")).toBe(LM.c.scents);
    LM.c.scents = [];
    expect(LM.listFor("scents")).toBe(LM.cfg.scents);
  });
});

// from test-gallery.js (the core's part)
describe("packshots and the size order", () => {
  it("each size's packshot and every add-on photograph ship in all six variants", () => {
    const img = path.join(REPO, "site/public/assets/img");
    const named = new Set(["small", "large", "bundle"].map((s) => LM.img(s)).concat((LM.cfg.extras || []).map((x) => LM.extraImg(x)).filter(Boolean)));
    const missing: string[] = [];
    for (const n of named) for (const v of ["", "-sm"]) for (const e of ["avif", "webp", "jpg"]) if (!existsSync(path.join(img, n + v + "." + e))) missing.push(n + v + "." + e);
    expect(missing).toEqual([]);
    // no orphans: every file is a packshot, an add-on's photo, a gallery frame (main.js's IMAGES) or named by the page
    const html = read("site/index.html");
    const gallery = ["white-box-open", "resin-macro", "box-front"];
    const wanted = new Set<string>();
    for (const n of [...named, ...gallery]) for (const v of ["", "-sm"]) for (const e of ["avif", "webp", "jpg"]) wanted.add(n + v + "." + e);
    expect(readdirSync(img).filter((f) => !wanted.has(f) && !html.includes(f.replace(/\.(avif|webp|jpg)$/, "")))).toEqual([]);
    expect(LM.img("large")).toBe("white-box-open");
    expect(LM.img("small")).toBe("red-box-open");
    expect(LM.img("nonsense")).toBe("red-box-open");
  });

  it("an add-on's photograph: the catalogue's name if it is a safe one, else what the repo ships, else none", () => {
    expect(LM.extraImg({ id: "burner", name: "", img: "" })).toBe("burner");
    expect(LM.extraImg({ id: "samples", name: "", img: "" })).toBe("");
    expect(LM.extraImg({ id: "x", name: "", img: "new-photo" })).toBe("new-photo");
    expect(LM.extraImg({ id: "burner", name: "", img: "../../etc/passwd" })).toBe("burner");
    expect(LM.extraImg(null)).toBe("");
  });

  it("rows run biggest first; from-price is the cheapest box the page sells singly", () => {
    at("AE");
    const ids = LM.sizes().map((s) => s.id);
    expect(ids[0]).toBe("large");
    const prices = LM.sizes().map((s) => LM.price(s.id));
    expect(prices.every((p, i) => i === 0 || prices[i - 1]! >= p)).toBe(true);
    // v335: with the set in the catalogue (on or off) its small box is never sold singly
    const single = LM.sizes().filter((s) => !LM.offerCfg("bundle") || s.id !== LM.bundleSize()).map((s) => LM.price(s.id));
    expect(LM.fromPrice()).toBe(Math.min(...single));
    const saved = LM.cfg.offer;
    delete LM.cfg.offer;
    expect(LM.fromPrice()).toBe(Math.min(...prices));
    expect(LM.fromPrice()).not.toBe(LM.price(ids[0]!));
    LM.cfg.offer = saved;
  });

  it("images carry the build's version: LM.v, and every image URL in the source pages", async () => {
    const r = await ready({ assetV: "abc123" });
    expect(r.LM.v).toBe("?v=abc123");
    expect((await ready({})).LM.v).toBe("");
    const html = read("site/index.html");
    const unversioned = [...html.matchAll(/(?:href|src|srcset|data-src|data-poster)="((?:\.\.\/)?assets\/(?:img|media)\/[^"]+)"/g)].map((m) => m[1]!).filter((u) => !u.endsWith("?v=__ASSET_V__"));
    expect(unversioned).toEqual([]);
    // the hero preload is the <source>'s URL character for character (else it is fetched twice)
    const pre = (/rel="preload" as="image" href="([^"]+)"/.exec(html) || [])[1];
    expect(html.includes('<source srcset="' + pre + '" type="image/avif">')).toBe(true);
    expect(pre).toBe("assets/img/white-box-open.avif?v=__ASSET_V__");
    expect(html).toMatch(/og:image" content="https:\/\/lubanmusk\.com\/assets\/img\/white-box-open\.jpg"/);
  });

  it("LM.root: where assets/ is from the page", async () => {
    expect(LM.root).toBe("");
    expect((await ready({ lang: "en", english: true })).LM.root).toBe("../");
  });
});

// from test-v303.js / test-v310.js / test-v336-product.js (the core's part)
describe("offers in the basket", () => {
  beforeEach(() => {
    LM.cfg = live(catalogueFile());
  });
  const trio: CartLine = { sizeId: "trio", scentId: null, mix: ["oud", "oud", "amber"], qty: 1 };

  it("the page's item id is the till's", () => {
    at("AE");
    const line = { sizeId: "trio", mix: ["amber", "oud", "oud"], qty: 1 };
    expect(LM.itemId(line)).toBe("trio:oud.oud.amber");
    expect(LM.itemId(line)).toBe(priceOrder(LM.cfg, { countryCode: "AE", items: [{ itemId: "trio:amber.oud.oud", qty: 1 }] }, LM.now()).items[0]!.itemId);
    expect(LM.itemId({ sizeId: "bundle", scentId: "bundle", qty: 1 })).toBe("bundle");
    expect(LM.itemId({ sizeId: "large", scentId: "oud", qty: 1 })).toBe("oud-large");
    expect(LM.itemId({ sizeId: "burner", qty: 1 })).toBe("burner");
    expect(LM.itemId({ sizeId: "x", scentId: "bundle", qty: 1 })).toBe("bundle");
    expect(LM.itemId(null)).toBe("");
  });

  it("on in the UAE, Oman and Qatar; not in Saudi Arabia or Kuwait (unpriced there)", () => {
    expect(["AE", "OM", "QA", "SA", "KW"].map((c) => (at(c), c + ":" + (LM.tierOn("trio") ? 1 : 0))).join(" ")).toBe("AE:1 OM:1 QA:1 SA:0 KW:0");
    at("AE");
    expect(LM.tierWas("duo")).toBe(2 * LM.price("large"));
    expect(LM.tierN("trio") + LM.tierN("duo") + LM.tierN("large")).toBe(6);
  });

  it("a trio line: offered, named, pictured, drawn one shape per scent", () => {
    at("AE");
    expect([LM.lineOffered(trio), LM.lineLabel(trio).scent, LM.lineLabel(trio).size, LM.imgFor(trio)].join(" | ")).toBe("true | 3 علب | عود الافندر ×2 · عنبر توت | white-box-open");
    expect((LM.lineMark(trio).match(/class="scent-art"/g) || []).length).toBe(2);
    expect((LM.lineMark({ sizeId: "large", scentId: "amber", qty: 1 }).match(/class="scent-art"/g) || []).length).toBe(1);
    expect(LM.lineOffered({ sizeId: "trio", mix: ["oud", "amber"], qty: 1 })).toBe(false);
    at("SA");
    expect(LM.lineOffered(trio)).toBe(false);
  });

  it("after the window the page drops it with the till; not started: nothing; a market unticked: off", () => {
    at("AE");
    const keep = LM.now;
    LM.now = () => Date.parse("2099-10-08T12:00:00+04:00");
    LM.cfg.tiers!.renew = "once";
    expect(LM.tierOn("trio") + " " + LM.lineOffered(trio)).toBe("false false");
    expect(LM.offerEnded(trio)).toBe(true);
    expect(LM.offWords(trio)).toBe("انتهى العرض");
    LM.now = keep;
    expect(LM.tierEndsAt()).toBe(tiersEndsAt(LM.cfg, LM.now()));
    delete LM.cfg.tiers!.anchor;
    expect(LM.tierUnstarted()).toBe(true);
    expect(LM.tierOn("trio")).toBe(false);
    LM.cfg = live(catalogueFile());
    at("AE");
    LM.cfg.tiers!.countries = ["OM"];
    expect(LM.tierOn("duo")).toBe(false);
  });

  it("the set in the basket: named from the catalogue, pictured as its small box, one shape per scent (v310)", () => {
    at("OM");
    const set: CartLine = { sizeId: "bundle", scentId: "bundle", qty: 1 };
    expect(LM.lineLabel(set)).toEqual({ scent: "باقة الروائح الثلاث", size: "3 عبوات 100 جم، واحدة من كل رائحة" });
    expect(LM.imgFor(set)).toBe("red-box-open");
    expect((LM.lineMark(set).match(/class="scent-art"/g) || []).length).toBe(3);
    // (v336) the retired large set has no config left: named as the set, never an empty line
    expect(LM.lineLabel({ sizeId: "bundle2", qty: 1 }).scent).toBe("باقة الروائح الثلاث");
    expect(LM.lineOffered({ sizeId: "bundle2", qty: 1 })).toBe(false);
    expect(LM.offWords({ sizeId: "bundle2", qty: 1 })).toBe("انتهى العرض");
  });

  it("an add-on line: its own words, its photograph or drawing, not counted toward free delivery when it says so", () => {
    at("OM");
    const burner: CartLine = { sizeId: "burner", qty: 1 };
    const samples: CartLine = { sizeId: "samples", qty: 2 };
    expect(LM.lineLabel(burner)).toEqual({ scent: "مبخرة", size: "مبخرة معدنية بقاعدة خشبية وملقط" });
    expect(LM.extraOf(burner)!.id).toBe("burner");
    expect(LM.extraOf({ sizeId: "large", scentId: "oud", qty: 1 })).toBe(null);
    expect(LM.imgFor(burner)).toBe("burner");
    expect(LM.imgFor(samples)).toBe("");
    expect(LM.countsFree(samples)).toBe(false);
    expect(LM.countsFree(burner)).toBe(true);
    const cart: CartLine[] = [{ sizeId: "large", scentId: "oud", qty: 2 }, burner, samples];
    expect(LM.freeSub(cart)).toBe(2 * 25 + 6);
    expect(LM.freeSub(cart, () => 1)).toBe(3);
    // the saved words are the fallback for a line the catalogue no longer knows
    expect(LM.lineLabel({ sizeId: "gone", scentId: "nope", scent: "قديم", size: "س", qty: 1 })).toEqual({ scent: "قديم", size: "س" });
  });
});

// the page and the till agree on what can be sold (the till refuses what lineOffered blocks)
describe("lineOffered agrees with the till", () => {
  it("over many market and stock variations", () => {
    const base = live(catalogueFile());
    const lines: CartLine[] = [];
    for (const sz of ["large", "small", "travel"]) for (const sc of ["oud", "lemon", "amber"]) lines.push({ sizeId: sz, scentId: sc, qty: 1 });
    lines.push({ sizeId: "bundle", scentId: "bundle", qty: 1 }, { sizeId: "burner", qty: 1 }, { sizeId: "samples", qty: 1 });
    for (const m of [["oud", "oud"], ["oud", "amber", "lemon"], ["amber", "amber", "amber"]]) lines.push({ sizeId: m.length === 2 ? "duo" : "trio", scentId: null, mix: m, qty: 1 });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let compared = 0;
    for (let k = 0; k < 150; k++) {
      const cfg: Catalogue = JSON.parse(JSON.stringify(base));
      for (const s of cfg.scents) {
        if (rnd() < 0.2) s.soldOut = true;
        if (rnd() < 0.2) s.soldOutSizes = [rnd() < 0.5 ? "small" : "large"];
        if (rnd() < 0.1) s.active = false;
      }
      for (const z of cfg.sizes) if (rnd() < 0.15) z.soldOut = true;
      if (rnd() < 0.2) cfg.offer!.active = false;
      if (rnd() < 0.2) cfg.offer!.countries = ["AE"];
      for (const ex of cfg.extras || []) if (rnd() < 0.15) ex.active = false;
      LM.cfg = cfg;
      for (const c of cfg.countries) {
        LM.c = c;
        for (const line of lines) {
          let till = true;
          try {
            priceOrder(cfg, { countryCode: c.code, items: [{ itemId: LM.itemId(line), qty: 1 }], pay: "card" }, LM.now());
          } catch (e) {
            if (!isRefusal(e)) throw e;
            till = false;
          }
          expect([c.code, LM.itemId(line), LM.lineOffered(line)]).toEqual([c.code, LM.itemId(line), till]);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(10000);
  });
});
