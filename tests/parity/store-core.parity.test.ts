// @vitest-environment happy-dom
/**
 * The storefront core against the ORIGINAL assets/js/store.js: the old file runs in a
 * sandbox, the new core in happy-dom, and both are handed the same catalogue, market, clock
 * and (for the caps) the same shelf; every member that answers a question about them must
 * give the same answer. (The original's own suites lifted store.js functions and compared
 * them with price.js; the shared pricing modules made that a single copy, so this is what
 * is left to prove: the browser api on top of them behaves as store.js did.)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import bundled from "../../data/catalogue.json";
import type { Catalogue, CartLine, LmApi } from "../../src/web/core/types";
import { REF_DIR } from "./ref";

const d = REF_DIR ? describe : describe.skip;

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** the original store.js, booted in a sandbox with a fetch that never answers */
function oldStore(): any {
  const store: Record<string, string> = {};
  const storage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear() {},
  };
  const el: any = () => ({ getAttribute: () => null });
  const ctx: any = {
    document: { documentElement: { lang: "ar" }, querySelector: () => null, readyState: "complete", addEventListener() {}, hidden: false },
    localStorage: storage, sessionStorage: storage, location: { search: "", pathname: "/", href: "https://lubanmusk.com/" },
    fetch: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener() {}, dispatchEvent() { return true }, CustomEvent: class { constructor(public type: string) {} },
    AbortController, Promise, Date, Intl, JSON, Math, Object, Array, String, Number, RegExp, isFinite, parseInt, el,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(path.join(REF_DIR!, "assets/js/store.js"), "utf8"), ctx);
  return ctx.LM;
}

function variant(rnd: () => number, now: number): Catalogue {
  const c: Catalogue = JSON.parse(JSON.stringify(bundled));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const iso = (dh: number) => new Date(now + dh * 3600e3).toISOString();
  if (rnd() < 0.3) c.offer!.only = rnd() < 0.5;
  if (rnd() < 0.3) c.offer!.active = rnd() < 0.5;
  if (rnd() < 0.3) c.offer!.countries = [pick(["OM", "AE", "SA", "ae"])];
  if (rnd() < 0.3) c.offer!.renew = pick(["once", "auto"]);
  if (rnd() < 0.3) c.offer!.anchor = iso(-rnd() * 200);
  if (rnd() < 0.2) c.offer!.startsAt = iso((rnd() - 0.5) * 48);
  if (rnd() < 0.2) c.offer!.endsAt = iso((rnd() - 0.5) * 300);
  if (rnd() < 0.1) c.offer!.hours = 0;
  if (rnd() < 0.1) c.offer!.repeat = pick(["monthly", "weekly", "72h"]);
  if (rnd() < 0.1) c.offer!.sizeId = pick(["large", "small", "travel"]);
  if (rnd() < 0.35) {
    c.offer!.freeShip = true;
    c.offer!.freeShipHours = pick([0, 24, 72]);
    if (rnd() < 0.7) c.offer!.freeShipAnchor = iso(-rnd() * 100);
    c.offer!.freeShipRenew = pick(["once", "auto"]);
    if (rnd() < 0.4) c.offer!.freeShipIn = [pick(["OM", "AE"])];
  }
  if (rnd() < 0.5) c.tiers!.anchor = iso(-rnd() * 100);
  if (rnd() < 0.2) c.tiers!.active = false;
  if (rnd() < 0.2) c.tiers!.countries = [pick(["OM", "AE"])];
  if (rnd() < 0.2) c.tiers!.clock = false;
  if (rnd() < 0.1) c.tiers!.startsAt = iso((rnd() - 0.5) * 10);
  if (rnd() < 0.4) c.freeShip = { active: rnd() > 0.1, countries: { [pick(["OM", "AE", "KW"])]: { on: rnd() > 0.1, over: pick([0, 10, 200, "", -1, "5"]), days: pick([0, 3, "x", 1]), from: rnd() < 0.8 ? iso(-rnd() * 150) : "" } } };
  for (const country of c.countries) {
    if (rnd() < 0.15) country.codOn = false;
    if (rnd() < 0.15) country.freeOver = 0;
    if (rnd() < 0.1) delete country.toOmr;
    if (rnd() < 0.1) delete country.prices!.bundle;
    if (rnd() < 0.2) country.sizes = JSON.parse(JSON.stringify(c.sizes)).map((s: any) => ({ ...s, soldOut: rnd() < 0.2 ? pick([true, "true", "false"]) : false, hidden: rnd() < 0.15 ? "true" : false }));
    if (rnd() < 0.2) country.scents = JSON.parse(JSON.stringify(c.scents)).map((s: any) => ({ ...s, active: rnd() > 0.15, soldOut: rnd() < 0.1 ? "true" : false, soldOutSizes: rnd() < 0.3 ? [pick(["small", "large"])] : [] }));
  }
  if (rnd() < 0.2) c.extras![0]!.active = false;
  if (rnd() < 0.1) c.extras![1]!.img = pick(["photo-1", "../x", ""]);
  return c;
}

const LINES: CartLine[] = [
  ...["large", "small", "travel"].flatMap((sz) => ["oud", "lemon", "amber", "nope"].map((sc) => ({ sizeId: sz, scentId: sc, qty: 2 }))),
  { sizeId: "bundle", scentId: "bundle", qty: 1 }, { sizeId: "bundle2", qty: 1 }, { sizeId: "burner", qty: 1 }, { sizeId: "samples", qty: 3 },
  { sizeId: "duo", scentId: null, mix: ["oud", "amber"], qty: 1 }, { sizeId: "trio", scentId: null, mix: ["amber", "oud", "oud"], qty: 2 },
  { sizeId: "trio", scentId: null, mix: ["oud", "amber"], qty: 1 }, { sizeId: "duo", scentId: null, mix: ["lemon", "nope"], qty: 1 },
  { sizeId: "gone", scent: "قديم", size: "س", qty: 1 }, { sizeId: "x", scentId: "bundle", qty: 1 },
];

/** every question both api's answer the same way, as one comparable record */
function answers(LM: any, rnd: () => number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const q = (k: string, f: () => unknown) => {
    try {
      const v = f();
      out[k] = v instanceof Date ? "D" + v.getTime() : v === undefined ? "undefined" : Number.isNaN(v) ? "NaN" : JSON.parse(JSON.stringify(v));
    } catch (e) {
      out[k] = "threw";
    }
  };
  const n = Math.round(rnd() * 400 * 1000) / 1000;
  q("price", () => ["large", "small", "bundle", "duo", "trio", "burner", "x"].map((s) => LM.price(s)));
  q("was", () => ["large", "small", "bundle", "duo", "trio", "x"].map((s) => LM.was(s)));
  q("money", () => [LM.money(n), LM.num(n), LM.moneyHTML(n), LM.omr(n), LM.omrNum(n), LM.omrRate(), LM.moneyMark()]);
  q("delivery", () => [LM.ship(), LM.cod(), LM.codOn(), LM.freeDeal(), LM.freeOver(), LM.setShipsFree(), LM.setFreeEndsAt()]);
  q("offer", () => ["bundle", "bundle2", undefined].map((id) => [LM.offerCfg(id), LM.offerHere(id), !!LM.offer(id), LM.offerLeftMs(id), LM.bundleSizeId(id), LM.bundleSellable(id), LM.bundleScents(id).map((s: any) => s.id)]));
  q("offerWindow", () => [LM.offerCycleMs(LM.cfg.offer), LM.offerAnchor(LM.cfg.offer), LM.offerEndsAt(LM.cfg.offer) && LM.offerEndsAt(LM.cfg.offer).getTime(), LM.offerEndsAt(LM.cfg.tiers) && LM.offerEndsAt(LM.cfg.tiers).getTime()]);
  q("set", () => [LM.bundleSize(), LM.bundleOnlySize(), LM.bundleOpen()]);
  q("tiers", () => [LM.tierCfg(), LM.tierSize(), LM.tierClockShown(), LM.tierUnstarted(), LM.tierEndsAt(), LM.tierLive(), ["duo", "trio", "large"].map((t) => [LM.isTier(t), LM.tierN(t), LM.tierOn(t), LM.tierWas(t)])]);
  q("tierIds", () => [LM.tierId("trio", ["amber", "oud", "lemon"]), LM.tierCounts(["amber", "oud", "amber"]), LM.tierId("duo", null)]);
  q("lists", () => [LM.countries().map((c: any) => c.code), LM.sizes().map((s: any) => s.id), LM.scents().map((s: any) => s.id), LM.extras().map((s: any) => s.id), LM.fromPrice(), LM.listFor("sizes").length]);
  q("pictures", () => ["small", "large", "bundle", "bundle2", "x"].map((s) => LM.img(s)).concat(["oud", "lemon", "amber", "x"].map((s) => LM.scentMark(s)), (LM.cfg.extras || []).map((x: any) => LM.extraImg(x) + LM.extraArt(x, { oud: true })), [LM.scentArt("lemon"), LM.scentArt("??")]));
  const cart = LINES.filter(() => rnd() < 0.3);
  q("cart", () => [LM.blockedLines(cart).map((l: any) => l.sizeId), LM.setFree(cart), LM.freeSub(cart), LM.basketBoxes(cart)]);
  for (let i = 0; i < LINES.length; i++) {
    const l = LINES[i]!;
    q("line" + i, () => [LM.lineOffered(l), LM.itemId(l), LM.lineLabel(l), LM.extraOf(l), LM.countsFree(l), LM.offerEnded(l), LM.offWords(l), LM.imgFor(l), LM.lineMark(l), LM.lineBoxes(l), LM.lineRoom(l, cart), LM.capRoom(String(l.scentId), l.sizeId, cart)]);
  }
  return out;
}

d("the storefront core answers as store.js did", () => {
  let OLD: any;
  let NEW: LmApi;
  beforeAll(async () => {
    OLD = oldStore();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    document.documentElement.lang = "ar";
    NEW = (await import("../../src/web/core")).LM;
  });
  afterAll(() => vi.unstubAllGlobals());

  it("over 600 random catalogues, markets, clocks and shelves", () => {
    const rnd = prng(2026);
    const base = Date.parse("2026-10-20T10:00:00Z");
    let compared = 0;
    for (let k = 0; k < 600; k++) {
      const now = base + Math.floor((rnd() - 0.5) * 20 * 86400e3);
      const cfg = variant(rnd, now);
      const code = cfg.countries[Math.floor(rnd() * cfg.countries.length)]!.code;
      const caps: Record<string, number> = {};
      if (rnd() < 0.5) for (const s of ["oud", "lemon", "amber"]) for (const z of ["small", "large"]) if (rnd() < 0.3) caps[s + "-" + z] = Math.floor(rnd() * 5);
      const cap = (sc: string, sz: string) => (caps[sc + "-" + sz] == null ? null : caps[sc + "-" + sz]!);
      const seed = Math.floor(rnd() * 1e9);
      const run = (LM: any) => {
        LM.cfg = JSON.parse(JSON.stringify(cfg));
        LM.c = LM.cfg.countries.find((c: any) => c.code === code);
        LM.now = () => now;
        LM.stockCap = cap;
        return answers(LM, prng(seed));
      };
      const a = run(OLD);
      const b = run(NEW);
      for (const key of Object.keys(a)) {
        expect(b[key], JSON.stringify({ k, key, code, now: new Date(now).toISOString() })).toEqual(a[key]);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(600 * 20);
  });

  it("the English words are store.js's dictionary, entry for entry", () => {
    const ctx: any = {};
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(readFileSync(path.join(REF_DIR!, "assets/js/i18n-en.js"), "utf8"), ctx);
    return import("../../src/web/core/i18n-en").then(({ LM_EN }) => {
      expect(Object.keys(LM_EN).sort()).toEqual(Object.keys(ctx.LM_EN).sort());
      for (const k of Object.keys(ctx.LM_EN)) {
        const o = ctx.LM_EN[k];
        const n = LM_EN[k]!;
        if (typeof o === "function") {
          for (const v of [{ n: 1, count: 1, h: 1 }, { n: 5, count: 5, h: 3, left: 1 }]) expect((n as (x: object) => string)(v)).toBe(o(v));
        } else expect(n).toBe(o);
      }
    });
  });

  it("the city lists are cities.js's", () => {
    const ctx: any = {};
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(readFileSync(path.join(REF_DIR!, "assets/js/cities.js"), "utf8"), ctx);
    return import("../../src/web/core/cities").then(({ LM_CITIES }) => {
      expect(JSON.parse(JSON.stringify(LM_CITIES))).toEqual(JSON.parse(JSON.stringify(ctx.LM_CITIES)));
    });
  });
});
