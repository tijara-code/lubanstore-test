/**
 * Orders: reading one, writing a new one once, and moving one along the status flow.
 *
 * AN ORDER IS WRITTEN ONCE AND NEVER OVER ANOTHER. The id is the browser's proposal, so a
 * second order landing on the same number used to replace the first outright (and, on
 * purpose, a one-sample card session could be "paid" for ten large boxes). Now it is
 * `insert … on conflict do nothing`: when the id or the dedupe id is already there, the only
 * innocent explanation is this same submission arriving twice (the offline queue retrying,
 * a double tap) — recognised by its dedupe id and answered as already written. Anything
 * else gets a fresh id, and the caller is told which id the order really has.
 *
 * STATUS WRITES ARE CONDITIONAL: `UPDATE … WHERE id = $1 AND status = <the status read>
 * RETURNING`, with the order_events row in the same transaction, so two writers (the panel,
 * Empower's news, the expiry job, a payment) cannot both win and every move is on record.
 */
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ownHostOf, attribute, originOf } from "../../shared/attribution";
import type { Catalogue } from "../../shared/catalogue/types";
import { phoneKey } from "../../shared/orders/phone";
import { transition, type Mover, type Status, type TransitionRefusal } from "../../shared/orders/status";
import type { ClientSignals, OrderLine } from "../../shared/orders/types";
import type { Quote } from "../../shared/pricing/price";
import type { Deps } from "../core/deps";
import type { LogEntry, Logger } from "../core/log";
import type { Db, DbOrTx } from "../db/client";
import { orderEvents, orders, type NewOrderRow, type OrderRow } from "../db/schema";
import { isOrderId, str, type Intake } from "./intake";

export { isOrderId };

export async function getOrder(db: DbOrTx, id: string): Promise<OrderRow | null> {
  if (!id) return null;
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return rows[0] || null;
}

/* ---------------- ids and keys ---------------- */

/** Seven digits of the clock and three random ones: "LM-" + 10 digits, inside /^LM-\d{4,12}$/. */
export function newOrderId(now: number): string {
  return "LM-" + String(Math.floor(now)).slice(-7).padStart(7, "0") + String(randomInt(0, 1000)).padStart(3, "0");
}

/** The browser's proposed id when it is one, else a new LM- id. */
export function orderIdFrom(proposed: string | null, now: number): string {
  return isOrderId(proposed) ? proposed : newOrderId(now);
}

/** The secret in /invoice and /resume links: 32 hex characters, stored (never derived). */
export function newInvoiceKey(): string {
  return randomBytes(16).toString("hex");
}

/** The shop's own host, for attribution ("" → lubanmusk.com, the original's constant). */
export function ownHost(deps: Pick<Deps, "env">): string {
  return ownHostOf(deps.env.siteUrl) || "lubanmusk.com";
}

/* ---------------- the row ---------------- */

/**
 * The columns every new order carries, from the intake and the quote (the tills add the
 * payment fields: pay, status, paymentStatus, invoiceKey, amountBaisa …). Names and
 * currency come from the catalogue, never from the post. `request`: the shopper's own
 * request (IP, user agent), kept in `client` for the server-side Purchase.
 */
export function baseOrderRow(
  deps: Deps,
  id: string,
  intake: Intake,
  quote: Quote,
  request: { ip?: string; ua?: string } = {},
): Omit<NewOrderRow, "pay" | "status" | "paymentStatus" | "invoiceKey"> {
  const at = new Date(deps.now());
  const host = ownHost(deps);
  const client: ClientSignals = { ...intake.signals };
  if (request.ip) client.ip = str(request.ip, 64);
  if (request.ua) client.ua = str(request.ua, 400);
  if (intake.pageUrl) client.url = intake.pageUrl;
  return {
    id,
    createdAt: at,
    updatedAt: at,
    lang: intake.lang,
    origin: originOf(intake.ref, host),
    attribution: attribute(intake.ref, host, deps.now()),
    name: intake.name,
    phone: intake.phone,
    phoneKey: phoneKey(intake.phone, quote.country.code) || null,
    email: intake.email,
    country: str(quote.country.name, 60),
    countryCode: quote.country.code,
    city: intake.city,
    region: intake.region,
    note: intake.note,
    items: quote.items as OrderLine[],
    cur: quote.cur,
    sub: quote.sub,
    ship: quote.ship,
    codFee: quote.codFee,
    total: quote.total,
    omrRate: quote.omrRate,
    omr: quote.omr,
    dedupeId: intake.dedupeId,
    client,
  };
}

/* ---------------- writing a new order ---------------- */

export class OrderWriteError extends Error {
  constructor(readonly code: "order_id_unavailable") {
    super(code);
    this.name = "OrderWriteError";
  }
}

/**
 * Write a new order once and never over another: the same submission arriving twice
 * (same dedupe id) is answered as already written (`fresh: false`, the order as stored);
 * a taken id gets a fresh one. `event`: the order_events "created" row (by, detail).
 * Database errors propagate (the till answers 502 and the browser sends it again).
 */
export async function writeOrder(
  deps: Deps,
  row: NewOrderRow,
  event: { by?: string; detail?: Record<string, unknown> } = {},
): Promise<{ id: string; fresh: boolean; order: OrderRow }> {
  let r: NewOrderRow = { ...row };
  for (let n = 0; n < 5; n++) {
    const hit = await deps.db.insert(orders).values(r).onConflictDoNothing().returning();
    if (hit[0]) {
      await deps.db.insert(orderEvents).values({
        orderId: hit[0].id,
        at: new Date(deps.now()),
        kind: "created",
        from: null,
        to: hit[0].status,
        by: event.by || "shopper",
        detail: { pay: hit[0].pay, origin: hit[0].origin, ...(event.detail || {}) },
      });
      return { id: hit[0].id, fresh: true, order: hit[0] };
    }
    if (r.dedupeId) {
      const same = await deps.db.select().from(orders).where(eq(orders.dedupeId, r.dedupeId)).limit(1);
      if (same[0]) return { id: same[0].id, fresh: false, order: same[0] };
    }
    r = { ...r, id: newOrderId(deps.now()) };
  }
  throw new OrderWriteError("order_id_unavailable");
}

/* ---------------- the stock lock ---------------- */

/** The advisory lock every stock-gated write takes (see inStockTx). */
export const STOCK_LOCK = 0x4c4d5354; // "LMST"

/** Does this catalogue cap any box at the shelf? (Nothing capped: nothing to serialise.) */
export function anyCap(cfg: Catalogue): boolean {
  return Object.values(cfg.stockCap || {}).some((v) => v === true);
}

/**
 * Run `fn` in one transaction holding the stock lock, so two shoppers cannot both take the
 * last capped box: the gate's read of what open orders hold and the insert that follows
 * are one step. `fn` gets deps whose `db` IS the transaction (every read inside goes
 * through it) and whose `log` is held until the transaction ends — PGlite has one
 * connection, and a write through the outer handle inside would wait for ever.
 */
export async function inStockTx<T>(deps: Deps, lock: boolean, fn: (txDeps: Deps) => Promise<T>): Promise<T> {
  const held: LogEntry[] = [];
  const log: Logger = {
    write: async (e) => void held.push(e),
    error: async (source, message, extra) => void held.push({ ...extra, source, message, level: "error" }),
    warn: async (source, message, extra) => void held.push({ ...extra, source, message, level: "warn" }),
  };
  try {
    return await deps.db.transaction(async (tx) => {
      if (lock) await tx.execute(sql`select pg_advisory_xact_lock(${STOCK_LOCK})`);
      return fn({ ...deps, db: tx as unknown as Db, log });
    });
  } finally {
    for (const e of held) await deps.log.write(e);
  }
}

/* ---------------- moving an order ---------------- */

export interface MoveResult {
  /** the row was changed by this call */
  changed: boolean;
  /** why the move was refused (transition rules), when it was */
  refusal?: TransitionRefusal | "not_found" | "stale";
  order?: OrderRow;
}

/**
 * Move an order to `to` as `by`. Conditional on the status read: a concurrent writer that
 * moved it first makes this a no-op ({ changed: false, refusal: "stale" }).
 *
 *   opts.patch   extra columns written in the same UPDATE (e.g. tracking, carrier)
 *   opts.force   a person who was told it moves back (admin:force rows of the table)
 *   opts.from    only if the order is still in this status (what the caller read and checked)
 *   opts.as      whose rights the move is checked against — default `by`; a `job:<name>`
 *                mover is checked as "admin" unless it says otherwise (the Empower poll
 *                passes as: "courier", the expiry job as: "payment")
 *   opts.detail  stored on the order_events row
 *
 * Moving to "ship" stamps shipped_at, to "done" delivered_at (when not already set).
 * The same status is no move: { changed: false } with the order.
 */
export async function moveOrder(
  deps: Deps,
  id: string,
  to: Status,
  by: Mover | `job:${string}`,
  opts: { force?: boolean; patch?: Partial<OrderRow>; detail?: Record<string, unknown>; from?: Status; as?: Mover } = {},
): Promise<MoveResult> {
  return deps.db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
    const o = rows[0];
    if (!o) return { changed: false, refusal: "not_found" as const };
    if (opts.from && o.status !== opts.from) return { changed: false, refusal: "stale" as const, order: o };
    if (o.status === to) return { changed: false, order: o };
    const rule: Mover = opts.as || (String(by).startsWith("job:") ? "admin" : (by as Mover));
    const why = transition(o, to, rule, { force: opts.force });
    if (why) return { changed: false, refusal: why, order: o };
    const at = new Date(deps.now());
    const set: Partial<OrderRow> = { ...(opts.patch || {}), status: to, updatedAt: at };
    if (to === "ship" && !o.shippedAt && !set.shippedAt) set.shippedAt = at;
    if (to === "done" && !o.deliveredAt && !set.deliveredAt) set.deliveredAt = at;
    delete (set as Record<string, unknown>).id;
    const hit = await tx
      .update(orders)
      .set(set)
      .where(and(eq(orders.id, id), eq(orders.status, o.status)))
      .returning();
    if (!hit[0]) return { changed: false, refusal: "stale" as const, order: o };
    await tx.insert(orderEvents).values({
      orderId: id,
      at,
      kind: "status",
      from: o.status,
      to,
      by: String(by),
      detail: { ...(opts.force ? { force: true } : {}), ...(opts.detail || {}) },
    });
    return { changed: true, order: hit[0] };
  });
}

/** Record something that happened to an order (an edit, a note, a flag …). */
export async function recordEvent(
  db: DbOrTx,
  e: { orderId: string; at: Date; kind: string; by: string; from?: string | null; to?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  await db.insert(orderEvents).values({
    orderId: e.orderId,
    at: e.at,
    kind: e.kind,
    from: e.from ?? null,
    to: e.to ?? null,
    by: e.by,
    detail: e.detail || null,
  });
}
