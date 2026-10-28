/**
 * Builds the dependencies for a real process (Netlify function instance or Node server):
 * the database (Postgres when DATABASE_URL is set, else PGlite on disk), the services
 * (live, or the fake world in fake mode), the logger and the clock. Cached per process.
 */
import { connectPglite, connectPostgres, type Db } from "./db/client";
import type { Deps } from "./core/deps";
import { createLogger, errorText } from "./core/log";
import { createApp, type App } from "./app";
import { loadEnv, type Env } from "./env";
import { createFakeWorld, createServices, FAKE_ENV } from "./services";
import type { World } from "./services/fakes/world";
import "./jobs/registry";

let cached: Promise<{ deps: Deps; world: World | null }> | null = null;

/**
 * The process's dependencies, built once. A build that FAILS is not kept: the next call tries
 * again (a database that was briefly unreachable at a cold start must not take the instance
 * down for its whole life).
 */
export function getDeps(source: Record<string, string | undefined> = process.env): Promise<{ deps: Deps; world: World | null }> {
  if (!cached) {
    const p = build(source);
    cached = p;
    p.catch(() => {
      if (cached === p) cached = null;
    });
  }
  return cached;
}

/** Tests only: forget the built dependencies. */
export function forgetDeps(): void {
  cached = null;
}

let lastBootError = "";

/**
 * The answer while the server cannot start (configuration refused, database unreachable): a
 * 503 in the API's JSON contract, so the storefront keeps a cash order and sends it again.
 * The reason goes to the function's log once per distinct error — never to the caller.
 */
export function bootFailure(e: unknown): Response {
  const why = (e as Error)?.name === "ZodError" ? "a configuration variable was refused: " + zodPaths(e) : errorText(e);
  if (why !== lastBootError) {
    lastBootError = why;
    console.error("[boot] the server could not start: " + why);
  }
  return new Response(JSON.stringify({ ok: false, error: "server_unavailable" }), {
    status: 503,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": "5" },
  });
}

/** which variables zod refused (names only — never their values) */
function zodPaths(e: unknown): string {
  const issues = (e as { issues?: Array<{ path?: unknown[] }> }).issues || [];
  return issues.map((i) => (i.path || []).join(".")).filter(Boolean).join(", ") || "unknown";
}

/** A Netlify function's handler over the one app: built on first use, retried after a failed start. */
export function netlifyHandler(): (req: Request) => Promise<Response> {
  let app: App | null = null;
  return async (req) => {
    if (!app) {
      try {
        const { deps } = await getDeps(process.env);
        app = createApp(deps);
      } catch (e) {
        return bootFailure(e);
      }
    }
    return app.fetch(req);
  };
}

async function build(source: Record<string, string | undefined>): Promise<{ deps: Deps; world: World | null }> {
  let env: Env = loadEnv(source);
  let world: World | null = null;
  let fetchImpl = globalThis.fetch.bind(globalThis);
  if (env.servicesMode === "fake") {
    // (loadEnv already refuses fake in production; said again where the fakes are made)
    if (env.production) throw new Error("SERVICES_MODE=fake is refused in production");
    world = createFakeWorld();
    fetchImpl = world.fetch;
    env = loadEnv({ ...FAKE_ENV, ...stripEmpty(source), SERVICES_MODE: "fake" });
  }
  let db: Db;
  if (env.DATABASE_URL) db = await connectPostgres(env.DATABASE_URL);
  else {
    if (env.production) throw new Error("DATABASE_URL is required in production");
    db = await connectPglite(env.DATA_DIR === "memory" ? undefined : env.DATA_DIR || ".data/pglite");
  }
  const now = () => Date.now();
  const deps: Deps = {
    db,
    env,
    fetch: fetchImpl,
    now,
    log: createLogger(() => db, { now }),
    services: createServices({ env, fetch: fetchImpl, now }),
  };
  return { deps, world };
}

function stripEmpty(src: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) if (v) out[k] = v;
  return out;
}
