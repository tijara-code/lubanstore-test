/**
 * The catalogue: the one JSON document the admin publishes and every price, label
 * and availability rule reads. Stored as `settings.data` (one row) and bundled as
 * `data/catalogue.json` (the deploy's defaults and code-owned fields).
 *
 * Shapes are deliberately open (`[k: string]: unknown`): a catalogue published by an
 * older panel carries keys the code no longer writes, and they must survive a save.
 */

export interface Price {
  now: number;
  was?: number;
  [k: string]: unknown;
}

export interface Size {
  id: string;
  name: string;
  name_en?: string;
  weight?: string;
  weight_en?: string;
  tag?: string;
  tag_en?: string;
  /** off the store and the till, kept in the panel (still packs a bundle) */
  hidden?: boolean | "true";
  /** sold out in this market */
  soldOut?: boolean | "true";
  open?: boolean;
  [k: string]: unknown;
}

export interface Scent {
  id: string;
  name: string;
  name_en?: string;
  notes?: string;
  notes_en?: string;
  accent?: string;
  /** code-owned: the drawing the scent renders with */
  art?: string;
  active?: boolean;
  soldOut?: boolean | "true";
  /** out in these sizes only */
  soldOutSizes?: string[];
  [k: string]: unknown;
}

export interface Extra {
  id: string;
  name: string;
  name_en?: string;
  note?: string;
  note_en?: string;
  img?: string;
  /** code-owned */
  art?: string;
  /** code-owned: false = its value does not count toward free delivery */
  countsFree?: boolean;
  once?: boolean;
  active?: boolean;
  soldOut?: boolean | "true";
  [k: string]: unknown;
}

export interface Country {
  code: string;
  name: string;
  name_en?: string;
  flag?: string;
  dial: string;
  cur: string;
  dec?: number;
  /** code-owned OMR conversion rate */
  toOmr?: number;
  ship?: number;
  freeOver?: number | null;
  /** cash-on-delivery fee in the market's currency */
  cod?: number;
  /** cash on delivery offered here (absent = offered) */
  codOn?: boolean;
  prices?: Record<string, Price>;
  sizes?: Size[];
  scents?: Scent[];
  extras?: Extra[];
  /** legacy per-country switches: { sizes: [...], scents: [...] } */
  off?: { sizes?: string[]; scents?: string[]; [k: string]: unknown };
  /** fulfilment route for the market: "omniful" (Empower) or "manual" */
  courier?: string;
  [k: string]: unknown;
}

export interface Offer {
  id?: string;
  active?: boolean;
  badge?: string;
  badge_en?: string;
  term?: string;
  term_en?: string;
  name?: string;
  name_en?: string;
  note?: string;
  note_en?: string;
  /** window length in hours (or `repeat`, the older word) */
  hours?: number;
  unit?: string;
  repeat?: string;
  /** "once" = one window from the anchor; "auto" = rolling */
  renew?: string;
  anchor?: string;
  startsAt?: string;
  endsAt?: string;
  until?: string;
  /** the size the set is packed from */
  sizeId?: string;
  /** markets it is offered in (empty = all) */
  countries?: string[];
  /** the set's size is sold only inside the set */
  only?: boolean;
  /** the set ships free whatever the basket total */
  freeShip?: boolean;
  freeShipIn?: string[];
  freeShipHours?: number;
  freeShipUnit?: string;
  freeShipAnchor?: string;
  freeShipRenew?: string;
  [k: string]: unknown;
}

export interface Tiers {
  active?: boolean;
  sizeId?: string;
  hours?: number;
  unit?: string;
  renew?: string;
  anchor?: string;
  startsAt?: string;
  endsAt?: string;
  countries?: string[];
  clock?: boolean;
  [k: string]: unknown;
}

export interface FreeShipRow {
  on?: boolean;
  over?: number | string | null;
  from?: string;
  days?: number | string;
  [k: string]: unknown;
}

export interface FreeShip {
  active?: boolean;
  countries?: Record<string, FreeShipRow>;
  [k: string]: unknown;
}

export interface Catalogue {
  version?: number;
  countries: Country[];
  sizes: Size[];
  scents: Scent[];
  extras?: Extra[];
  offer?: Offer;
  /** retired large set; always dropped on read */
  offer2?: Offer;
  tiers?: Tiers;
  freeShip?: FreeShip;
  /** per-item "cap at stock" switches: { "oud-small": true } */
  stockCap?: Record<string, boolean>;
  /** per-item "hide at 0" switches */
  stockHide?: Record<string, boolean>;
  /** the "pieces left" counter */
  stockLive?: boolean;
  /** storefront rating shown as leaves (e.g. 4.78) */
  rating?: number;
  /** panel-only operational settings; never served publicly */
  ledger?: Record<string, unknown>;
  courier?: Record<string, unknown>;
  analytics?: { ga4?: string; mp?: boolean };
  [k: string]: unknown;
}
