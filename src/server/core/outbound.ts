/**
 * The one way out to the network. Every call has a timeout that covers the body, and
 * respects the request's deadline (a serverless invocation has ~10 s; a call that cannot
 * finish in time is refused before it is sent, `unsent`, so the caller knows nothing
 * reached the other side).
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class OutboundError extends Error {
  constructor(
    message: string,
    readonly code: "timeout" | "unreachable" | "unsent" | "http",
    readonly status?: number,
    readonly body?: unknown,
    /** true when the request never left (safe to retry; nothing happened) */
    readonly unsent = false,
  ) {
    super(message);
    this.name = "OutboundError";
  }
}

export interface CallOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  timeoutMs?: number;
  /** absolute ms epoch by which the call must be done */
  deadline?: number;
  /** parse the answer as JSON (default true) */
  json?: boolean;
}

export interface CallResult<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  headers: Headers;
}

export async function call<T = unknown>(fetchImpl: FetchLike, url: string, opts: CallOptions = {}): Promise<CallResult<T>> {
  let timeout = opts.timeoutMs ?? 8000;
  if (opts.deadline) {
    const left = opts.deadline - Date.now() - 150;
    if (left < 400) throw new OutboundError("no time left for " + new URL(url).host, "unsent", undefined, undefined, true);
    timeout = Math.min(timeout, left);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const headers = new Headers(opts.headers);
  let body: string | URLSearchParams | undefined;
  if (opts.body !== undefined) {
    if (typeof opts.body === "string" || opts.body instanceof URLSearchParams) body = opts.body;
    else {
      body = JSON.stringify(opts.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
  }
  try {
    const res = await fetchImpl(url, { ...opts, headers, body, signal: ctl.signal });
    const text = await res.text();
    let data: unknown = text;
    if (opts.json !== false && text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, ok: res.ok, data: data as T, headers: res.headers };
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    if (err && err.name === "AbortError") throw new OutboundError("timed out after " + timeout + " ms", "timeout");
    const refused = err?.cause?.code === "ECONNREFUSED" || err?.cause?.code === "ENOTFOUND";
    throw new OutboundError(String((e as Error)?.message || e), "unreachable", undefined, undefined, refused);
  } finally {
    clearTimeout(timer);
  }
}
