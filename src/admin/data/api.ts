/**
 * THE CLIENT FOR /api/admin — the only place the panel talks to the server.
 *
 *   get<T>(path, query?)            GET, query values that are undefined/null/"" are left out
 *   send<T>(method, path, body?)    POST/PUT/PATCH/DELETE with the CSRF header and JSON
 *   urlOf(path, query?)             an address for a download link (CSV export)
 *
 * Every request carries the session cookie (`credentials: "same-origin"`; the panel never sees
 * the credential). Every non-GET carries `X-LM-Admin: 1`. An answer that is not `{ ok: true }`
 * becomes an ApiError with the server's code (`bad_credentials`, `stale`, `moving_back`, …),
 * its HTTP status and the rest of the refusal (`ids`, `detail`, `retryAfter`, …). A network
 * failure is `network`. A 401 on any path but /login tells every `onUnauthorised` listener (the
 * app shows the sign-in gate again).
 */
// the constants module, not ./api: that one re-exports the zod schemas (server-only)
import { API, CSRF_HEADER } from "../../shared/admin/constants";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(code: string, status: number, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export function qs(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  const s = p.toString();
  return s ? "?" + s : "";
}

export function urlOf(path: string, query?: Query): string {
  return API + path + qs(query);
}

const unauthorised = new Set<() => void>();
/** Called when the server says the session is gone (401). Returns the unsubscribe. */
export function onUnauthorised(fn: () => void): () => void {
  unauthorised.add(fn);
  return () => unauthorised.delete(fn);
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function request<T>(method: Method, path: string, opts: { query?: Query; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (method !== "GET") {
    headers[CSRF_HEADER] = "1";
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body === undefined ? {} : opts.body);
  }
  let res: Response;
  try {
    res = await fetch(urlOf(path, opts.query), { method, headers, body, credentials: "same-origin", cache: "no-store", signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new ApiError("network", 0);
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (res.status === 401 && path !== "/login") for (const fn of [...unauthorised]) fn();
  if (!res.ok || !json || json.ok !== true) {
    const { error, ok: _ok, ...extra } = json || {};
    void _ok;
    const retry = res.headers.get("Retry-After");
    if (retry && extra.retryAfter === undefined) extra.retryAfter = Number(retry);
    throw new ApiError(String(error || (res.status ? "http_" + res.status : "network")), res.status, extra);
  }
  return json as T;
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>("GET", path, { query, signal });
export const send = <T>(method: Exclude<Method, "GET">, path: string, body?: unknown) => request<T>(method, path, { body });
