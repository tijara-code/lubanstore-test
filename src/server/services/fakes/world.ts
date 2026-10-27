/**
 * THE FAKE WORLD: every outside service the server talks to, emulated in-process behind
 * `fetch`. The real clients run unchanged; only the network is fake. Used by the test
 * suites and by local development (SERVICES_MODE=fake) — never in production.
 *
 *   const world = createWorld();
 *   deps.fetch = world.fetch;
 *   world.calls        every outbound request, in order
 *   world.fail(fn)     inject failures: fn(call) → null | { status, body } | "timeout" | "refused"
 *
 * Each emulator owns a host pattern and its own state (world.thawani, world.omniful, …).
 */
import type { FetchLike } from "../../core/outbound";

export interface WorldCall {
  host: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  /** parsed JSON when the body is JSON, else the raw text */
  body: unknown;
  rawBody: string;
}

export type FailRule = (call: WorldCall) => null | undefined | "timeout" | "refused" | { status: number; body?: unknown };

export interface Emulator {
  /** does this emulator answer for this host? */
  matches(host: string): boolean;
  handle(call: WorldCall, world: World): Promise<Response> | Response;
}

export interface World {
  fetch: FetchLike;
  calls: WorldCall[];
  fail(rule: FailRule | null): void;
  use(name: string, emulator: Emulator): void;
  emulators: Record<string, Emulator>;
  /** a deterministic random stream (ids, keys) */
  random(): number;
  /** the world's clock (tests can move it) */
  now(): number;
  setNow(fn: () => number): void;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined || body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function createWorld(opts: { seed?: number } = {}): World {
  let rule: FailRule | null = null;
  let clock = () => Date.now();
  const world: World = {
    calls: [],
    emulators: {},
    random: prng(opts.seed || 20261027),
    now: () => clock(),
    setNow(fn) { clock = fn; },
    fail(r) { rule = r; },
    use(name, emulator) { world.emulators[name] = emulator; },
    fetch: async (input, init = {}) => {
      const req = input instanceof Request ? input : null;
      const url = new URL(req ? req.url : String(input));
      const method = String(init.method || req?.method || "GET").toUpperCase();
      const headers: Record<string, string> = {};
      new Headers(init.headers || req?.headers).forEach((v, k) => (headers[k] = v));
      const rawBody = init.body == null ? (req ? await req.clone().text() : "") : String(init.body);
      let body: unknown = rawBody || null;
      try { body = rawBody ? JSON.parse(rawBody) : null; } catch { /* keep text */ }
      const call: WorldCall = { host: url.host, method, path: url.pathname + url.search, headers, body, rawBody };
      world.calls.push(call);
      const f = rule && rule(call);
      if (f === "timeout") {
        return new Promise<Response>((_, reject) => {
          const sig = init.signal;
          sig?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      }
      if (f === "refused") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      if (f && typeof f === "object") return json(f.status, f.body);
      for (const e of Object.values(world.emulators)) if (e.matches(url.host)) return e.handle(call, world);
      return json(404, { error: "the fake world has no " + url.host });
    },
  };
  return world;
}
