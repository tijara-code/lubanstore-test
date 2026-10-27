/**
 * `npm run db:migrate` — apply db/migrations to the database in DATABASE_URL (run by hand,
 * never by a deploy). Idempotent: already-applied migrations are skipped (drizzle records
 * them in the `drizzle.__drizzle_migrations` table).
 */
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (Supabase → Project settings → Database → connection string).");
  process.exit(1);
}
const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, "../db/migrations") });
  const [{ n }] = await client`select count(*)::int as n from information_schema.tables where table_schema = 'store'`;
  console.log(`Migrations applied. Schema "store" has ${n} tables.`);
} catch (e) {
  console.error("Migration failed: " + (e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
