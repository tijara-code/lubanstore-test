/**
 * The HTTP application: every public endpoint, the webhooks, the server-rendered pages
 * (invoice, reminder link) and the admin API. One Hono app, run by Netlify Functions in
 * production and by Node locally and in the end-to-end tests.
 */
import { errorStack } from "./core/log";
import { Hono } from "hono";
import type { Deps, AppEnv } from "./core/deps";
import { HttpError } from "./core/http";
import { registerStorefrontRoutes } from "./routes/storefront";
import { registerOrderRoutes } from "./routes/orders";
import { registerPaymentRoutes } from "./routes/payments";
import { registerTrackingRoutes } from "./routes/tracking";
import { registerEmpowerRoutes } from "./routes/empower";
import { registerAdminRoutes } from "./routes/admin";
import { registerDevRoutes } from "./routes/dev";

export const RELEASE = "2.0.1";

export function createApp(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
    c.header("X-LM-Release", RELEASE);
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });

  app.onError(async (err, c) => {
    if (err instanceof HttpError) {
      for (const [k, v] of Object.entries(err.headers)) c.header(k, v);
      return c.json({ ok: false, error: err.code, ...err.extra }, err.status);
    }
    await deps.log.error("http", errorStack(err), { path: new URL(c.req.url).pathname });
    return c.json({ ok: false, error: "server_error" }, 500);
  });

  registerStorefrontRoutes(app);
  registerOrderRoutes(app);
  registerPaymentRoutes(app);
  registerTrackingRoutes(app);
  registerEmpowerRoutes(app);
  registerAdminRoutes(app);
  if (deps.env.servicesMode === "fake") registerDevRoutes(app);

  app.notFound((c) => {
    const p = new URL(c.req.url).pathname;
    if (p.startsWith("/api/")) return c.json({ ok: false, error: "not_found" }, 404);
    return c.text("Not found", 404);
  });
  return app;
}

export type App = ReturnType<typeof createApp>;
