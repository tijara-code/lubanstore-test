import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogueFile, json, ready } from "./_boot";
import * as shared from "../../../src/shared/pricing/offers";
import { priceOrder } from "../../../src/shared/pricing/price";
import type { Catalogue, CartLine, LmApi } from "../../../src/web/core/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// from test-offer-clock.js: the 72-hour window on the set, read on the SERVER's clock
describe("the set's window, on the server's clock", () => {
  it("time left, the window re-opening by itself, and whose clock", async () => {
    const REAL = Date.parse("2026-09-04T12:00:00Z");
    // the device is three days fast; the server tells the truth
    const dev = vi.spyOn(Date, "now").mockReturnValue(REAL + 3 * 86400000);
    const { LM } = await ready({
      fetch: (url) =>
        url === "/api/settings"
          ? Promise.resolve(json(catalogueFile(), { headers: { date: new Date(REAL).toUTCString() } }))
          : Promise.reject(new Error("offline")),
      local: { lm_cty_v2: "OM" },
    });
    const skew = LM.now() - Date.now();
    const at = (t: number) => dev.mockReturnValue(t - skew); // move the SERVER clock

    expect(LM.cfg.offer!.hours).toBe(72);
    expect(!!LM.offer()).toBe(true);
    const end = LM.offerEndsAt(LM.cfg.offer!)!.getTime();
    at(end - (3 * 3600e3 + 4 * 60e3 + 9 * 1000));
    expect(LM.offerLeftMs()).toBe(11049000);
    at(end - 1000);
    expect(LM.offerLeftMs()).toBe(1000);
    at(end - 71 * 3600e3 - 59 * 60e3 - 59 * 1000);
    expect(LM.offerLeftMs()!).toBeLessThan(72 * 3600e3);

    at(end - 500);
    const last = LM.offerLeftMs()!;
    expect(last).toBe(500);
    expect(!!LM.offer()).toBe(true);
    at(end + 500);
    const next = LM.offerLeftMs()!;
    expect(next).toBeGreaterThan(last);
    expect(next).toBeGreaterThan(71 * 3600e3);
    expect(!!LM.offer()).toBe(true);
    expect(LM.offerEndsAt(LM.cfg.offer!)!.getTime() - end).toBe(72 * 3600e3);

    expect(LM.clock).toBe("server");
    at(end - 3600e3);
    expect(LM.offerLeftMs()).toBe(3600e3);
    const deviceLeft = LM.offerEndsAt(LM.cfg.offer!)!.getTime() - Date.now();
    expect(Math.abs(deviceLeft - LM.offerLeftMs()!)).toBeGreaterThan(86400000);

    // the unit is wording, not time
    const anchor = new Date(LM.now()).toISOString();
    LM.cfg.offer = { id: "bundle", active: true, hours: 120, unit: "days", renew: "auto", anchor };
    expect(LM.offerLeftMs()!).toBeGreaterThan(0);
    expect(Math.ceil(LM.offerLeftMs()! / 86400e3)).toBe(5);
    expect(Math.abs(LM.offerEndsAt({ hours: 120, unit: "days", anchor })!.getTime() - LM.offerEndsAt({ hours: 120, unit: "hours", anchor })!.getTime())).toBeLessThan(1000);
    // an offer with no deadline has no milliseconds left
    LM.cfg.offer = { id: "bundle", active: true, name: "x", note: "y" };
    expect(LM.offerLeftMs()).toBe(null);
  });

  it("the large offers' countdown pill is the panel's choice", async () => {
    const { LM } = await ready({});
    expect(LM.tierClockShown()).toBe(true);
    LM.cfg.tiers!.clock = false;
    expect(LM.tierClockShown()).toBe(false);
    delete LM.cfg.tiers;
    expect(LM.tierClockShown()).toBe(true);
  });
});

// from test-offer-roll.js (browser side): the page's deadline is the till's, everywhere
describe("the page and the till name the same deadline", () => {
  it("monthly, weekly, 72 h, hours, reset anchors, once/auto, until, startsAt/endsAt", async () => {
    const { LM } = await ready({});
    const probes = [
      "2026-09-15T12:00:00Z", "2026-09-01T00:00:00+04:00", "2026-09-30T19:00:00Z", "2026-09-30T20:30:00Z", "2026-02-27T10:00:00Z",
      "2028-02-28T21:00:00Z", "2026-12-31T20:30:00Z", "2026-09-09T19:59:59Z", "2026-09-09T20:00:01Z", "2026-09-06T19:00:00Z", "2026-09-06T20:30:00Z",
    ].map(Date.parse);
    const offers: Array<Record<string, unknown>> = [
      { repeat: "monthly" }, { repeat: "monthly", until: "2026-09-20" }, { repeat: "monthly", until: "2026-12-20" }, { until: "2020-01-01" },
      { repeat: "weekly" }, { repeat: "72h" }, { hours: 72 }, { hours: 48, repeat: "weekly" }, { hours: 24, repeat: "monthly" },
      { hours: 72, anchor: "2026-09-04T10:30:00.000Z" }, { hours: 72, anchor: "2026-09-04" }, { hours: 72, anchor: "soon" },
      { hours: 24, renew: "once", anchor: "2026-09-04T10:30:00.000Z" }, { hours: 24, renew: "auto", anchor: "2026-09-04T10:30:00.000Z" },
      { hours: 72, startsAt: "2026-09-25T00:00:00+04:00", endsAt: "2026-09-30T23:59:59+04:00", renew: "auto" }, {},
    ];
    for (const t of probes) {
      LM.now = () => t;
      for (const o of offers) {
        expect(LM.offerEndsAt(o)?.getTime() ?? null).toBe(shared.offerEndsAt(o, t)?.getTime() ?? null);
        expect(LM.offerCycleMs(o)).toBe(shared.cycleMs(o));
        expect(LM.offerAnchor(o)).toBe(shared.anchorOf(o));
        LM.cfg.offer = { id: "bundle", active: true, ...o };
        expect(LM.offerEnded({ sizeId: "bundle", qty: 1 })).toBe(!shared.offerLive(LM.cfg, "bundle", t));
      }
    }
    // the exact values the original suite pinned
    LM.now = () => Date.parse("2026-09-10T12:00:00Z");
    expect(LM.offerEndsAt({ repeat: "monthly", until: "2026-09-20" })!.toISOString()).toBe("2026-09-20T19:59:59.000Z");
    expect(LM.offerEndsAt({ repeat: "monthly", until: "2026-12-20" })!.toISOString()).toBe("2026-09-30T19:59:59.999Z");
    const reset = Date.parse("2026-09-04T10:30:00.000Z");
    LM.now = () => reset + 3600e3;
    expect(LM.offerEndsAt({ hours: 72, anchor: "2026-09-04T10:30:00.000Z" })!.getTime()).toBe(reset + 72 * 3600e3 - 1);
    // an anchor exactly now gives a full window; one 50 ms ahead is still a deadline after now
    const now = Date.parse("2026-09-12T08:00:00Z");
    LM.now = () => now;
    expect(LM.offerEndsAt({ hours: 72, anchor: new Date(now).toISOString() })!.getTime() - now).toBe(72 * 3600e3 - 1);
    expect(LM.offerEndsAt({ hours: 72, anchor: new Date(now + 50).toISOString() })!.getTime()).toBeGreaterThan(now);
  });

  it("markets: an empty list is every market", async () => {
    const { LM } = await ready({ url: "/?country=KW" });
    expect(LM.offerHere()).toBe(true);
    LM.cfg.offer!.countries = ["AE", "SA"];
    expect(LM.offerHere()).toBe(false);
    expect(LM.offer()).toBe(null);
    expect(LM.lineOffered({ sizeId: "bundle", qty: 1 })).toBe(false);
    LM.setCountry("AE");
    expect(LM.offerHere()).toBe(true);
  });

  it("the page's offer also needs the set priced here (the till's offerLive does not)", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    expect(!!LM.offer("bundle")).toBe(true);
    delete LM.c.prices!.bundle;
    expect(LM.offer("bundle")).toBe(null);
    expect(shared.offerLive(LM.cfg, "bundle", LM.now())).toBe(true);
    // the retired large set is never on
    expect(LM.offerCfg("bundle2")).toBe(null);
    expect(LM.offer("bundle2")).toBe(null);
  });
});

// from test-free-ship.js (browser side): the page's threshold is the till's
describe("free delivery, page and till", () => {
  const published = Date.parse("2026-09-23T15:00:00+04:00");
  const withRuns = (): Catalogue => {
    const cfg = catalogueFile();
    cfg.freeShip = {
      active: true,
      countries: {
        OM: { on: true, over: 10, days: 5, from: new Date(published).toISOString() },
        AE: { on: true, over: 0, from: new Date(published).toISOString() },
        KW: { on: false, over: 0, days: 3 },
        BH: { on: true, over: 999, days: 2, from: new Date(published).toISOString() },
      },
    };
    return cfg;
  };
  const both = (LM: LmApi, code: string, t: number) => {
    LM.c = LM.cfg.countries.find((c) => c.code === code)!;
    LM.now = () => t;
    return { page: LM.freeOver(), till: shared.freeOverFor(LM.cfg, LM.c, t) };
  };

  it("five days published on a Wednesday afternoon: ends at midnight Muscat after the fifth day", async () => {
    const { LM } = await ready({});
    LM.cfg = withRuns();
    expect(both(LM, "OM", published + 60e3)).toEqual({ page: 10, till: 10 });
    const end = shared.freeEndOf(LM.cfg.freeShip!.countries!.OM)!;
    expect(new Date(end + 1).toISOString()).toBe(new Date(Date.parse("2026-09-28T00:00:00+04:00")).toISOString());
    expect(LM.freeDeal()!.end).toBe(end);
    expect(both(LM, "OM", Date.parse("2026-09-27T23:59:00+04:00")).page).toBe(10);
    const OM = LM.cfg.countries.find((c) => c.code === "OM")!;
    expect(both(LM, "OM", Date.parse("2026-09-28T00:00:01+04:00"))).toEqual({ page: OM.freeOver, till: OM.freeOver });
    expect(both(LM, "AE", published + 60e3)).toEqual({ page: 0, till: 0 });
    expect(LM.freeDeal()!.end).toBe(null);
    const KW = LM.cfg.countries.find((c) => c.code === "KW")!;
    expect(both(LM, "KW", published + 60e3)).toEqual({ page: KW.freeOver, till: KW.freeOver });
    const BH = LM.cfg.countries.find((c) => c.code === "BH")!;
    expect(both(LM, "BH", published + 60e3)).toEqual({ page: BH.freeOver, till: BH.freeOver });
    // days but no published start: not live anywhere; the switch off: nothing changes
    LM.cfg.freeShip!.countries!.OM = { on: true, over: 10, days: 5 };
    expect(both(LM, "OM", published + 60e3).page).toBe(OM.freeOver);
    LM.cfg = withRuns();
    LM.cfg.freeShip!.active = false;
    expect(both(LM, "AE", published + 60e3).page).toBe(LM.c.freeOver);
  });

  it("hourly for ten days across every market, the page and the till agree; the till charges what the page says", async () => {
    const { LM } = await ready({});
    LM.cfg = withRuns();
    for (let h = 0; h < 240; h++) {
      const t = published + h * 3600e3;
      for (const code of ["OM", "AE", "KW", "BH", "SA", "QA"]) {
        const r = both(LM, code, t);
        expect(r.page).toBe(r.till);
      }
    }
    // the till: a small Omani basket during the run ships free, the morning after it does not
    const q = (t: number) => priceOrder(LM.cfg, { countryCode: "OM", pay: "card", items: [{ itemId: "oud-large", qty: 1 }] }, t);
    expect(q(published + 60e3).ship).toBe(0);
    expect(q(Date.parse("2026-09-28T08:00:00+04:00")).ship).toBe(LM.cfg.countries.find((c) => c.code === "OM")!.ship);
  });

  it("the set ships free: its switch, its window, its markets — and only while it is on sale here", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    const set: CartLine[] = [{ sizeId: "bundle", scentId: "bundle", qty: 1 }];
    const box: CartLine[] = [{ sizeId: "large", scentId: "oud", qty: 1 }];
    expect(LM.setShipsFree()).toBe(false);
    LM.cfg.offer!.freeShip = true;
    expect(LM.setShipsFree()).toBe(true);
    expect(LM.setFree(set)).toBe(true);
    expect(LM.setFree(box)).toBe(false);
    expect(LM.setFreeEndsAt()).toBe(null);
    // a window: NaN before the server stamped its start; then ends one window later (once) or rolls (auto)
    LM.cfg.offer!.freeShipHours = 24;
    expect(Number.isNaN(LM.setFreeEndsAt())).toBe(true);
    expect(LM.setShipsFree()).toBe(false);
    const a = LM.now() - 30 * 3600e3;
    LM.cfg.offer!.freeShipAnchor = new Date(a).toISOString();
    expect(LM.setShipsFree()).toBe(false);
    expect(LM.setFreeEndsAt()).toBe(a + 24 * 3600e3 - 1);
    LM.cfg.offer!.freeShipRenew = "auto";
    expect(LM.setShipsFree()).toBe(true);
    expect(LM.setFreeEndsAt()).toBe(a + 48 * 3600e3 - 1);
    // the markets ticked for it
    LM.cfg.offer!.freeShipIn = ["AE"];
    expect(LM.setShipsFree()).toBe(false);
    LM.cfg.offer!.freeShipIn = ["om"];
    expect(LM.setShipsFree()).toBe(shared.setShipsFree(LM.cfg, LM.c, LM.now()));
    LM.cfg.offer!.freeShipIn = ["OM"];
    expect(LM.setShipsFree()).toBe(true);
    // the set off sale here (unpriced): no free delivery on its account, whatever the switch
    delete LM.c.prices!.bundle;
    expect(LM.setShipsFree()).toBe(false);
    expect(LM.setFree(set)).toBe(false);
  });

  it("cash at the door: absent means yes", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    expect(LM.codOn()).toBe(true);
    LM.c.codOn = false;
    expect(LM.codOn()).toBe(false);
    expect(LM.cod()).toBe(1);
    expect(LM.ship()).toBe(3);
  });
});
