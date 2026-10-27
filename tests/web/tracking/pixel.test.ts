/**
 * pixel.ts — Snap, Meta and GA4 in the page: the events, the relays' bodies, the shared ids,
 * the hashes (the same as the server's by construction), the kept identifiers, GA4's rules.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { hashPhone, hashedUser, phoneId } from "../../../src/shared/pixels/identity";
import { metaEvent, snapEvent } from "../../../src/server/domain/pixels/build";
import { parseMetaRelay, parseSnapRelay } from "../../../src/server/domain/pixels/relay";
import { dropListeners, items, loadPage, tick, type Page } from "./_page";

afterEach(() => dropListeners());

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const PHONE = "+971 501234567";
const PHONE_HASH = sha("971501234567");
const VID = "a".repeat(32) + "0123456789abcdef0123456789abcdef";
const CTX = { now: 1_790_000_000_000, edgeCountry: "OM", ip: "5.6.7.8", ua: "Shopper/1.0" };

/** a page with the core, stats and pixel, the relays sent at once (returning visitor: _fbp) */
async function home(o: Parameters<typeof loadPage>[0] = {}): Promise<Page> {
  const p = await loadPage({ cookie: "_fbp=fb.1.1700000000000.1", session: { lm_land: "{}" }, ...o });
  await p.LM!.ready;
  await tick(120);       // the page-view relays leave
  p.posted.length = 0;
  p.snap.length = 0;
  p.fb.length = 0;
  return p;
}
const relays = async (p: Page, kind: "snap" | "meta") => { await tick(120); return (await items(p)).filter((i) => i.kind === kind).map((i) => i.body); };

// from test-pixel-parity.js: 1. the phone hash is the same everywhere
describe("the phone hash", () => {
  it("drops the old as-typed key on load", async () => {
    await loadPage({ local: { lm_snap_ph: sha("+968 9123 4567") } });
    expect(localStorage.getItem("lm_snap_ph")).toBeNull();
  });

  it("the Snap pixel's Purchase hash == Snap CAPI == Meta CAPI, digits only, kept as lm_ph_v2", async () => {
    const p = await home();
    const phones = ["+968 9123 4567", "00968 91234567", "+971 501234567", "96891234567", "0 971-50-123-4567"];
    for (const ph of phones) {
      p.snap.length = 0;
      window.LMPX!.purchase({ id: "LM-1000001", omr: 10, pay: "cod", phone: ph, name: "Sara Ali", city: "Muscat", region: "Seeb", items: [{ itemId: "oud-small", qty: 1 }] });
      await tick(30);
      const browser = p.snap[0]!.params.user_hashed_phone_number;
      const snap = ((await snapEvent({ name: "PURCHASE", id: "x", time: 1, user: { phone: ph } })) as any).user_data.ph[0];
      const meta = ((await metaEvent({ name: "Purchase", id: "x", time: 1, user: { phone: ph } })) as any).user_data.ph[0];
      expect(browser).toMatch(/^[a-f0-9]{64}$/);
      expect([browser, browser]).toEqual([snap, meta]);
      expect(browser).toBe(sha(ph.replace(/\D/g, "").replace(/^0+/, "")));
    }
    expect(localStorage.getItem("lm_ph_v2")).toBe(await phoneId(phones[phones.length - 1]));
  });

  it("no raw name, city or region to the Snap pixel; the market and the order id do go", async () => {
    const p = await home({ url: "/?country=AE" });
    window.LMPX!.purchase({ id: "LM-1000001", omr: 10, pay: "cod", phone: "+968 9123 4567", name: "Sara Ali", city: "Muscat", region: "Seeb", items: [{ itemId: "oud-small", qty: 1 }] });
    await tick(30);
    const pu = p.snap[0]!.params;
    expect(["firstname", "lastname", "geo_city", "geo_region"].filter((k) => k in pu)).toEqual([]);
    expect(/Sara|Ali|Muscat|Seeb/.test(JSON.stringify(p.snap))).toBe(false);
    expect(pu.geo_country).toBe("AE");
    expect([pu.client_dedup_id, pu.transaction_id]).toEqual(["LM-1000001", "LM-1000001"]);
  });

  // from test-pixel-parity.js (v321): the rest of the match, hashed as the server hashes it
  it("keeps em, fn, ln, ct in lm_am_v1, each equal to Meta CAPI's", async () => {
    await home();
    window.LMPX!.purchase({ id: "LM-1000002", omr: 10, pay: "cod", phone: PHONE, name: "  Ahmed  Al-Balushi ", email: " Test@Example.com ", city: "Abu Dhabi", region: "x", items: [{ itemId: "oud-small", qty: 1 }] });
    await tick(40);
    const kept = JSON.parse(localStorage.getItem("lm_am_v1") || "{}");
    const srv = ((await metaEvent({ name: "Purchase", id: "x", time: 1, user: { phone: PHONE, email: "Test@Example.com", firstName: "Ahmed", lastName: "Al-Balushi", city: "Abu Dhabi" } })) as any).user_data;
    for (const k of ["em", "fn", "ln", "ct"]) {
      expect(kept[k]).toMatch(/^[a-f0-9]{64}$/);
      expect(kept[k]).toBe(srv[k][0]);
    }
    expect(Object.keys(kept).sort()).toEqual(["ct", "em", "fn", "ln"]);
  });

  // from test-v315.js: the checkout's phone, noted for this tab
  it("notePhone keeps the typed number's hash for this tab, and the relays carry it", async () => {
    const p = await home();
    window.LMPX!.notePhone("+968 9123 4567");
    await tick(20);
    expect(sessionStorage.getItem("lm_ph_typed")).toBe(await hashPhone("96891234567"));
    expect(localStorage.getItem("lm_ph_typed")).toBeNull();
    window.LMPX!.notePhone("123");   // not a phone: nothing
    await tick(20);
    expect(sessionStorage.getItem("lm_ph_typed")).toBe(sha("96891234567"));
    window.LMPX!.addCart({ scentId: "oud", sizeId: "small", scent: "عود", qty: 1 });
    expect(p.snap[0]!.params.user_hashed_phone_number).toBe(sha("96891234567"));
    expect((await relays(p, "meta"))[0]!.ph).toBe(sha("96891234567"));
  });

  it("a kept lm_ph_v2 wins over the typed one", async () => {
    const p = await home({ local: { lm_ph_v2: PHONE_HASH }, session: { lm_land: "{}", lm_ph_typed: sha("1234567") } });
    window.LMPX!.viewContent("small", "oud");
    expect(p.snap[0]!.params.user_hashed_phone_number).toBe(PHONE_HASH);
    expect((await relays(p, "snap"))[0]!.ph).toBe(PHONE_HASH);
  });
});

// from test-pixel-parity.js: 4. the Snap relay carries what the Meta relay carries
describe("the relays", () => {
  it("addCart: Snap's relay lines == Meta's, one id for both relays and the Meta pixel", async () => {
    const p = await home();
    window.LMPX!.addCart({ scentId: "oud", scent: "عود", sizeId: "small", size: "S", qty: 3 });
    const unit = p.LM!.omrNum(p.LM!.price("small"));
    const sr = (await relays(p, "snap"))[0]!, mr = (await items(p)).find((i) => i.kind === "meta")!.body;
    expect(sr.items).toEqual([{ id: "oud-small", qty: 3, price: unit }]);
    expect(mr.items).toEqual(sr.items);
    expect(sr.id).toBeTruthy();
    expect([mr.id, p.fb[0]!.opt.eventID, p.snap[0]!.params.client_dedup_id]).toEqual([sr.id, sr.id, sr.id]);
    // the server meets the bodies: Snap CAPI's lines, numbers, num_items as a string
    const spec = (parseSnapRelay(sr, CTX) as any).spec;
    const sc = (await snapEvent(spec)) as any;
    expect(sc.custom_data.content_ids).toEqual(["oud-small"]);
    expect(sc.custom_data.contents).toEqual([{ id: "oud-small", quantity: 3, item_price: unit }]);
    expect(sc.custom_data.value).toBe(Math.round(unit * 3 * 1000) / 1000);
    expect(sc.custom_data.num_items).toBe("3");
    expect("refused" in parseMetaRelay(mr, CTX)).toBe(false);
  });

  it("the relay bodies, exactly", async () => {
    const p = await home({ url: "/?country=AE", local: { lm_vid: VID }, cookie: "_fbp=fb.1.1700000000000.1; _fbc=fb.1.1.AbC; _scid=scid-1", session: { lm_land: "{}", lm_sccid: "sc-click" } });
    window.LMPX!.viewContent("large", "oud");
    const price = p.LM!.omrNum(p.LM!.price("large"));
    await tick(120);
    const its = await items(p);
    const href = location.href;
    expect(its.map((i) => i.kind)).toEqual(["snap", "meta"]);
    expect(its[0]!.body).toEqual({ name: "VIEW_CONTENT", id: its[0]!.body.id, url: href, currency: "OMR", category: "incense", price, numItems: 1,
      items: [{ id: "oud-large", qty: 1, price }], vid: VID, cc: "AE", scid: "scid-1", sccid: "sc-click" });
    expect(its[1]!.body).toEqual({ name: "ViewContent", id: its[0]!.body.id, url: href, currency: "OMR", value: price, category: "incense", contentName: "لبان صلالة معطر",
      numItems: 1, items: [{ id: "oud-large", qty: 1, price }], vid: VID, cc: "AE", fbp: "fb.1.1700000000000.1", fbc: "fb.1.1.AbC" });
    // the pixels
    expect(p.snap[0]).toEqual({ cmd: "track", name: "VIEW_CONTENT", params: { price, currency: "OMR", item_ids: ["oud-large"], item_category: "incense", number_items: 1,
      brands: ["Luban & Musk"], description: "لبان صلالة معطر", client_dedup_id: its[0]!.body.id, geo_country: "AE" } });
    expect(p.fb[0]).toEqual({ cmd: "track", name: "ViewContent", params: { value: price, currency: "OMR", content_type: "product", content_ids: ["oud-large"],
      content_category: "incense", content_name: "لبان صلالة معطر", contents: [{ id: "oud-large", quantity: 1, item_price: price }], num_items: 1 }, opt: { eventID: its[0]!.body.id } });
  });

  // from test-beacon.js: falling back to the direct endpoint when the queue is absent
  it("without the shared queue each relay posts to its own endpoint", async () => {
    const p = await loadPage({ stats: false, cookie: "_fbp=fb.1.1.1" });
    await p.LM!.ready;
    await tick(20);
    expect(p.fetches.map((f) => f.url)).toEqual(["/api/snap", "/api/meta"]);
    expect(p.fetches[0]!.body).toMatchObject({ name: "PAGE_VIEW", id: "pv-snap-1" });
    expect(p.fetches[1]!.body).toMatchObject({ name: "PageView", id: "pv-meta-1", fbp: "fb.1.1.1" });
  });

  it("the head's page-view ids are relayed under the same ids", async () => {
    const p = await loadPage({ cookie: "_fbp=fb.1.1.1", session: { lm_land: "{}" } });
    await tick(120);
    expect((await items(p)).map((i) => i.kind + ":" + i.body.name + ":" + (i.body.id || ""))).toEqual(["ev:page_view:", "snap:PAGE_VIEW:pv-snap-1", "meta:PageView:pv-meta-1"]);
  });

  // from test-v315.js: the visitor id and the market on both relays
  it("both relays carry vid and cc; a malformed vid is not sent", async () => {
    let p = await loadPage({ cookie: "_fbp=fb.1.1.1", local: { lm_vid: VID, lm_cty_v2: "ae" }, session: { lm_land: "{}" }, catalogue: null, fetch: () => new Promise(() => {}) });
    await tick(120);
    let its = await items(p);
    // before the catalogue answers: the kept pick
    expect(its.filter((i) => i.kind !== "ev").map((i) => [i.body.vid, i.body.cc])).toEqual([[VID, "AE"], [VID, "AE"]]);
    p = await loadPage({ url: "/?country=sa", cookie: "_fbp=fb.1.1.1", local: { lm_vid: "nope" }, session: { lm_land: "{}" }, catalogue: null, fetch: () => new Promise(() => {}) });
    await tick(120);
    its = await items(p);
    expect(its.filter((i) => i.kind !== "ev").map((i) => [i.body.vid, i.body.cc])).toEqual([[undefined, "SA"], [undefined, "SA"]]);
  });
});

// from test-snap-dedup.js
describe("Snap dedup", () => {
  it("client_dedup_id pairs pixel and relay; every event its own id; the Purchase is not relayed", async () => {
    const p = await home({ uuids: true, cookie: "_fbp=fb.1.1.1; _scid=cookie-1" });
    window.LMPX!.addCart({ scentId: "oud", sizeId: "small", scent: "عود", qty: 2 });
    let r = await relays(p, "snap");
    const pp = p.snap[0]!.params;
    expect("client_dedup_id" in pp).toBe(true);
    expect("client_deduplication_id" in pp).toBe(false);
    expect(pp.client_dedup_id).toBe(r[0]!.id);
    expect(/^@-/.test(pp.client_dedup_id)).toBe(false);

    p.snap.length = 0; p.posted.length = 0;
    sessionStorage.setItem("lm_cart", JSON.stringify([{ scentId: "oud", sizeId: "small", qty: 1 }]));
    window.LMPX!.viewContent("small", "oud");
    window.LMPX!.startCheckout();
    r = await relays(p, "snap");
    expect(p.snap.length).toBe(2);
    expect(new Set(p.snap.map((e) => e.params.client_dedup_id)).size).toBe(2);
    expect(p.snap.every((e, i) => e.params.client_dedup_id === r[i]!.id)).toBe(true);

    p.snap.length = 0; p.posted.length = 0;
    window.LMPX!.purchase({ id: "LM-482913", omr: 32.9, pay: "cod", phone: "96876655565", city: "Dubai", region: "Deira", dedupeId: "some-other-uuid", items: [{ itemId: "oud-small", qty: 2, price: 12 }] });
    await tick(60);
    const pu = p.snap[0]!.params;
    expect(pu.client_dedup_id).toBe("LM-482913");
    expect(pu.transaction_id).toBe("LM-482913");
    expect((await relays(p, "snap")).length).toBe(0);
    expect((await relays(p, "meta")).length).toBe(0);
    const capi = (await snapEvent({ name: "PURCHASE", id: "LM-482913", orderId: "LM-482913", time: 1, category: "incense", currency: "OMR", value: 32.9, items: [{ id: "oud-small", qty: 2, price: 12 }] })) as any;
    expect(capi.event_id).toBe(pu.client_dedup_id);
    expect(capi.custom_data.order_id).toBe(pu.transaction_id);
    expect(capi.custom_data.content_category).toBe(pu.item_category);
    expect(capi.event_name).toBe(p.snap[0]!.name);
  });

  it("startCheckout with an empty basket fires nothing", async () => {
    const p = await home();
    window.LMPX!.startCheckout();
    window.LMPX!.addPaymentInfo("cod");
    expect([p.snap.length, p.fb.length]).toEqual([0, 0]);
  });
});

// from test-meta.js: dedup with a capital ID; the Purchase
describe("Meta's Purchase", () => {
  it("eventID is the order id; the custom data as the original sent it", async () => {
    const p = await home();
    window.LMPX!.purchase({ id: "LM-1001", omr: 26.5, pay: "card", phone: "", items: [{ itemId: "oud-large", qty: 2 }, { itemId: "burner", qty: 1 }] });
    expect(p.fb[0]).toEqual({ cmd: "track", name: "Purchase", params: { value: 26.5, currency: "OMR", content_type: "product", content_ids: ["oud-large", "burner"],
      content_category: "incense", contents: [{ id: "oud-large", quantity: 2 }, { id: "burner", quantity: 1 }], num_items: 3, order_id: "LM-1001" }, opt: { eventID: "LM-1001" } });
    await tick(30);
    expect(p.snap[0]!.params).toEqual({ price: 26.5, currency: "OMR", transaction_id: "LM-1001", item_ids: ["oud-large", "burner"], item_category: "incense",
      number_items: 3, brands: ["Luban & Musk"], delivery_method: "delivery", payment_info_available: 1, success: 1, client_dedup_id: "LM-1001", geo_country: "OM" });
    expect(localStorage.getItem("lm_ph_v2")).toBeNull();   // no phone, nothing kept
  });
});

// from test-pixel-parity.js: 7. ADD_BILLING
describe("the payment step", () => {
  it("one id for both platforms, once per method, another method once more", async () => {
    const p = await home();
    sessionStorage.setItem("lm_cart", JSON.stringify([{ scentId: "oud", sizeId: "large", qty: 2 }, { scentId: "", sizeId: "burner", qty: 1 }]));
    window.LMPX!.addPaymentInfo("cod");
    const ab = p.snap.find((e) => e.name === "ADD_BILLING")!;
    const api = p.fb.find((e) => e.name === "AddPaymentInfo")!;
    expect(ab.params.client_dedup_id).toBe(api.opt.eventID);
    expect(ab.params.price).toBe(api.params.value);
    expect(api.params.content_name).toBe("cod");
    expect(ab.params.payment_info_available).toBe(1);
    const sr = await relays(p, "snap");
    expect(sr.filter((r) => r.name === "ADD_BILLING").map((r) => r.id)).toEqual([ab.params.client_dedup_id]);
    window.LMPX!.addPaymentInfo("cod");
    expect([p.snap.length, p.fb.length]).toEqual([1, 1]);
    window.LMPX!.addPaymentInfo("card");
    expect(p.snap.length === 2 && p.fb.length === 2 && p.snap[1]!.params.client_dedup_id === p.fb[1]!.opt.eventID &&
      p.snap[1]!.params.client_dedup_id !== p.snap[0]!.params.client_dedup_id).toBe(true);
    window.LMPX!.addPaymentInfo("anything");   // not card: cod, already reported
    expect(p.snap.length).toBe(2);
    // the server takes the relay and sends the lines' quantities
    const spec = (parseSnapRelay(sr.find((r) => r.name === "ADD_BILLING")!, CTX) as any).spec;
    expect(((await snapEvent(spec)) as any).custom_data.contents.map((c: any) => c.quantity)).toEqual([2, 1]);
  });
});

// from test-meta.js: the click id is stashed the moment it lands
describe("the Meta click id", () => {
  it("stashed whole as <fbclid>|<ms>; the first sighting keeps its time; a new click replaces it", async () => {
    const long = "IwAR" + "x".repeat(260);
    await loadPage({ url: "/?fbclid=" + long, session: { lm_land: "{}" } });
    const first = sessionStorage.getItem("lm_fbclid")!;
    expect(first.split("|")[0]).toBe(long);
    expect(first.split("|")[1]).toMatch(/^\d+$/);
    await tick(5);
    await loadPage({ url: "/?fbclid=" + long, sameTab: true });
    expect(sessionStorage.getItem("lm_fbclid")).toBe(first);
    await loadPage({ url: "/?fbclid=Other%7Cid", sameTab: true });
    expect(sessionStorage.getItem("lm_fbclid")!.split("|").slice(0, 2).join("|")).toBe("Other|id");
  });

  it("fbc: the cookie (decoded) wins; else rebuilt from the stash at the LAST pipe", async () => {
    let p = await home({ cookie: "_fbp=fb.1.1.1; _fbc=fb.1.1.Ab%2FCd", session: { lm_land: "{}", lm_fbclid: "a|b|1790000000000" } });
    expect(window.LMPX!.signals().fbc).toBe("fb.1.1.Ab/Cd");
    p = await home({ session: { lm_land: "{}", lm_fbclid: "a|b|1790000000000" } });
    expect(window.LMPX!.signals().fbc).toBe("fb.1.1790000000000.a|b");
    void p;
  });
});

// from test-v302.js: GA4 in the page
describe("GA4", () => {
  const cmds = () => ((window.dataLayer || []) as IArguments[]).map((a) => Array.prototype.slice.call(a));
  async function ga(o: Parameters<typeof loadPage>[0]): Promise<Page> {
    const p = await home(o);
    p.later();
    await p.LM!.ready;
    await tick(5);
    return p;
  }

  it("no id: no Google script, nothing queued", async () => {
    const p = await ga({ analytics: { ga4: "", mp: false } });
    window.LMPX!.addCart({ scentId: "oud", sizeId: "large", qty: 1 });
    expect(p.heads.length + " " + cmds().length).toBe("0 0");
  });

  it("an id: gtag.js for that stream, the checkout as referrer from the card page, the tags in the standard", async () => {
    const p = await ga({ analytics: { ga4: "G-ABC123XYZ9", mp: true }, referrer: "https://checkout.thawani.om/pay/x", url: "/?country=AE&utm_source=IG&utm_medium=Paid%20Social&utm_campaign=National%20Day" });
    expect(p.heads[0]!.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9");
    expect(p.heads[0]!.async).toBe(true);
    const c = cmds();
    expect(c[0]![0]).toBe("js");
    expect(c[1]).toEqual(["set", "user_properties", { market: "AE", site_language: "ar" }]);
    const conf = c.find((x) => x[0] === "config")!;
    expect(conf[1]).toBe("G-ABC123XYZ9");
    expect(conf[2]).toEqual({ send_page_view: true, page_referrer: location.origin + "/checkout.html", campaign_source: "instagram", campaign_medium: "paid_social", campaign_name: "national_day" });
    window.LMPX!.addCart({ scentId: "oud", sizeId: "large", scent: "Oud Lavender", qty: 2 });
    const add = cmds().find((x) => x[0] === "event" && x[1] === "add_to_cart")!;
    const unit = p.LM!.omrNum(p.LM!.price("large"));
    expect(add[2]).toEqual({ currency: "OMR", value: p.LM!.omrNum(p.LM!.price("large") * 2), items: [{ item_id: "oud-large", item_name: "Oud Lavender", item_brand: "Luban & Musk",
      item_category: "incense", item_variant: "large", price: unit, quantity: 2 }] });
    window.LMPX!.purchase({ id: "LM-1", omr: 26, items: [], pay: "card", phone: "" });
    await tick(5);
    expect(cmds().some((x) => x[1] === "purchase")).toBe(false);   // the server reports purchases
  });

  it("no secret on the server: the page reports the purchase", async () => {
    await ga({ analytics: { ga4: "G-ABC123XYZ9", mp: false } });
    window.LMPX!.purchase({ id: "LM-2", omr: 26, items: [{ itemId: "oud-large", qty: 1 }], pay: "cod", phone: "" });
    expect(cmds().find((x) => x[1] === "purchase")![2]).toEqual({ transaction_id: "LM-2", currency: "OMR", value: 26, payment_type: "cod",
      items: [{ item_id: "oud-large", item_brand: "Luban & Musk", item_category: "incense", quantity: 1 }] });
  });

  // from test-v314.js: the server's answer says who sends it
  it("the server's answer wins over the config", async () => {
    await ga({ analytics: { ga4: "G-ABC123XYZ9", mp: true } });
    window.LMPX!.purchase({ id: "LM-3", omr: 26, items: [], pay: "cod", phone: "" }, { ga4: "page" });
    expect(cmds().some((x) => x[1] === "purchase" && x[2].transaction_id === "LM-3")).toBe(true);
    await ga({ analytics: { ga4: "G-ABC123XYZ9", mp: false } });
    window.LMPX!.purchase({ id: "LM-4", omr: 26, items: [], pay: "cod", phone: "" }, { ga4: "server" });
    expect(cmds().some((x) => x[1] === "purchase")).toBe(false);
  });

  it("events asked for before gtag starts wait (40 at most), then go in order", async () => {
    const p = await home({ analytics: { ga4: "G-ABC123XYZ9", mp: true } });
    window.LMPX!.viewContent("large", "oud");
    expect(cmds().length).toBe(0);
    p.later();
    await tick(5);
    expect(cmds().map((x) => x[0] + ":" + (x[0] === "event" ? x[1] : ""))).toEqual(["js:", "set:", "config:", "event:view_item"]);
  });

  it("a leaving page starts nothing", async () => {
    const p = await home({ analytics: { ga4: "G-ABC123XYZ9", mp: true } });
    window.__lmLeaving = 1;
    p.later();
    await tick(5);
    expect(p.heads.length).toBe(0);
  });

  it("signals carry GA's ids (GS2 and the older GS1)", async () => {
    await ga({ analytics: { ga4: "G-ABC123XYZ9", mp: true }, cookie: "_ga=GA1.1.1234567890.1759500000; _ga_ABC123XYZ9=GS2.1.s1759560000$o3$g1$t1759560100$j0$l0$h0" });
    expect(window.LMPX!.signals()).toEqual({ gcid: "1234567890.1759500000", gsid: "1759560000" });
    await ga({ analytics: { ga4: "G-ABC123XYZ9", mp: true }, cookie: "_ga=GA1.1.1234567890.1759500000; _ga_ABC123XYZ9=GS1.1.1759560000.3.1.1759560100.0.0.0" });
    expect(window.LMPX!.signals().gsid).toBe("1759560000");
  });
});

// from test-pixel-parity.js / test-v315.js: the order's signals
describe("signals", () => {
  it("every id the server cannot derive, and nothing else", async () => {
    await home({ local: { lm_vid: VID }, cookie: "_scid=scid-cookie; _fbp=fb.1.1.2; _fbc=fb.1.1790534142169.IwAR", session: { lm_land: "{}", lm_sccid: "sc-click" } });
    expect(window.LMPX!.signals()).toEqual({ scid: "scid-cookie", sccid: "sc-click", fbp: "fb.1.1.2", fbc: "fb.1.1790534142169.IwAR", vid: VID });
  });
});

// from test-v302.js: the last source, 90 days
describe("the 90-day last touch", () => {
  it("a landing from an ad is kept; a later direct visit sends it with the order; the card page is not a new source", async () => {
    await loadPage({ url: "/?utm_source=ig", referrer: "" });
    const kept = JSON.parse(localStorage.getItem("lm_touch")!);
    expect(kept.utm.source).toBe("ig");
    expect(kept.at).toBeGreaterThan(0);
    const keptRaw = localStorage.getItem("lm_touch")!;
    await loadPage({ url: "/", local: { lm_touch: keptRaw } });
    expect((window.LMPX!.landing() as any).touch.utm.source).toBe("ig");
    await loadPage({ url: "/", referrer: "https://checkout.thawani.om/x", local: { lm_touch: keptRaw } });
    expect(JSON.parse(localStorage.getItem("lm_touch")!).utm.source).toBe("ig");
    expect((window.LMPX!.landing() as any).touch.utm.source).toBe("ig");
  });

  it("kept once per tab; another site is a source, this shop is not; older than 90 days is dropped", async () => {
    await loadPage({ url: "/", referrer: "https://www.google.com/search" });
    expect(JSON.parse(localStorage.getItem("lm_touch")!).ref).toBe("https://www.google.com");
    localStorage.removeItem("lm_touch");
    await loadPage({ url: "/?utm_source=snap", sameTab: true, session: { lm_land: JSON.stringify({ utm: { source: "snap" } }) } });
    expect(localStorage.getItem("lm_touch")).toBeNull();    // this tab already decided
    await loadPage({ url: "/", referrer: location.origin + "/checkout.html" });
    expect(localStorage.getItem("lm_touch")).toBeNull();
    const old = JSON.stringify({ at: Date.now() - 91 * 86400e3, utm: { source: "ig" } });
    await loadPage({ url: "/", local: { lm_touch: old } });
    expect((window.LMPX!.landing() as any).touch).toBeUndefined();
    const fresh = JSON.stringify({ at: Date.now() - 89 * 86400e3, utm: { source: "ig" } });
    await loadPage({ url: "/", local: { lm_touch: fresh } });
    expect((window.LMPX!.landing() as any).touch.utm.source).toBe("ig");
    // a tagged landing keeps its own
    await loadPage({ url: "/?utm_source=tiktok", local: { lm_touch: fresh } });
    expect((window.LMPX!.landing() as any).touch).toBeUndefined();
    expect((window.LMPX!.landing() as any).utm.source).toBe("tiktok");
  });
});

// from test-v209.js: a first visit's Meta relays wait for _fbp — and it is still one request
describe("the first-visit hold", () => {
  function libraryScript(): HTMLScriptElement {
    document.querySelectorAll("script[data-fake]").forEach((s) => s.remove());
    const s = document.createElement("script");
    s.type = "text/plain";
    s.setAttribute("data-fake", "1");
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.body.appendChild(s);
    return s;
  }
  const tab = { session: { lm_land: "{}" } };

  it("no _fbp: nothing leaves until the library sets it, then ONE request with the cookie", async () => {
    libraryScript();
    const p = await loadPage({ ...tab, fbPageView: "fbpv-1", pageView: "sfbpv-1" });
    await tick(200);
    expect(p.posted.length).toBe(0);
    p.later();
    await tick(300);
    expect(p.posted.length).toBe(0);
    p.setCookie("_fbp=fb.1.1790000000000.77; _scid=late-scid");
    await tick(350);
    expect(await p.kinds()).toEqual(["ev:page_view,snap:PAGE_VIEW,meta:PageView"]);
    const its = await items(p);
    expect(its[2]!.body.fbp).toBe("fb.1.1790000000000.77");
    expect(its[1]!.body.scid).toBe("late-scid");     // v314: Snap's cookie patched in as the batch leaves
    window.LMPX!.viewContent("large", "oud");
    await tick(150);
    expect(p.posted.length).toBe(2);
    expect((await items(p)).filter((i) => i.kind === "meta")[1]!.body.fbp).toBe("fb.1.1790000000000.77");
  });

  it("a blocked library: one request as soon as it fails, without _fbp; the tab stops waiting", async () => {
    const s = libraryScript();
    let p = await loadPage({ ...tab, fbPageView: "fbpv-2" });
    p.later();
    s.dispatchEvent(new Event("error"));
    await tick(150);
    expect(await p.kinds()).toEqual(["ev:page_view,snap:PAGE_VIEW,meta:PageView"]);
    expect((await items(p))[2]!.body.fbp).toBeUndefined();
    expect(sessionStorage.getItem("lm_fb_off")).toBe("1");
    p = await loadPage({ fbPageView: "fbpv-3", sameTab: true });
    await tick(150);
    expect(p.posted.length).toBe(1);
  });

  it("left before the library came: one request, the held Meta copy in it", async () => {
    libraryScript();
    const p = await loadPage({ ...tab, fbPageView: "fbpv-4" });
    await tick(100);
    window.dispatchEvent(new Event("pagehide"));
    expect(await p.kinds()).toEqual(["ev:page_view,snap:PAGE_VIEW,meta:PageView"]);
  });

  it("a returning visitor with _fbp: sent at once, with it", async () => {
    libraryScript();
    const p = await loadPage({ ...tab, cookie: "_fbp=fb.1.1700000000000.1" });
    await tick(150);
    expect(p.posted.length).toBe(1);
    expect((await items(p)).find((i) => i.kind === "meta")!.body.fbp).toBe("fb.1.1700000000000.1");
  });

  it("a page without lmLater holds nothing; no library script on the page: let go at once", async () => {
    let p = await loadPage({ ...tab, lmLater: "none" });
    await tick(150);
    expect(p.posted.length).toBe(1);
    document.querySelectorAll("script[data-fake]").forEach((x) => x.remove());
    p = await loadPage({ ...tab });
    p.later();
    await tick(150);
    expect(await p.kinds()).toEqual(["ev:page_view,snap:PAGE_VIEW,meta:PageView"]);
  });

  it("the wait is bounded: 4 s for the cookie", async () => {
    libraryScript();
    const p = await loadPage({ ...tab });
    p.later();
    await tick(3700);
    expect(p.posted.length).toBe(0);
    await tick(600);
    expect(p.posted.length).toBe(1);
  }, 10_000);
});
