/**
 * Development-only routes, registered only when SERVICES_MODE=fake (app.ts): the fake hosted
 * Thawani pay page, so a full card checkout can be clicked through locally. In fake mode the
 * card till's pay URL points here (services/thawani payUrl, on the request's own origin).
 *
 *   GET  /__fake/thawani/pay/:sessionId           the hosted page: the amount, two buttons
 *   POST /__fake/thawani/pay/:sessionId/pay       the emulator marks the session paid, a signed
 *                                                 webhook is delivered to this app in-process,
 *                                                 then on to the session's success_url
 *   POST /__fake/thawani/pay/:sessionId/cancel    on to its cancel_url
 *
 * The page talks to the emulator through deps.fetch (its /__fake/ control routes), exactly as
 * the real client talks to Thawani; nothing here reaches a real service.
 */
import type { Context, Hono } from "hono";
import { baisaToOmr } from "../../shared/money";
import type { AppEnv } from "../core/deps";
import { esc, NO_STORE, pageHtml } from "../core/http";
import { call } from "../core/outbound";
import { handleWebhook } from "../domain/payments/webhook";
import { forgetCatalogue, publishCatalogue } from "../domain/catalogue";
import { settings } from "../db/schema";
import type { Catalogue } from "../../shared/catalogue/types";
import { HOSTS, type ThawaniPayment, type ThawaniSession } from "../services/thawani";
import { completedEvent, paymentEvent, signDelivery } from "../services/thawani/fake";

function thawaniOrigin(c: Context<AppEnv>): string {
  const deps = c.get("deps");
  return new URL(HOSTS[deps.services.thawani.mode()].api).origin;
}

async function control<T>(c: Context<AppEnv>, path: string, method = "GET") {
  const deps = c.get("deps");
  return call<T>(deps.fetch, thawaniOrigin(c) + "/__fake/sessions/" + encodeURIComponent(c.req.param("sessionId") || "") + path, {
    method, body: method === "POST" ? {} : undefined,
  });
}

const STYLE =
  "<style>body{margin:0;background:#f2f4f7;font:15px/1.7 system-ui,sans-serif;color:#1d2433;display:grid;place-items:center;min-height:100vh;padding:24px}" +
  ".card{background:#fff;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 12px 40px -24px rgba(0,0,0,.4)}" +
  ".tag{display:inline-block;background:#fde68a;color:#7c4a03;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600}" +
  "table{width:100%;border-collapse:collapse;margin:14px 0}td{padding:4px 0;border-bottom:1px solid #eef0f3}td.n{text-align:end}" +
  ".row{display:flex;gap:10px;margin-top:18px}button{flex:1;padding:12px;border-radius:10px;border:0;font:inherit;cursor:pointer}" +
  ".pay{background:#0f766e;color:#fff}.cancel{background:#e5e7eb;color:#111}</style>";

export function registerDevRoutes(app: Hono<AppEnv>): void {
  /*
   * Test and development helpers (fake mode only): publish a catalogue as it stands, or
   * reset to the bundled one — the parity scripts drive catalogue variants through this.
   *   PUT    /__fake/catalogue   { data }  → the row is replaced (code-owned fields stripped)
   *   DELETE /__fake/catalogue            → nothing published (the bundled catalogue serves)
   */
  app.put("/__fake/catalogue", async (c) => {
    const deps = c.get("deps");
    const body = (await c.req.json().catch(() => null)) as { data?: Catalogue } | null;
    if (!body || !body.data || !Array.isArray(body.data.countries)) return c.json({ ok: false, error: "bad_input" }, 400);
    const saved = await publishCatalogue(deps, () => body.data!, "dev");
    return c.json({ ok: true, version: saved?.version ?? null });
  });
  app.delete("/__fake/catalogue", async (c) => {
    const deps = c.get("deps");
    await deps.db.delete(settings);
    forgetCatalogue(deps.db as unknown as object);
    return c.json({ ok: true });
  });

  app.get("/__fake/thawani/pay/:sessionId", async (c) => {
    const r = await control<{ session: ThawaniSession; hosted: string; expired: boolean }>(c, "");
    if (!r.ok) return c.body(pageHtml("Fake Thawani", STYLE, '<div class="card"><h1>No such session</h1></div>', "en"), 404, { "Content-Type": "text/html; charset=utf-8", ...NO_STORE });
    const s = r.data.session;
    const lines = (s.products || [])
      .map((p) => "<tr><td>" + esc(p.name) + " × " + p.quantity + '</td><td class="n">' + baisaToOmr(p.unit_amount * p.quantity).toFixed(3) + "</td></tr>")
      .join("");
    const sid = esc(encodeURIComponent(s.session_id));
    const open = r.data.hosted === "open" && !r.data.expired;
    const body =
      '<div class="card"><span class="tag">FAKE THAWANI · development only</span>' +
      "<h1>Pay " + baisaToOmr(s.total_amount || 0).toFixed(3) + " OMR</h1>" +
      "<p>Order <b>" + esc(s.client_reference_id) + "</b> · invoice " + esc(s.invoice) + "</p>" +
      "<table>" + lines + "</table>" +
      (open
        ? '<div class="row"><form method="post" action="/__fake/thawani/pay/' + sid + '/cancel" style="flex:1;display:flex"><button class="cancel" type="submit">Cancel</button></form>' +
          '<form method="post" action="/__fake/thawani/pay/' + sid + '/pay" style="flex:1;display:flex"><button class="pay" type="submit">Pay</button></form></div>'
        : "<p>This session is " + esc(r.data.expired ? "expired" : r.data.hosted) + ".</p>") +
      "</div>";
    return c.body(pageHtml("Fake Thawani", STYLE, body, "en"), 200, { "Content-Type": "text/html; charset=utf-8", ...NO_STORE });
  });

  app.post("/__fake/thawani/pay/:sessionId/pay", async (c) => {
    const deps = c.get("deps");
    const r = await control<{ session: ThawaniSession; payment: ThawaniPayment }>(c, "/pay", "POST");
    if (!r.ok) return c.json({ ok: false, error: "cannot_pay", detail: r.data }, 409, NO_STORE);
    // Thawani tells the shop server-to-server, usually before the shopper is back
    const secret = String(deps.env.THAWANI_WEBHOOK_SECRET || "");
    const ts = String(Math.floor(deps.now() / 1000));
    for (const evt of [completedEvent(r.data.session), paymentEvent(r.data.payment)]) {
      const d = signDelivery(evt, secret, ts);
      await handleWebhook(deps, d.body, { timestamp: d.headers["thawani-timestamp"], signature: d.headers["thawani-signature"] });
    }
    return c.body(null, 302, { Location: String(r.data.session.success_url || "/"), ...NO_STORE });
  });

  app.post("/__fake/thawani/pay/:sessionId/cancel", async (c) => {
    const r = await control<{ session: ThawaniSession }>(c, "/cancel", "POST");
    if (!r.ok) return c.json({ ok: false, error: "cannot_cancel" }, 409, NO_STORE);
    return c.body(null, 302, { Location: String(r.data.session.cancel_url || "/"), ...NO_STORE });
  });
}
