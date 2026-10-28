/**
 * The panel as a whole, in happy-dom with the API stubbed: the sign-in gate and its messages,
 * the boot order (session → settings → the shell), the sidebar (hidden pages, roving focus),
 * the search, Sign out, a 401 back to the gate, the five-minute refresh.
 * Ported UI checks of test-admin-boot.js, test-v202.js, test-v211.js, test-v408.js.
 */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../../src/admin/app/App";
import { route } from "../../../src/admin/app/route";
import { session } from "../../../src/admin/app/session";
import { panelUi } from "../../../src/admin/app/panel";
import { typing, useAutoRefresh, AUTO_REFRESH_MS } from "../../../src/admin/app/Shell";
import { clearQueries, useQuery } from "../../../src/admin/data/query";
import { byText, click, key, mount, settle, stubFetch, type, type Call } from "./_render";

export const KPI0 = { window: null, total: 0, orders: 0, gross: 0, settled: 0, expected: 0, net: 0, aov: 0, cancelled: 0, cancelledPct: 0, refunded: 0, refundRate: 0, delivered: 0, conversion: null, sessions: null, repeatRate: 0, customers: 0, cpp: null, deliveryHrs: null };
export const OVERVIEW = {
  ok: true,
  orders: {
    n: 120,
    all: { ...KPI0, total: 115, orders: 105, settled: 2965.825, expected: 996.607, net: 2917.64, delivered: 67, cancelled: 11, cancelledPct: 10 },
    week: { ...KPI0, orders: 18 },
    before: { ...KPI0, orders: 8 },
    delta: 125,
    byDay: { "2026-10-26": 2, "2026-10-27": 3 },
  },
  warnings: [] as unknown[],
  dismissedN: 0,
  health: { ok: true, db: { ok: true, ms: 3 }, staleJobs: [], release: "test" },
};
const LIST = { ok: true, orders: [], total: 0, limit: 6, offset: 0, tag: "t", empowerUnsure: [] };

function routes(over: Record<string, (c: Call) => unknown> = {}) {
  return {
    "GET /session": () => ({ ok: true, signedIn: false, configured: true }),
    "POST /login": (c: Call) => ((c.body as { password: string }).password === "right-password" ? { ok: true, user: "shop keeper", expiresAt: "x" } : [401, { ok: false, error: "bad_credentials" }]),
    "GET /settings/ui": () => ({ ok: true, ui: { hidden: [] }, dismissed: [] }),
    "PUT /settings/ui": (c: Call) => ({ ok: true, ui: { hidden: (c.body as { hidden?: string[] }).hidden || [] }, dismissed: [] }),
    "GET /overview": () => OVERVIEW,
    "GET /orders": () => LIST,
    "GET /catalogue": () => ({ ok: true, data: { countries: [] } }),
    "POST /logout": () => ({ ok: true }),
    ...over,
  };
}

beforeEach(() => {
  history.replaceState(null, "", "#overview");
  route.set({ tab: "overview", params: {} });
  session.set({ state: "checking" });
  panelUi.set({ hidden: [], dismissed: [], loaded: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearQueries();
  document.body.innerHTML = "";
});

async function signIn(over: Record<string, (c: Call) => unknown> = {}) {
  const f = stubFetch(routes(over));
  const m = mount(h(App, null));
  await settle();
  await type(m.$("#u"), "shop keeper");
  await type(m.$("#p"), "right-password");
  await click(m.$("button[type=submit]"));
  await settle(10);
  return { m, ...f };
}

describe("the sign-in gate", () => {
  it("a wrong password says so in an alert, clears the field and puts the cursor back in it", async () => {
    stubFetch(routes());
    const m = mount(h(App, null));
    await settle();
    expect(m.$("#loginErr")!.getAttribute("role")).toBe("alert");
    await type(m.$("#u"), "x");
    await type(m.$("#p"), "nope");
    await click(m.$("button[type=submit]"));
    await settle();
    expect(m.$("#loginErr")!.textContent).toBe("Wrong username or password");
    expect(m.$<HTMLInputElement>("#p")!.value).toBe("");
    expect(document.activeElement).toBe(m.$("#p"));
    m.unmount();
  });

  // from test-login-lockout.js / v202 (UI half): a lockout is said as what it is
  it("locked out: 'Too many attempts', with the server's minutes", async () => {
    stubFetch(routes({ "POST /login": () => [429, { ok: false, error: "too_many_attempts", retry_after_min: 15, retryAfter: 900 }] }));
    const m = mount(h(App, null));
    await settle();
    await type(m.$("#p"), "x");
    await click(m.$("button[type=submit]"));
    await settle();
    expect(m.$("#loginErr")!.textContent).toBe("Too many attempts. Try again in 15 minutes.");
    m.unmount();
  });

  it("not set up on the server, and the server unreachable, are said too", async () => {
    stubFetch(routes({ "GET /session": () => ({ ok: true, signedIn: false, configured: false }) }));
    const m = mount(h(App, null));
    await settle();
    expect(m.$("#loginErr")!.textContent).toMatch(/not set up on the server/);
    m.unmount();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("down"))));
    session.set({ state: "out", configured: true });
    const m2 = mount(h(App, null));
    await settle();
    await type(m2.$("#p"), "x");
    await click(m2.$("button[type=submit]"));
    await settle();
    expect(m2.$("#loginErr")!.textContent).toBe("Could not reach the server. Check the connection and try again.");
    m2.unmount();
  });

  it("a server that could not start, or no API behind the page, says which — on the gate, before anyone types", async () => {
    const gate = async () => {
      session.set({ state: "checking" });
      const m = mount(h(App, null));
      await settle();
      const t = m.$("#loginErr")!.textContent;
      m.unmount();
      return t;
    };
    stubFetch(routes({ "GET /session": () => [503, { ok: false, error: "server_unavailable", reason: "database_url_missing" }] }));
    expect(await gate()).toMatch(/DATABASE_URL is not set.*Environment variables.*\.env file is not read there/);
    stubFetch(routes({ "GET /session": () => [503, { ok: false, error: "server_unavailable", reason: "config_refused", vars: ["THAWANI_MODE"] }] }));
    expect(await gate()).toMatch(/a setting was refused \(THAWANI_MODE\)/);
    stubFetch(routes({ "GET /session": () => [503, { ok: false, error: "server_unavailable", reason: "start_failed" }] }));
    expect(await gate()).toMatch(/could not start.*Logs › Functions › api/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html><title>404</title>", { status: 404, headers: { "Content-Type": "text/html" } })));
    expect(await gate()).toMatch(/admin API did not answer at this address \(HTTP 404\).*npm run dev/);
  });
});

describe("the panel", () => {
  // from test-admin-boot.js and test-v408.js: boot order, one tab, English labels
  it("boots: session, then the panel settings, then the shell on Overview with its KPIs", async () => {
    const { m, calls } = await signIn();
    const order = calls.map((c) => c.method + " " + c.path);
    expect(order.indexOf("GET /settings/ui")).toBeGreaterThan(order.indexOf("POST /login"));
    expect(order.indexOf("GET /settings/ui")).toBeLessThan(order.indexOf("GET /overview"));
    expect(m.$(".gate")).toBeNull();
    expect(m.$("#pageTitle")!.textContent).toBe("Overview");
    expect(m.$$(".tab").length).toBe(1);
    const kpis = m.$$(".kpi").map((k) => k.textContent);
    expect(kpis[0]).toMatch(/^Orders105\s*18 this week · ▲ 125%$/);
    expect(kpis[1]).toMatch(/Revenue settled2965\.825 OMR996\.607 OMR expected · net 2917\.64 OMR/);
    expect(kpis[2]).toMatch(/Delivered67/);
    expect(kpis[3]).toMatch(/Cancelled or failed1110% of all orders/);
    expect(m.text()).toMatch(/Everything that needs your attention/);
    // the avatar shows the signed-in name's initials; the password is not kept anywhere
    expect(m.$("#whoAmI")!.textContent).toBe("SK");
    expect(JSON.stringify(sessionStorage) + JSON.stringify(localStorage)).not.toMatch(/right-password/);
    // the store card is driven by the health read
    expect(m.$("#storeCard")!.textContent).toMatch(/Store is healthy/);
    m.unmount();
  });

  // from test-v211.js: hidden pages leave the nav; their links fall back to Overview
  it("a page hidden in Settings is not in the nav, and its address opens Overview", async () => {
    const { m } = await signIn({ "GET /settings/ui": () => ({ ok: true, ui: { hidden: ["payments", "orders"] }, dismissed: [] }) });
    const names = m.$$(".nav-btn").map((b) => b.getAttribute("data-tab"));
    expect(names).toEqual(["overview", "catalogue", "empower", "customers", "analytics"]);
    // Orders hidden: the search that hands to Orders is gone too
    expect(m.$("#globalSearch")).toBeNull();
    location.hash = "#payments";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    expect(m.$("#pageTitle")!.textContent).toBe("Overview");
    m.unmount();
  });

  it("Settings: Overview is always shown; unticking a page saves it hidden for every admin", async () => {
    const { m, calls } = await signIn();
    await click(byText(m.root, "button.ghost-link", "Settings"));
    const dlg = document.querySelector("[role=dialog]")!;
    expect(dlg.textContent).toMatch(/Overview \(always shown\)/);
    const pay = [...dlg.querySelectorAll("label")].find((l) => l.textContent === "Payments")!.querySelector("input")!;
    await click(pay);
    await click(byText(dlg, "button", "Save"));
    const put = calls.find((c) => c.method === "PUT" && c.path === "/settings/ui")!;
    expect(put.body).toEqual({ hidden: ["payments"] });
    expect(m.$$(".nav-btn").map((b) => b.getAttribute("data-tab"))).not.toContain("payments");
    m.unmount();
  });

  // v202 accessibility: the nav is one Tab stop; arrows, Home and End move along it
  it("the nav: a roving tab stop, moved by the arrow keys, Home and End", async () => {
    const { m } = await signIn();
    const bs = m.$$<HTMLButtonElement>(".nav-btn");
    expect(bs.map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1]);
    expect(bs[0]!.getAttribute("aria-current")).toBe("page");
    bs[0]!.focus();
    await key(bs[0]!, "ArrowDown");
    expect(document.activeElement).toBe(bs[1]);
    expect(bs[1]!.tabIndex).toBe(0);
    await key(bs[1]!, "End");
    expect(document.activeElement).toBe(bs[6]);
    await key(bs[6]!, "ArrowDown");
    expect(document.activeElement).toBe(bs[0]);
    await key(bs[0]!, "ArrowUp");
    expect(document.activeElement).toBe(bs[6]);
    for (const b of bs) expect(b.getAttribute("aria-label")).toBeTruthy();
    m.unmount();
  });

  // test-admin-boot.js: the global search hands its query to Orders; Ctrl/⌘ K focuses it
  it("the search: Ctrl K focuses it, Enter opens Orders with the query", async () => {
    const { m } = await signIn();
    expect(m.$("kbd")!.textContent).toMatch(/^(Ctrl K|⌘ K)$/);
    await key(document.body, "k", { ctrlKey: true });
    expect(document.activeElement).toBe(m.$("#globalSearch"));
    await type(m.$("#globalSearch"), "LM-1234");
    await key(m.$("#globalSearch"), "Enter");
    expect(route.get()).toEqual({ tab: "orders", params: { q: "LM-1234" } });
    expect(m.$("#pageTitle")!.textContent).toBe("Orders");
    m.unmount();
  });

  it("Sign out goes back to the gate at once (POST /logout); a 401 later does too, with a note", async () => {
    const { m, calls } = await signIn();
    await click(byText(m.root, "button.ghost-link", "Sign out"));
    await settle();
    expect(calls.some((c) => c.method === "POST" && c.path === "/logout")).toBe(true);
    expect(m.$("#u")).not.toBeNull();
    m.unmount();

    const s2 = await signIn({ "GET /orders": () => [401, { ok: false, error: "unauthorised" }] });
    // the sidebar's Orders count reads /orders as soon as the panel opens: refused, back to the gate
    expect(s2.m.$("#loginErr")!.textContent).toBe("Your session ended. Sign in again.");
    s2.m.unmount();
  });
});

describe("the five-minute refresh", () => {
  // from test-admin-boot.js: every 300000 ms, paused while hidden, put off while typing, marked auto
  it("re-reads what is on screen as 'auto'; not while the page is hidden; not while someone types", async () => {
    vi.useFakeTimers();
    const reasons: string[] = [];
    function Probe() {
      useAutoRefresh();
      useQuery("probe", async ({ reason }) => (reasons.push(reason), reasons.length));
      return h("div", { class: "tab" }, h("input", { id: "f" }));
    }
    const m = mount(h(Probe, null));
    await vi.advanceTimersByTimeAsync(10);
    expect(reasons).toEqual(["load"]);
    expect(AUTO_REFRESH_MS).toBe(300000);
    await vi.advanceTimersByTimeAsync(300000);
    expect(reasons).toEqual(["load", "auto"]);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await vi.advanceTimersByTimeAsync(300000);
    expect(reasons.length).toBe(2);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10);
    expect(reasons).toEqual(["load", "auto", "auto"]);
    const f = m.$<HTMLInputElement>("#f")!;
    f.value = "LM-";
    f.focus();
    expect(typing()).toBe(true);
    await vi.advanceTimersByTimeAsync(300000);
    expect(reasons.length).toBe(3);
    f.value = "";
    f.blur();
    await vi.advanceTimersByTimeAsync(30000);
    expect(reasons.length).toBe(4);
    m.unmount();
  });
});
