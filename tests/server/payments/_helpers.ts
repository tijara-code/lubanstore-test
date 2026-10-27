/**
 * Shared fixtures for the payments suites: a harness with the Thawani emulator at hand, a
 * basket as checkout.js posts it, a card order seeded straight into the table, and a signed
 * webhook delivery.
 */
import { eq } from "drizzle-orm";
import { createHarness, type HarnessOptions } from "../../helpers/harness";
import { orders, webhookEvents, type NewOrderRow, type OrderRow } from "../../../src/server/db/schema";
import { FAKE_ENV } from "../../../src/server/services";
import { signDelivery, thawaniFake } from "../../../src/server/services/thawani/fake";

export const SECRET = FAKE_ENV.THAWANI_WEBHOOK_SECRET;
export const KEY = "a".repeat(32);

export async function payHarness(opts: HarnessOptions = {}) {
  const h = await createHarness(opts);
  const th = () => thawaniFake(h.world);
  let ipN = 1;
  let dN = 1;

  /** the order checkout.js posts (OMR market: oud-large 25, delivery 3 under 30) */
  const basket = (extra: Record<string, unknown> = {}) => ({
    name: "Sara Ali", phone: "+968 91234567", countryCode: "OM", city: "Muscat", region: "Seeb",
    items: [{ itemId: "oud-large", qty: 1 }], dedupeId: "d-" + dN++, ...extra,
  });

  async function openCard(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const res = await h.post("/api/pay/session", { order: basket(extra) }, { "x-nf-client-connection-ip": "10.0.0." + ipN++, ...headers });
    return { status: res.status, j: (await res.json()) as Record<string, any>, res };
  }

  async function verify(q: Record<string, string>, headers: Record<string, string> = {}) {
    const res = await h.get("/api/pay/verify?" + new URLSearchParams(q).toString(), headers);
    return { status: res.status, j: (await res.json()) as Record<string, any> };
  }

  async function deliver(evt: unknown, opts: { secret?: string; ts?: string; sig?: string; path?: string } = {}) {
    const d = signDelivery(evt, opts.secret ?? SECRET, opts.ts ?? "1733807121");
    if (opts.sig !== undefined) d.headers["thawani-signature"] = opts.sig;
    const res = await h.request(opts.path || "/api/pay/webhook", { method: "POST", body: d.body, headers: d.headers });
    return { status: res.status, j: (await res.json().catch(() => ({}))) as Record<string, any>, body: d.body };
  }

  async function seed(over: Partial<NewOrderRow> & { id: string }): Promise<OrderRow> {
    const row: NewOrderRow = {
      createdAt: new Date(h.clock.t), updatedAt: new Date(h.clock.t),
      name: "Ahmed Al Balushi", phone: "+971 50 123 4567", countryCode: "AE", country: "الإمارات", city: "Dubai", region: "Al Barsha",
      items: [{ itemId: "oud-large", scent: "عود", size: "كبير 300 جم", qty: 1, price: 250, was: 320 }],
      cur: "AED", sub: 250, ship: 0, codFee: 0, total: 250, omrRate: 0.1047, omr: 26.175,
      pay: "card", status: "pending", paymentStatus: "unpaid", invoiceKey: KEY, amountBaisa: 26175,
      ...over,
    };
    const out = await h.db.insert(orders).values(row).returning();
    return out[0]!;
  }

  async function row(id: string): Promise<OrderRow> {
    return (await h.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  }

  async function hooks() {
    return h.db.select().from(webhookEvents).orderBy(webhookEvents.id);
  }

  /** Purchases sent to Meta (the server-side copies) */
  const purchases = () =>
    h.world.calls.filter((c) => c.host === "graph.facebook.com" && c.method === "POST" && /"Purchase"/.test(c.rawBody)).length;
  const thawaniCalls = () => h.world.calls.filter((c) => /thawani\.om$/.test(c.host));

  /** empty every table and the emulator's ledger */
  async function reset(...args: Parameters<typeof h.reset>) {
    await h.reset(...args);
    const st = th().state;
    st.sessions.length = 0;
    st.payments.length = 0;
    st.refunds.length = 0;
  }

  return { ...h, reset, th, basket, openCard, verify, deliver, seed, row, hooks, purchases, thawaniCalls };
}

export type PayHarness = Awaited<ReturnType<typeof payHarness>>;
