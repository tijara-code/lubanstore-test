/**
 * The Omniful emulator: the shapes the real client relies on (Omniful's published Postman
 * collection, as the original store's tests/_world.js encoded them).
 *
 *   const omf = omnifulFake(world);
 *   omf.inventory = { LM2001: 16 }            the shelf at the hub (or { available, onHand })
 *   omf.advance("LM-123", "out_for_delivery", { awb: "AWB1", carrier: "Aramex" })
 *   omf.orders["LM-123"]                      what was created (by the id it was SENT as)
 *   omf.refuseHub = true                      "Invalid hub code." on the hub inventory read
 *   omf.dropAnswer = (sentId) => true         take the order, then lose the answer (connection reset)
 *   omf.refuseToken = 1                       answer the next N calls 401
 *   omf.knownSkus = ["LM3001"]                refuse a Create Order naming any other code ("Sku Not Valid")
 */
import { json, type Emulator, type World, type WorldCall } from "../fakes/world";

export interface FakeOmnifulOrder {
  /** their id */
  id: string;
  /** ours, as sent */
  order_id: string;
  status: string;
  awb: string;
  carrier: string;
  body: Record<string, any>;
}

export interface FakeOmniful {
  orders: Record<string, FakeOmnifulOrder>;
  n: number;
  inventory: Record<string, number | { available: number; onHand: number }>;
  /** the hub code the inventory rows report */
  hubCode: string;
  skus: Array<{ sku_code: string; name: string; type?: string; status?: string }>;
  refuseHub: boolean;
  /** answer this many calls with 401 (a token Omniful no longer takes) */
  refuseToken: number;
  /** when set, a Create Order naming a code not in it is refused */
  knownSkus: string[] | null;
  dropAnswer: ((sentId: string) => boolean) | null;
  /** issue access tokens as JWTs expiring this many seconds after the world's clock */
  jwtSeconds: number;
  tokensIssued: number;
  advance(sentId: string, status: string, extra?: { awb?: string; carrier?: string }): FakeOmnifulOrder;
  /** the webhook Omniful would post for an order */
  hookPayload(sentId: string): Record<string, unknown>;
}

const STATE = new WeakMap<World, FakeOmniful>();

export function omnifulFake(world: World): FakeOmniful {
  let s = STATE.get(world);
  if (!s) {
    const fresh: FakeOmniful = {
      orders: {},
      n: 0,
      inventory: {},
      hubCode: "HUB-REAL",
      skus: [],
      refuseHub: false,
      refuseToken: 0,
      knownSkus: null,
      dropAnswer: null,
      jwtSeconds: 30 * 86400,
      tokensIssued: 0,
      advance(sentId, status, extra = {}) {
        const o = fresh.orders[sentId];
        if (!o) throw new Error("the fake Omniful has no order " + sentId);
        o.status = status;
        if (extra.awb) o.awb = extra.awb;
        if (extra.carrier) o.carrier = extra.carrier;
        return o;
      },
      hookPayload(sentId) {
        const o = fresh.orders[sentId];
        if (!o) throw new Error("the fake Omniful has no order " + sentId);
        return {
          event_name: "order.update.event",
          data: {
            order_id: o.order_id,
            omniful_order_id: o.id,
            order_status: o.status,
            shipment: { awb_number: o.awb || "", shipping_partner_name: o.carrier || "" },
          },
        };
      },
    };
    s = fresh;
    STATE.set(world, s);
  }
  return s;
}

function err(status: number, message: string) {
  return json(status, { is_success: false, status_code: status, error: { message } });
}

function jwt(expSec: number, n: number): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return b64({ alg: "none" }) + "." + b64({ exp: expSec, n }) + ".sig";
}

function shelf(v: number | { available: number; onHand: number }): { available: number; onHand: number } {
  return typeof v === "number" ? { available: v, onHand: v } : v;
}

const REQUIRED: Array<[string, (b: Record<string, any>) => unknown]> = [
  ["order_id", (b) => b.order_id],
  ["hub_code", (b) => b.hub_code],
  ["order_items", (b) => Array.isArray(b.order_items) && b.order_items.length && b.order_items.every((i: any) => i && i.sku_code && i.quantity > 0 && typeof i.selling_price === "number")],
  ["billing_address", (b) => b.billing_address && b.billing_address.address1 && b.billing_address.city && b.billing_address.country],
  ["shipping_address", (b) => b.shipping_address && b.shipping_address.address1 && b.shipping_address.city && b.shipping_address.country],
  ["invoice", (b) => b.invoice && b.invoice.currency && typeof b.invoice.total === "number"],
  ["customer", (b) => b.customer && b.customer.id && b.customer.first_name],
  ["payment_method", (b) => b.payment_method === "prepaid" || b.payment_method === "postpaid"],
  ["is_cash_on_delivery", (b) => typeof b.is_cash_on_delivery === "boolean"],
  ["type", (b) => b.type],
];

export function installOmnifulFake(world: World): void {
  const s = omnifulFake(world);
  const emulator: Emulator = {
    matches: (host) => /(^|\.)omniful\.com$/.test(host) || /omniful/.test(host),
    handle(call: WorldCall) {
      const url = new URL("https://x" + call.path);
      const path = url.pathname;
      const body = (call.body && typeof call.body === "object" ? call.body : {}) as Record<string, any>;
      let m: RegExpExecArray | null;

      if (call.method === "POST" && /\/sales-channel\/public\/v1\/token$/.test(path)) {
        if (body.grant_type !== "refresh_token" || !body.refresh_token || !body.client_id || !body.client_secret) {
          return err(400, "invalid refresh request");
        }
        s.tokensIssued++;
        return json(200, {
          is_success: true,
          data: {
            access_token: jwt(Math.floor(world.now() / 1000) + s.jwtSeconds, s.tokensIssued),
            refresh_token: "omf-rt-" + s.tokensIssued,
            token_type: "Bearer",
            expires_in: 2592000000000000,
          },
        });
      }

      if (!/^Bearer \S+/.test(call.headers["authorization"] || "")) return err(401, "Unauthorized");
      if (s.refuseToken > 0) {
        s.refuseToken--;
        return err(401, "Token expired");
      }

      if (call.method === "POST" && path === "/sales-channel/public/v1/orders") {
        const bad = REQUIRED.filter(([, ok]) => !ok(body)).map(([k]) => k);
        if (bad.length) return json(422, { is_success: false, errors: bad.map((k) => ({ field: k, message: k + " is required" })) });
        const id = String(body.order_id);
        if (s.orders[id]) return err(400, "order_id has already been taken");
        if (s.knownSkus) {
          const unknown = (body.order_items as any[]).filter((i) => s.knownSkus!.indexOf(String(i.sku_code)) < 0);
          if (unknown.length) return err(400, "Sku Not Valid");
        }
        s.n++;
        s.orders[id] = { id: "OMF-" + s.n, order_id: id, status: "new", awb: "", carrier: "", body: JSON.parse(JSON.stringify(body)) };
        if (s.dropAnswer && s.dropAnswer(id)) {
          /* taken, and the answer lost on the way back */
          throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
        }
        return json(200, { is_success: true, data: { id: "OMF-" + s.n, order_id: id } });
      }

      if (call.method === "PUT" && (m = /^\/sales-channel\/public\/v1\/orders\/([^/]+)\/cancel$/.exec(path))) {
        const o = s.orders[decodeURIComponent(m[1]!)];
        if (!o) return err(404, "order not found");
        if (o.status === "cancelled") return err(422, "Order already cancelled");
        if (/deliver/.test(o.status)) return err(422, "Order cannot be cancelled once delivered");
        if (!body.cancel_reason) return err(422, "cancel_reason is required");
        o.status = "cancelled";
        return json(200, { is_success: true, data: { order_id: o.order_id, status: "cancelled" } });
      }

      if (call.method === "GET" && (m = /^\/sales-channel\/public\/v1\/seller\/orders\/([^/]+)$/.exec(path))) {
        const id = decodeURIComponent(m[1]!);
        const o = Object.values(s.orders).find((x) => x.id === id);
        if (!o) return err(404, "not found");
        return json(200, {
          is_success: true,
          data: {
            id: o.id,
            omniful_order_id: o.id,
            order_id: o.order_id,
            status_code: o.status,
            display_status: o.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            shipment: { awb_number: o.awb || "", shipping_partner_name: o.carrier || "" },
          },
        });
      }

      if (call.method === "GET" && (m = /^\/sales-channel\/public\/v1\/seller\/inventory\/hubs\/([^/]+)$/.exec(path))) {
        if (s.refuseHub) return err(400, "Invalid hub code.");
        const perPage = Math.max(1, Number(url.searchParams.get("per_page")) || 100);
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const all = Object.keys(s.inventory).map((k) => {
          const v = shelf(s.inventory[k]!);
          return {
            hub_code: decodeURIComponent(m![1]!),
            sku_code: k,
            sku_name: k,
            available_quantity: v.available,
            quantity_on_hand: v.onHand,
            quantity_reserved: Math.max(0, v.onHand - v.available),
            uom: "ea",
          };
        });
        const last = Math.max(1, Math.ceil(all.length / perPage));
        return json(200, {
          is_success: true,
          status_code: 200,
          data: all.slice((page - 1) * perPage, page * perPage),
          meta: { current_page: page, last_page: last, per_page: perPage, total: all.length },
        });
      }

      if (call.method === "GET" && (m = /^\/sales-channel\/public\/v1\/inventory\/hubs\/skus\/([^/]+)$/.exec(path))) {
        const k = decodeURIComponent(m[1]!);
        if (s.inventory[k] == null) return err(404, "SKU not found");
        const v = shelf(s.inventory[k]!);
        return json(200, {
          is_success: true,
          status_code: 200,
          data: [{ hub_code: s.hubCode, sku_code: k, sku_name: k, available_quantity: v.available, quantity_on_hand: v.onHand }],
          meta: null,
        });
      }

      if (call.method === "GET" && path === "/sales-channel/public/v2/seller/master/skus") {
        const perPage = Math.max(1, Number(url.searchParams.get("per_page")) || 100);
        const after = Number(url.searchParams.get("search_after") || 0) || 0;
        const rows = s.skus.slice(after, after + perPage);
        const next = after + rows.length;
        return json(200, {
          is_success: true,
          data: rows.map((r) => ({ type: "simple", status: "active", ...r })),
          meta: { has_next_page: next < s.skus.length, end_cursor: next < s.skus.length ? String(next) : "" },
        });
      }

      return err(404, "no such route " + call.method + " " + path);
    },
  };
  world.use("omniful", emulator);
}
