/**
 * (review-fixes, finding 7 and the LOW items) Database errors are logged without the failed
 * query's parameters; the retention job clears the customer from log details too; the public
 * verify and relay doors are rate limited (generously — the storefront's own use never is).
 */
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { errorStack, errorText, mask } from "../../../src/server/core/log";
import { logs, orders, webhookEvents } from "../../../src/server/db/schema";
import { runRetention, scrubLogDetail } from "../../../src/server/jobs/orders";
import { completedEvent } from "../../../src/server/services/thawani/fake";
import { KEY, payHarness, type PayHarness } from "../payments/_helpers";

let h: PayHarness;
beforeAll(async () => { h = await payHarness(); });
afterEach(async () => {
  await h.db.execute(sql`alter table store.orders drop constraint if exists lm_test_refuse`);
  await h.reset();
});

/** drizzle's wrapper as it is thrown: the query and its values in the message, the server's words on `cause` */
function drizzleError(): Error {
  const cause = Object.assign(new Error('new row for relation "orders" violates check constraint "lm_test_refuse"'), { code: "23514" });
  return Object.assign(new Error('Failed query: update "store"."orders" set "name" = $1\nparams: Ahmed Al Balushi,Dubai,203.0.113.7'), { cause });
}

describe("database errors in the logs", () => {
  it("errorText / errorStack keep the code and the server's message, never the query or its values", () => {
    expect(errorText(drizzleError())).toBe('23514 new row for relation "orders" violates check constraint "lm_test_refuse"');
    expect(errorStack(drizzleError())).not.toMatch(/Ahmed|params|Failed query/);
    expect(errorText(new Error("Failed query: select 1\nparams: secret"))).toBe("database query failed");
    expect(mask("boom Failed query: insert …\nparams: Ahmed,Dubai\n    at x (y.ts:1:1)")).not.toMatch(/Ahmed|Dubai/);
  });

  it("a failed write on the reminder link and on the webhook: the reason on record, no customer field", async () => {
    await h.seed({ id: "LM-7200001", name: "Ahmed Al Balushi", city: "Dubai", region: "Al Barsha" });
    await h.db.execute(sql`alter table store.orders add constraint lm_test_refuse check (status <> 'new') not valid`);
    const r = await h.request("/resume/LM-7200001?k=" + KEY + "&cod=1", { method: "POST" });
    expect(r.status).toBe(502);
    const opened = await h.openCard();
    expect(opened.status).toBe(200);
    h.th().payByReference(opened.j.id);
    const sess = h.th().state.sessions.find((s: any) => s.client_reference_id === opened.j.id)!;
    expect((await h.deliver(completedEvent(sess))).status).toBe(500);
    const written = JSON.stringify(await h.db.select().from(logs)) + JSON.stringify((await h.db.select().from(webhookEvents)).map((w) => w.applied));
    expect(written).toMatch(/lm_test_refuse/);
    expect(written).not.toMatch(/Ahmed|Sara Ali|Al Barsha|Seeb|params|Failed query/);
  });

  it("the retention job clears the customer from the log details of the orders it clears", async () => {
    await h.seed({ id: "LM-7200002", status: "void", paymentStatus: "cancelled", createdAt: new Date(h.clock.t - 400 * 86400e3) });
    await h.db.insert(logs).values({ at: new Date(h.clock.t), level: "error", side: "server", source: "x", message: "m", orderId: "LM-7200002", detail: { phone: "+968 9…", customer: { name: "Ahmed" }, ip: "203.0.113.9", step: "push" } });
    expect((await runRetention(h.deps)).cleared).toBe(1);
    const l = (await h.db.select().from(logs))[0]!;
    expect(l.detail).toEqual({ step: "push" });
    expect(scrubLogDetail({ a: [{ email: "x@y.z", ok: 1 }] })).toEqual({ a: [{ ok: 1 }] });
    expect((await h.row("LM-7200002")).name).toBe(null);
  });
});

describe("rate limits on the public doors", () => {
  it("/api/pay/verify: the checkout's four tries per return are nothing; 120 in ten minutes from one address, then 429", async () => {
    const r = await h.openCard();
    const one = { "x-nf-client-connection-ip": "198.51.100.20" };
    for (let i = 0; i < 120; i++) expect((await h.verify({ ref: r.j.id }, one)).status).toBe(200);
    const over = await h.verify({ ref: r.j.id }, one);
    expect([over.status, over.j]).toEqual([429, { ok: false, error: "rate_limited" }]);
    expect((await h.verify({ ref: r.j.id }, { "x-nf-client-connection-ip": "198.51.100.21" })).status).toBe(200);
    h.clock.advance(10 * 60e3 + 1000);
    expect((await h.verify({ ref: r.j.id }, one)).status).toBe(200);
  });

  it("/api/meta and /api/snap posted directly: 120 a minute per address, then 429; the beacon's items are the beacon's", async () => {
    const one = { "x-nf-client-connection-ip": "198.51.100.30", "content-type": "application/json" };
    const relay = (path: string, n: number) => h.request(path, { method: "POST", headers: one, body: JSON.stringify(path === "/api/meta" ? { name: "PageView", id: "pv-" + n } : { name: "PAGE_VIEW", id: "pv-" + n }) });
    for (const path of ["/api/meta", "/api/snap"]) {
      for (let i = 0; i < 120; i++) expect((await relay(path, i)).status).toBe(204);
      expect((await relay(path, 999)).status).toBe(429);
    }
    // a page's beacon is counted as one post however many relays it carries
    const b = await h.request("/api/beacon", { method: "POST", headers: one, body: JSON.stringify({ items: [{ kind: "meta", body: { name: "PageView", id: "b-1" } }] }) });
    expect(b.status).toBe(204);
    h.clock.advance(61_000);
    expect((await relay("/api/meta", 1000)).status).toBe(204);
  });
});
