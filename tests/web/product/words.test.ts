/**
 * The page's wording, in both languages: the countdowns, the pieces left, the size label,
 * the price a box, the blends, the delivery time per market, the order-number tidying.
 */
import { describe, expect, it } from "vitest";
import { bootCore } from "../core/_boot";

async function words(lang: "ar" | "en" = "ar", url = "/?country=OM") {
  const { LM } = await bootCore({ lang, english: lang === "en", url });
  await LM.ready;
  const W = await import("../../../src/web/product/words");
  const T = await import("../../../src/web/product/track");
  return { LM, W, T };
}
const H = 3600e3, D = 86400e3, M = 60e3;

describe("from test-v412.js / test-v413.js: timeWords", () => {
  it("days count started days and never break into hours", async () => {
    const { W } = await words();
    const t = (ms: number) => W.timeWords(ms, "days");
    expect(t(3 * D)).toBe("3 أيام");
    expect(t(2 * D + 14 * H)).toBe("3 أيام");
    expect(t(2 * D)).toBe("يومين");
    expect(t(D + 3 * H)).toBe("يومين");
    expect(t(D)).toBe("يوم واحد");
    for (const ms of [23 * H, 5 * H, 10 * M, 0]) expect(t(ms)).toBe("يوم واحد");
    expect(t(11 * D)).toBe("11 يومًا");
  });
  it("hours: whole started hours, minutes in the last hour", async () => {
    const { W } = await words();
    expect(W.timeWords(62 * H, "hours")).toBe("62 ساعة");
    expect(W.timeWords(H + 59 * M, "hours")).toBe("ساعتين");
    expect(W.timeWords(30 * M, "hours")).toBe("30 دقيقة");
  });
  it("English: 2.5 d → 3 days, 1.5 d → 2 days, 3 h → 1 day", async () => {
    const { W } = await words("en");
    expect(W.timeWords(2.5 * D, "days")).toBe("3 days");
    expect(W.timeWords(1.5 * D, "days")).toBe("2 days");
    expect(W.timeWords(3 * H, "days")).toBe("1 day");
  });
});

describe("from test-v336-product.js (8): the large offers' countdown (tierLeft) and the units", () => {
  it("hours round up; minutes in the last hour; days count started days", async () => {
    const { W } = await words();
    const h = (ms: number) => W.timeWords(ms, "hours");
    expect(h(H + 59 * M)).toBe("ساعتين");
    expect(h(20e3)).toBe("دقيقة واحدة");
    expect(h(4 * M + 59e3)).toBe("5 دقائق");
    expect(h(59 * M + 50e3)).toBe("ساعة واحدة");
    expect(h(2 * H)).toBe("ساعتين");
    expect(h(25 * H + 1)).toBe("26 ساعة");
    expect(W.timeWords(30 * H, "days")).toBe("يومين");
    expect(W.timeWords(5 * H, "days")).toBe("يوم واحد");
  });
  it("tierLeft: null with no end; the panel's unit otherwise", async () => {
    const { LM, W } = await words();
    LM.tierEndsAt = () => null;
    expect(W.tierLeft()).toBe(null);
    const now = LM.now();
    LM.now = () => now;
    LM.tierEndsAt = () => now + 3 * H;
    LM.tierCfg = () => ({ unit: "hours" });
    expect(W.tierLeft()).toBe("3 ساعات");
    LM.tierCfg = () => ({ unit: "days" });
    expect(W.tierLeft()).toBe("يوم واحد");
  });
  it("from test-v197.js / test-v202.js: 1 hour is ساعة واحدة; English hours", async () => {
    const { W } = await words();
    expect(W.hourWords(1)).toBe("ساعة واحدة");
    expect(W.hourWords(5)).toBe("5 ساعات");
    const en = await words("en");
    expect(en.W.hourWords(49)).toMatch(/^49 hours?/);
    expect(en.W.minuteWords(1)).toBe("1 minute");
  });
});

describe("from test-v411.js / test-v419.js: the set's free-delivery clock (setFreeLeft)", () => {
  it("hours: باقي {t}; days: the owner's own words; null with no end", async () => {
    const { LM, W } = await words();
    const now = LM.now();
    LM.now = () => now;
    LM.setFreeEndsAt = () => null;
    expect(W.setFreeLeft()).toBe(null);
    LM.setFreeEndsAt = () => NaN;
    expect(W.setFreeLeft()).toBe(null);
    LM.cfg.offer = Object.assign({}, LM.cfg.offer, { freeShipUnit: "hours" });
    LM.setFreeEndsAt = () => now + 5 * H;
    expect(W.setFreeLeft()).toBe("باقي 5 ساعات");
    LM.cfg.offer!.freeShipUnit = "days";
    LM.setFreeEndsAt = () => now + 5 * H;
    expect(W.setFreeLeft()).toBe("1 يوم");
    LM.setFreeEndsAt = () => now + 30 * H;
    expect(W.setFreeLeft()).toBe("2 يومين");
    LM.setFreeEndsAt = () => now + 50 * H;
    expect(W.setFreeLeft()).toBe("3 أيام");
  });
  it("English: 1 day left, 2 days left, 3 days left", async () => {
    const { LM, W } = await words("en");
    const now = LM.now();
    LM.now = () => now;
    LM.cfg.offer = Object.assign({}, LM.cfg.offer, { freeShipUnit: "days" });
    LM.setFreeEndsAt = () => now + 5 * H;
    expect(W.setFreeLeft()).toBe("1 day left");
    LM.setFreeEndsAt = () => now + 30 * H;
    expect(W.setFreeLeft()).toBe("2 days left");
    LM.setFreeEndsAt = () => now + 50 * H;
    expect(W.setFreeLeft()).toBe("3 days left");
    // the offer pill's "{n} أيام" without `left`
    expect(W.dayWords(3)).toBe("3 days");
  });
});

describe("from test-free-ship.js: the strip counts whole days", () => {
  it("باقي 5 أيام … باقي يوم واحد to the last hour", async () => {
    const { LM, W } = await words();
    const now = LM.now();
    LM.now = () => now;
    expect(W.fsLeftHtml(now + 4 * D + 9 * H)).toBe("باقي <b>5 أيام</b>");
    expect(W.fsLeftHtml(now + 3 * D + 15 * H)).toBe("باقي <b>4 أيام</b>");
    expect(W.fsLeftHtml(now + 20 * H)).toBe("باقي <b>يوم واحد</b>");
    expect(W.fsLeftHtml(now + 40 * M)).toBe("باقي <b>يوم واحد</b>");
  });
});

describe("from test-v310.js / test-v206.js: pieces left", () => {
  it("the count first, Arabic plurals; nothing at 0 or unknown", async () => {
    const { W } = await words();
    expect(W.leftWords(1)).toBe("قطعة واحدة متبقية");
    expect(W.leftWords(2)).toBe("قطعتان متبقيتان");
    expect(W.leftWords(3)).toBe("3 قطع متبقية");
    expect(W.leftWords(10)).toBe("10 قطع متبقية");
    expect(W.leftWords(34)).toBe("34 قطعة متبقية");
    expect(W.leftWords(0)).toBe("");
    expect(W.leftWords(null)).toBe("");
    const en = await words("en");
    for (const n of [1, 2, 3, 34]) expect(en.W.leftWords(n)).not.toMatch(/[؀-ۿ]/);
  });
});

describe("from test-v203.js: sizeLabel", () => {
  it("Arabic adds the article to a one-word name; English: \"{n} size\"", async () => {
    const { W } = await words();
    expect(W.sizeLabel({ name: "كبير" })).toBe("الحجم الكبير");
    expect(W.sizeLabel({ name: "صغير" })).toBe("الحجم الصغير");
    expect(W.sizeLabel({ name: "الوسط" })).toBe("الحجم الوسط");
    expect(W.sizeLabel({ name: "علبة هدية" })).toBe("الحجم علبة هدية");
    const en = await words("en");
    expect(en.W.sizeLabel({ name: "Large" })).toBe("Large size");
    expect(en.W.sizeLabel({ name: "Small" })).toBe("Small size");
  });
});

describe("from test-v303.js / test-v310.js: perBox", () => {
  it("whole numbers for 2+ boxes or a currency without decimals; LM.num otherwise", async () => {
    const { LM, W } = await words("ar", "/?country=OM");
    expect(W.perBox(35.9 / 3, 3)).toBe("12");
    expect(W.perBox(12.95, 1)).toBe(LM.num(12.95));
    const ae = await words("ar", "/?country=AE");
    expect(ae.W.perBox(209.5, 1)).toBe("210");
  });
});

describe("from test-v414.js: the blends' names", () => {
  it("Arabic and English; a new scent keeps its catalogue name", async () => {
    const { W } = await words();
    expect(W.blendName({ id: "lemon", name: "x" })).toBe("لُبان الليمون مع مسك وورد");
    expect(W.blendName({ id: "oud", name: "x" })).toBe("لُبان العود مع اللافندر وورد");
    expect(W.blendName({ id: "amber", name: "x" })).toBe("لُبان العنبر مع التوت وورد");
    expect(W.blendName({ id: "rose", name: "ورد" })).toBe("ورد");
    const en = await words("en");
    expect(en.W.blendName({ id: "amber", name: "x" })).toBe("Amber frankincense with berries and rose");
  });
});

describe("from test-v198.js: the delivery time per market", () => {
  it("SA and QA 3-5 days, OM 48 hours, the rest the page's own", async () => {
    for (const [code, pair] of [
      ["SA", ["شحن خلال 3-5 أيام", "توصيل خلال 3-5 أيام إلى السعودية"]],
      ["QA", ["شحن خلال 3-5 أيام", "توصيل خلال 3-5 أيام إلى قطر"]],
      ["OM", ["شحن سريع خلال 48 ساعة", "توصيل خلال 48 ساعة داخل عُمان"]],
      ["KW", null],
      ["AE", null],
    ] as const) {
      const { W } = await words("ar", "/?country=" + code);
      expect(W.etaPair()).toEqual(pair);
    }
    const en = await words("en", "/?country=SA");
    expect(en.W.etaPair()).toEqual(["3–5 day shipping", "Delivery to Saudi Arabia in 3–5 days"]);
    const om = await words("en", "/?country=OM");
    expect(om.W.etaPair()).toEqual(["48 hour shipping", "Delivery within 48 hours in Oman"]);
  });
});

describe("from test-audit-fixes.js / test-v447.js: the order number tidying", () => {
  it("lm 482913, LM482913, 482913 → LM-482913", async () => {
    const { T } = await words();
    expect(T.trackTidy("lm 482913")).toBe("LM-482913");
    expect(T.trackTidy("LM482913")).toBe("LM-482913");
    expect(T.trackTidy("482913")).toBe("LM-482913");
    expect(T.trackTidy("LM-482913")).toBe("LM-482913");
    for (const v of ["lm 482913", "LM482913", "482913"]) expect(T.trackTidy(v)).toMatch(/^LM-\d{4,12}$/);
  });
});
