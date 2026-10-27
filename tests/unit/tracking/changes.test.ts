import { describe, expect, it } from "vitest";
import { catalogueChangeLines, describeChange } from "../../../src/server/domain/analytics/changes";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// from test-admin-data.js: what a publish changed
describe("the change log's words", () => {
  const was = { countries: [{ code: "AE", cur: "AED", freeOver: 300, ship: 30, prices: { small: { now: 120 }, large: { now: 250 } } }],
    offer: { active: true, hours: 72 }, scents: [{ id: "amber", active: true, soldOut: false }] };
  it("names prices, the bundle and stock; nothing when nothing changed", () => {
    const now = clone(was);
    expect(describeChange(was, now)).toBe("");
    now.countries[0]!.prices.small.now = 110;
    expect(describeChange(was, now)).toBe("AE small 120→110 AED");
    now.offer.active = false; now.scents[0]!.soldOut = true;
    expect(describeChange(was, now)).toBe("AE small 120→110 AED; bundle off; amber sold out");
    expect(catalogueChangeLines(was, now)).toEqual(["AE small 120→110 AED", "bundle off", "amber sold out"]);
    expect(describeChange(null, now)).toBe("catalogue published for the first time");
  });

  const base = { countries: [
    { code: "AE", cur: "AED", cod: 10, codOn: true, freeOver: 300, ship: 30, courier: "smsa", prices: { small: { now: 120, was: 160 } },
      sizes: [{ id: "small", name: "صغير", tag: "" }], scents: [{ id: "amber", active: true }], extras: [{ id: "burner", active: true }] },
    { code: "OM", cur: "OMR", cod: 1, codOn: true, freeOver: 30, ship: 3, courier: "local", prices: { small: { now: 12, was: 16 } },
      sizes: [{ id: "small", name: "صغير", tag: "" }], scents: [{ id: "amber", active: true }], extras: [{ id: "burner", active: true }] }],
  offer: { active: true, hours: 72, name: "باقة", note: "", badge: "" }, courier: { auto: true }, ledger: { rates: { AED: 0.1 } } } as Record<string, any>;
  const edit = (f: (b: Record<string, any>) => void) => { const a = clone(base), b = clone(base); f(b); return describeChange(a, b); };

  it("everything on the Catalogue tab, and only that", () => {
    expect(edit((b) => { b.countries[0].courier = "omniful"; })).toBe("");
    expect(edit((b) => { b.courier.auto = false; b.ledger.rates.AED = 0.2; })).toBe("");
    expect(edit((b) => { b.countries[1].sizes[0].name = "مسافر"; })).toBe("OM small renamed مسافر");
    expect(edit((b) => { b.countries[0].sizes[0].tag = "جديد"; })).toBe("AE small badge “جديد”");
    expect(edit((b) => { b.countries[1].cod = 2; })).toBe("OM cash fee 2");
    expect(edit((b) => { b.countries[0].codOn = false; })).toBe("AE cash on delivery off");
    expect(edit((b) => { b.countries[0].prices.small.was = 150; })).toBe("AE small was-price 150");
    expect(edit((b) => { b.countries[0].extras[0].active = false; })).toBe("AE burner off");
    expect(edit((b) => { b.countries.forEach((c: any) => { c.scents[0].soldOutSizes = ["small"]; }); })).toBe("all markets: amber small sold out");
    expect(edit((b) => { b.offer.startsAt = "2026-09-25T00:00:00+04:00"; b.offer.endsAt = "2026-09-30T23:59:00+04:00"; })).toBe("bundle starts 25 Sep 00:00; bundle ends 30 Sep 23:59");
    expect(edit((b) => { b.offer.badge = "جديد"; })).toBe("bundle badge changed");
    expect(edit((b) => { b.freeShip = { active: true, countries: { OM: { on: true, over: 10, days: 5 } } }; })).toBe("OM free-delivery offer on over 10 for 5 days");
    expect(edit((b) => { b.offer.somethingNew = 1; })).toBe("catalogue edited");
  });
  it("the free-delivery offer's length and restart", () => {
    const a = clone(base), b = clone(base);
    a.freeShip = { countries: { OM: { on: true, over: 10, days: 5, from: "2026-09-23T11:00:00.000Z" } } };
    b.freeShip = { countries: { OM: { on: true, over: 10, days: 7, from: "2026-09-24T09:00:00.000Z" } } };
    expect(describeChange(a, b)).toBe("OM free-delivery offer 7 days");
    a.freeShip = { countries: { OM: { on: true, over: 10, days: 5, from: "2026-09-10T11:00:00.000Z" } } };
    b.freeShip = { countries: { OM: { on: true, over: 10, days: 5, from: "2026-09-24T09:00:00.000Z" } } };
    expect(describeChange(a, b)).toBe("OM free-delivery offer restarted");
  });
  // from test-v211.js / v207: the shelf switches
  it("the shelf switches", () => {
    expect(edit((b) => { b.stockHide = { "oud-small": true }; })).toBe("oud-small hide at 0 on");
    expect(edit((b) => { b.stockCap = { "oud-small": true }; })).toBe("oud-small cap at stock on");
    expect(edit((b) => { b.stockLive = true; })).toBe("pieces-left counter on");
  });
  it("says at most twelve, then how many more", () => {
    const s = edit((b) => { for (let i = 0; i < 14; i++) b.countries[0].prices["x" + i] = { now: i + 1 }; });
    expect(s.split("; ").length).toBe(12);
    expect(s.endsWith(" … +2 more")).toBe(true);
  });
});
