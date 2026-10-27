/**
 * THE LANGUAGE. Arabic is the store; English is the same store at /en/, generated from
 * the Arabic pages (scripts/make-en.ts) and running this same code. The page says which it
 * is on <html lang>, and everything below asks that one question.
 *
 * L(arabic, vars) is every string the code shows a shopper. The Arabic IS the key — so the
 * code still reads as the page reads — and ./i18n-en.ts (installed as window.LM_EN by
 * src/web/entries/en.ts, on the English pages only) holds the English for each. An entry
 * may be a function, for the phrases English inflects ("1 day" / "5 days"). {name}
 * placeholders are filled in either language; what fills them is the caller's
 * responsibility to escape.
 */
import type { Vars } from "./types";

export function pageLang(): "ar" | "en" {
  return (document.documentElement && document.documentElement.lang) === "en" ? "en" : "ar";
}

/** read once, when the core loads — the page's language does not change under it */
export const LANG: "ar" | "en" = pageLang();

export function L(s: string, v?: Vars): string {
  let t: unknown = s;
  const dict = typeof window !== "undefined" ? window.LM_EN : undefined;
  if (LANG === "en" && dict) {
    const e = dict[s];
    if (typeof e === "function") return e(v || {});
    if (e != null) t = e;
  }
  return v ? String(t).replace(/\{(\w+)\}/g, (m, k: string) => (v[k] != null ? String(v[k]) : m)) : (t as string);
}

/**
 * Catalogue text in the page's language: name_en beside name, and so on, edited in
 * /admin > Catalogue. An English box left empty falls back to the Arabic rather than to
 * nothing — and an ARABIC box left empty wins outright: clearing a badge in Arabic is how
 * the shop removes it, and the English one must not live on without it.
 */
export function txt(o: unknown, k: string): string {
  if (!o) return "";
  const r = o as Record<string, unknown>;
  const ar = r[k] == null ? "" : r[k];
  if (LANG !== "en" || String(ar).trim() === "") return ar as string;
  const en = r[k + "_en"];
  return en != null && String(en).trim() !== "" ? (en as string) : (ar as string);
}

/**
 * Where assets/ is from this page: "" on the Arabic pages at the root, "../" on /en/. Every
 * image path the code builds starts here. (store.js read it off its own <script src>; the
 * bundle's file lives at /assets/<hash>.js whatever the page, so the page's language — the
 * English pages are exactly the ones under /en/ — answers the same question.)
 */
export const ROOT: string = LANG === "en" ? "../" : "";

/**
 * "?v=<hash>" to append to any assets/img URL the code builds. Everything under assets/ is
 * cached immutable for a year, so a photo replaced under the same name must be a new URL.
 * The build writes the hash of the image files (scripts/site-meta.ts); "" when unbuilt.
 */
export const ASSET_V: string = typeof __LM_ASSET_V__ === "string" && __LM_ASSET_V__ ? "?v=" + __LM_ASSET_V__ : "";
