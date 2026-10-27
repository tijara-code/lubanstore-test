/**
 * WHO A SHOPPER IS, TO THE AD PLATFORMS — the normalisers, the hashing and the click ids
 * (port of the original netlify/lib/pixels/identity.js + pixel.js's copies). One module for
 * the browser and the server, so a hash made on the page and one made by a Conversions API
 * copy are the same by construction. No DOM, no Node APIs: SHA-256 is WebCrypto's
 * (globalThis.crypto.subtle — every browser on https, and Node ≥ 20).
 *
 * Normalisation is not cosmetic. The platforms hash the same way on their side; trim,
 * lowercase or strip differently and the identifier silently matches nobody. Each rule below
 * is Meta's (Snap's v3 takes the same keys under the same rules).
 */

export const HASH_RE = /^[a-f0-9]{64}$/;

export function isHash(v: unknown): v is string {
  return HASH_RE.test(String(v || ""));
}

/** SHA-256 hex of the exact string (UTF-8); null for an empty value or no WebCrypto. */
export async function sha256(v: unknown): Promise<string | null> {
  const s = String(v == null ? "" : v);
  if (!s) return null;
  const subtle = (globalThis as { crypto?: { subtle?: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (!subtle) return null;
  try {
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(s));
    let out = "";
    for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, "0");
    return out;
  } catch {
    return null;
  }
}

/* ---------- normalisers, one per field, all per Meta's spec ---------- */

/** email: trim, lowercase — dots and plus signs are significant and kept. */
export function normEmail(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
}

/** phone: digits only, country code included, no leading zeros or plus ("+968 9123 4567" → "96891234567"). */
export function normPhone(v: unknown): string | null {
  const d = String(v == null ? "" : v).replace(/\D/g, "").replace(/^0+/, "");
  return d.length >= 7 ? d : null;
}

/** names: lowercase, trim, drop Latin punctuation and digits; Arabic survives ("O'Brien" → "obrien"). */
export function normName(v: unknown): string | null {
  const s = String(v == null ? "" : v)
    .trim()
    .toLowerCase()
    .replace(/[.'"`\-_,()[\]0-9]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

/** city: lowercase, no spaces or punctuation at all ("Abu Dhabi" → "abudhabi"). */
export function normCity(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return s || null;
}

/** region/state: as city. */
export const normState = normCity;

/** country: ISO 3166-1 alpha-2, lowercase; anything else dropped rather than guessed. */
export function normCountry(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return /^[a-z]{2}$/.test(s) ? s : null;
}

/** postcode: lowercase, no spaces, the part before a dash. */
export function normZip(v: unknown): string | null {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, "");
  return s ? s.split("-")[0]! : null;
}

/** Hash unless it already is one: a hash hashed again matches nothing. */
export async function hashed(v: unknown, norm: (x: unknown) => string | null): Promise<string | null> {
  if (isHash(v)) return v;
  const n = norm(v);
  return n ? sha256(n) : null;
}

/**
 * ONE ID FOR ONE SHOPPER, on every event and both platforms: the SHA-256 of the normalised
 * phone — the value the browser keeps (lm_ph_v2) and passes to both pixels.
 */
export async function phoneId(v: unknown): Promise<string> {
  return (await hashed(v, normPhone)) || "";
}

/** first and last name as the Purchase sends them (purchase.js customerOf): first word, then the rest. */
export function splitName(name: unknown): { firstName: string; lastName: string } {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.length > 1 ? parts.slice(1).join(" ") : "" };
}

/** The customer as both Conversions APIs take it (raw or pre-hashed; hashed by hashedUser). */
export interface PixelUser {
  email?: unknown;
  emailHash?: unknown;
  phone?: unknown;
  phoneHash?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  city?: unknown;
  region?: unknown;
  zip?: unknown;
  country?: unknown;
  /** one id or several: the phone's hash, the browser's visitor id */
  externalId?: unknown;
  fbp?: unknown;
  fbc?: unknown;
  subscriptionId?: unknown;
}

export type UserData = Record<string, string[] | string>;

/** Drop undefined, null, "" and empty arrays (a present-but-blank field is graded as a fault). */
export function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o || {})) {
    const v = o[k];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * The hashed identifiers, shaped as Meta's user_data (Snap's v3 takes the same keys). Raw
 * cookies, click ids, IP and user agent are not here: each platform adds its own.
 */
export async function hashedUser(u: PixelUser = {}): Promise<UserData> {
  const one = async (v: unknown, norm: (x: unknown) => string | null) => {
    const h = await hashed(v, norm);
    return h ? [h] : [];
  };
  const ids = Array.isArray(u.externalId) ? u.externalId : [u.externalId];
  const ext: string[] = [];
  for (const x of ids) {
    if (!x) continue;
    const h = isHash(x) ? x : await sha256(String(x));
    if (h && ext.indexOf(h) < 0) ext.push(h);
  }
  return compact({
    em: await one(u.emailHash || u.email, normEmail),
    ph: await one(u.phoneHash || u.phone, normPhone),
    fn: await one(u.firstName, normName),
    ln: await one(u.lastName, normName),
    ct: await one(u.city, normCity),
    st: await one(u.region, normState),
    zp: await one(u.zip, normZip),
    country: await one(u.country, normCountry),
    external_id: ext,
  }) as UserData;
}

/**
 * THE CLICK ID, UNMODIFIED. Meta: "ClickID value is case sensitive - do not apply any
 * modifications". A clipped click id is worse than none (it is a different id). Trim only;
 * a value past a sanity bound is dropped, never shortened.
 */
export const CLICK_MAX = 1024;

export function clickId(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  return s.length > CLICK_MAX ? "" : s;
}

/** The phone hash the page keeps and the server sends (sha256 of normPhone), "" when not a phone. */
export async function hashPhone(raw: unknown): Promise<string> {
  const n = normPhone(raw);
  return n ? (await sha256(n)) || "" : "";
}

/**
 * The browser's advanced-matching hashes kept after a Purchase (pixel.js rememberMatch):
 * fn, ln, ct, em — normalised exactly as the server copy normalises them.
 */
export async function matchHashes(order: { name?: unknown; city?: unknown; email?: unknown }): Promise<Record<string, string>> {
  const { firstName, lastName } = splitName(order && order.name);
  const raw: Record<string, string | null> = {
    fn: normName(firstName), ln: normName(lastName), ct: normCity(order && order.city), em: normEmail(order && order.email),
  };
  const out: Record<string, string> = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (!v) continue;
    const h = await sha256(v);
    if (h && isHash(h)) out[k] = h;
  }
  return out;
}

/** GA4's client id (_ga) and session id (_ga_<stream>) shapes. */
export const GA_CID_RE = /^\d{4,20}\.\d{6,12}$/;
export const GA_SID_RE = /^\d{6,12}$/;
export const GA_ID_RE = /^G-[A-Z0-9]{4,16}$/;

export function gaCid(v: unknown): string {
  const s = String(v == null ? "" : v).trim();
  return GA_CID_RE.test(s) ? s : "";
}

export function gaSid(v: unknown): string {
  const s = String(v == null ? "" : v).trim();
  return GA_SID_RE.test(s) ? s : "";
}

/** The GA ids from the cookies: _ga is GA1.1.<client id>; _ga_<stream> GS1.1.<sid>.… or GS2.1.s<sid>$… */
export function gaIdsFromCookies(gaCookie: string | null | undefined, streamCookie: string | null | undefined): { gcid?: string; gsid?: string } {
  const out: { gcid?: string; gsid?: string } = {};
  const g = /^GA\d\.\d+\.(\d+\.\d+)$/.exec(String(gaCookie || ""));
  if (g) out.gcid = g[1]!;
  const v = String(streamCookie || "");
  const m = /^GS1\.\d+\.(\d+)\./.exec(v) || /^GS2\.\d+\.s(\d+)/.exec(v);
  if (m) out.gsid = m[1]!;
  return out;
}

/** Meta's rebuilt fbc (fb.1.<ms>.<fbclid>) from a stashed "<fbclid>|<ms>"; the id is everything before the LAST pipe. */
export function fbcFromStash(raw: string | null | undefined, now: number): string | null {
  if (!raw) return null;
  const cut = raw.lastIndexOf("|");
  const id = cut > 0 ? raw.slice(0, cut) : raw;
  const at = cut > 0 ? raw.slice(cut + 1) : "";
  if (!id) return null;
  return "fb.1." + (/^\d+$/.test(at) ? at : String(now)) + "." + id;
}
