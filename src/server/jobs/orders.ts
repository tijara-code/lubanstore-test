/**
 * The orders area's housekeeping.
 *
 *   retention    daily   personal data does not outlive its purpose (docs/DATA.md): on orders
 *                        DELIVERED or CANCELLED more than 12 months ago, the customer's name,
 *                        phone, email, city, area, note and the browser signals (`client`) are
 *                        cleared, and the customer's copies inside the gateway record (the
 *                        session's metadata, any `client`) with them; `pii_cleared_at` stamped.
 *                        Kept: the order, its money, status, items, attribution, the courier
 *                        record — and `phone_key`, so the Customers tab and the repeat-customer
 *                        figure still count the person (decision: kept as is, not hashed — it is
 *                        the same key the CRM notes hang on; see docs/notes/orders.md).
 *   maintenance  hourly  logs (60 days; newest 20,000 server/job rows and 15,000 browser rows,
 *                        each capped on its own so a flood from the open collectors cannot push
 *                        the server's own errors out), webhook deliveries (90 days), once-only
 *                        claims (60 days), expired rate-limit counters.
 */
import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { phoneKey } from "../../shared/orders/phone";
import type { Deps } from "../core/deps";
import { purgeClaims } from "../core/ops";
import { purgeExpired } from "../core/ratelimit";
import { logs, orders, webhookEvents } from "../db/schema";
import { defineJob } from "./index";

export const PII_MONTHS = 12;
export const RETENTION_BATCH = 500;
export const LOG_DAYS = 60;
export const LOG_CAP = 20000;
export const BROWSER_LOG_CAP = 15000;
export const WEBHOOK_DAYS = 90;
export const CLAIM_DAYS = 60;

/** The cut-off: `months` calendar months before now (UTC). */
export function monthsAgo(now: number, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

const PII_KEYS = new Set(["customer", "customer_name", "name", "phone", "mobile", "mobile_number", "email", "city", "region", "address"]);

/** The gateway record without the customer: `client` dropped, every `metadata` block cleaned. */
export function scrubGateway(v: unknown, depth = 0): unknown {
  if (!v || typeof v !== "object" || depth > 8) return v;
  if (Array.isArray(v)) return v.map((x) => scrubGateway(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (depth === 0 && k === "client") continue;
    if (k === "metadata" && x && typeof x === "object" && !Array.isArray(x)) {
      const m: Record<string, unknown> = {};
      for (const [mk, mv] of Object.entries(x)) if (!PII_KEYS.has(mk)) m[mk] = mv;
      out[k] = m;
    } else out[k] = scrubGateway(x, depth + 1);
  }
  return out;
}

export async function runRetention(deps: Deps, months = PII_MONTHS): Promise<{ cleared: number; more: boolean }> {
  const cutoff = monthsAgo(deps.now(), months);
  const now = new Date(deps.now());
  const due = await deps.db
    .select({ id: orders.id, phone: orders.phone, countryCode: orders.countryCode, phoneKey: orders.phoneKey, gateway: orders.gateway })
    .from(orders)
    .where(
      and(
        isNull(orders.piiClearedAt),
        inArray(orders.status, ["done", "void"]),
        sql`coalesce(${orders.deliveredAt}, ${orders.createdAt}) < ${cutoff}`,
      ),
    )
    .orderBy(orders.createdAt)
    .limit(RETENTION_BATCH);
  if (!due.length) return { cleared: 0, more: false };
  await deps.db.transaction(async (tx) => {
    // the few that need their own write: a key still to derive, a gateway record to clean
    for (const o of due) {
      const set: Partial<typeof orders.$inferInsert> = {};
      if (!o.phoneKey) set.phoneKey = phoneKey(o.phone, o.countryCode) || null;
      if (o.gateway) set.gateway = scrubGateway(o.gateway) as typeof o.gateway;
      if (Object.keys(set).length) await tx.update(orders).set(set).where(eq(orders.id, o.id));
    }
    await tx
      .update(orders)
      .set({ name: null, phone: null, email: null, city: null, region: null, note: null, client: null, piiClearedAt: now, updatedAt: now })
      .where(and(inArray(orders.id, due.map((o) => o.id)), isNull(orders.piiClearedAt)));
  });
  return { cleared: due.length, more: due.length === RETENTION_BATCH };
}

/** Keep the newest `cap` rows of one side of the log (by id). */
async function capLogs(deps: Deps, browser: boolean, cap: number): Promise<number> {
  const side = browser ? eq(logs.side, "browser") : ne(logs.side, "browser");
  const edge = await deps.db.select({ id: logs.id }).from(logs).where(side).orderBy(sql`${logs.id} desc`).offset(cap).limit(1);
  if (!edge[0]) return 0;
  const gone = await deps.db.delete(logs).where(and(side, sql`${logs.id} <= ${edge[0].id}`)).returning({ id: logs.id });
  return gone.length;
}

export async function runMaintenance(deps: Deps): Promise<Record<string, number>> {
  const now = deps.now();
  const oldLogs = await deps.db.delete(logs).where(lt(logs.at, new Date(now - LOG_DAYS * 86400e3))).returning({ id: logs.id });
  const cappedServer = await capLogs(deps, false, LOG_CAP);
  const cappedBrowser = await capLogs(deps, true, BROWSER_LOG_CAP);
  const hooks = await deps.db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, new Date(now - WEBHOOK_DAYS * 86400e3)))
    .returning({ id: webhookEvents.id });
  const claims = await purgeClaims(deps.db, new Date(now - CLAIM_DAYS * 86400e3));
  await purgeExpired(deps.db, now);
  return { logs: oldLogs.length + cappedServer + cappedBrowser, webhookEvents: hooks.length, claims };
}

defineJob("retention", 24 * 60, async (deps) => runRetention(deps));
defineJob("maintenance", 60, async (deps) => runMaintenance(deps));

