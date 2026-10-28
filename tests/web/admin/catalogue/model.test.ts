/**
 * The Catalogue editor's rules (src/admin/tabs/catalogue/model.ts): numbers as typed, the
 * draft and what a publish carries, the refusals before a publish, the offers' clocks, the
 * stock grid, "why the bundle isn't showing", the free-delivery rows, restoring a size.
 * Ported UI-side checks of test-offer-admin, test-admin-batch, test-catalogue-merge,
 * test-extras, test-v303, test-v309, test-v410, test-v411, test-v413.
 */
import { describe, expect, it } from "vitest";
import { CAT_ID_RE as SERVER_ID, HEX_RE as SERVER_HEX } from "../../../../src/shared/admin/schemas";
import type { Catalogue } from "../../../../src/shared/catalogue/types";
import {
  addCountry, anchorText, asciiDigits, CAT_ID_RE, commonStamp, convertLen, fsState, fsWords, HEX_RE, hoursOf, lenShown, marketsStamp, missingSizes,
  offerEndsIn, offerStamp, offerWhyHidden, problemsOf, readNum, renameSizeId, restoreSize, sameButStock, sameDraft, scentStock, setScentEverywhere,
  setScentOutHere, tiersState, toDraft, toPublish,
} from "../../../../src/admin/tabs/catalogue/model";

const NOW = Date.parse("2026-10-28T08:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

// from test-offer-admin.js: the fixture (OM + AE, small/large/bundle, the set rolling 72 h, every market)
const CFG = (): Catalogue =>
  ({
    countries: [
      {
        code: "OM", cur: "OMR", dial: "968", toOmr: 1, courier: "omniful",
        prices: { small: { now: 12 }, large: { now: 25 }, bundle: { now: 29 } },
        sizes: [{ id: "small", name: "صغير" }, { id: "large", name: "كبير" }],
        scents: [{ id: "oud", name: "عود", art: "lavender" }, { id: "amber", name: "عنبر", art: "amber" }],
      },
      {
        code: "AE", cur: "AED", dial: "971", toOmr: 0.1047,
        prices: { small: { now: 120 }, large: { now: 250 }, bundle: { now: 299 } },
        sizes: [{ id: "small", name: "صغير" }, { id: "large", name: "كبير" }],
        scents: [{ id: "oud", name: "عود" }, { id: "amber", name: "عنبر" }],
        extras: [{ id: "burner", name: "مبخرة", art: "burner", countsFree: false, active: true }],
      },
    ],
    sizes: [],
    scents: [],
    offer: { id: "bundle", active: true, name: "باقة", note: "n", badge: "b", hours: 72, renew: "auto", sizeId: "small", countries: [] },
  }) as unknown as Catalogue;

describe("numbers as a person types them", () => {
  it("reads Arabic digits, the Arabic decimal mark and a comma", () => {
    expect(asciiDigits("١٢٣")).toBe("123");
    expect(readNum("١٥").value).toBe(15);
    expect(readNum("٢٠٫٥").value).toBe(20.5);
    expect(readNum("۷").value).toBe(7);
    expect(readNum("12,5").value).toBe(12.5);
    expect(readNum(" 30 ").value).toBe(30);
  });
  it("refuses what is not a number, a negative, too many decimals; blank is 0 or null", () => {
    expect(readNum("abc").error).toBe("Not a number");
    expect(readNum("1.2.3").error).toBe("Not a number");
    expect(readNum("-1").error).toBe("Cannot be negative");
    expect(readNum("1.2345").error).toBe("At most 3 decimals");
    expect(readNum("4.85", { dec: 1, max: 5 }).error).toBe("At most 1 decimals");
    expect(readNum("6", { max: 5 }).error).toBe("At most 5");
    expect(readNum("2.5", { int: true }).error).toBe("A whole number");
    expect(readNum("").value).toBe(0);
    expect(readNum("", { blank: true }).value).toBe(null);
  });
  it("checks ids and colours exactly as the server does", () => {
    for (const v of ["oud-small", "a_b", "x".repeat(40), "x".repeat(41), "<b>", "a b", ""]) expect(CAT_ID_RE.test(v)).toBe(SERVER_ID.test(v));
    for (const v of ["#fff", "#9c464c", "#9c464c80", "red", "#xyz", "url(x)"]) expect(HEX_RE.test(v)).toBe(SERVER_HEX.test(v));
  });
});

describe("the draft and what a publish carries", () => {
  it("each market owns its lists; the offers' markets are explicit ticks", () => {
    const shared = { ...CFG(), sizes: [{ id: "small", name: "صغير" }], scents: [{ id: "oud", name: "عود" }], extras: [{ id: "burner", name: "مبخرة" }] } as Catalogue;
    shared.countries.forEach((c) => {
      delete c.sizes;
      delete c.scents;
      delete c.extras;
    });
    const d = toDraft(shared);
    expect(d.countries[0]!.sizes!.map((z) => z.id)).toEqual(["small"]);
    expect(d.countries[1]!.extras!.map((z) => z.id)).toEqual(["burner"]);
    expect(d.offer!.countries).toEqual(["OM", "AE"]);
    expect(d.tiers!.countries).toEqual(["OM", "AE"]);
    expect(d.offer!.freeShipIn).toEqual(["OM", "AE"]);
  });

  // from test-catalogue-merge.js / test-extras.js: never a code-owned field; the routes are the Empower tab's
  it("never sends toOmr, art, countsFree, routes, ledger or the retired offer2", () => {
    const c = { ...CFG(), courier: { name: "x" }, ledger: { rates: {} }, offer2: { active: true }, version: 7 } as Catalogue;
    const out = toPublish(toDraft(c)) as Catalogue & Record<string, unknown>;
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/"toOmr"|"art"|"countsFree"/);
    expect(out.countries.every((x) => x.courier === undefined)).toBe(true);
    expect(out.courier).toBeUndefined();
    expect(out.ledger).toBeUndefined();
    expect(out.offer2).toBeUndefined();
    expect(out.version).toBeUndefined();
  });

  // from test-offer-admin.js: the market list EMPTY when every box is ticked
  it("every market ticked is stored as [] (so a market added later is not excluded)", () => {
    const d = toDraft(CFG());
    expect(toPublish(d).offer!.countries).toEqual([]);
    d.offer!.countries = ["AE"];
    expect(toPublish(d).offer!.countries).toEqual(["AE"]);
  });

  // from test-v410.js: "Ships free in": all ticked = [], none ticked → freeShip false
  it("ships free in: all = [], none = the switch off", () => {
    const d = toDraft(CFG());
    d.offer!.freeShip = true;
    expect(toPublish(d).offer!.freeShipIn).toEqual([]);
    expect(toPublish(d).offer!.freeShip).toBe(true);
    d.offer!.freeShipIn = ["OM"];
    expect(toPublish(d).offer!.freeShipIn).toEqual(["OM"]);
    d.offer!.freeShipIn = [];
    expect(toPublish(d).offer!.freeShip).toBe(false);
  });

  it("the shared lists are rebuilt from the first market; free rows kept only when they say something", () => {
    const d = toDraft(CFG());
    d.freeShip = { active: true, countries: { OM: { on: true, over: 10, days: 5, from: "2026-10-01T00:00:00Z" }, AE: { on: false } } };
    const out = toPublish(d);
    expect(out.sizes.map((z) => z.id)).toEqual(["small", "large"]);
    expect(out.scents.map((z) => z.id)).toEqual(["oud", "amber"]);
    expect(Object.keys(out.freeShip!.countries!)).toEqual(["OM"]);
    expect(out.freeShip!.countries!.OM).toEqual({ on: true, over: 10, days: 5, from: "2026-10-01T00:00:00Z" });
    // Restart / Run again: a flag the server carries out, never a typed start
    d.freeShip.countries!.OM!.restart = true;
    expect(toPublish(d).freeShip!.countries!.OM).toEqual({ on: true, over: 10, days: 5, restart: true });
  });

  it("an untouched draft is the same draft; any edit is not", () => {
    const a = toDraft(CFG());
    const b = toDraft(CFG());
    expect(sameDraft(a, b)).toBe(true);
    b.countries[1]!.prices!.small!.now = 110;
    expect(sameDraft(a, b)).toBe(false);
  });
});

describe("refused before it is sent", () => {
  // from test-admin-batch.js / test-v303.js: "tick at least one market"
  it("an offer with no market ticked, an end before the start", () => {
    const d = toDraft(CFG());
    expect(problemsOf(d)).toEqual([]);
    d.offer!.countries = [];
    expect(problemsOf(d)).toContain("Small bundle: tick at least one market, or switch the small bundle off");
    d.offer!.active = false;
    expect(problemsOf(d).join()).not.toMatch(/Small bundle: tick/);
    d.tiers = { active: true, countries: [] };
    expect(problemsOf(d)).toContain("Large bundle offer: tick at least one market, or switch the offers off");
    d.offer!.startsAt = "2026-11-05T00:00:00+04:00";
    d.offer!.endsAt = "2026-11-01T23:59:59+04:00";
    expect(problemsOf(d)).toContain("Small bundle: end is before start. Fix the dates.");
  });
  // from test-catalogue-injection.js (panel half) and the server's validation
  it("ids are slugs, colours hex, codes and currencies and dial codes well formed, no duplicates", () => {
    const d = toDraft(CFG());
    d.countries[0]!.sizes![0]!.id = "<b>";
    d.countries[0]!.scents![0]!.accent = "red";
    d.countries[1]!.cur = "aed";
    d.countries[1]!.dial = "+971";
    d.countries[1]!.extras!.push({ id: "burner", name: "again" });
    const p = problemsOf(d).join("\n");
    expect(p).toMatch(/OM: a size ID can use letters, digits, - and _ only \(<b>\)/);
    expect(p).toMatch(/OM: oud has a colour that is not a hex colour/);
    expect(p).toMatch(/AE: the currency is three capital letters/);
    expect(p).toMatch(/AE: the dial code is digits only/);
    expect(p).toMatch(/AE: two add-ons share the ID burner/);
  });
});

describe("the small bundle's window", () => {
  // from test-offer-admin.js: "the anchor box" — shown in Muscat time, stored as the instant
  it("the anchor, readable", () => {
    expect(anchorText("2026-09-12T07:42:56.281Z")).toBe("2026-09-12 11:42 (Muscat)");
    expect(anchorText("")).toBe("");
  });
  // from test-admin-batch.js: stored in hours; shown back as round((hours||72)/24) in days; default 72
  it("hours or days: stored in hours, 5 days = 120, the default 72", () => {
    expect(hoursOf(5, "days")).toBe(120);
    expect(hoursOf(12, "hours")).toBe(12);
    expect(hoursOf(null, "hours")).toBe(72);
    expect(hoursOf(null, "days")).toBe(72);
    expect(lenShown(120, "days")).toBe(5);
    expect(lenShown(undefined, "hours")).toBe(72);
    expect(lenShown(undefined, "days")).toBe(3);
    // flipping the unit converts the number, so the window never moves
    expect(convertLen(5, "hours")).toBe(120);
    expect(convertLen(120, "days")).toBe(5);
    expect(convertLen(72, "days")).toBe(3);
  });
  it("the countdown reads in hours, and in days past two of them", () => {
    const o = { hours: 12, renew: "once", anchor: iso(NOW) };
    expect(offerEndsIn(o, NOW)).toMatch(/^11 h 59 min$/);
    expect(offerEndsIn({ hours: 120, renew: "once", anchor: iso(NOW) }, NOW)).toMatch(/^\d+ d \d+ h$/);
    // rolling: the window that contains now
    expect(offerEndsIn({ hours: 72, renew: "auto", anchor: iso(NOW - 80 * 3600e3) }, NOW)).not.toBe("");
    // one-shot, over
    expect(offerEndsIn({ hours: 12, renew: "once", anchor: iso(NOW - 40 * 3600e3) }, NOW)).toBe("");
  });
});

describe("the stock grid, every market at once (test-offer-admin)", () => {
  it("one scent in one size, in every market; out of every size is the plain flag", () => {
    const d = toDraft(CFG());
    setScentEverywhere(d, "amber", "large", true);
    for (const c of d.countries) {
      const a = c.scents!.find((s) => s.id === "amber")!;
      expect(a.soldOutSizes).toEqual(["large"]);
      expect(a.soldOut).toBe(false);
    }
    setScentEverywhere(d, "amber", "small", true);
    for (const c of d.countries) {
      const a = c.scents!.find((s) => s.id === "amber")!;
      expect(a.soldOutSizes).toEqual(["large", "small"]);
      expect(a.soldOut).toBe(true);
    }
    setScentEverywhere(d, "amber", "small", false);
    for (const c of d.countries) expect(c.scents!.find((s) => s.id === "amber")!.soldOutSizes).toEqual(["large"]);
    expect(scentStock(d, "amber", "large").all).toBe(true);
    expect(scentStock(d, "amber", "small").all).toBe(false);
    expect(commonStamp(d)).toBe("1 sold out everywhere");
    // survives the publish round trip (kept by id)
    const back = toDraft(toPublish(d));
    expect(back.countries[1]!.scents!.find((s) => s.id === "amber")!.soldOutSizes).toEqual(["large"]);
  });
  it("out in some markets and not others: unticked, with a note", () => {
    const d = toDraft(CFG());
    d.countries[0]!.scents![0]!.soldOutSizes = ["small"];
    const st = scentStock(d, "oud", "small");
    expect(st.all).toBe(false);
    expect(st.some).toBe("OM");
    expect(st.note).toBe("Sold out in OM");
  });
  // "Unticking 'sold out here' clears it when the scent was fully sold out"
  it("sold out here, unticked, puts every size back here", () => {
    const s = { id: "oud", name: "عود", soldOut: true, soldOutSizes: ["small", "large"] };
    setScentOutHere(s, false);
    expect(s.soldOut).toBe(false);
    expect(s.soldOutSizes).toBeUndefined();
  });
});

describe("why the bundle is not showing (test-offer-admin)", () => {
  it("all fine, switched off, a scent out of its box, out of the other box, no price where offered", () => {
    const d = toDraft(CFG());
    expect(offerWhyHidden(d.offer!, d, NOW)).toBe("");
    expect(offerWhyHidden({ ...d.offer!, active: false }, d, NOW)).toBe("the switch above is off");
    const out = toDraft(CFG());
    setScentEverywhere(out, "oud", "small", true);
    const why = offerWhyHidden(out.offer!, out, NOW);
    expect(why).toContain("عود");
    expect(why).toContain("صغير");
    expect(why).toContain("packed from");
    const other = toDraft(CFG());
    setScentEverywhere(other, "oud", "large", true);
    expect(offerWhyHidden(other.offer!, other, NOW)).toBe("");
    const unpriced = toDraft(CFG());
    unpriced.countries.forEach((c) => (c.prices!.bundle = { now: 0 }));
    expect(offerWhyHidden(unpriced.offer!, unpriced, NOW)).toBe("no market it is offered in has a bundle price");
    // the original's [] = everywhere still reads as everywhere
    expect(offerWhyHidden({ ...CFG().offer!, countries: [] }, CFG(), NOW)).toBe("");
  });
  it("a one-shot that ended says how to run it again; the heading says so", () => {
    const d = toDraft(CFG());
    d.offer = { ...d.offer!, hours: 12, renew: "once", anchor: iso(NOW - 40 * 3600e3) };
    expect(offerWhyHidden(d.offer, d, NOW)).toBe("ended (one-shot). Press Reset and save to run again");
    expect(offerStamp(d.offer, d, NOW)).toEqual({ text: "not showing: ended (one-shot). Press Reset and save to run again", tone: "warn" });
    d.offer.anchor = iso(NOW);
    expect(offerStamp(d.offer, d, NOW).text).toBe("on · window closes in 11 h 59 min");
    d.offer.startsAt = "2026-11-01T00:00:00+04:00";
    expect(offerStamp(d.offer, d, NOW)).toEqual({ text: "scheduled: starts 1 Nov 00:00 (Muscat)", tone: "info" });
  });
});

describe("the large-box offers' state (test-v303)", () => {
  it("off, starts when published, on with its end, ended", () => {
    expect(tiersState({ active: false }, NOW)).toBe("Off");
    expect(tiersState({ active: true, hours: 72 }, NOW)).toBe("Starts when you publish");
    expect(tiersState({ active: true, hours: 72, renew: "once", anchor: "2026-10-28T08:00:00Z" }, NOW)).toBe("On · ends 31 Oct 11:59");
    expect(tiersState({ active: true, hours: 72, renew: "once", anchor: "2026-10-20T08:00:00Z" }, NOW)).toBe("Ended 23 Oct 11:59");
  });
});

describe("the free-delivery offer per market (test-free-ship, panel half)", () => {
  it("off, set an amount, starts on publish, live with days left, ended", () => {
    expect(fsState(undefined, NOW)).toBe("off");
    expect(fsState({ on: true }, NOW)).toBe("unset");
    expect(fsState({ on: true, over: 0, days: 5 }, NOW)).toBe("pending");
    expect(fsWords({ on: true, over: 0, days: 5, from: "2026-10-27T10:00:00Z" }, NOW)).toEqual({ st: "live", pill: "4 days left", sub: "until 31 Oct" });
    expect(fsWords({ on: true, over: 10, days: 1, from: "2026-10-28T05:00:00Z" }, NOW).pill).toBe("Ends today");
    expect(fsWords({ on: true, over: 10, from: "2026-10-01T05:00:00Z" }, NOW)).toEqual({ st: "live", pill: "Live", sub: "no end date" });
    expect(fsWords({ on: true, over: 10, days: 2, from: "2026-10-01T05:00:00Z" }, NOW)).toEqual({ st: "ended", pill: "Ended", sub: "ended 2 Oct" });
    expect(fsState({ on: true, over: 10, days: 2, from: "2026-10-01T05:00:00Z", restart: true }, NOW)).toBe("pending");
  });
});

describe("markets", () => {
  // from test-catalogue-merge.js (UI side): a size deleted by mistake comes back in one tap, with its price
  it("Restore <size>: the definition from what was loaded, the price this market kept", () => {
    const loaded = CFG();
    const d = toDraft(loaded);
    const om = d.countries[0]!;
    om.sizes!.splice(0, 1);
    expect(missingSizes(om, d, loaded).map((z) => z.id)).toEqual(["small"]);
    const back = restoreSize(om, d, loaded, "small");
    expect(back!.name).toBe("صغير");
    expect(om.sizes!.map((z) => z.id)).toEqual(["large", "small"]);
    expect(om.prices!.small!.now).toBe(12);
    expect(missingSizes(om, d, loaded)).toEqual([]);
    // a placeholder id is never offered back
    d.countries[1]!.sizes!.push({ id: "size-3", name: "New size" });
    expect(missingSizes(om, d, loaded).map((z) => z.id)).toEqual([]);
  });
  it("renaming a size's id carries its price", () => {
    const d = toDraft(CFG());
    renameSizeId(d.countries[0]!, 0, "mini");
    expect(d.countries[0]!.prices!.mini!.now).toBe(12);
    expect(d.countries[0]!.prices!.small).toBeUndefined();
  });
  it("a new market starts from the first market at zero; the offers that ran everywhere run there too", () => {
    const d = toDraft(CFG());
    expect(addCountry(d, "kw")).toBe("");
    const kw = d.countries[2]!;
    expect(kw.code).toBe("KW");
    expect(kw.sizes!.map((z) => z.id)).toEqual(["small", "large"]);
    expect(kw.prices).toEqual({ small: { now: 0, was: 0 }, large: { now: 0, was: 0 } });
    expect(d.offer!.countries).toContain("KW");
    expect(addCountry(d, "KW")).toBe("That country already exists");
    expect(addCountry(d, "K1")).toBe("Invalid code. Two letters only.");
    expect(marketsStamp(d)).toEqual({ text: "3 markets · 2 unpriced sizes", warn: true });
  });
  it("a Stock Tracker answer is adopted only when nothing but the switches moved", () => {
    const a = CFG();
    const b = { ...CFG(), stockHide: { "oud-small": true } } as Catalogue;
    expect(sameButStock(a, b)).toBe(true);
    b.countries[0]!.courier = "manual";
    expect(sameButStock(a, b)).toBe(true);
    b.countries[1]!.prices!.small!.now = 1;
    expect(sameButStock(a, b)).toBe(false);
  });
});
