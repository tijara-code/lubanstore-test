/**
 * THE BROWSER'S TWIN EVENTS — what /api/meta and /api/snap accept (port of pixels/relay.js and
 * the two relay functions). The page fires the pixel and posts the same event here under one
 * event id; the platform keeps whichever arrives first. The request is first-party, so a
 * blocker that drops the pixel lets this through — the point of it.
 *
 * Everything is rebuilt from an allowlist (the event catalogue) rather than forwarded, and never
 * a Purchase: only the server reports a sale, from its own figures.
 */
import { META_RELAY, SNAP_RELAY, pickName } from "../../../shared/pixels/catalogue";
import { clickId, isHash } from "../../../shared/pixels/identity";
import { str } from "../../core/http";
import type { EventItem, EventSpec } from "./build";

/** a two-letter market code, or "" */
export function marketCode(v: unknown): string {
  return typeof v === "string" && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : "";
}

export function relayNum(v: unknown): number | null {
  const x = Number(v);
  return v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(x) && x >= 0 ? x : null;
}

/** the basket's lines, capped (20) and cleaned */
export function relayItems(list: unknown): EventItem[] {
  return (Array.isArray(list) ? list.slice(0, 20) : [])
    .map((i: Record<string, unknown> | null) => ({ id: str(i && i.id, 60), qty: relayNum(i && i.qty) || 1, price: relayNum(i && i.price) }))
    .filter((i) => i.id);
}

export interface RelayContext {
  now: number;
  /** the edge's country, when the page names none */
  edgeCountry: string;
  ip: string;
  ua: string;
}

export type RelayParse = { spec: EventSpec } | { refused: "name" | "id" };

function request(ctx: RelayContext) {
  const out: { client_ip_address?: string; client_user_agent?: string } = {};
  if (ctx.ip) out.client_ip_address = ctx.ip;
  if (ctx.ua) out.client_user_agent = ctx.ua;
  return out;
}

/** POST /api/meta  { name, id, url, value, currency, category, contentName, items[], numItems, fbp, fbc, ph, vid, cc } */
export function parseMetaRelay(b: Record<string, unknown>, ctx: RelayContext): RelayParse {
  const name = pickName(META_RELAY, b.name);
  if (!name) return { refused: "name" };
  const id = str(b.id, 80);
  if (!id) return { refused: "id" };
  const ph = isHash(b.ph) ? (b.ph as string) : "";
  return {
    spec: {
      name, id, time: ctx.now,
      url: str(b.url, 400) || undefined,
      currency: str(b.currency, 8) || undefined,
      category: str(b.category, 40) || undefined,
      contentName: str(b.contentName, 80) || undefined,
      value: relayNum(b.value),
      numItems: relayNum(b.numItems),
      items: relayItems(b.items),
      user: {
        phoneHash: ph,
        externalId: [ph, isHash(b.vid) ? (b.vid as string) : ""],
        country: marketCode(b.cc) || ctx.edgeCountry,
        /* NOT through str(): Meta's own cookie values, whole or not at all (clickId) */
        fbp: clickId(b.fbp),
        fbc: clickId(b.fbc),
      },
      request: request(ctx),
    },
  };
}

/** POST /api/snap  { name, id, url, price, currency, category, items[], numItems, ph, vid, cc, scid, sccid } */
export function parseSnapRelay(b: Record<string, unknown>, ctx: RelayContext): RelayParse {
  const name = pickName(SNAP_RELAY, b.name);
  if (!name) return { refused: "name" };
  const id = str(b.id, 80);
  if (!id) return { refused: "id" };
  const ph = isHash(b.ph) ? (b.ph as string) : "";
  return {
    spec: {
      name, id, time: ctx.now,
      url: str(b.url, 400) || undefined,
      currency: str(b.currency, 8) || undefined,
      category: str(b.category, 40) || undefined,
      value: relayNum(b.price),
      numItems: relayNum(b.numItems),
      items: relayItems(b.items),
      user: {
        phoneHash: ph,
        externalId: [ph, isHash(b.vid) ? (b.vid as string) : ""],
        country: marketCode(b.cc) || ctx.edgeCountry,
      },
      scid: str(b.scid, 128) || undefined,
      sccid: str(b.sccid, 128) || undefined,
      request: request(ctx),
    },
  };
}

