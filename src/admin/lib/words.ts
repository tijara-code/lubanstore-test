/**
 * THE PANEL'S VOCABULARY — the English for every status, payment state, origin, market and
 * refusal code the API answers with. One table each, so the list, the detail, the filters and
 * the toasts never call one thing two names.
 */
import type { OrderListRow, ShipmentSummary } from "../../shared/admin/api";
import { ApiError, isApiError } from "../data/api";

export const STATUS: Record<string, string> = {
  pending: "Awaiting payment",
  new: "New",
  prep: "Preparing",
  ship: "Shipped",
  done: "Delivered",
  void: "Cancelled",
};

export const PAYSTAT: Record<string, { t: string; c: string }> = {
  paid: { t: "Paid", c: "paid" },
  unpaid: { t: "Unpaid", c: "unpaid" },
  cancelled: { t: "Payment cancelled", c: "void" },
  cod: { t: "Cash on delivery", c: "cod" },
  refunded: { t: "Refunded", c: "refunded" },
};

/** where an order came from, in a word under its number (v211) */
export const ORIGIN_WORD: Record<string, string> = {
  meta: "Meta ad",
  instagram: "Instagram",
  facebook: "Facebook",
  snapchat: "Snapchat",
  tiktok: "TikTok",
  google: "Google",
  whatsapp: "WhatsApp",
  whatsapp_order: "WhatsApp (typed in)",
  referral: "Other site",
  direct: "Direct",
  unknown: "",
};
export const originWord = (o: string | null | undefined) => (o ? (ORIGIN_WORD[o] ?? o) : "");

/** what a courier would need and the order lacks (shared/orders/phone checkOf) */
export const CHECK_WORD: Record<string, string> = { name: "name", phone: "phone digits", city: "city", area: "area", sku: "Empower SKU" };

/** the markets, in the panel's English (code-owned, not shopper copy) */
export const COUNTRY_EN: Record<string, string> = {
  OM: "Oman",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  QA: "Qatar",
  KW: "Kuwait",
  BH: "Bahrain",
};
export const MARKETS = ["OM", "AE", "SA", "QA", "KW", "BH"] as const;

export function payWord(pay: string | null | undefined): string {
  return pay === "card" ? "Card" : pay === "transfer" ? "Bank transfer / pay link" : "Cash on delivery";
}

/* ---------------- the order status in Empower's words (v446) ---------------- */

export const EMP_STATUS = [
  "New Order", "In Consolidation", "Consolidated", "In Picking", "In Packing", "Picked", "Packed", "Ready To Ship",
  "Shipped", "Delivered", "Partially Delivered", "On Hold", "Cancelled", "Return In Progress", "Return To Origin",
];
export const EMP_PILL: Record<string, string> = {
  "Awaiting Payment": "pending", "New Order": "new",
  "In Consolidation": "prep", Consolidated: "prep", "In Picking": "prep", "In Packing": "prep",
  Picked: "prep", Packed: "prep", "Ready To Ship": "prep",
  Shipped: "ship", Delivered: "done", "Partially Delivered": "done", "On Hold": "pending",
  Cancelled: "void", "Return In Progress": "void", "Return To Origin": "void",
};

const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Omniful's own word (snake_case or spaced) → one of the fifteen; a new word shows as itself. */
export function empWord(raw: unknown): string {
  const s = String(raw || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  for (const w of EMP_STATUS) if (w.toLowerCase() === s) return w;
  if (/partial/.test(s)) return "Partially Delivered";
  if (/return(ed)? to origin|\brto\b/.test(s)) return "Return To Origin";
  if (/return/.test(s)) return "Return In Progress";
  if (/undeliver|not delivered|fail/.test(s)) return title(s);
  if (/^delivered\b|\bdelivered$/.test(s)) return "Delivered";
  if (/hold/.test(s)) return "On Hold";
  if (/cancel/.test(s)) return "Cancelled";
  if (/ready/.test(s)) return "Ready To Ship";
  if (/^shipment created|^created/.test(s)) return "New Order";
  if (/picked ?up|\bshipped\b|transit|out for delivery|dispatch|with courier/.test(s)) return "Shipped";
  if (/consolidated/.test(s)) return "Consolidated";
  if (/consolidat/.test(s)) return "In Consolidation";
  if (/picking/.test(s)) return "In Picking";
  if (/packing/.test(s)) return "In Packing";
  if (/picked/.test(s)) return "Picked";
  if (/packed/.test(s)) return "Packed";
  if (/^new|created|confirm|pending|received|^sent to omniful/.test(s)) return "New Order";
  return title(s);
}

/** An Empower send that is still a parcel (one taken off — cancelled — is not). */
export function empowerOf(o: Pick<OrderListRow, "shipment"> | null | undefined): ShipmentSummary | null {
  const s = o && o.shipment;
  if (!s) return null;
  return /cancel/i.test(String(s.status || "")) ? null : s;
}

/** The status the Orders list shows: Empower's word for the order (v446); ours where it has none. */
export function empStatus(o: Pick<OrderListRow, "status" | "shipment">): string {
  if (o.status === "pending") return "Awaiting Payment";
  if (o.status === "void") return "Cancelled";
  const e = empowerOf(o);
  if (e) {
    if (e.deliveredAt) return "Delivered";
    const w = empWord(e.status);
    // a status the shop set by hand moves the word forward, never back
    const early = !w || w === "New Order" || EMP_PILL[w] === "prep";
    if (o.status === "done" && (early || w === "Shipped")) return "Delivered";
    if (o.status === "ship" && early) return "Shipped";
    if (w) return w;
  }
  if (o.status === "done") return "Delivered";
  if (o.status === "ship") return "Shipped";
  if (o.status === "prep") return e ? "New Order" : "In Packing";
  return "New Order";
}

/** The status filter's ticks: ours in Empower's words where they agree, Flagged last (v408). */
export const STATUS_FILTER: Array<{ value: string; label: string }> = [
  { value: "pending", label: "Awaiting Payment" },
  { value: "new", label: "New Order" },
  { value: "prep", label: "Preparing (In Packing…)" },
  { value: "ship", label: "Shipped" },
  { value: "done", label: "Delivered" },
  { value: "void", label: "Cancelled" },
  { value: "flagged", label: "Flagged" },
];

/* ---------------- refusals, in words ---------------- */

const SAY: Record<string, string> = {
  network: "Could not reach the server. Check the connection and try again.",
  unauthorised: "Your session ended. Sign in again.",
  forbidden: "The server refused a request from this page. Reload the panel.",
  not_configured: "Sign-in is not set up on the server (ADMIN_USER, ADMIN_PASSWORD and SESSION_SECRET).",
  server_error: "The server hit an error. It has been logged; try again.",
  too_large: "That is too much to send at once.",
  stale: "The order changed while you were looking at it. The list has been refreshed: check and try again.",
  moving_back: "That order is already further along. Moving it back needs a confirmation.",
  awaiting_payment: "Still waiting for the card payment. It cannot move until it is paid.",
  refunded: "The money went back on that order: it cannot be sent out again.",
  illegal_move: "That status change is not allowed from where the order is.",
  not_yours: "That move belongs to the courier or the payment, not the panel.",
  parcel_live: "That order has a live parcel.",
  no_such_order: "That order is not there any more.",
  name_required: "A name is required for the courier.",
  bad_phone: "Check the phone number: it is too short to dial.",
  nothing_to_update: "Nothing changed.",
  unavailable_here: "That item is not sold in this customer's country.",
  unpriced_item: "That item has no price set for this country.",
  unknown_item: "That item is not in the catalogue.",
  offer_closed: "That offer is closed.",
  cod_not_offered: "Cash on delivery is not offered in this market.",
  no_items: "An order needs at least one item.",
  bad_cod_amount: "That amount to collect is not a number.",
  cod_amount_not_cod: "An amount to collect is for unpaid cash orders only.",
  already_shipped: "Already shipped: what is in the box cannot change now.",
  parcel_booked: "The parcel is with Empower: take it off Empower before changing the items.",
  payment_open: "The customer's card page is open for the old total. Try again once it has expired.",
  stock_short: "Not enough stock for that.",
  card_payment_is_the_gateways: "A card order's payment is Thawani's to record, not the panel's.",
  paid_orders_cannot_be_deleted: "Paid orders are kept (accounting records): they can be binned, never deleted.",
  must_be_trashed_first: "Move it to the trash first.",
  no_name: "Add the customer's name.",
  no_city: "Add the city.",
  no_ids: "Pick at least one order.",
  bad_input: "Some of that was not accepted.",
  omniful_not_configured: "Omniful not connected. Add its API token on the server.",
  omniful_no_hub: "Add the Omniful hub code on the server first.",
  omniful_duplicate: "Omniful already has an order with that number.",
  omniful_unsure: "Omniful did not answer. It may have taken the order: the next push checks and records it.",
  omniful_unreachable: "Omniful could not be reached. Nothing was sent.",
  sku_not_set: "Some items have no Empower SKU code (Empower tab › SKU codes).",
  already_delivered: "Omniful has delivered it: nothing to take off.",
  too_many_attempts: "Too many attempts. Try again in 15 minutes.",
  bad_credentials: "Wrong username or password",
};

const START: Record<string, string> = {
  database_url_missing:
    "The server could not start: DATABASE_URL is not set. Get it from Supabase › Connect › Transaction pooler (it needs the database password, not an API key), add it on Netlify under Site configuration › Environment variables, then redeploy. The first start then creates the tables and copies the current store's data by itself.",
  database_unreachable:
    "The server could not reach the database: DATABASE_URL is set but the connection was refused (wrong password, wrong host, or the project is paused). Check it in Supabase › Connect › Transaction pooler, then redeploy.",
  setup_failed:
    "The server could not finish its first-run setup (creating the tables and copying the current store's data). The reason is in Netlify › Logs › Functions › api; nothing half-done was left behind, and the next request tries again.",
  fake_in_production: "The server could not start: SERVICES_MODE=fake is not allowed on the live site. Remove it, then redeploy.",
};

/**
 * When the panel cannot talk to the server at all, WHY, in a sentence — or null for any other
 * refusal. Said on the sign-in gate, so the owner sees the cause rather than a bare "could not
 * reach": no connection, no API behind this address, or a server that could not start.
 */
export function serverProblem(e: unknown): string | null {
  if (!isApiError(e)) return null;
  const x = e.extra;
  if (e.code === "network") return SAY.network!;
  if (e.code === "not_api")
    return (
      "The admin API did not answer at this address (HTTP " + e.status + "). Open the panel through the running site — npm run dev, then http://localhost:8888/admin/ — or your Netlify site's /admin/. Opening the HTML file, or another static server, has no API behind it."
    );
  if (e.code === "server_unavailable") {
    const why = START[String(x.reason)];
    if (why) return why;
    if (x.reason === "config_refused" && Array.isArray(x.vars) && x.vars.length)
      return "The server could not start: a setting was refused (" + x.vars.join(", ") + "). Check its value against docs/ENV.md, then restart or redeploy.";
    return "The server could not start. The reason is in the server's log (Netlify › Logs › Functions › api, or the npm run dev window).";
  }
  return null;
}

/** A refusal in a sentence: the table above, plus the server's own detail where it has one. */
export function explain(e: unknown, fallback = "Something went wrong"): string {
  const down = serverProblem(e);
  if (down) return down;
  if (e instanceof ApiError) {
    let s = SAY[e.code];
    const x = e.extra;
    if (e.code === "stock_short" && x.item) s = "Not enough stock for " + String(x.item) + (x.left != null ? " (" + String(x.left) + " left)" : "") + ".";
    if (e.code === "parcel_booked" && x.awb) s = "The parcel is booked (" + String(x.awb) + "): take it off Empower before changing the items.";
    if (e.code === "bad_input" && Array.isArray(x.issues) && x.issues.length) {
      const first = x.issues[0] as { path?: string; message?: string };
      s = "Not accepted: " + [first.path, first.message].filter(Boolean).join(" — ");
    }
    if (!s && /^omniful_/.test(e.code) && x.detail) s = "Omniful: " + String(x.detail);
    if (!s) s = e.code.replace(/_/g, " ") + (x.detail ? ": " + String(x.detail) : "");
    else if (x.detail && /^omniful_|^sku_not_set$/.test(e.code) && e.code !== "omniful_unsure") s += " (" + String(x.detail).slice(0, 160) + ")";
    return s;
  }
  return (e as Error)?.message || fallback;
}
