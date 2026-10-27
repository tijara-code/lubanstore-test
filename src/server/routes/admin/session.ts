/**
 * POST /api/admin/login { user, password } → 200 { ok, user, expiresAt } + the session cookie
 *   | 401 bad_credentials | 429 too_many_attempts (Retry-After) | 503 not_configured
 * POST /api/admin/logout { everywhere? } → 200, the cookie cleared (and, with `everywhere`
 *   from a signed-in browser, every session issued before now refused)
 * GET  /api/admin/session → { ok, signedIn, configured, user?, expiresAt? }
 */
import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { LoginBody, LogoutBody, SESSION_COOKIE, type SessionAnswer } from "../../../shared/admin/api";
import type { AppEnv } from "../../core/deps";
import { clientIp } from "../../core/http";
import { authConfigured, cookieHeader, login, readSession, secureFor, sessionsSince, SESSION_MS, signOutEverywhere } from "../../domain/admin/auth";
import { recordAudit } from "../../domain/admin/audit";
import { body } from "./kit";

export function registerSessionRoutes(r: Hono<AppEnv>): void {
  r.post("/login", async (c) => {
    const deps = c.get("deps");
    const out = await login(deps, clientIp(c), async () => {
      const b = await body(c, LoginBody);
      return { user: b.user, password: b.password };
    });
    c.header("Set-Cookie", cookieHeader(SESSION_COOKIE, out.token, { maxAge: SESSION_MS / 1000, secure: secureFor(c.req.url) }));
    await recordAudit(deps, { actor: out.session.user, action: "session.login", target: null, summary: null });
    return c.json({ ok: true, user: out.session.user, expiresAt: new Date(out.session.exp).toISOString() });
  });

  r.post("/logout", async (c) => {
    const deps = c.get("deps");
    const b = await body(c, LogoutBody).catch(() => ({ everywhere: false }));
    const s = readSession(deps.env, getCookie(c, SESSION_COOKIE), deps.now());
    if (s && b.everywhere === true) {
      await signOutEverywhere(deps);
      await recordAudit(deps, { actor: s.user, action: "session.logout_everywhere", target: null, summary: null });
    }
    c.header("Set-Cookie", cookieHeader(SESSION_COOKIE, "", { maxAge: 0, secure: secureFor(c.req.url) }));
    return c.json({ ok: true });
  });

  r.get("/session", async (c) => {
    const deps = c.get("deps");
    const configured = authConfigured(deps.env);
    const s = configured ? readSession(deps.env, getCookie(c, SESSION_COOKIE), deps.now()) : null;
    const since = s ? await sessionsSince(deps) : 0;
    const answer: SessionAnswer =
      s && !(since && s.iat < since)
        ? { ok: true, signedIn: true, configured, user: s.user, expiresAt: new Date(s.exp).toISOString() }
        : { ok: true, signedIn: false, configured };
    return c.json(answer);
  });
}
