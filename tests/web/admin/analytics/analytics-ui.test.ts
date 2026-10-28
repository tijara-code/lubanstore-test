/**
 * The Analytics tab in happy-dom with the API stubbed. Ported UI checks of test-v209 (one range
 * on screen: numbered reads, a change empties every panel, a failed read says "Not loaded."),
 * test-v211 (the calendar beside the buttons, "Custom · N days"), test-v408 (filters ride with
 * the range, busy hours: today's weekday first, the hour now marked), test-v411 (Reset at the
 * foot), test-v338-live / test-v446 (Live now: 1h/3h/6h/Today, 1h by default, every 15 s only
 * while in view, the step chips, tooltips as text), test-v333 (top six countries; changes.clear
 * asks with the count), test-v320 (ten a page, select and delete), test-v334 (tracking health:
 * today's failures), test-admin-data (logs grouped, CSV errors-<days>d.csv), test-stats (the
 * reset asks and sends confirm "events").
 */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { route } from "../../../../src/admin/app/route";
import { clearQueries } from "../../../../src/admin/data/query";
import { DialogHost, Toast } from "../../../../src/admin/kit";
import { Analytics } from "../../../../src/admin/tabs/analytics/Analytics";
import { forgetMap } from "../../../../src/admin/tabs/analytics/LiveNow";
import { muscatClock } from "../../../../src/admin/tabs/analytics/stats";
import { byText, click, mount, settle, stubFetch, type Call } from "../_render";

const grid = (): number[][] => [0, 1, 2, 3, 4, 5, 6].map(() => new Array<number>(24).fill(0));

function summary(over: Record<string, unknown> = {}) {
  const busy = { visits: grid(), orders: grid(), weekdays: [1, 1, 1, 1, 1, 1, 1] };
  busy.visits[muscatClock(Date.now()).dow]![20] = 6;
  return {
    ok: true, days: 7, all: false, custom: false, span: 7, from: "2026-10-22", to: "2026-10-28", total: 900, capped: false, coveredFrom: null,
    sessions: 276, events: { page_view: 640, add_cart: 86, offer_add: 26 }, uniqueByEvent: { page_view: 276, add_cart: 86 }, addedToCart: 86, funnel: [],
    orders: { total: 39, byDay: {}, withVisits: { from: "2026-10-22", total: 39 }, origins: [] },
    items: [{ key: "bundle", n: 24 }, { key: "oud-small", n: 26 }],
    countries: ["AE", "OM", "SA", "QA", "KW", "BH", "US"].map((k, i) => ({ key: k, n: 100 - i })),
    grain: "day", daily: [{ day: "2026-10-27", events: 10, views: 5, sessions: 40, orders: 2 }, { day: "2026-10-28", events: 12, views: 6, sessions: 52, orders: 3 }],
    sourceMedium: { rows: [{ key: "(direct) / (none)", source: "(direct)", medium: "(none)", sessions: 44, n: 7, live: 6, omr: 217.603, rate: 13.6 }], campaigns: [], sessionsFrom: "2026-10-21" },
    filter: { country: "", platform: "", paid: "" }, busy,
    ...over,
  };
}
const NOW_ISO = () => new Date().toISOString();
function live(over: Record<string, unknown> = {}) {
  return {
    ok: true, at: NOW_ISO(), minutes: 60, geo: true, steps: [1, 0, 1, 0, 0], capped: false,
    visitors: [
      { k: "a1", step: 2, stage: "cart", detail: "added the bundle", country: "SA", city: "Riyadh", ll: [46.7, 24.7], src: "instagram / paid_social", page: "home", adds: 2, first: NOW_ISO(), last: NOW_ISO() },
      { k: "b2", step: 0, stage: "landed", detail: "browsing", country: "US", city: "New York", ll: [-74, 40.7], src: "", page: "home", adds: 0, first: NOW_ISO(), last: NOW_ISO() },
    ],
    ...over,
  };
}
const CHANGES = Array.from({ length: 12 }, (_, i) => ({ id: 100 - i, at: "2026-10-" + String(20 - i).padStart(2, "0") + "T10:00:00Z", actor: "shopkeeper", what: "change " + i, lines: ["change " + i], before: 5, after: 8, counting: i === 0, delta: i === 0 ? null : 60 }));

function routes(over: Record<string, (c: Call) => unknown> = {}) {
  return {
    "GET /analytics/summary": () => summary(),
    "GET /analytics/live": (c: Call) => live({ minutes: c.query.get("minutes") === "today" ? 300 : Number(c.query.get("minutes")), ...(c.query.get("minutes") === "today" ? { today: true } : {}) }),
    "GET /analytics/changes": () => ({ ok: true, winDays: 7, changes: CHANGES }),
    "GET /analytics/errors": () => ({
      ok: true, days: 7, cap: 2000, capped: false,
      rows: [
        { id: 2, at: "2026-10-28T03:40:00Z", side: "browser", kind: "error", message: "TypeError: x is null", orderId: null, path: "checkout", browser: "Instagram app", detail: "at /assets/checkout.js:1:900" },
        { id: 1, at: "2026-10-27T03:40:00Z", side: "server", kind: "http", message: "db_write_failed", orderId: "LM-1000001", path: "/api/order", browser: "", detail: "statement timeout" },
      ],
      groups: [
        { key: "browser|error|TypeError: x is null", side: "browser", kind: "error", message: "TypeError: x is null", n: 1, first: "2026-10-28T03:40:00Z", last: "2026-10-28T03:40:00Z", orderIds: [], browsers: ["Instagram app"], visitors: 1 },
        { key: "server|http|db_write_failed", side: "server", kind: "http", message: "db_write_failed", n: 1, first: "2026-10-27T03:40:00Z", last: "2026-10-27T03:40:00Z", orderIds: ["LM-1000001"], browsers: [], visitors: 0 },
      ],
    }),
    "GET /health": () => ({
      ok: false,
      pixels: { meta: { pixel: true, capi: true }, snap: { pixel: true, capi: false }, ga4: { id: false, mp: false } },
      tracking: { meta: { day: "2026-10-28", sent: 3, failed: 4, failedToday: 4, lastError: "Invalid parameter", purchase: { at: "x", ok: true, fields: ["country", "ph"] } }, snap: null, ga4: null, warnings: [] },
    }),
    "GET /catalogue": () => ({ ok: true, data: { countries: [{ code: "OM" }, { code: "AE" }, { code: "SA" }] } }),
    "GET /admin/live-map.json": () => ({ k: 10, c: [{ a: "SA", d: "M2200 650l10 0z", ll: [45, 24] }] }),
    ...over,
  };
}

function page() {
  return mount(h("div", null, h("div", { class: "tab" }, h(Analytics, null)), h(DialogHost, null), h(Toast, null)));
}
const kpi = (m: ReturnType<typeof page>, label: string) => [...m.$$(".kpi")].find((k) => k.querySelector(".kpi-top span")!.textContent === label)?.querySelector("b")?.textContent;
const dialog = () => document.querySelector("[role=dialog]") as HTMLElement;
const setHash = (h0: string, params: Record<string, string>) => {
  history.replaceState(null, "", h0);
  route.set({ tab: "analytics", params });
};

beforeEach(() => {
  forgetMap();
  setHash("#analytics", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearQueries();
  document.body.innerHTML = "";
});

describe("the range and the figures", () => {
  it("the KPIs (the ledger's orders), the chart in sessions, the ranks (top six countries), the caption from the payload", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle(12);
    expect(calls.find((c) => c.path === "/analytics/summary")!.query.get("range")).toBe("7");
    expect([kpi(m, "Visits"), kpi(m, "Sessions"), kpi(m, "Carts started"), kpi(m, "Orders"), kpi(m, "Conversion")]).toEqual(["276", "276", "86", "39", "14%"]);
    expect(m.$(".stats-stamp")!.textContent).toBe("Last 7 days · 2026-10-22 → 2026-10-28");
    expect(byText(m.root, ".stats-bar .seg button", "7 days")!.getAttribute("aria-pressed")).toBe("true");
    expect(m.$$("h2").map((x) => x.textContent)).toContain("Sessions by day");
    expect(m.$(".chart svg")).not.toBeNull();
    const ranks = m.$$(".rank");
    expect([...ranks[0]!.querySelectorAll(".rank-k")].map((x) => x.textContent)).toEqual(["Bundle · 3 scents", "oud-small"]);
    expect(ranks[1]!.querySelectorAll(".rank-row").length).toBe(6);
    expect([...ranks[2]!.querySelectorAll(".rank-k")].map((x) => x.textContent)).toEqual(["Page views", "Add to cart (single)", "Add to cart (bundle)"]);
    // the funnel and orders by source are gone (v446)
    expect(m.text()).not.toMatch(/Funnel|Orders by source/);
    // source / medium with its note
    expect(m.$(".sm-tbl tbody")!.textContent).toMatch(/\(direct\) \/ \(none\)typed in, a bookmark/);
    expect(m.$(".sm-tbl tbody")!.textContent).toMatch(/13\.6%/);
    m.unmount();
  });

  // from test-v209.js: every read numbered; a non-newest answer dropped; a range change empties every panel at once
  it("a slow answer for an older range never draws under the newer one", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    const { calls, fn } = stubFetch(
      routes({
        "GET /analytics/summary": (c) =>
          c.query.get("range") === "7" ? summary({ sessions: 777 }) : summary({ days: 30, span: 30, from: "2026-09-29", sessions: 3030, uniqueByEvent: { page_view: 3030 } }),
      }),
    );
    // the 7-day answer is held back until after the 30-day one has landed
    const answer = fn.getMockImplementation()!;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (/\/analytics\/summary\?.*range=7/.test(url)) await gate;
      return answer(url, init);
    });
    const m = page();
    await settle(6);
    expect(m.$(".stats-stamp")!.textContent).toBe("Last 7 days");
    expect(m.text()).toMatch(/Loading…/);
    await click(byText(m.root, ".stats-bar .seg button", "30 days"));
    await settle(8);
    expect(kpi(m, "Sessions")).toBe("3030");
    const seq30 = m.$(".stats")!.getAttribute("data-seq");
    release!();
    await settle(8);
    expect(kpi(m, "Sessions")).toBe("3030");
    expect(m.$(".stats-stamp")!.textContent).toBe("Last 30 days · 2026-09-29 → 2026-10-28");
    expect(m.$(".stats")!.getAttribute("data-seq")).toBe(seq30);
    expect(calls.filter((c) => c.path === "/analytics/summary").length).toBe(2);
    m.unmount();
  });

  it("a failed read clears the figures: \"Not loaded.\", never the last range's", async () => {
    stubFetch(routes({ "GET /analytics/summary": (c) => (c.query.get("range") === "90" ? [500, { ok: false, error: "server_error" }] : summary()) }));
    const m = page();
    await settle(10);
    expect(kpi(m, "Sessions")).toBe("276");
    await click(byText(m.root, ".stats-bar .seg button", "90 days"));
    await settle(8);
    expect(kpi(m, "Sessions")).toBeUndefined();
    expect(m.text()).toMatch(/Could not load: The server hit an error/);
    expect(m.$$(".rank").length).toBe(0);
    expect(m.text()).toMatch(/Not loaded\./);
    m.unmount();
  });

  // from test-v211.js: the calendar beside the buttons (each releases the other); "Custom · N days"
  it("a custom range: the calendar releases the buttons; the server's from/to; the caption says Custom", async () => {
    const { calls } = stubFetch(routes({ "GET /analytics/summary": (c) => (c.query.get("from") ? summary({ custom: true, days: 5, span: 5, from: c.query.get("from"), to: c.query.get("to") }) : summary()) }));
    setHash("#analytics?from=2026-10-01&to=2026-10-05", { from: "2026-10-01", to: "2026-10-05" });
    const m = page();
    await settle(10);
    const c = calls.find((x) => x.path === "/analytics/summary")!;
    expect([c.query.get("from"), c.query.get("to"), c.query.get("range")]).toEqual(["2026-10-01", "2026-10-05", null]);
    expect(m.$$(".stats-bar > .seg button[aria-pressed=true]").length).toBe(0);
    expect(m.$(".stats-stamp")!.textContent).toBe("Custom · 5 days · 2026-10-01 → 2026-10-05");
    expect(m.$(".drp-label")!.textContent).toBe("1 Oct – 5 Oct 2026");
    await click(byText(m.root, ".stats-bar .seg button", "Today"));
    expect(route.get().params).toEqual({ range: "today" });
    m.unmount();
  });

  // from test-v408.js: the filters are sent with the range; the cache key includes them
  it("the filters ride with the range; Clear appears with them", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle(10);
    expect(m.$("button[aria-label='Clear filters']")).toBeNull();
    const country = m.$<HTMLSelectElement>("select[aria-label=Country]")!;
    expect([...country.options].map((o) => o.value)).toEqual(["", "OM", "AE", "SA"]);
    country.value = "OM";
    country.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(6);
    const plat = m.$<HTMLSelectElement>("select[aria-label=Platform]")!;
    plat.value = "meta";
    plat.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(6);
    const paid = m.$<HTMLSelectElement>("select[aria-label='Paid or not']")!;
    paid.value = "paid";
    paid.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(6);
    const last = calls.filter((c) => c.path === "/analytics/summary").pop()!;
    expect([last.query.get("range"), last.query.get("country"), last.query.get("platform"), last.query.get("paid")]).toEqual(["7", "OM", "meta", "paid"]);
    expect(route.get().params).toEqual({ country: "OM", platform: "meta", paid: "paid" });
    await click(m.$("button[aria-label='Clear filters']"));
    expect(route.get().params).toEqual({});
    m.unmount();
  });
});

describe("busy hours (v408)", () => {
  it("today's weekday first; the hour now and the busiest marked; every day averages", async () => {
    stubFetch(routes());
    const m = page();
    await settle(10);
    const clock = muscatClock(Date.now());
    const today = m.$("#busyCard .busy-days button[aria-pressed=true]")!;
    expect(today.classList.contains("today")).toBe(true);
    expect(m.$(`.busy-bars i[data-hour='${clock.hour}']`)!.classList.contains("now")).toBe(true);
    expect(m.$(".busy-bars i[data-hour='20']")!.classList.contains("peak")).toBe(true);
    expect(m.$(".busy-note")!.textContent).toMatch(/^Busiest: 8 pm–9 pm \(about 6 visitors\)\./);
    await click(byText(m.root, ".busy-days button", "Every day"));
    expect(m.$(".busy-note")!.textContent).toMatch(/about 0\.9 visitors/);
    await click(byText(m.root, "#busyCard .seg button", "Orders"));
    expect(m.$(".busy-note")!.textContent).toBe("No orders on any day in this range.");
    m.unmount();
  });
});

describe("live now (v338, v446)", () => {
  it("1h by default (1h, 3h, 6h, Today); the steps filter the list; a pin's tooltip is text; outside the Gulf view is said", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle(12);
    expect(calls.find((c) => c.path === "/analytics/live")!.query.get("minutes")).toBe("60");
    const wins = m.$$("[data-live-min]");
    expect(wins.map((b) => b.textContent)).toEqual(["1h", "3h", "6h", "Today"]);
    expect(wins[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(wins[0]!.getAttribute("title")).toBe("Active in the last hour");
    expect(m.$(".live-n")!.textContent).toBe("2 visitors");
    expect(m.$$(".live-row .w").map((x) => x.textContent)).toEqual(["Riyadh, Saudi Arabia", "New York, United States"]);
    expect(m.$(".live-row .d")!.textContent).toBe("In the cart · added the bundle · 2 added · instagram / paid_social");
    expect(m.$(".live-off")!.textContent).toMatch(/1 visitor outside this view · Show world/);
    // the land drawn from the outlines, the market shaded
    expect(m.$(".live-map svg path.mkt")).not.toBeNull();
    // a step chip shows only that step
    await click(m.$("[data-live-step='2']"));
    expect(m.$$(".live-row").length).toBe(1);
    await click(m.$("[data-live-step='4']"));
    expect(m.$(".live-empty")!.textContent).toBe("Nobody at this step right now.");
    // the tooltip, as text (markup in a city name stays text)
    const pin = m.$<HTMLButtonElement>(".live-pin")!;
    expect(pin.getAttribute("aria-label")).toBe("Riyadh, Saudi Arabia: 1 visitor, furthest in the cart");
    pin.dispatchEvent(new Event("focusin", { bubbles: true }));
    pin.dispatchEvent(new FocusEvent("focus"));
    await settle();
    expect(m.$(".live-tip")!.textContent).toBe("Riyadh, Saudi Arabia1 visitor1In the cart");
    await click(byText(m.root, ".live-off button", "Show world"));
    expect(m.$(".live-map")!.getAttribute("data-view")).toBe("world");
    await click(m.$("[data-live-min='today']"));
    await settle(4);
    expect(calls.filter((c) => c.path === "/analytics/live").pop()!.query.get("minutes")).toBe("today");
    m.unmount();
  });

  // from test-v338-live.js: polls every 15 s, only while Analytics is open and the document visible
  it("asked again every 15 s while in view; not while the browser tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { calls } = stubFetch(routes());
    // with the clock stopped, time moves only when the test says (no settle(): it waits on timers)
    const tick = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1);
    };
    const m = page();
    await tick(50);
    const n = () => calls.filter((c) => c.path === "/analytics/live").length;
    expect(n()).toBe(1);
    await tick(15000);
    expect(n()).toBe(2);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(60000);
    expect(n()).toBe(2);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(10);
    expect(n()).toBe(3);
    m.unmount();
    await tick(60000);
    expect(n()).toBe(3); // the card is gone: no more asks
  });
});

describe("the change log (v320, v333)", () => {
  it("ten a page with the count; still counting; a row's delete asks; ticks and select-all; Reset data asks with the count", async () => {
    const { calls } = stubFetch(
      routes({
        "DELETE /analytics/changes/100": () => ({ ok: true, id: 100 }),
        "DELETE /analytics/changes/99": () => ({ ok: true, id: 99 }),
        "DELETE /analytics/changes/98": () => [404, { ok: false, error: "no_such_entry" }],
        "POST /analytics/changes/clear": () => ({ ok: true, deleted: 12, left: 0 }),
      }),
    );
    const m = page();
    await settle(12);
    const card = m.$("#changesCard")!;
    expect(card.querySelectorAll("tbody tr").length).toBe(10);
    expect(card.querySelector(".stamp")!.textContent).toBe("12 recorded");
    expect(card.querySelector(".pg-count")!.textContent).toBe("10 of 12");
    expect(card.querySelector("tr[data-change='100']")!.textContent).toMatch(/still counting/);
    expect(card.querySelector("tr[data-change='99']")!.textContent).toMatch(/▲ 60%/);
    // one row's delete
    await click(card.querySelector("tr[data-change='100'] button[aria-label^='Delete']"));
    expect(dialog().textContent).toMatch(/Delete 1 entry from the change log\?/);
    expect(dialog().textContent).toMatch(/The store is not changed\./);
    await click(byText(dialog(), "button", "Delete"));
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/analytics/changes/100"]);
    // select all on the page, then untick all but two
    const all = card.querySelector<HTMLInputElement>("thead input[type=checkbox]")!;
    all.click();
    await settle();
    expect(byText(card, "button", "Delete 10 entries")).not.toBeNull();
    all.click();
    await settle();
    (card.querySelector("tr[data-change='99'] input") as HTMLInputElement).click();
    (card.querySelector("tr[data-change='98'] input") as HTMLInputElement).click();
    await settle();
    expect(all.indeterminate).toBe(true);
    await click(byText(card, "button", "Delete 2 entries"));
    await click(byText(dialog(), "button", "Delete"));
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path).slice(1)).toEqual(["/analytics/changes/99", "/analytics/changes/98"]);
    expect(document.querySelector(".toast")!.textContent).toBe("2 entries deleted");
    // Reset data
    await click(byText(card, "button", "Reset data"));
    expect(dialog().textContent).toMatch(/Clear all 12 entries from the change log\?/);
    await click(byText(dialog(), "button", "Clear the log"));
    expect(calls.find((c) => c.path === "/analytics/changes/clear")!.body).toEqual({ confirm: "changes" });
    m.unmount();
  });
});

describe("tracking health and the logs", () => {
  // from test-v331.js / test-v334.js: the card, today's failures only
  it("tracking health: wired, today's failures, the last error, the Purchase's field names", async () => {
    stubFetch(routes());
    const m = page();
    await settle(12);
    const rows = [...m.$$("#pxCard tbody tr")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows[0]).toEqual(["Meta", "pixel + CAPI", "—", "4", "Invalid parameter", "country, ph"]);
    expect(rows[1]!.slice(0, 4)).toEqual(["Snapchat", "pixel only", "—", "0"]);
    expect(rows[2]![1]).toBe("off");
    expect(m.$("#pxCard .stamp")!.textContent).toBe("1 platform with failures today");
    m.unmount();
  });

  // from test-admin-data.js: grouped by side|kind|message with the orders; CSV errors-<days>d.csv; v209: never another window's rows
  it("errors: grouped with their orders; a row opens its detail; the window and side re-read; the CSV link follows them", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle(12);
    const card = m.$("#logsCard")!;
    expect(card.querySelector(".stamp")!.textContent).toBe("2 in 7 days · 1 on the page · 1 in the functions");
    const rows = card.querySelectorAll("tbody tr.row");
    expect(rows[1]!.textContent).toMatch(/http db_write_failed/);
    expect(rows[1]!.querySelector(".log-orders")!.textContent).toBe("LM-1000001");
    await click(rows[1]!);
    expect(card.querySelector(".logpre")!.textContent).toBe("statement timeout");
    const csv = card.querySelector<HTMLAnchorElement>("a[download]")!;
    expect(csv.getAttribute("href")).toBe("/api/admin/analytics/errors.csv?days=7");
    expect(csv.getAttribute("download")).toBe("errors-7d.csv");
    const days = card.querySelector<HTMLSelectElement>("select[aria-label=Window]")!;
    days.value = "30";
    days.dispatchEvent(new Event("change", { bubbles: true }));
    const side = card.querySelector<HTMLSelectElement>("select[aria-label=Side]")!;
    side.value = "browser";
    side.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(8);
    const last = calls.filter((c) => c.path === "/analytics/errors").pop()!;
    expect([last.query.get("days"), last.query.get("side")]).toEqual(["30", "browser"]);
    expect(card.querySelector<HTMLAnchorElement>("a[download]")!.getAttribute("href")).toBe("/api/admin/analytics/errors.csv?days=30&side=browser");
    m.unmount();
  });
});

describe("ad links and the reset", () => {
  it("the four platform lines; the builder names nothing until the campaign is named", async () => {
    stubFetch(routes());
    const m = page();
    await settle(10);
    expect(m.$$(".utm-k b").map((b) => b.textContent)).toEqual(["Meta (Facebook & Instagram)", "Snapchat", "TikTok", "Google Ads"]);
    expect(m.$(".utm-out code")!.textContent).toBe("Name the campaign to make the link.");
    const camp = m.$$<HTMLInputElement>(".utm-build input")[0]!;
    camp.value = "National Day 2026";
    camp.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(m.$(".utm-out code")!.textContent).toBe(location.origin + "/?utm_source=instagram&utm_medium=social&utm_campaign=national_day_2026");
    m.unmount();
  });

  // from test-stats.js: Reset asks first and sends confirm "events" (Orders and customers not affected)
  it("Reset analytics data asks, then sends confirm: events", async () => {
    const { calls } = stubFetch(routes({ "POST /analytics/reset": () => ({ ok: true, deleted: 900 }) }));
    const m = page();
    await settle(10);
    await click(byText(m.root, ".stats-foot button", "Reset analytics data"));
    expect(dialog().textContent).toMatch(/cannot be undone/);
    expect(dialog().textContent).toMatch(/Orders and customers are NOT affected/);
    await click(byText(dialog(), "button", "Cancel"));
    expect(calls.some((c) => c.path === "/analytics/reset")).toBe(false);
    await click(byText(m.root, ".stats-foot button", "Reset analytics data"));
    await click(byText(dialog(), "button", "Delete every event"));
    expect(calls.find((c) => c.path === "/analytics/reset")!.body).toEqual({ confirm: "events" });
    expect(document.querySelector(".toast")!.textContent).toBe("Analytics cleared");
    m.unmount();
  });
});
