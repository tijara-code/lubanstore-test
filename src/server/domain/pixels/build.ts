/**
 * One server event, shaped for each platform (port of pixels/meta.js build and pixels/snap.js
 * build). The hashed identifiers come from the one set of normalisers (shared/pixels/identity),
 * so Meta and Snap are told the same person, and the page hashes the same way.
 */
import { compact, hashedUser, isHash, type PixelUser } from "../../../shared/pixels/identity";

export interface EventItem {
  id: string;
  qty?: number | null;
  price?: number | null;
  brand?: string;
}

/** What a caller says about one event; each builder shapes it for its platform. */
export interface EventSpec {
  name: string;
  /** the dedup id: the pixel's eventID / client_dedup_id (the order id for a Purchase) */
  id: string;
  /** ms */
  time: number;
  url?: string;
  currency?: string;
  value?: number | null;
  /** Purchase: the order id (30-day window on both platforms) */
  orderId?: string;
  category?: string;
  contentName?: string;
  items?: EventItem[];
  numItems?: number | null;
  user?: PixelUser;
  /** Snap's own cookie and click id */
  scid?: string;
  sccid?: string;
  /** from the request (or the order's captured client): never what the page claims */
  request?: { client_ip_address?: string; client_user_agent?: string };
  optOut?: boolean;
  /** Meta's data processing options ([] = none, said explicitly) */
  dpo?: string[];
  dpoState?: number;
  dpoCountry?: number;
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : undefined;
};

/** Meta v21.0: fbp/fbc/IP/UA raw (hashing them destroys them), everything else hashed. */
export async function metaEvent(spec: EventSpec): Promise<Record<string, unknown>> {
  const u = spec.user || {};
  const req = spec.request || {};
  const user = compact({
    ...(await hashedUser(u)),
    fbp: u.fbp as string | undefined,
    fbc: u.fbc as string | undefined,
    subscription_id: u.subscriptionId as string | undefined,
    client_ip_address: req.client_ip_address,
    client_user_agent: req.client_user_agent,
  });
  const items = spec.items || [];
  const out: Record<string, unknown> = compact({
    event_name: spec.name,
    event_time: Math.floor(spec.time / 1000),
    event_id: spec.id,
    event_source_url: spec.url,
    action_source: "website",
    opt_out: spec.optOut === true,
    user_data: user,
    custom_data: compact({
      currency: spec.currency,
      value: spec.value != null ? Number(spec.value) : undefined,
      order_id: spec.orderId,
      content_type: items.length ? "product" : undefined,
      content_category: spec.category,
      content_name: spec.contentName,
      content_ids: items.map((i) => i.id).filter(Boolean),
      contents: items.map((i) => compact({ id: i.id, quantity: Number(i.qty || 1), item_price: i.price != null ? Number(i.price) : undefined })),
      num_items: spec.numItems != null ? Number(spec.numItems) : undefined,
    }),
  });
  /* set AFTER compact, deliberately: an explicit empty array is Meta's documented "no processing
     restrictions" — not the same as omitting it — and compact() drops empty arrays */
  const dpo = Array.isArray(spec.dpo) ? spec.dpo : [];
  out.data_processing_options = dpo;
  if (dpo.length) {
    out.data_processing_options_state = Number(spec.dpoState || 0);
    out.data_processing_options_country = Number(spec.dpoCountry || 0);
  }
  return out;
}

/** a browser-supplied hash only ever passes through if it IS one */
function snapUser(spec: EventSpec): PixelUser {
  const u: PixelUser = { ...(spec.user || {}) };
  if (u.phoneHash != null && !isHash(u.phoneHash)) delete u.phoneHash;
  if (u.emailHash != null && !isHash(u.emailHash)) delete u.emailHash;
  /* Meta's cookies are never Snap's */
  delete u.fbp; delete u.fbc;
  return u;
}

/**
 * Snap v3: the same hashed identifiers, plus Snap's own cookie and click id. Names differ from
 * the pixel's (item_ids → content_ids, item_category → content_category, transaction_id →
 * order_id); numbers as numbers, except num_items, which Snap types as a string.
 */
export async function snapEvent(spec: EventSpec): Promise<Record<string, unknown>> {
  const items = spec.items || [];
  return compact({
    event_name: spec.name,
    event_time: Math.floor(spec.time / 1000),
    event_id: spec.id,
    action_source: "WEB",
    event_source_url: spec.url,
    user_data: compact({
      ...(await hashedUser(snapUser(spec))),
      sc_cookie1: spec.scid,
      sc_click_id: spec.sccid,
      ...(spec.request || {}),
    }),
    custom_data: compact({
      currency: spec.currency,
      value: num(spec.value),
      order_id: spec.orderId,
      content_category: spec.category,
      content_ids: items.map((i) => i.id).filter(Boolean),
      contents: items.map((i) => compact({ id: i.id, quantity: num(i.qty) || 1, item_price: num(i.price), brand: i.brand })),
      num_items: spec.numItems != null ? String(spec.numItems) : "",
    }),
  });
}
