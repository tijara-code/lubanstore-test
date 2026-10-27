import { afterAll, describe, expect, it, vi } from "vitest";
import bundled from "../../data/catalogue.json";
import { priceOrder } from "../../src/shared/pricing/price";
import * as offers from "../../src/shared/pricing/offers";
import type { Catalogue } from "../../src/shared/catalogue/types";
import { REF_DIR, refLib } from "./ref";

const d = REF_DIR ? describe : describe.skip;

/** a small deterministic generator */
function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function variant(rnd: () => number): Catalogue {
  const c: Catalogue = JSON.parse(JSON.stringify(bundled));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  if (rnd() < 0.3) c.offer!.only = rnd() < 0.5;
  if (rnd() < 0.3) c.offer!.active = rnd() < 0.5;
  if (rnd() < 0.3) c.offer!.countries = [pick(["OM", "AE", "SA"])];
  if (rnd() < 0.3) c.offer!.renew = pick(["once", "auto"]);
  if (rnd() < 0.3) c.offer!.anchor = new Date(Date.now() - rnd() * 200 * 3600e3).toISOString();
  if (rnd() < 0.3) { c.offer!.freeShip = true; c.offer!.freeShipHours = pick([0, 24, 72]); if (rnd() < 0.7) c.offer!.freeShipAnchor = new Date(Date.now() - rnd() * 100 * 3600e3).toISOString(); c.offer!.freeShipRenew = pick(["once", "auto"]); if (rnd() < 0.4) c.offer!.freeShipIn = ["OM"]; }
  if (rnd() < 0.5) c.tiers!.anchor = new Date(Date.now() - rnd() * 100 * 3600e3).toISOString();
  if (rnd() < 0.2) c.tiers!.active = false;
  if (rnd() < 0.3) c.freeShip = { active: true, countries: { [pick(["OM", "AE", "KW"])]: { on: true, over: pick([0, 10, 200, "", -1]), days: pick([0, 3, "x"]), from: rnd() < 0.8 ? new Date(Date.now() - rnd() * 6 * 86400e3).toISOString() : "" } } };
  for (const country of c.countries) {
    if (rnd() < 0.15) country.codOn = false;
    if (rnd() < 0.15) country.freeOver = 0;
    if (rnd() < 0.1) delete country.toOmr;
    if (rnd() < 0.2) country.sizes = JSON.parse(JSON.stringify(c.sizes)).map((s: any) => ({ ...s, soldOut: rnd() < 0.2, hidden: rnd() < 0.15 ? "true" : false }));
    if (rnd() < 0.2) country.scents = JSON.parse(JSON.stringify(c.scents)).map((s: any) => ({ ...s, active: rnd() > 0.15, soldOut: rnd() < 0.1 ? "true" : false, soldOutSizes: rnd() < 0.3 ? [pick(["small", "large"])] : [] }));
    if (rnd() < 0.1) country.off = { sizes: rnd() < 0.5 ? ["small"] : [], scents: rnd() < 0.5 ? ["oud"] : [] };
  }
  if (rnd() < 0.2) c.extras![0]!.active = false;
  return c;
}

function basket(rnd: () => number) {
  const ids = ["oud-large", "lemon-large", "amber-large", "oud-small", "lemon-small", "amber-small", "bundle", "bundle2", "burner", "samples",
    "duo:oud.amber", "duo:amber.oud", "trio:oud.oud.amber", "trio:lemon.amber.oud", "duo:oud", "trio:x.y.z", "nope", "oud-size-3", " oud-large "];
  const n = 1 + Math.floor(rnd() * 4);
  return Array.from({ length: n }, () => ({ itemId: ids[Math.floor(rnd() * ids.length)], qty: [1, 2, 3, 0, -2, "abc", 150, "2"][Math.floor(rnd() * 8)] }));
}

d("pricing parity with the original till", () => {
  afterAll(() => { vi.useRealTimers(); });
  it("answers 4000 random baskets exactly as the original price.js", () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-20T10:00:00Z"), toFake: ["Date"] });
    const OLD = refLib("price");
    const rnd = prng(77);
    let compared = 0, refusals = 0;
    for (let k = 0; k < 4000; k++) {
      const cfg = variant(rnd);
      const input = { countryCode: ["OM", "AE", "SA", "QA", "KW", "BH", "XX", "om"][Math.floor(rnd() * 8)], items: basket(rnd), pay: rnd() < 0.5 ? "cod" : "card", manual: rnd() < 0.1, existing: rnd() < 0.1 };
      let a: any, b: any;
      try { a = OLD.priceOrder(cfg, input); } catch (e: any) { a = { refused: e.code, item: e.item ?? null }; }
      try { b = priceOrder(cfg, input); } catch (e: any) { b = { refused: e.code, item: e.item ?? null }; }
      if (a.refused) refusals++;
      expect(b, JSON.stringify({ k, input })).toEqual(a);
      compared++;
    }
    expect(compared).toBe(4000);
    expect(refusals).toBeGreaterThan(200);
    expect(refusals).toBeLessThan(3800);
  });

  it("offer windows agree across cycle boundaries", () => {
    const OLD = refLib("price");
    const rnd = prng(9);
    for (let k = 0; k < 2000; k++) {
      const now = Date.parse("2026-01-01T00:00:00Z") + Math.floor(rnd() * 400 * 86400e3);
      vi.useFakeTimers({ now, toFake: ["Date"] });
      const o: any = { hours: [0, 1, 24, 72, 168][Math.floor(rnd() * 5)], repeat: ["", "72h", "weekly", "monthly"][Math.floor(rnd() * 4)], renew: rnd() < 0.5 ? "once" : "auto",
        anchor: rnd() < 0.5 ? new Date(now - rnd() * 500 * 3600e3).toISOString() : rnd() < 0.5 ? "2026-03-04" : "",
        startsAt: rnd() < 0.2 ? new Date(now + (rnd() - 0.5) * 50 * 3600e3).toISOString() : "", endsAt: rnd() < 0.2 ? new Date(now + (rnd() - 0.5) * 50 * 3600e3).toISOString() : "", until: rnd() < 0.1 ? "2026-06-30" : "" };
      expect(offers.offerEndsAt(o, now)?.getTime() ?? null).toBe(OLD.offerEndsAt(o)?.getTime() ?? null);
      const cfg: any = { offer: { ...o, active: rnd() > 0.1 } };
      expect(offers.offerLive(cfg, "bundle", now)).toBe(OLD.offerLive(cfg, "bundle"));
    }
    vi.useRealTimers();
  });
});
