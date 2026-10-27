/**
 * POST /api/pay/session — the card till. The order is on record (pending/unpaid) before the
 * shopper leaves; the charge is priced from the catalogue, in whole baisa, its lines summing
 * to it exactly; the answer is the original's shape.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import type { Catalogue } from "../../../src/shared/catalogue/types";
import { payHarness, type PayHarness } from "./_helpers";

let h: PayHarness;
beforeAll(async () => { h = await payHarness(); });
afterEach(async () => { await h.reset(); });

const sessions = () => h.th().state.sessions.length;

describe("the card till", () => {
  it("writes the attempt, opens the session and answers exactly as the original", async () => {
    const r = await h.openCard({ snap: { fbp: "fb.1.1.2", fbc: "fb.1.1790534142169.IwAR", scid: "scid-cookie", sccid: "sc-click", vid: "f".repeat(64) }, pageUrl: "https://lubanmusk.com/checkout.html" }, { "user-agent": "Shopper/1.0" });
    expect(r.status).toBe(200);
    expect(Object.keys(r.j)).toEqual(["ok", "id", "url", "amount_baisa", "amount_omr", "session_id", "invoice", "expire_at"]);
    expect(r.j.amount_baisa).toBe(28000);
    expect(r.j.amount_omr).toBe(28);
    const s = h.th().sessionFor(r.j.id)!;
    expect(r.j.session_id).toBe(s.session_id);
    expect(r.j.invoice).toBe(s.invoice);
    expect(r.j.expire_at).toBe(s.expire_at);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    // what Thawani was sent
    expect(s.products).toEqual([{ name: "عود الافندر كبير 300 جم", quantity: 1, unit_amount: 25000 }, { name: "التوصيل", quantity: 1, unit_amount: 3000 }]);
    expect(s.success_url).toBe("https://lubanmusk.test/checkout.html?paid=" + r.j.id);
    expect(s.cancel_url).toBe("https://lubanmusk.test/checkout.html?cancelled=" + r.j.id);
    expect(s.metadata).toEqual({ order_id: r.j.id, customer: "Sara Ali", phone: "+968 91234567", country: "OM", city: "Muscat" });
    // what the order holds
    const o = await h.row(r.j.id);
    expect([o.pay, o.status, o.paymentStatus, o.amountBaisa, o.omr]).toEqual(["card", "pending", "unpaid", 28000, 28]);
    expect([o.sessionId, o.invoiceNo, o.expireAt!.toISOString()]).toEqual([s.session_id, s.invoice, s.expire_at]);
    expect(o.invoiceKey).toMatch(/^[a-f0-9]{32}$/);
    expect(o.gateway!.mode).toBe("uat");
    expect((o.gateway!.session as { code: number }).code).toBe(2004);
    // from test-pixel-parity.js: the shopper's context, for the Purchase confirmed with no browser
    expect(o.client).toMatchObject({ ip: "10.0.0.1", ua: "Shopper/1.0", url: "https://lubanmusk.com/checkout.html", fbp: "fb.1.1.2", fbc: "fb.1.1790534142169.IwAR", scid: "scid-cookie", sccid: "sc-click", vid: "f".repeat(64) });
  });

  it("back to the English checkout for an English shopper", async () => {
    const r = await h.openCard({ lang: "en" });
    expect(h.th().sessionFor(r.j.id)!.success_url).toBe("https://lubanmusk.test/en/checkout.html?paid=" + r.j.id);
  });

  // from test-price-tampering.js / PAYMENT-WALKTHROUGH: the browser supplies no money
  it("ignores every figure the browser sends", async () => {
    const r = await h.openCard({ total: 1, omr: 1, omrRate: 0.001, ship: 0, items: [{ itemId: "oud-large", qty: 1, price: 0.1 }] });
    expect(r.j.amount_baisa).toBe(28000);
  });

  // from test-admin-data.js: both order writers stamp the origin
  it("stamps attribution like the cash till", async () => {
    const r = await h.openCard({ ref: { sccid: true } });
    expect((await h.row(r.j.id)).origin).toBe("snapchat");
  });

  it("the same submission twice opens no second session: 409 duplicate_submit with the id", async () => {
    const a = await h.openCard({ dedupeId: "d-same" });
    const b = await h.openCard({ dedupeId: "d-same" });
    expect(b.status).toBe(409);
    expect(b.j).toEqual({ ok: false, error: "duplicate_submit", id: a.j.id });
    expect(sessions()).toBe(1);
  });

  it("a gateway refusal: 502 gateway_error with Thawani's code, the order kept as pending", async () => {
    h.world.fail((c) => (/thawani/.test(c.host) && c.method === "POST" ? { status: 400, body: { success: false, code: 4000, description: "Improper data submitted" } } : null));
    const r = await h.openCard({ id: "LM-7777777" });
    expect(r.status).toBe(502);
    expect(r.j).toEqual({ ok: false, error: "gateway_error", code: 4000 });
    const o = await h.row("LM-7777777");
    expect([o.status, o.paymentStatus, o.sessionId]).toEqual(["pending", "unpaid", null]);
  });

  it("an unreachable gateway: 502 gateway_error too", async () => {
    h.world.fail((c) => (/thawani/.test(c.host) ? "refused" : null));
    const r = await h.openCard();
    expect([r.status, r.j.error, r.j.code]).toEqual([502, "gateway_error", "gateway_unreachable"]);
  });

  it("under 100 baisa: 400 amount_too_small, nothing written", async () => {
    const cat = bundledCatalogue() as Catalogue & { countries: Array<Record<string, any>> };
    const om = cat.countries.find((c) => c.code === "OM")!;
    om.ship = 0;
    om.prices!.samples!.now = 0.05;
    await h.publish(cat);
    const r = await h.openCard({ items: [{ itemId: "samples", qty: 1 }] });
    expect(r.status).toBe(400);
    expect(r.j).toEqual({ ok: false, error: "amount_too_small" });
    expect(sessions()).toBe(0);
  });

  // from test-v336-server.js §1: a market with no OMR rate is refused, never charged 1:1
  it("a market with no OMR rate: 400 unpriced_item, no session opened", async () => {
    const cat = bundledCatalogue() as Catalogue & { countries: Array<Record<string, any>> };
    const eg = JSON.parse(JSON.stringify(cat.countries.find((c) => c.code === "AE")));
    Object.assign(eg, { code: "EG", name: "مصر", cur: "EGP", dial: "20", toOmr: undefined, ship: 100, freeOver: 0, cod: 0 });
    delete eg.toOmr;
    cat.countries.push(eg);
    await h.publish(cat);
    const r = await h.openCard({ countryCode: "EG", phone: "+20 1012345678" });
    expect([r.status, r.j.error]).toEqual([400, "unpriced_item"]);
    expect(sessions()).toBe(0);
  });

  // from test-v336-server.js §3: the basket's shape
  it("the basket's shape is refused before anything else: 400 too_many / bad_qty / incomplete, no session", async () => {
    let r = await h.openCard({ items: [{ itemId: "oud-large", qty: 60 }, { itemId: "oud-large", qty: 60 }] });
    expect([r.status, r.j.error]).toEqual([400, "too_many"]);
    r = await h.openCard({ items: [{ itemId: "oud-large", qty: 0 }] });
    expect([r.status, r.j.error]).toEqual([400, "bad_qty"]);
    r = await h.openCard({ phone: "." });
    expect([r.status, r.j.error]).toEqual([400, "incomplete"]);
    r = await h.openCard({ items: [{ itemId: "nope-nope", qty: 1 }] });
    expect([r.status, r.j.error]).toEqual([400, "unknown_item"]);
    expect(sessions()).toBe(0);
  });

  // from test-v336-server.js §4: the tills take their own page's posts
  it("only this site's JSON: cross-site 403 forbidden, text/plain 415, no session", async () => {
    let res = await h.request("/api/pay/session", { method: "POST", body: JSON.stringify({ order: h.basket() }), headers: { "Sec-Fetch-Site": "cross-site", "content-type": "text/plain" } });
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([403, "forbidden"]);
    res = await h.request("/api/pay/session", { method: "POST", body: JSON.stringify({ order: h.basket() }), headers: { "content-type": "text/plain" } });
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([415, "bad_content_type"]);
    expect(sessions()).toBe(0);
    const ok = await h.openCard({}, { "sec-fetch-site": "same-origin", "content-type": "Application/JSON; charset=UTF-8" });
    expect(ok.status).toBe(200);
  });

  it("ten sessions in ten minutes from one address; the eleventh is 429 rate_limited with Retry-After", async () => {
    const ip = { "x-nf-client-connection-ip": "198.51.100.9" };
    for (let i = 0; i < 10; i++) expect((await h.post("/api/pay/session", { order: h.basket() }, ip)).status).toBe(200);
    const res = await h.post("/api/pay/session", { order: h.basket() }, ip);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("rate_limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("no gateway configured: 503 gateway_not_configured, nothing written", async () => {
    const g = await payHarness({ env: { THAWANI_SECRET_KEY: "" } });
    const r = await g.openCard();
    expect([r.status, r.j.error]).toEqual([503, "gateway_not_configured"]);
    expect((await g.verify({ ref: "LM-1234567" })).status).toBe(503);
  });

  // from test-v202.js: every handler reads a body of null as {}
  it("a body of null is an incomplete order, not a crash", async () => {
    const res = await h.request("/api/pay/session", { method: "POST", body: "null", headers: { "content-type": "application/json" } });
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([400, "incomplete"]);
    const bad = await h.request("/api/pay/session", { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
  });

  it("other methods: 405", async () => {
    expect((await h.get("/api/pay/session")).status).toBe(405);
    expect((await h.get("/api/pay/webhook")).status).toBe(405);
  });
});
