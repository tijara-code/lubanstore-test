/**
 * FIRST-RUN SETUP of a real database, so a site moved over with only DATABASE_URL added
 * starts where the original left off:
 *
 *   1. schema `store` missing or behind → the migrations in db/migrations are applied;
 *   2. `store.orders` empty and the original's `public.orders` present in the same database →
 *      db/import-from-v1.sql is run (orders, parcels, the catalogue, Empower records, notes,
 *      analytics — the same copy the owner can run by hand; it never changes `public`).
 *
 * Runs once per database and is safe when two cold starts try at the same time: everything
 * is transactional and idempotent (a migration that finds the tables already made, or an
 * import that finds the rows already copied, simply loses the race and the start goes on with
 * what the other one did). No session lock: through Supabase's transaction pooler a session
 * lock could be left behind on a pooled connection. Off with LM_AUTO_SETUP=off.
 * `npm run db:setup` does the same from the owner's computer.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";

export interface SetupReport {
  migrated: boolean;
  imported: boolean;
  /** counts after the run: how many orders the new tables hold, and the original's */
  orders: number;
  originalOrders: number | null;
  /** a step lost a race with another start, or failed; the start goes on if the tables exist */
  note?: string;
}

type Sql = ReturnType<typeof postgres>;

/** db/ next to the bundle (Netlify: included_files) or the repository. */
export function dbDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const c of [path.resolve(here, "../../../db"), path.resolve(process.cwd(), "db"), path.resolve(here, "../../db"), path.resolve(here, "db")]) {
    if (existsSync(path.join(c, "migrations"))) return c;
  }
  return path.resolve(process.cwd(), "db");
}

async function one<T>(sql: Sql, q: Promise<unknown>): Promise<T | undefined> {
  const r = (await q) as T[];
  return r[0];
}

export async function schemaState(sql: Sql): Promise<{ hasOrders: boolean; orders: number; originalOrders: number | null }> {
  const t = await one<{ store_orders: boolean; public_orders: boolean }>(
    sql,
    sql`select exists(select 1 from information_schema.tables where table_schema = 'store' and table_name = 'orders') as store_orders,
               exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'orders') as public_orders`,
  );
  const hasOrders = !!t?.store_orders;
  const orders = hasOrders ? Number((await one<{ n: number }>(sql, sql`select count(*)::int as n from store.orders`))?.n || 0) : 0;
  const originalOrders = t?.public_orders ? Number((await one<{ n: number }>(sql, sql`select count(*)::int as n from public.orders`))?.n || 0) : null;
  return { hasOrders, orders, originalOrders };
}

/**
 * Migrate, then import, under the lock. `client` is a postgres-js connection to the database
 * (max 1 is enough). Returns what was done; throws when a step fails (the caller decides
 * whether that stops the start).
 */
/** Polls the schema state for up to ~25 s until `ok` holds (the other start's transaction committing). */
async function settles(sql: Sql, ok: (st: Awaited<ReturnType<typeof schemaState>>) => boolean): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    try {
      if (ok(await schemaState(sql))) return true;
    } catch {
      /* the schema may be half-visible while the other transaction commits */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function setupDatabase(client: Sql, log: (line: string) => void = () => {}): Promise<SetupReport> {
  const before = await schemaState(client);
  if (before.hasOrders && (before.orders > 0 || !before.originalOrders)) {
    return { migrated: false, imported: false, orders: before.orders, originalOrders: before.originalOrders };
  }
  let migrated = false;
  let imported = false;
  let note: string | undefined;
  if (!before.hasOrders) {
    log("[setup] schema store is missing: applying db/migrations");
    try {
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      await migrate(drizzle(client), { migrationsFolder: path.join(dbDir(), "migrations") });
      migrated = true;
    } catch (e) {
      // another start may have won and still be committing: give it a moment, then go on with its work
      if (!(await settles(client, (st) => st.hasOrders))) throw e;
      note = "migration lost a race with another start";
      log("[setup] " + note);
    }
  }
  const mid = await schemaState(client);
  if (mid.orders === 0 && mid.originalOrders && mid.originalOrders > 0) {
    const file = path.join(dbDir(), "import-from-v1.sql");
    if (!existsSync(file)) throw new Error("db/import-from-v1.sql is not next to the server (included_files)");
    log(`[setup] store.orders is empty and the original has ${mid.originalOrders} orders: running db/import-from-v1.sql`);
    try {
      await client.unsafe(readFileSync(file, "utf8"));
      imported = true;
    } catch (e) {
      if (!(await settles(client, (st) => st.orders > 0))) throw e;
      note = "import lost a race with another start";
      log("[setup] " + note);
    }
  }
  const done = await schemaState(client);
  log(`[setup] done: ${migrated ? "migrated, " : ""}${imported ? "imported, " : ""}${done.orders} orders in store (original ${done.originalOrders ?? "—"})`);
  return { migrated, imported, orders: done.orders, originalOrders: done.originalOrders, ...(note ? { note } : {}) };
}
