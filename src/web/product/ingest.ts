/**
 * THE ONE DOOR THE CATALOGUE COMES THROUGH. Sizes and scents are defined per country — name,
 * badge and stock are that market's own — so this runs again whenever the country or the
 * shelf changes. Everything here is sanitising: catalogue strings are published from /admin
 * and about to be concatenated into innerHTML, colours land in style attributes, ids in
 * attributes AND querySelector strings.
 */
import { LM } from "../core";
import { esc } from "../core/util";
import { P, type PScent, type PSize } from "./state";

export function clean(v: unknown): string {
  return esc(v);
}
/* kept in step with --berry in style.css: the badge colour the shop falls back to when /admin
   has not chosen one */
const BERRY = "#9c464c";
export function cleanHex(v: unknown, fallback?: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(v || "")) ? (v as string) : fallback || "#8f7238";
}
/* catalogue ids are slugs; anything else is dropped rather than escaped */
export function cleanId(v: unknown): string {
  return /^[A-Za-z0-9_-]{1,40}$/.test(String(v || "")) ? String(v) : "";
}

export function ingest(): void {
  P.SIZES = LM.sizes()
    .filter((z) => {
      /* the small box, off the page while every scent in it is at 0 on the shelf and the
         shop's "hide at 0" switch is on (v208); v335: the small box's tile stays while the set
         is off; only the set's card leaves the page */
      if (LM.stockHiddenSize && LM.stockHiddenSize(z.id)) return false;
      return true;
    })
    .map(
      (z): PSize => ({
        id: cleanId(z.id),
        name: clean(LM.txt(z, "name")),
        weight: clean(LM.txt(z, "weight")),
        tag: LM.txt(z, "tag") ? clean(LM.txt(z, "tag")) : "",
        /* the badge colour goes straight into a style="" attribute: only a real hex value */
        tagColor: cleanHex(z.tagColor, BERRY),
        /* strictly boolean: a catalogue carrying the string "false" must not read as sold out */
        soldOut: z.soldOut === true || z.soldOut === "true",
        open: z.open === true || (z.open as unknown) === "true",
      }),
    )
    .filter((z) => z.id);
  P.SCENTS = LM.scents()
    .map(
      (s): PScent => ({
        id: cleanId(s.id),
        name: clean(LM.txt(s, "name")),
        notes: clean(LM.txt(s, "notes")),
        accent: cleanHex(s.accent),
        art: LM.scentArt(s.art),
        /* the scent's label ("الأكثر مبيعا"), a text badge in the colour the shop chose */
        tag: LM.txt(s, "tag") ? clean(LM.txt(s, "tag")) : "",
        tagColor: cleanHex(s.tagColor, BERRY),
        /* (v415) the rating, 0 to 5, to one decimal; 0 means no rating shown */
        stars: Math.max(0, Math.min(5, Math.round((Number(s.stars) || 0) * 10) / 10)),
        soldOut: s.soldOut === true || s.soldOut === "true",
        /* the sizes this scent is out of, cleaned like every other id */
        soldOutSizes: (Array.isArray(s.soldOutSizes) ? s.soldOutSizes : []).map(cleanId).filter(Boolean),
      }),
    )
    .filter((s) => s.id);
}
