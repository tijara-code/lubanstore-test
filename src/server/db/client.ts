/**
 * Database connections. Production: PostgreSQL (Supabase) through postgres-js over the
 * transaction pooler. Local development and tests: PGlite (Postgres compiled to WASM,
 * in-process) with the same schema — no server to install.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** A transaction handle has the same query surface as the database. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export { schema };

/** postgres-js against DATABASE_URL (Supabase pooler: prepared statements off). */
export async function connectPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 8 });
  return drizzle(client, { schema }) as unknown as Db;
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
  const migrationsFolder = new URL("../../../db/migrations", import.meta.url).pathname;
  if (dataDir) {
    const { mkdirSync } = await import("node:fs");
    const path = await import("node:path");
    mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
    const client = new PGlite(dataDir);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    return db as unknown as Db;
  }
  const snapshot = await migratedSnapshot(migrationsFolder);
  const client = snapshot ? new PGlite({ loadDataDir: snapshot }) : new PGlite();
  const db = drizzle(client, { schema });
  if (!snapshot) await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

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
