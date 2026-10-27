/**
 * The Empower tab's actions, as plain functions of `deps` for the admin routes to call.
 * Each returns the answer body ({ ok: true, … }) or throws fail(code, status, extra) with the
 * original panel's statuses: not set up is 409 (the state the shop is in, not a fault);
 * Omniful saying no (a 4xx, the id taken included) is 409; Omniful or the database failing
 * is 502. A skip (already pushed, routed elsewhere) is a 200 with `skipped` — the system
 * working, never shown as a failure.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { checkOf } from "../../../shared/orders/phone";
import type { Catalogue } from "../../../shared/catalogue/types";
import type { Deps } from "../../core/deps";
import { fail } from "../../core/http";
import { catalogueChanges, orders, shipments, type OrderRow } from "../../db/schema";
import { OmnifulError, type CatalogueSku } from "../../services/omniful";
import { loadCatalogue, publishCatalogue, CatalogueError } from "../catalogue";
import { linesOf, unmapped, type SkuMap } from "./lines";
import { AUTO_AFTER_MIN, AUTO_EVERY_MIN, AUTO_RETRY_H, CARRIER, cancelPushed, pushOrder, sweep, SWEEP_MAX, type PushResult } from "./push";
import { COURIERS, empowerMarkets, isOrderId, LABEL, routing, type Courier } from "./rules";
import { pollStatuses, POLL_MAX } from "./sync";
import { AUTO_RUN_KEY, autoSetting, noteRun, omf, POLL_KEY, readNotes, readRun, readSkus, setAuto, SKUS_KEY, SWEEP_KEY, UNSURE_KEY } from "./store";
import { putOp } from "../../core/ops";

export const HOOK_PATH = "/api/omniful/hook";

function needConfigured(deps: Deps): void {
  if (!omf(deps).configured()) throw fail("omniful_not_configured", 409);
}

/* ---------------- the tab ---------------- */

export async function empowerStatus(deps: Deps) {
  const [cfg, lastSweep, lastPoll, skus, auto, lastAuto] = await Promise.all([
    loadCatalogue(deps, { fresh: true }),
    readRun(deps, SWEEP_KEY),
    readRun(deps, POLL_KEY),
    readSkus(deps),
    autoSetting(deps),
    readRun(deps, AUTO_RUN_KEY),
  ]);
  const mine = empowerMarkets(cfg);
  let waiting = 0;
  let pushed = 0;
  try {
    const [w, p] = await Promise.all([
      mine.length
        ? deps.db
            .select({ n: sql<number>`count(*)::int` })
            .from(orders)
            .where(
              and(
                eq(orders.status, "new"),
                eq(orders.trashed, false),
                inArray(orders.countryCode, mine),
                sql`not exists (select 1 from ${shipments} where ${shipments.orderId} = ${orders.id})`,
              ),
            )
        : Promise.resolve([{ n: 0 }]),
      deps.db
        .select({ n: sql<number>`count(distinct ${shipments.orderId})::int` })
        .from(shipments)
        .where(and(eq(shipments.carrier, CARRIER), isNotNull(shipments.orderId))),
    ]);
    waiting = Number(w[0]?.n) || 0;
    pushed = Number(p[0]?.n) || 0;
  } catch {
    /* a count is not worth failing the tab for */
  }
  return {
    ok: true as const,
    ...omf(deps).state(),
    lastSweep,
    lastPoll,
    routing: routing(cfg),
    couriers: COURIERS,
    labels: LABEL,
    waiting,
    pushed,
    hookPath: HOOK_PATH,
    hookGuarded: !!String(deps.env.OMNIFUL_HOOK_SECRET || "").trim(),
    skus,
    auto: { on: auto.on, since: auto.at, afterMin: AUTO_AFTER_MIN, everyMin: AUTO_EVERY_MIN, retryH: AUTO_RETRY_H, last: lastAuto },
  };
}

/* ---------------- what is waiting, and what was pushed ---------------- */

export interface WaitingOrder {
  id: string;
  createdAt: string;
  name: string | null;
  phone: string | null;
  countryCode: string;
  city: string | null;
  region: string | null;
  cur: string;
  total: number;
  ship: number;
  codFee: number;
  pay: string;
  paymentStatus: string;
  origin: string | null;
  items: OrderRow["items"];
  /** each warehouse line with the SKU it goes out as */
  lines: Array<{ code: string; sku: string; qty: number }>;
  /** what a courier would need and the order lacks (the auto push holds these back) */
  check?: string[];
  skuMissing?: string[];
  /** a push of it got no answer: the next push checks and records it */
  unsure?: boolean;
}

/** New orders in Empower markets with no parcel: the Waiting list, oldest first. */
export async function waitingList(deps: Deps): Promise<{ ok: true; orders: WaitingOrder[] }> {
  const cfg = await loadCatalogue(deps, { fresh: true });
  const mine = empowerMarkets(cfg);
  if (!mine.length) return { ok: true, orders: [] };
  const [rows, skus, unsure] = await Promise.all([
    deps.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.status, "new"),
          eq(orders.trashed, false),
          inArray(orders.countryCode, mine),
          sql`not exists (select 1 from ${shipments} where ${shipments.orderId} = ${orders.id})`,
        ),
      )
      .orderBy(asc(orders.createdAt), asc(orders.id))
      .limit(500),
    readSkus(deps, { strict: true }).catch(() => null),
    readNotes(deps, UNSURE_KEY),
  ]);
  return { ok: true, orders: rows.map((o) => waitingRow(o, cfg, skus, !!unsure[o.id])) };
}

function waitingRow(o: OrderRow, cfg: Catalogue, skus: SkuMap | null, unsure: boolean): WaitingOrder {
  const lines = linesOf(o, cfg, skus || {});
  const check = checkOf(o);
  const out: WaitingOrder = {
    id: o.id,
    createdAt: o.createdAt.toISOString(),
    name: o.name,
    phone: o.phone,
    countryCode: o.countryCode,
    city: o.city,
    region: o.region,
    cur: o.cur,
    total: o.total,
    ship: o.ship,
    codFee: o.codFee,
    pay: o.pay,
    paymentStatus: o.paymentStatus,
    origin: o.origin,
    items: o.items,
    lines: lines.map((l) => ({ code: l.code, sku: l.seller_sku_code, qty: l.quantity })),
  };
  /* a flag is a help: skipped when the SKU map could not be read */
  if (skus) {
    const miss = unmapped(lines, skus);
    if (miss.length) {
      check.push("sku");
      out.skuMissing = miss.map((u) => u.code);
    }
  }
  if (check.length) out.check = check;
  if (unsure) out.unsure = true;
  return out;
}

/** What has been pushed, newest first (the tab's table). */
export async function pushedList(deps: Deps, opts: { limit?: number } = {}) {
  const rows = await deps.db
    .select()
    .from(shipments)
    .where(eq(shipments.carrier, CARRIER))
    .orderBy(desc(shipments.updatedAt))
    .limit(Math.min(1000, Math.max(1, opts.limit || 300)));
  return { ok: true as const, rows };
}

export interface EmpowerRecord {
  /** the id it was sent as */
  sent: string;
  ref: string | null;
  awb: string | null;
  st: string | null;
  at: string;
  done: string | null;
}

/** Each order's Empower record (the newest send), and whether a push of it is being checked — for the Orders list. */
export async function empowerRecords(deps: Deps, orderIds: string[]): Promise<{ records: Record<string, EmpowerRecord>; unsure: string[] }> {
  const ids = orderIds.filter(isOrderId);
  const records: Record<string, EmpowerRecord> = {};
  if (ids.length) {
    const rows = await deps.db
      .select()
      .from(shipments)
      .where(and(eq(shipments.carrier, CARRIER), inArray(shipments.orderId, ids)))
      .orderBy(desc(shipments.createdAt));
    for (const s of rows) {
      if (!s.orderId || records[s.orderId]) continue;
      records[s.orderId] = {
        sent: s.sentId,
        ref: s.reference,
        awb: s.awb,
        st: s.status,
        at: s.createdAt.toISOString(),
        done: s.deliveredAt ? s.deliveredAt.toISOString() : null,
      };
    }
  }
  const notes = await readNotes(deps, UNSURE_KEY);
  return { records, unsure: ids.filter((id) => notes[id] && !records[id]) };
}

/* ---------------- the SKU map ---------------- */

/** Save the map whole: trimmed, empty boxes dropped (they fall back to our own code). */
export async function saveSkus(deps: Deps, given: unknown): Promise<{ ok: true; skus: SkuMap }> {
  if (!given || typeof given !== "object" || Array.isArray(given)) throw fail("no_skus", 400);
  const clean: SkuMap = {};
  const src = given as Record<string, unknown>;
  for (const raw of Object.keys(src).slice(0, 200)) {
    const k = String(raw).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,59}$/.test(k)) throw fail("bad_code", 400, { code: k });
    const v = src[raw] == null ? "" : typeof src[raw] === "string" || typeof src[raw] === "number" ? String(src[raw]).trim() : "";
    if (!v) continue;
    if (v.length > 80 || /[\u0000-\u001f<>"]/.test(v)) throw fail("bad_sku", 400, { code: k });
    clean[k] = v;
  }
  try {
    await putOp(deps.db, SKUS_KEY, clean, new Date(deps.now()));
  } catch {
    throw fail("db_write_failed", 502);
  }
  return { ok: true, skus: clean };
}

/** Their master catalogue, to match our products against. */
export async function catalogSkus(deps: Deps): Promise<{ ok: true; skus: CatalogueSku[] }> {
  needConfigured(deps);
  try {
    return { ok: true, skus: await omf(deps).listSkus(5) };
  } catch (e) {
    const err = e as OmnifulError;
    throw fail(err.code || "omniful_unreachable", 502, { detail: String(err.message || e) });
  }
}

/**
 * MATCH FROM OMNIFUL: for our code and what is typed in its box, their SKU — by code, then by
 * name (a name typed in the box is swapped for its code), then our own code; the set to a kit
 * by its name (the large set only to a kit that says large).
 */
export function matchSku(cat: CatalogueSku[], code: string, typed: string): CatalogueSku | null {
  const low = (v: unknown) => String(v || "").trim().toLowerCase();
  const t = low(typed);
  const c = low(code);
  let hit =
    cat.find((k) => t && low(k.sku_code) === t) ||
    cat.find((k) => t && low(k.name) === t) ||
    cat.find((k) => low(k.name) === c || low(k.sku_code) === c) ||
    null;
  if (!hit && (code === "bundle" || code === "bundle2")) {
    const big = /large|big|300|كبير/i;
    hit = cat.find((k) => (/bundle|kit|set/i.test(k.name) || /bundle|kit/i.test(k.type || "")) && (code === "bundle2" ? big.test(k.name) : !big.test(k.name))) || null;
  }
  return hit;
}

/**
 * Every box of ours against their catalogue: the code to use, and a problem to show when the
 * box holds something Omniful does not know ("That is the Omniful name. Its SKU code is …").
 */
export function matchSkus(cat: CatalogueSku[], codes: string[], current: SkuMap) {
  const known = new Set(cat.map((k) => String(k.sku_code).toLowerCase()));
  const out: Record<string, { sku: string | null; problem: string | null }> = {};
  for (const code of codes) {
    const v = String(current[code] || "").trim();
    const ok = !v || known.has(v.toLowerCase());
    const hit = matchSku(cat, code, v);
    out[code] = {
      sku: ok && v ? v : hit ? hit.sku_code : null,
      problem: ok ? null : hit ? "That is the Omniful name. Its SKU code is " + hit.sku_code : "Omniful has no SKU with this code",
    };
  }
  return out;
}

/* ---------------- routing ---------------- */

/** Which route carries a market — written into the catalogue beside the rest of that country. */
export async function setRoute(deps: Deps, codeIn: unknown, courierIn: unknown, actor = "admin"): Promise<{ ok: true; code: string; courier: Courier }> {
  const code = String(codeIn || "").trim().toUpperCase();
  const courier = String(courierIn || "").trim().toLowerCase();
  if (!/^[A-Z]{2}$/.test(code)) throw fail("bad_country", 400);
  if ((COURIERS as readonly string[]).indexOf(courier) < 0) throw fail("bad_courier", 400);
  let found = true;
  try {
    await publishCatalogue(
      deps,
      (stored) => {
        if (!stored) {
          found = false;
          return null;
        }
        const list = (Array.isArray(stored.countries) ? stored.countries : []).map((c) => ({ ...c }));
        const hit = list.find((c) => String((c && c.code) || "").toUpperCase() === code);
        if (!hit) {
          found = false;
          return null;
        }
        hit.courier = courier;
        return { ...stored, countries: list };
      },
      actor,
    );
  } catch (e) {
    if (e instanceof CatalogueError && e.code === "busy") throw fail("busy", 409);
    throw fail("db_write_failed", 502);
  }
  if (!found) throw fail("no_such_market", 404);
  return { ok: true, code, courier: courier as Courier };
}

/* ---------------- pushing, by hand ---------------- */

function pushAnswer(r: PushResult): Record<string, unknown> {
  if ("skipped" in r) return { ok: true, ...r };
  if ("error" in r) {
    const status = r.duplicate || (r.status && r.status < 500) || r.error === "sku_not_set" ? 409 : 502;
    const { error, ...rest } = r;
    throw fail(error, status, rest);
  }
  return { ...r };
}

/** Push one order. `any`: from the Orders tab, any market. `fresh` and `adopt` never together. */
export async function pushOne(
  deps: Deps,
  body: { id?: unknown; any?: unknown; fresh?: unknown; adopt?: unknown; deadline?: number },
  actor = "admin",
) {
  const id = String(body.id || "");
  if (!isOrderId(id)) throw fail("no_id", 400);
  needConfigured(deps);
  const o = (await deps.db.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
  if (!o) throw fail("no_such_order", 404);
  const cfg = await loadCatalogue(deps, { fresh: true });
  const r = await pushOrder(deps, o, cfg, {
    anyMarket: body.any === true,
    fresh: body.fresh === true,
    adopt: body.adopt === true && body.fresh !== true,
    deadline: body.deadline,
    by: actor,
  });
  const out = pushAnswer(r);
  if ("ok" in r && r.ok) await noteRun(deps, SWEEP_KEY, { pushed: 1, considered: 1, failed: [], one: id });
  return out;
}

/** Push all: the ids the shop was shown and confirmed, SWEEP_MAX a call; `left` goes again. */
export async function pushMany(deps: Deps, body: { ids?: unknown; deadline?: number }, actor = "admin") {
  needConfigured(deps);
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, SWEEP_MAX) : [];
  if (!ids.length) throw fail("no_ids", 400);
  const r = await sweep(deps, { ids, deadline: body.deadline ?? deps.now() + 9000, by: actor });
  if ("error" in r) {
    const { error, ...rest } = r;
    throw fail(error, error === "no_ids" ? 400 : 502, rest);
  }
  await noteRun(deps, SWEEP_KEY, r as unknown as Record<string, unknown>);
  return { ok: true, ...r };
}

/** The auto push switch: { on } sets it; without it, it is read. */
export async function autoSwitch(deps: Deps, body: { on?: unknown }, actor = "admin") {
  if (body.on === true || body.on === false) {
    if (body.on && !omf(deps).configured()) throw fail("omniful_not_configured", 409);
    try {
      await setAuto(deps, body.on);
    } catch {
      throw fail("db_write_failed", 502);
    }
    await deps.db
      .insert(catalogueChanges)
      .values({ at: new Date(deps.now()), actor, what: "Empower auto push " + (body.on ? "on" : "off") })
      .catch(() => {});
  }
  let set;
  let last;
  try {
    set = await autoSetting(deps);
    last = await readRun(deps, AUTO_RUN_KEY);
  } catch {
    throw fail("db_read_failed", 502);
  }
  return { ok: true as const, on: set.on, since: set.at, afterMin: AUTO_AFTER_MIN, everyMin: AUTO_EVERY_MIN, retryH: AUTO_RETRY_H, last };
}

/** Take an order back off Empower. */
export async function takeOff(deps: Deps, body: { id?: unknown; markOnly?: unknown }, actor = "admin") {
  const id = String(body.id || "");
  if (!isOrderId(id)) throw fail("no_id", 400);
  const markOnly = body.markOnly === true;
  if (!markOnly) needConfigured(deps);
  const r = await cancelPushed(deps, id, { markOnly, by: actor });
  if ("skipped" in r) return { ok: true, ...r };
  if ("error" in r) {
    const { error, ...rest } = r;
    const status = error === "already_delivered" || (r.upstream && r.upstream < 500) ? 409 : error === "omniful_not_configured" ? 409 : 502;
    throw fail(error, status, rest);
  }
  return r;
}

/** "Check now": the poll's own look, recorded under the same key. */
export async function syncNow(deps: Deps, body: { deadline?: number } = {}) {
  needConfigured(deps);
  const r = await pollStatuses(deps, { max: POLL_MAX, deadline: body.deadline ?? deps.now() + 7000 });
  if ("error" in r) throw fail(r.error, 502);
  await noteRun(deps, POLL_KEY, r as unknown as Record<string, unknown>);
  return { ok: true, ...r };
}
