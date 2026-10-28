/**
 * (review-fixes, findings 2 and 8) Production never runs on the fakes, and a failed start
 * answers 503 JSON and is tried again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootFailure, forgetDeps, getDeps, netlifyHandler } from "../../../src/server/bootstrap";
import { loadEnv, EnvError, isProduction } from "../../../src/server/env";
import { createPixelsClient } from "../../../src/server/services/pixels";
import { createFakeWorld, FAKE_ENV } from "../../../src/server/services";

/** What a Netlify Function sees at runtime: URL, SITE_NAME, SITE_ID — no CONTEXT, no NODE_ENV. */
const NETLIFY = { URL: "https://lubanmusk.com", SITE_NAME: "lubanmusk", SITE_ID: "1d01c0c0-0000-0000-0000-000000000000" };

afterEach(() => {
  forgetDeps();
  vi.restoreAllMocks();
});

describe("which services, and is it production", () => {
  it("defaults to LIVE; fake only when asked for", () => {
    expect(loadEnv({}).servicesMode).toBe("live");
    expect(loadEnv({ SERVICES_MODE: "fake" }).servicesMode).toBe("fake");
    expect(loadEnv({ SERVICES_MODE: " Fake " }).servicesMode).toBe("fake");
  });

  it("production = Netlify's runtime SITE_ID, NODE_ENV=production or CONTEXT=production", () => {
    expect(isProduction({})).toBe(false);
    expect(isProduction({ CONTEXT: "deploy-preview" })).toBe(false);
    expect(isProduction(NETLIFY)).toBe(true);
    expect(isProduction({ NODE_ENV: "production" })).toBe(true);
    expect(isProduction({ CONTEXT: "production" })).toBe(true);
    const env = loadEnv({ ...NETLIFY, THAWANI_MODE: "live" });
    expect([env.production, env.servicesMode]).toEqual([true, "live"]);
  });

  it("refuses SERVICES_MODE=fake in production, whichever sign says so", () => {
    for (const p of [NETLIFY, { NODE_ENV: "production" }, { CONTEXT: "production" }]) {
      expect(() => loadEnv({ ...p, SERVICES_MODE: "fake" })).toThrow(EnvError);
    }
  });

  it("never sends the Meta test code in production (Netlify sets no CONTEXT for functions)", () => {
    const world = createFakeWorld();
    const live = createPixelsClient({ env: loadEnv({ ...FAKE_ENV, ...NETLIFY, META_TEST_EVENT_CODE: "TEST123" }), fetch: world.fetch, now: () => 0 });
    expect(live.meta.testCode()).toBe("");
    const local = createPixelsClient({ env: loadEnv({ ...FAKE_ENV, META_TEST_EVENT_CODE: "TEST123" }), fetch: world.fetch, now: () => 0 });
    expect(local.meta.testCode()).toBe("TEST123");
  });

  it("enum variables are trimmed: a trailing space in THAWANI_MODE works", () => {
    expect(loadEnv({ THAWANI_MODE: "live " }).THAWANI_MODE).toBe("live");
    expect(loadEnv({ THAWANI_MODE: " UAT" }).THAWANI_MODE).toBe("uat");
    expect(loadEnv({ OMNIFUL_ENV: "staging\n" }).OMNIFUL_ENV).toBe("staging");
    expect(loadEnv({ THAWANI_MODE: "" }).THAWANI_MODE).toBe(undefined);
  });

  it("a value that is none of the choices is treated as unset and named, never refused (a typo must not 503 the API)", async () => {
    const e = loadEnv({ THAWANI_MODE: "sandbox", OMNIFUL_ENV: "prod", SERVICES_MODE: "fakes" });
    expect([e.THAWANI_MODE, e.OMNIFUL_ENV, e.servicesMode]).toEqual([undefined, undefined, "live"]);
    expect(e.ignored).toEqual(["SERVICES_MODE", "THAWANI_MODE", "OMNIFUL_ENV"]);
    expect(loadEnv({ THAWANI_MODE: "live" }).ignored).toEqual([]);
    const { warnings } = await import("../../../src/server/domain/health");
    expect(warnings(e)).toEqual(expect.arrayContaining(["env_value_ignored:THAWANI_MODE", "env_value_ignored:OMNIFUL_ENV"]));
  });
});

describe("a cold start that fails", () => {
  it("is not kept: the next call builds again", async () => {
    await expect(getDeps({ ...NETLIFY, SERVICES_MODE: "fake" })).rejects.toThrow(/refused in production/);
    const { deps } = await getDeps({ SERVICES_MODE: "fake", DATA_DIR: "memory" });
    expect(deps.env.servicesMode).toBe("fake");
  });

  it("answers 503 JSON (the storefront keeps a cash order and sends it again), logs the reason once, never to the caller", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = bootFailure(new EnvError("SERVICES_MODE=fake is refused in production"));
    expect(r.status).toBe(503);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    expect(await r.json()).toEqual({ ok: false, error: "server_unavailable", reason: "fake_in_production" });
    bootFailure(new EnvError("SERVICES_MODE=fake is refused in production"));
    expect(err).toHaveBeenCalledTimes(1);
    // a zod refusal names the variable, never its value
    let zerr: unknown;
    // (a wrong string is now treated as unset, so a refusal needs a non-string — the shape is what matters)
    try { loadEnv({ THAWANI_MODE: ["sk_live_secret"] as unknown as string }); } catch (e) { zerr = e; }
    const z = bootFailure(zerr);
    const zj = await z.text();
    expect(JSON.parse(zj)).toEqual({ ok: false, error: "server_unavailable", reason: "config_refused", vars: ["THAWANI_MODE"] });
    expect(zj).not.toMatch(/sk_live_secret/);
    expect(String(err.mock.calls.at(-1)![0])).toMatch(/THAWANI_MODE/);
    expect(String(err.mock.calls.at(-1)![0])).not.toMatch(/sk_live_secret/);
  });

  it("says which kind of start failed, in a code the panel words (no error text: a database error can name its host)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getDeps({ SITE_ID: NETLIFY.SITE_ID, DATABASE_URL: "" })).rejects.toThrow(/DATABASE_URL is required/);
    const miss = bootFailure(new Error("DATABASE_URL is required in production"));
    expect(await miss.json()).toEqual({ ok: false, error: "server_unavailable", reason: "database_url_missing" });
    const other = await bootFailure(new Error("getaddrinfo ENOTFOUND db.secret-host.supabase.co")).text();
    expect(JSON.parse(other)).toEqual({ ok: false, error: "server_unavailable", reason: "database_unreachable" });
    expect(JSON.parse(await bootFailure(new Error("something else entirely")).text()).reason).toBe("start_failed");
    expect(other).not.toMatch(/secret-host/);
  });

  it("the function handler: 503 while the configuration is refused, the app once it is fixed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const keep = { ...process.env };
    try {
      Object.assign(process.env, { SITE_ID: NETLIFY.SITE_ID, SERVICES_MODE: "fake", DATA_DIR: "memory", DATABASE_URL: "" });
      const handle = netlifyHandler();
      const a = await handle(new Request("https://lubanmusk.com/api/settings"));
      expect([a.status, await a.json()]).toEqual([503, { ok: false, error: "server_unavailable", reason: "fake_in_production" }]);
      delete process.env.SITE_ID;
      const b = await handle(new Request("https://lubanmusk.com/api/settings"));
      expect(b.status).toBe(200);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
    }
  });
});

describe("the visitor's country on Netlify (no edge function any more)", () => {
  it("comes from the function Context, written as the x-nf-geo header the app reads; a client's own header never wins", async () => {
    const { withGeo } = await import("../../../src/server/bootstrap");
    const { edgeCountry, edgeGeo } = await import("../../../src/server/core/http");
    const read = (req: Request) => {
      const c = { req: { header: (n: string) => req.headers.get(n) || undefined } } as never;
      return { country: edgeCountry(c), geo: edgeGeo(c) };
    };
    const plain = new Request("https://lubanmusk.com/api/geo");
    expect(read(withGeo(plain, { geo: { country: { code: "ae" }, city: "Dubai", latitude: 25.2048, longitude: 55.2708 } }))).toEqual({
      country: "AE",
      geo: { city: "Dubai", lat: 25.2, lng: 55.3 },
    });
    expect(read(withGeo(plain, undefined)).country).toBe("");
    expect(read(withGeo(plain, { geo: null })).country).toBe("");
    expect(read(withGeo(plain, { geo: { country: { code: "XXX" } } })).country).toBe("");
    const spoofed = new Request("https://lubanmusk.com/api/geo", { headers: { "x-nf-geo": Buffer.from(JSON.stringify({ country: { code: "SA" } })).toString("base64") } });
    expect(read(withGeo(spoofed, { geo: { country: { code: "OM" } } })).country).toBe("OM");
    // the body and method survive the rewrap
    const post = new Request("https://lubanmusk.com/api/order", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    const w = withGeo(post, { geo: { country: { code: "QA" } } });
    expect([w.method, await w.text(), w.headers.get("content-type")]).toEqual(["POST", "{}", "application/json"]);
  });
});

describe("the original's variable values", () => {
  it("THAWANI_MODE=test (the original's .env.example) is uat, not a refused setting that would 503 the whole API", () => {
    expect(loadEnv({ THAWANI_MODE: "test" }).THAWANI_MODE).toBe("uat");
    expect(loadEnv({ THAWANI_MODE: " Live " }).THAWANI_MODE).toBe("live");
  });

  it("a value that is none of the choices is treated as unset and named, never refused (a typo must not 503 the API)", async () => {
    const e = loadEnv({ THAWANI_MODE: "sandbox", OMNIFUL_ENV: "prod", SERVICES_MODE: "fakes" });
    expect([e.THAWANI_MODE, e.OMNIFUL_ENV, e.servicesMode]).toEqual([undefined, undefined, "live"]);
    expect(e.ignored).toEqual(["SERVICES_MODE", "THAWANI_MODE", "OMNIFUL_ENV"]);
    expect(loadEnv({ THAWANI_MODE: "live" }).ignored).toEqual([]);
    const { warnings } = await import("../../../src/server/domain/health");
    expect(warnings(e)).toEqual(expect.arrayContaining(["env_value_ignored:THAWANI_MODE", "env_value_ignored:OMNIFUL_ENV"]));
  });
});

describe("the database connection on Netlify", () => {
  it("asks for TLS to a remote host (Supabase requires it) and leaves a local test database and an explicit sslmode alone", async () => {
    const { needsTls } = await import("../../../src/server/db/client");
    expect(needsTls("postgres://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres")).toBe(true);
    expect(needsTls("postgres://u:p@127.0.0.1:5432/lm")).toBe(false);
    expect(needsTls("postgres://u:p@localhost/lm")).toBe(false);
    expect(needsTls("postgres://u:p@db.example.com/lm?sslmode=disable")).toBe(false);
    expect(needsTls("not a url")).toBe(false);
  });
});

describe("moved over with the original's variables only", () => {
  it("signs sessions with a key derived from the admin password when SESSION_SECRET is absent (as the original did), and says so", async () => {
    const e = loadEnv({ ADMIN_USER: "shopkeeper", ADMIN_PASSWORD: "old-site-password" });
    expect(e.sessionSecretDerived).toBe(true);
    expect(String(e.SESSION_SECRET).length).toBeGreaterThanOrEqual(32);
    const { authConfigured } = await import("../../../src/server/domain/admin/auth");
    expect(authConfigured(e)).toBe(true);
    const { warnings } = await import("../../../src/server/domain/health");
    expect(warnings(e)).toContain("session_secret_derived");
    // a real secret wins, and no password means no derived secret
    expect(loadEnv({ ADMIN_PASSWORD: "p", SESSION_SECRET: "s".repeat(40) }).sessionSecretDerived).toBe(false);
    expect(loadEnv({ ADMIN_USER: "shopkeeper" }).SESSION_SECRET).toBeUndefined();
    // the derived key changes with the password: a new password signs everyone out, as before
    expect(loadEnv({ ADMIN_PASSWORD: "a" }).SESSION_SECRET).not.toBe(loadEnv({ ADMIN_PASSWORD: "b" }).SESSION_SECRET);
  });

  it("LM_AUTO_SETUP=off switches the first-run setup off", () => {
    expect(loadEnv({}).autoSetup).toBe(true);
    expect(loadEnv({ LM_AUTO_SETUP: "off" }).autoSetup).toBe(false);
  });
});
