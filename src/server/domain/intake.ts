/**
 * What a shopper posts to a till, whitelisted and capped (port of the original
 * orders.intake + core/validate). Nothing about money: that is priced from the catalogue.
 *
 * Everything arriving here is untrusted. A field is a value only when it is a string or a
 * number (an object posted in a field is never stringified — a crafted toString threw a 500
 * once); free text loses its angle brackets; a phone is digits and + - ( ) only, with
 * Arabic-Indic digits made Latin and the invisible marks a pasted RTL contact carries
 * dropped; an email with markup or quotes is no email.
 *
 * THE BASKET'S SHAPE is checked before anything is priced (v336): a quantity is a whole
 * number from 1 to 99 (a number, or a string of its digits; absent is one), a line is an
 * object, and the order holds at most 40 lines and 99 boxes — forty lines of 99 was once a
 * 99,001 OMR cash order, reported to Meta at that value.
 */
import type { RefInput } from "../../shared/attribution";
import type { ClientSignals } from "../../shared/orders/types";

export interface Intake {
  name: string;
  phone: string;
  email: string | null;
  items: Array<{ itemId: string; qty: number }>;
  countryCode: string;
  city: string;
  region: string;
  note: string;
  dedupeId: string | null;
  /** the browser's proposed LM- id, when well formed */
  proposedId: string | null;
  pageUrl: string | null;
  lang: "ar" | "en";
  ref: RefInput | null;
  /** fbp, fbc, scid, sccid, gcid, gsid, vid … from the page */
  signals: ClientSignals;
}

/** A refusal before pricing: { error: "incomplete" | "bad_qty" | "too_many" | "unknown_item", item? }. */
export interface IntakeRefusal {
  error: string;
  item?: string | null;
}

/* ---------------- the small checks (core/validate) ---------------- */

/** every order id this shop has ever issued: LM- and 4 to 12 digits */
export const ORDER_ID = /^LM-\d{4,12}$/;
/** the per-order secret on invoice and reminder links */
export const ORDER_KEY = /^[a-f0-9]{16,64}$/;

export function isOrderId(v: unknown): v is string {
  return typeof v === "string" && ORDER_ID.test(v);
}

export function isOrderKey(v: unknown): v is string {
  return typeof v === "string" && ORDER_KEY.test(v);
}

/** A string or a number only, trimmed and capped. */
export function str(v: unknown, max = 200): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).trim().slice(0, max);
}

/** Free text a person typed (name, city, area, note): angle brackets are where markup starts. */
export function text(v: unknown, max = 200): string {
  return typeof v === "string" || typeof v === "number" ? str(String(v).replace(/[<>]/g, ""), max) : "";
}

/** An address, lower-cased, or null: no markup and no quotes in any part. */
export function email(v: unknown): string | null {
  const e = str(v, 120).toLowerCase();
  return /^[^@\s<>"'`]+@[^@\s<>"'`]+\.[^@\s<>"'`]{2,}$/.test(e) ? e : null;
}

/** Arabic-Indic (and Persian) digits → ASCII. */
export function latinDigits(v: unknown): string {
  return String(v == null ? "" : v)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/** LRM, RLM, the embeddings and isolates, no-break spaces: not the shopper's typing. */
const INVISIBLE = /[‎‏‪-‮⁦-⁩   ]/g;

/** A phone as stored: Latin digits, spaces and + - ( ) only; anything else is no phone ("" ). */
export function phone(v: unknown, max = 40): string {
  const p = latinDigits(str(v, max).replace(INVISIBLE, " ")).replace(/\s+/g, " ").trim();
  return /^[0-9 +\-()]+$/.test(p) ? p : "";
}

/** Enough digits to be a phone number at all (seven). */
export function phoneLike(v: unknown): boolean {
  return latinDigits(v).replace(/\D/g, "").length >= 7;
}

/** A page address the ad platforms may be told: http(s) only, capped. */
export function pageUrl(v: unknown): string {
  const u = str(v, 400);
  return u && /^https?:\/\//i.test(u) ? u : "";
}

/** Ids from a panel request: strings, de-blanked, capped. */
export function idList(v: unknown, max = 200): string[] {
  return (Array.isArray(v) ? v : []).slice(0, max).map((x) => (typeof x === "string" || typeof x === "number" ? String(x) : "")).filter(Boolean);
}

/* ---------------- the basket ---------------- */

export const MAX_QTY = 99;
export const MAX_UNITS = 99;
export const MAX_LINES = 40;

/** A whole quantity 1–99, absent = 1; anything else 0 (refused). */
export function qtyOf(q: unknown): number {
  if (q === undefined || q === null) return 1;
  if (typeof q === "number") return Number.isInteger(q) && q >= 1 && q <= MAX_QTY ? q : 0;
  if (typeof q === "string" && /^\s*\d{1,2}\s*$/.test(q)) {
    const n = parseInt(q, 10);
    return n >= 1 ? n : 0;
  }
  return 0;
}

/** null when the basket's shape is fine; else the refusal. No items at all is "incomplete" (later). */
export function basketRefusal(items: unknown): IntakeRefusal | null {
  if (!Array.isArray(items)) return null;
  if (items.length > MAX_LINES) return { error: "too_many" };
  let units = 0;
  for (const i of items) {
    if (!i || typeof i !== "object" || Array.isArray(i)) return { error: "unknown_item", item: null };
    const q = qtyOf((i as Record<string, unknown>).qty);
    if (!q) return { error: "bad_qty" };
    units += q;
  }
  if (units > MAX_UNITS) return { error: "too_many" };
  return null;
}

/* ---------------- the page's own signals ---------------- */

/**
 * A click id is never tidied (Meta: case sensitive, no documented maximum — a clipped fbc
 * is worse than none), so an over-long one is dropped, not cut.
 */
function clickId(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s && s.length <= 1000 && !/[\s<>"']/.test(s) ? s : "";
}

/** What the server-side Purchase needs from the page (posted as `snap`, its original name). */
export function signalsOf(o: Record<string, unknown>): ClientSignals {
  const src = (o.signals && typeof o.signals === "object" ? o.signals : o.snap && typeof o.snap === "object" ? o.snap : {}) as Record<string, unknown>;
  const out: ClientSignals = {};
  const fbp = clickId(src.fbp);
  const fbc = clickId(src.fbc);
  if (fbp) out.fbp = fbp;
  if (fbc) out.fbc = fbc;
  for (const k of ["scid", "sccid", "gcid", "gsid", "vid"] as const) {
    const v = str(src[k], 128);
    if (v && !/[\s<>"']/.test(v)) out[k] = v;
  }
  return out;
}

/** The landing the page reports, as plain data: strings capped, at most three levels, 30 keys each. */
function plain(v: unknown, depth: number): unknown {
  if (typeof v === "string") return v.slice(0, 500);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (!v || typeof v !== "object" || Array.isArray(v) || depth > 3) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).slice(0, 30)) {
    const x = plain((v as Record<string, unknown>)[k], depth + 1);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

export function refOf(v: unknown): RefInput | null {
  const r = plain(v, 1);
  return r && typeof r === "object" ? (r as RefInput) : null;
}

/* ---------------- the intake ---------------- */

/**
 * The fields both tills take. "incomplete" (no name, no phone with seven digits, no items) is
 * answered first, then the basket's shape.
 */
export function parseIntake(body: unknown): { intake: Intake } | { refusal: IntakeRefusal } {
  const o = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const refusal = basketRefusal(o.items);
  const rawItems = Array.isArray(o.items) ? o.items : [];
  const name = text(o.name, 120);
  const ph = phone(o.phone, 40);
  if (!name || !ph || !rawItems.length || !phoneLike(ph)) return { refusal: { error: "incomplete" } };
  if (refusal) return { refusal };
  const items = rawItems.map((i) => {
    const line = i as Record<string, unknown>;
    return { itemId: str(line.itemId, 80), qty: qtyOf(line.qty) };
  });
  const proposed = str(o.id, 20);
  return {
    intake: {
      name,
      phone: ph,
      email: email(o.email),
      items,
      countryCode: str(o.countryCode, 4).toUpperCase(),
      city: text(o.city, 80),
      region: text(o.region, 120),
      note: text(o.note, 500),
      dedupeId: str(o.dedupeId, 64) || null,
      proposedId: isOrderId(proposed) ? proposed : null,
      pageUrl: pageUrl(o.pageUrl) || null,
      lang: o.lang === "en" ? "en" : "ar",
      ref: refOf(o.ref),
      signals: signalsOf(o),
    },
  };
}
