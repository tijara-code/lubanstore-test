/**
 * The checkout's phone rules (from checkout.js): the hint per market, the market's exact
 * length and the mobile's first digits — the lengths and first digits are the shared tables
 * (src/shared/orders/phone.ts MOBILE_LEN / MOBILE_FIRST), identical to the original page's
 * PHONE[].len and FIRST, and the server's MOBILE_FIRST; one table for the page and the till.
 *
 * These are pure: the page module passes in what is typed and the chosen dial code.
 */
import { MOBILE_FIRST, MOBILE_LEN } from "../../shared/orders/phone";

/* What each market's mobile number looks like, keyed by dial code. The hint shows a leading
   digit only where one is genuinely typical (Qatar and Kuwait spread across several operator
   prefixes, so naming one would be wrong more often than right). `len` is the counter beside
   the box ("0/8") and (v336) the submit rule: the server holds a number to its market's
   exact length. The box still takes any length; submit says what is wrong. */
const HINT: Record<string, string> = {
  "971": "5X XXX XXXX", // UAE — 9 digits
  "966": "5X XXX XXXX", // Saudi — 9
  "974": "XXXX XXXX", // Qatar — 8, across 3/5/6/7
  "965": "XXXX XXXX", // Kuwait — 8, across 4/5/6/9
  "973": "3XXX XXXX", // Bahrain — 8
  "968": "9XXX XXXX", // Oman — 8; 9 is the common one, 7 also valid
};

export interface PhonePlan {
  hint: string;
  len: number;
}

export const PHONE: Record<string, PhonePlan> = {};
Object.keys(HINT).forEach((dc) => {
  PHONE[dc] = { hint: HINT[dc]!, len: MOBILE_LEN[dc]! };
});

/* (v414) THE FIRST DIGIT: the digits a mobile number of each market begins with */
export const FIRST: Record<string, string> = MOBILE_FIRST;

/* The digits as dialled internationally, and only those. A trunk 0 ("0501…") is dropped,
   and a pasted own country code ("+968 9…") is removed — only when what is left is still a
   plausible number (≥ 7 digits): a Kuwaiti mobile can legitimately begin 965. */
export function phoneDigits(value: string, dc: string): string {
  let d = value.replace(/\D/g, "").replace(/^0+/, "");
  if (dc && d.indexOf(dc) === 0) {
    const rest = d.slice(dc.length).replace(/^0+/, "");
    if (rest.length >= 7) d = rest;
  }
  return d;
}

/* (v414) the number starts with a digit no mobile there starts with. Not while what is typed
   so far could still be the market's dial code ("97…" on its way to "+971 5…"). */
export function leadBad(d: string, p: PhonePlan | undefined, dc: string): boolean {
  const f = FIRST[dc];
  if (!d || !p || !f) return false;
  if (d.length < p.len && dc.indexOf(d.slice(0, dc.length)) === 0) return false;
  return f.indexOf(d.charAt(0)) < 0;
}

/* the input filters (checkout.js restrict()): */

/* name: letters and spaces only — any script's letters and their marks ("José", "Zoë" kept
   whole), no digits. Built at run time so an engine without Unicode property escapes falls
   back to Arabic and Latin instead of failing to parse. */
let NOT_NAME: RegExp;
try {
  NOT_NAME = new RegExp("[^\\p{L}\\p{M}\\s'.-]", "gu");
} catch {
  NOT_NAME = /[^؀-ۿa-zA-ZÀ-ɏ\s'.-]/g;
}
export function keepName(v: string): string {
  return v.replace(/[0-9٠-٩۰-۹]/g, "").replace(NOT_NAME, "").replace(/\s{2,}/g, " ");
}

/* phone: digits only, Arabic-Indic and Persian/Urdu digits folded to Latin */
export function keepPhone(v: string): string {
  return v
    .replace(/[٠-٩۰-۹]/g, (d) => {
      const c = d.charCodeAt(0);
      return String(c - (c >= 0x6f0 ? 0x6f0 : 0x660));
    })
    .replace(/[^0-9]/g, "");
}
