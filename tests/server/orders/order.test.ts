/**
 * POST /api/order — the cash till, driven through the real app over PGlite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createHarness, type Harness } from "../../helpers/harness";
import { logs, orderEvents, orders } from "../../../src/server/db/schema";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import { attribute, originOf } from "../../../src/shared/attribution";
import type { Catalogue } from "../../../src/shared/catalogue/types";

let h: Harness;
let ipN = 1;
const base = (extra: Record<string, unknown> = {}) => ({
  name: "Sara Ali",
  phone: "+968 91234567",
  countryCode: "OM",
  city: "Muscat",
  region: "Seeb",
  items: [{ itemId: "oud-large", qty: 1 }],
  ...extra,
});
/** each post from its own address unless a test says otherwise (the flood limit is per address) */
async function post(order: unknown, headers: Record<string, string> = {}) {
  const r = await h.post("/api/order", { order }, { "x-nf-client-connection-ip": "10.36.0." + ipN++, ...headers });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  return { s: r.status, j, r };
}
const say = (r: { s: number; j: Record<string, any> }) => r.s + " " + (r.j.error || (r.j.ok ? "ok" : ""));
const all = () => h.db.select().from(orders);

beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.reset();
});

describe("a cash order", () => {
  it("is written as new / cod / cod, priced from the catalogue, and answered { ok, id, omr, ga4 }", async () => {
    const r = await post(base({ dedupeId: "d-1", pageUrl: "https://lubanmusk.test/checkout.html", snap: { fbp: "fb.1.1700000000000.123", fbc: "fb.1.1700000000000.AbC_dEf", scid: "s-1", gcid: "123.456" } }), {
      "user-agent": "Mozilla/5.0 test",
    });
    expect(r.s).toBe(200);
    expect(Object.keys(r.j).sort()).toEqual(["ga4", "id", "ok", "omr"]);
    expect(r.j.id).toMatch(/^LM-\d{10}$/);
    // OM: large 25 + delivery 3 (under the 30 threshold) + cash fee 1
    expect(r.j.omr).toBe(29);
    expect(r.j.ga4).toBe("server"); // GA4 id + secret configured: the server sends it
    const [o] = await all();
    expect([o!.status, o!.paymentStatus, o!.pay]).toEqual(["new", "cod", "cod"]);
    expect([o!.sub, o!.ship, o!.codFee, o!.total, o!.omr, o!.cur]).toEqual([25, 3, 1, 29, 29, "OMR"]);
    expect(o!.items[0]).toMatchObject({ itemId: "oud-large", scent: "عود الافندر", price: 25, qty: 1 });
    expect(o!.invoiceKey).toMatch(/^[a-f0-9]{32}$/);
    expect(o!.phoneKey).toBe("96891234567");
    expect(o!.country).toBe("عمان");
    expect(o!.createdAt.getTime()).toBe(h.clock.t);
    // what the server-side Purchase needs, kept on the order
    expect(o!.client).toMatchObject({
      ip: expect.stringMatching(/^10\.36\.0\./),
      ua: "Mozilla/5.0 test",
      url: "https://lubanmusk.test/checkout.html",
      fbp: "fb.1.1700000000000.123",
      fbc: "fb.1.1700000000000.AbC_dEf",
      scid: "s-1",
      gcid: "123.456",
    });
    const ev = await h.db.select().from(orderEvents).where(eq(orderEvents.orderId, o!.id));
    expect(ev.map((e) => [e.kind, e.to, e.by])).toEqual([["created", "new", "shopper"]]);
  });

  // from test-admin-data.js: both order writers stamp origin = originOf(ref, own host); v302 attribution
  it("stamps origin and attribution from the landing the page reports", async () => {
    const ref = { sccid: true, src: "", ref: "https://www.instagram.com/" };
    const r = await post(base({ ref }));
    expect(r.s).toBe(200);
    const [o] = await all();
    expect(o!.origin).toBe(originOf(ref, "lubanmusk.test"));
    expect(o!.attribution).toEqual(attribute(ref, "lubanmusk.test", h.clock.t));
  });

  it("the shopper's proposed id is kept when it is free", async () => {
    const r = await post(base({ id: "LM-4000001", dedupeId: "d-x" }));
    expect(r.j.id).toBe("LM-4000001");
  });

  // from test-bugcheck.js: writeOrder — a taken id is renumbered, the same submission is one order
  it("a taken id gets a fresh one; the same submission twice is one order (already)", async () => {
    let r = await post(base({ id: "LM-123456", dedupeId: "d-a" }));
    expect(r.j.id).toBe("LM-123456");
    r = await post(base({ id: "LM-123456", dedupeId: "d-b", name: "Other Person" }));
    expect(r.s).toBe(200);
    expect(r.j.id).toMatch(/^LM-\d{10}$/);
    expect(r.j.id).not.toBe("LM-123456");
    const first = (await all()).find((o) => o.id === "LM-123456")!;
    expect(first.name).toBe("Sara Ali"); // untouched
    const pixelCalls = () => h.world.calls.filter((c) => /facebook|snapchat|google-analytics/.test(c.host)).length;
    const before = pixelCalls();
    r = await post(base({ id: "LM-123456", dedupeId: "d-a" }));
    // from test-v314.js A5: the same submission again is the same order
    expect([r.s, r.j.id, r.j.already]).toEqual([200, "LM-123456", true]);
    expect(Object.keys(r.j).sort()).toEqual(["already", "id", "ok", "omr"]);
    expect(pixelCalls()).toBe(before); // reported the first time only
    expect((await all()).length).toBe(2);
  });

  it("a GET is 405", async () => {
    const r = await h.get("/api/order");
    expect(r.status).toBe(405);
  });
});

describe("what a post must carry", () => {
  // from test-v314.js A20/A38
  it("refuses an incomplete post, a bad quantity, and survives a crafted toString", async () => {
    expect(say(await post(base({ phone: "." })))).toBe("400 incomplete");
    expect(say(await post(base({ name: "" })))).toBe("400 incomplete");
    expect(say(await post(base({ items: [] })))).toBe("400 incomplete");
    expect(say(await post({}))).toBe("400 incomplete");
    expect(say(await post(base({ items: [{ itemId: "oud-large", qty: 0 }] })))).toBe("400 bad_qty");
    expect(say(await post(base({ items: [{ itemId: "oud-large", qty: "abc" }] })))).toBe("400 bad_qty");
    const r = await post(base({ note: { toString: 1 }, items: [{ itemId: { toString: 1 }, qty: 1 }] }));
    expect(r.s).toBeLessThan(500);
    expect((await all()).length).toBe(0);
  });

  // from test-v336-server.js §3: the basket's shape
  it.each([
    ["qty 1.9", [{ itemId: "oud-large", qty: 1.9 }], "400 bad_qty"],
    ["qty '1e9'", [{ itemId: "oud-large", qty: "1e9" }], "400 bad_qty"],
    ["qty 1000", [{ itemId: "oud-large", qty: 1000 }], "400 bad_qty"],
    ["qty [3]", [{ itemId: "oud-large", qty: [3] }], "400 bad_qty"],
    ["qty 0", [{ itemId: "oud-large", qty: 0 }], "400 bad_qty"],
    ["a line that is null", [null], "400 unknown_item"],
    ["a line that is a string", ["oud-large"], "400 unknown_item"],
    ["40 lines of 99", Array.from({ length: 40 }, () => ({ itemId: "oud-large", qty: 99 })), "400 too_many"],
    ["three lines of 34 (102 boxes)", [{ itemId: "oud-large", qty: 34 }, { itemId: "amber-large", qty: 34 }, { itemId: "oud-large", qty: 34 }], "400 too_many"],
    ["41 lines of one", Array.from({ length: 41 }, () => ({ itemId: "oud-large", qty: 1 })), "400 too_many"],
  ])("%s → %s", async (_label, items, want) => {
    expect(say(await post(base({ items })))).toBe(want);
    expect((await all()).length).toBe(0);
  });

  it("99 boxes exactly, a quantity as digits, is taken; no quantity is one box", async () => {
    let r = await post(base({ items: [{ itemId: "oud-large", qty: "2" }, { itemId: "oud-large", qty: 97 }] }));
    expect(say(r)).toBe("200 ok");
    expect((await all())[0]!.items.map((i) => i.qty).join("+")).toBe("2+97");
    r = await post(base({ items: [{ itemId: "oud-large" }] }));
    expect(say(r)).toBe("200 ok");
    const o = (await all()).find((x) => x.id === r.j.id)!;
    expect(o.items[0]!.qty).toBe(1);
  });

  // from test-v336-server.js §7: the fields
  it("checks phone, email and free text before they are stored", async () => {
    expect(say(await post(base({ phone: "abc1234567<script>" })))).toBe("400 incomplete");
    let r = await post(base({ phone: "+٩٦٨ ٩١٢٣٤٥٦٧" }));
    expect(say(r)).toBe("200 ok");
    expect((await h.db.select().from(orders).where(eq(orders.id, r.j.id)))[0]!.phone).toBe("+968 91234567");
    r = await post(base({ phone: "‪+968 (9123) 4567‬‎" }));
    expect(say(r)).toBe("200 ok");
    expect((await h.db.select().from(orders).where(eq(orders.id, r.j.id)))[0]!.phone).toBe("+968 (9123) 4567");
    r = await post(
      base({ name: "<img src=x onerror=alert(1)>", city: "<b>Muscat</b>", region: "Seeb>", note: "<script>x</script>", email: '"><svg/onload=alert(1)>@evil.co' }),
    );
    const o = (await h.db.select().from(orders).where(eq(orders.id, r.j.id)))[0]!;
    expect([o.name, o.city, o.region, o.note].join("|")).toBe("img src=x onerror=alert(1)|bMuscat/b|Seeb|scriptx/script");
    expect(o.email).toBe(null);
    r = await post(base({ email: " Sara.Ali+gift@Example.co " }));
    expect((await h.db.select().from(orders).where(eq(orders.id, r.j.id)))[0]!.email).toBe("sara.ali+gift@example.co");
  });

  it("bad JSON is 400 bad_json", async () => {
    const r = await h.request("/api/order", { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe("bad_json");
  });
});

describe("the doors", () => {
  // from test-v336-server.js §4: the tills take their own page's posts
  it("refuses cross-site posts and anything but JSON", async () => {
    expect(say(await post(base(), { "content-type": "text/plain;charset=UTF-8", origin: "https://evil.example", "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" }))).toBe("403 forbidden");
    expect(say(await post(base(), { "sec-fetch-site": "cross-site" }))).toBe("403 forbidden");
    expect(say(await post(base(), { "Sec-Fetch-Site": "cross-site" }))).toBe("403 forbidden");
    expect(say(await post(base(), { "content-type": "text/plain" }))).toBe("415 bad_content_type");
    expect(say(await post(base(), { "content-type": "application/x-www-form-urlencoded" }))).toBe("415 bad_content_type");
    const none = await h.request("/api/order", { method: "POST", body: JSON.stringify({ order: base() }) });
    expect(none.status).toBe(415);
    expect((await all()).length).toBe(0);
    const own = await post(base(), { "content-type": "Application/JSON; charset=UTF-8", "sec-fetch-site": "same-origin" });
    expect(own.s).toBe(200);
  });

  // from test-v329.js: ten orders in ten minutes from one address, then 429 with Retry-After
  it("ten cash orders from one address land; the eleventh is 429 rate_limited, nothing written", async () => {
    const one = { "x-nf-client-connection-ip": "1.2.3.4" };
    for (let i = 0; i < 10; i++) expect((await post(base({ dedupeId: "rl-" + i }), one)).s).toBe(200);
    const r = await post(base({ dedupeId: "rl-10" }), one);
    expect(say(r)).toBe("429 rate_limited");
    const wait = Number(r.r.headers.get("retry-after"));
    expect(wait > 0 && wait <= 600).toBe(true);
    expect((await all()).length).toBe(10);
    expect((await post(base({ dedupeId: "rl-11" }), { "x-nf-client-connection-ip": "5.6.7.8" })).s).toBe(200);
    // no address is stored
    const keys = await h.db.execute(sql`select key from rate_limits`);
    expect(JSON.stringify(keys)).not.toMatch(/1\.2\.3\.4/);
    // the window passes: the address may order again
    h.clock.advance(10 * 60e3 + 1000);
    expect((await post(base({ dedupeId: "rl-12" }), one)).s).toBe(200);
  });
});

describe("pricing at the till", () => {
  // from test-bugcheck.js: /api/order is cash only — a market with COD off refuses it
  it("a market with cash on delivery off: 400 cod_not_offered, even if the post says card", async () => {
    const cat = bundledCatalogue();
    cat.countries.find((c) => c.code === "AE")!.codOn = false;
    await h.reset(cat);
    const r = await post(base({ countryCode: "AE", phone: "+971 50 123 4567", pay: "card" }));
    expect(say(r)).toBe("400 cod_not_offered");
  });

  it("the catalogue's refusals are 400 with the item", async () => {
    let r = await post(base({ items: [{ itemId: "nonsense-huge", qty: 1 }] }));
    expect(say(r)).toBe("400 unknown_item");
    expect(r.j.item).toBe("nonsense-huge");
    r = await post(base({ countryCode: "ZZ" }));
    expect(say(r)).toBe("400 unknown_country");
    // the small box is sold only inside the set (offer.only starts ON)
    r = await post(base({ items: [{ itemId: "oud-small", qty: 1 }] }));
    expect(say(r)).toBe("400 unavailable_here");
    expect(r.j.item).toBe("oud-small");
  });

  // from test-v336-server.js §1: a market with no OMR rate is refused, never charged 1:1
  it("a market with no OMR rate: 400 unpriced_item, nothing written", async () => {
    const cat = bundledCatalogue() as Catalogue;
    const eg = JSON.parse(JSON.stringify(cat.countries.find((c) => c.code === "AE")));
    Object.assign(eg, { code: "EG", name: "مصر", cur: "EGP", dial: "20", prices: { large: { now: 1500, was: 0 }, small: { now: 600, was: 0 }, bundle: { now: 1800, was: 0 } }, ship: 100, freeOver: 0, cod: 0 });
    delete eg.toOmr;
    cat.countries.push(eg);
    await h.reset(cat);
    const r = await post(base({ countryCode: "EG", phone: "+20 1012345678" }));
    expect(say(r)).toBe("400 unpriced_item");
    expect((await all()).length).toBe(0);
  });

  // from test-v336-server.js §5: a cold till whose catalogue read failed
  it("a cold till that cannot read the catalogue: 503 pricing_unavailable, not the deploy's prices", async () => {
    const cold = await createHarness();
    await cold.db.execute(sql`alter table settings rename to settings_gone`);
    const r = await cold.post("/api/order", { order: base() });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("pricing_unavailable");
    expect((await cold.db.select().from(orders)).length).toBe(0);
    await cold.db.execute(sql`alter table settings_gone rename to settings`);
  }, 120_000);

  it("a warm till prices from its last live copy when the read fails", async () => {
    const warm = await createHarness();
    const cat = bundledCatalogue();
    cat.countries.find((c) => c.code === "OM")!.prices!.large!.now = 40;
    await warm.publish(cat);
    expect((await warm.post("/api/order", { order: base({ dedupeId: "w1" }) })).status).toBe(200);
    warm.clock.advance(61_000); // the warm copy has aged out
    await warm.db.execute(sql`alter table settings rename to settings_gone`);
    const r = await warm.post("/api/order", { order: base({ dedupeId: "w2" }) }, { "x-nf-client-connection-ip": "9.9.9.1" });
    expect(r.status).toBe(200);
    const o = (await warm.db.select().from(orders).where(eq(orders.dedupeId, "w2")))[0]!;
    expect(o.items[0]!.price).toBe(40);
    await warm.db.execute(sql`alter table settings_gone rename to settings`);
  }, 120_000);

  it("a database with no published row still sells from the deploy's catalogue", async () => {
    await h.reset(null);
    expect(say(await post(base()))).toBe("200 ok");
  });
});

describe("faults of ours", () => {
  // from test-audit-fixes.js: public 5xx hygiene — no database words in the body, the detail in logs
  it("a failed insert is 502 upstream with no detail; the detail is logged", async () => {
    await h.db.execute(sql`alter table orders add constraint lm_test_refuse check (false) not valid`);
    try {
      const r = await post(base());
      expect(r.s).toBe(502);
      expect(r.j).toEqual({ ok: false, error: "upstream" });
      const l = await h.db.select().from(logs);
      expect(l.some((x) => /lm_test_refuse|constraint/.test(x.message))).toBe(true);
    } finally {
      await h.db.execute(sql`alter table orders drop constraint lm_test_refuse`);
    }
  });
});
