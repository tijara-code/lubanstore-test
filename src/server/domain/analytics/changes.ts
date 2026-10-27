/**
 * CHANGES ON THE STOREFRONT — what a catalogue publish changed, in words, read against the orders
 * before and after it (port of the original changelog.js describeChange + changes.list).
 *
 * EVERYTHING THE CATALOGUE TAB EDITS, AND NOTHING ELSE: prices, was-prices, names, badges, the
 * COD fee and switch, sizes/scents/add-ons on, off, sold out, hidden, the bundle's switch,
 * window and schedule, the free-delivery offer, the shelf switches ("<id> hide at 0 on") — and a
 * catch-all so a field added to the tab later still leaves a line ("catalogue edited"). Not the
 * courier routes (Empower tab), the ledger or the panel-only settings: those are not storefront
 * changes. One change made in every market is one line ("all markets: …").
 */
import { asc, desc, eq, gte } from "drizzle-orm";
import { isLive } from "../../../shared/kpi";
import { GULF_MS } from "../../../shared/time";
import type { Deps } from "../../core/deps";
import { catalogueChanges, orders } from "../../db/schema";

type Obj = Record<string, any>;

const CAT_COUNTRY_SKIP: Record<string, 1> = { code: 1, courier: 1, toOmr: 1, prices: 1, sizes: 1, scents: 1, extras: 1 };
const CAT_ITEM_SKIP: Record<string, 1> = { id: 1, art: 1 };
const WORD: Record<string, string> = {
  name: "renamed", notes: "notes edited", note: "note edited", tag: "badge",
  name_en: "English name", notes_en: "English notes", note_en: "English note",
  tag_en: "English badge", weight_en: "English weight", badge_en: "English badge",
  tagColor: "badge colour", weight: "weight", stars: "rating", accent: "colour",
  img: "picture", once: "once-only", flag: "flag", dial: "dial code",
  cur: "currency", dec: "decimals", badge: "badge", term: "label",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_SAID = 12;

const J = (v: unknown) => JSON.stringify(v === undefined ? null : v);
const same = (a: unknown, b: unknown) => J(a) === J(b);
const on = (v: unknown) => v === true || v === "true";
const byId = (list: unknown): Obj => {
  const m: Obj = {};
  for (const x of Array.isArray(list) ? list : []) if (x && x.id != null) m[x.id] = x;
  return m;
};
/** a moment in Muscat's words: "25 Sep 00:00" */
const t = (iso: unknown) => {
  const n = Date.parse(String(iso || ""));
  if (!Number.isFinite(n)) return "";
  const d = new Date(n + GULF_MS);
  const p = (x: number) => (x < 10 ? "0" : "") + x;
  return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
};

/** The part of the catalogue the Catalogue tab owns (for the catch-all). */
export function catalogueOnly(c: Obj | null | undefined): Obj | null {
  if (!c) return null;
  return {
    countries: (c.countries || []).map((x: Obj) => { const o = { ...x }; delete o.courier; delete o.toOmr; return o; }),
    offer: c.offer || null,
    freeShip: c.freeShip || null,
    sizes: c.sizes || null, scents: c.scents || null, extras: c.extras || null,
  };
}

/**
 * old → new catalogue → the change lines, grouped ("all markets: …", "AE/OM …"), every one.
 * [] when nothing on the storefront changed; ["catalogue published for the first time"] when
 * there was nothing before.
 */
export function catalogueChangeLines(was: Obj | null | undefined, now: Obj | null | undefined): string[] {
  if (!now) return [];
  if (!was || !Array.isArray(was.countries)) return ["catalogue published for the first time"];
  const bits: string[] = [];

  const items = (who: string, kind: string, a: unknown, b: unknown) => {
    const A = byId(a), B = byId(b);
    for (const id of Object.keys(B)) {
      const x = A[id], y = B[id];
      if (!x) { bits.push(who + kind + " " + id + " added"); continue; }
      if (on(x.soldOut) !== on(y.soldOut)) bits.push(who + id + (on(y.soldOut) ? " sold out" : " back in stock"));
      if ((x.active !== false) !== (y.active !== false)) bits.push(who + id + (y.active !== false ? " on" : " off"));
      if (on(x.hidden) !== on(y.hidden)) bits.push(who + id + (on(y.hidden) ? " hidden" : " shown again"));
      if (on(x.open) !== on(y.open)) bits.push(who + id + (on(y.open) ? " kept open" : " folds again"));
      if (!same(x.soldOutSizes || [], y.soldOutSizes || [])) {
        const xs: unknown[] = x.soldOutSizes || [], ys: unknown[] = y.soldOutSizes || [];
        ys.filter((z) => xs.indexOf(z) < 0).forEach((z) => bits.push(who + id + " " + z + " sold out"));
        xs.filter((z) => ys.indexOf(z) < 0).forEach((z) => bits.push(who + id + " " + z + " back in stock"));
      }
      for (const k of Object.keys({ ...x, ...y })) {
        if (CAT_ITEM_SKIP[k] || k === "soldOut" || k === "active" || k === "soldOutSizes" || k === "hidden" || k === "open") continue;
        if (same(x[k], y[k])) continue;
        if (k === "name") bits.push(who + id + " renamed " + J(y.name).replace(/"/g, ""));
        else if (k === "stars") bits.push(who + id + " rating " + (Number(y.stars) || 0) + "/5");
        else bits.push(who + id + " " + (WORD[k] || k) + (k === "tag" ? (y.tag ? " “" + y.tag + "”" : " removed") : " changed"));
      }
    }
    for (const id of Object.keys(A)) if (!B[id]) bits.push(who + kind + " " + id + " removed");
  };

  /* ---- the markets ---- */
  const wc: Obj = {}, nc: Obj = {};
  for (const c of was.countries || []) wc[c.code] = c;
  for (const c of now.countries || []) nc[c.code] = c;
  let ownLists = false;
  for (const code of Object.keys(nc)) {
    const a = wc[code], b = nc[code];
    if (!a) { bits.push(code + " added"); continue; }
    if (!!a.off !== !!b.off) bits.push(code + (b.off ? " off" : " on"));
    const ap = a.prices || {}, bp = b.prices || {};
    for (const id of Object.keys(bp)) {
      const x = ap[id] && ap[id].now, y = bp[id] && bp[id].now;
      if (x != null && y != null && Number(x) !== Number(y)) bits.push(code + " " + id + " " + x + "→" + y + " " + (b.cur || ""));
      else if (x == null && y != null) bits.push(code + " " + id + " priced " + y + " " + (b.cur || ""));
      const xw = ap[id] && ap[id].was, yw = bp[id] && bp[id].was;
      if (x != null && Number(xw || 0) !== Number(yw || 0)) bits.push(code + " " + id + " was-price " + (Number(yw) || 0));
    }
    if (Number(a.freeOver) !== Number(b.freeOver) && b.freeOver != null) bits.push(code + " free delivery over " + b.freeOver);
    if (Number(a.ship) !== Number(b.ship) && b.ship != null) bits.push(code + " delivery " + b.ship);
    if (Number(a.cod || 0) !== Number(b.cod || 0)) bits.push(code + " cash fee " + (Number(b.cod) || 0));
    if ((a.codOn !== false) !== (b.codOn !== false)) bits.push(code + " cash on delivery " + (b.codOn !== false ? "on" : "off"));
    if (b.sizesOpen !== undefined && !!a.sizesOpen !== !!b.sizesOpen) bits.push(code + " size grid " + (b.sizesOpen ? "stays expanded" : "folds again"));
    for (const k of Object.keys({ ...a, ...b })) {
      if (CAT_COUNTRY_SKIP[k] || k === "off" || k === "freeOver" || k === "ship" || k === "cod" || k === "codOn" || k === "sizesOpen") continue;
      if (!same(a[k], b[k])) bits.push(code + " " + (WORD[k] || k) + " changed");
    }
    if (Array.isArray(b.sizes) || Array.isArray(b.scents) || Array.isArray(b.extras)) ownLists = true;
    items(code + " ", "size", a.sizes, b.sizes);
    items(code + " ", "scent", a.scents, b.scents);
    items(code + " ", "add-on", a.extras, b.extras);
  }
  for (const code of Object.keys(wc)) if (!nc[code]) bits.push(code + " removed");

  /* ---- the bundles ---- */
  const bundleBits = (word: string, ao: Obj, bo: Obj, defSize: string) => {
    if (!!ao.active !== !!bo.active) bits.push(word + " " + (bo.active ? "on" : "off"));
    if (bo.active && Number(ao.hours) !== Number(bo.hours) && bo.hours) bits.push(word + " window " + bo.hours + (bo.unit === "days" ? "h (days)" : "h"));
    if ((ao.unit || "hours") !== (bo.unit || "hours") && Number(ao.hours) === Number(bo.hours)) bits.push(word + " counted in " + (bo.unit || "hours"));
    if ((ao.renew || "auto") !== (bo.renew || "auto")) bits.push(word + " " + (bo.renew === "once" ? "ends when its window does" : "window repeats"));
    if (ao.anchor !== bo.anchor && bo.anchor && ao.renew === bo.renew && Number(ao.hours) === Number(bo.hours)) bits.push(word + " window reset");
    if (!same(ao.startsAt, bo.startsAt)) bits.push(bo.startsAt ? word + " starts " + t(bo.startsAt) : word + " start date removed");
    if (!same(ao.endsAt, bo.endsAt)) bits.push(bo.endsAt ? word + " ends " + t(bo.endsAt) : word + " end date removed");
    for (const [f, said] of [["name", "name edited"], ["note", "note edited"], ["badge", "badge changed"], ["term", "label changed"]] as const) {
      if (!same(ao[f] || "", bo[f] || "")) bits.push(word + " " + said);
    }
    if (!same(ao.countries || [], bo.countries || [])) bits.push(word + " markets " + ((bo.countries || []).length ? bo.countries.join(", ") : "all"));
    if ((ao.sizeId || defSize) !== (bo.sizeId || defSize)) bits.push(word + " packed from " + bo.sizeId);
  };
  bundleBits("bundle", was.offer || {}, now.offer || {}, "small");
  if (was.offer2 || now.offer2) bundleBits("large bundle", was.offer2 || {}, now.offer2 || {}, "large");

  /* ---- the free-delivery offer ---- */
  const af = was.freeShip || {}, bf = now.freeShip || {};
  if ((af.active !== false) !== (bf.active !== false) && (Object.keys(af.countries || {}).length || Object.keys(bf.countries || {}).length)) {
    bits.push("free-delivery offer " + (bf.active !== false ? "on" : "off"));
  }
  const afc = af.countries || {}, bfc = bf.countries || {};
  const dd = (r: Obj) => (r.days ? " for " + r.days + " day" + (Number(r.days) === 1 ? "" : "s") : "");
  for (const code of Object.keys({ ...afc, ...bfc })) {
    const x = afc[code] || {}, y = bfc[code] || {};
    if (!!x.on !== !!y.on) {
      bits.push(code + " free-delivery offer " + (y.on ? "on" + (y.over != null ? " over " + y.over : "") + dd(y) : "off"));
      continue;
    }
    if (!y.on) continue;
    if (Number(x.over) !== Number(y.over)) bits.push(code + " free-delivery offer over " + y.over);
    if (Number(x.days || 0) !== Number(y.days || 0)) bits.push(code + " free-delivery offer " + (y.days ? y.days + " day" + (Number(y.days) === 1 ? "" : "s") : "no end"));
    else if (x.from && y.from && x.from !== y.from) bits.push(code + " free-delivery offer restarted");
  }

  /* ---- the shelf switches ---- */
  if ((was.stockLive === true) !== (now.stockLive === true)) bits.push("pieces-left counter " + (now.stockLive === true ? "on" : "off"));
  const hw: Obj = was.stockHide && typeof was.stockHide === "object" ? was.stockHide : {};
  const hn: Obj = now.stockHide && typeof now.stockHide === "object" ? now.stockHide : {};
  for (const id of Object.keys({ ...hw, ...hn })) if ((hw[id] === true) !== (hn[id] === true)) bits.push(id + " hide at 0 " + (hn[id] === true ? "on" : "off"));
  const cw: Obj = was.stockCap && typeof was.stockCap === "object" ? was.stockCap : {};
  const cn: Obj = now.stockCap && typeof now.stockCap === "object" ? now.stockCap : {};
  for (const id of Object.keys({ ...cw, ...cn })) if ((cw[id] === true) !== (cn[id] === true)) bits.push(id + " cap at stock " + (cn[id] === true ? "on" : "off"));

  /* the shared lists mirror the first market once markets carry their own */
  if (!ownLists) {
    items("", "size", was.sizes, now.sizes);
    items("", "scent", was.scents, now.scents);
    items("", "add-on", was.extras, now.extras);
  }

  /* THE CATCH-ALL */
  if (!bits.length && J(catalogueOnly(was)) !== J(catalogueOnly(now))) bits.push("catalogue edited");

  /* one change made in every market is one line */
  const codes = Object.keys(nc);
  const grouped: string[] = [];
  const seen: Record<string, 1> = {};
  for (const b of bits) {
    const m = /^([A-Z]{2}) (.+)$/.exec(b);
    if (!m || codes.indexOf(m[1]!) < 0) { if (!seen[b]) { seen[b] = 1; grouped.push(b); } continue; }
    const rest = m[2]!;
    if (seen["§" + rest]) continue;
    const who = bits.filter((x) => x.slice(3) === rest && /^[A-Z]{2} /.test(x)).map((x) => x.slice(0, 2));
    seen["§" + rest] = 1;
    grouped.push(who.length > 1 && who.length === codes.length ? "all markets: " + rest : who.length > 1 ? who.join("/") + " " + rest : b);
  }
  return grouped;
}

/** The lines as one sentence, as the change log says it: at most twelve, then "… +N more". */
export function changeSentence(lines: readonly string[]): string {
  return lines.slice(0, MAX_SAID).join("; ") + (lines.length > MAX_SAID ? " … +" + (lines.length - MAX_SAID) + " more" : "");
}

/** describeChange(was, now) of the original: "" when nothing on the storefront changed. */
export function describeChange(was: Obj | null | undefined, now: Obj | null | undefined): string {
  return changeSentence(catalogueChangeLines(was, now));
}

/** Write one change (a publish, or a switch elsewhere: "Empower auto push on"). Nothing for no lines; never throws. */
export async function recordCatalogueChange(deps: Deps, actor: string, lines: readonly string[] | string): Promise<boolean> {
  const list = (typeof lines === "string" ? [lines] : [...lines]).map((x) => String(x).trim()).filter(Boolean);
  if (!list.length) return false;
  try {
    await deps.db.insert(catalogueChanges).values({
      at: new Date(deps.now()),
      actor: String(actor || "admin").slice(0, 80),
      what: changeSentence(list).slice(0, 400),
      detail: { lines: list.slice(0, 200) },
    });
    return true;
  } catch {
    /* the publish has already happened; the note is a courtesy */
    return false;
  }
}

export interface ChangeEntry {
  id: number;
  at: string;
  actor: string;
  what: string;
  lines: string[];
  /** live orders in the window before / after the change */
  before: number;
  after: number;
  /** the after-window is not over yet: no percentage */
  counting: boolean;
  /** signed whole %, null while counting */
  delta: number | null;
}

/**
 * The changes, newest first, each read against the live orders `winDays` days either side
 * (7 by default; a scent going out of stock takes longer than a price to show).
 */
export async function listCatalogueChanges(deps: Deps, o: { winDays?: number; limit?: number } = {}): Promise<{ ok: true; winDays: number; changes: ChangeEntry[] }> {
  const winDays = Math.max(1, Math.min(90, Math.round(Number(o.winDays) || 7)));
  const limit = Math.max(1, Math.min(2000, Math.round(Number(o.limit) || 500)));
  const W = winDays * 86400e3;
  const now = deps.now();
  const rows = await deps.db.select().from(catalogueChanges).orderBy(desc(catalogueChanges.at), desc(catalogueChanges.id)).limit(limit);
  let live: number[] = [];
  if (rows.length) {
    const oldest = rows[rows.length - 1]!.at.getTime() - W;
    const ord = await deps.db
      .select({ createdAt: orders.createdAt, status: orders.status, paymentStatus: orders.paymentStatus, pay: orders.pay, refunded: orders.refunded, trashed: orders.trashed })
      .from(orders)
      .where(gte(orders.createdAt, new Date(oldest)))
      .orderBy(asc(orders.createdAt));
    live = ord.filter((x) => isLive(x as unknown as Record<string, unknown>)).map((x) => x.createdAt.getTime());
  }
  const count = (a: number, b: number) => {
    let n = 0;
    for (const x of live) if (x >= a && x < b) n++;
    return n;
  };
  const changes = rows.map((r) => {
    const at = r.at.getTime();
    const before = count(at - W, at), after = count(at, at + W);
    const counting = now - at < W;
    const d = before ? Math.round(((after - before) / before) * 100) : after ? 100 : 0;
    const lines = Array.isArray((r.detail as Obj | null)?.lines) ? ((r.detail as Obj).lines as string[]) : [r.what];
    return { id: r.id, at: r.at.toISOString(), actor: r.actor, what: r.what, lines, before, after, counting, delta: counting ? null : d };
  });
  return { ok: true, winDays, changes };
}

export async function deleteCatalogueChange(deps: Deps, id: number): Promise<boolean> {
  const rows = await deps.db.delete(catalogueChanges).where(eq(catalogueChanges.id, Number(id))).returning({ id: catalogueChanges.id });
  return rows.length === 1;
}

export async function clearCatalogueChanges(deps: Deps): Promise<number> {
  const rows = await deps.db.delete(catalogueChanges).returning({ id: catalogueChanges.id });
  return rows.length;
}
