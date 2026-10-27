/**
 * /resume/:id — the reminder link. Opening it changes nothing (a messenger's preview fetch
 * must not act); the page's POST acts: a fresh card session for the amount recorded at
 * placement, or the switch to cash re-priced with the fee. A settled order is never charged
 * again; a wrong key reads exactly like an unknown order.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Deps } from "../../../src/server/core/deps";
import type { FetchLike } from "../../../src/server/core/outbound";
import { orderEvents, orders } from "../../../src/server/db/schema";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import { resume, type ResumeRequest } from "../../../src/server/domain/payments/resume";
import { createServices } from "../../../src/server/services";
import type { Catalogue } from "../../../src/shared/catalogue/types";
import { KEY, payHarness, type PayHarness } from "./_helpers";

let h: PayHarness;
/** AE with no delivery charge: the card total 250 AED, cash 260 (fee 10), as the original's fixture */
function catalogue(mut?: (ae: Record<string, any>) => void): Catalogue {
  const cat = bundledCatalogue() as Catalogue & { countries: Array<Record<string, any>> };
  const ae = cat.countries.find((c) => c.code === "AE")!;
  ae.ship = 0;
  if (mut) mut(ae);
  return cat;
}
beforeAll(async () => { h = await payHarness({ catalogue: catalogue() }); });
afterEach(async () => { await h.reset(catalogue()); });

const ID = "LM-123456";
const seedOpen = (over: Parameters<PayHarness["seed"]>[0] extends infer T ? Partial<T> : never = {}) =>
  h.seed({ id: ID, name: "نورة الكندي", ...over } as Parameters<PayHarness["seed"]>[0]);

async function open(query: string, method = "POST", headers: Record<string, string> = {}) {
  const res = await h.request("/resume/" + ID + query, { method, headers });
  return { res, status: res.status, html: method === "PUT" ? "" : await res.text() };
}
const sessions = () => h.th().state.sessions;
const events = async () => h.db.select().from(orderEvents).where(eq(orderEvents.orderId, ID));

describe("the door", () => {
  // from test-resume.js
  it("a wrong key, an unknown order, a binned order, no key: the same 404, no session", async () => {
    await seedOpen();
    expect((await open("?k=" + "b".repeat(32))).status).toBe(404);
    expect((await h.request("/resume/LM-654321?k=" + KEY, { method: "POST" })).status).toBe(404);
    expect((await open("")).status).toBe(404);
    expect((await open("?k=" + KEY, "GET")).status).toBe(200);
    await h.db.update(orders).set({ trashed: true }).where(eq(orders.id, ID));
    expect((await open("?k=" + KEY)).status).toBe(404);
    expect(sessions().length).toBe(0);
    const a = await open("?k=" + "b".repeat(32));
    const b = await h.request("/resume/LM-654321?k=" + KEY, { method: "POST" });
    expect(a.html).toBe(await b.text());
  });

  it("only GET and POST: PUT is 405, no session, no write", async () => {
    await seedOpen();
    const r = await open("?k=" + KEY, "PUT");
    expect(r.status).toBe(405);
    expect([sessions().length, (await events()).length]).toEqual([0, 0]);
  });

  // from test-bugcheck.js
  it("a malformed link is a 404, not a crash", async () => {
    expect((await h.request("/resume/%E0?k=" + KEY)).status).toBe(404);
    expect((await h.request("/resume/LM-12?k=" + KEY)).status).toBe(404);
  });

  it("the page refuses to be framed, is never stored and never indexed", async () => {
    await seedOpen();
    const r = await open("?k=" + KEY, "GET");
    expect(r.res.headers.get("x-frame-options")).toBe("DENY");
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(r.res.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(r.html).toMatch(/<meta name="robots" content="noindex,nofollow">/);
  });
});

describe("opening the link changes nothing (v300)", () => {
  it("the card link shows the amount and goes on by its own script — no session, no write", async () => {
    await seedOpen();
    const r = await open("?k=" + KEY, "GET");
    expect(r.status).toBe(200);
    expect([sessions().length, (await events()).length]).toEqual([0, 0]);
    expect(r.html).toMatch(/\b250 AED/);
    expect(r.html).toMatch(/<form id="go" method="post">/);
    expect(r.html).toMatch(/getElementById\("go"\)\.submit\(\)/);
    expect(r.html).toMatch(/<button class="btn" type="submit">/);
  });

  it("the cash link shows what the courier will collect, fee included, and waits for the tap", async () => {
    await seedOpen();
    const r = await open("?k=" + KEY + "&cod=1", "GET");
    expect([sessions().length, (await events()).length]).toEqual([0, 0]);
    expect(r.html).toMatch(/\b260 AED/);
    expect(r.html).toMatch(/<form id="go" method="post">/);
    expect(r.html).not.toMatch(/\.submit\(\)/);
    expect((await h.row(ID)).pay).toBe("card");
  });

  it("a paid order opened says so, and nothing else", async () => {
    await seedOpen({ paymentStatus: "paid", status: "prep" });
    const r = await open("?k=" + KEY, "GET");
    expect(r.html).toMatch(/مدفوع/);
    expect(r.html).not.toMatch(/<form/);
  });
});

describe("an order that is already settled", () => {
  it("paid: 200, no session, no write, says so — by card or by cash", async () => {
    await seedOpen({ paymentStatus: "paid", status: "prep" });
    let r = await open("?k=" + KEY);
    expect([r.status, sessions().length, (await events()).length]).toEqual([200, 0, 0]);
    expect(r.html).toMatch(/مدفوع/);
    r = await open("?k=" + KEY + "&cod=1");
    expect((await h.row(ID)).paymentStatus).toBe("paid");
    expect((await events()).length).toBe(0);
  });

  it("a live cash order opens no session and is told it is confirmed", async () => {
    await seedOpen({ pay: "cod", paymentStatus: "cod", status: "new" });
    const r = await open("?k=" + KEY);
    expect(sessions().length).toBe(0);
    expect(r.html).toMatch(/مؤكد/);
  });

  // from test-bugcheck.js
  it("a refunded order is not put back into the cash queue", async () => {
    await seedOpen({ paymentStatus: "refunded", refunded: true, status: "void" });
    const r = await open("?k=" + KEY + "&cod=1");
    const o = await h.row(ID);
    expect(o.paymentStatus + "/" + o.status).toBe("refunded/void");
    expect(r.html).toMatch(/لا حاجة لأي إجراء/);
  });
});

describe("paying by card", () => {
  it("a fresh session for the recorded amount, the order put back to pending first, then on to the gateway", async () => {
    await seedOpen({ sessionId: "sess_old", invoiceNo: "inv_old" });
    const r = await open("?k=" + KEY + "&total=1&amount=1&amount_baisa=1");
    expect(r.status).toBe(302);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    expect(sessions().length).toBe(1);
    const s = sessions()[0]!;
    expect(r.res.headers.get("location")).toBe("https://lubanmusk.test/__fake/thawani/pay/" + s.session_id + "?key=fake-thawani-publishable");
    expect(s.metadata).toEqual({ order_id: ID, customer: "نورة الكندي", resumed: "1" });
    expect(s.client_reference_id).toBe(ID);
    // the charge comes from the stored amount, never the URL
    expect(s.products).toEqual([{ name: "عود كبير 300 جم", quantity: 1, unit_amount: 26175 }]);
    const o = await h.row(ID);
    expect([o.status, o.paymentStatus, o.sessionId, o.invoiceNo]).toEqual(["pending", "unpaid", s.session_id, s.invoice]);
    expect(o.expireAt!.toISOString()).toBe(s.expire_at);
    expect(o.adminNote).toMatch(/reminder link/);
    // the tapping browser is the one the Purchase is matched to (the order had none)
    expect((o.client as { ip?: string }).ip).toBe("203.0.113.7");
  });

  it("the page's own fetch asks for JSON and gets the address", async () => {
    await seedOpen();
    const r = await open("?k=" + KEY, "POST", { accept: "application/json" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.html)).toEqual({ ok: true, url: expect.stringMatching(/\/__fake\/thawani\/pay\/checkout_/) });
  });

  // from test-v336-checkout.js: the gateway down — even a JSON request gets the page, with 502
  it("the gateway down: the page says so with a 502, the order untouched", async () => {
    await seedOpen({ status: "void", paymentStatus: "cancelled" });
    h.world.fail((c) => (/thawani/.test(c.host) ? "refused" : null));
    const r = await open("?k=" + KEY, "POST", { accept: "application/json" });
    expect(r.status).toBe(502);
    expect(r.res.headers.get("content-type")).toMatch(/text\/html/);
    expect(r.html).toMatch(/تعذر فتح صفحة الدفع/);
    expect((await h.row(ID)).status).toBe("void");
  });

  it("back to the English checkout when the link says lang=en", async () => {
    await seedOpen();
    await open("?k=" + KEY + "&lang=en");
    expect(sessions()[0]!.success_url).toBe("https://lubanmusk.test/en/checkout.html?paid=" + ID);
    expect(sessions()[0]!.cancel_url).toBe("https://lubanmusk.test/en/checkout.html?cancelled=" + ID);
  });

  it("an auto-cancelled order can still pay, and is un-cancelled on the way out", async () => {
    await seedOpen({ status: "void", paymentStatus: "cancelled" });
    const r = await open("?k=" + KEY);
    expect(r.status).toBe(302);
    expect((await h.row(ID)).status).toBe("pending");
  });

  it("no gateway configured is a 404, not a crash", async () => {
    const g = await payHarness({ catalogue: catalogue(), env: { THAWANI_SECRET_KEY: "" } });
    await g.seed({ id: ID });
    expect((await g.request("/resume/" + ID + "?k=" + KEY, { method: "POST" })).status).toBe(404);
  });

  // from test-audit-fixes.js
  it("paid while the session was being opened: a page, no redirect, the paid row untouched", async () => {
    await seedOpen();
    const wrapped: FetchLike = async (input, init) => {
      if (/\/checkout\/session$/.test(String(input))) await h.db.update(orders).set({ paymentStatus: "paid", status: "new" }).where(eq(orders.id, ID));
      return h.world.fetch(input, init);
    };
    const deps = { ...h.deps, fetch: wrapped, services: createServices({ env: h.deps.env, fetch: wrapped, now: h.deps.now }) };
    const r = await resume(deps, req({ posted: true }));
    expect(r.kind).toBe("html");
    expect(r.kind === "html" && r.html).toMatch(/لا حاجة لأي إجراء/);
    const o = await h.row(ID);
    expect([o.status, o.paymentStatus, o.sessionId]).toEqual(["new", "paid", null]);
  });

  // from test-audit-fixes.js: a card order turned cash, then cancelled, reopened by card
  it("a cash-switched order cancelled and reopened by card: back to card at the card figure (no fee), and payable", async () => {
    await seedOpen({ pay: "cod", paymentStatus: "cod", status: "void", total: 260, codFee: 10, omr: 27.222 });
    const r = await open("?k=" + KEY);
    expect(r.status).toBe(302);
    const s = sessions()[0]!;
    const o = await h.row(ID);
    const sum = s.products!.reduce((t, p) => t + p.unit_amount * p.quantity, 0);
    expect([o.pay, o.total, o.amountBaisa, o.omr, o.codFee]).toEqual(["card", 250, sum, sum / 1000, 0]);
    h.th().paySession(s.session_id);
    const v = await h.verify({ ref: ID });
    expect([v.j.paid, v.j.settled]).toEqual([true, undefined]);
  });
});

describe("switching to cash on delivery", () => {
  it("no session; re-priced WITH the fee; back in the queue as new; the fee shown; the sale reported once", async () => {
    await seedOpen();
    const r = await open("?k=" + KEY + "&cod=1");
    expect(r.status).toBe(200);
    expect(sessions().length).toBe(0);
    const o = await h.row(ID);
    expect([o.pay, o.paymentStatus, o.status, o.total, o.codFee]).toEqual(["cod", "cod", "new", 260, 10]);
    expect(o.adminNote).toMatch(/reminder link/i);
    expect(r.html).toMatch(/260/);
    expect(r.html).toMatch(/رسوم الدفع عند الاستلام/);
    expect(h.purchases()).toBe(1);
    const ev = (await events()).pop()!;
    expect([ev.from, ev.to, ev.by]).toEqual(["pending/unpaid", "new/cod", "shopper"]);
  });

  // from test-v209.js: the cash confirmation is a Purchase, told with the tapper's own request
  it("the Purchase: value in OMR with the fee, the tapping browser's IP, the order's stored click ids; never on a GET or a card link", async () => {
    await seedOpen({ client: { fbp: "fb.1.1.2", ip: "5.6.7.8" } });
    await open("?k=" + KEY + "&cod=1", "GET");
    expect(h.purchases()).toBe(0);
    await open("?k=" + KEY + "&cod=1", "POST", { "x-nf-client-connection-ip": "9.9.9.9" });
    expect(h.purchases()).toBe(1);
    const meta = h.world.calls.filter((c) => c.host === "graph.facebook.com").pop()!;
    expect(meta.rawBody).toMatch(/27\.222/);
    expect(meta.rawBody).toMatch(/"client_ip_address":"9\.9\.9\.9"/);
    expect(meta.rawBody).toMatch(/fb\.1\.1\.2/);
    expect(meta.rawBody).toMatch(/"LM-123456"/);
    expect(h.world.calls.filter((c) => c.host === "tr.snapchat.com" && /PURCHASE/.test(c.rawBody)).length).toBe(1);
    await h.reset(catalogue());
    await seedOpen();
    await open("?k=" + KEY);
    expect(h.purchases()).toBe(0);
  });

  it("Meta and Snap down: the order is still confirmed", async () => {
    await seedOpen();
    h.world.fail((c) => (/facebook|snapchat|google/.test(c.host) ? "refused" : null));
    const r = await open("?k=" + KEY + "&cod=1");
    expect(r.status).toBe(200);
    expect(r.html).toMatch(/تم تأكيد طلبك/);
    expect((await h.row(ID)).paymentStatus).toBe("cod");
  });

  it("a cancelled order can be revived as cash; a cash order revived is not reported again", async () => {
    await seedOpen({ status: "void", paymentStatus: "cancelled" });
    await open("?k=" + KEY + "&cod=1");
    expect((await h.row(ID)).status).toBe("new");
    await h.reset(catalogue());
    await seedOpen({ pay: "cod", paymentStatus: "cod", status: "void", total: 260 });
    await open("?k=" + KEY + "&cod=1");
    expect([(await h.row(ID)).status, h.purchases()]).toEqual(["new", 0]);
  });

  it("an item that no longer prices refuses the conversion with a 409 and an explanation", async () => {
    await seedOpen({ items: [{ itemId: "nope-large", scent: "x", size: "y", qty: 1, price: 250 }] });
    const r = await open("?k=" + KEY + "&cod=1");
    expect(r.status).toBe(409);
    expect(r.html).toMatch(/تغير توفر أحد المنتجات/);
    expect((await h.row(ID)).pay).toBe("card");
  });

  // from test-cod-refusal.js: the resume link says why
  it("a market with cash switched off says so (cod_not_offered), nothing written", async () => {
    await h.publish(catalogue((ae) => { ae.codOn = false; }));
    await seedOpen();
    const r = await open("?k=" + KEY + "&cod=1");
    expect(r.status).toBe(409);
    expect(r.html).toMatch(/الدفع عند الاستلام غير متاح/);
    expect((await h.row(ID)).paymentStatus).toBe("unpaid");
  });

  // from test-audit-fixes.js: paid while the cash price was being worked out
  it("paid between the read and the write: stays card/paid, never 'confirmed as cash'", async () => {
    await seedOpen();
    const db = new Proxy(h.db, {
      get: (t, p) => (p === "transaction"
        ? async (fn: never) => { await t.update(orders).set({ paymentStatus: "paid", status: "new" }).where(eq(orders.id, ID)); return t.transaction(fn); }
        : Reflect.get(t, p)),
    });
    const r = await resume({ ...h.deps, db } as unknown as Deps, req({ posted: true, cod: true }));
    expect(r.kind === "html" && r.html).not.toMatch(/مؤكد بالدفع عند الاستلام/);
    const o = await h.row(ID);
    expect([o.pay, o.paymentStatus]).toEqual(["card", "paid"]);
  });
});

it("thirty taps in ten minutes from one address; then 429", async () => {
  await seedOpen({ paymentStatus: "paid", status: "new" });
  for (let i = 0; i < 30; i++) expect((await open("?k=" + KEY)).status).toBe(200);
  expect((await open("?k=" + KEY)).status).toBe(429);
  expect((await open("?k=" + KEY, "GET")).status).toBe(200);
});

function req(over: Partial<ResumeRequest>): ResumeRequest {
  return { rawId: ID, k: KEY, cod: false, lang: "ar", posted: false, wantsJson: false, ip: "203.0.113.7", ua: "", origin: "https://lubanmusk.test", ...over };
}
