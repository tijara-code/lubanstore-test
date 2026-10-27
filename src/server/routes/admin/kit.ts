/**
 * What every admin route shares: the guard (headers, CSRF, the session — in that order, all
 * before a body is read), input validation with zod, and the audit call.
 *
 * The guard, for every path under /api/admin:
 *   1. the answer is never cached and never indexed (no-store, X-Robots-Tag noindex);
 *   2. a request that changes anything (not GET/HEAD) must carry `X-LM-Admin: 1` — a header a
 *      cross-site form cannot send and a cross-site script cannot send without a CORS
 *      preflight this app never answers — and must not say it is cross-site: `Sec-Fetch-Site`,
 *      when the browser sends it, is same-origin, and `Origin`, when sent, is this site's;
 *   3. the session cookie is checked (except /login, /session, /logout): 401 `unauthorised`,
 *      or 503 `not_configured` while the server has no user, password or SESSION_SECRET.
 * A body larger than 1 MB is refused (413) before it is read.
 */
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { z } from "zod";
import { SESSION_COOKIE } from "../../../shared/admin/api";
import type { AppEnv, Deps } from "../../core/deps";
import { fail, rawBody, readJson } from "../../core/http";
import { authConfigured, readSession, sessionsSince } from "../../domain/admin/auth";
import { idsOf, recordAudit, summaryOf } from "../../domain/admin/audit";

export type Ctx = Context<AppEnv>;

export const ADMIN_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const OPEN = new Set(["/login", "/session", "/logout"]);
export const MAX_BODY = 1_000_000;

function origins(c: Ctx, deps: Deps): string[] {
  const out = new Set<string>();
  try {
    out.add(new URL(c.req.url).origin);
  } catch {
    /* no URL */
  }
  if (deps.env.siteUrl) out.add(deps.env.siteUrl);
  const host = c.req.header("x-forwarded-host") || c.req.header("host");
  if (host) out.add((c.req.header("x-forwarded-proto") || "https") + "://" + host);
  return [...out];
}

/** Refuses a request that could have been made by another site. */
export function sameOrigin(c: Ctx, deps: Deps): void {
  if (c.req.header("x-lm-admin") !== "1") throw fail("forbidden", 403, { why: "header" });
  const site = String(c.req.header("sec-fetch-site") || "").trim().toLowerCase();
  if (site && site !== "same-origin") throw fail("forbidden", 403, { why: "cross_site" });
  const origin = String(c.req.header("origin") || "").trim();
  if (origin && origins(c, deps).indexOf(origin.replace(/\/+$/, "")) < 0) throw fail("forbidden", 403, { why: "origin" });
}

/** The relative path inside /api/admin. */
export function relPath(c: Ctx): string {
  const p = new URL(c.req.url).pathname;
  return p.replace(/^\/api\/admin/, "") || "/";
}

export function guard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    for (const [k, v] of Object.entries(ADMIN_HEADERS)) c.header(k, v);
    const deps = c.get("deps");
    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      sameOrigin(c, deps);
      const len = Number(c.req.header("content-length") || 0);
      if (len > MAX_BODY) throw fail("too_large", 413);
    }
    if (!OPEN.has(relPath(c))) {
      if (!authConfigured(deps.env)) throw fail("not_configured", 503);
      const s = readSession(deps.env, getCookie(c, SESSION_COOKIE), deps.now());
      if (!s) throw fail("unauthorised", 401);
      const since = await sessionsSince(deps);
      if (since && s.iat < since) throw fail("unauthorised", 401);
      c.set("admin", s.user);
    }
    await next();
    for (const [k, v] of Object.entries(ADMIN_HEADERS)) c.res.headers.set(k, v);
  };
}

/* ---------------- input ---------------- */

export function issuesOf(error: z.ZodError, prefix: string[] = []) {
  return error.issues.slice(0, 10).map((i) => ({ path: [...prefix, ...i.path.map(String)].join(".") || "(body)", message: i.message }));
}

/** The JSON body, validated: 400 bad_json / bad_input (with the issues). */
export async function body<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> {
  if ((await rawBody(c)).length > MAX_BODY) throw fail("too_large", 413);
  const raw = await readJson(c);
  const r = schema.safeParse(raw);
  if (!r.success) throw fail("bad_input", 400, { issues: issuesOf(r.error) });
  return r.data;
}

/** The query string, validated (empty values are treated as absent). */
export function query<S extends z.ZodType>(c: Ctx, schema: S): z.infer<S> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.req.query())) if (v !== "") q[k] = v;
  const r = schema.safeParse(q);
  if (!r.success) throw fail("bad_input", 400, { issues: issuesOf(r.error, ["query"]) });
  return r.data;
}

export function actor(c: Ctx): string {
  return c.get("admin") || "admin";
}

/* ---------------- the trail ---------------- */

/**
 * Record a write that succeeded. `target` defaults to the ids the request and answer name;
 * `summary` to the request in small (no customer fields). Never fails the answer.
 */
export async function audit(
  c: Ctx,
  action: string,
  o: { body?: unknown; answer?: unknown; target?: string | null; summary?: Record<string, unknown> } = {},
): Promise<void> {
  const deps = c.get("deps");
  const target = o.target !== undefined ? o.target : idsOf(c.req.param() as Record<string, string>, o.body, o.answer).join(",") || null;
  await recordAudit(deps, { actor: actor(c), action, target, summary: o.summary || summaryOf(o.body, o.answer) });
}

/** A file to download, never cached. */
export function download(c: Ctx, name: string, type: string, text: string): Response {
  return c.body(text, 200, {
    ...ADMIN_HEADERS,
    "Content-Type": type,
    "Content-Disposition": 'attachment; filename="' + name.replace(/[^\w.-]/g, "_") + '"',
  });
}
