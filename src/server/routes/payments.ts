/**
 * Card payments over HTTP: the card till, the return check, Thawani's webhook (and the URL
 * its portal is configured with today), and the reminder link. The rules live in
 * domain/payments/*; this file only reads the request and writes the answer.
 *
 *   POST /api/pay/session                     the card till
 *   GET  /api/pay/verify?ref=LM-…[&sid=…]     the shopper is back from Thawani
 *   POST /api/pay/webhook                     Thawani's webhook
 *   POST /.netlify/functions/thawani-webhook  the same (the portal's URL)
 *   GET  /resume/:id?k=…[&cod=1][&lang=en]    a page; changes nothing
 *   POST /resume/:id?k=…[&cod=1][&lang=en]    acts (the page's own post)
 */
import type { Context, Hono } from "hono";
import type { AppEnv } from "../core/deps";
import { clientIp, NO_STORE, rawBody, readJson, sameSiteJson, siteOrigin } from "../core/http";
import { liveOf } from "../domain/payments/events";
import { resume, type ResumeResult } from "../domain/payments/resume";
import { cardTill } from "../domain/payments/till";
import { verifyPayment, type Answer } from "../domain/payments/verify";
import { handleWebhook } from "../domain/payments/webhook";

/** A page sent to one person: never stored, framed or indexed. */
export const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

function send(c: Context<AppEnv>, a: Answer): Response {
  return c.json(a.body, a.status as 200, { ...NO_STORE, ...(a.headers || {}) });
}

/** The origin return URLs are built on. In fake mode the request's own, so a local click-through comes back here. */
export function originOf(c: Context<AppEnv>): string {
  const deps = c.get("deps");
  const own = siteOrigin(c, "") || new URL(c.req.url).origin;
  if (deps.env.servicesMode === "fake") return own;
  return siteOrigin(c, deps.env.siteUrl) || own;
}

function resumeAnswer(c: Context<AppEnv>, r: ResumeResult): Response {
  if (r.kind === "html") return c.body(r.html, r.status as 200, PAGE_HEADERS);
  if (r.kind === "json") return c.json(r.body, r.status as 200, NO_STORE);
  return c.body(null, 302, { Location: r.location, ...NO_STORE });
}

const methodNotAllowed = (c: Context<AppEnv>) => c.body(null, 405, NO_STORE);

export function registerPaymentRoutes(app: Hono<AppEnv>): void {
  app.post("/api/pay/session", async (c) => {
    const deps = c.get("deps");
    if (!deps.services.thawani.configured()) return send(c, { status: 503, body: { ok: false, error: "gateway_not_configured" } });
    // this site's checkout only: 403 forbidden / 415 bad_content_type
    sameSiteJson(c);
    const body = await readJson(c);
    const live = liveOf(c);
    return send(c, await cardTill(deps, body, { ip: clientIp(c), ua: live.ua || "", origin: originOf(c) }));
  });

  app.get("/api/pay/verify", async (c) => {
    const deps = c.get("deps");
    const q = { ref: c.req.query("ref") || "", sid: c.req.query("sid") || "", k: c.req.query("k") || "" };
    return send(c, await verifyPayment(deps, q, liveOf(c)));
  });

  const hook = async (c: Context<AppEnv>) => {
    const deps = c.get("deps");
    const body = await rawBody(c);
    return send(c, await handleWebhook(deps, body, {
      timestamp: c.req.header("thawani-timestamp") || null,
      signature: c.req.header("thawani-signature") || null,
    }));
  };
  app.post("/api/pay/webhook", hook);
  app.post("/.netlify/functions/thawani-webhook", hook);

  const reminder = async (c: Context<AppEnv>) => {
    const deps = c.get("deps");
    const raw = (/\/resume\/([^/?]+)/.exec(new URL(c.req.url).pathname) || [])[1] || "";
    const live = liveOf(c);
    return resumeAnswer(c, await resume(deps, {
      rawId: raw,
      k: c.req.query("k") || "",
      cod: (c.req.query("cod") || "") === "1",
      // the shopper's language, when the link carries it: the card session returns to that checkout
      lang: (c.req.query("lang") || "") === "en" ? "en" : "ar",
      posted: c.req.method === "POST",
      wantsJson: /application\/json/i.test(c.req.header("accept") || ""),
      ip: clientIp(c),
      ua: live.ua || "",
      origin: originOf(c),
    }));
  };
  app.get("/resume/:id", reminder);
  app.post("/resume/:id", reminder);

  app.all("/api/pay/session", methodNotAllowed);
  app.all("/api/pay/verify", methodNotAllowed);
  app.all("/api/pay/webhook", methodNotAllowed);
  app.all("/.netlify/functions/thawani-webhook", methodNotAllowed);
  app.all("/resume/:id", methodNotAllowed);
}
