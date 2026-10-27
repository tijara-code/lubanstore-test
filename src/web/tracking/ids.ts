/**
 * Who the shopper is to the ad platforms, as this browser knows it (pixel.js's readers): the
 * platforms' own first-party cookies, the click ids stashed on the landing, the kept hashes,
 * the visitor id the head script made, the market. Hashes only — nothing personal is stored or
 * read here in the clear. Every reader answers null rather than throw.
 */
import { fbcFromStash, isHash } from "../../shared/pixels/identity";

/** the normalised phone's hash of a shopper who has ordered before (v2: digits, country code) */
export const PH_KEY = "lm_ph_v2";
/** v315: the number typed complete at checkout, hashed, this tab only */
export const PH_TYPED = "lm_ph_typed";
/** v321: the other advanced-matching hashes (fn, ln, ct, em) kept after a Purchase */
export const AM_KEY = "lm_am_v1";
/** v315: the first-party visitor id (64 hex) the head script makes */
export const VID_KEY = "lm_vid";

export function cookie(name: string): string | null {
  try {
    const m = new RegExp("(?:^|;\\s*)" + name + "=([^;]+)").exec(document.cookie);
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
}

export function savedPhone(): string | null {
  try {
    const p = localStorage.getItem(PH_KEY);
    if (isHash(p)) return p;
    /* v315: the number typed complete at checkout, for this tab only — so InitiateCheckout's
       later twins and AddPaymentInfo carry it */
    const t = sessionStorage.getItem(PH_TYPED);
    return isHash(t) ? t : null;
  } catch {
    return null;
  }
}

/** the first-party visitor id the head script made (v315) */
export function vid(): string | null {
  try {
    const v = localStorage.getItem(VID_KEY);
    return isHash(v) ? v : null;
  } catch {
    return null;
  }
}

/** the market the shopper is buying in */
export function market(): string | undefined {
  try {
    const LM = window.LM;
    let c: string = String((LM && LM.c && LM.c.code) || "");
    /* before the catalogue answers (the first PageView): the country the address names, else
       the shopper's kept pick; the server falls back to the edge's country after that */
    if (!c) { const m = /[?&]country=([A-Za-z]{2})(&|$)/.exec(location.search); c = m ? m[1]!.toUpperCase() : ""; }
    if (!c) c = String(localStorage.getItem("lm_cty_v2") || "").toUpperCase();
    return /^[A-Z]{2}$/.test(c) ? c : undefined;
  } catch {
    return undefined;
  }
}

/** the Snap click id, captured from ?ScCid= on the landing page (by the head snippet) */
export function snapClickId(): string | null {
  try { return sessionStorage.getItem("lm_sccid") || null; } catch { return null; }
}

/** Snap's first-party cookie, for server-side matching */
export function scid(): string | null {
  return cookie("_scid");
}

/** Meta's own first-party browser id. Set by the pixel; sent raw, never hashed. */
export function fbp(): string | null {
  return cookie("_fbp");
}

/* STASH THE CLICK ID THE MOMENT IT ARRIVES. Meta's pixel writes _fbc only once it has loaded,
   so a shopper who lands on an ad click and taps through before then would send no click id
   for the rest of the visit. Written on first sight and never re-stamped within the session
   (`creationTime` is "when you first observed this fbclid"); a NEW click replaces it. Stored
   exactly as the URL gave it (URLSearchParams decodes the percent-escapes). */
export function stashClickId(): void {
  try {
    const q = new URLSearchParams(location.search).get("fbclid");
    if (!q) return;
    const had = sessionStorage.getItem("lm_fbclid");
    if (had && had.split("|")[0] === q) return;
    sessionStorage.setItem("lm_fbclid", q + "|" + Date.now());
  } catch { /* nothing */ }
}

/** The click id: the _fbc cookie, else fb.1.<first seen>.<fbclid> rebuilt from the stash. */
export function fbc(): string | null {
  const c = cookie("_fbc");
  if (c) return c;
  try {
    return fbcFromStash(sessionStorage.getItem("lm_fbclid"), Date.now());
  } catch {
    return null;
  }
}
