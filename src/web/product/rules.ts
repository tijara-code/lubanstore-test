/**
 * The page's rules, without drawing: which layout, which sizes are open, what a size's
 * picker shows and counts, what an offer takes, what a tile says.
 */
import { LM } from "../core";
import { P, qOf, st, type PScent, type PSize } from "./state";
import { leftWords, toAr } from "./words";

const L = (s: string, v?: Parameters<typeof LM.L>[1]) => LM.L(s, v);

/* ONE PAGE, NOTHING TO CHOOSE (v312) — v335: the design whatever the set does. Only a
   catalogue with no set at all (none in production) keeps the old picker. */
export function stacked(): boolean {
  return !!LM.offerCfg("bundle");
}
export function smallSize(): string {
  return LM.bundleSize();
}

/* the page shows one grid, the chosen size's — nothing is ever held open beside it (the
   accordion went with the classic style, v200) */
export function keptOpen(_sz: PSize | null): boolean {
  return false;
}
export function allOpen(): boolean {
  return P.SIZES.length > 0 && P.SIZES.every((s) => s.soldOut || keptOpen(s));
}
/** the sizes whose panel is on screen */
export function openSizes(): PSize[] {
  const out = P.SIZES.filter(keptOpen);
  if (st.size && !keptOpen(st.size) && out.indexOf(st.size) < 0) out.push(st.size);
  return out;
}
export function firstBuyable(): PSize | null {
  const ok = P.SIZES.filter((s) => !s.soldOut);
  return ok.filter((s) => s.tag)[0] || ok[0] || null;
}

/* ---- the large-box offers (v303) ---- */
export function tierSizeHere(sz: PSize | null | undefined): boolean {
  return !!sz && sz.id === LM.tierSize();
}
export function tiersHere(sz: PSize | null | undefined): boolean {
  return tierSizeHere(sz) && (LM.tierOn("duo") || LM.tierOn("trio"));
}
/** the number of scents the grid takes now: 2 or 3 in an offer, 0 for the single box */
export function tierNeed(sz?: PSize | null): number {
  if (!tiersHere(sz || st.size)) return 0;
  return st.tier && st.tier !== "single" && LM.tierOn(st.tier) ? LM.tierN(st.tier) : 0;
}

/* Is this scent unavailable in the size the picker is showing? The blanket flag first, then
   the per-size list. LM.lineOffered is the same rule, and the till refuses on it. */
export function scentShut(sc: PScent, size: PSize | null | undefined): boolean {
  if (sc.soldOut) return true;
  const sz = size ? size.id : st.size && st.size.id;
  return !!sz && (sc.soldOutSizes || []).indexOf(sz) > -1;
}

/* THE SCENTS A SIZE'S PICKER SHOWS — one rule for its rows, its counts and its add button
   (v209). A scent with none of this box on the shelf is off the page when the shop's switch
   says so (v208); a size whose every row would go keeps them all. */
export function shownScents(sz: PSize): PScent[] {
  let shown = P.SCENTS.filter((sc) => !(LM.stockHidden && LM.stockHidden(sc.id, sz.id)));
  if (!shown.length) shown = P.SCENTS;
  return shown;
}

/* `picked` is the last gate before a cart line: a shut scent never counts */
export function picked(sz?: PSize | null): PScent[] {
  sz = sz || st.size;
  if (!sz) return [];
  const s = sz;
  return shownScents(s).filter((sc) => qOf(s.id, sc.id) > 0 && !scentShut(sc, s));
}
export function pickedCount(sz: PSize): number {
  return picked(sz).reduce((t, sc) => t + qOf(sz.id, sc.id), 0);
}
/** one size's panel, in money — an offer costs its own price, whatever the mix */
export function sizeTotal(sz: PSize): number {
  if (tierNeed(sz)) return LM.price(st.tier!);
  return picked(sz).reduce((t, sc) => t + LM.price(sz.id) * qOf(sz.id, sc.id), 0);
}
/** everything chosen on screen */
export function pickedTotal(): number {
  return openSizes().reduce((t, sz) => t + sizeTotal(sz), 0);
}
/* "اختر روائح 0/3" — v309: the count isolated left to right */
export function tierCountText(sz: PSize): string {
  const n = tierNeed(sz);
  if (!n) return "";
  const k = pickedCount(sz);
  return L("اختر روائح") + " ⁦" + toAr(k) + "/" + toAr(n) + "⁩";
}

/* (v336) is nothing of this size buyable? sold out in the catalogue; the set's size, while
   the set is not sellable; or every scent in it sold out, hidden at 0 or capped at 0 */
export function sizeGated(sz: PSize): boolean {
  if (sz.soldOut) return true;
  if (stacked() && sz.id === smallSize()) return !LM.bundleSellable("bundle");
  return !P.SCENTS.some(
    (sc) => !scentShut(sc, sz) && !(LM.stockHidden && LM.stockHidden(sc.id, sz.id)) && !(LM.stockCap && LM.stockCap(sc.id, sz.id) === 0),
  );
}
/* THE TILE'S LINE (v312): what is left of the size, "34 قطعة متبقية"; the weight where the
   shelf does not say. v318/v336: "sold out" only when the size is really shut. (v403) the
   counter is on and the shelf has not answered: the line's place held, empty. */
export function tileWords(sz: PSize): string {
  const n = LM.stockLeft ? LM.stockLeft(sz.id) : null;
  if (n == null && LM.stockPending && LM.stockPending()) return " ";
  if (n === 0 && sizeGated(sz)) return L("نفدت الكمية");
  return leftWords(n) || sz.weight;
}

/* (v336) A CHOSEN OFFER THAT IS NO LONGER ON takes its half-picked scents with it */
export function dropDeadTier(): boolean {
  if (!st.tier || st.tier === "single" || LM.tierOn(st.tier)) return false;
  delete P.QTY[LM.tierSize()];
  st.tier = null;
  return true;
}
