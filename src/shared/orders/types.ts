/** Shapes stored on an order and shared by the server, the admin and the storefront. */

/** A priced basket line, as the till writes it. */
export interface OrderLine {
  itemId: string;
  /** the Arabic name (scent, set, offer or add-on) */
  scent: string;
  /** the Arabic size words / set note / offer mix */
  size: string;
  /** unit price in the order's currency */
  price: number;
  /** unit reference price (struck-through) */
  was?: number;
  qty: number;
  [k: string]: unknown;
}

/** Source / medium / campaign in the shop's UTM standard (see shared/utm). */
export interface Attribution {
  source: string;
  medium: string;
  campaign?: string;
  content?: string;
  term?: string;
  cid?: string;
  /** how it was decided: utm | click_id | referrer | direct | panel | … */
  how: string;
  /** the 90-day last non-direct touch was used */
  carried?: boolean;
}

/** What a server-side Purchase needs to match the shopper (never raw PII beyond the order's own). */
export interface ClientSignals {
  ip?: string;
  ua?: string;
  url?: string;
  fbp?: string;
  fbc?: string;
  scid?: string;
  sccid?: string;
  gcid?: string;
  gsid?: string;
  vid?: string;
  [k: string]: unknown;
}

/** Thawani's own payloads kept verbatim on a card order. */
export interface GatewayRecord {
  mode?: string;
  created_at?: string;
  session?: unknown;
  verified_at?: string;
  paid_session?: unknown;
  payment?: unknown;
  [k: string]: unknown;
}
