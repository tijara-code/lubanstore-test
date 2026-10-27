/**
 * The public reads: /api/track, /invoice/:id, /api/settings, /api/geo, /api/health.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createHarness, type Harness } from "../../helpers/harness";
import { putOp } from "../../../src/server/core/ops";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import { sameSecret } from "../../../src/server/domain/invoice";
import { JOBS } from "../../../src/server/jobs";
import { KEY, seedOrders, seedShipment } from "./fixtures";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => h.reset());
afterAll(async () => h.reset());

const track = async (id: string, ip = "198.51.100." + Math.floor(Math.random() * 250)) => {
  const r = await h.get("/api/track?id=" + encodeURIComponent(id), { "x-nf-client-connection-ip": ip });
  return { s: r.status, j: (await r.json()) as Record<string, any>, text: "", r };
};

describe("/api/track", () => {
  // from test-track.js
  it("a known order with an Empower parcel: the carrier's stage, its words, the rail's step, the dates", async () => {
    await seedOrders(h, [{ id: "LM-482913", status: "prep", paymentStatus: "paid", pay: "card" }]);
    await seedShipment(h, {
      orderId: "LM-482913",
      status: "Out for Delivery",
      awb: "291700000001",
      createdAt: new Date("2026-08-16T05:00:00Z"),
      pickedUpAt: new Date("2026-08-17T05:00:00Z"),
    });
    const r = await h.get("/api/track?id=LM-482913");
    const body = await r.text();
    const j = JSON.parse(body);
    expect(r.status).toBe(200);
    expect([j.stage, j.text, j.step]).toEqual(["transit", "في الطريق إليك", 2]);
    expect(j.dates.picked.slice(0, 10)).toBe("2026-08-17");
    // what it must NOT return
    expect(/awb|291700000001/i.test(body)).toBe(false);
    expect(/phone/i.test(body)).toBe(false);
    expect(/address|city/i.test(body)).toBe(false);
    expect(/name/i.test(body)).toBe(false);
    expect(r.headers.get("netlify-cdn-cache-control")).toMatch(/s-maxage=60/);
  });

  it("Omniful's snake_case words read the same", async () => {
    await seedOrders(h, [{ id: "LM-482914", status: "ship" }]);
    await seedShipment(h, { orderId: "LM-482914", status: "out_for_delivery" });
    expect((await track("LM-482914")).j.stage).toBe("transit");
  });

  // from test-audit-fixes.js: the tracking input normaliser, applied by the server too
  it("accepts what people type: lowercase, a space, no hyphen, digits alone", async () => {
    await seedOrders(h, [{ id: "LM-482913" }]);
    for (const id of ["lm-482913", "lm 482913", "LM482913", "482913", " LM-482913 "]) {
      const r = await track(id);
      expect([id, r.s, r.j.id]).toEqual([id, 200, "LM-482913"]);
    }
  });

  it("no parcel yet: preparing; an unpaid card attempt: awaiting payment", async () => {
    await seedOrders(h, [
      { id: "LM-482913", status: "new" },
      { id: "LM-482915", status: "pending", pay: "card", paymentStatus: "unpaid" },
    ]);
    expect((await track("LM-482913")).j).toEqual({ ok: true, id: "LM-482913", dates: {}, stage: "preparing", step: 0, text: "قيد التحضير" });
    expect((await track("LM-482915")).j.stage).toBe("awaiting_payment");
  });

  // from test-audit-fixes.js: cancelled is its own answer, even with a parcel booked
  it("a cancelled order: stage cancelled, step -1, never preparing", async () => {
    await seedOrders(h, [{ id: "LM-482916", status: "void" }]);
    await seedShipment(h, { orderId: "LM-482916", status: "picked_up" });
    expect((await track("LM-482916")).j).toEqual({ ok: true, id: "LM-482916", dates: {}, stage: "cancelled", step: -1, text: "تم إلغاء الطلب" });
  });

  it("shipped by hand with a manual tracking number: in transit, then delivered — the number never shown", async () => {
    await seedOrders(h, [{ id: "LM-482917", status: "ship", tracking: "TRK-9988", carrier: "Aramex", shippedAt: new Date("2026-10-19T10:00:00Z") }]);
    let r = await h.get("/api/track?id=LM-482917");
    let body = await r.text();
    expect(JSON.parse(body)).toMatchObject({ stage: "transit", step: 2, dates: { picked: "2026-10-19T10:00:00.000Z" } });
    expect(/TRK|Aramex/.test(body)).toBe(false);
    await h.db.execute(sql`update orders set status = 'done', delivered_at = '2026-10-20T07:00:00Z' where id = 'LM-482917'`);
    r = await h.get("/api/track?id=LM-482917", { "x-nf-client-connection-ip": "198.51.100.200" });
    body = await r.text();
    expect(JSON.parse(body)).toMatchObject({ stage: "delivered", step: 3, text: "تم التسليم" });
  });

  it("a send taken off Empower (cancelled) is not where the order is", async () => {
    await seedOrders(h, [{ id: "LM-482918", status: "new" }]);
    await seedShipment(h, { orderId: "LM-482918", status: "cancelled" });
    expect((await track("LM-482918")).j.stage).toBe("preparing");
  });

  // from test-track.js: a binned order answers exactly like an unknown one
  it("trashed and unknown: the same 404", async () => {
    await seedOrders(h, [{ id: "LM-482913", trashed: true }]);
    const t = await h.get("/api/track?id=LM-482913");
    const u = await h.get("/api/track?id=LM-999999");
    expect([t.status, u.status]).toEqual([404, 404]);
    expect(await t.text()).toBe(await u.text());
  });

  it("input validation and methods", async () => {
    expect((await track("")).s).toBe(400);
    expect((await track("../../etc/passwd")).j).toEqual({ ok: false, error: "bad_id" });
    expect((await track("LM-1' or '1'='1")).s).toBe(400);
    const p = await h.request("/api/track?id=LM-482913", { method: "POST" });
    expect(p.status).toBe(405);
  });

  it("is rate limited per address", async () => {
    const one = "203.0.113.99";
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await track("LM-999999", one)).s;
    expect(last).toBe(429);
    expect((await track("LM-999999", "203.0.113.98")).s).toBe(404);
  });
});

describe("/invoice/:id", () => {
  const inv = (id: string, k = KEY) => h.get("/invoice/" + id + (k === null ? "" : "?k=" + encodeURIComponent(k)));

  // from test-invoice.js
  it("the right key: 200, the order, personal headers; nothing a forwarded invoice should not carry", async () => {
    await seedOrders(h, [{ id: "LM-123456", email: "a@b.co", region: "Al Barsha Secret Street", city: "Dubai Marina" }]);
    const r = await inv("LM-123456");
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(body).toContain("LM-123456");
    expect(body).toContain('<html lang="ar" dir="rtl">');
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    for (const leak of ["50 123 4567", "a@b.co", "Al Barsha Secret Street", "Dubai Marina"]) expect(body).not.toContain(leak);
    expect(body).toContain('<b dir="auto">Ahmed Al Balushi</b>');
  });

  it("wrong key, unknown order, binned order, no key, a malformed path: one not-found page, 404", async () => {
    await seedOrders(h, [{ id: "LM-123456" }, { id: "LM-123457", trashed: true }]);
    const wrong = await inv("LM-123456", "ffffffffffffffffffffffffffffffff");
    const unknown = await inv("LM-654321");
    const binned = await inv("LM-123457");
    const none = await inv("LM-123456", null as unknown as string);
    const bad = await h.get("/invoice/%E0?k=" + KEY);
    const trav = await h.get("/invoice/../../etc/passwd");
    const wb = await wrong.text();
    expect([wrong.status, unknown.status, binned.status, none.status, bad.status, trav.status]).toEqual([404, 404, 404, 404, 404, 404]);
    expect(wb).toBe(await unknown.text());
    expect(wb).toBe(await binned.text());
    expect(wb).toContain("لم نجد هذه الفاتورة");
    expect(wb).not.toContain("Ahmed");
    expect((await h.request("/invoice/LM-123456?k=" + KEY, { method: "POST" })).status).toBe(405);
  });

  it("escapes what the customer typed and what the catalogue says", async () => {
    const x = '"><img src=x onerror=alert(1)>';
    await seedOrders(h, [{ id: "LM-123456", name: x, items: [{ itemId: "oud-large", scent: x, size: x, qty: 1, price: 250 }] }]);
    const body = await (await inv("LM-123456")).text();
    expect(body).toContain("&lt;img");
    expect(body).not.toContain("<img src=x");
  });

  // from test-audit-fixes.js: the COD fee row, the status pill
  it("a cash invoice shows the cash fee so the lines add up; a card one has none", async () => {
    await seedOrders(h, [
      { id: "LM-200001", ship: 30, total: 290 },
      { id: "LM-200002", pay: "card", paymentStatus: "paid", ship: 30, total: 280, codFee: 0 },
    ]);
    const cod = await (await inv("LM-200001")).text();
    expect(cod).toContain('<div class="row"><span>رسوم الدفع عند الاستلام</span><b><span class="amt">10 AED</span></b></div>');
    expect(cod).toContain('<span class="amt">290 AED</span>');
    const card = await (await inv("LM-200002")).text();
    expect(card).not.toContain("رسوم الدفع عند الاستلام");
  });

  it.each([
    [{ pay: "card", paymentStatus: "paid" }, "مدفوع"],
    [{ pay: "card", paymentStatus: "unpaid", status: "pending" }, "بانتظار الدفع"],
    [{ pay: "card", paymentStatus: "cancelled", status: "void" }, "ملغي"],
    [{ pay: "card", paymentStatus: "refunded", refunded: true, status: "void" }, "مسترد"],
    [{ pay: "cod", paymentStatus: "cod" }, "عند الاستلام"],
  ] as const)("the pill says where the payment stands: %j → %s", async (o, word) => {
    await seedOrders(h, [{ id: "LM-300001", ...(o as object) }]);
    const body = await (await inv("LM-300001")).text();
    expect(body).toContain('<span class="pill">' + word + "</span>");
  });

  // from test-bugcheck.js / test-invoice.js: three decimals where the currency has them; amounts one unit
  it("OMR, BHD and KWD keep three decimals; each amount is one .amt unit; the date is Muscat's", async () => {
    await seedOrders(h, [
      { id: "LM-400001", cur: "OMR", total: 25.5, ship: 0, pay: "card", paymentStatus: "paid", items: [{ itemId: "oud-large", scent: "عود", size: "", qty: 1, price: 25.5 }], createdAt: new Date("2026-10-19T21:30:00Z") },
      { id: "LM-400002", cur: "KWD", total: 20.125, ship: 0, pay: "card", paymentStatus: "paid", items: [{ itemId: "oud-large", scent: "عود", size: "", qty: 1, price: 20.125 }] },
    ]);
    const om = await (await inv("LM-400001")).text();
    expect(om).toContain('<span class="amt">25.5 OMR</span>');
    expect((om.match(/<span class="amt">/g) || []).length).toBe(2); // one line + the total; delivery is free
    expect(om).toContain("مجاني");
    // 21:30 UTC on the 19th is the 20th in Muscat
    expect(om).toContain(new Date("2026-10-20T08:00:00Z").toLocaleDateString("ar-AE", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Muscat" }));
    expect(await (await inv("LM-400002")).text()).toContain('<span class="amt">20.125 KWD</span>');
  });

  it("sameSecret: constant time with a length check; an empty secret never matches", () => {
    expect(sameSecret("a".repeat(32), "a".repeat(31))).toBe(false);
    expect(sameSecret("", "")).toBe(false);
    expect(sameSecret(null, "x")).toBe(false);
    expect(sameSecret("k1", "k1")).toBe(true);
  });
});

describe("/api/settings", () => {
  it("the published catalogue merged with the deploy's code-owned fields, less the panel's own, plus GA4", async () => {
    const cat = bundledCatalogue();
    cat.countries.find((c) => c.code === "AE")!.prices!.large!.now = 240;
    cat.countries.find((c) => c.code === "AE")!.courier = "omniful";
    cat.courier = { auto: true };
    delete cat.countries.find((c) => c.code === "AE")!.toOmr; // a publish strips it; the deploy puts it back
    await h.publish(cat);
    const r = await h.get("/api/settings");
    const j = (await r.json()) as any;
    expect(r.status).toBe(200);
    const ae = j.countries.find((c: any) => c.code === "AE");
    expect(ae.prices.large.now).toBe(240);
    expect(ae.toOmr).toBe(0.1047);
    expect("courier" in ae).toBe(false);
    expect("courier" in j || "ledger" in j).toBe(false);
    expect(j.analytics).toEqual({ ga4: "G-FAKE00001", mp: true });
    expect(r.headers.get("netlify-cdn-cache-control")).toBe("public, durable, s-maxage=60, stale-while-revalidate=86400");
    expect(r.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(r.headers.get("last-modified")).toBeTruthy();
  });

  it("GA4 without its secret: mp false; no id: an empty id", async () => {
    const a = await createHarness({ env: { GA4_API_SECRET: "" } });
    expect(((await (await a.get("/api/settings")).json()) as any).analytics).toEqual({ ga4: "G-FAKE00001", mp: false });
    const b = await createHarness({ env: { GA4_MEASUREMENT_ID: "" } });
    expect(((await (await b.get("/api/settings")).json()) as any).analytics).toEqual({ ga4: "", mp: false });
  }, 120_000);

  it("nothing published: the deploy's catalogue", async () => {
    await h.publish(null);
    const j = (await (await h.get("/api/settings")).json()) as any;
    expect(j.countries.map((c: any) => c.code)).toEqual(bundledCatalogue().countries.map((c) => c.code));
  });

  // from test-audit-fixes.js / v319: the database blinked
  it("a failed read: this instance's last good copy for 15 s; a cold instance says 502 upstream", async () => {
    const x = await createHarness();
    expect((await x.get("/api/settings")).status).toBe(200);
    await x.db.execute(sql`alter table settings rename to settings_gone`);
    const r = await x.get("/api/settings");
    expect(r.status).toBe(200);
    expect(r.headers.get("netlify-cdn-cache-control")).toBe("public, s-maxage=15, stale-while-revalidate=60");
    x.clock.advance(6 * 3600e3 + 1);
    const late = await x.get("/api/settings");
    expect(late.status).toBe(502);
    expect(await late.json()).toEqual({ error: "upstream" });
    const cold = await createHarness();
    await cold.db.execute(sql`alter table settings rename to settings_gone`);
    const c = await cold.get("/api/settings");
    expect([c.status, JSON.stringify(await c.json())]).toEqual([502, '{"error":"upstream"}']);
  }, 120_000);

  it("other methods: 405", async () => {
    expect((await h.request("/api/settings", { method: "PUT" })).status).toBe(405);
  });
});

describe("/api/geo", () => {
  it("the edge country, never cached", async () => {
    const r = await h.get("/api/geo", { "x-nf-country": "ae", "x-country": "" });
    expect(await r.json()).toEqual({ country: "AE" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    const g = Buffer.from(JSON.stringify({ country: { code: "SA" } })).toString("base64");
    expect(await (await h.get("/api/geo", { "x-nf-geo": g, "x-country": "" })).json()).toEqual({ country: "SA" });
    expect(await (await h.get("/api/geo", { "x-country": "" })).json()).toEqual({ country: "" });
    expect((await h.request("/api/geo", { method: "PUT" })).status).toBe(405);
  });
});

describe("/api/health", () => {
  const markRan = async (name: string, agoMin: number, extra: Record<string, unknown> = {}) =>
    putOp(h.db, "job:" + name, { at: new Date(h.clock.t - agoMin * 60e3).toISOString(), ...extra });

  // from test-v324.js / test-v334.js
  it("every job on time: 200 ok; one late: 503 with the job named; counts only in public", async () => {
    for (const n of Object.keys(JOBS)) await markRan(n, 1);
    let r = await h.get("/api/health");
    let j = (await r.json()) as any;
    expect([r.status, j.ok, j.db.ok, j.staleJobs]).toEqual([200, true, true, []]);
    expect(r.headers.get("netlify-cdn-cache-control")).toMatch(/s-maxage=30\b/);
    await markRan("maintenance", 125); // hourly: stale past two periods
    r = await h.get("/api/health");
    j = await r.json();
    expect([r.status, j.ok, j.staleJobs]).toEqual([503, false, ["maintenance"]]);
    expect(j.jobs.maintenance).toEqual({ stale: true, agoMin: 125 });
    expect(typeof j.warnings).toBe("number");
    expect(j.db.error).toBeUndefined();
    expect(/KEY|TOKEN|SECRET_|LM-\d/.test(JSON.stringify(j))).toBe(false);
  });

  it("a job that never ran is stale; one skipped as not configured is not", async () => {
    await markRan("retention", 5000, { skipped: "not_configured" });
    const j = (await (await h.get("/api/health")).json()) as any;
    expect(j.jobs.retention.stale).toBe(false);
    expect(j.jobs.maintenance.stale).toBe(true);
  });

  it("warnings are counted, never named, in public", async () => {
    const x = await createHarness({ env: { OMNIFUL_HOOK_SECRET: "", ADMIN_PASSWORD: "" } });
    const j = (await (await x.get("/api/health")).json()) as any;
    expect(j.warnings).toBe(2);
  }, 120_000);

  it("the database down: 503, db.ok false, no error text", async () => {
    const x = await createHarness();
    const real = x.deps.db.execute.bind(x.deps.db);
    (x.deps.db as any).execute = async () => {
      throw new Error("connection refused at db.internal:5432");
    };
    const r = await x.get("/api/health");
    const body = await r.text();
    (x.deps.db as any).execute = real;
    expect(r.status).toBe(503);
    expect(JSON.parse(body).db).toEqual({ ok: false, ms: expect.any(Number) });
    expect(body).not.toContain("refused");
  }, 120_000);
});
