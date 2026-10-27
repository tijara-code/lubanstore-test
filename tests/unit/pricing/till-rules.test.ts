/**
 * The till's pricing rules (src/shared/pricing), as the original suites asserted them on the
 * committed catalogue. Refusals are thrown codes.
 */
import { describe, expect, it } from "vitest";
import bundled from "../../../data/catalogue.json";
import type { Catalogue } from "../../../src/shared/catalogue/types";
import { r3 } from "../../../src/shared/money";
import { priceOrder, rateOf, type PriceInput } from "../../../src/shared/pricing/price";
import { canonical, parseTier } from "../../../src/shared/pricing/tiers";

const T0 = Date.parse("2026-10-20T08:00:00Z");
const fresh = (mut?: (c: Catalogue) => void): Catalogue => {
  const c = JSON.parse(JSON.stringify(bundled)) as Catalogue;
  if (mut) mut(c);
  return c;
};
const cty = (c: Catalogue, code: string) => c.countries.find((x) => x.code === code)!;
const P = (cfg: Catalogue, input: Partial<PriceInput> & { items: unknown }, now = T0) =>
  priceOrder(cfg, { countryCode: "AE", pay: "card", ...input } as PriceInput, now);
const code = (f: () => unknown): string => {
  try {
    f();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code || "threw";
  }
};
const one = (itemId: string, qty = 1) => [{ itemId, qty }];

describe("price tampering", () => {
  // from test-price-tampering.js (AE small 120 AED, ship 30, free over 300, COD 10, rate 0.1047)
  const cfg = fresh();
  it("a forged price or label is ignored; the catalogue's stand", () => {
    const q = P(cfg, { items: [{ itemId: "oud-small", qty: 1, price: 0.01, scent: "hacked" }] });
    expect([q.items[0]!.price, q.items[0]!.scent]).toEqual([120, "عود الافندر"]);
  });
  it("forged delivery and fee are ignored", () => {
    const q = priceOrder(cfg, { countryCode: "AE", pay: "cod", items: one("oud-small"), ship: 0, codFee: 0 } as PriceInput, T0);
    expect([q.ship, q.codFee, q.total]).toEqual([30, 10, 160]);
  });
  it("a forged rate is ignored", () => {
    const q = P(cfg, { items: one("oud-small"), omrRate: 0.0001 } as never);
    expect([q.omrRate, q.omr]).toEqual([0.1047, r3((120 + 30) * 0.1047)]);
  });
  it("the free-delivery threshold, the country's own row, no cash fee on a card", () => {
    expect(P(cfg, { items: one("oud-large", 2) }).ship).toBe(0);
    const kw = P(cfg, { countryCode: "KW", items: one("oud-large") });
    expect([kw.cur, kw.items[0]!.price]).toEqual(["KWD", 20]);
    expect(P(cfg, { items: one("oud-small") }).codFee).toBe(0);
  });
  it("quantities clamped; refusals named", () => {
    expect(P(cfg, { items: one("oud-small", 99999) }).items[0]!.qty).toBe(99);
    expect(P(cfg, { items: one("oud-small", -5) }).items[0]!.qty).toBe(1);
    expect(code(() => P(cfg, { items: one("free-stuff") }))).toBe("unknown_item");
    expect(code(() => P(cfg, { items: one("oud-gigantic") }))).toBe("unknown_item");
    expect(code(() => P(cfg, { countryCode: "ZZ", items: one("oud-small") }))).toBe("unknown_country");
    expect(code(() => P(cfg, { items: [] }))).toBe("no_items");
  });
  it("a closed set is refused", () => {
    expect(code(() => P(fresh((c) => (c.offer!.until = "2020-01-01")), { items: one("bundle") }))).toBe("offer_closed");
    expect(code(() => P(fresh((c) => (c.offer!.active = false)), { items: one("bundle") }))).toBe("offer_closed");
  });
});

describe("availability per market", () => {
  // from test-availability.js
  it("a size sold out in one market only", () => {
    const cfg = fresh((c) => (cty(c, "AE").sizes = c.sizes.map((s) => (s.id === "small" ? { ...s, soldOut: true } : s))));
    expect(code(() => P(cfg, { items: one("oud-small") }))).toBe("unknown_item");
    expect(code(() => P(cfg, { countryCode: "SA", items: one("oud-small") }))).toBe("ok");
    expect(code(() => P(cfg, { items: one("oud-large") }))).toBe("ok");
    expect(code(() => P(cfg, { items: [...one("oud-large"), ...one("oud-small")] }))).toBe("unknown_item");
  });
  it("a scent sold out: every size of it; the set survives until every scent is out", () => {
    const out = (ids: string[]) => fresh((c) => (cty(c, "AE").scents = c.scents.map((s) => (ids.includes(s.id) ? { ...s, soldOut: true } : s))));
    const cfg = out(["amber"]);
    expect([code(() => P(cfg, { items: one("amber-large") })), code(() => P(cfg, { items: one("amber-small") }))]).toEqual(["unknown_item", "unknown_item"]);
    expect(code(() => P(cfg, { items: one("oud-small") }))).toBe("ok");
    expect(code(() => P(cfg, { countryCode: "SA", items: one("amber-large") }))).toBe("ok");
    expect(code(() => P(cfg, { items: one("bundle") }))).toBe("ok");
    expect(code(() => P(out(["oud", "lemon", "amber"]), { items: one("bundle") }))).toBe("unavailable_here");
  });
  it("per-size scent stock, the set packed from small boxes", () => {
    const by = (sizes: string[], who = ["amber"]) => fresh((c) => (cty(c, "AE").scents = c.scents.map((s) => (who.includes(s.id) ? { ...s, soldOutSizes: sizes } : s))));
    const L = by(["large"]);
    expect([code(() => P(L, { items: one("amber-large") })), code(() => P(L, { items: one("amber-small") })), code(() => P(L, { items: one("bundle") }))]).toEqual(["unknown_item", "ok", "ok"]);
    const S = by(["small"]);
    expect([code(() => P(S, { items: one("amber-large") })), code(() => P(S, { items: one("amber-small") })), code(() => P(S, { items: one("bundle") }))]).toEqual(["ok", "unknown_item", "ok"]);
    expect(code(() => P(by(["small"], ["oud", "lemon", "amber"]), { items: one("bundle") }))).toBe("unavailable_here");
    const small = fresh((c) => (cty(c, "AE").sizes = c.sizes.map((s) => (s.id === "small" ? { ...s, soldOut: true } : s))));
    expect(code(() => P(small, { items: one("bundle") }))).toBe("unavailable_here");
  });
  it("the string \"false\" is not sold out; the legacy switches still hold; manual skips availability", () => {
    expect(code(() => P(fresh((c) => (c.sizes[1]!.soldOut = "false" as never)), { items: one("oud-small") }))).toBe("ok");
    const legacy = fresh((c) => (cty(c, "AE").off = { sizes: ["small"], scents: [] }));
    expect(code(() => P(legacy, { items: one("oud-small") }))).toBe("unavailable_here");
    const sold = fresh((c) => (cty(c, "AE").sizes = c.sizes.map((s) => (s.id === "small" ? { ...s, soldOut: true } : s))));
    expect(code(() => P(sold, { items: one("oud-small"), manual: true }))).toBe("ok");
  });
  // from test-v185.js: a hidden size is off the till, allowed by hand
  it("a hidden size", () => {
    const cfg = fresh((c) => (c.sizes = c.sizes.map((s) => (s.id === "large" ? { ...s, hidden: true } : s))));
    expect(code(() => P(cfg, { items: one("oud-large") }))).toBe("unknown_item");
    expect(code(() => P(cfg, { items: one("oud-large"), manual: true }))).toBe("ok");
  });
});

describe("cash on delivery", () => {
  // from test-cod-refusal.js
  it("the fee where offered; refused where switched off; card unaffected; absent = offered", () => {
    expect(priceOrder(fresh(), { countryCode: "AE", pay: "cod", items: one("oud-large") }, T0).codFee).toBeGreaterThan(0);
    const off = fresh((c) => (cty(c, "AE").codOn = false));
    expect(code(() => priceOrder(off, { countryCode: "AE", pay: "cod", items: one("oud-large") }, T0))).toBe("cod_not_offered");
    expect(code(() => priceOrder(off, { countryCode: "AE", pay: "card", items: one("oud-large") }, T0))).toBe("ok");
    expect(code(() => priceOrder(fresh((c) => delete cty(c, "AE").codOn), { countryCode: "AE", pay: "cod", items: one("oud-large") }, T0))).toBe("ok");
  });
});

describe("free delivery", () => {
  // from test-bugcheck.js: freeOver 0 means no free delivery, not free for all
  it("freeOver 0 charges delivery", () => {
    const cfg = fresh((c) => (cty(c, "AE").freeOver = 0));
    expect(P(cfg, { items: one("oud-large", 3) }).ship).toBe(30);
  });
  // from test-free-ship.js: the till's side of the free-delivery offer
  it("an offer for N days: free during, charged from the morning after its last day", () => {
    const from = "2026-09-23T15:00:00+04:00";
    const cfg = fresh((c) => (c.freeShip = { active: true, countries: { OM: { on: true, over: 10, days: 5, from }, AE: { on: true, over: 0 } } }));
    const om = (now: number) => P(cfg, { countryCode: "OM", items: one("oud-small") }, now).ship;
    expect(om(Date.parse("2026-09-27T23:59:00+04:00"))).toBe(0);
    expect(om(Date.parse("2026-09-28T00:00:01+04:00"))).toBe(cty(cfg, "OM").ship);
    expect(P(cfg, { countryCode: "AE", items: one("oud-small") }, Date.parse("2026-12-01T00:00:00Z")).ship).toBe(0);
    const noStart = fresh((c) => (c.freeShip = { active: true, countries: { OM: { on: true, over: 10, days: 5 } } }));
    expect(P(noStart, { countryCode: "OM", items: one("oud-small") }).ship).toBe(cty(noStart, "OM").ship);
  });
  // from test-samples-free.js: the sampler is charged but never counts toward free delivery
  it("samples never count toward free delivery; the burner does", () => {
    const cfg = fresh();
    const OM = cty(cfg, "OM");
    const F = OM.freeOver!, S = OM.prices!.small!.now, X = OM.prices!.samples!.now;
    const qn = Math.ceil(F / S) - 1;
    const m = Math.ceil((F - qn * S) / X);
    let q = P(cfg, { countryCode: "OM", items: one("oud-small", qn) });
    expect(q.ship).toBe(OM.ship);
    q = P(cfg, { countryCode: "OM", items: [...one("oud-small", qn), ...one("samples", m)] });
    expect([q.sub >= F, q.ship, q.sub, q.freeSub]).toEqual([true, OM.ship, qn * S + m * X, qn * S]);
    expect(P(cfg, { countryCode: "OM", items: [...one("oud-small", qn + 1), ...one("samples")] }).ship).toBe(0);
    expect(P(cfg, { countryCode: "OM", items: [...one("oud-small", qn), ...one("burner")] }).ship).toBe(0);
  });
  // from test-v411.js: the set ships free, inside its own window
  it("the set ships free while its switch and window say so", () => {
    const on = (o: Record<string, unknown>) => fresh((c) => Object.assign(c.offer!, { freeShip: true, ...o }));
    const ship = (cfg: Catalogue, now = T0) => P(cfg, { countryCode: "OM", items: one("bundle") }, now).ship;
    expect(ship(fresh())).toBe(3);
    expect(ship(on({}))).toBe(0);
    const anchored = on({ freeShipHours: 24, freeShipAnchor: new Date(T0 - 3600e3).toISOString() });
    expect(ship(anchored)).toBe(0);
    expect(ship(anchored, T0 + 24 * 3600e3)).toBe(3);
    expect(ship(on({ freeShipHours: 24 }))).toBe(3);
  });
});

describe("the large-box offers (v303)", () => {
  // from test-v303.js
  const live = (mut?: (c: Catalogue) => void) => fresh((c) => {
    c.tiers = { ...c.tiers, active: true, anchor: new Date(T0 - 3600e3).toISOString() };
    if (mut) mut(c);
  });
  it("ids", () => {
    expect(parseTier("trio:oud.oud.amber")).toEqual({ tier: "trio", n: 3, mix: ["oud", "oud", "amber"] });
    expect([parseTier("trio:oud.amber"), parseTier("duo:oud.oud.oud"), parseTier("trio:"), parseTier("quad:a.b.c.d"), parseTier("trio:oud.<x>.amber")].every((x) => x === null)).toBe(true);
    expect(canonical("trio", ["amber", "oud", "oud"], ["oud", "lemon", "amber"])).toBe("trio:oud.oud.amber");
  });
  it("priced per market, named for the panel and the invoice", () => {
    const cfg = live();
    const q = P(cfg, { items: one("trio:amber.oud.oud") });
    const l = q.items[0]!;
    expect([l.price, q.cur, l.itemId, l.scent + " | " + l.size, l.was, q.ship]).toEqual([499, "AED", "trio:oud.oud.amber", "3 علب | عود الافندر ×2 · عنبر توت", 750, 0]);
    expect(P(cfg, { countryCode: "OM", items: one("duo:lemon.lemon") }).items[0]!.price).toBe(29.9);
    expect(P(cfg, { countryCode: "OM", items: one("trio:oud.lemon.amber") }).items[0]!.price).toBe(35.9);
    expect(["duo:oud.amber", "trio:oud.amber.lemon"].map((id) => P(cfg, { countryCode: "QA", items: one(id) }).items[0]!.price)).toEqual([419, 499]);
    expect(P(cfg, { countryCode: "QA", items: one("trio:oud.oud.oud", 2) }).sub).toBe(998);
  });
  it("refused where it is not sold, malformed, closed or out", () => {
    const cfg = live();
    expect(code(() => P(cfg, { countryCode: "SA", items: one("trio:oud.oud.amber") }))).toBe("unavailable_here");
    expect(code(() => P(cfg, { items: one("trio:oud.amber") }))).toBe("unknown_item");
    expect(code(() => P(cfg, { items: one("trio:oud.oud.rose") }))).toBe("unknown_item");
    expect(code(() => P(cfg, { items: one("trio:oud.oud.amber") }, T0 + 72 * 3600e3))).toBe("offer_closed");
    expect(code(() => P(cfg, { items: one("trio:oud.oud.amber"), manual: true }, T0 + 72 * 3600e3))).toBe("ok");
    expect(code(() => P(fresh(), { items: one("trio:oud.oud.amber") }))).toBe("offer_closed"); // never started
    expect(code(() => P(live((c) => (c.tiers!.active = false)), { items: one("duo:oud.amber") }))).toBe("offer_closed");
    expect(code(() => P(live((c) => (c.tiers!.countries = ["OM"])), { items: one("duo:oud.amber") }))).toBe("unavailable_here");
    const amberOut = live((c) => (cty(c, "AE").scents = c.scents.map((s) => (s.id === "amber" ? { ...s, soldOutSizes: ["large"] } : s))));
    expect(code(() => P(amberOut, { items: one("trio:oud.oud.amber") }))).toBe("unknown_item");
    expect(code(() => P(amberOut, { items: one("trio:oud.oud.lemon") }))).toBe("ok");
  });
});

describe("the set's size sold only in the set (v309)", () => {
  // from test-v309.js
  const only = fresh((c) => (c.offer!.only = true));
  it("a single small box is refused; by hand, or an order placed before, it stands", () => {
    expect(["oud-small", "lemon-small", "amber-small"].map((id) => code(() => P(only, { items: one(id) })))).toEqual(Array(3).fill("unavailable_here"));
    expect(code(() => P(only, { items: one("oud-small"), manual: true }))).toBe("ok");
    expect(code(() => P(only, { items: one("oud-small"), existing: true }))).toBe("ok");
    expect(code(() => P(only, { items: one("bundle") }))).toBe("ok");
    expect(code(() => P(only, { items: one("oud-large") }))).toBe("ok");
    expect(code(() => P(fresh((c) => (c.offer!.only = false)), { items: one("oud-small") }))).toBe("ok");
  });
  it("the retired large set is refused", () => {
    expect(code(() => P(fresh((c) => (c.offer2 = { active: true, sizeId: "large" })), { items: one("bundle2") }))).toBe("offer_closed");
  });
});

describe("money", () => {
  // from test-v336-server.js §1
  it("rateOf: an OMR market with no rate is 1, any other 0, a stated one stands", () => {
    expect([rateOf({ cur: "OMR" }), rateOf({ cur: "EGP" }), rateOf({ cur: "EGP", toOmr: "x" as never }), rateOf({ cur: "AED", toOmr: 0.1047 })]).toEqual([1, 0, 0, 0.1047]);
  });
  // from test-bugcheck.js: a size id with a dash is priced
  it("a size id containing a dash", () => {
    const cfg = fresh((c) => {
      c.sizes.push({ id: "size-3", name: "x" });
      cty(c, "AE").prices!["size-3"] = { now: 8, was: 0 };
    });
    expect(P(cfg, { items: one("oud-size-3", 2) }).sub).toBe(16);
  });
});
