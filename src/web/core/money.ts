/**
 * Money on the page: the market's figures, the currency marks, and the OMR every card is
 * charged in.
 */
import { LM } from "./self";
import { L } from "./lang";
import { esc, pick, toAr } from "./util";
import type { LmApi } from "./types";

/** a figure in the market's decimals, trailing zeros dropped ("25", "29.9", "120") */
function figure(n: number): string {
  const c = LM.c;
  const v = c.dec ? (Math.round(n * 1000) / 1000).toFixed(c.dec).replace(/\.?0+$/, "") : Math.round(n);
  return toAr(v);
}

export const money: Pick<LmApi, "moneyMark" | "moneyHTML" | "money" | "num" | "omrRate" | "omrNum" | "omr" | "price" | "was"> = {
  /**
   * The dirham mark (and the rial's and riyal's), for the two shopper-facing pages. The
   * UAE's 2025 symbol is too new for reliable font coverage, so it is a CSS mask filled
   * with currentColor: one empty span per price, inheriting the colour and weight of the
   * text it sits in. moneyHTML is markup — assigned with innerHTML only, and only to numbers
   * this code generated; money() is the plain-text version for anything read aloud, stored
   * or sent to a server.
   */
  moneyMark() {
    if (LM.c.cur === "AED") return '<span class="dh" role="img" aria-label="' + L("درهم") + '"></span>';
    if (LM.c.cur === "OMR") return '<span class="omr" role="img" aria-label="' + L("ريال عماني") + '"></span>';
    if (LM.c.cur === "SAR") return '<span class="sar" role="img" aria-label="' + L("ريال سعودي") + '"></span>';
    /* every other currency is its own code — catalogue data, so escaped: it reaches innerHTML */
    return esc(LM.c.cur);
  },
  moneyHTML(n) {
    return LM.num(n) + " " + LM.moneyMark();
  },
  /** a number in the active market's currency, as text */
  money(n) {
    return figure(n) + " " + LM.c.cur;
  },
  num(n) {
    return figure(n);
  },
  /** every card is charged in OMR regardless of the display currency */
  omrRate() {
    return +(LM.c.toOmr as number) || 1;
  },
  omrNum(n) {
    return Math.round(n * LM.omrRate() * 1000) / 1000;
  },
  omr(n) {
    const v = Math.round(n * LM.omrRate() * 1000) / 1000;
    return toAr(v % 1 ? v.toFixed(3).replace(/\.?0+$/, "") : String(v)) + " OMR";
  },
  price(sizeId) {
    return pick(sizeId).now;
  },
  /** an offer's reference is its boxes at the single price — the till's own figure (v305) */
  was(sizeId) {
    return LM.isTier(sizeId) ? LM.tierWas(sizeId) : (pick(sizeId).was as number);
  },
};
