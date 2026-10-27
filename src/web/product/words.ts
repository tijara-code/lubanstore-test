/**
 * The page's words: counts with their Arabic nouns, the one countdown wording (v413), the
 * size and offer names, the price a box, the blends' names, the delivery time per market.
 * Pure functions over LM (no DOM).
 */
import { LM } from "../core";
import { toAr } from "../core/util";
import type { PScent, PSize } from "./state";

const L = (s: string, v?: Parameters<typeof LM.L>[1]) => LM.L(s, v);

export { toAr };

export function money(n: number): string {
  return LM.money(n);
}

/* "باقي 13 قطعة" — the pieces left of a size the shop is counting (v206; the number is
   /api/stock's, see LM.stockLeft). Nothing for a size that is not counted, and nothing at 0:
   the line goes away and the size stays on sale — the count is shown, never enforced.
   v310: "34 قطعة متبقية" — the count first; Arabic agrees the word with the number (one,
   two, 3 to 10, 11 and up). */
export function leftWords(n: number | null | undefined): string {
  if (n == null || !(n > 0)) return "";
  if (n === 1) return L("قطعة واحدة متبقية");
  if (n === 2) return L("قطعتان متبقيتان");
  if (n <= 10) return L("{n} قطع متبقية", { n: toAr(n) });
  return L("{n} قطعة متبقية", { n: toAr(n) });
}

/* "الحجم الكبير" from the catalogue's "كبير": Arabic puts the article on the adjective too,
   so a one-word name without it gets "ال". A name already definite, or of several words, is
   used as written. English: "Large size". */
export function sizeLabel(sz: Pick<PSize, "name">): string {
  let n = String(sz.name || "").trim();
  if (LM.lang !== "en" && n && !/\s/.test(n) && n.indexOf("ال") !== 0) n = "ال" + n;
  return L("الحجم {n}", { n: n });
}

export function tierName(id: string | null): string {
  return id === "trio" ? L("3 علب") : id === "duo" ? L("علبتان") : L("علبة");
}

/* THE PRICE A BOX, as the rows say it: whole numbers for every offer of two or more (v310 —
   "16 للعلبة" in Oman, not 15.95; "210" in the Emirates, not 209.5); the single box keeps its
   own price, fils and all, in a market that counts them */
export function perBox(v: number, boxes: number): string {
  const c = (LM.c || {}) as { dec?: number };
  if (boxes > 1 || !c.dec) return String(Math.round(v));
  return LM.num(v);
}

/* "26 يومًا" — Arabic counts its noun */
export function dayWords(d: number): string {
  if (d === 1) return L("يوم واحد");
  if (d === 2) return L("يومين");
  if (d <= 10) return L("{n} أيام", { n: toAr(d) });
  return L("{n} يومًا", { n: toAr(d) });
}

/* "626 ساعة" — Arabic counts 3 to 10 in the plural, two as a dual */
export function hourWords(h: number): string {
  if (h === 1) return L("ساعة واحدة");
  if (h === 2) return L("ساعتين");
  if (h <= 10) return L("{n} ساعات", { n: toAr(h) });
  return L("{n} ساعة", { n: toAr(h) });
}

/* "5 دقائق" — the same counting as the hours */
export function minuteWords(m: number): string {
  if (m === 1) return L("دقيقة واحدة");
  if (m === 2) return L("دقيقتين");
  if (m <= 10) return L("{n} دقائق", { n: toAr(m) });
  return L("{n} دقيقة", { n: toAr(m) });
}

/* THE ONE COUNTDOWN WORDING (v413), for every clock on the page: the large offers, the set's
   free delivery and the free-delivery strip, in the unit the shop chose on the panel.
   "days": whole days, counting down — "3 أيام", "يومين", "يوم واحد" — started days counted, so
   the last day reads "يوم واحد" to the end; never hours.
   "hours": whole hours — "626 ساعة" — started hours (v336: 1 h 59 m is "ساعتين"), and minutes
   in the last hour so the last 20 seconds never read as an hour. */
export function timeWords(ms: number, unit: string): string {
  ms = Math.max(0, ms);
  if (unit !== "hours") return dayWords(Math.max(1, Math.ceil(ms / 86400e3)));
  const m = Math.max(1, Math.ceil(ms / 60e3));
  if (m < 60) return minuteWords(m);
  return hourWords(Math.ceil(ms / 3600e3));
}

/* WHAT THE LARGE OFFERS' COUNTDOWN SAYS, in the unit the shop chose on the panel
   (cfg.tiers.unit, v303) */
export function tierLeft(): string | null {
  const end = LM.tierEndsAt();
  if (end === null) return null;
  const t = LM.tierCfg() || {};
  return timeWords(end - LM.now(), t.unit === "hours" ? "hours" : "days");
}

/* THE SET'S FREE-DELIVERY CLOCK (v411): how long the switch has left, in the words the large
   offers use; null with no end. */
export function setFreeLeft(): string | null {
  const end = LM.setFreeEndsAt ? LM.setFreeEndsAt() : null;
  if (end === null || isNaN(end)) return null;
  const o = LM.cfg && LM.cfg.offer;
  if (o && o.freeShipUnit === "hours") return L("باقي {t}", { t: timeWords(end - LM.now(), "hours") });
  /* v419: the days with their figure, the owner's wording — "3 أيام", "2 يومين", "1 يوم"
     (English keeps "3 days left") */
  const d = Math.max(1, Math.ceil(Math.max(0, end - LM.now()) / 86400e3));
  return d === 1 ? L("{n} يوم", { n: toAr(1) }) : d === 2 ? L("{n} يومين", { n: toAr(2) }) : L("{n} أيام", { n: toAr(d), left: 1 });
}

/* DAYS (v413): the free-delivery strip — "باقي 3 أيام", "باقي يومين", "باقي يوم واحد" on the
   last (it ends at midnight Muscat, end - now) */
export function fsLeftHtml(end: number): string {
  return L("باقي {t}", { t: "<b>" + timeWords(end - LM.now(), "days") + "</b>" });
}

/* (v414) the set's scents by the blends' own names, the ones the description lists
   ("لُبان الليمون مع مسك وورد"); a scent the catalogue adds later keeps its catalogue name */
const BLEND: Record<string, string> = {
  lemon: "لُبان الليمون مع مسك وورد",
  oud: "لُبان العود مع اللافندر وورد",
  amber: "لُبان العنبر مع التوت وورد",
};
export function blendName(sc: Pick<PScent, "id" | "name">): string {
  return BLEND[sc.id] ? L(BLEND[sc.id]!) : sc.name;
}

/* HOW LONG DELIVERY TAKES (v198): Saudi Arabia and Qatar (v211) say 3-5 days, Oman 48 hours
   (v210), every other market the page's own 72 hours */
export function etaPair(): [string, string] | null {
  const code = LM.c && LM.c.code;
  return code === "SA"
    ? [L("شحن خلال 3-5 أيام"), L("توصيل خلال 3-5 أيام إلى السعودية")]
    : code === "QA"
      ? [L("شحن خلال 3-5 أيام"), L("توصيل خلال 3-5 أيام إلى قطر")]
      : code === "OM"
        ? [L("شحن سريع خلال 48 ساعة"), L("توصيل خلال 48 ساعة داخل عُمان")]
        : null;
}
/** the short words for this market, "" where the page's own stand */
export function etaWords(): string {
  const p = etaPair();
  return p ? p[0] : "";
}
