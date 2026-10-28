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
    expect(() => loadEnv({ THAWANI_MODE: "sandbox" })).toThrow();
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
    expect(await r.json()).toEqual({ ok: false, error: "server_unavailable" });
    bootFailure(new EnvError("SERVICES_MODE=fake is refused in production"));
    expect(err).toHaveBeenCalledTimes(1);
    // a zod refusal names the variable, never its value
    let zerr: unknown;
    try { loadEnv({ THAWANI_MODE: "sk_live_secret" }); } catch (e) { zerr = e; }
    bootFailure(zerr);
    expect(String(err.mock.calls.at(-1)![0])).toMatch(/THAWANI_MODE/);
    expect(String(err.mock.calls.at(-1)![0])).not.toMatch(/sk_live_secret/);
  });

  it("the function handler: 503 while the configuration is refused, the app once it is fixed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const keep = { ...process.env };
    try {
      Object.assign(process.env, { SITE_ID: NETLIFY.SITE_ID, SERVICES_MODE: "fake", DATA_DIR: "memory", DATABASE_URL: "" });
      const handle = netlifyHandler();
      const a = await handle(new Request("https://lubanmusk.com/api/settings"));
      expect([a.status, await a.json()]).toEqual([503, { ok: false, error: "server_unavailable" }]);
      delete process.env.SITE_ID;
      const b = await handle(new Request("https://lubanmusk.com/api/settings"));
      expect(b.status).toBe(200);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
    }
  });
});
