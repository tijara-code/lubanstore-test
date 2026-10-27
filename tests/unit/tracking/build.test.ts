import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { metaEvent, snapEvent } from "../../../src/server/domain/pixels/build";

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

// from test-meta.js: 3. the built payload
describe("a Meta event", async () => {
  const ev = await metaEvent({
    name: "Purchase", id: "LM-1001", orderId: "LM-1001", time: 1750000000000,
    url: "https://lubanmusk.com/checkout.html", currency: "OMR", value: 12.5, category: "incense", numItems: 3,
    items: [{ id: "oud-large", qty: 2, price: 5 }, { id: "lemon-small", qty: 1, price: 2.5 }],
    user: { phone: "+968 9123 4567", firstName: "Sample", lastName: "Al Fulani", city: "Abu Dhabi", region: "Abu Dhabi", country: "AE",
      externalId: "LM-1001", fbp: "fb.1.1700.abc", fbc: "fb.1.1700.xyz" },
    request: { client_ip_address: "1.2.3.4", client_user_agent: "UA/1.0" },
  });
  const u = ev.user_data as Record<string, any>;
  const c = ev.custom_data as Record<string, any>;
  it("has the envelope", () => {
    expect(ev.event_time).toBe(1750000000);
    expect(ev.action_source).toBe("website");
    expect(ev.event_id).toBe("LM-1001");
    expect(ev.data_processing_options).toEqual([]);
    expect(ev.opt_out).toBe(false);
  });
  it("hashes every identifier, and sends fbp/fbc/IP/UA raw", () => {
    expect(["em", "ph", "fn", "ln", "ct", "st", "zp", "country", "external_id"].filter((k) => u[k]).every((k) => /^[a-f0-9]{64}$/.test(u[k][0]))).toBe(true);
    expect(u.em).toBeUndefined();
    expect(u.ph[0]).toBe(sha("96891234567"));
    expect(u.fn[0]).not.toBe(u.ln[0]);
    expect([u.fbp, u.fbc, u.client_ip_address, u.client_user_agent]).toEqual(["fb.1.1700.abc", "fb.1.1700.xyz", "1.2.3.4", "UA/1.0"]);
    expect(/9123|Sample|Fulani|Abu Dhabi/.test(JSON.stringify(ev))).toBe(false);
  });
  it("carries the money as numbers, the lines and the order id", () => {
    expect(typeof c.value).toBe("number");
    expect(c.currency).toBe("OMR");
    expect(c.content_ids).toEqual(["oud-large", "lemon-small"]);
    expect(c.contents[0]).toEqual({ id: "oud-large", quantity: 2, item_price: 5 });
    expect(c.order_id).toBe("LM-1001");
    expect(c.content_type).toBe("product");
  });
  it("a bare event carries no empty keys", async () => {
    const bare = await metaEvent({ name: "PageView", id: "x", time: 0, request: {} });
    expect(Object.values((bare.custom_data as object) || {}).some((v) => v === "" || v === null)).toBe(false);
    expect(bare.user_data).toEqual({});
  });
});

// from test-snap-capi.js: envelope, hashing, purchase shape
describe("a Snap event", () => {
  it("has the v3 envelope, seconds not ms", async () => {
    const e = await snapEvent({ name: "PAGE_VIEW", id: "pv-1", time: 1750000000123, url: "https://lubanmusk.com/" });
    expect(e.action_source).toBe("WEB");
    expect(String(e.event_time).length).toBe(10);
    expect(e.event_id).toBe("pv-1");
  });
  it("hashes the phone without punctuation; a browser hash passes through; IP and UA forwarded", async () => {
    const p = await snapEvent({ name: "PURCHASE", id: "LM-1", time: 0, currency: "OMR", value: 32.9, user: { phone: "+968 7665 5565" },
      request: { client_ip_address: "1.2.3.4", client_user_agent: "UA/1" } });
    const ud = p.user_data as Record<string, any>;
    expect(ud.ph[0]).toBe(sha("96876655565"));
    expect(/7665/.test(JSON.stringify(p))).toBe(false);
    expect(ud.client_ip_address).toBe("1.2.3.4");
    const h = sha("96876655565");
    expect(((await snapEvent({ name: "ADD_CART", id: "a1", time: 0, user: { phoneHash: h } })).user_data as any).ph[0]).toBe(h);
    expect("ph" in (((await snapEvent({ name: "ADD_CART", id: "a1", time: 0, user: { phoneHash: "12345678" } })).user_data as object) || {})).toBe(false);
  });
  it("drops empty fields rather than sending them blank", async () => {
    const bare = await snapEvent({ name: "ADD_CART", id: "a2", time: 0, currency: "", value: null, items: [] });
    expect("currency" in ((bare.custom_data as object) || {})).toBe(false);
    expect("ph" in ((bare.user_data as object) || {})).toBe(false);
  });
  it("shapes a purchase: numbers, content_ids, num_items as a string", async () => {
    const pu = await snapEvent({ name: "PURCHASE", id: "LM-482913", time: 0, currency: "OMR", value: 32.9, numItems: 3, user: { phone: "96876655565" },
      items: [{ id: "oud-small", qty: 2, price: 12 }, { id: "bundle", qty: 1, price: 29 }] });
    const c = pu.custom_data as Record<string, any>;
    expect(c.currency).toBe("OMR");
    expect(c.value).toBe(32.9);
    expect(c.contents).toEqual([{ id: "oud-small", quantity: 2, item_price: 12 }, { id: "bundle", quantity: 1, item_price: 29 }]);
    expect(c.content_ids).toEqual(["oud-small", "bundle"]);
    expect(c.num_items).toBe("3");
    expect(pu.event_id).toBe("LM-482913");
  });
  // from test-snap-dedup.js: the CAPI half under the names Snap reads
  it("pairs with the pixel: event_id, order_id, content_category", async () => {
    const capi = await snapEvent({ name: "PURCHASE", id: "LM-482913", orderId: "LM-482913", category: "incense", currency: "OMR", value: 32.9, time: 0,
      items: [{ id: "oud-small", qty: 2, price: 12 }] });
    const c = capi.custom_data as Record<string, any>;
    expect([capi.event_id, c.order_id, c.content_category, capi.event_name]).toEqual(["LM-482913", "LM-482913", "incense", "PURCHASE"]);
  });
  it("Snap's ids to Snap only, never Meta's cookies", async () => {
    const e = await snapEvent({ name: "PURCHASE", id: "x", time: 0, scid: "scid-cookie", sccid: "sc-click", user: { fbp: "fb.1.1.2", fbc: "fb.1.2.3" } });
    const ud = e.user_data as Record<string, any>;
    expect([ud.sc_cookie1, ud.sc_click_id, ud.fbp, ud.fbc]).toEqual(["scid-cookie", "sc-click", undefined, undefined]);
  });
});
