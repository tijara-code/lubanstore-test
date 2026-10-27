/**
 * LUBAN & MUSK — the ad platforms' events (port of assets/js/pixel.js): Snap, Meta and GA4.
 * Loaded on the home page and the checkout, after stats.ts (whose queue it shares).
 *
 * The loaders + PAGE_VIEW / PageView live inline in <head> so they fire as early as the
 * platforms expect (and the head's `early` script defers the libraries through lmLater). This
 * module adds the commerce events. Rules it follows:
 *   - never throw into the store; a blocked pixel must not break checkout
 *   - never send a parameter we don't actually have
 *   - personal data is SHA-256 hashed in the browser (shared/pixels/identity, the SAME
 *     normalisers and hashing the server copies use); nothing raw leaves it
 *   - values are reported in OMR, because OMR is what is actually charged
 *   - every event fires twice — the pixel and the same-origin server relay — under ONE id
 *     (`client_dedup_id` for Snap, `eventID`, capital ID, for Meta); the platform keeps the
 *     first to arrive and drops the twin. The Purchase is never relayed from here: the server
 *     sends it with the catalogue's price.
 */
import { fromSomewhere, lastTouch, type Landing } from "../../shared/attribution";
import { hashPhone, isHash, matchHashes } from "../../shared/pixels/identity";
import { BRAND, CATEGORY, CURRENCY } from "../../shared/pixels/catalogue";
import type { CartLine } from "../core/types";
import { ga, gaIds, gaRaw, gaServerBuys, gaStart } from "./ga4";
import { AM_KEY, PH_KEY, fbc, fbp, market, savedPhone, scid, snapClickId, stashClickId, vid } from "./ids";
import type { Lmpx, PurchaseOrder, PurchaseTold, Signals } from "./types";

type Obj = Record<string, unknown>;
type RelayItem = { id: unknown; qty?: unknown; price?: unknown };

const LM = () => window.LM;

/* drop empties so a platform never receives a blank or undefined field */
function clean(o: Obj): Obj {
  const out: Obj = {};
  for (const k in o) {
    const v = o[k];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) { if (v.length) out[k] = v; continue; }
    out[k] = v;
  }
  return out;
}

function uuid(): string {
  try {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* nothing */ }
  return "lm-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
}

/* Through the shared beacon when it is there (stats.ts loads first), so the page's
   measurement leaves as one request; straight to the endpoint if it is not. */
function beacon(kind: string, url: string, body: Obj): void {
  if (window.__lmLeaving) return;   /* moving to /en/ — see LMBeacon.queue (v209) */
  const B = window.LMBeacon;
  if (B && B.queue) { B.queue(kind, body); return; }
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
    credentials: "omit",
  }).catch(() => {});
}

/* ---------- Snap ---------- */

function snapOn(): boolean { return typeof window.snaptr === "function"; }

/** the pixel AND the server relay, with the same dedup id */
function track(name: string, params: Obj, items?: RelayItem[]): void {
  const p = clean(params || {});
  try {
    if (snapOn()) window.snaptr!("track", name, p);
  } catch { /* analytics must never break the page */ }
  relay(name, p, items);
}

/* `items` are the lines as {id, qty, price}: the pixel has only item_ids and a total count,
   and a server copy rebuilt from those told Snap every line was quantity 1 at no price. */
function relay(name: string, p: Obj, items?: RelayItem[]): void {
  try {
    if (typeof window.fetch !== "function") return;
    /* PURCHASE is sent server-side; /api/snap refuses it by design */
    if (name === "PURCHASE") return;
    const body: Obj = {
      name,
      id: p.transaction_id || p.client_dedup_id,
      url: location.href,
      currency: p.currency,
      category: p.item_category,   /* CAPI calls this content_category */
      price: p.price,
      numItems: p.number_items,
      items: items || ((p.item_ids as unknown[]) || []).map((id) => ({ id })),
      ph: p.user_hashed_phone_number || savedPhone() || undefined,
      vid: vid() || undefined,
      cc: market(),
      scid: scid() || undefined,
      sccid: snapClickId() || undefined,
    };
    if (!body.id) return;                 /* no id means no dedup — don't risk a double count */
    beacon("snap", "/api/snap", clean(body));
  } catch { /* nothing */ }
}

/* ---------- Meta ---------- */

function fbOn(): boolean { return typeof window.fbq === "function"; }

function fbTrack(name: string, custom: Obj, eid: string): void {
  const c = clean(custom || {});
  try {
    if (fbOn()) window.fbq!("track", name, c, { eventID: eid });
  } catch { /* analytics must never break the page */ }
  fbRelay(name, c, eid);
}

function fbRelay(name: string, c: Obj, eid: string): void {
  try {
    if (typeof window.fetch !== "function" || !eid) return;
    /* Purchase is sent server-side; /api/meta refuses it by design */
    if (name === "Purchase") return;
    const body: Obj = {
      name,
      id: eid,
      url: location.href,
      currency: c.currency,
      value: c.value,
      category: c.content_category,
      contentName: c.content_name,
      numItems: c.num_items,
      items: ((c.contents as Array<{ id: unknown; quantity: unknown; item_price: unknown }>) || []).map((i) => ({
        id: i.id, qty: i.quantity, price: i.item_price,
      })),
      ph: savedPhone() || undefined,
      vid: vid() || undefined,
      cc: market(),
      fbp: fbp() || undefined,
      fbc: fbc() || undefined,
    };
    if (held && !body.fbp) { held.push(body); return; }   /* see releaseHeld */
    beacon("meta", "/api/meta", clean(body));
  } catch { /* nothing */ }
}

/* A FIRST VISIT'S META RELAYS WAIT FOR META'S OWN COOKIE (v209). The pixel library is fetched
   once the page has drawn itself (lmLater), and a server copy that left before it had set
   _fbp reached Meta with no browser id, ahead of the pixel's own copy — and Meta generally
   keeps the copy that arrives first. A relay with no _fbp waits while the library is on its
   way, and goes the moment it has set the cookie, failed or been blocked, four seconds after it
   was sent for at the latest, or as the page is left. The page's other measurement waits with
   it (LMBeacon.hold), so it all still leaves as one request. Nothing waits for a visitor who
   has the cookie, in a tab where the library has already failed once, or on a page without the
   loader. */
let held: Obj[] | null = null;
function fbOff(): boolean { try { return sessionStorage.getItem("lm_fb_off") === "1"; } catch { return false; } }
function releaseHeld(): void {
  if (!held) return;
  const h = held;
  held = null;
  h.forEach((b) => {
    if (!b.fbp) b.fbp = fbp() || undefined;
    if (!b.fbc) b.fbc = fbc() || undefined;
    beacon("meta", "/api/meta", clean(b));
  });
  /* the Snap twins of the same held batch were built before Snap's library set its cookie —
     filled now, as the batch leaves (v314) */
  const B = window.LMBeacon;
  if (B && B.patch) B.patch("snap", (b) => {
    if (!b.scid) { const c = scid(); if (c) b.scid = c; }
  });
  if (B && B.release) B.release();
}
function holdForFbp(): void {
  try {
    if (typeof window.lmLater === "function" && !fbp() && !fbOff()) {
      held = [];
      /* the shared queue holds with us, and hands back on leaving */
      const B = window.LMBeacon;
      if (B && B.hold) B.hold(releaseHeld);
      else {
        const leave = () => { releaseHeld(); };
        window.addEventListener("pagehide", leave);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") leave();
        });
      }
      /* queued after the head's own loader, so its script is in the page; the cookie is looked
         for every tenth of a second, as the library sets it once it has initialised */
      window.lmLater(() => {
        const s = document.querySelector('script[src*="connect.facebook.net"]');
        if (!s) { releaseHeld(); return; }
        s.addEventListener("error", () => {
          try { sessionStorage.setItem("lm_fb_off", "1"); } catch { /* nothing */ }
          releaseHeld();
        });
        let n = 0;
        (function look() {
          if (!held) return;
          if (fbp() || n++ >= 40) { releaseHeld(); return; }
          setTimeout(look, 100);
        })();
      });
    }
  } catch { releaseHeld(); }
}

/* ---------- shared shapes ---------- */

/* The same id the order posts and the server parses — one rule, in the core (LM.itemId). */
function itemId(it: CartLine): string {
  const lm = LM();
  return lm && lm.itemId ? lm.itemId(it) : (it.sizeId === "bundle" ? "bundle" : it.scentId + "-" + it.sizeId);
}

function cartRead(): CartLine[] {
  const lm = LM();
  if (lm && lm.readCart) return lm.readCart();
  try { const c = JSON.parse(sessionStorage.getItem("lm_cart") as string); return Array.isArray(c) ? c : []; } catch { return []; }
}

function cartValue(cart: CartLine[]): number {
  return cart.reduce((t, i) => t + LM().price(i.sizeId) * i.qty, 0);
}

function cartCount(cart: CartLine[]): number {
  return cart.reduce((t, i) => t + i.qty, 0);
}

/* the lines as the server copies take them: id, quantity, OMR unit price */
function lines(cart: CartLine[]): RelayItem[] {
  return cart.map((i) => ({ id: itemId(i), qty: i.qty, price: LM().omrNum(LM().price(i.sizeId)) }));
}

function geo(): Obj {
  const lm = LM();
  return lm && lm.c ? { geo_country: lm.c.code } : {};
}

function ident(): Obj {
  const p = savedPhone();
  return p ? { user_hashed_phone_number: p } : {};
}

function rememberPhone(hash: string): void {
  if (!isHash(hash)) return;
  try { localStorage.setItem(PH_KEY, hash); } catch { /* nothing */ }
}

/* v321: ADVANCED MATCHING, THE REST. At Purchase the name, city and email are hashed here —
   normalised exactly as the server copy normalises them (shared/pixels matchHashes) — and kept
   under lm_am_v1; the inline snippet reads them into fbq('init') on every later visit. */
function rememberMatch(order: PurchaseOrder): Promise<void> {
  return matchHashes(order || {}).then((out) => {
    if (Object.keys(out).length) { try { localStorage.setItem(AM_KEY, JSON.stringify(out)); } catch { /* nothing */ } }
  }).catch(() => {});
}

/* a cart line as GA4 lists an item; prices in OMR, like every event */
function gaItem(line: CartLine): Obj {
  return clean({
    item_id: itemId(line),
    item_name: line.scent || itemId(line),
    item_brand: BRAND,
    item_category: CATEGORY,
    item_variant: line.sizeId,
    price: LM().omrNum(LM().price(line.sizeId)),
    quantity: line.qty || 1,
  });
}

/* ---------- the last source, 90 days (v302) ----------
   GA4 credits a sale to the last source that was not "direct". The landing of this tab is
   stats.ts's; a landing that came from somewhere (a tag, an ad's click id, another site — not
   this shop, not the card page) is kept here for 90 days, beside the ad platforms' own
   cookies, and goes with the order only when this tab's own landing is direct. What it keeps
   is the landing's shape — never a click id's value. */
const K_TOUCH = "lm_touch";
function keepTouch(): void {
  try {
    if (sessionStorage.getItem("lm_touch_kept")) return;
    sessionStorage.setItem("lm_touch_kept", "1");
    const l = window.LMLanding ? window.LMLanding() : null;
    if (!fromSomewhere(l, location.hostname)) return;
    localStorage.setItem(K_TOUCH, JSON.stringify(Object.assign({ at: Date.now() }, l)));
  } catch { /* nothing */ }
}
function keptTouch(landing: Landing): Record<string, unknown> | null {
  try {
    return lastTouch(landing, JSON.parse(localStorage.getItem(K_TOUCH) as string), location.hostname, Date.now());
  } catch {
    return null;
  }
}

/* ---------- events ---------- */

const billed: Record<string, 1> = {};   /* addPaymentInfo: the methods already reported on this page */

export const LMPX: Lmpx = {
  /* product page, once the catalogue and country are known */
  viewContent(sizeId, scentId) {
    const price = LM().price(sizeId);
    const id = scentId + "-" + sizeId;
    /* One id per event, shared by BOTH networks' pixel and server twin. */
    const eid = uuid();

    track("VIEW_CONTENT", Object.assign({
      price: LM().omrNum(price),
      currency: CURRENCY,
      item_ids: [id],
      item_category: CATEGORY,
      number_items: 1,
      brands: [BRAND],
      description: "لبان صلالة معطر",
      client_dedup_id: eid,
    }, geo(), ident()), [{ id, qty: 1, price: LM().omrNum(price) }]);

    fbTrack("ViewContent", {
      value: LM().omrNum(price),
      currency: CURRENCY,
      content_type: "product",
      content_ids: [id],
      content_category: CATEGORY,
      content_name: "لبان صلالة معطر",
      contents: [{ id, quantity: 1, item_price: LM().omrNum(price) }],
      num_items: 1,
    }, eid);

    ga("view_item", {
      currency: CURRENCY, value: LM().omrNum(price),
      items: [clean({ item_id: id, item_brand: BRAND, item_category: CATEGORY,
        item_variant: sizeId, price: LM().omrNum(price), quantity: 1 })],
    });
  },

  /* fired with the line that was just added, not the whole cart */
  addCart(line) {
    const eid = uuid();
    const val = LM().omrNum(LM().price(line.sizeId) * line.qty);

    track("ADD_CART", Object.assign({
      price: val,
      currency: CURRENCY,
      item_ids: [itemId(line)],
      item_category: CATEGORY,
      number_items: line.qty,
      brands: [BRAND],
      description: line.scent,
      client_dedup_id: eid,
    }, geo(), ident()), lines([line]));

    fbTrack("AddToCart", {
      value: val,
      currency: CURRENCY,
      content_type: "product",
      content_ids: [itemId(line)],
      content_category: CATEGORY,
      content_name: line.scent,
      contents: [{ id: itemId(line), quantity: line.qty, item_price: LM().omrNum(LM().price(line.sizeId)) }],
      num_items: line.qty,
    }, eid);

    ga("add_to_cart", { currency: CURRENCY, value: val, items: [gaItem(line)] });
  },

  /* checkout page load, with the cart as it stands */
  startCheckout() {
    const cart = cartRead();
    if (!cart.length) return;
    const eid = uuid();
    const val = LM().omrNum(cartValue(cart));

    track("START_CHECKOUT", Object.assign({
      price: val,
      currency: CURRENCY,
      item_ids: cart.map(itemId),
      item_category: CATEGORY,
      number_items: cartCount(cart),
      brands: [BRAND],
      payment_info_available: 0,
      client_dedup_id: eid,
    }, geo(), ident()), lines(cart));

    fbTrack("InitiateCheckout", {
      value: val,
      currency: CURRENCY,
      content_type: "product",
      content_ids: cart.map(itemId),
      content_category: CATEGORY,
      contents: cart.map((i) => ({ id: itemId(i), quantity: i.qty, item_price: LM().omrNum(LM().price(i.sizeId)) })),
      num_items: cartCount(cart),
    }, eid);

    ga("begin_checkout", { currency: CURRENCY, value: val, items: cart.map(gaItem) });
  },

  /* The shopper chose how to pay — Meta's AddPaymentInfo, Snap's ADD_BILLING; one id for
     both. Once per method per page: tapping the same button again is not a second step. */
  addPaymentInfo(method) {
    const cart = cartRead();
    if (!cart.length) return;
    const how = method === "card" ? "card" : "cod";
    if (billed[how]) return;
    billed[how] = 1;
    const eid = uuid();
    const val = LM().omrNum(cartValue(cart));

    track("ADD_BILLING", Object.assign({
      price: val,
      currency: CURRENCY,
      item_ids: cart.map(itemId),
      item_category: CATEGORY,
      number_items: cartCount(cart),
      brands: [BRAND],
      payment_info_available: 1,
      client_dedup_id: eid,
    }, geo(), ident()), lines(cart));

    fbTrack("AddPaymentInfo", {
      value: val,
      currency: CURRENCY,
      content_type: "product",
      content_ids: cart.map(itemId),
      content_category: CATEGORY,
      content_name: how,
      contents: cart.map((i) => ({ id: itemId(i), quantity: i.qty, item_price: LM().omrNum(LM().price(i.sizeId)) })),
      num_items: cartCount(cart),
    }, eid);

    ga("add_payment_info", { currency: CURRENCY, value: val, payment_type: how, items: cart.map(gaItem) });
  },

  /* order confirmed — the only event carrying customer identifiers (hashed) */
  purchase(order, told) {
    /* v314: the server's answer says who sends the GA4 purchase ("server"/"page"); the page's
       own config is the fallback */
    const gaWho = told && told.ga4 === "server" ? "server" : told && told.ga4 === "page" ? "page" : null;
    const items = order.items || [];
    const count = items.reduce((t, i) => t + i.qty, 0);
    const lm = LM();
    const base: Obj = {
      price: order.omr,
      currency: CURRENCY,
      transaction_id: order.id,
      item_ids: items.map((i) => i.itemId),
      item_category: CATEGORY,
      number_items: count,
      brands: [BRAND],
      delivery_method: "delivery",
      payment_info_available: order.pay === "card" ? 1 : 0,
      success: 1,
      /* MUST equal the CAPI event_id: the order id on every server path */
      client_dedup_id: order.id,
      /* the market only: the shopper's name, city and region would leave the browser in the
         clear; the server sends them to both platforms, hashed */
      geo_country: (lm && lm.c && lm.c.code) || "",
    };

    /* Meta: event_id is the order id on BOTH paths, so the pixel copy and the CAPI copy collapse
       into one conversion. The value is advisory; the server sends the authoritative total. */
    const fbCustom = {
      value: order.omr,
      currency: CURRENCY,
      content_type: "product",
      content_ids: items.map((i) => i.itemId),
      content_category: CATEGORY,
      contents: items.map((i) => ({ id: i.itemId, quantity: i.qty })),
      num_items: count,
      order_id: order.id,
    };
    try {
      if (fbOn()) window.fbq!("track", "Purchase", clean(fbCustom), { eventID: order.id });
    } catch { /* nothing */ }

    /* GA4: only while the server cannot send it */
    if (gaWho === "page" || (gaWho === null && !gaServerBuys())) gaRaw("purchase", {
      transaction_id: order.id, currency: CURRENCY, value: order.omr,
      payment_type: order.pay === "card" ? "card" : "cod",
      items: items.map((i) => clean({ item_id: i.itemId, item_brand: BRAND, item_category: CATEGORY, quantity: i.qty })),
    });

    /* hash before sending; if hashing isn't possible, send without it */
    hashPhone(order.phone).then((h) => {
      if (h) {
        base.user_hashed_phone_number = h;
        /* kept for next time — this puts a phone on the PAGE_VIEW and ADD_CART of every later visit */
        rememberPhone(h);
      }
      void rememberMatch(order);
      track("PURCHASE", base);
    }).catch(() => {
      track("PURCHASE", base);
    });
  },

  /* where the order is credited (v302): this tab's landing, with the kept last source beside
     it when the landing is direct */
  landing() {
    let l: Landing = window.LMLanding ? window.LMLanding() : {};
    const t = keptTouch(l);
    if (t) l = Object.assign({}, l, { touch: t });
    return l;
  },

  /* What the server needs to match its copy of the Purchase to the same shopper: none of these
     is derivable server-side, so the order POST carries them. */
  signals() {
    const out: Signals = {};
    const c = scid(); if (c) out.scid = c;
    const k = snapClickId(); if (k) out.sccid = k;
    const p = fbp(); if (p) out.fbp = p;
    const b = fbc(); if (b) out.fbc = b;
    const g = gaIds();
    if (g.gcid) out.gcid = g.gcid;
    if (g.gsid) out.gsid = g.gsid;
    const v = vid(); if (v) out.vid = v;
    return out;
  },

  /* v315: the checkout's phone, once it is complete — hashed exactly as the Purchase hashes
     it, kept for this tab only */
  notePhone(raw) {
    hashPhone(raw).then((h) => {
      if (isHash(h)) { try { sessionStorage.setItem("lm_ph_typed", h); } catch { /* nothing */ } }
    }).catch(() => {});
  },
};

/* ---------- on load, in pixel.js's order ---------- */

/* v2 of the kept phone: the old key held a hash of the number as typed, which matched nobody */
try {
  if (localStorage.getItem("lm_snap_ph") !== null) localStorage.removeItem("lm_snap_ph");
} catch { /* nothing */ }

stashClickId();
holdForFbp();

/* The inline snippets already fired PAGE_VIEW / PageView through the pixels and left their
   dedup ids behind: relay the same ids so the server twins are counted when a pixel is
   blocked, and discarded when it isn't. */
try {
  if (window.__lmPageView) relay("PAGE_VIEW", { client_dedup_id: window.__lmPageView });
} catch { /* nothing */ }
try {
  if (window.__lmFbPageView) fbRelay("PageView", {}, window.__lmFbPageView);
} catch { /* nothing */ }

keepTouch();

/* GA4 starts with the other libraries (lmLater), once the catalogue — which carries its id —
   has answered */
try {
  const gaGo = () => {
    const lm = LM();
    const r = lm && lm.ready;
    if (r && r.then) r.then(gaStart, gaStart); else gaStart();
  };
  if (typeof window.lmLater === "function") window.lmLater(gaGo); else gaGo();
} catch { /* nothing */ }

window.LMPX = LMPX;
