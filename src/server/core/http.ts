/**
 * HTTP helpers shared by every route: errors with an answer attached, reading a request
 * safely, the shopper's IP and edge geo, cache headers, and the HTML shell for the pages
 * the server renders (invoice, reminder link).
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error that knows its answer: { ok: false, error: code, ...extra } with `status`. */
export class HttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: ContentfulStatusCode = 400,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
    this.name = "HttpError";
  }
}

export function fail(code: string, status: ContentfulStatusCode = 400, extra?: Record<string, unknown>, headers?: Record<string, string>): HttpError {
  return new HttpError(code, status, extra, headers);
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Cached at the CDN: `sMaxAge` fresh, served stale while it refreshes; the browser always revalidates. */
export function cdn(sMaxAge: number, staleFor?: number, durable?: boolean): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control":
      "public, " + (durable ? "durable, " : "") + "s-maxage=" + sMaxAge + (staleFor ? ", stale-while-revalidate=" + staleFor : ""),
  };
}

const POISON = new Set(["toString", "valueOf", "__proto__", "constructor"]);

/** Drop keys that make String(obj) throw or pollute prototypes. */
export function scrub<T>(v: T, depth = 0): T {
  if (!v || typeof v !== "object" || depth > 12) return v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = scrub(v[i], depth + 1);
    return v;
  }
  for (const k of Object.keys(v as object)) {
    if (POISON.has(k)) delete (v as Record<string, unknown>)[k];
    else (v as Record<string, unknown>)[k] = scrub((v as Record<string, unknown>)[k], depth + 1);
  }
  return v;
}

/** The raw body text, exactly as sent (signatures run over it). */
export async function rawBody(c: Context): Promise<string> {
  const cached = c.get("rawBody" as never) as string | undefined;
  if (cached !== undefined) return cached;
  const text = await c.req.text();
  c.set("rawBody" as never, text as never);
  return text;
}

/** The JSON body as an object; bad JSON → 400 bad_json; a non-object → {}. */
export async function readJson(c: Context): Promise<Record<string, any>> {
  const text = await rawBody(c);
  let v: unknown;
  try {
    v = JSON.parse(text || "{}");
  } catch {
    throw fail("bad_json", 400);
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
  return scrub(v as Record<string, any>);
}

/**
 * A till takes only its own page's posts: a browser saying the request is cross-site is
 * refused (403), and the body must be application/json (415) — which another site cannot
 * send without a preflight this site never answers.
 */
export function sameSiteJson(c: Context): void {
  if (String(c.req.header("sec-fetch-site") || "").trim().toLowerCase() === "cross-site") throw fail("forbidden", 403);
  const type = String(c.req.header("content-type") || "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") throw fail("bad_content_type", 415);
}

/** The shopper's IP as the platform saw it — never anything the page says. */
export function clientIp(c: Context): string {
  return String(
    c.req.header("x-nf-client-connection-ip") || String(c.req.header("x-forwarded-for") || "").split(",")[0] || "",
  ).trim().slice(0, 64);
}

function edgeGeoJson(c: Context): Record<string, any> | null {
  const geo = c.req.header("x-nf-geo");
  if (!geo) return null;
  try {
    return JSON.parse(Buffer.from(geo, "base64").toString("utf8")) || null;
  } catch {
    return null;
  }
}

/** The country derived at the edge ("" when unknown). Dev/test may send x-country. */
export function edgeCountry(c: Context): string {
  let code = c.req.header("x-nf-country") || "";
  if (!code) code = (edgeGeoJson(c)?.country?.code as string) || "";
  if (!code) code = c.req.header("x-country") || "";
  return /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : "";
}

/** City and a point rounded to 0.1° (~10 km) for the live map — never an address. */
export function edgeGeo(c: Context): { city?: string; lat?: number; lng?: number } {
  const out: { city?: string; lat?: number; lng?: number } = {};
  const g = edgeGeoJson(c);
  if (!g) return out;
  const city = typeof g.city === "string" ? g.city.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60) : "";
  if (city) out.city = city;
  const lat = Number(g.latitude);
  const lng = Number(g.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
    out.lat = Math.round(lat * 10) / 10;
    out.lng = Math.round(lng * 10) / 10;
  }
  return out;
}

/** The site's own origin for return URLs: the configured one, else the request's host. */
export function siteOrigin(c: Context, configured: string): string {
  if (configured) return configured;
  const proto = c.req.header("x-forwarded-proto") || new URL(c.req.url).protocol.replace(":", "") || "https";
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || "";
  return host ? proto + "://" + host : "";
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ESC[ch]!);
}

/** The shell of a page sent to one person (invoice, reminder link): Arabic, RTL, not indexed. */
export function pageHtml(title: string, head: string, body: string, lang: "ar" | "en" = "ar"): string {
  return (
    `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    "<title>" + esc(title) + "</title>" + (head || "") + "</head><body>" + body + "</body></html>"
  );
}

/** Text: a string or number only (objects never reach String()), trimmed and capped. */
export function str(v: unknown, max = 200): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).trim().slice(0, max);
}
