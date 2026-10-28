/**
 * The Customers tab's rules (crm.ts), the Analytics tab's words and arithmetic (stats.ts) and the
 * browser CSV (lib/csv.ts).
 */
import { describe, expect, it } from "vitest";
import type { CustomerRow } from "../../../src/shared/admin/api";
import type { BusyGrid, LiveVisitor, StatsSummary } from "../../../src/admin/data/insights";
import { csvCell, csvOf } from "../../../src/admin/lib/csv";
import { bandOf, crmCountries, crmCsv, crmRows, omr, tagsOf } from "../../../src/admin/tabs/customers/crm";
import {
  askOf, busyNote, busyValues, createSeq, dailyRows, eventRows, filterKey, hourWord, kpisOf, LIVE_WINDOWS, liveAge, liveLine, livePlace, liveSpan,
  muscatClock, notesOf, pinGroups, pinXY, LIVE_VIEWS, rangeName, rateWord, stampOf, statsParamsOf, statsViewOf, topCountries, viewKey,
} from "../../../src/admin/tabs/analytics/stats";

const C = (over: Partial<CustomerRow>): CustomerRow => ({
  phoneKey: "96891234567", name: "سالم", phone: "+968 91234567", orders: 1, live: 1, spend: 9, first: "2026-10-01T00:00:00Z", last: "2026-10-01T00:00:00Z",
  countries: ["OM"], note: "", tags: [], ...over,
});

describe("customers", () => {
  // from test-customers.js: spend bands (OMR, lifetime)
  it("the bands: High from 26, Medium from 10, Normal below", () => {
    expect([26, 400, 25.999, 25.5, 10, 9.999, 0].map((n) => bandOf(n).label)).toEqual(["High", "High", "Medium", "Medium", "Medium", "Normal", "Normal"]);
    // three orders of 9 → 27 → High; one of 9 → Normal (lifetime spend)
    expect(bandOf(27).id).toBe("high");
    expect(bandOf(9).id).toBe("low");
  });
  // from test-customers.js: a cancelled order lists the customer with count 0 and spent 0 (the server's live rule) — shown, banded Normal
  it("a customer whose only order was cancelled is listed, Normal, with nothing spent", () => {
    const rows = crmRows([C({ live: 0, spend: 0 })], { q: "", band: "", country: "", sort: "last" });
    expect(rows.length).toBe(1);
    expect(bandOf(rows[0]!.spend).label).toBe("Normal");
  });
  it("search by name, by phone digits (any spelling), by note or tag; band and country filters; sorts", () => {
    const all = [
      C({ phoneKey: "96891234567", name: "سالم", spend: 30, last: "2026-10-03T00:00:00Z", tags: ["vip"] }),
      C({ phoneKey: "971501234567", name: "Fatma", phone: "+971 50 123 4567", countries: ["AE"], spend: 12, live: 3, last: "2026-10-05T00:00:00Z", note: "wholesale" }),
      C({ phoneKey: "96899999999", name: "Hamed", phone: "+968 99999999", spend: 2, last: "2026-10-01T00:00:00Z" }),
    ];
    const f = { q: "", band: "", country: "", sort: "last" as const };
    expect(crmRows(all, f).map((c) => c.name)).toEqual(["Fatma", "سالم", "Hamed"]);
    expect(crmRows(all, { ...f, sort: "spend" }).map((c) => c.name)).toEqual(["سالم", "Fatma", "Hamed"]);
    expect(crmRows(all, { ...f, sort: "orders" }).map((c) => c.name)[0]).toBe("Fatma");
    expect(crmRows(all, { ...f, q: "٩١٢٣٤" }).map((c) => c.name)).toEqual(["سالم"]);
    expect(crmRows(all, { ...f, q: "050 123" }).map((c) => c.name)).toEqual(["Fatma"]);
    expect(crmRows(all, { ...f, q: "WHOLESALE" }).map((c) => c.name)).toEqual(["Fatma"]);
    expect(crmRows(all, { ...f, q: "vip" }).map((c) => c.name)).toEqual(["سالم"]);
    expect(crmRows(all, { ...f, band: "high" }).map((c) => c.name)).toEqual(["سالم"]);
    expect(crmRows(all, { ...f, band: "mid" }).map((c) => c.name)).toEqual(["Fatma"]);
    expect(crmRows(all, { ...f, country: "AE" }).map((c) => c.name)).toEqual(["Fatma"]);
    // from test-customers.js: the country filter is built from the list itself
    expect(crmCountries(all)).toEqual(["AE", "OM"]);
  });
  it("tags typed with commas (Arabic comma too), lower case, no repeats", () => {
    expect(tagsOf("VIP, wholesale،vip ,, gift")).toEqual(["vip", "wholesale", "gift"]);
  });
  it("spend without the currency in the cell", () => {
    expect([omr(70.044), omr(30), omr(0.1 + 0.2)]).toEqual(["70.044", "30", "0.3"]);
  });
  // from test-customers.js: export columns include Band
  it("the CSV", () => {
    const out = crmCsv([C({ spend: 30, tags: ["vip"] })]);
    expect(out[0]).toEqual(["Name", "Phone", "Country", "Orders", "Live orders", "Spend OMR", "Band", "First order", "Last order", "Note", "Tags"]);
    expect(out[1]![6]).toBe("High");
  });
});

describe("the browser CSV", () => {
  it("quotes what needs quoting and never lets a spreadsheet run a cell", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell(null)).toBe("");
    expect(csvOf([["a", 1], ["b", 2]])).toBe("a,1\r\nb,2\r\n");
  });
});

describe("analytics: the range and the filters", () => {
  it("the address: 7 days by default; a custom range releases the buttons (v211); filters kept", () => {
    expect(statsViewOf({})).toEqual({ range: "7", from: "", to: "", filter: { country: "", platform: "", paid: "" } });
    const v = statsViewOf({ from: "2026-10-20", to: "2026-10-10", country: "OM", platform: "meta", paid: "paid", range: "30" });
    expect(v.range).toBe("");
    expect([v.from, v.to]).toEqual(["2026-10-10", "2026-10-20"]);
    expect(askOf(v)).toEqual({ from: "2026-10-10", to: "2026-10-20", country: "OM", platform: "meta", paid: "paid" });
    expect(statsParamsOf(v)).toEqual({ range: undefined, from: "2026-10-10", to: "2026-10-20", country: "OM", platform: "meta", paid: "paid" });
    expect(statsViewOf({ platform: "myspace", paid: "maybe", country: "oman" }).filter).toEqual({ country: "", platform: "", paid: "" });
    expect(askOf(statsViewOf({ range: "all" }))).toEqual({ range: "all" });
  });
  // from test-v408.js: the cache key includes filterKey
  it("the key of a view holds the range and the filters", () => {
    expect(filterKey({ country: "", platform: "", paid: "" })).toBe("");
    expect(filterKey({ country: "OM", platform: "", paid: "paid" })).toBe("|OM,,paid");
    expect(viewKey(statsViewOf({ range: "30", country: "OM" }))).toBe("30|OM,,");
    expect(viewKey(statsViewOf({ from: "2026-10-01", to: "2026-10-03" }))).toBe("2026-10-01..2026-10-03");
  });
  // from test-v209.js / test-v211.js: the stamp names the range from the payload; "Custom · N days"
  it("the date caption comes from the payload", () => {
    const base = { daily: [], filter: { country: "", platform: "", paid: "" as const } };
    expect(stampOf({ ...base, custom: false, all: false, days: 7, span: 7, from: "2026-10-22", to: "2026-10-28" })).toBe("Last 7 days · 2026-10-22 → 2026-10-28");
    expect(stampOf({ ...base, custom: false, all: false, days: 1, span: 1, from: "2026-10-28", to: "2026-10-28" })).toBe("Today · 2026-10-28");
    expect(stampOf({ ...base, custom: true, all: false, days: 5, span: 5, from: "2026-10-01", to: "2026-10-05" })).toBe("Custom · 5 days · 2026-10-01 → 2026-10-05");
    expect(stampOf({ ...base, custom: false, all: true, days: 0, span: 120, from: "2026-07-01", to: "2026-10-28", filter: { country: "OM", platform: "", paid: "" } })).toBe(
      "All time · 120 days · 2026-07-01 → 2026-10-28 · filtered",
    );
    expect(rangeName({ range: "", from: "2026-10-01", to: "2026-10-03" })).toBe("1 Oct – 3 Oct 2026");
    expect(rangeName({ range: "today", from: "", to: "" })).toBe("Today");
  });
});

describe("analytics: the figures", () => {
  const d = {
    uniqueByEvent: { page_view: 276, add_cart: 86, order_placed: 23 },
    sessions: 276,
    orders: { total: 39, byDay: {}, withVisits: { from: "2026-10-21", total: 38 } },
  } as unknown as StatsSummary;
  // the KPI is the ledger's; conversion divides the same days
  it("Visits, Sessions, Carts started, Orders (the ledger's), Conversion", () => {
    expect(kpisOf(d)).toEqual({ visits: 276, sessions: 276, carts: 86, orders: 39, conversion: "14%" });
    // from test-stats.js: falls back to the tracked figure when the orders could not be read
    expect(kpisOf({ ...d, orders: { total: null, byDay: {}, error: "orders_unavailable" } }).orders).toBe(23);
    expect(kpisOf({ ...d, sessions: 0 }).conversion).toBe("—");
  });
  it("the notes say what the figures do not cover", () => {
    expect(notesOf({ capped: false, coveredFrom: null, from: "2026-07-01", orders: { total: 50, byDay: {}, withVisits: { from: "2026-08-01", total: 40 } } })).toEqual([
      "Visits are kept for 90 days, so this range's first recorded visit is 2026-08-01. Conversion uses the 40 orders from that day on, not all 50.",
    ]);
    expect(notesOf({ capped: false, coveredFrom: null, from: null, orders: { total: null, byDay: {}, error: "orders_unavailable" } })).toEqual(["Orders could not be read, so that figure is the tracked one."]);
  });
  // from test-v333.js: Visits by country shows the top 6
  it("the ranks: countries top six, events biggest first, the chart in sessions", () => {
    const countries = ["AE", "OM", "SA", "QA", "KW", "BH", "US"].map((k, i) => ({ key: k, n: 10 - i }));
    expect(topCountries({ countries }).map((c) => c.key)).toEqual(["AE", "OM", "SA", "QA", "KW", "BH"]);
    expect(eventRows({ a: 1, b: 5, c: 3 }).map((r) => r.key)).toEqual(["b", "c", "a"]);
    expect(dailyRows({ daily: [{ day: "2026-10-21", events: 9, views: 5, sessions: 3, orders: 0 }] })).toEqual([{ label: "10-21", n: 3 }]);
  });
  it("conversion in Source / Medium", () => {
    expect([rateWord(null), rateWord(13.8), rateWord(9.09)]).toEqual(["—", "13.8%", "9.09%"]);
  });
});

describe("analytics: busy hours (v408)", () => {
  const grid = (): number[][] => [0, 1, 2, 3, 4, 5, 6].map(() => new Array<number>(24).fill(0));
  const b: BusyGrid = { visits: grid(), orders: grid(), weekdays: [1, 1, 1, 2, 1, 1, 1] };
  b.visits[3]![21] = 8; // two Wednesdays, 8 sessions at 9 pm
  b.visits[3]![9] = 2;
  b.visits[0]![21] = 4;
  // from test-v408.js: a typical day = total ÷ the number of that weekday in the range
  it("a typical weekday, and every day", () => {
    const wed = busyValues(b, "visits", 3);
    expect(wed.days).toBe(2);
    expect(wed.vals[21]).toBe(4);
    expect(wed.vals[9]).toBe(1);
    const every = busyValues(b, "visits", -1);
    expect(every.days).toBe(8);
    expect(every.vals[21]).toBe(1.5);
  });
  it("the note names the busiest hour and how many had nobody", () => {
    const wed = busyValues(b, "visits", 3);
    expect(busyNote(wed.vals, wed.days, 3, "visitors").text).toBe("Busiest: 9 pm–10 pm (about 4 visitors). 22 hours with none.");
    expect(busyNote(new Array(24).fill(0), 1, 2, "orders").text).toBe("No orders on Tuesdays in this range.");
    expect(busyNote(new Array(24).fill(0), 0, 2, "orders").text).toBe("This range has no Tuesday.");
    expect([hourWord(0), hourWord(12), hourWord(13)]).toEqual(["12 am", "12 pm", "1 pm"]);
  });
  it("Muscat's clock (UTC+4): the weekday and the hour now", () => {
    expect(muscatClock(Date.parse("2026-10-27T21:30:00Z"))).toEqual({ dow: 3, hour: 1 });
  });
});

describe("analytics: live now", () => {
  // from test-v446.js: the panel offers 1h, 3h, 6h, Today (1h pressed by default)
  it("the windows", () => {
    expect(LIVE_WINDOWS.map((w) => w.value).join(",")).toBe("60,180,360,today");
    expect(LIVE_WINDOWS[0]!.title).toBe("Active in the last hour");
    expect([liveSpan(60), liveSpan(180), liveSpan(5)]).toEqual(["hour", "3 hours", "5 minutes"]);
    expect([liveAge(10e3), liveAge(5 * 60e3), liveAge(3 * 3600e3)]).toEqual(["now", "5 min ago", "3 h ago"]);
  });
  const V = (over: Partial<LiveVisitor>): LiveVisitor => ({ k: "k", step: 0, stage: "landed", detail: "browsing", country: "OM", city: "", ll: null, src: "", page: "", adds: 0, first: "2026-10-28T04:00:00Z", last: "2026-10-28T04:00:00Z", ...over });
  const map = [{ a: "OM", d: "M0 0z", ll: [57, 21] as [number, number] }];
  it("a visitor's place: the city's point, or the country's middle; one pin per place with the furthest step", () => {
    expect(livePlace(V({ ll: [58.4, 23.6], city: "Muscat" }), map)!.key).toBe("58.4,23.6");
    expect(livePlace(V({}), map)).toMatchObject({ key: "c:OM", ll: [57, 21], country: true });
    expect(livePlace(V({ country: "ZZ" }), map)).toBeNull();
    const now = Date.parse("2026-10-28T04:00:30Z");
    const { groups, unplaced } = pinGroups([V({ step: 1 }), V({ step: 3 }), V({ country: "ZZ" }), V({ ll: [55.3, 25.2], step: 4, last: "2026-10-28T03:00:00Z" })], map, now);
    expect(unplaced).toBe(1);
    const om = groups.find((g) => g.key === "c:OM")!;
    expect([om.n, om.best, om.fresh, om.steps]).toEqual([2, 3, true, [0, 1, 0, 1, 0]]);
    expect(groups[groups.length - 1]).toBe(om); // the busiest drawn last (on top)
  });
  it("where a pin sits: Dubai in the Gulf view, New York outside it", () => {
    expect(pinXY([55.3, 25.2], LIVE_VIEWS.gulf)).not.toBeNull();
    expect(pinXY([-74, 40.7], LIVE_VIEWS.gulf)).toBeNull();
    expect(pinXY([-74, 40.7], LIVE_VIEWS.world)).not.toBeNull();
  });
  it("a visitor's line: the step, the finer word unless it repeats it, how many added", () => {
    expect(liveLine({ step: 2, detail: "added the bundle", adds: 2 })).toBe("In the cart · added the bundle · 2 added");
    expect(liveLine({ step: 4, detail: "ordered", adds: 0 })).toBe("Ordered");
  });
});

describe("numbered reads (v209)", () => {
  it("each read takes the next number; an older answer than one drawn is refused", () => {
    const s = createSeq();
    const a = s.next();
    const b = s.next();
    expect(s.newest).toBe(2);
    expect(s.accept(b)).toBe(true);
    expect(s.accept(a)).toBe(false);
  });
});
