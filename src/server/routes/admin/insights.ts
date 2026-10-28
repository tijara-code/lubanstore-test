/**
 * The catalogue (read, publish, restore defaults, the stock switches, export), the Analytics
 * tab (domain/analytics), the Overview, health, the panel's settings, the audit trail and
 * "run now" for a job.
 */
import { errorText } from "../../core/log";
import type { Hono } from "hono";
import {
  AuditQuery, BusyQuery, ChangesQuery, ClearChangesBody, ErrorsQuery, JobParam, LiveQuery, PublishBody,
  ResetAnalyticsBody, RestoreBody, StockSwitchesBody, SummaryQuery, UiBody,
} from "../../../shared/admin/api";
import type { AppEnv } from "../../core/deps";
import { fail } from "../../core/http";
import { listAudit } from "../../domain/admin/audit";
import { exportCatalogue, getCatalogue, publish, restoreDefaults, setStockSwitches } from "../../domain/admin/catalogue";
import { getUi, overview, saveUi } from "../../domain/admin/panel";
import {
  AD_LINK_TEMPLATES, LINK_MEDIUMS, LINK_PAGES, LINK_SOURCES, ORIGIN_WORD, PLATFORM_WORD, busyHours,
  clearCatalogueChanges, deleteCatalogueChange, listCatalogueChanges, liveVisitors, logsCsv, logsList, resetStats,
  statsSummary, trackingHealth,
} from "../../domain/analytics";
import { fullHealth, jobsHealth } from "../../domain/health";
import { JOBS, runJob } from "../../jobs";
import { actor, audit, body, download, query } from "./kit";

export function registerInsightRoutes(r: Hono<AppEnv>): void {
  /* ---------------- the catalogue ---------------- */

  r.get("/catalogue", async (c) => c.json(await getCatalogue(c.get("deps"))));

  r.post("/catalogue/publish", async (c) => {
    const b = await body(c, PublishBody);
    const out = await publish(c.get("deps"), actor(c), b);
    await audit(c, "catalogue.publish", { target: "v" + out.version, summary: { from: b.version, version: out.version, change: out.change.slice(0, 20) } });
    return c.json(out);
  });

  r.post("/catalogue/restore-defaults", async (c) => {
    const b = await body(c, RestoreBody);
    const out = await restoreDefaults(c.get("deps"), actor(c), b);
    await audit(c, "catalogue.restore_defaults", { target: "v" + out.version, summary: { from: b.version, version: out.version, change: out.change.slice(0, 20) } });
    return c.json(out);
  });

  r.patch("/catalogue/stock", async (c) => {
    const b = await body(c, StockSwitchesBody);
    const out = await setStockSwitches(c.get("deps"), actor(c), b);
    await audit(c, "catalogue.stock", { target: "v" + out.version, summary: { change: out.change.slice(0, 20) } });
    return c.json(out);
  });

  r.get("/catalogue/export", async (c) => {
    const f = await exportCatalogue(c.get("deps"));
    return download(c, f.name, "application/json; charset=utf-8", f.body);
  });

  /* ---------------- analytics ---------------- */

  r.get("/analytics/summary", async (c) => c.json(await statsSummary(c.get("deps"), query(c, SummaryQuery))));

  r.get("/analytics/live", async (c) => c.json(await liveVisitors(c.get("deps"), { minutes: query(c, LiveQuery).minutes })));

  r.get("/analytics/busy", async (c) => {
    const q = query(c, BusyQuery);
    return c.json(await busyHours(c.get("deps"), { ...q, weekday: q.weekday }));
  });

  r.get("/analytics/errors", async (c) => {
    const q = query(c, ErrorsQuery);
    return c.json(await logsList(c.get("deps"), { days: q.days, side: q.side, full: q.full === true }));
  });

  r.get("/analytics/errors.csv", async (c) => {
    const q = query(c, ErrorsQuery);
    const out = await logsList(c.get("deps"), { days: q.days, side: q.side, full: true });
    return download(c, "errors-" + out.days + "d.csv", "text/csv; charset=utf-8", logsCsv(out.rows));
  });

  r.get("/analytics/tracking", async (c) => c.json({ ok: true, ...(await trackingHealth(c.get("deps"))) }));

  r.get("/analytics/links", (c) =>
    c.json({ ok: true, templates: AD_LINK_TEMPLATES, sources: LINK_SOURCES, mediums: LINK_MEDIUMS, pages: LINK_PAGES, origins: ORIGIN_WORD, platforms: PLATFORM_WORD }),
  );

  r.get("/analytics/changes", async (c) => c.json(await listCatalogueChanges(c.get("deps"), query(c, ChangesQuery))));

  r.delete("/analytics/changes/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) throw fail("no_entry", 400);
    if (!(await deleteCatalogueChange(c.get("deps"), id))) throw fail("no_such_entry", 404);
    await audit(c, "changes.delete", { target: String(id), summary: {} });
    return c.json({ ok: true, id });
  });

  r.post("/analytics/changes/clear", async (c) => {
    await body(c, ClearChangesBody);
    const n = await clearCatalogueChanges(c.get("deps"));
    await audit(c, "changes.clear", { target: null, summary: { deleted: n } });
    return c.json({ ok: true, deleted: n, left: 0 });
  });

  r.post("/analytics/reset", async (c) => {
    const b = await body(c, ResetAnalyticsBody);
    const out = await resetStats(c.get("deps"), b.confirm);
    if (!out.ok) throw fail(out.error, 400);
    await audit(c, "analytics.reset", { target: null, summary: { deleted: out.deleted } });
    return c.json(out);
  });

  /* ---------------- overview, health ---------------- */

  r.get("/overview", async (c) => c.json(await overview(c.get("deps"))));

  r.get("/health", async (c) => {
    const deps = c.get("deps");
    const [h, tracking] = await Promise.all([fullHealth(deps), trackingHealth(deps).catch(() => null)]);
    return c.json({ ...h, tracking });
  });

  /* ---------------- settings, audit, jobs ---------------- */

  r.get("/settings/ui", async (c) => c.json(await getUi(c.get("deps"))));

  r.put("/settings/ui", async (c) => {
    const b = await body(c, UiBody);
    const out = await saveUi(c.get("deps"), b);
    await audit(c, "settings.ui", { target: null, summary: { hidden: out.ui.hidden.join(","), dismissed: out.dismissed.length } });
    return c.json(out);
  });

  r.get("/audit", async (c) => c.json(await listAudit(c.get("deps"), query(c, AuditQuery))));

  r.get("/jobs", async (c) => {
    const deps = c.get("deps");
    return c.json({ ok: true, jobs: await jobsHealth(deps) });
  });

  r.post("/jobs/:name/run", async (c) => {
    const p = JobParam.safeParse({ name: c.req.param("name") });
    if (!p.success || !Object.prototype.hasOwnProperty.call(JOBS, p.data.name)) throw fail("no_such_job", 404);
    const deps = c.get("deps");
    let result: Record<string, unknown>;
    try {
      result = await runJob(deps, p.data.name);
    } catch (e) {
      await audit(c, "jobs.run", { target: p.data.name, summary: { failed: true } });
      throw fail("job_failed", 502, { detail: errorText(e) });
    }
    await audit(c, "jobs.run", { target: p.data.name, summary: {} });
    return c.json({ ok: true, name: p.data.name, result });
  });
}
