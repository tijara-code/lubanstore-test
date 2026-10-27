/**
 * THE AD PLATFORMS' EMULATOR — Meta's Conversions API, Snap's Conversions API v3 and GA4's
 * Measurement Protocol, as the shop's clients see them. Every call is recorded (parsed) so tests
 * assert the exact payloads; refusals follow the platforms' own shapes:
 *
 *   Meta  POST /v21.0/{pixel}/events  { data: [...], access_token, test_event_code? }
 *         → 200 { events_received, messages: [], fbtrace_id }
 *         → 400 { error: { message, type: "OAuthException", code: 100, fbtrace_id } }
 *           (no token, no data, an event without event_name / event_time / action_source,
 *            event_time in milliseconds, a token in the query string)
 *   Snap  POST /v3/{pixel}/events  Authorization: Bearer …  { data: [...] }
 *         → 200 { status: "VALID", reason: "…" }   → 400/401 { status: "INVALID", reason }
 *   GA4   POST /mp/collect?measurement_id=G-…&api_secret=…  { client_id, events: [...] }
 *         → 204, always (the real endpoint never says no; /debug/mp/collect would)
 *
 *   const px = pixelsFake(world);
 *   px.meta / px.snap / px.ga4     the events received, newest last ({ pixel, event, raw })
 *   px.clear()
 */
import { json, type Emulator, type World, type WorldCall } from "../fakes/world";

export interface MetaReceived {
  pixel: string;
  event: Record<string, any>;
  testCode?: string;
  token: string;
}
export interface SnapReceived {
  pixel: string;
  event: Record<string, any>;
  token: string;
}
export interface Ga4Received {
  measurementId: string;
  apiSecret: string;
  body: Record<string, any>;
}

export interface PixelsFake extends Emulator {
  meta: MetaReceived[];
  snap: SnapReceived[];
  ga4: Ga4Received[];
  clear(): void;
}

const HOSTS = /^(graph\.facebook\.com|tr\.snapchat\.com|www\.google-analytics\.com)$/;

export function pixelsFake(world: World): PixelsFake {
  const e = world.emulators.pixels as PixelsFake | undefined;
  if (!e) throw new Error("the pixels emulator is not installed in this world");
  return e;
}

function metaError(message: string, status = 400): Response {
  return json(status, { error: { message, type: "OAuthException", code: 100, fbtrace_id: "Afake" + message.length } });
}

export function installPixelsFake(world: World): void {
  const fake: PixelsFake = {
    meta: [],
    snap: [],
    ga4: [],
    clear() { fake.meta.length = 0; fake.snap.length = 0; fake.ga4.length = 0; },
    matches: (host) => HOSTS.test(host),
    handle(call: WorldCall) {
      const url = new URL("https://" + call.host + call.path);
      const body = (call.body && typeof call.body === "object" ? call.body : null) as Record<string, any> | null;
      if (call.method !== "POST") return json(405, { error: "method" });

      if (call.host === "graph.facebook.com") {
        const m = /^\/v\d+\.\d+\/([^/]+)\/events$/.exec(url.pathname);
        if (!m) return metaError("Unknown path components: " + url.pathname);
        if (url.searchParams.has("access_token")) return metaError("token in the query string (the shop sends it in the body)");
        if (!body || !body.access_token) return metaError("An access token is required to request this resource.", 400);
        if (!Array.isArray(body.data) || !body.data.length) return metaError("The parameter data is required");
        if (body.data.length > 1000) return metaError("At most 1000 events per request");
        for (const ev of body.data) {
          if (!ev || !ev.event_name) return metaError("Invalid parameter: event_name is required");
          if (!Number.isInteger(ev.event_time) || ev.event_time > 1e11) return metaError("Invalid parameter: event_time must be a Unix time in seconds");
          if (!ev.action_source) return metaError("Invalid parameter: action_source is required");
          if (ev.user_data && typeof ev.user_data !== "object") return metaError("Invalid parameter: user_data");
        }
        for (const ev of body.data) {
          fake.meta.push({ pixel: decodeURIComponent(m[1]!), event: ev, token: String(body.access_token), ...(body.test_event_code ? { testCode: String(body.test_event_code) } : {}) });
        }
        return json(200, { events_received: body.data.length, messages: [], fbtrace_id: "Afake" + fake.meta.length });
      }

      if (call.host === "tr.snapchat.com") {
        const m = /^\/v3\/([^/]+)\/events$/.exec(url.pathname);
        if (!m) return json(404, { status: "INVALID", reason: "unknown path" });
        if (url.searchParams.has("access_token")) return json(400, { status: "INVALID", reason: "token in the query string (the shop sends a Bearer header)" });
        const auth = String(call.headers.authorization || "");
        if (!/^Bearer \S+/.test(auth)) return json(401, { status: "INVALID", reason: "missing access token" });
        if (!body || !Array.isArray(body.data) || !body.data.length) return json(400, { status: "INVALID", reason: "data is required" });
        for (const ev of body.data) {
          if (!ev || !ev.event_name || !Number.isInteger(ev.event_time) || ev.event_time > 1e11 || !ev.action_source) {
            return json(400, { status: "INVALID", reason: "event_name, event_time (seconds) and action_source are required" });
          }
        }
        for (const ev of body.data) fake.snap.push({ pixel: decodeURIComponent(m[1]!), event: ev, token: auth.slice(7) });
        return json(200, { status: "VALID", reason: "events accepted" });
      }

      /* GA4 Measurement Protocol: 204 whatever it is sent, as the real one */
      if (url.pathname === "/mp/collect") {
        fake.ga4.push({
          measurementId: url.searchParams.get("measurement_id") || "",
          apiSecret: url.searchParams.get("api_secret") || "",
          body: body || {},
        });
        return new Response(null, { status: 204 });
      }
      return json(404, { error: "not found" });
    },
  };
  world.use("pixels", fake);
}
