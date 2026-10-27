import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, issueSession, LOGIN_TIMING, readSession, same, verifyHash } from "../../../src/server/domain/admin/auth";
import { loadEnv } from "../../../src/server/env";
import { createHarness, type Harness } from "../../helpers/harness";
import { adminClient, call, cookieOf, ORIGIN, signIn, SPA_HEADERS, trail } from "./_helpers";

describe("passwords and session tokens", () => {
  it("hashes with scrypt and checks in constant time", async () => {
    const h = await hashPassword("correct-horse");
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyHash("correct-horse", h)).toBe(true);
    expect(await verifyHash("correct-horsE", h)).toBe(false);
    expect(await verifyHash("correct-horse", "scrypt$1$1$1$x$y")).toBe(false);
    expect(await hashPassword("correct-horse")).not.toBe(h); // salted
  });

  // from test-v300.js: auth — sameSecret / no password, no token / tampered
  it("compares and signs", () => {
    expect(same("k", "k")).toBe(true);
    expect(same("k", "K")).toBe(false);
    const env = loadEnv({ ADMIN_USER: "a", ADMIN_PASSWORD: "p", SESSION_SECRET: "s".repeat(40) });
    const { token } = issueSession(env, 1000);
    expect(readSession(env, token, 2000)?.user).toBe("a");
    // tampered
    const [p, m] = token.split(".");
    expect(readSession(env, p + "x." + m, 2000)).toBeNull();
    expect(readSession(env, token.slice(0, -2) + "AA", 2000)).toBeNull();
    // expired after 12 hours
    expect(readSession(env, token, 1000 + 12 * 3600e3)).toBeNull();
    // no password, no session — even a token signed while one was set
    expect(readSession(loadEnv({ ADMIN_USER: "a", SESSION_SECRET: "s".repeat(40) }), token, 2000)).toBeNull();
    // no (or too short a) secret, no session
    expect(readSession(loadEnv({ ADMIN_USER: "a", ADMIN_PASSWORD: "p" }), token, 2000)).toBeNull();
    expect(readSession(loadEnv({ ADMIN_USER: "a", ADMIN_PASSWORD: "p", SESSION_SECRET: "short" }), token, 2000)).toBeNull();
    // from test-v329.js: another SESSION_SECRET → the old tokens are invalid, new ones valid
    const env2 = loadEnv({ ADMIN_USER: "a", ADMIN_PASSWORD: "p", SESSION_SECRET: "t".repeat(40) });
    expect(readSession(env2, token, 2000)).toBeNull();
    expect(readSession(env2, issueSession(env2, 1000).token, 2000)?.user).toBe("a");
    // new: a new password signs everyone out too
    expect(readSession(loadEnv({ ADMIN_USER: "a", ADMIN_PASSWORD: "p2", SESSION_SECRET: "s".repeat(40) }), token, 2000)).toBeNull();
    // two tokens issued the same millisecond differ (the nonce)
    expect(issueSession(env, 1000).token).not.toBe(issueSession(env, 1000).token);
  });
});

describe("signing in", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
  });
  afterAll(async () => {
    LOGIN_TIMING.padMs = 0;
  });

  it("sets an HttpOnly, Secure, SameSite=Strict cookie for 12 hours and answers the session", async () => {
    const res = await signIn(h);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, user: "shopkeeper" });
    const set = res.headers.get("set-cookie")!;
    expect(set).toMatch(/^lm_admin=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43};/);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Strict");
    expect(set).toContain("Path=/api/admin");
    expect(set).toContain("Max-Age=43200");
    // the password is never in the answer
    expect(res.text).not.toContain("correct-horse");
    const s = await call(h, "GET", "/session", { headers: { cookie: cookieOf(res) } });
    expect(s.body).toMatchObject({ ok: true, signedIn: true, configured: true, user: "shopkeeper" });
    expect((await call(h, "GET", "/session")).body).toEqual({ ok: true, signedIn: false, configured: true });
  });

  it("is not Secure on plain http://localhost", async () => {
    const res = await h.app.request("http://localhost:8888/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-lm-admin": "1" },
      body: JSON.stringify({ user: "shopkeeper", password: "correct-horse-battery" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("reads the user name without case or spaces; a wrong password is 401", async () => {
    expect((await signIn(h, "  ShopKeeper ")).status).toBe(200);
    const bad = await signIn(h, "shopkeeper", "wrong");
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ ok: false, error: "bad_credentials" });
    expect(bad.headers.get("set-cookie")).toBeNull();
    expect((await signIn(h, "other", "correct-horse-battery")).status).toBe(401);
  });

  // from test-v202.js: a body of "null" is a wrong password, not a crash
  it("treats a null body as a wrong password", async () => {
    const r = await call(h, "POST", "/login", { raw: "null", headers: SPA_HEADERS });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("bad_input");
  });

  it("logs out (the cookie cleared) and can sign every browser out", async () => {
    const a = await adminClient(h);
    const b = await adminClient(h);
    const out = await call(h, "POST", "/logout", { body: {}, headers: { ...SPA_HEADERS, cookie: a.cookie } });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/^lm_admin=;.*Max-Age=0/);
    h.clock.advance(1000);
    await call(h, "POST", "/logout", { body: { everywhere: true }, headers: { ...SPA_HEADERS, cookie: a.cookie } });
    expect((await b.get("/orders")).status).toBe(401);
    expect((await call(h, "GET", "/session", { headers: { cookie: b.cookie } })).body.signedIn).toBe(false);
    h.clock.advance(1000);
    const c = await adminClient(h);
    expect((await c.get("/orders")).status).toBe(200);
  });

  it("records the sign-in on the trail", async () => {
    await signIn(h);
    const t = await trail(h);
    expect(t.map((r) => r.action)).toEqual(["session.login"]);
    expect(t[0]!.actor).toBe("shopkeeper");
  });
});

describe("not configured", () => {
  it("no SESSION_SECRET (or user, or password): no login, no session", async () => {
    const envs: Array<Record<string, string>> = [{ SESSION_SECRET: "" }, { ADMIN_USER: "" }, { ADMIN_PASSWORD: "" }, { SESSION_SECRET: "too-short" }];
    for (const env of envs) {
      const h = await createHarness({ env });
      const r = await signIn(h);
      expect(r.status).toBe(503);
      expect(r.body.error).toBe("not_configured");
      expect((await call(h, "GET", "/orders")).body.error).toBe("not_configured");
      expect((await call(h, "GET", "/session")).body).toEqual({ ok: true, signedIn: false, configured: false });
    }
  });

  it("signs in with ADMIN_PASSWORD_HASH (preferred over the plain password)", async () => {
    const hash = await hashPassword("from-the-hash");
    const h = await createHarness({ env: { ADMIN_PASSWORD_HASH: hash } });
    expect((await signIn(h, "shopkeeper", "from-the-hash")).status).toBe(200);
    expect((await signIn(h, "shopkeeper", "correct-horse-battery")).status).toBe(401);
  });
});

// from test-login-lockout.js
describe("the lockout", () => {
  let h: Harness;
  const ip = "203.0.113.9";
  const tryLogin = (password: string) => signIn(h, "till-keeper-x", password, ip);
  beforeAll(async () => {
    h = await createHarness({ env: { ADMIN_USER: "till-keeper-x", ADMIN_PASSWORD: "correct-horse" } });
  });
  beforeEach(async () => {
    await h.reset();
    LOGIN_TIMING.padMs = 0;
  });

  it("locks an address out after 8 failures, even for the right password, until the window clears", async () => {
    expect((await tryLogin("wrong")).status).toBe(401);
    for (let i = 0; i < 7; i++) expect((await tryLogin("wrong")).status).toBe(401);
    const locked = await tryLogin("wrong");
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ ok: false, error: "too_many_attempts", retry_after_min: 15 });
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(locked.headers.get("retry-after"))).toBeLessThanOrEqual(900);
    expect((await tryLogin("correct-horse")).status).toBe(429);
    // another address is not locked
    expect((await signIn(h, "till-keeper-x", "correct-horse", "198.51.100.4")).status).toBe(200);
    // the window rolls over
    h.clock.advance(15 * 60e3 + 1000);
    const good = await tryLogin("correct-horse");
    expect(good.status).toBe(200);
    expect(cookieOf(good)).toMatch(/^lm_admin=/);
    // a success clears the counter
    expect((await tryLogin("wrong")).status).toBe(401);
  });

  // from test-v202.js: once locked out, further tries write nothing more
  it("counts nothing more once locked", async () => {
    const { rateLimits } = await import("../../../src/server/db/schema");
    for (let i = 0; i < 8; i++) await tryLogin("wrong");
    const before = (await h.db.select().from(rateLimits)).map((r) => r.count).sort();
    for (let i = 0; i < 25; i++) expect((await tryLogin("wrong")).status).toBe(429);
    const after = (await h.db.select().from(rateLimits)).map((r) => r.count).sort();
    expect(after).toEqual(before);
    // the counter keys never hold the address
    expect(JSON.stringify(await h.db.select().from(rateLimits))).not.toContain(ip);
  });

  it("stops a parallel guesser: 50 at once, at least 40 refused", async () => {
    const res = await Promise.all(Array.from({ length: 50 }, () => tryLogin("guess")));
    expect(res.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(40);
  });

  it("has a ceiling across every address (60 in 15 minutes)", async () => {
    for (let i = 0; i < 60; i++) await signIn(h, "till-keeper-x", "wrong", "10.0.0." + (i % 250));
    const r = await signIn(h, "till-keeper-x", "correct-horse", "10.1.1.1");
    expect(r.status).toBe(429);
  });

  it("smooths every answered attempt to at least 350 ms", async () => {
    LOGIN_TIMING.padMs = 350;
    for (const pw of ["wrong", "correct-horse"]) {
      const t0 = performance.now();
      await tryLogin(pw);
      expect(performance.now() - t0).toBeGreaterThanOrEqual(340);
    }
    LOGIN_TIMING.padMs = 0;
  });
});

describe("the door (CSRF, auth before the body)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });

  // from test-trash.js / test-v300.js: no token → 401; no token + bad JSON → 401 (the body is never read)
  it("refuses without a session before reading anything", async () => {
    expect((await call(h, "GET", "/orders")).status).toBe(401);
    const r = await call(h, "POST", "/orders/bulk", { raw: "{not json", headers: SPA_HEADERS });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ ok: false, error: "unauthorised" });
    expect((await call(h, "GET", "/no-such-thing")).status).toBe(401);
    expect((await call(h, "GET", "/orders", { headers: { cookie: "lm_admin=forged.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } })).status).toBe(401);
  });

  it("a write without X-LM-Admin, or from another site, is refused 403 — even signed in", async () => {
    const a = await adminClient(h);
    const base = { cookie: a.cookie };
    const body = { op: "flag", ids: ["LM-1000000001"], on: true };
    expect((await call(h, "POST", "/orders/bulk", { body, headers: base })).status).toBe(403);
    expect((await call(h, "POST", "/orders/bulk", { body, headers: { ...base, "x-lm-admin": "1", "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await call(h, "POST", "/orders/bulk", { body, headers: { ...base, "x-lm-admin": "1", "sec-fetch-site": "same-site" } })).status).toBe(403);
    expect((await call(h, "POST", "/orders/bulk", { body, headers: { ...base, "x-lm-admin": "1", origin: "https://evil.example" } })).status).toBe(403);
    // the login too
    expect((await call(h, "POST", "/login", { body: { user: "shopkeeper", password: "correct-horse-battery" } })).status).toBe(403);
    // same origin, the header: in
    const ok = await call(h, "POST", "/orders/bulk", { body, headers: { ...base, "x-lm-admin": "1", origin: ORIGIN } });
    expect(ok.status).toBe(200);
    // GET needs no header
    expect((await a.get("/orders")).status).toBe(200);
  });

  it("answers no-store, noindex", async () => {
    const a = await adminClient(h);
    for (const r of [await a.get("/orders"), await call(h, "GET", "/orders")]) {
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it("validates every body: 400 bad_input with the issues", async () => {
    const a = await adminClient(h);
    const r = await a.post("/orders/bulk", { op: "status", ids: ["nope"], to: "flying" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("bad_input");
    expect(r.body.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(["ids.0", "to"]));
    const j = await call(h, "POST", "/orders/bulk", { raw: "{oops", headers: { ...SPA_HEADERS, cookie: a.cookie } });
    expect(j.body.error).toBe("bad_json");
    // from test-v300.js: unknown names (constructor, hasOwnProperty) are not routes
    expect((await a.get("/constructor")).status).toBe(404);
    expect((await a.post("/hasOwnProperty")).status).toBe(404);
  });
});
