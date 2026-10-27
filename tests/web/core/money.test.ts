import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogueFile, market, ready } from "./_boot";
import { priceOrder } from "../../../src/shared/pricing/price";

afterEach(() => vi.unstubAllGlobals());

// from test-dirham.js: LM.moneyHTML draws each currency's mark
describe("the currency marks", () => {
  it("AED, OMR, SAR each have their own mark; others keep their (escaped) code", async () => {
    const { LM } = await ready({ url: "/?country=AE" });
    expect(LM.moneyHTML(250)).toMatch(/^250 /);
    expect(LM.moneyHTML(250)).toMatch(/class="dh"/);
    expect(LM.moneyHTML(1)).toMatch(/aria-label="درهم"/);
    expect(LM.moneyHTML(250)).not.toMatch(/class="omr"|class="sar"/);
    const base = LM.c;
    LM.c = { ...base, cur: "OMR", dec: 3 };
    expect(LM.moneyHTML(25)).toMatch(/^25 /);
    expect(LM.moneyHTML(25)).toMatch(/class="omr"/);
    expect(LM.moneyHTML(25)).toMatch(/aria-label="ريال عماني"/);
    expect(LM.moneyHTML(25)).not.toMatch(/class="dh"/);
    LM.c = { ...base, cur: "SAR", dec: 0 };
    expect(LM.moneyHTML(299)).toMatch(/^299 /);
    expect(LM.moneyHTML(299)).toMatch(/class="sar"/);
    expect(LM.moneyHTML(299)).toMatch(/aria-label="ريال سعودي"/);
    expect(LM.moneyHTML(299)).not.toMatch(/class="omr"/);
    LM.c = { ...base, cur: "QAR", dec: 0 };
    expect(LM.moneyHTML(25)).toBe("25 QAR");
    LM.c = { ...base, cur: "<img src=x onerror=alert(1)>" };
    const hostile = LM.moneyHTML(1);
    expect(hostile).toMatch(/&lt;img/);
    expect(hostile).not.toMatch(/<img/);
  });

  it("the marks' names are English on the English store", async () => {
    const { LM } = await ready({ url: "/?country=AE", lang: "en", english: true });
    expect(LM.moneyHTML(250)).toBe('250 <span class="dh" role="img" aria-label="dirham"></span>');
  });
});

describe("figures", () => {
  it("money/num: the market's decimals, trailing zeros dropped", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    expect(LM.money(29.9)).toBe("29.9 OMR");
    expect(LM.money(25)).toBe("25 OMR");
    expect(LM.num(12.3456)).toBe("12.346");
    expect(LM.num(0.1 + 0.2)).toBe("0.3");
    LM.setCountry("AE");
    expect(LM.money(249.6)).toBe("250 AED");
    expect(LM.num(120.4)).toBe("120");
  });

  it("price and was come from this market's own prices; an offer's was is its boxes at the single price", async () => {
    const { LM } = await ready({ url: "/?country=AE" });
    expect(LM.price("large")).toBe(250);
    expect(LM.was("large")).toBe(320);
    expect(LM.price("nothing")).toBe(0);
    expect(LM.was("trio")).toBe(750);
    expect(LM.was("duo")).toBe(500);
  });
});

// from test-fx.js: every card is charged in OMR; the rates are the pegs
describe("the OMR every card is charged in", () => {
  const OMR_PER_USD = 0.3845;
  const PEG: Record<string, number> = { AED: 3.6725, SAR: 3.75, QAR: 3.64, BHD: 0.376, OMR: 0.3845 };

  it("the bundled catalogue's rates sit on their pegs (KWD in its band, OMR exactly 1, no placeholder)", () => {
    // (the original also held store.js's inline fallback table to this file; the fallback IS this file now)
    const countries = catalogueFile().countries;
    for (const c of countries) {
      const peg = PEG[c.cur];
      if (peg) expect(Math.abs(Number(c.toOmr) - OMR_PER_USD / peg)).toBeLessThanOrEqual(0.00005);
    }
    const kwd = countries.find((c) => c.cur === "KWD")!;
    expect(kwd.toOmr).toBeGreaterThanOrEqual(1.22);
    expect(kwd.toOmr).toBeLessThanOrEqual(1.28);
    expect(countries.find((c) => c.code === "OM")!.toOmr).toBe(1);
    expect(countries.filter((c) => c.cur !== "OMR" && (c.toOmr === 0.1 || c.toOmr === 1))).toEqual([]);
  });

  it("the page's OMR figure is the till's (omrRate, omrNum, omr)", async () => {
    const { LM } = await ready({ url: "/?country=AE" });
    const q = priceOrder(LM.cfg, { countryCode: "AE", pay: "card", items: [{ itemId: "oud-large", qty: 1 }] }, LM.now());
    expect(LM.omrRate()).toBe(market(LM, "AE").toOmr);
    expect(LM.omrRate()).toBe(q.omrRate);
    expect(LM.omrNum(q.total)).toBe(q.omr);
    expect(q.omr).toBeGreaterThan(q.total * 0.1);
    expect(LM.omr(250)).toBe("26.175 OMR");
    LM.setCountry("OM");
    const o = priceOrder(LM.cfg, { countryCode: "OM", pay: "card", items: [{ itemId: "oud-large", qty: 1 }] }, LM.now());
    expect(LM.omrNum(o.total)).toBe(o.total);
    expect(LM.omr(25)).toBe("25 OMR");
    LM.c = { ...LM.c, toOmr: undefined };
    expect(LM.omrRate()).toBe(1);
  });
});
