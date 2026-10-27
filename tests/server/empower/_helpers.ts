/**
 * Empower test helpers: orders written straight into the database (the till is another
 * area's), a catalogue routed per market, the fake Omniful, and handy reads.
 */
import { eq } from "drizzle-orm";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import { orders, ops, shipments, type NewOrderRow, type OrderRow } from "../../../src/server/db/schema";
import { omnifulFake } from "../../../src/server/services/omniful/fake";
import type { Catalogue } from "../../../src/shared/catalogue/types";
import { createHarness, type Harness, type HarnessOptions } from "../../helpers/harness";

export const ALL_SKUS = {
  "oud-small": "LM2001",
  "lemon-small": "LM6002",
  "amber-small": "LM9002",
  "oud-large": "LM3001",
  "lemon-large": "LM7002",
  "amber-large": "LM8001",
};

/** The bundled catalogue with each market's route set (unset markets default to Empower). */
export function catalogue(routes: Record<string, string> = {}, change?: (c: Catalogue) => void): Catalogue {
  const cfg = bundledCatalogue();
  for (const c of cfg.countries) if (routes[c.code]) c.courier = routes[c.code];
  if (change) change(cfg);
  return cfg;
}

export async function empowerHarness(opts: HarnessOptions & { routes?: Record<string, string>; change?: (c: Catalogue) => void } = {}) {
  const h = await createHarness({ ...opts, catalogue: opts.catalogue ?? catalogue(opts.routes, opts.change) });
  return withHelpers(h);
}

export function withHelpers(h: Harness) {
  const omf = omnifulFake(h.world);
  const ago = (min: number) => new Date(h.clock.t - min * 60e3);
  let n = 0;
  async function order(o: Partial<NewOrderRow> = {}): Promise<OrderRow> {
    n++;
    const row: NewOrderRow = {
      id: "LM-" + String(9000000 + n),
      createdAt: ago(30),
      updatedAt: ago(30),
      status: "new",
      paymentStatus: "cod",
      pay: "cod",
      origin: "direct",
      name: "Fahad Al Qahtani",
      phone: "+966 501234567",
      country: "السعودية",
      countryCode: "SA",
      city: "الرياض",
      region: "حي النرجس، شارع 12",
      items: [{ itemId: "oud-large", scent: "عود", size: "كبير", qty: 1, price: 250 }],
      cur: "SAR",
      sub: 250,
      ship: 0,
      total: 250,
      omrRate: 0.1025,
      omr: 25.625,
      invoiceKey: "k".repeat(32),
      ...o,
    };
    await h.db.insert(orders).values(row);
    return (await h.db.select().from(orders).where(eq(orders.id, row.id!)))[0]!;
  }
  async function get(id: string): Promise<OrderRow> {
    return (await h.db.select().from(orders).where(eq(orders.id, id)))[0]!;
  }
  async function rows(orderId?: string) {
    const all = await h.db.select().from(shipments);
    return orderId ? all.filter((s) => s.orderId === orderId) : all;
  }
  async function op<T = any>(key: string): Promise<T | undefined> {
    return (await h.db.select().from(ops).where(eq(ops.key, key)))[0]?.data as T | undefined;
  }
  async function setOp(key: string, data: unknown) {
    await h.db.insert(ops).values({ key, data, updatedAt: new Date(h.clock.t) }).onConflictDoUpdate({ target: ops.key, set: { data } });
  }
  /** Create Order calls that reached the fake Omniful (by the id they were sent as) */
  const posts = () =>
    h.world.calls.filter((c) => /omniful/.test(c.host) && c.method === "POST" && /\/v1\/orders$/.test(c.path)).map((c) => (c.body as any).order_id as string);
  const omfCalls = () => h.world.calls.filter((c) => /omniful/.test(c.host));
  /* NB: `get` here reads an order; the harness's GET request is `fetchGet` */
  return { ...h, fetchGet: h.get, omf, ago, order, get, rows, op, setOp, posts, omfCalls };
}

export type EH = Awaited<ReturnType<typeof empowerHarness>>;
