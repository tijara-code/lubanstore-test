/**
 * The places a market ships to — the checkout's own list (src/web/core/cities.ts), stored in
 * Arabic exactly as every website order stores them, with the English beside each to pick by
 * (src/web/core/i18n-en.ts). Oman's "city" is its governorate (the 11 muhafazat).
 */
import { DIAL } from "../../shared/orders/phone";
import { LM_CITIES } from "../../web/core/cities";
import { LM_EN } from "../../web/core/i18n-en";

export interface Place {
  value: string;
  en: string;
}

/** The market's places, then any `extra` (an order's own town the list lacks), no repeats. */
export function placesOf(countryCode: string, extra: Array<string | null | undefined> = []): Place[] {
  const all = LM_CITIES[DIAL[String(countryCode || "").toUpperCase()] || ""] || [];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const v of [...all, ...extra]) {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const en = LM_EN[s];
    out.push({ value: s, en: typeof en === "string" ? en : "" });
  }
  return out;
}

export const isOman = (cc: string | null | undefined) => String(cc || "").toUpperCase() === "OM";
