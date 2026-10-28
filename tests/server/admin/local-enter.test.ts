/**
 * GET /__fake/admin/enter — the local "no user or password" door (npm run admin:local,
 * open-admin.cmd): fake mode only, and only for a browser on this machine.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../../helpers/harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await (h.db as unknown as { $client?: { close?: () => Promise<void> } }).$client?.close?.();
});

describe("the local admin door", () => {
  it("on localhost: signs this browser in and goes to the panel", async () => {
    const r = await h.app.request("http://localhost:8888/__fake/admin/enter");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/admin/");
    const set = r.headers.get("set-cookie") || "";
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    const s = await h.app.request("http://localhost:8888/api/admin/session", { headers: { cookie: set.split(";")[0]! } });
    expect(await s.json()).toMatchObject({ ok: true, signedIn: true, user: "shopkeeper" });
  });

  it("refused from any other address, or through a proxy", async () => {
    const other = await h.app.request("https://lubanmusk.test/__fake/admin/enter");
    expect(other.status).toBe(403);
    expect(other.headers.get("set-cookie")).toBeNull();
    const fwd = await h.app.request("http://localhost:8888/__fake/admin/enter", { headers: { "x-forwarded-for": "198.51.100.4" } });
    expect(fwd.status).toBe(403);
  });

  it("is not there at all outside fake mode", async () => {
    const { createApp } = await import("../../../src/server/app");
    const { loadEnv } = await import("../../../src/server/env");
    const app = createApp({ ...h.deps, env: loadEnv({ SERVICES_MODE: "live", ADMIN_USER: "a", ADMIN_PASSWORD: "p", SESSION_SECRET: "s".repeat(40) }) });
    const r = await app.request("http://localhost:8888/__fake/admin/enter");
    expect(r.status).toBe(404);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});
