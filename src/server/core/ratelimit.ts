/**
 * Fixed-window counters in the database (serverless instances share nothing in memory).
 * Keys are hashed so no IP address is stored.
 */
import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { rateLimits } from "../db/schema";

export const LIMITS = {
  order: { max: 10, windowMs: 10 * 60e3 },
  paySession: { max: 10, windowMs: 10 * 60e3 },
  login: { max: 8, windowMs: 15 * 60e3 },
  loginGlobal: { max: 60, windowMs: 15 * 60e3 },
  ev: { max: 60, windowMs: 60e3 },
  log: { max: 30, windowMs: 60e3 },
  beacon: { max: 120, windowMs: 60e3 },
  track: { max: 30, windowMs: 60e3 },
  resume: { max: 30, windowMs: 10 * 60e3 },
} as const;

export type LimitName = keyof typeof LIMITS;

export function keyOf(name: string, who: string): string {
  return name + ":" + createHash("sha256").update("lm-rl:" + who).digest("hex").slice(0, 24);
}

export interface Allowance {
  ok: boolean;
  count: number;
  retryAfter: number;
}

/** Count one hit; refuse past the limit. Fails OPEN when the database errors (never locks the shop out). */
export async function allow(db: DbOrTx, name: LimitName, who: string, now: number = Date.now()): Promise<Allowance> {
  const { max, windowMs } = LIMITS[name];
  const key = keyOf(name, who || "unknown");
  const reset = new Date(now + windowMs);
  try {
    const rows = await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: reset })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${rateLimits.resetAt} <= ${new Date(now)} then 1 else ${rateLimits.count} + 1 end`,
          resetAt: sql`case when ${rateLimits.resetAt} <= ${new Date(now)} then ${reset} else ${rateLimits.resetAt} end`,
        },
      })
      .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });
    const r = rows[0]!;
    const retryAfter = Math.max(1, Math.ceil((r.resetAt.getTime() - now) / 1000));
    return { ok: r.count <= max, count: r.count, retryAfter };
  } catch {
    return { ok: true, count: 0, retryAfter: 0 };
  }
}

/** Read a counter without counting (e.g. "is this IP locked out?"). */
export async function peek(db: DbOrTx, name: LimitName, who: string, now: number = Date.now()): Promise<Allowance> {
  const { max } = LIMITS[name];
  const key = keyOf(name, who || "unknown");
  try {
    const rows = await db.select().from(rateLimits).where(sql`${rateLimits.key} = ${key}`).limit(1);
    const r = rows[0];
    if (!r || r.resetAt.getTime() <= now) return { ok: true, count: 0, retryAfter: 0 };
    return { ok: r.count < max, count: r.count, retryAfter: Math.max(1, Math.ceil((r.resetAt.getTime() - now) / 1000)) };
  } catch {
    return { ok: true, count: 0, retryAfter: 0 };
  }
}

export async function clear(db: DbOrTx, name: LimitName, who: string): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.key} = ${keyOf(name, who || "unknown")}`);
}

export async function purgeExpired(db: DbOrTx, now: number = Date.now()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date(now - 3600e3)));
}
