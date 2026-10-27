/**
 * Small key → JSON records (job runs, caches, switches, the SKU map) and once-only claims.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { claims, ops } from "../db/schema";

export async function getOp<T>(db: DbOrTx, key: string): Promise<{ data: T; updatedAt: Date } | null> {
  const rows = await db.select().from(ops).where(eq(ops.key, key)).limit(1);
  const r = rows[0];
  return r ? { data: r.data as T, updatedAt: r.updatedAt } : null;
}

export async function getOpData<T>(db: DbOrTx, key: string, fallback: T): Promise<T> {
  const r = await getOp<T>(db, key);
  return r ? r.data : fallback;
}

export async function putOp(db: DbOrTx, key: string, data: unknown, at: Date = new Date()): Promise<void> {
  await db
    .insert(ops)
    .values({ key, data, updatedAt: at })
    .onConflictDoUpdate({ target: ops.key, set: { data, updatedAt: at } });
}

/** Read-modify-write one record inside a row lock (serialised against other writers). */
export async function updateOp<T>(db: DbOrTx, key: string, fallback: T, change: (current: T) => T, at: Date = new Date()): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.insert(ops).values({ key, data: fallback as unknown, updatedAt: at }).onConflictDoNothing();
    const rows = await tx.select().from(ops).where(eq(ops.key, key)).for("update");
    const next = change((rows[0]?.data as T) ?? fallback);
    await tx.update(ops).set({ data: next as unknown, updatedAt: at }).where(eq(ops.key, key));
    return next;
  });
}

export async function deleteOp(db: DbOrTx, key: string): Promise<void> {
  await db.delete(ops).where(eq(ops.key, key));
}

/** Take a once-only claim. true = it is ours; false = someone already holds it. */
export async function claim(db: DbOrTx, key: string, at: Date = new Date()): Promise<boolean> {
  const rows = await db.insert(claims).values({ key, at, state: "taken" }).onConflictDoNothing().returning({ key: claims.key });
  return rows.length === 1;
}

/** Mark a claim as failed (kept, so nobody re-sends blindly) or give it back. */
export async function releaseClaim(db: DbOrTx, key: string): Promise<void> {
  await db.delete(claims).where(eq(claims.key, key));
}

export async function markClaim(db: DbOrTx, key: string, state: string): Promise<void> {
  await db.update(claims).set({ state }).where(eq(claims.key, key));
}

export async function purgeClaims(db: DbOrTx, olderThan: Date): Promise<number> {
  const rows = await db.delete(claims).where(lt(claims.at, olderThan)).returning({ key: claims.key });
  return rows.length;
}

export const _sql = { and, sql };
