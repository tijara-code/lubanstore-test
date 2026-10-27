/**
 * The storefront's public reads and the invoice page:
 *
 *   GET /api/settings   the published catalogue (merged with the deploy's code-owned fields,
 *                       less what only the panel may see) + { analytics: { ga4, mp } }
 *   GET /api/geo        { country } from the edge
 *   GET /api/track      a delivery stage for an order number (domain/track)
 *   GET /api/health     up or down, for a status page (domain/health)
 *   GET /invoice/:id    the customer's invoice (domain/invoice)
 */
import type { Context, Hono } from "hono";
import type { Catalogue } from "../../shared/catalogue/types";
import { merge, publicView as publicCatalogue } from "../../shared/catalogue/merge";
import type { AppEnv, Deps } from "../core/deps";
import { cdn, clientIp, edgeCountry, NO_STORE } from "../core/http";
import { allow } from "../core/ratelimit";
import { bundledCatalogue, readCatalogueRow } from "../domain/catalogue";
import { healthStatus, publicView as publicHealth } from "../domain/health";
import { INVOICE_HEADERS, renderInvoice } from "../domain/invoice";
import { trackOrder } from "../domain/track";

/** what /api/settings tells the page about GA4: its id, and whether the server reports purchases */
export function analyticsConfig(deps: Pick<Deps, "services">): { ga4: string; mp: boolean } {
  return deps.services.pixels.ga4.publicConfig();
}

/**
 * THE DATABASE BLINKED (v319): asked once more, and if that fails too this instance's last
 * good answer (at most six hours old) is served for fifteen seconds rather than nothing;
 * only a cold instance with no answer of its own says 502. Kept per database handle.
 */
const LAST_OK_MS = 6 * 3600e3;
const last = new WeakMap<object, { data: Catalogue; modified: string; at: number }>();

async function settings(c: Context<AppEnv>) {
  const deps = c.get("deps");
  const key = deps.db as unknown as object;
  let row;
  try {
    row = await readCatalogueRow(deps.db);
  } catch {
    try {
      row = await readCatalogueRow(deps.db);
    } catch (e2) {
      const l = last.get(key);
      if (l && deps.now() - l.at < LAST_OK_MS) {
        return c.json(l.data, 200, { ...cdn(15, 60, false), "Last-Modified": l.modified });
      }
      await deps.log.error("settings", "the catalogue could not be read: " + String((e2 as Error)?.message || e2), { path: "/api/settings" });
      return c.json({ error: "upstream" }, 502);
    }
  }
  // Nothing published yet: the deploy's catalogue, under the same rules.
  const published = row && row.data && Array.isArray(row.data.countries) && row.data.countries.length ? row.data : null;
  const data = publicCatalogue(merge(published, bundledCatalogue())!) as Catalogue;
  data.analytics = analyticsConfig(deps);
  const modified = new Date(published && row ? row.updatedAt.getTime() : deps.now()).toUTCString();
  last.set(key, { data, modified, at: deps.now() });
  return c.json(data, 200, { ...cdn(60, 86400, true), "Last-Modified": modified });
}

const method = (c: Context<AppEnv>) => c.json({ error: "method" }, 405);

export function registerStorefrontRoutes(app: Hono<AppEnv>): void {
  app.get("/api/settings", settings);
  app.all("/api/settings", method);

  app.get("/api/geo", (c) => c.json({ country: edgeCountry(c) }, 200, NO_STORE));
  app.all("/api/geo", method);

  app.get("/api/track", async (c) => {
    const deps = c.get("deps");
    const rl = await allow(deps.db, "track", clientIp(c), deps.now());
    if (!rl.ok) return c.json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": String(rl.retryAfter || 60), ...NO_STORE });
    const r = await trackOrder(deps, c.req.query("id"));
    return c.json(r.body, r.status, r.status === 200 ? cdn(60) : NO_STORE);
  });
  app.all("/api/track", (c) => c.json({ ok: false, error: "method" }, 405));

  app.get("/api/health", async (c) => {
    const s = await healthStatus(c.get("deps"));
    return c.json(publicHealth(s), s.ok ? 200 : 503, cdn(30, 60, false));
  });
  app.all("/api/health", method);

  const invoice = async (c: Context<AppEnv>) => {
    const raw = new URL(c.req.url).pathname.replace(/^\/invoice\/?/, "") || c.req.query("id") || "";
    const r = await renderInvoice(c.get("deps"), raw, c.req.query("k"));
    return c.body(r.html, r.status, INVOICE_HEADERS);
  };
  app.get("/invoice/*", invoice);
  app.get("/invoice", invoice);
  app.all("/invoice/*", (c) => c.body(null, 405, NO_STORE));
  app.all("/invoice", (c) => c.body(null, 405, NO_STORE));
}
