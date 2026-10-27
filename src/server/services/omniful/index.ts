/**
 * OMNIFUL (Empower) — the fulfilment centre's API, and nothing else: the token and its
 * renewal, the pacing, one call, and the five calls the shop makes (create, cancel, get an
 * order; the SKU catalogue; the shelf). The decisions that use it live in
 * domain/empower; the wire's own vocabulary (paths, what an answer means, what a webhook
 * says) lives here so the client and the domain read Omniful the same way.
 *
 * THE TOKEN is read from the environment, never logged, never returned to the browser. The
 * panel is told whether one is set (state()), nothing more. With OMNIFUL_REFRESH_TOKEN +
 * OMNIFUL_CLIENT_ID + OMNIFUL_CLIENT_SECRET it renews itself a day before it expires (or on a
 * 401): their refresh tokens rotate, so the rotated pair is kept server-side (ops
 * `omniful_auth`, through the AuthStore the domain binds); a new refresh token pasted into
 * the environment later is recognised (by its hash) and wins.
 *
 * THE RATE LIMIT (60 a minute, published) is kept on our side: a bucket of 3 calls that
 * refills one a second, so a basket's few shelf reads go at once and a sweep keeps to the
 * rate. In fake mode the bucket is measured but never slept on (the fake world has no limit).
 */
import { createHash } from "node:crypto";
import { call as outbound, OutboundError, type FetchLike } from "../../core/outbound";
import type { ServiceContext } from "../context";
import type { Env } from "../../env";

export const HOSTS = { production: "https://prodapi.omniful.com", staging: "https://api.staging.omniful.com" } as const;
export const TOKEN_PATH = "/sales-channel/public/v1/token";
export const ORDER_PATH = "/sales-channel/public/v1/orders";
export const GET_ORDER_PATH = "/sales-channel/public/v1/seller/orders/";
export const SKUS_PATH = "/sales-channel/public/v2/seller/master/skus";
/** Get Seller Hub Inventory: rows { hub_code, sku_code, available_quantity, quantity_on_hand, … }, paged by page number */
export const INVENTORY_PATH = "/sales-channel/public/v1/seller/inventory/hubs/";
/** Get Inventory for SKU Across All Hubs: no hub code (the fallback when the hub code is refused) */
export const SKU_INVENTORY_PATH = "/sales-channel/public/v1/inventory/hubs/skus/";

export const MIN_GAP_MS = 1000;
export const BURST = 3;
const RENEW_BEFORE_MS = 24 * 3600e3;
/** after the hub code is refused for the inventory read, go per SKU for this long */
export const HUB_RETRY_MS = 6 * 3600e3;
export const AUTH_KEY = "omniful_auth";

/* ---------------- configuration ---------------- */

export function omnifulEnv(e: Pick<Env, "OMNIFUL_ENV">): "staging" | "production" {
  return String(e.OMNIFUL_ENV || "").trim().toLowerCase() === "staging" ? "staging" : "production";
}

export function omnifulBase(e: Pick<Env, "OMNIFUL_ENV" | "OMNIFUL_BASE">): string {
  const over = String(e.OMNIFUL_BASE || "").trim();
  return over ? over.replace(/\/+$/, "") : HOSTS[omnifulEnv(e)];
}

export interface OmnifulState {
  configured: boolean;
  env: "staging" | "production";
  base: string;
  /** "set" or "" — never the code */
  hub: "set" | "";
  renews: boolean;
  missing: string[];
}

/* ---------------- errors and words ---------------- */

export type OmnifulCode =
  | "omniful_not_configured"
  | "omniful_unreachable"
  | "omniful_rejected"
  | "omniful_throttled"
  | "omniful_auth_failed"
  | "omniful_no_hub"
  | "no_id";

export class OmnifulError extends Error {
  constructor(
    readonly code: OmnifulCode,
    message: string,
    readonly status: number | null = null,
    /** a 429 or 5xx: worth trying again later */
    readonly retryable = false,
    /** the request never left (nothing can have happened at Omniful) */
    readonly unsent = false,
  ) {
    super(message);
    this.name = "OmnifulError";
  }
}

/** Their words, wherever they put them — never "[object Object]". */
export function words(v: unknown, depth = 0): string {
  if (v == null || depth > 3) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => words(x, depth + 1)).filter(Boolean).join("; ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["message", "error", "errors", "detail", "description", "msg", "data"]) {
      const w = words(o[k], depth + 1);
      if (w) return w;
    }
    /* field-keyed validation errors: { order_id: ["has already been taken"] } */
    const parts = Object.keys(o)
      .map((k) => {
        const w = words(o[k], depth + 1);
        return w ? k.replace(/_/g, " ") + " " + w : "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
    if (!Object.keys(o).length) return "";
    try {
      return JSON.stringify(v).slice(0, 300);
    } catch {
      return "";
    }
  }
  return "";
}

export function explain(status: number, data: unknown): string {
  const said = words(data);
  if (said) return said.slice(0, 300);
  if (status === 401 || status === 403) return "Omniful refused the token — check OMNIFUL_API_TOKEN (or the refresh credentials)";
  if (status === 404) return "Omniful has no such endpoint or record";
  if (status === 429) return "Omniful is rate-limiting us — the sweep will pick this up next time";
  if (status >= 500) return "Omniful had an error at their end";
  return "Omniful refused the request (" + status + ")";
}

/* ---------------- what their answers mean ---------------- */

/** Their id for what we just created (NOT order_id — in their answers that is ours, echoed). */
export function refOf(data: unknown): string {
  const top = (data && typeof data === "object" ? data : {}) as Record<string, any>;
  const d = (top.data && typeof top.data === "object" ? top.data : top) as Record<string, any>;
  const v = d.omniful_order_id || d.id || d.reference || (d.order && (d.order.omniful_order_id || d.order.id)) || "";
  return typeof v === "string" || typeof v === "number" ? String(v).slice(0, 120) : "";
}

export interface ShelfRow {
  sku_code: string;
  available: number;
  onHand: number;
  hub?: string;
}

const SKU_KEYS = ["sku_code", "seller_sku_code", "sku", "code"];
const AVAIL_KEYS = ["available_quantity", "available_qty", "available", "available_inventory", "quantity_available", "sellable_quantity", "sellable_qty"];
const ONHAND_KEYS = ["quantity_on_hand", "on_hand_quantity", "on_hand_qty", "on_hand", "onhand_quantity", "total_quantity", "quantity"];

function pickKey(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) if (row && row[k] !== undefined && row[k] !== null) return k;
  return "";
}
function nested(r: Record<string, any>, keys: string[]): unknown {
  const k = pickKey(r, keys);
  if (k) return r[k];
  if (r.inventory && typeof r.inventory === "object") {
    const ik = pickKey(r.inventory, keys);
    if (ik) return r.inventory[ik];
  }
  return undefined;
}

/** One shelf row, read for the fields Omniful's screens use (and a few likely spellings). */
export function inventoryRow(r: unknown): ShelfRow | null {
  if (!r || typeof r !== "object") return null;
  const row = r as Record<string, any>;
  const inner = row.sku && typeof row.sku === "object" ? row.sku : null;
  const sk = pickKey(row, SKU_KEYS);
  const code = sk && typeof row[sk] !== "object" ? row[sk] : inner ? inner.sku_code || inner.code || inner.seller_sku_code : "";
  const n = Number(nested(row, AVAIL_KEYS));
  if (!code || (typeof code !== "string" && typeof code !== "number") || nested(row, AVAIL_KEYS) == null || !Number.isFinite(n)) return null;
  const hraw = nested(row, ONHAND_KEYS);
  const h = Number(hraw);
  const available = Math.max(0, Math.floor(n));
  return {
    sku_code: String(code).trim().slice(0, 120),
    available,
    onHand: hraw != null && Number.isFinite(h) ? Math.max(available, Math.floor(h)) : available,
  };
}

export interface HookNews {
  /** OUR id as sent (LM-…, or LM-…-2 after a re-send) */
  orderId: string;
  /** their id */
  ref: string;
  /** their status words, underscores spaced ("out for delivery") */
  status: string;
  awb: string;
  carrier: string;
}

function pick(...vals: unknown[]): string {
  for (const v of vals) {
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    /* an object where a string was expected: stringified, never trusted */
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return "";
}

/** What a webhook (or a Get Order answer) says, read defensively. */
export function readHook(payload: unknown): HookNews {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  const d = (p.data && typeof p.data === "object" ? p.data : p) as Record<string, any>;
  const o = (d.order && typeof d.order === "object" ? d.order : d) as Record<string, any>;
  const sh = (o.shipment && typeof o.shipment === "object" ? o.shipment : {}) as Record<string, any>;
  return {
    orderId: pick(o.order_id, o.seller_sales_channel_order_id, o.reference, o.external_id, o.order_reference).slice(0, 60),
    ref: pick(o.omniful_order_id, refOf(d)).slice(0, 120),
    status: pick(o.order_status, o.status, o.display_status, o.status_code, d.status, p.event_name, p.event).replace(/_/g, " ").slice(0, 60),
    awb: pick(o.awb_number, o.awb, o.tracking_number, sh.awb_number, sh.awb).slice(0, 60),
    carrier: pick(o.shipping_partner_name, o.shipping_partner, o.carrier, sh.shipping_partner_name, sh.shipping_partner).slice(0, 60),
  };
}

/* ---------------- the client ---------------- */

export interface AuthPair {
  access_token: string;
  refresh_token: string;
  /** hash of the refresh token the environment held when this pair was stored */
  seed: string;
  at: string;
}

/** Where a renewed pair is kept (ops `omniful_auth`); bound by the domain. */
export interface AuthStore {
  get(): Promise<AuthPair | null>;
  set(pair: AuthPair): Promise<void>;
}

export interface CallOpts {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
  /** absolute ms (the deps clock) by which the call must be done */
  deadline?: number;
}

export interface InventoryRead {
  rows: ShelfRow[];
  /** the first row's keys, for the panel when nothing could be read */
  fields: string[];
  perSku?: boolean;
  hubs?: string[];
  note?: string;
}

export interface CatalogueSku {
  sku_code: string;
  name: string;
  type: string;
  status: string;
}

export interface OmnifulClient {
  state(): OmnifulState;
  configured(): boolean;
  renews(): boolean;
  hub(): string;
  base(): string;
  /** the domain binds the ops-backed store here (an in-memory one until then) */
  auth: AuthStore;
  call(path: string, opts?: CallOpts): Promise<unknown>;
  /** Create Order. `body.order_id` is the id it is sent as. → their id */
  createOrder(body: Record<string, unknown>, opts?: { deadline?: number }): Promise<{ ref: string; raw: unknown }>;
  cancelOrder(sentId: string, reason: string, opts?: { deadline?: number }): Promise<unknown>;
  /** by THEIR id (the shipment row's reference) */
  getOrder(omnifulId: string, opts?: { deadline?: number }): Promise<unknown>;
  listSkus(maxPages?: number): Promise<CatalogueSku[]>;
  hubInventory(maxPages: number, skuCodes?: string[], opts?: { deadline?: number }): Promise<InventoryRead>;
  /** what pacing has made (or would have made, in fake mode) callers wait, ms */
  readonly waitedMs: number;
  /** forget the token, the pacing and the hub memo this instance holds */
  _reset(): void;
}

/** A JWT's own expiry (ms), 0 when it is not one. */
export function expOf(tok: string): number {
  try {
    const part = String(tok || "").split(".")[1];
    if (!part) return 0;
    const j = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return j && Number(j.exp) > 0 ? Number(j.exp) * 1000 : 0;
  } catch {
    return 0;
  }
}

export function seedOf(rt: string): string {
  return rt ? createHash("sha256").update(String(rt)).digest("hex").slice(0, 16) : "";
}

/** The pacing bucket: BURST calls at once, then one a MIN_GAP_MS. → how long this call must wait. */
export class Pacer {
  private tokens = BURST;
  private refilledAt = 0;
  constructor(private readonly now: () => number) {}
  take(): number {
    const t = this.now();
    if (this.refilledAt) this.tokens = Math.min(BURST, this.tokens + (t - this.refilledAt) / MIN_GAP_MS);
    this.refilledAt = t;
    this.tokens -= 1;
    return this.tokens >= 0 ? 0 : -this.tokens * MIN_GAP_MS;
  }
  reset(): void {
    this.tokens = BURST;
    this.refilledAt = 0;
  }
}

function memoryStore(): AuthStore {
  let kept: AuthPair | null = null;
  return {
    async get() {
      return kept;
    },
    async set(p) {
      kept = p;
    },
  };
}

export function createOmnifulClient(ctx: ServiceContext, opts: { sleep?: (ms: number) => Promise<void> } = {}): OmnifulClient {
  const env = ctx.env;
  const fetchImpl: FetchLike = ctx.fetch;
  const now = ctx.now;
  const fake = env.servicesMode === "fake";
  const sleep = opts.sleep || (fake ? async () => {} : (ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tok = () => String(env.OMNIFUL_API_TOKEN || "").trim();
  const refreshToken = () => String(env.OMNIFUL_REFRESH_TOKEN || "").trim();
  const clientId = () => String(env.OMNIFUL_CLIENT_ID || "").trim();
  const clientSecret = () => String(env.OMNIFUL_CLIENT_SECRET || "").trim();
  const hub = () => String(env.OMNIFUL_HUB_CODE || "").trim();
  const renews = () => !!(refreshToken() && clientId() && clientSecret());
  const configured = () => !!(tok() || renews());
  const base = () => omnifulBase(env);

  const pacer = new Pacer(now);
  let waited = 0;
  let mem: { access: string; refresh: string; exp: number } | null = null;
  let hubRefused: { at: number; message: string } | null = null;
  const soon = (exp: number) => !!exp && exp - now() < RENEW_BEFORE_MS;

  const client: OmnifulClient = {
    auth: memoryStore(),
    configured,
    renews,
    hub,
    base,
    get waitedMs() {
      return waited;
    },
    state() {
      return {
        configured: configured(),
        env: omnifulEnv(env),
        base: base(),
        hub: hub() ? "set" : "",
        renews: renews(),
        missing: [...(configured() ? [] : ["OMNIFUL_API_TOKEN"]), ...(hub() ? [] : ["OMNIFUL_HUB_CODE"])],
      };
    },
    _reset() {
      mem = null;
      pacer.reset();
      waited = 0;
      hubRefused = null;
    },
    call,
    async createOrder(body, o = {}) {
      const id = String(body.order_id || "").slice(0, 60);
      const data = await call(ORDER_PATH, { method: "POST", body, idempotencyKey: "lm-" + id, deadline: o.deadline });
      return { ref: refOf(data), raw: data };
    },
    async cancelOrder(sentId, reason, o = {}) {
      const id = String(sentId || "").trim();
      if (!id) throw new OmnifulError("no_id", "no order id");
      return call(ORDER_PATH + "/" + encodeURIComponent(id) + "/cancel", {
        method: "PUT",
        body: { cancel_reason: String(reason || "Cancelled by the shop").slice(0, 200) },
        deadline: o.deadline,
      });
    },
    async getOrder(omnifulId, o = {}) {
      const id = String(omnifulId || "").trim();
      if (!id) throw new OmnifulError("no_id", "no Omniful id");
      return call(GET_ORDER_PATH + encodeURIComponent(id), { deadline: o.deadline });
    },
    async listSkus(maxPages = 5) {
      const out: CatalogueSku[] = [];
      let after = "";
      for (let n = 0; n < maxPages; n++) {
        const data = (await call(SKUS_PATH + "?per_page=100" + (after ? "&search_after=" + encodeURIComponent(after) : ""))) as Record<string, any>;
        const rows: any[] = data && Array.isArray(data.data) ? data.data : [];
        for (const r of rows) {
          if (!r || !r.sku_code) continue;
          out.push({
            sku_code: String(r.sku_code).slice(0, 120),
            name: String(r.name || "").slice(0, 200),
            type: String(r.type || "").slice(0, 20),
            status: String(r.status || "").slice(0, 20),
          });
        }
        const meta = (data && data.meta) || {};
        if (!meta.has_next_page || !meta.end_cursor) break;
        after = String(meta.end_cursor);
      }
      return out;
    },
    hubInventory,
  };

  async function bearer(fresh = false): Promise<string> {
    if (!fresh && mem && mem.access && !soon(mem.exp)) return mem.access;
    let saved: AuthPair | null = null;
    try {
      saved = await client.auth.get();
    } catch {
      saved = null;
    }
    /* a pair minted from a refresh token the environment no longer has is stale */
    if (saved && renews() && saved.seed && saved.seed !== seedOf(refreshToken())) saved = null;
    let best: { access: string; exp: number } | null = null;
    for (const t of [saved && saved.access_token, tok()]) {
      if (!t) continue;
      const e = expOf(t);
      if (!best || e > best.exp) best = { access: String(t), exp: e };
    }
    mem = { access: best ? best.access : "", exp: best ? best.exp : 0, refresh: (saved && saved.refresh_token) || refreshToken() };
    if ((fresh || !mem.access || soon(mem.exp)) && renews()) {
      try {
        await renew();
      } catch (e) {
        if (!mem.access) throw e; /* an old token is still worth trying */
      }
    }
    return mem.access;
  }

  async function renew(): Promise<string> {
    let res;
    try {
      res = await outbound<Record<string, any>>(fetchImpl, base() + TOKEN_PATH, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: {
          refresh_token: (mem && mem.refresh) || refreshToken(),
          client_id: clientId(),
          client_secret: clientSecret(),
          grant_type: "refresh_token",
        },
        timeoutMs: 8000,
      });
    } catch (err) {
      throw new OmnifulError("omniful_auth_failed", "Omniful did not answer the token renewal (" + ((err as OutboundError)?.code || "error") + ")");
    }
    const data = res.data && typeof res.data === "object" ? res.data : null;
    const d = ((data && data.data) || data || {}) as Record<string, any>;
    if (!res.ok || !d.access_token) {
      throw new OmnifulError(
        "omniful_auth_failed",
        "Omniful would not renew the token — check OMNIFUL_REFRESH_TOKEN, OMNIFUL_CLIENT_ID and OMNIFUL_CLIENT_SECRET (" + explain(res.status, data) + ")",
        res.status,
      );
    }
    /* expires_in is nanoseconds in their sample (thirty days); the token's own exp wins */
    const ns = Number(d.expires_in) || 0;
    const exp = expOf(d.access_token) || (ns > 1e12 ? now() + ns / 1e6 : ns ? now() + ns * 1000 : 0);
    mem = { access: String(d.access_token), refresh: String(d.refresh_token || (mem && mem.refresh) || ""), exp };
    try {
      await client.auth.set({ access_token: mem.access, refresh_token: mem.refresh, seed: seedOf(refreshToken()), at: new Date(now()).toISOString() });
    } catch {
      /* the call still has its token; the next one renews again */
    }
    return mem.access;
  }

  async function call(path: string, o: CallOpts = {}, retried = false): Promise<unknown> {
    if (!configured()) throw new OmnifulError("omniful_not_configured", "omniful_not_configured");
    const bearerTok = await bearer();
    const wait = pacer.take();
    if (wait > 0) {
      waited += wait;
      await sleep(wait);
    }
    let timeoutMs = o.timeoutMs ?? 8000;
    if (o.deadline) {
      const left = o.deadline - now() - 150;
      if (left < 400) throw new OmnifulError("omniful_unreachable", "no time left to ask Omniful", null, false, true);
      timeoutMs = Math.min(timeoutMs, left);
    }
    const headers: Record<string, string> = { Authorization: "Bearer " + bearerTok, Accept: "application/json" };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    /* the same send retried is the same key; a send after a cancel goes as another id */
    if (o.idempotencyKey) headers["Idempotency-Key"] = String(o.idempotencyKey);
    let res;
    try {
      res = await outbound(fetchImpl, base() + (path.charAt(0) === "/" ? path : "/" + path), {
        method: o.method || "GET",
        headers,
        body: o.body,
        timeoutMs,
      });
    } catch (err) {
      const e = err as OutboundError;
      throw new OmnifulError(
        "omniful_unreachable",
        e && e.code === "timeout" ? "Omniful did not answer in time" : "Could not reach Omniful",
        null,
        true,
        !!(e && e.unsent),
      );
    }
    /* refused: renew once and try again, if it can renew at all */
    if (res.status === 401 && !retried && renews()) {
      await bearer(true);
      return call(path, o, true);
    }
    if (!res.ok) {
      throw new OmnifulError(
        res.status === 429 ? "omniful_throttled" : "omniful_rejected",
        explain(res.status, res.data),
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }
    return res.data;
  }

  async function hubInventory(maxPages: number, skuCodes?: string[], o: { deadline?: number } = {}): Promise<InventoryRead> {
    const code = hub();
    if (!code) throw new OmnifulError("omniful_no_hub", "omniful_no_hub");
    const out: ShelfRow[] = [];
    const seen: string[][] = [];
    const take = (data: unknown) => {
      const d = data as Record<string, any> | any[] | null;
      const rows: any[] = Array.isArray(d)
        ? d
        : d && Array.isArray(d.data)
          ? d.data
          : d && d.data && Array.isArray(d.data.inventory)
            ? d.data.inventory
            : d && d.data && Array.isArray(d.data.skus)
              ? d.data.skus
              : [];
      for (const r of rows) {
        if (seen.length < 1 && r && typeof r === "object") seen.push(Object.keys(r).slice(0, 30));
        const row = inventoryRow(r);
        if (row) {
          if (r && r.hub_code) row.hub = String(r.hub_code);
          out.push(row);
        }
      }
    };
    const codes = Array.isArray(skuCodes)
      ? skuCodes.map((c) => String(c || "").trim()).filter((c, i, a) => c && a.indexOf(c) === i).slice(0, 20)
      : [];

    const perSku = async (why: string): Promise<InventoryRead> => {
      await Promise.all(
        codes.map((c) =>
          call(SKU_INVENTORY_PATH + encodeURIComponent(c), { deadline: o.deadline }).then(take, (err) => {
            if (!(err instanceof OmnifulError && err.status === 404)) throw err; /* not in their catalogue: no row */
          }),
        ),
      );
      const hubs = [...new Set(out.map((r) => r.hub).filter((h): h is string => !!h))];
      return {
        rows: out,
        fields: seen[0] || [],
        perSku: true,
        hubs,
        note:
          "Omniful refused the hub code for the inventory read (" + why + "); read per SKU instead" +
          (hubs.length ? " — the shelf's own hub code is " + hubs.join(", ") : ""),
      };
    };

    if (hubRefused && codes.length && now() - hubRefused.at < HUB_RETRY_MS) return perSku(hubRefused.message);

    let after = "";
    let page = 1;
    try {
      for (let n = 0; n < (maxPages || 5); n++) {
        const data = (await call(
          INVENTORY_PATH + encodeURIComponent(code) + "?per_page=100&page=" + page + (after ? "&search_after=" + encodeURIComponent(after) : ""),
          { deadline: o.deadline },
        )) as Record<string, any>;
        take(data);
        const meta = (data && data.meta) || {};
        /* by page number, as documented; by cursor if that is what came back */
        if (Number(meta.last_page) > Number(meta.current_page || page)) {
          page = Number(meta.current_page || page) + 1;
          continue;
        }
        if (!meta.has_next_page || !meta.end_cursor) break;
        after = String(meta.end_cursor);
      }
    } catch (e) {
      const refusedHub = e instanceof OmnifulError && (e.status === 400 || e.status === 403) && /hub/i.test(e.message);
      if (!refusedHub || !codes.length) throw e;
      hubRefused = { at: now(), message: (e as Error).message };
      out.length = 0;
      seen.length = 0;
      return perSku(hubRefused.message);
    }
    hubRefused = null;
    return { rows: out, fields: seen[0] || [] };
  }

  return client;
}

declare module "../../core/deps" {
  interface Services {
    omniful: OmnifulClient;
  }
}

/** Augments Services with its client. */
export function createOmniful(ctx: ServiceContext): { omniful: OmnifulClient } {
  return { omniful: createOmnifulClient(ctx) };
}
