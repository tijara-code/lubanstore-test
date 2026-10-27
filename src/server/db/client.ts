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

/** PGlite (in-memory when dataDir is omitted). The schema is created from db/migrations. */
export async function connectPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: new URL("../../../db/migrations", import.meta.url).pathname });
  return db as unknown as Db;
}
