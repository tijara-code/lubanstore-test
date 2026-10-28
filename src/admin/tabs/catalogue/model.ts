/**
 * THE CATALOGUE EDITOR'S RULES — pure functions over a draft of the catalogue, so the tab, its
 * tests and the publish all read one set of rules (ports of the original panel's fillOfferIn /
 * harvest / fillCommon / fillFreeShip / fillTiers arithmetic, test-offer-admin).
 *
 * The tab edits a DRAFT: the merged catalogue the server served (GET /catalogue `data`), with
 * a few things made explicit so the form can show them (each market owns its sizes, scents and
 * add-ons; the offers' market lists are the ticked codes). `toPublish(draft)` turns it back
 * into what is sent: code-owned fields (OMR rates, drawings, countsFree) and the operational
 * keys (routes, ledger) left out, "every market ticked" stored as [] (= every market, so a
 * market added later is not silently excluded), the shared lists rebuilt from the first market.
 *
 * Times are Muscat time where the shop reads them (the anchor box, the free-delivery days); the
 * clocks take `now` as an argument.
 */
import { CODE_OWNED } from "../../../shared/catalogue/merge";
import type { Catalogue, Country, Extra, FreeShipRow, Offer, Scent, Size, Tiers } from "../../../shared/catalogue/types";

/* the server's own checks (shared/admin/schemas.ts CAT_ID_RE, HEX_RE), restated here so the
   panel's bundle does not carry zod; tests/web/admin/catalogue keeps the two in step */
export const CAT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

export type Draft = Catalogue;
export const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

/* ---------------- numbers, as a person types them ---------------- */

/** Arabic-Indic and Persian digits, the Arabic decimal mark and comma → plain ASCII. */
export function asciiDigits(s: string): string {
  return String(s ?? "")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".")
    .replace(/[٬\s]/g, "");
}

export interface NumRule {
  min?: number;
  max?: number;
  int?: boolean;
  /** "" is allowed and means null (no value: "no end", "unset") */
  blank?: boolean;
  /** decimals allowed (3 for money) */
  dec?: number;
}

/** A typed number: { value } when it reads, { error } in words when it does not. "" → null if allowed, else 0. */
export function readNum(text: string, rule: NumRule = {}): { value: number | null; error?: string } {
  const s = asciiDigits(text).trim();
  if (s === "") return rule.blank ? { value: null } : { value: 0 };
  if (!/^-?\d*\.?\d*$/.test(s) || s === "." || s === "-") return { value: null, error: "Not a number" };
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, error: "Not a number" };
  const min = rule.min ?? 0;
  if (n < min) return { value: null, error: min === 0 ? "Cannot be negative" : "At least " + min };
  if (rule.max !== undefined && n > rule.max) return { value: null, error: "At most " + rule.max };
  if (rule.int && Math.round(n) !== n) return { value: null, error: "A whole number" };
  const dec = rule.dec ?? 3;
  const frac = s.indexOf(".") > -1 ? s.split(".")[1]!.replace(/0+$/, "").length : 0;
  if (!rule.int && frac > dec) return { value: null, error: "At most " + dec + " decimals" };
  return { value: n };
}

/** How a stored number is shown in its box. */
export const numText = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : String(v));

/* ---------------- a market's own lists ---------------- */

export function sizesOf(c: Country, d: Draft): Size[] {
  return Array.isArray(c.sizes) && c.sizes.length ? c.sizes : clone(d.sizes || []);
}
export function scentsOf(c: Country, d: Draft): Scent[] {
  return Array.isArray(c.scents) && c.scents.length ? c.scents : clone(d.scents || []);
}
export function extrasOf(c: Country, d: Draft): Extra[] {
  return Array.isArray(c.extras) && c.extras.length ? c.extras : clone(d.extras || []);
}

/* ---------------- the draft ---------------- */

const codesOf = (d: Draft) => (d.countries || []).map((c) => c.code).filter(Boolean);

/**
 * The served catalogue as the form edits it: every market owns its lists (a market on the
 * shared list starts from a copy, as the original's first save made it); the offers' market
 * lists are explicit ticks ([] = every market); the free-delivery rows exist for every market.
 */
export function toDraft(data: Catalogue): Draft {
  const d = clone(data);
  d.countries = d.countries || [];
  d.sizes = d.sizes || [];
  d.scents = d.scents || [];
  for (const c of d.countries) {
    c.sizes = sizesOf(c, d);
    c.scents = scentsOf(c, d);
    c.extras = extrasOf(c, d);
    c.prices = c.prices || {};
  }
  const all = codesOf(d);
  const o: Offer = (d.offer = d.offer || { id: "bundle", active: true, name: "", note: "", badge: "", hours: 72 });
  o.countries = Array.isArray(o.countries) && o.countries.length ? o.countries.filter((x) => all.indexOf(x) > -1) : all.slice();
  o.freeShipIn = Array.isArray(o.freeShipIn) && o.freeShipIn.length ? o.freeShipIn.filter((x) => all.indexOf(x) > -1) : all.slice();
  if (o.hours == null) o.hours = 72;
  const t: Tiers = (d.tiers = d.tiers || { active: false, sizeId: "large", countries: [] });
  t.countries = Array.isArray(t.countries) && t.countries.length ? t.countries.filter((x) => all.indexOf(x) > -1) : all.slice();
  d.freeShip = d.freeShip || { active: true, countries: {} };
  d.freeShip.countries = d.freeShip.countries || {};
  return d;
}

/** One draft against another: the same catalogue? (the unsaved-changes test) */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}
export const sameDraft = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** The draft as the publish carries it. Never a code-owned field, never a route. */
export function toPublish(draft: Draft): Catalogue {
  const d = clone(draft) as Catalogue & Record<string, unknown>;
  const all = codesOf(d);
  const stripList = (list: Array<Record<string, unknown>> | undefined, fields: readonly string[]) => (list || []).forEach((x) => fields.forEach((k) => delete x[k]));
  for (const c of d.countries) {
    CODE_OWNED.country.forEach((k) => delete (c as Record<string, unknown>)[k]);
    delete c.courier;
    stripList(c.scents as never, CODE_OWNED.scent);
    stripList(c.extras as never, CODE_OWNED.extra);
    // rows a person cleared stay out (price 0 is a price; the free rows below)
  }
  // the shared lists: the fallback a new market starts from, rebuilt from the first market
  const first = d.countries[0];
  if (first) {
    d.sizes = clone(first.sizes || d.sizes || []);
    d.scents = clone(first.scents || d.scents || []);
    d.extras = clone(first.extras || d.extras || []);
  }
  stripList(d.scents as never, CODE_OWNED.scent);
  stripList(d.extras as never, CODE_OWNED.extra);
  delete d.courier;
  delete d.ledger;
  delete d.version;
  delete d.offer2;
  delete d.__publishedVersion;
  const every = (list: string[] | undefined) => {
    const l = (list || []).filter((x) => all.indexOf(x) > -1);
    return all.every((x) => l.indexOf(x) > -1) ? [] : l;
  };
  if (d.offer) {
    const o = d.offer;
    o.id = o.id || "bundle";
    if (!o.sizeId) o.sizeId = "small";
    delete o.repeat;
    o.countries = every(o.countries);
    const picked = (o.freeShipIn || []).filter((x) => all.indexOf(x) > -1);
    o.freeShipIn = every(o.freeShipIn);
    // none ticked is the switch off (v410)
    if (!picked.length) o.freeShip = false;
  }
  if (d.tiers) {
    d.tiers.countries = every(d.tiers.countries);
    delete d.tiers.startsAt;
    delete d.tiers.endsAt;
  }
  if (d.freeShip && d.freeShip.countries) {
    const out: Record<string, FreeShipRow> = {};
    for (const code of Object.keys(d.freeShip.countries)) {
      const r = d.freeShip.countries[code]!;
      const has = (v: unknown) => v !== null && v !== undefined && v !== "";
      if (r.on || has(r.over) || has(r.days) || r.restart) {
        const row: FreeShipRow = { on: !!r.on };
        if (has(r.over)) row.over = Number(r.over);
        if (has(r.days)) row.days = Number(r.days);
        if (r.from && !r.restart) row.from = r.from;
        if (r.restart) row.restart = true;
        out[code] = row;
      }
    }
    d.freeShip.countries = out;
  }
  return d;
}

/* ---------------- what the form refuses before it sends ---------------- */

/** Every reason the draft cannot be published, in words (the first is the toast). */
export function problemsOf(d: Draft): string[] {
  const out: string[] = [];
  const seen: Record<string, true> = {};
  for (const c of d.countries || []) {
    const who = c.code || "a market";
    if (!/^[A-Z]{2}$/.test(String(c.code || ""))) out.push("Invalid country code. Use two letters, e.g. AE.");
    if (seen[c.code]) out.push(who + " is in the list twice.");
    seen[c.code] = true;
    if (!/^[A-Z]{3}$/.test(String(c.cur || ""))) out.push(who + ": the currency is three capital letters (AED).");
    if (!/^\d{1,4}$/.test(String(c.dial || ""))) out.push(who + ": the dial code is digits only (971).");
    const lists: Array<[string, Array<{ id: string; tagColor?: unknown; accent?: unknown }>]> = [
      ["size", c.sizes || []],
      ["scent", c.scents || []],
      ["add-on", c.extras || []],
    ];
    for (const [kind, list] of lists) {
      const ids: Record<string, true> = {};
      for (const x of list) {
        if (!CAT_ID_RE.test(String(x.id || ""))) out.push(who + ": a " + kind + " ID can use letters, digits, - and _ only (" + (x.id || "empty") + ").");
        else if (ids[x.id]) out.push(who + ": two " + kind + "s share the ID " + x.id + ".");
        ids[x.id] = true;
        for (const k of ["tagColor", "accent"] as const) {
          const v = x[k];
          if (v !== undefined && v !== "" && !HEX_RE.test(String(v))) out.push(who + ": " + x.id + " has a colour that is not a hex colour.");
        }
      }
    }
  }
  const o = d.offer || {};
  const s = Date.parse(String(o.startsAt || ""));
  const e = Date.parse(String(o.endsAt || ""));
  if (Number.isFinite(s) && Number.isFinite(e) && e <= s) out.push("Small bundle: end is before start. Fix the dates.");
  // [] is EVERY market, so unticking all six would have published the set everywhere
  if (o.active !== false && (d.countries || []).length && !(o.countries || []).some((x) => codesOf(d).indexOf(x) > -1)) {
    out.push("Small bundle: tick at least one market, or switch the small bundle off");
  }
  const t = d.tiers || {};
  if (t.active !== false && (d.countries || []).length && !(t.countries || []).some((x) => codesOf(d).indexOf(x) > -1)) {
    out.push("Large bundle offer: tick at least one market, or switch the offers off");
  }
  return out;
}

/* ---------------- Muscat time ---------------- */

const MUSCAT = 4 * 3600e3;
const pad = (n: number) => (n < 10 ? "0" : "") + n;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-12 11:42 (Muscat)" — the anchor, readable; "" when none */
export function anchorText(iso: unknown): string {
  const a = String(iso || "").trim();
  if (!a) return "";
  const t = Date.parse(a.indexOf("T") > -1 ? a : a + "T00:00:00+04:00");
  if (!Number.isFinite(t)) return a;
  const d = new Date(t + MUSCAT);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " (Muscat)";
}
/** "25 Sep 00:00" in Muscat time */
export function muscatText(iso: unknown): string {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + MUSCAT);
  return d.getUTCDate() + " " + MON[d.getUTCMonth()] + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
}
/** a stored instant → its Muscat day ("2026-09-25") */
export function muscatDayOf(iso: unknown): string {
  const t = Date.parse(String(iso || ""));
  return Number.isFinite(t) ? new Date(t + MUSCAT).toISOString().slice(0, 10) : "";
}

/* ---------------- window lengths: stored in hours, typed in either unit ---------------- */

/** What the box shows for a stored length: days → round(hours / 24), at least 1; default 72 h. */
export function lenShown(hours: unknown, unit: unknown, fallback = 72): number {
  const h = Number(hours) || fallback;
  return unit === "days" ? Math.max(1, Math.round(h / 24)) : h;
}
/** The number typed, in the unit chosen → hours (5 days → 120). Nothing typed → 72 h / 3 days. */
export function hoursOf(n: number | null, unit: unknown): number {
  const v = n && n > 0 ? Math.round(n) : unit === "days" ? 3 : 72;
  return unit === "days" ? v * 24 : v;
}
/** Flipping the unit converts the number in the box, so the window never moves (72 h ⇄ 3 d). */
export function convertLen(n: number, toUnit: string): number {
  const v = Number(n) || 0;
  return toUnit === "days" ? Math.max(1, Math.round(v / 24) || 1) : Math.max(1, Math.round(v * 24));
}

/* ---------------- the small bundle's clock (store.js / price.js arithmetic) ---------------- */

/** How long the current window has to run: "5 h 07 min", "3 d 4 h"; "" for no window or a finished one. */
export function offerEndsIn(o: Offer, now: number): string {
  const h = Number(o.hours) || 0;
  if (!(h > 0)) return "";
  const len = h * 3600e3;
  const a = String(o.anchor || "").trim();
  let anchor = a ? Date.parse(a.indexOf("T") > -1 ? a : a + "T00:00:00+04:00") : Date.parse("2026-01-01T00:00:00+04:00");
  if (!Number.isFinite(anchor)) anchor = Date.parse("2026-01-01T00:00:00+04:00");
  const s0 = Date.parse(String(o.startsAt || ""));
  if (Number.isFinite(s0) && s0 > anchor) anchor = s0;
  let end = o.renew === "once" ? anchor + len - 1 : anchor + Math.max(1, Math.floor((now - anchor) / len) + 1) * len - 1;
  const e0 = Date.parse(String(o.endsAt || ""));
  if (Number.isFinite(e0) && e0 < end) end = e0;
  const ms = end - now;
  if (ms <= 0) return "";
  const hrs = Math.floor(ms / 3600e3);
  const min = Math.floor(ms / 60e3) % 60;
  if (hrs >= 48) return Math.floor(hrs / 24) + " d " + (hrs % 24) + " h";
  return hrs + " h " + pad(min) + " min";
}

/* ---------------- the stock grid (every market at once) ---------------- */

export function allScents(d: Draft): Array<{ id: string; name: string }> {
  const seen: Record<string, true> = {};
  const out: Array<{ id: string; name: string }> = [];
  for (const c of d.countries || []) for (const s of scentsOf(c, d)) if (s && s.id && !seen[s.id]) (seen[s.id] = true), out.push({ id: s.id, name: s.name || s.id });
  return out;
}
export function allSizes(d: Draft): Array<{ id: string; name: string }> {
  const seen: Record<string, true> = {};
  const out: Array<{ id: string; name: string }> = [];
  for (const c of d.countries || []) for (const z of sizesOf(c, d)) if (z && z.id && !seen[z.id]) (seen[z.id] = true), out.push({ id: z.id, name: z.name || z.id });
  return out;
}

export function scentSizeOut(s: Scent | undefined, sizeId: string): boolean {
  if (!s) return false;
  if (s.soldOut === true || s.soldOut === "true") return true;
  return (Array.isArray(s.soldOutSizes) ? s.soldOutSizes : []).indexOf(sizeId) > -1;
}

/** One scent in one size across the markets that carry it: out everywhere? out where? */
export function scentStock(d: Draft, id: string, sizeId: string): { all: boolean; some: string; note: string } {
  let carry = 0;
  const out: string[] = [];
  for (const c of d.countries || []) {
    const s = scentsOf(c, d).find((x) => x.id === id);
    if (!s) continue;
    carry++;
    if (scentSizeOut(s, sizeId)) out.push(c.code);
  }
  return { all: carry > 0 && out.length === carry, some: out.join(", "), note: out.length ? "Sold out in " + out.join(", ") : "In stock everywhere" };
}

/**
 * One scent in one size, sold out (or back) in EVERY market that carries it. Out of every size
 * is the plain `soldOut` flag; putting one size back when the scent was out altogether keeps
 * the others out, size by size. Mutates the draft.
 */
export function setScentEverywhere(d: Draft, id: string, sizeId: string, soldOut: boolean): void {
  const sizes = allSizes(d);
  const apply = (s: Scent) => {
    if (s.id !== id) return;
    const list = Array.isArray(s.soldOutSizes) ? s.soldOutSizes.slice() : [];
    const at = list.indexOf(sizeId);
    if (soldOut) {
      if (at < 0) list.push(sizeId);
    } else {
      if (at > -1) list.splice(at, 1);
      if (s.soldOut === true || s.soldOut === "true") {
        s.soldOut = false;
        for (const z of sizes) if (z.id !== sizeId && list.indexOf(z.id) < 0) list.push(z.id);
      }
    }
    s.soldOutSizes = list;
    s.soldOut = sizes.length > 0 && sizes.every((z) => list.indexOf(z.id) > -1);
  };
  for (const c of d.countries || []) {
    if (!(Array.isArray(c.scents) && c.scents.length)) c.scents = clone(d.scents || []);
    c.scents.forEach(apply);
  }
  (d.scents || []).forEach(apply);
}

/** "2 sold out everywhere" / "all in stock" — the Common section's stamp. */
export function commonStamp(d: Draft): string {
  let n = 0;
  for (const s of allScents(d)) for (const z of allSizes(d)) if (scentStock(d, s.id, z.id).all) n++;
  return n ? n + " sold out everywhere" : "all in stock";
}

/** "Sold out here" on a scent row: ticking is every size here; unticking puts every size back (the grid's included). */
export function setScentOutHere(s: Scent, out: boolean): void {
  const was = s.soldOut === true || s.soldOut === "true";
  s.soldOut = out;
  if (!out && was) delete s.soldOutSizes;
}

/* ---------------- why the bundle is not showing (offerWhyHidden) ---------------- */

export function offerWhyHidden(o: Offer, d: Draft, now: number, id = "bundle"): string {
  if (o.active === false) return "the switch above is off";
  const s0 = Date.parse(String(o.startsAt || ""));
  const e0 = Date.parse(String(o.endsAt || ""));
  if (Number.isFinite(s0) && now < s0) return "scheduled: starts " + muscatText(o.startsAt) + " (Muscat)";
  if (Number.isFinite(e0) && now > e0) return "its end date, " + muscatText(o.endsAt) + ", has passed";
  const all = codesOf(d);
  // the draft's list is the ticked markets; every market ticked = everywhere
  const list = Array.isArray(o.countries) ? o.countries.filter((x) => all.indexOf(x) > -1) : [];
  const every = !list.length && Array.isArray(o.countries) && o.countries.length === 0 ? true : all.every((x) => list.indexOf(x) > -1);
  if (!all.length) return "no markets in the catalogue yet";
  if (!every && !list.length) return "no market is ticked";
  if (Number(o.hours) > 0 && !offerEndsIn(o, now)) return o.renew === "once" ? "ended (one-shot). Press Reset and save to run again" : "the window has closed";
  const want = String(o.sizeId || (id === "bundle2" ? "large" : "small"));
  const bad = allScents(d).filter((s) => scentStock(d, s.id, want).all).map((s) => s.name);
  if (bad.length) {
    const box = allSizes(d).find((z) => z.id === want);
    return bad.join(" and ") + " sold out in the " + (box ? box.name : want) + " box, which is what the bundle is packed from";
  }
  const priced = (d.countries || []).filter((c) => Number(((c.prices || {})[id] || { now: 0 }).now) > 0 && (every || list.indexOf(c.code) > -1));
  if (!priced.length) return "no market it is offered in has a " + (id === "bundle2" ? "large bundle" : "bundle") + " price";
  return "";
}

/** The Small bundle card's heading line, and how it should look. */
export function offerStamp(o: Offer, d: Draft, now: number): { text: string; tone: "" | "warn" | "info" } {
  const on = o.active !== false;
  const why = offerWhyHidden(o, d, now);
  const left = on ? offerEndsIn(o, now) : "";
  const sched = on && /^scheduled/.test(why);
  if (sched) return { text: why, tone: "info" };
  if (why) return { text: "not showing: " + why, tone: "warn" };
  return { text: left ? "on · window closes in " + left + (o.endsAt ? " · ends " + muscatText(o.endsAt) : "") : "on · no window", tone: "" };
}

/* ---------------- the large-box offers' clock (tiers) ---------------- */

export function tiersEnd(t: Tiers, now: number): number | null {
  if (!t || (Number(t.hours) > 0 && !String(t.anchor || "").trim())) return null;
  const len = (Number(t.hours) || 0) * 3600e3;
  const a = Date.parse(String(t.anchor || ""));
  const fixed = Date.parse(String(t.endsAt || ""));
  let end: number | null = null;
  if (len && Number.isFinite(a)) end = t.renew === "once" ? a + len - 1 : a + Math.max(1, Math.floor((now - a) / len) + 1) * len - 1;
  if (Number.isFinite(fixed) && (end === null || fixed < end)) end = fixed;
  return end;
}
export function tiersState(t: Tiers | undefined, now: number): string {
  if (!t || t.active === false) return "Off";
  if (Number(t.hours) > 0 && !String(t.anchor || "").trim()) return "Starts when you publish";
  const e = tiersEnd(t, now);
  if (e !== null && e < now) return "Ended " + muscatText(new Date(e).toISOString());
  return e !== null ? "On · ends " + muscatText(new Date(e).toISOString()) : "On · no end";
}

/* ---------------- the free-delivery offer per market ---------------- */

/** The last instant of a row's run (midnight Muscat on its last day); null = no end; NaN = not started. */
export function fsEnd(row: FreeShipRow | undefined): number | null {
  const days = Math.round(Number(row && row.days));
  if (!(days > 0)) return null;
  const from = Date.parse(String((row && row.from) || ""));
  if (!Number.isFinite(from)) return NaN;
  const day0 = Math.floor((from + MUSCAT) / 86400e3) * 86400e3 - MUSCAT;
  return day0 + days * 86400e3 - 1;
}
export function fsDaysLeft(end: number, now: number): number {
  const dn = (t: number) => Math.floor((t + MUSCAT) / 86400e3);
  return dn(end) - dn(now) + 1;
}
export type FsState = "off" | "unset" | "pending" | "ended" | "live";
export function fsState(row: FreeShipRow | undefined, now: number): FsState {
  if (!row || !row.on) return "off";
  const over = Number(row.over);
  if (row.over === "" || row.over == null || !Number.isFinite(over) || over < 0) return "unset";
  if (row.restart) return "pending";
  const end = fsEnd(row);
  if (end !== null && Number.isNaN(end)) return "pending";
  if (end !== null && now > end) return "ended";
  return "live";
}
export function fsWords(row: FreeShipRow | undefined, now: number): { st: FsState; pill: string; sub: string } {
  const st = fsState(row, now);
  const end = fsEnd(row);
  const day = (t: number) => muscatText(new Date(t).toISOString()).replace(/ \d\d:\d\d$/, "");
  if (st === "live" && end) {
    const n = fsDaysLeft(end, now);
    return { st, pill: n <= 1 ? "Ends today" : n + " days left", sub: "until " + day(end) };
  }
  const pill = { off: "Off", unset: "Set an amount", pending: "Starts on publish", ended: "Ended", live: "Live" }[st];
  return { st, pill, sub: st === "live" ? "no end date" : st === "ended" && end ? "ended " + day(end) : "" };
}
/** The card's heading: "off", "live in OM, AE", "not running". */
export function fsStamp(d: Draft, now: number): string {
  const fs = d.freeShip || {};
  if (fs.active === false) return "off";
  const live = (d.countries || []).filter((c) => fsState((fs.countries || {})[c.code], now) === "live").map((c) => c.code);
  return live.length ? "live in " + live.join(", ") : "not running";
}

/* ---------------- sizes this market no longer has ---------------- */

/**
 * A size this market used to carry (in the catalogue as it was loaded, the shared list, or
 * another market) and no longer does: one tap puts it back with the price it had (a removed
 * size's price is kept). Placeholder ids ("size-3") are never offered.
 */
export function missingSizes(c: Country, d: Draft, loaded: Catalogue | null): Size[] {
  const have: Record<string, true> = {};
  for (const z of c.sizes || []) if (z && z.id) have[z.id] = true;
  if (!Array.isArray(c.sizes) || !c.sizes.length) return [];
  const own = loaded ? (loaded.countries || []).find((x) => x.code === c.code) : undefined;
  let pool: Size[] = [...((own && own.sizes) || []), ...((loaded && loaded.sizes) || []), ...(d.sizes || [])];
  for (const o of d.countries || []) if (o !== c && o.code !== c.code) pool = pool.concat(Array.isArray(o.sizes) ? o.sizes : []);
  const seen: Record<string, true> = {};
  const out: Size[] = [];
  for (const z of pool) {
    if (!z || !z.id || have[z.id] || seen[z.id] || /^size-\d+$/.test(z.id)) continue;
    seen[z.id] = true;
    out.push(z);
  }
  return out;
}
/** Put a missing size back (mutates the market). → the size, or null */
export function restoreSize(c: Country, d: Draft, loaded: Catalogue | null, id: string): Size | null {
  const def = missingSizes(c, d, loaded).find((z) => z.id === id);
  if (!def) return null;
  const back = clone(def);
  back.soldOut = false;
  delete back.hidden;
  delete back.open;
  c.sizes = c.sizes || [];
  c.sizes.push(back);
  c.prices = c.prices || {};
  if (!c.prices[id]) c.prices[id] = { now: 0, was: 0 };
  return back;
}

/* ---------------- adding rows ---------------- */

export const newSize = (c: Country): Size => ({ id: "size-" + ((c.sizes || []).length + 1), name: "New size", weight: "", tag: "", tagColor: "#9c464c", soldOut: false });
/** switched off to begin with: an unpriced add-on would be refused by the till */
export const newExtra = (c: Country): Extra => ({ id: "extra-" + ((c.extras || []).length + 1), name: "New add-on", note: "", img: "", once: true, active: false });
export const newScent = (c: Country): Scent => ({ id: "scent-" + ((c.scents || []).length + 1), name: "New scent", notes: "", accent: "#b8974f", tag: "", tagColor: "#9c464c", stars: 0, soldOut: false });

/** A new market starts from the first market's products at zero (not empty). */
export function newCountry(d: Draft, code: string): Country {
  const tpl = d.countries[0] || ({} as Country);
  const prices: Record<string, { now: number; was: number }> = {};
  for (const z of tpl.sizes || d.sizes || []) prices[z.id] = { now: 0, was: 0 };
  return {
    code,
    flag: "",
    name: "New country",
    name_en: "",
    cur: "AED",
    dial: "",
    dec: 0,
    ship: 0,
    freeOver: 0,
    cod: 0,
    prices,
    sizes: clone(tpl.sizes || d.sizes || []),
    scents: clone(tpl.scents || d.scents || []),
    extras: clone(tpl.extras || d.extras || []).map((x) => ({ ...x, active: false })),
  };
}

/** Add a market to the draft; the offers that ran everywhere run there too. → an error in words, or "" */
export function addCountry(d: Draft, codeIn: string): string {
  const code = String(codeIn || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "Invalid code. Two letters only.";
  if ((d.countries || []).some((x) => x.code === code)) return "That country already exists";
  const before = codesOf(d);
  const everywhere = (l: string[] | undefined) => before.length > 0 && before.every((x) => (l || []).indexOf(x) > -1);
  const o = d.offer;
  const t = d.tiers;
  const addO = o && everywhere(o.countries);
  const addF = o && everywhere(o.freeShipIn);
  const addT = t && everywhere(t.countries);
  d.countries.push(newCountry(d, code));
  if (o && addO) o.countries = [...(o.countries || []), code];
  if (o && addF) o.freeShipIn = [...(o.freeShipIn || []), code];
  if (t && addT) t.countries = [...(t.countries || []), code];
  return "";
}

/** "6 markets · 1 unpriced size" — the one thing that silently stops an order is a missing price. */
export function marketsStamp(d: Draft): { text: string; warn: boolean } {
  const n = (d.countries || []).length;
  let unpriced = 0;
  for (const c of d.countries || []) {
    for (const z of c.sizes || []) {
      const p = (c.prices || {})[z.id];
      if (!(Number(p && p.now) > 0) && z.soldOut !== true && z.hidden !== true) unpriced++;
    }
  }
  return { text: n + (n === 1 ? " market" : " markets") + (unpriced ? " · " + unpriced + " unpriced " + (unpriced === 1 ? "size" : "sizes") : ""), warn: unpriced > 0 };
}

/** Renaming a size's ID carries its price with it (unless another size already uses the old one). */
export function renameSizeId(c: Country, index: number, next: string): void {
  const z = (c.sizes || [])[index];
  if (!z) return;
  const old = z.id;
  z.id = next;
  const prices = (c.prices = c.prices || {});
  const stillUsed = (c.sizes || []).some((x, i) => i !== index && x.id === old);
  if (old && old !== next && prices[old] && !prices[next]) {
    prices[next] = prices[old]!;
    if (!stillUsed) delete prices[old];
  }
}
/** The same for an add-on (priced by its own id). */
export function renameExtraId(c: Country, index: number, next: string): void {
  const x = (c.extras || [])[index];
  if (!x) return;
  const old = x.id;
  x.id = next;
  const prices = (c.prices = c.prices || {});
  const stillUsed = (c.extras || []).some((e, i) => i !== index && e.id === old);
  if (old && old !== next && prices[old] && !prices[next]) {
    prices[next] = prices[old]!;
    if (!stillUsed) delete prices[old];
  }
}

/* ---------------- the Stock Tracker's switches ---------------- */

const STOCK_KEYS = ["stockLive", "stockCap", "stockHide"] as const;
/** Two stored catalogues the same apart from the Stock Tracker's switches? (a switch's answer may be adopted) */
export function sameButStock(a: Catalogue | null | undefined, b: Catalogue | null | undefined): boolean {
  const strip = (x: Catalogue | null | undefined) => {
    if (!x) return null;
    const y = clone(x) as Record<string, unknown>;
    for (const k of STOCK_KEYS) delete y[k];
    delete y.version;
    // routes are set on the Empower tab and never conflict with this tab
    delete y.courier;
    for (const c of (y.countries as Country[]) || []) delete c.courier;
    return y;
  };
  return sameDraft(strip(a), strip(b));
}
/** Copy the switches of `from` into `to` (mutates `to`). */
export function copyStock(to: Catalogue, from: Catalogue): void {
  for (const k of STOCK_KEYS) {
    if (from[k] === undefined) delete to[k];
    else to[k] = clone(from[k]) as never;
  }
}
