import { describe, expect, it } from "vitest";
import { createOmnifulClient, INVENTORY_PATH, ORDER_PATH, SKUS_PATH, type OmnifulClient } from "../../../src/server/services/omniful";
import { omf as boundClient } from "../../../src/server/domain/empower/store";
import { loadEnv } from "../../../src/server/env";
import { createFakeWorld, FAKE_ENV } from "../../../src/server/services";
import { omnifulFake } from "../../../src/server/services/omniful/fake";
import { empowerHarness } from "./_helpers";

const T0 = Date.parse("2026-10-20T08:00:00Z");
const jwt = (expSec: number) => "h." + Buffer.from(JSON.stringify({ exp: expSec })).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") + ".s";

function client(env: Record<string, string> = {}) {
  const world = createFakeWorld();
  let t = T0;
  world.setNow(() => t);
  const e = loadEnv({ SERVICES_MODE: "fake", OMNIFUL_HUB_CODE: "HUB1", ...env });
  const c: OmnifulClient = createOmnifulClient({ env: e, fetch: world.fetch, now: () => t });
  const store: { data: any } = { data: null };
  c.auth = { get: async () => store.data, set: async (d) => void (store.data = d) };
  return { c, world, fake: omnifulFake(world), store, advance: (ms: number) => (t += ms) };
}

const body = (id: string) => ({
  order_id: id,
  hub_code: "HUB1",
  order_items: [{ sku_code: "LM3001", selling_price: 250, quantity: 1 }],
  billing_address: { address1: "a", city: "Dubai", country: "United Arab Emirates" },
  shipping_address: { address1: "a", city: "Dubai", country: "United Arab Emirates" },
  invoice: { currency: "AED", total: 250 },
  customer: { id: "LM-1", first_name: "A" },
  payment_method: "postpaid",
  is_cash_on_delivery: true,
  type: "b2c",
});

describe("the Omniful client", () => {
  // from test-omniful.js: the token stays on the server
  it("tells the panel booleans, a word and a host — never the token", () => {
    const { c } = client();
    const st = c.state();
    expect(Object.keys(st).sort().join(",")).toBe("base,configured,env,hub,missing,renews");
    expect(st.missing.join(",")).toBe("OMNIFUL_API_TOKEN");
    expect(st.hub).toBe("set");
    const none = createOmnifulClient({ env: loadEnv({ SERVICES_MODE: "fake" }), fetch: createFakeWorld().fetch, now: () => T0 }).state();
    expect(none.missing.join(",")).toBe("OMNIFUL_API_TOKEN,OMNIFUL_HUB_CODE");
    expect(none.hub).toBe("");
    const set = client({ OMNIFUL_API_TOKEN: "secret-token-value" }).c.state();
    expect(JSON.stringify(set).indexOf("secret-token-value")).toBe(-1);
    expect(JSON.stringify(set).indexOf("Bearer")).toBe(-1);
  });

  it("refuses to call while not configured", async () => {
    const { c } = client();
    await expect(c.call(ORDER_PATH)).rejects.toMatchObject({ code: "omniful_not_configured" });
  });

  it("sends a bearer token over JSON to the published path, and their id comes back", async () => {
    const { c, world } = client({ OMNIFUL_API_TOKEN: "tok-1" });
    const r = await c.createOrder(body("LM-2000001"));
    const call = world.calls.find((x) => x.path === ORDER_PATH)!;
    expect(call.host).toBe("prodapi.omniful.com");
    expect(call.headers["authorization"]).toBe("Bearer tok-1");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers["idempotency-key"]).toBe("lm-LM-2000001");
    expect(r.ref).toBe("OMF-1");
  });

  it("4xx is not retryable, 429 and 5xx are; a slow answer is unreachable", async () => {
    const { c, world } = client({ OMNIFUL_API_TOKEN: "t" });
    world.fail(() => ({ status: 422, body: { message: "nope" } }));
    await expect(c.call(ORDER_PATH, { method: "POST", body: {} })).rejects.toMatchObject({ code: "omniful_rejected", status: 422, retryable: false, message: "nope" });
    world.fail(() => ({ status: 429, body: {} }));
    await expect(c.call(ORDER_PATH)).rejects.toMatchObject({ code: "omniful_throttled", retryable: true });
    world.fail(() => ({ status: 503, body: {} }));
    await expect(c.call(ORDER_PATH)).rejects.toMatchObject({ code: "omniful_rejected", retryable: true });
    world.fail(() => "timeout");
    await expect(c.call(ORDER_PATH, { timeoutMs: 50 })).rejects.toMatchObject({ code: "omniful_unreachable", unsent: false });
    world.fail(() => "refused");
    await expect(c.call(ORDER_PATH)).rejects.toMatchObject({ code: "omniful_unreachable", unsent: true });
  });

  it("never starts a call with no time left", async () => {
    const { c, world } = client({ OMNIFUL_API_TOKEN: "t" });
    await expect(c.call(ORDER_PATH, { deadline: T0 + 300 })).rejects.toMatchObject({ code: "omniful_unreachable", unsent: true });
    expect(world.calls.length).toBe(0);
  });

  // from test-omniful.js: the token renews itself
  it("renews a token within a day of expiring, keeps the rotated pair, and uses it next time", async () => {
    const env = { OMNIFUL_API_TOKEN: jwt(Math.floor(T0 / 1000) + 3600), OMNIFUL_REFRESH_TOKEN: "rt-1", OMNIFUL_CLIENT_ID: "cid", OMNIFUL_CLIENT_SECRET: "csecret" };
    const { c, world, store } = client(env);
    const r = await c.createOrder(body("LM-2000001"));
    expect(world.calls[0]!.path).toBe("/sales-channel/public/v1/token");
    expect(world.calls[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-1", client_id: "cid", client_secret: "csecret" });
    expect(world.calls[1]!.headers["authorization"]).not.toBe("Bearer " + env.OMNIFUL_API_TOKEN);
    expect(store.data.refresh_token).toBe("omf-rt-1");
    expect(r.ref).toBe("OMF-1");

    world.calls.length = 0;
    c._reset();
    await c.createOrder(body("LM-2000002"));
    expect(world.calls.map((x) => x.path)).toEqual([ORDER_PATH]);
    expect(store.data.refresh_token).toBe("omf-rt-1");
  });

  it("a token Omniful refuses is renewed once and the call retried", async () => {
    const { c, world, fake } = client({ OMNIFUL_API_TOKEN: jwt(Math.floor(T0 / 1000) + 30 * 86400), OMNIFUL_REFRESH_TOKEN: "rt-1", OMNIFUL_CLIENT_ID: "cid", OMNIFUL_CLIENT_SECRET: "cs" });
    fake.refuseToken = 1;
    await c.createOrder(body("LM-2000003"));
    expect(world.calls.map((x) => (/token$/.test(x.path) ? "T" : "O")).join("")).toBe("OTO");
  });

  it("a new refresh token in the environment wins over the kept one", async () => {
    const env = { OMNIFUL_API_TOKEN: jwt(Math.floor(T0 / 1000) + 3600), OMNIFUL_REFRESH_TOKEN: "rt-1", OMNIFUL_CLIENT_ID: "cid", OMNIFUL_CLIENT_SECRET: "cs" };
    const first = client(env);
    await first.c.createOrder(body("LM-2000004"));
    const second = client({ ...env, OMNIFUL_REFRESH_TOKEN: "rt-new-from-dashboard" });
    second.store.data = first.store.data;
    await second.c.createOrder(body("LM-2000005"));
    expect((second.world.calls[0]!.body as any).refresh_token).toBe("rt-new-from-dashboard");
  });

  it("the pacing lets three through at once, then one a second (measured, not slept, in fake mode)", async () => {
    const { c } = client({ OMNIFUL_API_TOKEN: "t" });
    for (let i = 0; i < 5; i++) await c.call(SKUS_PATH);
    expect(c.waitedMs).toBe(1000 + 2000);
  });

  // from test-v207.js: the shelf, read from Omniful
  it("reads the hub's shelf page by page; and per SKU when the hub code is refused, remembering the refusal", async () => {
    const { c, world, fake, advance } = client({ OMNIFUL_API_TOKEN: "t" });
    const n = (i: number) => "LM" + (1000 + i);
    for (let i = 0; i < 150; i++) fake.inventory[n(i)] = { available: i, onHand: i + 1 };
    const got = await c.hubInventory(5);
    const reads = world.calls.filter((x) => x.path.startsWith(INVENTORY_PATH));
    expect(reads.map((x) => x.path)).toEqual([INVENTORY_PATH + "HUB1?per_page=100&page=1", INVENTORY_PATH + "HUB1?per_page=100&page=2"]);
    expect(got.rows.length).toBe(150);
    expect(got.rows[5]).toEqual({ sku_code: "LM1005", available: 5, onHand: 6, hub: "HUB1" });

    fake.inventory = { LM2001: { available: 16, onHand: 17 }, LM6002: 24, LM9002: 23, LM3001: 4, LM7002: 13, LM8001: 14 };
    fake.refuseHub = true;
    world.calls.length = 0;
    const fb = await c.hubInventory(5, ["LM2001", "LM6002", "LM9002", "LM3001", "LM7002", "LM8001", "LM2001", "LM0000"]);
    expect(world.calls.length).toBe(8);
    expect(world.calls.slice(1).every((x) => /^\/sales-channel\/public\/v1\/inventory\/hubs\/skus\/LM\d{4}$/.test(x.path))).toBe(true);
    expect(fb.rows.map((r) => r.sku_code + ":" + r.available + "/" + r.onHand).join(",")).toBe("LM2001:16/17,LM6002:24/24,LM9002:23/23,LM3001:4/4,LM7002:13/13,LM8001:14/14");
    expect(fb.perSku).toBe(true);
    expect(fb.note).toMatch(/Invalid hub code/);
    expect(fb.note).toMatch(/hub code is HUB-REAL/);
    expect(fb.hubs).toEqual(["HUB-REAL"]);

    world.calls.length = 0;
    const again = await c.hubInventory(5, ["LM2001", "LM6002"]);
    expect(world.calls.length + " " + again.perSku).toBe("2 true");
    world.calls.length = 0;
    advance(7 * 3600e3);
    await expect(c.hubInventory(5)).rejects.toThrow(/Invalid hub code/);
    expect(world.calls.length).toBe(1);

    c._reset();
    world.fail(() => ({ status: 500, body: {} }));
    world.calls.length = 0;
    await expect(c.hubInventory(5, ["LM2001"])).rejects.toMatchObject({ status: 500 });
    expect(world.calls.length).toBe(1);
  });

  it("an answer it does not understand: no rows, and the fields seen", async () => {
    const { c, world } = client({ OMNIFUL_API_TOKEN: "t" });
    world.fail((x) => (x.path.startsWith(INVENTORY_PATH) ? { status: 200, body: { data: [{ id: 1, item: "x", qty_free: 3 }] } } : null));
    const odd = await c.hubInventory(1);
    expect(odd.rows.length + " " + odd.fields.join(",")).toBe("0 id,item,qty_free");
  });

  it("follows a cursor should one come back", async () => {
    const { c, world } = client({ OMNIFUL_API_TOKEN: "t" });
    let n = 0;
    world.fail((x) =>
      x.path.startsWith(INVENTORY_PATH)
        ? n++ === 0
          ? { status: 200, body: { data: [{ sku_code: "LM2001", available_quantity: 1 }], meta: { has_next_page: true, end_cursor: "c1" } } }
          : { status: 200, body: { data: [{ sku_code: "LM3001", available_quantity: 2 }], meta: { has_next_page: false } } }
        : null,
    );
    const r = await c.hubInventory(5);
    expect(world.calls.length).toBe(2);
    expect(world.calls[1]!.path).toMatch(/search_after=c1/);
    expect(r.rows.length).toBe(2);
  });

  // from test-empower.js: Match from Omniful reads their v2 list, paged by search_after
  it("lists their master catalogue, paged by search_after", async () => {
    const { c, world, fake } = client({ OMNIFUL_API_TOKEN: "t" });
    for (let i = 0; i < 130; i++) fake.skus.push({ sku_code: "S" + i, name: "n" + i });
    const list = await c.listSkus(5);
    expect(list.length).toBe(130);
    expect(world.calls.map((x) => x.path)).toEqual([SKUS_PATH + "?per_page=100", SKUS_PATH + "?per_page=100&search_after=100"]);
  });

  it("cancels by the id it was sent as, with a reason; Omniful's refusal comes back in its words", async () => {
    const { c, world } = client({ OMNIFUL_API_TOKEN: "t" });
    await c.createOrder(body("LM-7100002"));
    await c.cancelOrder("LM-7100002", "Sent to the warehouse by mistake");
    const put = world.calls.find((x) => x.method === "PUT")!;
    expect(put.path).toBe(ORDER_PATH + "/LM-7100002/cancel");
    expect(put.body).toEqual({ cancel_reason: "Sent to the warehouse by mistake" });
    await expect(c.cancelOrder("LM-7100002", "again")).rejects.toMatchObject({ status: 422, message: "Order already cancelled" });
  });

  it("the domain binds the token store to ops (omniful_auth)", async () => {
    const h = await empowerHarness({ env: { OMNIFUL_API_TOKEN: jwt(Math.floor(T0 / 1000) + 60), OMNIFUL_REFRESH_TOKEN: "rt-1", OMNIFUL_CLIENT_ID: "c", OMNIFUL_CLIENT_SECRET: "s" } });
    await boundClient(h.deps).listSkus(1);
    const pair = await h.op("omniful_auth");
    expect(pair.refresh_token).toBe("omf-rt-1");
    expect(pair.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(FAKE_ENV.OMNIFUL_API_TOKEN).toBeTruthy();
  });
});
