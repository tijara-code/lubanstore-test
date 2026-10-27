/**
 * EDITING AND PUBLISHING THE CATALOGUE — the panel's rules over domain/catalogue.ts.
 *
 * A publish is conditional: the panel sends the row `version` it loaded and the `editTag`
 * (a fingerprint of everything the Catalogue tab edits). Another publish in between answers
 * 409 `stale` — unless all it changed was operational (a market's route, set on the Empower
 * tab), in which case the tag still matches and the publish goes ahead on the row as it is
 * now. Two tabs can never silently undo each other.
 *
 * What the server decides, whatever the panel sends (port of the original settings.save and
 * changelog.js, plus the anchor rules the original panel applied in the browser):
 *   - code-owned fields are stripped (OMR rates, drawings, countsFree — the deploy owns them);
 *   - each market's route (`courier`) is the stored one; the panel cannot set it here;
 *     the top-level operational keys (`courier`, `ledger`) are kept when the save has none;
 *   - free-delivery starts (`freeShip.countries.XX.from`) are stamped on the server's clock:
 *     when a market is switched on, or on `restart: true`; kept otherwise; dropped when off;
 *   - the set's free delivery (`offer.freeShipAnchor`): stamped when switched on, when its
 *     length or "when it closes" changes, on `offer.freeShipReset`, or when it has none;
 *   - the set's window (`offer.anchor`): the stored one; restarted on `offer.anchorReset`, and
 *     a ONE-SHOT window also when its length changes, when it becomes one-shot, when it has no
 *     start, or when the window it would land on is already over (so a dead-on-arrival offer
 *     cannot be saved);
 *   - the large-box offers' countdown (`tiers.anchor`): the stored one; restarted on
 *     `tiers.anchorReset`, and whenever they are on and switched on, given a new length, unit
 *     or ending — or have no start yet;
 *   - the change, in words, is recorded for the Analytics tab (catalogueChangeLines).
 * The request flags (`anchorReset`, `freeShipReset`, `restart`) are never stored.
 */
import { createHash } from "node:crypto";
import { CatalogueData } from "../../../shared/admin/schemas";
import { CODE_OWNED, merge, stripCodeOwned } from "../../../shared/catalogue/merge";
import type { Catalogue } from "../../../shared/catalogue/types";
import type { Deps } from "../../core/deps";
import { fail } from "../../core/http";
import { catalogueChangeLines, recordCatalogueChange } from "../analytics/changes";
import { bundledCatalogue, CatalogueError, publishCatalogue, readCatalogueRow } from "../catalogue";

type Obj = Record<string, any>;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const iso = (t: number) => new Date(t).toISOString();
const finiteDate = (v: unknown) => Number.isFinite(Date.parse(String(v || "")));

/* ---------------- the fingerprint ---------------- */

function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v as object).sort().filter((k) => (v as Obj)[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical((v as Obj)[k])).join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** What the Catalogue tab edits: everything but the code-owned fields and the operational keys. */
export function editable(data: Catalogue | null | undefined): Obj | null {
  if (!data) return null;
  const c = stripCodeOwned(data) as Obj;
  delete c.courier;
  delete c.ledger;
  delete c.version;
  c.countries = (c.countries || []).map((x: Obj) => {
    const y = { ...x };
    delete y.courier;
    return y;
  });
  return c;
}

export function editTag(data: Catalogue | null | undefined): string {
  const e = editable(data);
  if (!e) return "none";
  return createHash("sha256").update(canonical(e)).digest("hex").slice(0, 24);
}

/* ---------------- validation ---------------- */

/** The catalogue a publish carries: refused as the original refused it, then checked field by field. */
export function validCatalogue(data: unknown): Catalogue {
  const d = data as Obj | null;
  if (!d || typeof d !== "object" || Array.isArray(d) || !Array.isArray(d.countries) || !d.countries.length) {
    throw fail("bad_catalogue", 400);
  }
  // every market needs a real ISO code, or the storefront cannot match a shopper to a price
  if (d.countries.some((c: Obj) => !c || !/^[A-Z]{2}$/.test(String(c.code || "")))) throw fail("bad_country_code", 400);
  const codes = d.countries.map((c: Obj) => c.code);
  if (new Set(codes).size !== codes.length) throw fail("duplicate_country", 400);
  if (JSON.stringify(d).length > 400_000) throw fail("too_large", 413);
  const r = CatalogueData.safeParse(d);
  if (!r.success) {
    throw fail("bad_input", 400, {
      issues: r.error.issues.slice(0, 10).map((i) => ({ path: ["data", ...i.path].join("."), message: i.message })),
    });
  }
  return clone(d) as Catalogue;
}

/* ---------------- the stamps ---------------- */

/**
 * WHEN A FREE-DELIVERY OFFER STARTED: a fact the server records, on its own clock. Stamped when
 * a market is switched on (or had no start), or on `restart`; otherwise the stored start is
 * kept whatever the incoming row says (a forged `from` never lands). Off loses its start.
 * A new amount or number of days changes what the offer is, not when it began.
 */
export function stampFreeShip(before: Obj | null | undefined, next: Obj | null | undefined, now: number): void {
  const fs = next && next.freeShip;
  if (!fs || !fs.countries || typeof fs.countries !== "object") return;
  const prev = (before && before.freeShip && before.freeShip.countries) || {};
  const at = iso(now);
  for (const code of Object.keys(fs.countries)) {
    const r = fs.countries[code] && typeof fs.countries[code] === "object" ? fs.countries[code] : (fs.countries[code] = {});
    const p = prev[code] || {};
    const restart = r.restart === true;
    delete r.restart;
    if (!r.on) {
      delete r.from;
      continue;
    }
    r.from = restart || !p.on || !p.from ? at : p.from;
  }
}

/**
 * WHEN THE SET'S FREE DELIVERY STARTED (v411/v413): freeShipHours from freeShipAnchor, which the
 * server stamps when the switch goes on, the length or "when it closes" changes, on
 * freeShipReset, or when there is no start. Off, or no length: no anchor (no end).
 */
export function stampSetFree(before: Obj | null | undefined, next: Obj | null | undefined, now: number): void {
  const o = next && next.offer;
  if (!o || typeof o !== "object") return;
  const p = (before && before.offer) || {};
  const restart = o.freeShipReset === true;
  delete o.freeShipReset;
  if (o.freeShip !== true) {
    delete o.freeShipAnchor;
    return;
  }
  const hours = Number(o.freeShipHours) || 0;
  if (!(hours > 0)) {
    delete o.freeShipAnchor;
    return;
  }
  const was = finiteDate(p.freeShipAnchor) ? p.freeShipAnchor : "";
  const renew = o.freeShipRenew === "auto" ? "auto" : "once";
  const pRenew = p.freeShipRenew === "auto" ? "auto" : "once";
  if (restart || p.freeShip !== true || Number(p.freeShipHours) !== hours || renew !== pRenew || !was) o.freeShipAnchor = iso(now);
  else o.freeShipAnchor = was;
}

/**
 * THE SET'S WINDOW (test-offer-admin). The anchor is the stored one. Reset restarts it. A
 * one-shot window runs from its anchor, so it restarts when its length changes, when it is
 * switched to one-shot, when it has no anchor, or when the window it would land on is already
 * behind us — "give the offer twelve hours" means twelve hours from now. A rolling window
 * always opens the window that contains now: changing its length keeps the anchor.
 */
export function stampOffer(before: Obj | null | undefined, next: Obj | null | undefined, now: number): void {
  const o = next && next.offer;
  if (!o || typeof o !== "object") return;
  const p = (before && before.offer) || {};
  const reset = o.anchorReset === true;
  delete o.anchorReset;
  const stored = typeof p.anchor === "string" && p.anchor.trim() ? p.anchor : "";
  if (stored) o.anchor = stored;
  else delete o.anchor;
  if (reset) {
    o.anchor = iso(now);
    return;
  }
  if (o.renew === "once") {
    const len = (Number(o.hours) || 0) * 3600e3;
    const a = String(o.anchor || "").trim();
    const at = a ? Date.parse(a.indexOf("T") > -1 ? a : a + "T00:00:00+04:00") : NaN;
    const wasRenew = p.renew === "once" ? "once" : "auto";
    if (wasRenew !== "once" || (Number(p.hours) || 0) !== (Number(o.hours) || 0) || !Number.isFinite(at) || (len > 0 && at + len <= now)) {
      o.anchor = iso(now);
    }
  }
}

/**
 * THE LARGE-BOX OFFERS' COUNTDOWN (v303): it starts when the offers start, and again on Reset
 * or on any change to it — switched on, a new length, a new unit, a new ending — or when it
 * has no start yet.
 */
export function stampTiers(before: Obj | null | undefined, next: Obj | null | undefined, now: number): void {
  const t = next && next.tiers;
  if (!t || typeof t !== "object") return;
  const prev = (before && before.tiers) || {};
  const reset = t.anchorReset === true;
  delete t.anchorReset;
  let anchor = typeof prev.anchor === "string" ? prev.anchor.trim() : "";
  const on = t.active !== false;
  const changed =
    (prev.active === false && on) ||
    (Number(prev.hours) || 0) !== (Number(t.hours) || 0) ||
    (prev.unit || "hours") !== (t.unit || "hours") ||
    (prev.renew === "auto" ? "auto" : "once") !== (t.renew === "auto" ? "auto" : "once");
  if ((on && (changed || !anchor)) || reset) anchor = iso(now);
  if (anchor) t.anchor = anchor;
  else delete t.anchor;
}

/** The keys set elsewhere (Empower tab routes; the dropped shipper/ledger blocks): the stored ones. */
export function keepOperational(stored: Obj | null | undefined, next: Obj): void {
  const routed: Record<string, unknown> = {};
  for (const c of (stored && stored.countries) || []) if (c && c.code) routed[String(c.code).toUpperCase()] = c.courier;
  for (const c of next.countries || []) {
    const r = routed[String(c.code || "").toUpperCase()];
    if (r !== undefined && r !== null && r !== "") c.courier = r;
    else delete c.courier;
  }
  for (const k of ["courier", "ledger"]) {
    if ((next[k] === undefined || next[k] === null) && stored && stored[k] !== undefined) next[k] = stored[k];
  }
}

/** Everything the server does to a catalogue on its way into the row. */
export function prepare(stored: Catalogue | null, incoming: Catalogue, now: number): Catalogue {
  const next = clone(incoming) as Obj;
  delete next.__publishedVersion;
  delete next.version;
  delete next.offer2;
  keepOperational(stored as Obj | null, next);
  stampFreeShip(stored as Obj | null, next, now);
  stampSetFree(stored as Obj | null, next, now);
  stampOffer(stored as Obj | null, next, now);
  stampTiers(stored as Obj | null, next, now);
  return next as Catalogue;
}

/* ---------------- reading ---------------- */

export async function getCatalogue(deps: Deps) {
  const row = await readCatalogueRow(deps.db);
  const deploy = bundledCatalogue();
  const data = row ? merge(row.data, deploy)! : deploy;
  return {
    ok: true as const,
    data,
    stored: row ? row.data : null,
    version: row ? row.version : 0,
    editTag: editTag(row ? row.data : null),
    updatedAt: row ? row.updatedAt.toISOString() : null,
    updatedBy: (row && (row as { updatedBy?: string | null }).updatedBy) || null,
    codeOwned: CODE_OWNED as unknown as Record<string, readonly string[]>,
    deployVersion: typeof deploy.version === "number" ? deploy.version : null,
  };
}

/* ---------------- writing ---------------- */

export interface Expect {
  version: number;
  editTag?: string;
}

/**
 * Write `build(stored)` into the row, conditionally. With `expect`, refused 409 stale when the
 * row moved past the version the panel loaded AND what the Catalogue tab edits changed.
 * Records the change lines. → the answer the panel shows.
 */
export async function writeCatalogue(
  deps: Deps,
  actor: string,
  expect: Expect | null,
  build: (stored: Catalogue | null) => Catalogue | null,
) {
  const row = await readCatalogueRow(deps.db);
  const current = row ? row.version : 0;
  const tagNow = editTag(row ? row.data : null);
  // the version moved on: fine only if what this tab edits is what the panel loaded
  if (expect && expect.version !== current && (!expect.editTag || expect.editTag !== tagNow)) {
    throw fail("stale", 409, { version: current, editTag: tagNow });
  }
  const base = tagNow;
  let lines: string[] = [];
  let out;
  try {
    out = await publishCatalogue(
      deps,
      (stored) => {
        if (expect && editTag(stored) !== base) throw fail("stale", 409);
        const next = build(stored);
        if (!next) return null;
        lines = catalogueChangeLines(stored ? stripCodeOwned(stored) : null, stripCodeOwned(next));
        return next;
      },
      actor,
    );
  } catch (e) {
    if (e instanceof CatalogueError && e.code === "busy") throw fail("busy", 409);
    throw e;
  }
  if (!out) throw fail("not_published", 409);
  if (lines.length) await recordCatalogueChange(deps, actor, lines);
  return {
    ok: true as const,
    version: out.version,
    editTag: editTag(out.data),
    updatedAt: out.updatedAt.toISOString(),
    change: lines,
    data: out.data,
  };
}

/** Save & publish. */
export async function publish(deps: Deps, actor: string, body: { data: unknown; version: number; editTag?: string }) {
  const incoming = validCatalogue(body.data);
  return writeCatalogue(deps, actor, { version: body.version, editTag: body.editTag }, (stored) => prepare(stored, incoming, deps.now()));
}

/**
 * Restore defaults: the deploy's catalogue, published — but through the same door, so the
 * routes and the operational keys stay (v314: a restore once wiped the shipper and the rates)
 * and the anchors are stamped as for any publish.
 */
export async function restoreDefaults(deps: Deps, actor: string, body: { version: number; editTag?: string }) {
  const deploy = bundledCatalogue();
  return writeCatalogue(deps, actor, { version: body.version, editTag: body.editTag }, (stored) => prepare(stored, deploy, deps.now()));
}

/**
 * The Stock Tracker's switches — the pieces-left counter, "cap at stock" and "hide at 0" per
 * box — written into the row where it stands and nothing else (a switch flipped there must
 * not publish the Catalogue tab's unpublished edits). Only ticked boxes are kept.
 */
export async function setStockSwitches(
  deps: Deps,
  actor: string,
  body: { stockLive?: boolean; stockCap?: Record<string, boolean>; stockHide?: Record<string, boolean> },
) {
  const ticked = (m: Record<string, boolean>) => {
    const out: Record<string, boolean> = {};
    for (const k of Object.keys(m)) if (m[k] === true) out[k] = true;
    return out;
  };
  return writeCatalogue(deps, actor, null, (stored) => {
    if (!stored) return null;
    const next = clone(stored) as Obj;
    if (body.stockLive !== undefined) next.stockLive = body.stockLive;
    if (body.stockCap) next.stockCap = { ...(next.stockCap || {}), ...ticked(body.stockCap) };
    if (body.stockCap) for (const k of Object.keys(body.stockCap)) if (body.stockCap[k] === false) delete next.stockCap[k];
    if (body.stockHide) next.stockHide = { ...(next.stockHide || {}), ...ticked(body.stockHide) };
    if (body.stockHide) for (const k of Object.keys(body.stockHide)) if (body.stockHide[k] === false) delete next.stockHide[k];
    return next as Catalogue;
  });
}

/** The stored catalogue as a file (nothing published: the deploy's). */
export async function exportCatalogue(deps: Deps): Promise<{ name: string; body: string }> {
  const row = await readCatalogueRow(deps.db);
  const data = row ? row.data : stripCodeOwned(bundledCatalogue());
  const day = new Date(deps.now() + 4 * 3600e3).toISOString().slice(0, 10);
  return { name: "catalogue-" + day + (row ? "-v" + row.version : "-defaults") + ".json", body: JSON.stringify(data, null, 2) + "\n" };
}
