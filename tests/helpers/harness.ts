/**
 * A whole server for a test: an in-memory Postgres (PGlite) with the real schema, the fake
 * world behind fetch, a clock the test moves, and the real Hono app.
 *
 *   const h = await createHarness({ catalogue });
 *   const res = await h.post("/api/order", { order });
 *   h.world.calls, h.clock.advance(3600e3), await h.db.select().from(orders)
 */
import { sql } from "drizzle-orm";
import { createApp } from "../../src/server/app";
import { connectPglite, type Db } from "../../src/server/db/client";
import { settings } from "../../src/server/db/schema";
import type { Deps } from "../../src/server/core/deps";
import { createLogger } from "../../src/server/core/log";
import { loadEnv } from "../../src/server/env";
import { createFakeWorld, createServices, FAKE_ENV } from "../../src/server/services";
import type { World } from "../../src/server/services/fakes/world";
import type { Catalogue } from "../../src/shared/catalogue/types";
import { bundledCatalogue, forgetCatalogue } from "../../src/server/domain/catalogue";
import "../../src/server/jobs/registry";

export const T0 = Date.parse("2026-10-20T08:00:00Z");

export interface HarnessOptions {
  /** the published catalogue (default: the bundled one); null = nothing published */
  catalogue?: Catalogue | null;
  /** start time (default T0) */
  now?: number;
  env?: Record<string, string>;
}

export interface Clock {
  t: number;
  advance(ms: number): number;
  set(t: number): number;
}

export async function createHarness(opts: HarnessOptions = {}) {
  const world = createFakeWorld();
  const clock: Clock = {
    t: opts.now ?? T0,
    advance(ms) { clock.t += ms; return clock.t; },
    set(t) { clock.t = t; return t; },
  };
  world.setNow(() => clock.t);
  const db: Db = await connectPglite();
  const env = loadEnv({
    ...FAKE_ENV,
    SERVICES_MODE: "fake",
    SITE_URL: "https://lubanmusk.test",
    ADMIN_USER: "shopkeeper",
    ADMIN_PASSWORD: "correct-horse-battery",
    SESSION_SECRET: "test-session-secret-0123456789abcdef0123",
    ...opts.env,
  });
  const now = () => clock.t;
  const deps: Deps = {
    db,
    env,
    fetch: world.fetch,
    now,
    log: createLogger(() => db, { quiet: true }),
    services: createServices({ env, fetch: world.fetch, now }),
  };
  const app = createApp(deps);

  async function publish(cat: Catalogue | null) {
    await db.delete(settings);
    if (cat) await db.insert(settings).values({ id: 1, data: cat, version: 1, updatedAt: new Date(clock.t) });
    forgetCatalogue(db as unknown as object);
  }
  await publish(opts.catalogue === undefined ? bundledCatalogue() : opts.catalogue);

  const baseHeaders = { "x-nf-client-connection-ip": "203.0.113.7", "x-country": "OM" };
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(baseHeaders)) if (!headers.has(k)) headers.set(k, v);
    return app.request("https://lubanmusk.test" + path, { ...init, headers });
  }
  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return request(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
  }
  async function get(path: string, headers: Record<string, string> = {}) {
    return request(path, { headers });
  }
  /** empty every table (keeps the schema) */
  async function reset(cat: Catalogue | null | undefined = opts.catalogue) {
    const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
    const names = (tables as unknown as { rows: Array<{ tablename: string }> }).rows.map((r) => `"${r.tablename}"`);
    if (names.length) await db.execute(sql.raw(`truncate ${names.join(", ")} restart identity cascade`));
    world.calls.length = 0;
    world.fail(null);
    await publish(cat === undefined ? bundledCatalogue() : cat);
  }
  return { deps, world, db, app, clock, env, request, post, get, publish, reset };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
export type { World };
