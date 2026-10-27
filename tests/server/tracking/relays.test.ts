import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "../../../src/server/env";
import { FAKE_ENV } from "../../../src/server/services";
import { createPixelsClient } from "../../../src/server/services/pixels";
import { pixelsFake } from "../../../src/server/services/pixels/fake";
import { createHarness, type Harness } from "../../helpers/harness";

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const VID = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
const SHOPPER = { "x-nf-client-connection-ip": "5.6.7.8", "user-agent": "Shopper/1.0" };

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.reset(); });
beforeEach(async () => { await h.reset(); pixelsFake(h.world).clear(); });
const px = () => pixelsFake(h.world);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => h.post(path, body, { ...SHOPPER, ...headers });

// from test-snap-capi.js: 1. endpoint and envelope (through the relay)
describe("/api/snap", () => {
  it("sends to the v3 endpoint with a Bearer token, never in the URL or the body", async () => {
    expect((await post("/api/snap", { name: "PAGE_VIEW", id: "pv-1", url: "https://lubanmusk.com/" })).status).toBe(204);
    const call = h.world.calls.find((c) => c.host === "tr.snapchat.com")!;
    expect(call.path.split("?")[0]).toBe("/v3/00000000-0000-4000-8000-000000000001/events");
    expect(call.headers.authorization).toBe("Bearer fake-snap-token");
    expect(/access_token|fake-snap-token/.test(call.path)).toBe(false);
    expect(/fake-snap-token/.test(call.rawBody)).toBe(false);
    expect(Array.isArray((call.body as any).data)).toBe(true);
    const e = px().snap[0]!.event;
    expect([e.action_source, String(e.event_time).length, e.event_id]).toEqual(["WEB", 10, "pv-1"]);
    expect(e.user_data.client_ip_address).toBe("5.6.7.8");
    expect(e.user_data.client_user_agent).toBe("Shopper/1.0");
  });
  // from test-snap-capi.js: 5. the relay refuses what it must
  it("refuses a purchase, an unknown event, a missing id and a GET", async () => {
    expect((await post("/api/snap", { name: "PURCHASE", id: "x", price: 99999 })).status).toBe(400);
    expect((await post("/api/snap", { name: "GIVE_ME_MONEY", id: "x" })).status).toBe(400);
    expect((await post("/api/snap", { name: "ADD_CART" })).status).toBe(400);
    expect((await post("/api/snap", { name: "ADD_CART", id: "ok-1" })).status).toBe(204);
    expect((await h.get("/api/snap")).status).toBe(405);
    expect((await h.request("/api/snap", { method: "POST", body: "{", headers: SHOPPER })).status).toBe(400);
    expect(px().snap.map((e) => e.event.event_name)).toEqual(["ADD_CART"]);
  });
  // from test-pixel-parity.js: 4. the Snap relay carries quantity and price
  it("carries the lines as numbers, the value, num_items as a string", async () => {
    await post("/api/snap", { name: "ADD_CART", id: "a-1", currency: "OMR", category: "incense", price: 7.851, numItems: 3, items: [{ id: "oud-small", qty: 3, price: 2.617 }] });
    const c = px().snap[0]!.event.custom_data;
    expect(c.content_ids).toEqual(["oud-small"]);
    expect(c.contents).toEqual([{ id: "oud-small", quantity: 3, item_price: 2.617 }]);
    expect(c.value).toBe(7.851);
    expect(c.num_items).toBe("3");
    expect(c.content_category).toBe("incense");
  });
  it("a saved phone hash is ph and external_id, passed through; anything else is dropped", async () => {
    const PH = sha("971501234567");
    await post("/api/snap", { name: "PAGE_VIEW", id: "pv-1", ph: PH });
    await post("/api/snap", { name: "PAGE_VIEW", id: "pv-3", ph: "12345678" });
    expect(px().snap[0]!.event.user_data.external_id).toEqual([PH]);
    expect(px().snap[0]!.event.user_data.ph).toEqual([PH]);
    expect("ph" in px().snap[1]!.event.user_data).toBe(false);
  });
  // from test-v315.js: Snap gets the same visitor id and market
  it("carries the visitor id and the market, hashed", async () => {
    await post("/api/snap", { name: "PAGE_VIEW", id: "spv-1", vid: VID, cc: "AE", scid: "cookie-1", sccid: "click-1" });
    const u = px().snap[0]!.event.user_data;
    expect([u.external_id, u.country, u.sc_cookie1, u.sc_click_id]).toEqual([[VID], [sha("ae")], "cookie-1", "click-1"]);
  });
  // from test-snap-capi.js: 6. no token → silent no-op
  it("stays quiet when unconfigured", async () => {
    const q = await createHarness({ env: { SNAP_CAPI_TOKEN: "" } });
    expect((await q.post("/api/snap", { name: "ADD_CART", id: "q" })).status).toBe(204);
    expect((await q.post("/api/snap", { name: "PURCHASE", id: "q" })).status).toBe(204);
    expect(q.world.calls.length).toBe(0);
  });
});

describe("/api/meta", () => {
  // from test-meta.js: the relay must refuse Purchase
  it("refuses Purchase and allows the five funnel events, in Meta's casing", async () => {
    expect((await post("/api/meta", { name: "Purchase", id: "x", value: 999 })).status).toBe(400);
    for (const n of ["pageview", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo"]) {
      expect((await post("/api/meta", { name: n, id: "e-" + n })).status).toBe(204);
    }
    expect((await post("/api/meta", { name: "AddToCart" })).status).toBe(400);
    expect(px().meta.map((e) => e.event.event_name)).toEqual(["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo"]);
  });
  it("puts the token in the body, never the URL", async () => {
    await post("/api/meta", { name: "PageView", id: "pv" });
    const call = h.world.calls.find((c) => c.host === "graph.facebook.com")!;
    expect(call.path).toBe("/v21.0/100000000000001/events");
    expect((call.body as any).access_token).toBe("fake-meta-token");
  });
  // from test-v315.js: a first visit, a known shopper
  it("a first visit: the visitor id and the market; never an invented phone", async () => {
    await post("/api/meta", { name: "PageView", id: "pv-1", url: "https://lubanmusk.com/", fbp: "fb.1.1759000000000.123456789", vid: VID, cc: "AE" });
    let u = px().meta.pop()!.event.user_data;
    expect(u.external_id).toEqual([VID]);
    expect(u.country).toEqual([sha("ae")]);
    expect([!!u.fbp, u.client_ip_address, u.client_user_agent].join(" ")).toBe("true 5.6.7.8 Shopper/1.0");
    expect(u.ph).toBeUndefined();
    await post("/api/meta", { name: "ViewContent", id: "vc-1", vid: VID }, { "x-country": "OM" });
    expect(px().meta.pop()!.event.user_data.country).toEqual([sha("om")]);
    await post("/api/meta", { name: "AddToCart", id: "atc-1", vid: "not-a-hash", cc: "Z9" }, { "x-country": "" });
    u = px().meta.pop()!.event.user_data;
    expect([u.external_id, u.country]).toEqual([undefined, undefined]);
    const PH = sha("971501234567");
    await post("/api/meta", { name: "AddToCart", id: "atc-2", vid: VID, ph: PH, cc: "AE" });
    u = px().meta.pop()!.event.user_data;
    expect(u.external_id).toEqual([PH, VID]);
    expect(u.ph).toEqual([PH]);
  });
  // from test-meta.js: the click id is never modified on the relay
  it("sends a long click id whole", async () => {
    const fbc = "fb.1.1554763741205.IwAR" + "aB3xY7zQ".repeat(30);
    await post("/api/meta", { name: "PageView", id: "pv-2", fbc });
    expect(px().meta[0]!.event.user_data.fbc).toBe(fbc);
  });
  // from test-pixel-parity.js: 8. a Meta test code never reaches production
  it("uses a test code on a preview, never on the production deploy", async () => {
    const preview = await createHarness({ env: { META_TEST_EVENT_CODE: "TEST123", CONTEXT: "deploy-preview" } });
    await preview.post("/api/meta", { name: "PageView", id: "t2" });
    expect((preview.world.calls[0]!.body as any).test_event_code).toBe("TEST123");
    expect(preview.deps.services.pixels.meta.testCode()).toBe("TEST123");
    const prod = createPixelsClient({ env: loadEnv({ ...FAKE_ENV, META_TEST_EVENT_CODE: "TEST123", CONTEXT: "production" }), fetch: h.world.fetch, now: () => h.clock.t });
    expect(prod.meta.testCode()).toBe("");
  });
  it("a platform refusing the event never surfaces to the page", async () => {
    h.world.fail((c) => (c.host === "graph.facebook.com" ? { status: 400, body: { error: { message: "Invalid parameter" } } } : null));
    expect((await post("/api/meta", { name: "PageView", id: "pv-x" })).status).toBe(204);
    h.world.fail((c) => (c.host === "graph.facebook.com" ? "timeout" : null));
    const t0 = Date.now();
    expect((await post("/api/meta", { name: "PageView", id: "pv-y" })).status).toBe(204);
    expect(Date.now() - t0).toBeLessThan(3000);
    h.world.fail(null);
  });
});

// from test-scan-keys.js: public pixel ids are the only configuration values that reach a page
describe("what reaches a browser", () => {
  it("is the public ids alone, never a token or secret", async () => {
    const pub = h.deps.services.pixels.publicIds();
    expect(pub).toEqual({ metaPixel: "100000000000001", snapPixel: "00000000-0000-4000-8000-000000000001", ga4: "G-FAKE00001", mp: true });
    const text = JSON.stringify(pub) + JSON.stringify(h.deps.services.pixels.ga4.publicConfig());
    for (const k of ["META_CAPI_TOKEN", "SNAP_CAPI_TOKEN", "GA4_API_SECRET", "META_TEST_EVENT_CODE"] as const) {
      const v = (h.env as unknown as Record<string, unknown>)[k];
      if (v) expect(text).not.toContain(String(v));
    }
  });
  // from test-v302.js: GA4 for the page
  it("GA4: off without an id, upper-cased, never a Universal Analytics id, mp only with the secret", async () => {
    const cfg = async (env: Record<string, string>) =>
      createPixelsClient({ env: loadEnv({ ...FAKE_ENV, ...env }), fetch: h.world.fetch, now: () => h.clock.t }).ga4.publicConfig();
    expect(await cfg({ GA4_MEASUREMENT_ID: "", GA4_API_SECRET: "" })).toEqual({ ga4: "", mp: false });
    expect(await cfg({ GA4_MEASUREMENT_ID: "g-abc123xyz9", GA4_API_SECRET: "" })).toEqual({ ga4: "G-ABC123XYZ9", mp: false });
    expect((await cfg({ GA4_MEASUREMENT_ID: "UA-12345-1" })).ga4).toBe("");
    expect(await cfg({ GA4_MEASUREMENT_ID: "G-ABC123XYZ9", GA4_API_SECRET: "s3cret" })).toEqual({ ga4: "G-ABC123XYZ9", mp: true });
  });
});
