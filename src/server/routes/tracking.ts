/**
 * THE MEASUREMENT DOORS (contracts as the original's, because the storefront's stats.js /
 * pixel.js ports post the same bodies):
 *
 *   POST /api/beacon  { items: [ { kind: "ev"|"meta"|"snap"|"log", body }, … ] }
 *        One request per page where there used to be three to five: fanned out IN PROCESS to
 *        the handlers below with this request's own headers (edge country, IP, user agent).
 *        At most 12 items; any content type (sendBeacon). 429 past the limit, 400 for junk or
 *        an empty batch, otherwise 204 whatever happened — the page never waits on measurement.
 *   POST /api/ev      { name, item?, sid?, land? }        first-party analytics (events table)
 *   POST /api/meta    { name, id, url, value, … }         Meta's server twin of a pixel event
 *   POST /api/snap    { name, id, url, price, … }         Snap's server twin
 *   POST /api/log     { kind, message, detail?, place?, sid? }   the page's own error report
 *
 * Every one answers 204 with no body when it accepted (or quietly declined) and 400 with no
 * body when the body is refused; a GET is 405. The relays refuse Purchase / PURCHASE and any
 * name outside the event catalogue, and need an event id (no id, no dedup, no send).
 * /api/ev and /api/log posted to directly are counted per address (60 and 30 a minute); the
 * items a beacon carries were counted by the beacon. DNT / GPC switch off the first-party
 * events only (as the page does); the ad platforms run for every visitor.
 */
import type { Context, Hono } from "hono";
import { attribute, ownHostOf } from "../../shared/attribution";
import { LM_NAMES } from "../../shared/pixels/catalogue";
import type { AppEnv } from "../core/deps";
import { clientIp, edgeCountry, edgeGeo, rawBody, scrub, siteOrigin, str } from "../core/http";
import { allow } from "../core/ratelimit";
import { events } from "../db/schema";
import { parseMetaRelay, parseSnapRelay, type RelayContext } from "../domain/pixels/relay";
import { sendMeta, sendSnap } from "../domain/pixels/send";

type C = Context<AppEnv>;
type Body = Record<string, unknown>;

export const BEACON_MAX_ITEMS = 12;
const LOG_KINDS = ["error", "rejection"];
/** a crawler's errors are not a shopper's */
const BOT = /bot|crawl|spider|externalhit|externalads|preview|facebookcatalog|slurp|headless|lighthouse|pingdom|gtmetrix/i;

const empty = (c: C, status: 204 | 400 | 405 | 429, headers: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
  return c.body(null, status);
};

/** the body as an object; undefined for bad JSON; {} for a non-object */
async function bodyOf(c: C): Promise<Body | undefined> {
  let text = "";
  try { text = await rawBody(c); } catch { return undefined; }
  let v: unknown;
  try { v = JSON.parse(text || "{}"); } catch { return undefined; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return scrub(v as Body);
}

function optedOut(c: C): boolean {
  return String(c.req.header("dnt") || "").trim() === "1" || String(c.req.header("sec-gpc") || "").trim() === "1";
}

/* ------------------------------------------------------------------ the handlers */

/**
 * First-party analytics: one row per interaction, and almost nothing in it — never the IP
 * (read only to count the request and derived into a country at the edge), the user agent,
 * the referrer or a cookie. `sid` is a per-tab random token. A session_start's item is its
 * landing, placed HERE by the shop's UTM standard, so sessions and orders are counted in one
 * vocabulary ("source|medium|campaign").
 */
async function ev(c: C, b: Body, viaBeacon: boolean): Promise<204 | 400 | 429> {
  const deps = c.get("deps");
  if (!viaBeacon) {
    const rl = await allow(deps.db, "ev", clientIp(c), deps.now());
    if (!rl.ok) { c.header("Retry-After", String(rl.retryAfter || 60)); return 429; }
  }
  const name = str(b.name, 24);
  if (LM_NAMES.indexOf(name) === -1) return 400;
  if (optedOut(c)) return 204;
  let item: string | null;
  if (name === "session_start") {
    const own = ownHostOf(deps.env.siteUrl || siteOrigin(c, ""));
    const a = attribute(b.land, own, deps.now());
    item = [a.source, a.medium, a.campaign || ""].join("|").slice(0, 160);
  } else item = str(b.item, 64) || null;
  const sid = str(b.sid, 32);
  const geo = edgeGeo(c);
  try {
    await deps.db.insert(events).values({
      at: new Date(deps.now()),
      name,
      item,
      country: edgeCountry(c) || null,
      sid: /^[A-Za-z0-9_-]{4,32}$/.test(sid) ? sid : null,
      city: geo.city ?? null,
      lat: geo.lat ?? null,
      lng: geo.lng ?? null,
    });
  } catch (e) {
    /* a measurement failure never surfaces to a shopper */
    await deps.log.warn("ev", "an event could not be written: " + String((e as Error)?.message || e), { path: "/api/ev" });
  }
  return 204;
}

function relayCtx(c: C): RelayContext {
  const deps = c.get("deps");
  return { now: deps.now(), edgeCountry: edgeCountry(c), ip: clientIp(c), ua: str(c.req.header("user-agent"), 400) };
}

async function meta(c: C, b: Body): Promise<204 | 400> {
  const deps = c.get("deps");
  if (!deps.services.pixels.meta.configured()) return 204;
  const p = parseMetaRelay(b, relayCtx(c));
  if ("refused" in p) return 400;
  await sendMeta(deps, [p.spec]);
  return 204;
}

async function snap(c: C, b: Body): Promise<204 | 400> {
  const deps = c.get("deps");
  if (!deps.services.pixels.snap.configured()) return 204;
  const p = parseSnapRelay(b, relayCtx(c));
  if ("refused" in p) return 400;
  await sendSnap(deps, [p.spec]);
  return 204;
}

/**
 * The page's error report: two kinds, the message and detail cut short, the user agent kept
 * ("which browser" is the first question; a UA alone identifies nobody), the edge's country —
 * never the IP. Masked (phone numbers, emails) by the logger on the way in.
 */
async function log(c: C, b: Body, viaBeacon: boolean): Promise<204 | 400 | 429> {
  const deps = c.get("deps");
  if (!viaBeacon) {
    const rl = await allow(deps.db, "log", clientIp(c), deps.now());
    if (!rl.ok) { c.header("Retry-After", String(rl.retryAfter || 60)); return 429; }
  }
  const kind = str(b.kind, 16);
  const message = str(b.message, 300);
  if (LOG_KINDS.indexOf(kind) === -1 || !message) return 400;
  const ua = str(c.req.header("user-agent"), 200);
  if (BOT.test(ua)) return 204;
  await deps.log.write({
    level: "error",
    side: "browser",
    source: kind,
    message,
    path: str(b.place, 120) || null,
    detail: {
      ...(str(b.detail, 600) ? { stack: str(b.detail, 600) } : {}),
      ...(ua ? { ua } : {}),
      ...(str(b.sid, 32) ? { sid: str(b.sid, 32) } : {}),
      ...(edgeCountry(c) ? { country: edgeCountry(c) } : {}),
    },
  });
  return 204;
}

const HANDLERS: Record<string, (c: C, b: Body, viaBeacon: boolean) => Promise<number>> = {
  ev,
  meta: (c, b) => meta(c, b),
  snap: (c, b) => snap(c, b),
  log,
};

/* ------------------------------------------------------------------ the routes */

export function registerTrackingRoutes(app: Hono<AppEnv>): void {
  app.all("/api/beacon", async (c) => {
    if (c.req.method !== "POST") return empty(c, 405);
    const deps = c.get("deps");
    const rl = await allow(deps.db, "beacon", clientIp(c), deps.now());
    if (!rl.ok) return empty(c, 429, { "Retry-After": String(rl.retryAfter || 60) });
    const b = await bodyOf(c);
    if (!b) return empty(c, 400);
    const items = Array.isArray(b.items) ? (b.items as unknown[]).slice(0, BEACON_MAX_ITEMS) : [];
    if (!items.length) return empty(c, 400);
    /* concurrently, and one refusal or throw cannot cancel the others */
    await Promise.allSettled(items.map(async (it) => {
      const x = it && typeof it === "object" ? (it as Body) : {};
      const kind = String(x.kind || "");
      const h = Object.prototype.hasOwnProperty.call(HANDLERS, kind) ? HANDLERS[kind] : null;
      if (!h || !x.body || typeof x.body !== "object" || Array.isArray(x.body)) return;
      await h(c, x.body as Body, true);
    }));
    return empty(c, 204);
  });

  for (const [path, kind] of [["/api/ev", "ev"], ["/api/meta", "meta"], ["/api/snap", "snap"], ["/api/log", "log"]] as const) {
    app.all(path, async (c) => {
      if (c.req.method !== "POST") return empty(c, 405);
      const b = await bodyOf(c);
      const deps = c.get("deps");
      /* an unconfigured relay is quietly a no-op, whatever it was sent */
      if (kind === "meta" && !deps.services.pixels.meta.configured()) return empty(c, 204);
      if (kind === "snap" && !deps.services.pixels.snap.configured()) return empty(c, 204);
      if (!b) {
        if (kind === "ev" || kind === "log") {
          const rl = await allow(deps.db, kind, clientIp(c), deps.now());
          if (!rl.ok) return empty(c, 429, { "Retry-After": String(rl.retryAfter || 60) });
        }
        return empty(c, 400);
      }
      const status = await HANDLERS[kind]!(c, b, false);
      return empty(c, status as 204 | 400 | 429);
    });
  }
}
