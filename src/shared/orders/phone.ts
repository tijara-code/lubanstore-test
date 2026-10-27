/**
 * Phone numbers in the six markets: dial codes, mobile lengths and leading digits — one
 * table for the checkout's live check, the server's intake and the courier details check.
 */
import { asciiDigits } from "../money";

export const DIAL: Record<string, string> = { AE: "971", SA: "966", QA: "974", KW: "965", BH: "973", OM: "968" };
export const MOBILE_LEN: Record<string, number> = { "971": 9, "966": 9, "974": 8, "965": 8, "973": 8, "968": 8 };
/** the digits a mobile begins with: Oman 7/9, UAE & Saudi 5, Qatar 3/5/6/7, Bahrain 3/6, Kuwait 4/5/6/9 */
export const MOBILE_FIRST: Record<string, string> = { "971": "5", "966": "5", "974": "3567", "965": "4569", "973": "36", "968": "79" };

/** The national number: digits only, no 00, no dial code, no trunk 0. */
export function nationalDigits(phone: unknown, countryCode: unknown): string {
  let d = asciiDigits(phone == null ? "" : phone).replace(/\D/g, "").replace(/^00/, "");
  const code = DIAL[String(countryCode || "").toUpperCase()];
  if (code && d.indexOf(code) === 0 && d.length > MOBILE_LEN[code]!) d = d.slice(code.length);
  return d.replace(/^0+/, "");
}

/** International digits (e.g. "96876655565"): the customer key and the pixel-hash input. */
export function phoneKey(phone: unknown, countryCode: unknown): string {
  const code = DIAL[String(countryCode || "").toUpperCase()];
  const n = nationalDigits(phone, countryCode);
  if (!n) return "";
  return code ? code + n : n;
}

/** A mobile number of the market's own length and leading digit. */
export function validMobile(phone: unknown, countryCode: unknown): boolean {
  const code = DIAL[String(countryCode || "").toUpperCase()];
  const n = nationalDigits(phone, countryCode);
  if (!code) return n.length >= 7;
  return n.length === MOBILE_LEN[code] && MOBILE_FIRST[code]!.indexOf(n.charAt(0)) > -1;
}

/** What a courier needs to find the customer; the failing fields ([] = ready). */
export function checkOf(o: { name?: unknown; phone?: unknown; countryCode?: unknown; city?: unknown; region?: unknown }): string[] {
  const bad: string[] = [];
  if (String(o.name || "").replace(/[^\p{L}]/gu, "").length < 2) bad.push("name");
  if (!validMobile(o.phone, o.countryCode)) bad.push("phone");
  if (String(o.city || "").trim().length < 2) bad.push("city");
  if (String(o.region || "").trim().length < 2) bad.push("area");
  return bad;
}
