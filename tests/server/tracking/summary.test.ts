import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventHours, events } from "../../../src/server/db/schema";
import { busyHours, busyValues, resetStats, statsSummary } from "../../../src/server/domain/analytics";
import { purgeEvents } from "../../../src/server/domain/analytics/rollup";
import { runJob } from "../../../src/server/jobs";
import { createHarness, T0, type Harness } from "../../helpers/harness";
import { addEvents, addOrder, DAY, GULF, gulfDay, muscatMidnight, type Ev } from "./_fixtures";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.reset(); });
beforeEach(async () => { await h.reset(); h.clock.set(T0); });
const now = () => h.clock.t;
const ago = (hours: number) => now() - hours * 3600e3;
const S = (o: Parameters<typeof statsSummary>[1] = {}) => statsSummary(h.deps, o);

// from test-stats.js: 6. the chart — every day in the range, in Gulf time, in sessions
describe("the chart", () => {
  it("draws every day of the range, sessions not events, zeros included", async () => {
    const step = Math.min(1, ((now() / 3600e3 + 4) % 24) / 4);
    await addEvents(h, [
      { name: "page_view", sid: "a", at: ago(step) }, { name: "size_open", sid: "a", at: ago(step) }, { name: "size_open", sid: "a", at: ago(step) },
      { name: "cart_open", sid: "a", at: ago(step) }, { name: "add_cart", sid: "a", at: ago(step) },
      { name: "page_view", sid: "b", at: ago(2 * step) }, { name: "page_view", sid: "c", at: ago(3 * step) },
      { name: "page_view", sid: "d", at: ago(5 * 24 + step) },
    ]);
    const seven = await S({ days: 7 });
    expect(seven.daily.length).toBe(7);
    expect(seven.daily.every((d, i) => !i || d.day > seven.daily[i - 1]!.day)).toBe(true);
    const bucket = (t: number) => seven.daily.find((d) => d.day === gulfDay(t))!;
    expect(bucket(ago(step)).sessions).toBe(3);
    expect(bucket(ago(step)).events).toBe(7);
    expect(bucket(ago(5 * 24 + step)).sessions).toBe(1);
    expect(seven.daily.filter((d) => d.day !== gulfDay(ago(step)) && d.day !== gulfDay(ago(5 * 24 + step))).every((d) => d.sessions === 0 && d.events === 0)).toBe(true);
    expect(seven.total).toBe(8);
    expect((await S({ days: 30 })).daily.length).toBe(30);
    expect((await S({ days: 1 })).daily.length).toBe(1);
    expect((await S({ range: "today" })).daily.length).toBe(1);
    // the funnel counts people, not clicks; every add folded in
    expect(seven.uniqueByEvent.size_open).toBe(1);
    expect(seven.events.size_open).toBe(2);
    expect(seven.addedToCart).toBe(1);
    expect(seven.funnel.map((f) => f.sessions)).toEqual([4, 1, 1, 0, 0]);
  });

  // from test-stats.js: 9. orders come from the ledger; countries in sessions
  it("counts orders from the orders table, beside the tracked event; countries in sessions", async () => {
    await addEvents(h, [{ name: "order_placed", sid: "a", at: ago(1) },
      { name: "page_view", sid: "z", country: "OM", at: ago(1) }, { name: "size_open", sid: "z", country: "OM", at: ago(1) }]);
    await addOrder(h, { id: "LM-1", createdAt: new Date(ago(1)), countryCode: "OM" });
    await addOrder(h, { id: "LM-2", createdAt: new Date(ago(2)), countryCode: "AE" });
    await addOrder(h, { id: "LM-3", createdAt: new Date(ago(26)), countryCode: "OM" });
    await addOrder(h, { id: "LM-4", createdAt: new Date(ago(5 * 24 + 1)), countryCode: "SA" });
    await addOrder(h, { id: "LM-5", createdAt: new Date(ago(1)), trashed: true });
    const s = await S({ days: 7 });
    expect(s.orders.total).toBe(4);
    expect(s.uniqueByEvent.order_placed).toBe(1);
    expect(Object.keys(s.orders.byDay).length > 0).toBe(true);
    expect(Array.isArray(s.orders.origins)).toBe(true);
    expect(s.countries.find((c) => c.key === "OM")!.n).toBe(1);
    expect(s.countriesTop.length <= 6).toBe(true);
    expect(s.kpi.orders).toBe(4);
    expect(s.kpi.conversion).toBe(Math.round((4 / s.sessions) * 10000) / 10000);
  });

  // from test-stats.js: 10. all time
  it("All starts at the first thing on record, weekly past a quarter", async () => {
    await addEvents(h, [{ name: "page_view", sid: "a", at: ago(1) }]);
    await addOrder(h, { id: "LM-OLD", createdAt: new Date(now() - 200 * DAY) });
    const all = await S({ days: 0 });
    expect(all.ok && all.all).toBe(true);
    expect(all.span).toBe(Math.round((muscatMidnight(now()) - muscatMidnight(now() - 200 * DAY)) / DAY) + 1);
    expect(all.grain).toBe("week");
    expect(all.orders.total).toBe(1);
    expect((await S({ range: "all" })).span).toBe(all.span);
    expect((await S({ days: 90 })).grain).toBe("day");
    expect((await S({ days: 90 })).daily.length).toBe(90);
  });
});

// from test-v209.js: 2. analytics, the server's windows
describe("the windows", () => {
  const NAMES = ["page_view", "size_open", "add_cart", "offer_add", "checkout_view", "order_placed", "page_view"];
  const FOLD: Record<string, 1> = { add_cart: 1, offer_add: 1, suggest_add: 1, extra_add: 1 };
  let EV: Ev[] = [];
  let ORD: Array<{ id: string; at: number; status: "new" | "void" }> = [];
  beforeEach(async () => {
    EV = []; ORD = [];
    const today = muscatMidnight(now());
    for (let k = 0; k < 110; k++) {
      const m = today - k * DAY;
      [m, m + 1, m + 12 * 3600e3, m + DAY - 1].forEach((t, j) => {
        const i = k * 4 + j;
        if (t <= now() - 1000) EV.push({ name: NAMES[i % NAMES.length]!, item: i % 3 ? "oud-small" : "bundle", country: ["OM", "AE", "SA"][i % 3]!, sid: "s" + (i % 17), at: t });
      });
      if (k % 3 === 0 && m + 3600e3 < now()) ORD.push({ id: "LM-" + (100000 + k), at: m + 3600e3, status: k % 9 ? "new" : "void" });
    }
    await addEvents(h, EV);
    for (const o of ORD) await addOrder(h, { id: o.id, createdAt: new Date(o.at), status: o.status, origin: "meta" });
  });
  /* what each window should hold, worked out here and not by the code */
  function expected(since: number) {
    const today = muscatMidnight(now());
    const rows = EV.filter((e) => e.at >= since);
    const days: Record<string, { events: number; sids: Set<string> }> = {};
    for (let t = since; t <= today; t += DAY) days[gulfDay(t)] = { events: 0, sids: new Set() };
    const byName: Record<string, number> = {}, uniq: Record<string, Set<string>> = {}, sids = new Set<string>();
    for (const e of rows) {
      const d = days[gulfDay(e.at)]!; d.events++; d.sids.add(e.sid!);
      byName[e.name] = (byName[e.name] || 0) + 1; sids.add(e.sid!);
      (uniq[e.name] = uniq[e.name] || new Set()).add(e.sid!);
      if (FOLD[e.name]) (uniq.add_cart = uniq.add_cart || new Set()).add(e.sid!);
    }
    const u: Record<string, number> = {};
    for (const k of Object.keys(uniq)) u[k] = uniq[k]!.size;
    return { total: rows.length, sessions: sids.size, byName, u, live: ORD.filter((o) => o.at >= since && o.status !== "void").length,
      daily: Object.keys(days).sort().map((d) => d + ":" + days[d]!.events + "/" + days[d]!.sids.size) };
  }
  const sortKeys = (o: Record<string, number>) => JSON.stringify(Object.keys(o).sort().reduce((m, k) => ((m[k] = o[k]!), m), {} as Record<string, number>));

  it("every range: Muscat midnight to today, every event once, per day, the ledger's orders", async () => {
    const today = muscatMidnight(now());
    const got: Record<number, Awaited<ReturnType<typeof statsSummary>>> = {};
    for (const d of [1, 7, 30, 90]) {
      const r = (got[d] = await S({ days: d }));
      const since = today - (d - 1) * DAY;
      const x = expected(since);
      expect(r.since + " " + r.from + " " + r.to).toBe(new Date(since).toISOString() + " " + gulfDay(since) + " " + gulfDay(today));
      expect(r.total + " " + r.sessions).toBe(x.total + " " + x.sessions);
      expect(sortKeys(r.events) + sortKeys(r.uniqueByEvent)).toBe(sortKeys(x.byName) + sortKeys(x.u));
      expect(r.daily.map((b) => b.day + ":" + b.events + "/" + b.sessions).join()).toBe(x.daily.join());
      expect(r.orders.total).toBe(x.live);
    }
    expect(JSON.stringify(got[7]!.daily)).toBe(JSON.stringify(got[30]!.daily.slice(-7)));
    expect(JSON.stringify(got[30]!.daily)).toBe(JSON.stringify(got[90]!.daily.slice(-30)));
    expect(JSON.stringify(got[1]!.daily[0])).toBe(JSON.stringify(got[7]!.daily[6]));
    // the midnight at the edge: 00:00:00.000 is in, 23:59:59.999 the night before is out
    const edge = today - 6 * DAY;
    expect(EV.filter((e) => e.at === edge || e.at === edge - 1).length).toBe(2);
    expect(got[7]!.daily[0]!.events).toBe(Number(expected(edge).daily[0]!.split(":")[1]!.split("/")[0]));

    const all = await S({ days: 0 });
    const oldest = Math.min(...EV.map((e) => e.at), ...ORD.map((o) => o.at));
    const allSince = muscatMidnight(oldest);
    const xa = expected(allSince);
    expect(all.from + " " + all.grain + " " + all.span).toBe(gulfDay(allSince) + " week " + (Math.round((today - allSince) / DAY) + 1));
    expect(all.total + " " + all.sessions).toBe(xa.total + " " + xa.sessions);
    expect(all.daily[all.daily.length - 1]!.day).toBe(gulfDay(today - 6 * DAY));
    expect(all.daily.reduce((t, b) => t + b.events, 0)).toBe(xa.total);
    // two ranges asked at once come back as when asked alone
    const [a2, b2] = await Promise.all([S({ days: 0 }), S({ days: 1 })]);
    expect(JSON.stringify(a2.daily) === JSON.stringify(all.daily) && JSON.stringify(b2.daily) === JSON.stringify(got[1]!.daily)).toBe(true);
  });

  // from test-v411.js / test-v410.js: analytics kept for every period — the purge adds up what it removes
  it("the purge moves old events into the kept hours, and every figure stays the same", async () => {
    const before = await S({ days: 0 });
    const b90 = await S({ days: 90 });
    const r = await purgeEvents(h.db, now(), { days: 30 });
    expect(r.moved).toBe(EV.filter((e) => e.at < now() - 30 * DAY).length);
    expect((await h.db.select().from(events)).length).toBe(EV.length - r.moved);
    expect((await h.db.select().from(eventHours)).length > 0).toBe(true);
    const after = await S({ days: 0 });
    const a90 = await S({ days: 90 });
    for (const k of ["total", "sessions", "events", "uniqueByEvent", "items", "countries", "daily", "busy", "sourceMedium", "from", "span"] as const) {
      expect(JSON.stringify(after[k])).toBe(JSON.stringify(before[k]));
      expect(JSON.stringify(a90[k])).toBe(JSON.stringify(b90[k]));
    }
    // a second run moves nothing more, and the kept rows are added to, never duplicated
    expect((await purgeEvents(h.db, now(), { days: 30 })).moved).toBe(0);
    // the cap: beyond the newest N rows goes too
    const c = await purgeEvents(h.db, now(), { days: 3650, cap: 10 });
    expect((await h.db.select().from(events)).length).toBe(10);
    expect(c.moved).toBe(EV.length - r.moved - 10);
    expect(JSON.stringify((await S({ days: 0 })).daily)).toBe(JSON.stringify(before.daily));
  });

  it("an empty window: zeros on every day, no error", async () => {
    await h.reset();
    const none = await S({ days: 7 });
    expect(none.ok + " " + none.total + " " + none.daily.length + " " + none.daily.every((b) => b.sessions === 0)).toBe("true 0 7 true");
  });
});

// from test-v211.js: analytics custom range
describe("a custom range", () => {
  it("takes two Muscat days, in either order, ends today at the latest, and wins over days", async () => {
    const today = muscatMidnight(now());
    const d = (n: number) => gulfDay(today - n * DAY);
    const list: Ev[] = [];
    for (let n = 0; n <= 220; n++) list.push({ name: "page_view", sid: "s" + n, at: today - n * DAY + 3600e3 }, { name: "size_open", sid: "s" + n, at: today - n * DAY + 7200e3 });
    await addEvents(h, list.filter((e) => e.at < now()));
    let r = await S({ from: d(10), to: d(6) });
    expect([r.custom, r.span, r.from, r.to, r.total]).toEqual([true, 5, d(10), d(6), 10]);
    expect(r.daily.length).toBe(5);
    expect(r.daily.every((b) => b.events === 2)).toBe(true);
    r = await S({ from: d(6), to: d(10), days: 30 });
    expect([r.custom, r.span, r.days, r.from]).toEqual([true, 5, 5, d(10)]);
    r = await S({ from: d(3), to: gulfDay(today + 5 * DAY) });
    expect(r.span).toBe(4);
    expect((await S({ from: d(2), to: d(2) })).span).toBe(1);
    r = await S({ from: "2026-13-45", to: d(2), days: 3 });
    expect([r.custom, r.daily.length]).toEqual([false, 3]);
    r = await S({ from: d(200), to: d(100) });
    expect([r.grain, r.span]).toEqual(["week", 101]);
    expect(r.until).toBe(new Date(today - 100 * DAY + DAY).toISOString());
  });
});

// from test-v408.js: 5. analytics — the filters and the busy hours
describe("the filters and the busy hours", () => {
  beforeEach(async () => {
    const m = (min: number) => now() - min * 60e3;
    await addEvents(h, [
      { sid: "s1", name: "session_start", item: "instagram|paid_social|oct", country: "OM", at: m(30) },
      { sid: "s1", name: "page_view", item: "home", country: "OM", at: m(30) },
      { sid: "s1", name: "add_cart", item: "bundle", country: "OM", at: m(25) },
      { sid: "s2", name: "session_start", item: "(direct)|(none)|", country: "SA", at: m(40) },
      { sid: "s2", name: "page_view", item: "home", country: "SA", at: m(40) },
      { sid: "s3", name: "session_start", item: "snapchat|paid_social|", country: "OM", at: m(50) },
      { sid: "s3", name: "page_view", item: "home", country: "OM", at: m(50) },
      { sid: "s4", name: "session_start", item: "instagram|social|", country: "AE", at: m(60) },
      { sid: "s4", name: "page_view", item: "home", country: "AE", at: m(60) },
    ]);
    await addOrder(h, { id: "LM-4081001", createdAt: new Date(m(20)), countryCode: "OM", origin: "instagram", attribution: { source: "instagram", medium: "paid_social", how: "utm" }, omr: 29 });
    await addOrder(h, { id: "LM-4081002", createdAt: new Date(m(35)), countryCode: "SA", origin: "direct", attribution: null, omr: 30 });
    await addOrder(h, { id: "LM-4081003", createdAt: new Date(m(45)), countryCode: "OM", origin: "snapchat", attribution: null, omr: 25 });
  });
  it("narrows every figure at once", async () => {
    let s = await S({ days: 1 });
    expect(s.sessions + " " + s.orders.total + " " + JSON.stringify(s.filter)).toBe('4 3 {"country":"","platform":"","paid":""}');
    s = await S({ days: 1, country: "om" });
    expect(s.sessions + " " + s.orders.total + " " + s.countries.map((c) => c.key).join(",")).toBe("2 2 OM");
    s = await S({ days: 1, platform: "meta" });
    expect(s.sessions + " " + s.orders.total).toBe("2 1");
    s = await S({ days: 1, platform: "Snapchat" });
    expect(s.sessions + " " + s.orders.total).toBe("1 1");
    s = await S({ days: 1, paid: "paid" });
    expect(s.sessions + " " + s.orders.total).toBe("2 1");
    expect((await S({ days: 1, adsOnly: true })).sessions).toBe(2);
    s = await S({ days: 1, paid: "unpaid", country: "AE" });
    expect(s.sessions + " " + s.sourceMedium.rows.filter((x) => x.sessions).map((x) => x.key).join(",")).toBe("1 instagram / social");
    expect((await S({ days: 1, unpaidOnly: true, country: "AE" })).sessions).toBe(1);
    s = await S({ days: 1, country: "xx1", platform: "myspace", paid: "maybe" });
    expect(s.sessions + " " + JSON.stringify(s.filter)).toBe('4 {"country":"","platform":"","paid":""}');
  });
  it("busy hours: 7 × 24 in Muscat's hours, each session once an hour, the live orders, the weekdays held", async () => {
    const s = await S({ days: 1 });
    const cells = (g: number[][]) => g.reduce((t, d) => t + d.reduce((a, b) => a + b, 0), 0);
    expect(s.busy.visits.length + "×" + s.busy.visits[0]!.length + " " + s.busy.orders.length).toBe("7×24 7");
    expect(cells(s.busy.visits) >= 4 && cells(s.busy.visits) <= 8).toBe(true);
    expect(cells(s.busy.orders)).toBe(3);
    expect(s.busy.weekdays.reduce((a, b) => a + b, 0)).toBe(1);
    const slot = (t: number) => { const d = new Date(t + GULF); return [d.getUTCDay(), d.getUTCHours()] as const; };
    const [d1, h1] = slot(now() - 20 * 60e3);
    expect(s.busy.orders[d1]![h1]! >= 1).toBe(true);
    // a typical day: the count over how many of that weekday
    const b = await busyHours(h.deps, { days: 1, metric: "orders" });
    expect(b.weekday).toBe(slot(now())[0]);
    expect(b.hours.reduce((a, x) => a + x, 0)).toBe(3);
    expect((await busyHours(h.deps, { days: 1, weekday: "every", metric: "visits" })).hours.length).toBe(24);
    expect(busyValues({ visits: [[2, 4]], orders: [], weekdays: [2, 0, 0, 0, 0, 0, 0] } as never, "visits", 0).slice(0, 2)).toEqual([1, 2]);
  });
});

// from test-v302.js: 5. the panel — Source / Medium from sessions and orders
describe("Source / Medium", () => {
  it("sessions, orders, live, revenue and conversion per row; campaigns; (not set) for an order with no landing", async () => {
    await addEvents(h, [
      { name: "session_start", item: "instagram|paid_social|launch", sid: "s1", at: now() - 60e3 },
      { name: "session_start", item: "instagram|paid_social|launch", sid: "s2", at: now() - 60e3 },
      { name: "session_start", item: "(direct)|(none)|", sid: "s3", at: now() - 60e3 },
      { name: "page_view", item: "home", sid: "s1", at: now() - 60e3 },
    ]);
    const at = { source: "instagram", medium: "paid_social", campaign: "launch", how: "utm" };
    await addOrder(h, { id: "LM-1", status: "new", omr: 26, origin: "instagram", attribution: at });
    await addOrder(h, { id: "LM-2", status: "void", omr: 12, origin: "instagram", attribution: at });
    await addOrder(h, { id: "LM-3", status: "new", omr: 10, origin: "direct" });
    const sum = await S({ days: 7 });
    const ig = sum.sourceMedium.rows.find((r) => r.key === "instagram / paid_social")!;
    expect([ig.sessions, ig.n, ig.live, ig.omr, ig.rate].join(" ")).toBe("2 2 1 26 50");
    expect(sum.sourceMedium.rows.some((r) => r.key === "(not set) / (not set)" && r.live === 1 && r.rate === null)).toBe(true);
    expect(sum.sourceMedium.campaigns.map((r) => r.key + " " + r.sessions + " " + r.live).join()).toBe("instagram / paid_social / launch 2 1");
    expect(sum.sourceMedium.sessionsFrom).toBe(gulfDay(now()));
    expect(sum.orders.origins!.map((o) => o.key + ":" + o.n + "/" + o.live + "/" + o.omr)).toEqual(["instagram:2/1/26", "direct:1/1/10"]);
  });
});

// from test-v411.js: All reaches the kept hours; Reset data clears both
describe("kept hours and Reset data", () => {
  it("All reaches the kept hours' first day; Reset needs its word and clears events and kept hours", async () => {
    await h.db.insert(eventHours).values({ hour: new Date("2026-01-01T10:00:00Z"), sid: "x", country: "OM", name: "page_view", item: "", n: 1 });
    await addEvents(h, [{ name: "page_view", sid: "a", at: now() - 3600e3 }]);
    const all = await S({ days: "all" });
    expect(all.from! <= "2026-01-01" && all.span > 200).toBe(true);
    expect(all.total).toBe(2);
    expect(await resetStats(h.deps, "yes")).toEqual({ ok: false, error: "confirm_required" });
    expect(await resetStats(h.deps, "events")).toEqual({ ok: true, deleted: 1 });
    expect((await h.db.select().from(events)).length + " " + (await h.db.select().from(eventHours)).length).toBe("0 0");
  });
  it("the events-rollup job is registered and runs the purge", async () => {
    await addEvents(h, [{ name: "page_view", sid: "old1", at: now() - 100 * DAY }, { name: "page_view", sid: "new1", at: now() - DAY }]);
    const r = await runJob(h.deps, "events-rollup");
    expect(r.moved).toBe(1);
    expect((await S({ days: 0 })).total).toBe(2);
  });
});
