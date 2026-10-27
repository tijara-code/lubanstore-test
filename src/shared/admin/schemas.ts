/**
 * THE ADMIN API'S INPUTS — one zod schema per body and query, shared by the server (which
 * validates every request with them: 400 `bad_input` with the issues summarised) and the
 * admin SPA (which may validate a form before sending it, and takes its request types from
 * here, so the two can never disagree about a field's name or limit).
 *
 * Query strings arrive as text: the `q*` helpers read "1"/"true"/"0"/"false" and numbers.
 * Unknown body keys are dropped (zod's default), never stored.
 */
import { z } from "zod";

/* ---------------- shared pieces ---------------- */

export const ORDER_ID_RE = /^LM-\d{4,12}$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** catalogue ids (sizes, scents, add-ons, price keys): a slug, never markup */
export const CAT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** a colour the storefront writes into a style: a plain hex colour only */
export const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
/** a dismissible warning code: "warn:omniful_hook_unsigned", "stale:empower-poll", "schema:14" */
export const WARNING_CODE_RE = /^[a-z]+:[\w:.-]{1,80}$/;

export const PANEL_STATUSES = ["new", "prep", "ship", "done", "void"] as const;
export const ORDER_STATUSES = ["pending", "new", "prep", "ship", "done", "void"] as const;
export const PAYMENT_STATES = ["unpaid", "paid", "cod", "refunded", "cancelled"] as const;
export const PAY_METHODS = ["cod", "card", "transfer"] as const;
export const COURIER_ROUTES = ["omniful", "manual"] as const;

const orderId = z.string().regex(ORDER_ID_RE, "an order number (LM-…)");
const day = z.string().regex(DAY_RE, "a day (YYYY-MM-DD)");
const ids = z.array(orderId).min(1).max(200);

/** "1" | "true" → true, "0" | "false" → false; anything else is refused */
const qBool = z.preprocess((v) => (v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : v), z.boolean());
const qInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const text = (max: number) => z.string().max(max);

/* ---------------- session ---------------- */

export const LoginBody = z.object({
  user: text(120),
  password: text(200),
});

export const LogoutBody = z.object({
  /** sign every browser out (sessions issued before now stop working) */
  everywhere: z.boolean().optional(),
});

/* ---------------- orders ---------------- */

export const OrdersQuery = z.object({
  /** one status or several, comma separated */
  status: z
    .string()
    .max(80)
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(ORDER_STATUSES)).max(6))
    .optional(),
  pay: z.enum(PAY_METHODS).optional(),
  payment: z.enum(PAYMENT_STATES).optional(),
  country: z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()).optional(),
  origin: text(40).optional(),
  flagged: qBool.optional(),
  /** "0" (default): the working list; "1": the bin only; "all": both */
  trash: z.enum(["0", "1", "all"]).optional(),
  from: day.optional(),
  to: day.optional(),
  q: text(80).optional(),
  limit: qInt(1, 500).optional(),
  offset: qInt(0, 1_000_000).optional(),
  /** the `tag` of the last answer: the same list again answers { unchanged: true } */
  since: text(40).optional(),
});

export const OrderDetailQuery = z.object({
  /** include the raw gateway payload (asked for when its box is opened) */
  gateway: qBool.optional(),
});

export const CustomerBody = z
  .object({
    name: text(120),
    phone: text(40),
    email: text(120),
    city: text(80),
    region: text(120),
    note: text(500),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "name at least one field");

export const ItemLine = z.object({
  itemId: z.string().min(1).max(80),
  qty: z.number().int().min(1).max(99),
});

export const ItemsBody = z.object({
  items: z.array(ItemLine).min(1).max(40),
  /** the Empower tab's "adjust before push": sold out allowed, no shelf cap */
  manual: z.boolean().optional(),
  /** the cash figure agreed with the customer (unpaid cash orders only; "" = the catalogue's) */
  codAmount: z.union([z.string().max(20), z.number()]).optional(),
});

export const StatusBody = z.object({
  to: z.enum(PANEL_STATUSES),
  /** a person who was told: moving back, or abandoning a live parcel */
  force: z.boolean().optional(),
  /** manual shipping: written with a move to "ship" */
  tracking: text(80).optional(),
  carrier: text(60).optional(),
});

export const TrackingBody = z.object({
  tracking: text(80),
  carrier: text(60).optional(),
  /** also move the order to Shipped */
  ship: z.boolean().optional(),
});

export const PaymentBody = z.object({ to: z.enum(["cod", "paid"]) });
export const FlagBody = z.object({ on: z.boolean() });
export const NoteBody = z.object({ note: text(500) });

export const BulkBody = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), ids, to: z.enum(PANEL_STATUSES), force: z.boolean().optional(), tracking: text(80).optional(), carrier: text(60).optional() }),
  z.object({ op: z.literal("flag"), ids, on: z.boolean() }),
  z.object({ op: z.literal("note"), ids, note: text(500) }),
  z.object({ op: z.literal("payment"), ids, to: z.enum(["cod", "paid"]) }),
  z.object({ op: z.literal("trash"), ids }),
  z.object({ op: z.literal("restore"), ids }),
  /** permanent: binned, never-paid orders only */
  z.object({ op: z.literal("purge"), ids }),
]);

export const ManualOrderBody = z.object({
  name: text(120),
  phone: text(40),
  email: text(120).optional(),
  countryCode: z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()),
  city: text(80),
  region: text(120).optional(),
  note: text(500).optional(),
  items: z.array(ItemLine).min(1).max(40),
  /** "cod": collected by the courier; "transfer": paid outside the gateway */
  pay: z.enum(["cod", "transfer"]).optional(),
  codAmount: z.union([z.string().max(20), z.number()]).optional(),
  /** one per filled form: the same form sent twice is one order */
  dedupeId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/).optional(),
});

export const ManualQuoteBody = ManualOrderBody.partial({ name: true, phone: true, city: true });

export const OptionsQuery = z.object({
  country: z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()),
});

/* ---------------- customers ---------------- */

export const CustomersQuery = z.object({
  q: text(80).optional(),
  country: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  sort: z.enum(["last", "spend", "orders"]).optional(),
  limit: qInt(1, 500).optional(),
  offset: qInt(0, 1_000_000).optional(),
});

export const CrmBody = z.object({
  note: text(1000).optional(),
  tags: z.array(text(40)).max(20).optional(),
});

/* ---------------- payments ---------------- */

const msOrDay = z.union([z.coerce.number().int().min(0), day]);

export const PaymentsQuery = z.object({
  limit: qInt(1, 100).optional(),
  skip: qInt(0, 100_000).optional(),
  /** how many gaps to ask Thawani about: 0 = none (the quiet refresh), absent = up to 12 */
  lookups: qInt(0, 12).optional(),
  /** ms since epoch, or a Muscat day (inclusive) */
  from: msOrDay.optional(),
  to: msOrDay.optional(),
});

const paymentId = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);
export const RefundBody = z.object({ paymentId, reason: z.string().trim().min(3).max(300) });
export const MarkPaidBody = z.object({ id: orderId, paymentId, acceptAmount: z.boolean().optional() });

/* ---------------- Empower ---------------- */

export const PushBody = z.object({
  id: orderId,
  /** from the Orders tab: any market */
  any: z.boolean().optional(),
  /** send under a fresh id (after a take-off) */
  fresh: z.boolean().optional(),
  /** Omniful already has it: record it rather than send */
  adopt: z.boolean().optional(),
});
export const PushManyBody = z.object({ ids });
export const AutoBody = z.object({ on: z.boolean() });
export const TakeOffBody = z.object({ id: orderId, markOnly: z.boolean().optional() });
export const SkusBody = z.object({ skus: z.record(z.string().max(60), z.union([z.string().max(80), z.number()])) });
export const SkuMatchBody = z.object({ skus: z.record(z.string().max(60), z.string().max(80)).optional() });
export const RouteBody = z.object({ courier: z.enum(COURIER_ROUTES) });
export const StockQuery = z.object({ fresh: qBool.optional() });
export const PushedQuery = z.object({ limit: qInt(1, 1000).optional() });

/* ---------------- catalogue ---------------- */

const catItem = z.looseObject({
  id: z.string().regex(CAT_ID_RE, "a plain id (letters, digits, - and _)"),
  accent: z.union([z.string().regex(HEX_RE, "a hex colour"), z.literal("")]).optional(),
  tagColor: z.union([z.string().regex(HEX_RE, "a hex colour"), z.literal("")]).optional(),
});
const price = z.looseObject({ now: z.number().min(0).max(1_000_000), was: z.number().min(0).max(1_000_000).nullish() });
const country = z.looseObject({
  code: z.string().regex(/^[A-Z]{2}$/),
  cur: z.string().regex(/^[A-Z]{3}$/),
  dial: z.string().regex(/^\d{1,4}$/),
  prices: z.record(z.string().regex(CAT_ID_RE), price).optional(),
  sizes: z.array(catItem).max(60).optional(),
  scents: z.array(catItem).max(60).optional(),
  extras: z.array(catItem).max(60).optional(),
});

/** The catalogue as the panel publishes it: open (old keys survive), with the fields the page renders checked. */
export const CatalogueData = z.looseObject({
  countries: z.array(country).min(1).max(40),
  sizes: z.array(catItem).max(60),
  scents: z.array(catItem).max(60),
  extras: z.array(catItem).max(60).optional(),
  offer: z.looseObject({}).optional(),
  tiers: z.looseObject({}).optional(),
  freeShip: z.looseObject({}).optional(),
});

export const PublishBody = z.object({
  /**
   * the catalogue. Restart requests ride inside it and are never stored:
   * offer.anchorReset, offer.freeShipReset, tiers.anchorReset, freeShip.countries.XX.restart
   */
  data: z.unknown(),
  /** the row version the panel loaded (0 = nothing published yet) */
  version: z.number().int().min(0),
  /** the `editTag` the panel loaded: another publish that changed only routes is not a conflict */
  editTag: z.string().max(64).optional(),
});

export const RestoreBody = z.object({
  version: z.number().int().min(0),
  editTag: z.string().max(64).optional(),
  /** named back, so a stray click cannot discard every price */
  confirm: z.literal("defaults"),
});

export const StockSwitchesBody = z
  .object({
    stockLive: z.boolean(),
    stockCap: z.record(z.string().regex(CAT_ID_RE), z.boolean()),
    stockHide: z.record(z.string().regex(CAT_ID_RE), z.boolean()),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "name at least one switch");

/* ---------------- analytics ---------------- */

export const SummaryQuery = z.object({
  /** today | 7 | 30 | 90 | all */
  range: z.string().regex(/^(today|all|\d{1,3})$/).optional(),
  from: day.optional(),
  to: day.optional(),
  country: z.string().max(2).optional(),
  platform: text(20).optional(),
  paid: z.enum(["paid", "unpaid", ""]).optional(),
});

export const BusyQuery = SummaryQuery.extend({
  weekday: z.union([z.literal("every"), qInt(0, 6)]).optional(),
  metric: z.enum(["visits", "orders"]).optional(),
});

export const LiveQuery = z.object({ minutes: z.union([z.literal("today"), qInt(1, 1440)]).optional() });

export const ErrorsQuery = z.object({
  days: qInt(1, 60).optional(),
  side: z.enum(["server", "browser", ""]).optional(),
  full: qBool.optional(),
});

export const ChangesQuery = z.object({ winDays: qInt(1, 90).optional(), limit: qInt(1, 2000).optional() });
export const ClearChangesBody = z.object({ confirm: z.literal("changes") });
export const ResetAnalyticsBody = z.object({ confirm: z.literal("events") });

/* ---------------- settings, audit, jobs ---------------- */

export const UiBody = z
  .object({
    /** the pages to hide (Overview never is; unknown names are dropped) */
    hidden: z.array(text(40)).max(50),
    /** the Overview warnings dismissed, by code */
    dismissed: z.array(text(120)).max(400),
  })
  .partial();

export const AuditQuery = z.object({ days: qInt(1, 180).optional(), limit: qInt(1, 5000).optional() });

export const JobParam = z.object({ name: z.string().regex(/^[a-z0-9-]{1,40}$/) });

export type LoginBody = z.infer<typeof LoginBody>;
export type OrdersQuery = z.input<typeof OrdersQuery>;
export type CustomerBody = z.infer<typeof CustomerBody>;
export type ItemsBody = z.infer<typeof ItemsBody>;
export type StatusBody = z.infer<typeof StatusBody>;
export type TrackingBody = z.infer<typeof TrackingBody>;
export type BulkBody = z.infer<typeof BulkBody>;
export type ManualOrderBody = z.input<typeof ManualOrderBody>;
export type CrmBody = z.infer<typeof CrmBody>;
export type RefundBody = z.infer<typeof RefundBody>;
export type MarkPaidBody = z.infer<typeof MarkPaidBody>;
export type PushBody = z.infer<typeof PushBody>;
export type PublishBody = z.infer<typeof PublishBody>;
export type RestoreBody = z.infer<typeof RestoreBody>;
export type StockSwitchesBody = z.infer<typeof StockSwitchesBody>;
export type UiBody = z.infer<typeof UiBody>;
