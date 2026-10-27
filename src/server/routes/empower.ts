/**
 * POST /api/omniful/hook?k=<OMNIFUL_HOOK_SECRET> — Omniful tells us a parcel moved.
 *   Their webhook carries no signature, so the URL's key is the only guard: compared in
 *   constant time; closed (404) while the secret is unset (v327); a wrong or missing key is
 *   the same 404 (an endpoint that says "wrong key" helps you guess). Once the caller is
 *   trusted the answer is ALWAYS 200 (Omniful treats anything else as a failed delivery and
 *   eventually stops sending); what went wrong is recorded.
 *
 * GET /api/stock → { left, hide, cap } for the product page: the pieces left per size (only
 *   while the counter is on), the boxes ticked "hide at 0" that are at 0, the ceiling of every
 *   capped box. CDN-cached a minute (durable, stale for five while it refreshes).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import type { AppEnv } from "../core/deps";
import { NO_STORE, rawBody } from "../core/http";
import { webhookEvents } from "../db/schema";
import { readHook } from "../services/omniful";
import { applyStatus } from "../domain/empower/sync";
import { publicStock } from "../domain/stock";

function sameSecret(got: string, want: string): boolean {
  if (!got || !want) return false;
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b) && got.length === want.length;
}

export function registerEmpowerRoutes(app: Hono<AppEnv>): void {
  app.on(["GET", "PUT", "DELETE", "PATCH", "OPTIONS"], "/api/omniful/hook", (c) => {
    if (c.req.method === "OPTIONS") return c.body(null, 204, NO_STORE);
    return c.json({ ok: false, error: "method_not_allowed" }, 405, NO_STORE);
  });

  app.post("/api/omniful/hook", async (c) => {
    const deps = c.get("deps");
    const want = String(deps.env.OMNIFUL_HOOK_SECRET || "").trim();
    if (!want) return c.json({ ok: false }, 404, NO_STORE);
    const got = String(c.req.query("k") || c.req.query("key") || c.req.query("secret") || "").trim();
    if (!sameSecret(got, want)) return c.json({ ok: false }, 404, NO_STORE);

    const text = await rawBody(c);
    let payload: unknown;
    try {
      payload = JSON.parse(text || "{}") || {};
    } catch {
      return c.json({ ok: false, error: "bad_json" }, 200, NO_STORE);
    }
    const news = readHook(payload);
    let out: Record<string, unknown>;
    try {
      out = (await applyStatus(deps, news)) as unknown as Record<string, unknown>;
    } catch (e) {
      await deps.log.error("omniful-hook", String((e as Error)?.stack || e), { path: "/api/omniful/hook", orderId: news.orderId || null });
      out = { error: "hook_failed" };
    }
    const applied = out.error ? "failed" : out.ignored ? String(out.ignored) : out.adopted ? "adopted" : "applied";
    await deps.db
      .insert(webhookEvents)
      .values({
        receivedAt: new Date(deps.now()),
        provider: "omniful",
        eventType: news.status || null,
        orderId: news.orderId || null,
        verified: true,
        applied,
        dedupeKey: "omniful:" + createHash("sha256").update(text).digest("hex"),
        payload: payload as object,
      })
      .onConflictDoNothing()
      .catch(() => {});
    return c.json({ ok: !out.error, ...out }, 200, NO_STORE);
  });

  app.get("/api/stock", async (c) => {
    const { body, headers } = await publicStock(c.get("deps"));
    return c.json(body, 200, headers);
  });
}
