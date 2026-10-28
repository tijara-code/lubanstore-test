/**
 * Database connections. Production: PostgreSQL (Supabase) through postgres-js over the
 * transaction pooler. Local development and tests: PGlite (Postgres compiled to WASM,
 * in-process) with the same schema — no server to install.
 */
import { fileURLToPath } from "node:url";
import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** A transaction handle has the same query surface as the database. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export { schema };

export interface PostgresOptions {
  /** pool size (default 3: a function instance serves one request at a time) */
  max?: number;
  /** seconds an idle connection is kept (default 20) */
  idleTimeout?: number;
  /**
   * A search_path for the session — for tests' own raw SQL only. Production code never relies
   * on it: every table is named through its Drizzle object (`store."…"`), because a
   * startup parameter is not guaranteed to survive the Supabase transaction pooler.
   */
  searchPath?: string;
}

/** Postgres's timestamp/date types, by oid: timestamptz, timestamp, date, time. */
const DATE_OIDS = [1184, 1114, 1082, 1083] as const;

/** A JS Date as Postgres reads it; anything else (drizzle's own strings) untouched. */
export function dateParam(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

/**
 * postgres-js against DATABASE_URL (Supabase pooler: prepared statements off).
 *
 * drizzle's postgres-js driver installs IDENTITY serializers for the timestamp types (its
 * columns hand it strings), so a bare Date in a raw `sql` template — a rate limit's window, a
 * purge's cut-off — reached the wire as a Date object and postgres-js threw. PGlite takes
 * Dates as they are. The serializers are put back here, once, so a Date works in raw SQL on
 * both drivers.
 */
export async function connectPostgres(url: string, opts: PostgresOptions = {}): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, {
    prepare: false,
    max: opts.max ?? 3,
    idle_timeout: opts.idleTimeout ?? 20,
    connect_timeout: 8,
    ...(opts.searchPath ? { connection: { search_path: opts.searchPath } } : {}),
  });
  const db = drizzle(client, { schema });
  const serializers = client.options.serializers as Record<number, (v: unknown) => unknown>;
  for (const oid of DATE_OIDS) serializers[oid] = dateParam;
  return db as unknown as Db;
}

/**
 * The rows of a raw `db.execute(sql…)`, whichever driver answered: postgres-js returns an
 * array, PGlite `{ rows }`. (Raw SQL should select numbers and text — `extract(epoch …)`,
 * `::int`, `::float8` — not timestamps or bigints, which the two drivers parse differently.)
 */
export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = res as { rows?: T[] } | null;
  return (r && Array.isArray(r.rows) ? r.rows : []) as T[];
}

/** Run a raw query and return its rows on either driver. */
export async function queryRows<T>(db: DbOrTx, query: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(query));
}

/**
 * PGlite (in-memory when dataDir is omitted). The schema is created from db/migrations.
 * An in-memory database starts from a cached snapshot of the migrated schema (made once per
 * set of migrations, in node_modules/.cache): a fresh Postgres takes seconds to initialise,
 * a snapshot about one.
 */
export async function connectPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const migrationsFolder = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
  if (dataDir) {
    const { mkdirSync } = await import("node:fs");
    const path = await import("node:path");
    mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
    const client = new PGlite(dataDir);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    await client.exec(SEARCH_PATH);
    return db as unknown as Db;
  }
  const snapshot = await migratedSnapshot(migrationsFolder);
  const client = snapshot ? new PGlite({ loadDataDir: snapshot }) : new PGlite();
  const db = drizzle(client, { schema });
  if (!snapshot) await migrate(db, { migrationsFolder });
  await client.exec(SEARCH_PATH);
  return db as unknown as Db;
}

/** For local development's and tests' own raw SQL (`update orders …`); server code names tables through their Drizzle objects. */
const SEARCH_PATH = "set search_path to store, public";

let snapshotPromise: Promise<Blob | null> | null = null;

async function migratedSnapshot(migrationsFolder: string): Promise<Blob | null> {
  if (!snapshotPromise) snapshotPromise = buildSnapshot(migrationsFolder).catch(() => null);
  return snapshotPromise;
}

async function buildSnapshot(migrationsFolder: string): Promise<Blob | null> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else hash.update(f).update(fs.readFileSync(p));
    }
  };
  walk(migrationsFolder);
  const cacheDir = path.resolve(migrationsFolder, "../../node_modules/.cache/lm-pglite");
  const file = path.join(cacheDir, hash.digest("hex").slice(0, 16) + ".tar");
  if (fs.existsSync(file)) return new Blob([fs.readFileSync(file)]);
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite();
  await migrate(drizzle(client, { schema }), { migrationsFolder });
  const dump = (await client.dumpDataDir("none")) as Blob;
  await client.close();
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
  fs.renameSync(tmp, file);
  return dump;
}
