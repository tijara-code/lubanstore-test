/**
 * Builds the dependencies for a real process (Netlify function instance or Node server):
 * the database (Postgres when DATABASE_URL is set, else PGlite on disk), the services
 * (live, or the fake world in fake mode), the logger and the clock. Cached per process.
 */
import { connectPglite, connectPostgres, type Db } from "./db/client";
import type { Deps } from "./core/deps";
import { createLogger } from "./core/log";
import { loadEnv, type Env } from "./env";
import { createFakeWorld, createServices, FAKE_ENV } from "./services";
import type { World } from "./services/fakes/world";
import "./jobs/registry";

let cached: Promise<{ deps: Deps; world: World | null }> | null = null;

export function getDeps(source: Record<string, string | undefined> = process.env): Promise<{ deps: Deps; world: World | null }> {
  if (!cached) cached = build(source);
  return cached;
}

async function build(source: Record<string, string | undefined>): Promise<{ deps: Deps; world: World | null }> {
  let env: Env = loadEnv(source);
  let world: World | null = null;
  let fetchImpl = globalThis.fetch.bind(globalThis);
  if (env.servicesMode === "fake") {
    if (env.production) throw new Error("SERVICES_MODE=fake is refused in production");
    world = createFakeWorld();
    fetchImpl = world.fetch;
    env = loadEnv({ ...FAKE_ENV, ...stripEmpty(source), SERVICES_MODE: "fake" });
  }
  let db: Db;
  if (env.DATABASE_URL) db = await connectPostgres(env.DATABASE_URL);
  else {
    if (env.production) throw new Error("DATABASE_URL is required in production");
    db = await connectPglite(env.DATA_DIR || ".data/pglite");
  }
  const now = () => Date.now();
  const deps: Deps = {
    db,
    env,
    fetch: fetchImpl,
    now,
    log: createLogger(() => db),
    services: createServices({ env, fetch: fetchImpl, now }),
  };
  return { deps, world };
}

function stripEmpty(src: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) if (v) out[k] = v;
  return out;
}
