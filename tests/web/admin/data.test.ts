/**
 * The admin's data layer: the API client (CSRF header, cookie credentials, refusals as
 * ApiError, a 401 back to the gate) and the query cache (shared reads, invalidation, the
 * "auto" refresh with the Orders list's `since` tag).
 */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, get, isApiError, onUnauthorised, qs, send } from "../../../src/admin/data/api";
import { clearQueries, fetchQuery, invalidate, lastSync, refreshActive, useQuery } from "../../../src/admin/data/query";
import { createStore, useStore } from "../../../src/admin/data/store";
import { listOrders } from "../../../src/admin/data/endpoints";
import { mount, settle, stubFetch } from "./_render";

afterEach(() => {
  vi.unstubAllGlobals();
  clearQueries();
  document.body.innerHTML = "";
});

describe("the API client", () => {
  it("every write carries X-LM-Admin: 1 and JSON; reads do not; the cookie goes along", async () => {
    const { calls } = stubFetch({ "GET /session": () => ({ ok: true, signedIn: false, configured: true }), "PUT /orders/LM-1001/flag": () => ({ ok: true, updated: 1 }) });
    await get("/session");
    await send("PUT", "/orders/LM-1001/flag", { on: true });
    expect(calls[0]!.headers["x-lm-admin"]).toBeUndefined();
    expect(calls[0]!.credentials).toBe("same-origin");
    expect(calls[1]!.headers["x-lm-admin"]).toBe("1");
    expect(calls[1]!.headers["content-type"]).toBe("application/json");
    expect(calls[1]!.body).toEqual({ on: true });
    expect(calls[1]!.credentials).toBe("same-origin");
  });

  it("a refusal is an ApiError with its code, status and the rest of the answer", async () => {
    stubFetch({ "POST /orders/LM-1001/status": () => [409, { ok: false, error: "moving_back", ids: ["LM-1001"] }] });
    const e = await send("POST", "/orders/LM-1001/status", { to: "new" }).catch((x) => x);
    expect(isApiError(e, "moving_back")).toBe(true);
    expect((e as ApiError).status).toBe(409);
    expect((e as ApiError).extra.ids).toEqual(["LM-1001"]);
  });

  it("a network failure is `network`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const e = await get("/overview").catch((x) => x);
    expect(isApiError(e, "network")).toBe(true);
  });

  it("a 401 tells the app (back to the gate) — except on /login, where it means a wrong password", async () => {
    const seen = vi.fn();
    const off = onUnauthorised(seen);
    stubFetch({ "/overview": () => [401, { ok: false, error: "unauthorised" }], "/login": () => [401, { ok: false, error: "bad_credentials" }] });
    await get("/overview").catch(() => null);
    expect(seen).toHaveBeenCalledTimes(1);
    await send("POST", "/login", { user: "x", password: "y" }).catch(() => null);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("query strings leave out empty values; booleans are 1/0", () => {
    expect(qs({ a: "", b: undefined, c: null, d: 0, e: true, f: "x y" })).toBe("?d=0&e=1&f=x+y");
    expect(qs({})).toBe("");
  });
});

describe("the query cache", () => {
  beforeEach(() => clearQueries());

  it("two screens asking one key share one request; the stamp is set", async () => {
    let n = 0;
    const f = async () => (++n, "data");
    await Promise.all([fetchQuery("k", f), fetchQuery("k", f)]);
    expect(n).toBe(1);
    expect(lastSync.get()).toBeGreaterThan(0);
  });

  it("useQuery reads on mount; invalidate re-reads what is on screen; an error is kept, not thrown", async () => {
    let n = 0;
    function Probe() {
      const q = useQuery("orders:x", async () => {
        n++;
        if (n === 3) throw new ApiError("server_error", 500);
        return "v" + n;
      });
      return h("p", null, q.loading ? "…" : q.error ? "err" : String(q.data));
    }
    const m = mount(h(Probe, null));
    await settle();
    expect(m.text()).toBe("v1");
    await invalidate("orders");
    await settle();
    expect(m.text()).toBe("v2");
    await refreshActive();
    await settle();
    expect(m.text()).toBe("err");
    m.unmount();
  });

  it("keep: the previous key's data stays on screen while the next page loads", async () => {
    const page = createStore(1);
    let release: () => void = () => {};
    function Probe() {
      const p = useStore(page);
      const q = useQuery("list:" + p, () => (p === 1 ? Promise.resolve("page 1") : new Promise<string>((r) => (release = () => r("page 2")))), { keep: true });
      return h("p", null, String(q.data) + (q.previous ? " (old)" : ""));
    }
    const m = mount(h(Probe, null));
    await settle();
    expect(m.text()).toBe("page 1");
    page.set(2);
    await settle();
    expect(m.text()).toBe("page 1 (old)");
    release();
    await settle();
    expect(m.text()).toBe("page 2");
    m.unmount();
  });

  // from test-v204.js / test-admin-boot.js: the timed refresh sends back the tag; nothing new, nothing sent
  it("the Orders list on an auto refresh sends `since` and keeps its rows when the answer is unchanged", async () => {
    const tag = "tag-1";
    const rows = [{ id: "LM-1001" }];
    const { calls } = stubFetch({
      "GET /orders": (c) => (c.query.get("since") === tag ? { ok: true, unchanged: true, tag } : { ok: true, orders: rows, total: 1, limit: 20, offset: 0, tag, empowerUnsure: [] }),
    });
    const fetcher = async ({ prev, reason }: { prev?: { tag: string }; reason: string }) => {
      const a = await listOrders({ limit: 20, since: reason === "auto" && prev ? prev.tag : undefined });
      return a.unchanged && prev ? prev : a;
    };
    const first = (await fetchQuery("orders:list?x", fetcher as never)) as { orders: unknown[] };
    expect(calls[0]!.query.get("since")).toBeNull();
    const again = await fetchQuery("orders:list?x", fetcher as never, "auto");
    expect(calls[1]!.query.get("since")).toBe(tag);
    expect(again).toBe(first);
    await fetchQuery("orders:list?x", fetcher as never, "refresh");
    expect(calls[2]!.query.get("since")).toBeNull();
  });
});
