/**
 * The admin API from a test: a signed-in client over the harness (cookie, CSRF header and
 * same-origin headers as the SPA sends them).
 */
import { LOGIN_TIMING } from "../../../src/server/domain/admin/auth";
import type { Harness } from "../../helpers/harness";

LOGIN_TIMING.padMs = 0;

export const ORIGIN = "https://lubanmusk.test";
export const USER = "shopkeeper";
export const PASSWORD = "correct-horse-battery";

export interface Answer {
  status: number;
  body: any;
  headers: Headers;
  text: string;
}

async function read(res: Response): Promise<Answer> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers, text };
}

export function cookieOf(res: Answer | Response): string {
  const set = res.headers.get("set-cookie") || "";
  return set.split(";")[0] || "";
}

/** A raw call: no cookie, no CSRF header unless given. */
export async function call(h: Harness, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; raw?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  let payload: string | undefined;
  if (opts.raw !== undefined) payload = opts.raw;
  else if (opts.body !== undefined) payload = JSON.stringify(opts.body);
  if (payload !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
  return read(await h.request("/api/admin" + path, { method, headers, body: payload }));
}

export const SPA_HEADERS = { "x-lm-admin": "1", "sec-fetch-site": "same-origin", origin: ORIGIN };

export async function signIn(h: Harness, user = USER, password = PASSWORD, ip?: string): Promise<Answer> {
  return call(h, "POST", "/login", { body: { user, password }, headers: { ...SPA_HEADERS, ...(ip ? { "x-nf-client-connection-ip": ip } : {}) } });
}

export interface AdminClient {
  cookie: string;
  get(path: string): Promise<Answer>;
  post(path: string, body?: unknown): Promise<Answer>;
  put(path: string, body?: unknown): Promise<Answer>;
  patch(path: string, body?: unknown): Promise<Answer>;
  del(path: string, body?: unknown): Promise<Answer>;
}

export async function adminClient(h: Harness): Promise<AdminClient> {
  const res = await signIn(h);
  if (res.status !== 200) throw new Error("sign-in failed: " + res.status + " " + res.text);
  const cookie = cookieOf(res);
  const headers = { ...SPA_HEADERS, cookie };
  const m = (method: string) => (path: string, body?: unknown) => call(h, method, path, { body: body === undefined && method !== "GET" ? {} : body, headers });
  return { cookie, get: (p) => call(h, "GET", p, { headers: { cookie } }), post: m("POST"), put: m("PUT"), patch: m("PATCH"), del: m("DELETE") };
}

/** The audit rows, oldest first. */
export async function trail(h: Harness) {
  const { adminAudit } = await import("../../../src/server/db/schema");
  const { asc } = await import("drizzle-orm");
  return h.db.select().from(adminAudit).orderBy(asc(adminAudit.id));
}
