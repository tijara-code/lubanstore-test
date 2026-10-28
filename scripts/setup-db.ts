/**
 * `npm run db:setup` — the same first-run setup the server does at its first start, from your
 * computer: create schema `store` in DATABASE_URL (migrations) and copy the original store's
 * data from its `public` tables when `store.orders` is still empty. Then the preflight.
 * Reads .env. Run it again any time: a second run finds nothing to do.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { needsTls } from "../src/server/db/client";
import { setupDatabase } from "../src/server/db/setup";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (.env): Supabase → Connect → Transaction pooler.");
  process.exit(1);
}
const client = postgres(url, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {}, ...(needsTls(url) ? { ssl: "require" as const } : {}) });
try {
  const r = await setupDatabase(client, (l) => console.log(l));
  if (!r.migrated && !r.imported) console.log(`Nothing to do: schema store is there with ${r.orders} orders` + (r.originalOrders != null ? ` (original: ${r.originalOrders})` : "") + ".");
} catch (e) {
  console.error("Setup failed: " + (e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 2 }).catch(() => {});
}
if (!process.exitCode) {
  console.log("");
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(REPO, "scripts/preflight.ts"), ...process.argv.slice(2)], { stdio: "inherit", cwd: REPO });
  process.exitCode = r.status || 0;
}
