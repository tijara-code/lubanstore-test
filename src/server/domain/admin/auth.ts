/**
 * WHO MAY USE THE PANEL — the password, the session cookie and the lockout.
 *
 * The password: ADMIN_PASSWORD_HASH (scrypt, made by `npm run admin:hash`), else the plain
 * ADMIN_PASSWORD (development). The user name is compared without case or surrounding space.
 * Every comparison is constant-time over fixed-length digests.
 *
 * The session: a cookie `lm_admin` = base64url(payload) "." base64url(HMAC-SHA256). The payload
 * is { u: user, iat, exp (12 h), n: nonce }. The HMAC key is derived from SESSION_SECRET, the
 * user name AND a fingerprint of the password (hash), so changing the password signs everyone
 * out (the original needed SESSION_SECRET rotated as well). "Sign out everywhere" stores an
 * instant in `ops`; a session issued before it is refused.
 *
 * No session is valid — and no login succeeds — while SESSION_SECRET (≥ 32 characters), the
 * user or the password is missing: a key anybody could guess signs nothing.
 *
 * The lockout (test-login-lockout, v202): per address 8 attempts in 15 minutes, and a ceiling
 * across every address (60 in 15 minutes) against a spread-out guesser. A locked door is
 * refused BEFORE anything is counted (a client hammering it grows nothing); otherwise the
 * attempt is counted BEFORE the password is checked, so fifty guesses in parallel cannot all
 * read a counter of zero. A success clears the address's count. Every answered attempt takes
 * at least 350 ms (timing smoothing; the counter does the throttling).
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { SESSION_HOURS } from "../../../shared/admin/api";
import type { Deps } from "../../core/deps";
import { fail } from "../../core/http";
import { getOpData, putOp } from "../../core/ops";
import { allow, clear, LIMITS, peek } from "../../core/ratelimit";
import type { Env } from "../../env";

export const SESSION_MS = SESSION_HOURS * 3600e3;
export const MIN_SECRET = 32;
export const SINCE_KEY = "admin_sessions_since";
/** every answered login attempt takes at least this long (tests may lower it) */
export const LOGIN_TIMING = { padMs: 350 };

const has = (v: unknown) => !!String(v ?? "").trim();

/* ---------------- constant-time ---------------- */

/** a === b without the time telling how much matched (digests: equal length always). */
export function same(a: unknown, b: unknown): boolean {
  const x = createHash("sha256").update(String(a ?? "")).digest();
  const y = createHash("sha256").update(String(b ?? "")).digest();
  return timingSafeEqual(x, y) && String(a ?? "") === String(b ?? "");
}

/* ---------------- the password hash ---------------- */

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 };

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}
const b64 = (b: Buffer) => b.toString("base64url");

/** "scrypt$N$r$p$<salt>$<key>" (base64url) — what `npm run admin:hash` prints. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(password.normalize("NFC"), salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 });
  return ["scrypt", N, r, p, b64(salt), b64(key)].join("$");
}

const HASH_RE = /^scrypt\$(\d{1,8})\$(\d{1,3})\$(\d{1,3})\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{16,})$/;

export function validHash(stored: unknown): boolean {
  const m = HASH_RE.exec(String(stored || "").trim());
  if (!m) return false;
  const N = Number(m[1]);
  return N >= 1024 && N <= 1 << 20 && (N & (N - 1)) === 0;
}

/** Does this password match the stored hash? A malformed hash matches nothing. */
export async function verifyHash(password: string, stored: string): Promise<boolean> {
  const m = HASH_RE.exec(String(stored || "").trim());
  if (!m || !validHash(stored)) return false;
  const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const salt = Buffer.from(m[4]!, "base64url");
  const want = Buffer.from(m[5]!, "base64url");
  let got: Buffer;
  try {
    got = await scrypt(String(password).normalize("NFC"), salt, want.length, { N, r, p, maxmem: 128 * N * r * 2 });
  } catch {
    return false;
  }
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ---------------- configuration ---------------- */

/** A user, a password (or its hash) and a long enough SESSION_SECRET. */
export function authConfigured(env: Env): boolean {
  const hash = String(env.ADMIN_PASSWORD_HASH || "").trim();
  return has(env.ADMIN_USER) && (hash ? validHash(hash) : has(env.ADMIN_PASSWORD)) && String(env.SESSION_SECRET || "").length >= MIN_SECRET;
}

const userOf = (env: Env) => String(env.ADMIN_USER || "").trim().toLowerCase();

/** user name and password, checked (the user without case; constant-time both ways). */
export async function checkCredentials(env: Env, user: string, password: string): Promise<boolean> {
  if (!authConfigured(env)) return false;
  const userOk = same(String(user || "").trim().toLowerCase(), userOf(env));
  const hash = String(env.ADMIN_PASSWORD_HASH || "").trim();
  const passOk = hash ? await verifyHash(password, hash) : same(String(password ?? ""), String(env.ADMIN_PASSWORD || ""));
  return userOk && passOk;
}

/* ---------------- the session token ---------------- */

export interface Session {
  user: string;
  iat: number;
  exp: number;
}

function signingKey(env: Env): Buffer {
  const cred = String(env.ADMIN_PASSWORD_HASH || "").trim() || String(env.ADMIN_PASSWORD || "");
  const fp = createHash("sha256").update("lm-admin-cred:" + cred).digest("hex");
  return createHmac("sha256", String(env.SESSION_SECRET || "")).update("lm-admin-session:" + userOf(env) + ":" + fp).digest();
}

export function issueSession(env: Env, now: number): { token: string; session: Session } {
  const session: Session = { user: String(env.ADMIN_USER || "").trim(), iat: now, exp: now + SESSION_MS };
  const payload = Buffer.from(JSON.stringify({ u: session.user, iat: session.iat, exp: session.exp, n: randomBytes(9).toString("base64url") })).toString("base64url");
  const mac = createHmac("sha256", signingKey(env)).update(payload).digest("base64url");
  return { token: payload + "." + mac, session };
}

/** The session a token stands for, or null (bad shape, bad signature, expired, not configured). */
export function readSession(env: Env, token: unknown, now: number): Session | null {
  if (!authConfigured(env)) return null;
  const t = String(token || "");
  if (t.length > 600) return null;
  const parts = t.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) return null;
  const want = createHmac("sha256", signingKey(env)).update(parts[0]!).digest();
  const got = Buffer.from(parts[1]!, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let p: { u?: unknown; iat?: unknown; exp?: unknown };
  try {
    p = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const iat = Number(p.iat), exp = Number(p.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= now || iat > now + 60e3 || exp - iat > SESSION_MS) return null;
  if (!same(String(p.u || "").toLowerCase(), userOf(env))) return null;
  return { user: String(p.u), iat, exp };
}

/** Sessions issued before this instant are refused ("sign out everywhere"). */
export async function sessionsSince(deps: Pick<Deps, "db">): Promise<number> {
  try {
    const d = await getOpData<{ at?: string }>(deps.db, SINCE_KEY, {});
    const t = Date.parse(String(d.at || ""));
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

export async function signOutEverywhere(deps: Pick<Deps, "db" | "now">): Promise<void> {
  await putOp(deps.db, SINCE_KEY, { at: new Date(deps.now()).toISOString() }, new Date(deps.now()));
}

/* ---------------- the cookie ---------------- */

export function cookieHeader(name: string, value: string, opts: { maxAge: number; secure: boolean }): string {
  return [
    name + "=" + value,
    "Path=/api/admin",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + Math.max(0, Math.floor(opts.maxAge)),
    ...(opts.secure ? ["Secure"] : []),
  ].join("; ");
}

/** Secure everywhere except plain http on this machine (local development). */
export function secureFor(url: string): boolean {
  try {
    const u = new URL(url);
    return !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname));
  } catch {
    return true;
  }
}

/* ---------------- the login ---------------- */

export interface LoginResult {
  token: string;
  session: Session;
}

async function pad(started: number): Promise<void> {
  const left = LOGIN_TIMING.padMs - (performance.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

function tooMany(retryAfter: number) {
  const s = Math.max(1, Math.ceil(retryAfter));
  return fail("too_many_attempts", 429, { retry_after_min: Math.ceil(LIMITS.login.windowMs / 60e3), retryAfter: s }, { "Retry-After": String(s) });
}

/**
 * One login attempt from `ip`. `readBody` is called only once the door is open (a locked-out
 * client's body is never parsed). Throws 503 not_configured, 429 too_many_attempts, 401
 * bad_credentials.
 */
export async function login(deps: Deps, ip: string, readBody: () => Promise<{ user: string; password: string }>): Promise<LoginResult> {
  const started = performance.now();
  if (!authConfigured(deps.env)) throw fail("not_configured", 503);
  const who = ip || "unknown";
  const now = deps.now();
  try {
    // locked already: refused before anything is written
    const [mine, all] = await Promise.all([peek(deps.db, "login", who, now), peek(deps.db, "loginGlobal", "all", now)]);
    if (!mine.ok || !all.ok) {
      await pad(started);
      throw tooMany(Math.max(mine.ok ? 0 : mine.retryAfter, all.ok ? 0 : all.retryAfter));
    }
    // counted before the password is looked at
    const [a, b] = await Promise.all([allow(deps.db, "login", who, now), allow(deps.db, "loginGlobal", "all", now)]);
    if (!a.ok || !b.ok) {
      await pad(started);
      throw tooMany(Math.max(a.ok ? 0 : a.retryAfter, b.ok ? 0 : b.retryAfter));
    }
    const body = await readBody();
    const ok = await checkCredentials(deps.env, body.user, body.password);
    await pad(started);
    if (!ok) throw fail("bad_credentials", 401);
    await clear(deps.db, "login", who).catch(() => {});
    return issueSession(deps.env, deps.now());
  } catch (e) {
    await pad(started);
    throw e;
  }
}
