/**
 * The `pg` Vitest project's harness: the same API as harness.ts (that module is aliased to
 * this one), over a REAL PostgreSQL through postgres-js and `connectPostgres` — the
 * production driver — instead of PGlite. Every harness gets its own fresh database, cloned
 * from the migrated template that pg-global-setup.ts made for this run (dropped at the end).
 *
 * PGlite has one connection and serialises everything; here concurrent requests really run
 * concurrently, so races show. Raw SQL in tests may name tables unqualified: this connection
 * (and only this one) sets search_path.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { inject } from "vitest";
import { connectPostgres } from "../../src/server/db/client";
import { buildHarness, T0, type Clock, type Harness, type HarnessOptions, type World } from "./harness-core";

export { T0 };
export type { Clock, Harness, HarnessOptions, World };

declare module "vitest" {
  export interface ProvidedContext {
    pgUrl: string;
    pgTemplate: string;
  }
}

/** postgres://…/<db> with the database name swapped */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = "/" + name;
  return u.toString();
}

let admin: ReturnType<typeof postgres> | null = null;

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const base = inject("pgUrl");
  const template = inject("pgTemplate");
  const name = template.replace(/_tpl$/, "") + "_" + process.pid + "_" + randomBytes(4).toString("hex");
  if (!admin) admin = postgres(withDatabase(base, "postgres"), { max: 1, idle_timeout: 2, onnotice: () => {} });
  await admin.unsafe(`create database "${name}" template "${template}"`);
  const db = await connectPostgres(withDatabase(base, name), { max: 4, idleTimeout: 1, searchPath: "store,public" });
  return buildHarness(db, opts);
}
