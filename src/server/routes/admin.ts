/**
 * /api/admin/* — the admin panel's HTTP API (the endpoint table: src/shared/admin/api.ts and
 * docs/notes/admin-api.md). One sub-app: the guard (headers, CSRF, session) runs first for
 * every path, before any body is read; then the routes, one file per part of the panel:
 *
 *   admin/session.ts     login, logout, session
 *   admin/orders.ts      orders, the editors, bulk, typed-in orders, export, customers
 *   admin/fulfilment.ts  payments, Empower, the Stock Tracker
 *   admin/insights.ts    catalogue, analytics, overview, health, settings, audit, jobs
 *
 * A refusal is { ok: false, error, …extra } with its status; a catalogue that cannot be read
 * is 503 with its code; anything else is a 500 server_error, the detail in the logs only.
 */
import { errorStack } from "../core/log";
import { Hono } from "hono";
import type { AppEnv } from "../core/deps";
import { HttpError } from "../core/http";
import { CatalogueError } from "../domain/catalogue";
import { ADMIN_HEADERS, guard, relPath } from "./admin/kit";
import { registerFulfilmentRoutes } from "./admin/fulfilment";
import { registerInsightRoutes } from "./admin/insights";
import { registerOrderRoutes } from "./admin/orders";
import { registerSessionRoutes } from "./admin/session";

export function adminApp(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use("*", guard());
  registerSessionRoutes(r);
  registerOrderRoutes(r);
  registerFulfilmentRoutes(r);
  registerInsightRoutes(r);
  r.notFound((c) => c.json({ ok: false, error: "not_found" }, 404, ADMIN_HEADERS));
  r.onError(async (err, c) => {
    if (err instanceof HttpError) {
      return c.json({ ok: false, error: err.code, ...err.extra }, err.status, { ...ADMIN_HEADERS, ...err.headers });
    }
    if (err instanceof CatalogueError) return c.json({ ok: false, error: err.code }, err.code === "busy" ? 409 : 503, ADMIN_HEADERS);
    const deps = c.get("deps");
    await deps.log.error("admin", errorStack(err), { path: "/api/admin" + relPath(c) });
    return c.json({ ok: false, error: "server_error" }, 500, ADMIN_HEADERS);
  });
  return r;
}

export function registerAdminRoutes(app: Hono<AppEnv>): void {
  app.route("/api/admin", adminApp());
}
