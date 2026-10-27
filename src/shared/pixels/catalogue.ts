/**
 * THE EVENT CATALOGUE — every event the shop sends, in one table: its name on each platform,
 * where it fires, the id that lets the browser copy and the server copy count once, and the
 * user data the server copy carries (port of netlify/lib/pixels/catalogue.js). The relays'
 * allowlists, the first-party collector's allowlist and the storefront's pixel port all read
 * this; docs/EVENTS.md describes it.
 *
 * `side`: "browser" (pixel only), "server" (CAPI / Measurement Protocol only), "both" (pixel
 * plus a relayed server twin with the same id).
 */

export type PixelPlatform = "meta" | "snap" | "ga4" | "lm";

export interface PixelEvent {
  platform: PixelPlatform;
  name: string;
  side: "browser" | "server" | "both";
  when: string;
  id: string;
  user: readonly string[];
}

export const HASHED = ["em", "ph", "fn", "ln", "ct", "st", "country", "external_id"] as const;
export const META_RAW = ["fbp", "fbc", "client_ip_address", "client_user_agent"] as const;
export const SNAP_RAW = ["sc_cookie1", "sc_click_id", "client_ip_address", "client_user_agent"] as const;
/** the relayed twins: ph (when known) + vid + cc only — the relay rebuilds every event from an allowlist */
export const RELAY_USER = ["ph", "external_id (vid)", "country", "fbp/fbc or scid", "client_ip_address", "client_user_agent"] as const;

export const EVENTS: readonly PixelEvent[] = [
  /* ---- Meta ---- */
  { platform: "meta", name: "PageView", side: "both", when: "every page", id: "uuid made in the head script (__lmFbPageView)", user: RELAY_USER },
  { platform: "meta", name: "ViewContent", side: "both", when: "a size opened", id: "uuid per event, shared with Snap VIEW_CONTENT", user: RELAY_USER },
  { platform: "meta", name: "AddToCart", side: "both", when: "a box, offer or add-on added", id: "uuid per event, shared with Snap ADD_CART", user: RELAY_USER },
  { platform: "meta", name: "InitiateCheckout", side: "both", when: "checkout page shown", id: "uuid per event, shared with Snap START_CHECKOUT", user: RELAY_USER },
  { platform: "meta", name: "AddPaymentInfo", side: "both", when: "a payment method chosen (once per method per page)", id: "uuid per event, shared with Snap ADD_BILLING", user: RELAY_USER },
  { platform: "meta", name: "Purchase", side: "both", when: "cash order placed; card order paid (return or webhook); card order switched to cash from the reminder link", id: "the order id (eventID = event_id = order id on every path)", user: [...HASHED, ...META_RAW] },
  /* ---- Snap ---- */
  { platform: "snap", name: "PAGE_VIEW", side: "both", when: "every page", id: "uuid made in the head script (__lmPageView)", user: RELAY_USER },
  { platform: "snap", name: "VIEW_CONTENT", side: "both", when: "a size opened", id: "as Meta ViewContent", user: RELAY_USER },
  { platform: "snap", name: "ADD_CART", side: "both", when: "a box, offer or add-on added", id: "as Meta AddToCart", user: RELAY_USER },
  { platform: "snap", name: "START_CHECKOUT", side: "both", when: "checkout page shown", id: "as Meta InitiateCheckout", user: RELAY_USER },
  { platform: "snap", name: "ADD_BILLING", side: "both", when: "a payment method chosen", id: "as Meta AddPaymentInfo", user: RELAY_USER },
  { platform: "snap", name: "PURCHASE", side: "both", when: "as Meta Purchase", id: "the order id (client_dedup_id = transaction_id = event_id)", user: [...HASHED, ...SNAP_RAW] },
  /* ---- GA4 ---- */
  { platform: "ga4", name: "view_item", side: "browser", when: "a size opened", id: "none (gtag)", user: ["client_id (the _ga cookie)"] },
  { platform: "ga4", name: "add_to_cart", side: "browser", when: "an item added", id: "none (gtag)", user: ["client_id"] },
  { platform: "ga4", name: "begin_checkout", side: "browser", when: "checkout page shown", id: "none (gtag)", user: ["client_id"] },
  { platform: "ga4", name: "add_payment_info", side: "browser", when: "a payment method chosen", id: "none (gtag)", user: ["client_id"] },
  { platform: "ga4", name: "purchase", side: "server", when: "as Meta Purchase (the browser sends it only when the server answers ga4:\"page\")", id: "transaction_id = order id; one send per order (claim ga4-<id>)", user: ["client_id (gcid)", "session_id (gsid)"] },
  /* ---- first-party (events table, /api/ev via /api/beacon) ---- */
  { platform: "lm", name: "page_view", side: "browser", when: "every page (item: home | checkout | privacy | 404)", id: "sid (per tab) + at", user: ["sid", "country (edge)", "city + point to ~10 km (edge; every lm event)"] },
  { platform: "lm", name: "session_start", side: "browser", when: "once per tab (item: source|medium|campaign, placed by the server)", id: "sid", user: ["sid", "country"] },
  { platform: "lm", name: "size_open", side: "browser", when: "a size opened", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "add_cart", side: "browser", when: "a box added", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "offer_add", side: "browser", when: "the bundle added", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "suggest_add", side: "browser", when: "the checkout bar's one-tap add", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "extra_add", side: "browser", when: "an add-on added", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "cart_open", side: "browser", when: "the drawer opened", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "checkout_view", side: "browser", when: "checkout page shown", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "pay_method", side: "browser", when: "a method chosen (item: card | cod)", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "order_placed", side: "browser", when: "the order accepted (item: card | cod)", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "whatsapp_click", side: "browser", when: "a WhatsApp link tapped (item: where)", id: "sid + at", user: ["sid"] },
  { platform: "lm", name: "track_lookup", side: "browser", when: "a tracking lookup", id: "sid + at", user: ["sid"] },
];

export function names(platform: PixelPlatform): string[] {
  return EVENTS.filter((e) => e.platform === platform).map((e) => e.name);
}

/** What /api/meta relays: the catalogue's Meta events, never Purchase (only the server reports a sale). */
export const META_RELAY: readonly string[] = names("meta").filter((n) => n !== "Purchase");
/** What /api/snap relays: never PURCHASE. */
export const SNAP_RELAY: readonly string[] = names("snap").filter((n) => n !== "PURCHASE");
/** What /api/ev records. */
export const LM_NAMES: readonly string[] = names("lm");

/** Every way a line gets into the basket: one "added to cart" step in the funnel and the items rank. */
export const ADD_TO_CART: Readonly<Record<string, 1>> = { add_cart: 1, offer_add: 1, suggest_add: 1, extra_add: 1 };
/** The names whose `item` the roll-up keeps (the adds and the landing). */
export const ITEM_KEPT: readonly string[] = ["add_cart", "offer_add", "suggest_add", "extra_add", "session_start"];

/** The event's own name from an allowlist, in the platform's casing ("addtocart" → "AddToCart"); "" when not allowed. */
export function pickName(list: readonly string[], want: unknown): string {
  const w = String(want == null ? "" : want).trim().slice(0, 24).toLowerCase();
  return list.filter((n) => n.toLowerCase() === w)[0] || "";
}

/** The shop's fixed words on every event. */
export const CURRENCY = "OMR";
export const CATEGORY = "incense";
export const BRAND = "Luban & Musk";
