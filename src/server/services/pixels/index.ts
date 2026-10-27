/**
 * THE AD PLATFORMS' SERVER DOORS — Meta's Conversions API, Snap's Conversions API (v3) and
 * GA4's Measurement Protocol. The same clients run in every mode; in fake mode the network is
 * the in-process emulator (./fake.ts), which records every payload.
 *
 *   META_PIXEL_ID / META_CAPI_TOKEN        POST graph.facebook.com/v21.0/{pixel}/events,
 *                                          the token in the BODY (never the URL)
 *   META_TEST_EVENT_CODE                   Test Events only — ignored on the production deploy
 *   SNAP_PIXEL_ID / SNAP_CAPI_TOKEN        POST tr.snapchat.com/v3/{pixel}/events,
 *                                          the token as a Bearer header (never the URL)
 *   GA4_MEASUREMENT_ID / GA4_API_SECRET    POST www.google-analytics.com/mp/collect
 *
 * A shopper is waiting behind every call that reports a sale: each send is awaited but capped
 * tightly (1.2 s; a typical round trip is 100–300 ms), and NEVER throws — a measurement failure
 * must not fail an order. Never logs a payload (hashed customer data) or a URL (GA4's secret).
 */
import { GA_ID_RE } from "../../../shared/pixels/identity";
import { call } from "../../core/outbound";
import type { ServiceContext } from "../context";

export const META_API = "https://graph.facebook.com/v21.0/";
export const SNAP_API = "https://tr.snapchat.com/v3/";
export const GA4_API = "https://www.google-analytics.com/mp/collect";
export const PIXEL_TIMEOUT_MS = 1200;

export interface PixelSendResult {
  ok: boolean;
  /** not sent at all: not_configured | no_events */
  skipped?: string;
  status?: number;
  body?: unknown;
  /** the platform's words or the network's, short (never the payload) */
  error?: string;
}

export interface PixelSendOptions {
  timeoutMs?: number;
}

export interface MetaClient {
  configured(): boolean;
  pixelId(): string;
  /** the Test Events code in force ("" on the production deploy) */
  testCode(): string;
  send(events: ReadonlyArray<Record<string, unknown>>, opts?: PixelSendOptions): Promise<PixelSendResult>;
}

export interface SnapClient {
  configured(): boolean;
  pixelId(): string;
  send(events: ReadonlyArray<Record<string, unknown>>, opts?: PixelSendOptions): Promise<PixelSendResult>;
}

export interface Ga4Client {
  /** the measurement id, upper-cased, "" when absent or not a G- id */
  id(): string;
  /** id and secret: the server reports purchases */
  configured(): boolean;
  /** what the page may know: the id, and whether the server reports purchases (then the page must not) */
  publicConfig(): { ga4: string; mp: boolean };
  collect(payload: Record<string, unknown>, opts?: PixelSendOptions): Promise<PixelSendResult>;
}

export interface PixelsClient {
  meta: MetaClient;
  snap: SnapClient;
  ga4: Ga4Client;
  /** The only configuration values that may reach a browser: the public ids. */
  publicIds(): { metaPixel: string; snapPixel: string; ga4: string; mp: boolean };
}

declare module "../../core/deps" {
  interface Services {
    pixels: PixelsClient;
  }
}

function short(v: unknown, n = 300): string {
  if (v == null) return "";
  if (typeof v === "string") return v.slice(0, n);
  try { return JSON.stringify(v).slice(0, n); } catch { return String(v).slice(0, n); }
}

export function createPixelsClient(ctx: ServiceContext): PixelsClient {
  const env = ctx.env;
  const s = (v: unknown) => String(v || "").trim();
  const limit = (o?: PixelSendOptions) => Math.max(200, Math.min(5000, (o && o.timeoutMs) || PIXEL_TIMEOUT_MS));

  async function post(url: string, payload: unknown, headers: Record<string, string>, okOf: (json: unknown) => boolean, o?: PixelSendOptions): Promise<PixelSendResult> {
    try {
      const r = await call<unknown>(ctx.fetch, url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: payload,
        timeoutMs: limit(o),
      });
      const json = r.data && typeof r.data === "object" ? r.data : null;
      const ok = r.ok && okOf(json);
      return ok ? { ok: true, status: r.status, body: json } : { ok: false, status: r.status, body: json ?? short(r.data), error: (r.status + " " + short(r.data, 160)).trim() };
    } catch (e) {
      return { ok: false, error: short((e as Error)?.message || e, 160) };
    }
  }

  const meta: MetaClient = {
    pixelId: () => s(env.META_PIXEL_ID),
    configured: () => !!(s(env.META_PIXEL_ID) && s(env.META_CAPI_TOKEN)),
    /* NEVER ON THE LIVE SITE: a test code sends every server event — the Purchase included — to
       Test Events, where it is not counted, and Snap has no such switch. Previews may use it. */
    testCode: () => {
      const ctxName = s(env.CONTEXT);
      if (ctxName === "production" || (!ctxName && env.production)) return "";
      return s(env.META_TEST_EVENT_CODE);
    },
    async send(events, o) {
      if (!meta.configured()) return { ok: false, skipped: "not_configured" };
      const list = (events || []).filter(Boolean);
      if (!list.length) return { ok: false, skipped: "no_events" };
      const payload: Record<string, unknown> = { data: list, access_token: s(env.META_CAPI_TOKEN) };
      const code = meta.testCode();
      if (code) payload.test_event_code = code;
      return post(META_API + encodeURIComponent(meta.pixelId()) + "/events", payload, {},
        (json) => !(json && typeof json === "object" && (json as Record<string, unknown>).error), o);
    },
  };

  const snap: SnapClient = {
    pixelId: () => s(env.SNAP_PIXEL_ID),
    configured: () => !!(s(env.SNAP_PIXEL_ID) && s(env.SNAP_CAPI_TOKEN)),
    async send(events, o) {
      if (!snap.configured()) return { ok: false, skipped: "not_configured" };
      const list = (events || []).filter(Boolean);
      if (!list.length) return { ok: false, skipped: "no_events" };
      return post(SNAP_API + encodeURIComponent(snap.pixelId()) + "/events", { data: list },
        { authorization: "Bearer " + s(env.SNAP_CAPI_TOKEN) },
        (json) => !json || (json as Record<string, unknown>).status !== "INVALID", o);
    },
  };

  const ga4: Ga4Client = {
    id: () => {
      const v = s(env.GA4_MEASUREMENT_ID).toUpperCase();
      return GA_ID_RE.test(v) ? v : "";
    },
    configured: () => !!(ga4.id() && s(env.GA4_API_SECRET)),
    publicConfig: () => {
      const m = ga4.id();
      return m ? { ga4: m, mp: !!s(env.GA4_API_SECRET) } : { ga4: "", mp: false };
    },
    async collect(payload, o) {
      if (!ga4.configured()) return { ok: false, skipped: "not_configured" };
      const url = GA4_API + "?measurement_id=" + encodeURIComponent(ga4.id()) + "&api_secret=" + encodeURIComponent(s(env.GA4_API_SECRET));
      return post(url, payload, {}, () => true, o);
    },
  };

  return {
    meta,
    snap,
    ga4,
    publicIds: () => ({ metaPixel: meta.pixelId(), snapPixel: snap.pixelId(), ...(() => { const c = ga4.publicConfig(); return { ga4: c.ga4, mp: c.mp }; })() }),
  };
}

export function createPixels(ctx: ServiceContext): { pixels: PixelsClient } {
  return { pixels: createPixelsClient(ctx) };
}
