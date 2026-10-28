/**
 * ANALYTICS — what people do on the site, from our own events (not Meta's or Snap's, which a
 * large share of visitors block), in the original tab's last order (v446):
 *
 *   Live now                    who is on the site, where, how far along (LiveNow.tsx)
 *   the toolbar (one line, v411) Today · 7 days · 30 days · 90 days · All, the calendar (any two
 *                               days; it and the buttons release each other, v211), country,
 *                               platform, ads only / unpaid only (v408), the date caption
 *   KPIs                        Visits, Sessions, Carts started, Orders (the ledger's), Conversion
 *   Sessions by day             a line (by week past a quarter)
 *   Busy hours                  a typical day, hour by hour in Muscat time (v408)
 *   Added to cart · Visits by country (top 6)
 *   All events
 *   Source / Medium             sessions, orders, revenue and conversion per source (or campaign)
 *   Ad links                    the platforms' URL-parameter lines and a link builder (folded)
 *   Changes on the storefront   each publish with the orders before and after it (Changes.tsx)
 *   Tracking health · Errors and crashes (Health.tsx)
 *   Reset analytics data        at the foot
 *
 * The funnel and "orders by source" cards are not drawn: the owner had them removed (v446); the
 * server still answers both (`funnel`, `orders.origins`).
 *
 * ONE RANGE ON SCREEN, THE LAST ONE ASKED FOR (v209): every summary read is numbered and keyed by
 * its range and filters; an answer is drawn only under the view it was asked for, a change of
 * range empties every panel at once ("Loading…"), and a failed read shows "Not loaded." rather
 * than leaving the last range's figures up. A refresh of the same range keeps the figures until
 * the new ones replace them.
 */
import { setParams, useRoute } from "../../app/route";
import { useCatalogue } from "../../data/hooks";
import { resetAnalytics, statsSummary, type StatsSummary } from "../../data/insights";
import { invalidate, useQuery } from "../../data/query";
import { ask, Btn, Card, CardHead, DateRange, Kpi, Kpis, LineChart, Select, Seg, toast, type Range } from "../../kit";
import { COUNTRY_EN, explain } from "../../lib/words";
import { AdLinks, Busy, Rank, SourceMedium } from "./cards";
import { Changes } from "./Changes";
import { Errors, Tracking } from "./Health";
import { LiveNow } from "./LiveNow";
import {
  askOf, createSeq, dailyRows, eventRows, EV_LABEL, filterKey, ITEM_LABEL, kpisOf, notesOf, PAID, PLATFORMS, rangeName, RANGES, stampOf,
  statsParamsOf, statsViewOf, topCountries, viewKey, type StatsView,
} from "./stats";

/** every summary read takes a number (the original's STATS.seq) */
export const statsSeq = createSeq();

export interface Numbered {
  seq: number;
  /** the view it was asked for */
  view: string;
  data: StatsSummary;
}

export function Analytics() {
  const r = useRoute();
  const v = statsViewOf(r.params);
  const view = viewKey(v);
  const cat = useCatalogue();
  const q = useQuery<Numbered>("analytics:summary?" + view, async () => {
    const seq = statsSeq.next();
    const data = await statsSummary(askOf(v));
    return { seq, view, data };
  });
  // only an answer for the view on screen is drawn; the latest read of it, or nothing
  const ans = q.data && q.data.view === view ? q.data : null;
  const failed = !!q.error && !q.loading;
  const d = ans && !failed ? ans.data : null;
  const panel = d ? null : failed ? "Not loaded." : "Loading…";

  const go = (next: Partial<StatsView>) => setParams(statsParamsOf({ ...v, ...next }), false);
  const range: Range = v.range ? { pre: "", from: "", to: "" } : { pre: "", from: v.from, to: v.to };
  const markets = (cat.data?.data.countries || []).map((c) => c.code);
  const filtered = !!filterKey(v.filter);

  const reset = async () => {
    const yes = await ask({
      title: "Delete ALL analytics events?",
      text: "Every visit, click and step ever recorded is removed. This cannot be undone and there is no backup. Orders and customers are NOT affected.",
      ok: "Delete every event",
      danger: true,
    });
    if (!yes) return;
    try {
      await resetAnalytics();
      toast("Analytics cleared", true);
      await invalidate("analytics");
    } catch (e) {
      toast("Could not reset: " + explain(e));
    }
  };

  return (
    <div class="stats" data-seq={ans ? ans.seq : ""}>
      <LiveNow markets={markets} />

      <div class="toolbar stats-bar" role="group" aria-label="Range and filters">
        <Seg<string> label="Date range" value={v.range} options={RANGES} onChange={(x) => go({ range: x as StatsView["range"], from: "", to: "" })} />
        <DateRange
          value={range}
          presets={false}
          empty="Custom range"
          label="Custom range"
          onChange={(x) => (x.from && x.to ? go({ range: "", from: x.from, to: x.to }) : go({ range: "7", from: "", to: "" }))}
        />
        <span class={"stats-filter" + (filtered ? " on" : "")}>
          <Select sm label="Country" value={v.filter.country} onChange={(country) => go({ filter: { ...v.filter, country } })} options={[{ value: "", label: "All countries" }, ...(markets.length ? markets : Object.keys(COUNTRY_EN)).map((c) => ({ value: c, label: COUNTRY_EN[c] || c }))]} />
          <Select sm label="Platform" value={v.filter.platform} onChange={(platform) => go({ filter: { ...v.filter, platform } })} options={PLATFORMS} />
          <Select sm label="Paid or not" value={v.filter.paid} onChange={(paid) => go({ filter: { ...v.filter, paid: paid as StatsView["filter"]["paid"] } })} options={PAID} />
          {filtered ? <Btn sm kind="ghost" iconOnly icon="x" label="Clear filters" onClick={() => go({ filter: { country: "", platform: "", paid: "" } })} /> : null}
        </span>
        <span class="stamp spacer stats-stamp" aria-live="polite">
          {d ? stampOf(d) : rangeName(v) + (filtered ? " · filtered" : "")}
        </span>
      </div>

      {d && notesOf(d).length ? <p class="note">{notesOf(d).join(" ")}</p> : null}

      {d ? <StatsKpis d={d} /> : (
        <div class="kpis five">
          <p class="empty" style="grid-column:1/-1">{failed ? "Could not load: " + explain(q.error) : "Loading…"}</p>
        </div>
      )}

      <Card>
        <CardHead title={d && d.grain === "week" ? "Sessions by week" : "Sessions by day"} />
        <div class="chart sm">{d ? <LineChart rows={dailyRows(d)} unit="sessions" /> : <p class="chart-empty">{panel}</p>}</div>
      </Card>

      <Busy d={d} empty={panel} />

      <div class="grid-2">
        <Card>
          <CardHead title="Added to cart" />
          <Rank rows={d ? d.items : null} label={ITEM_LABEL} empty={panel} />
        </Card>
        <Card>
          <CardHead title="Visits by country" />
          <Rank rows={d ? topCountries(d) : null} label={COUNTRY_EN} alt empty={panel} />
        </Card>
      </div>

      <Card>
        <CardHead title="All events" />
        <Rank rows={d ? eventRows(d.events) : null} label={EV_LABEL} empty={panel} />
      </Card>

      <SourceMedium d={d} empty={panel} />
      <AdLinks />
      <Changes />
      <Tracking />
      <Errors />

      <p class="stats-foot">
        <Btn sm kind="danger" icon="trash" onClick={reset} title="Delete every analytics event (cannot be undone)">
          Reset analytics data
        </Btn>
      </p>
    </div>
  );
}

function StatsKpis({ d }: { d: StatsSummary }) {
  const k = kpisOf(d);
  return (
    <Kpis five label="Visitor figures">
      <Kpi icon="eye" tone="blue" label="Visits" value={String(k.visits)} />
      <Kpi icon="users" tone="violet" label="Sessions" value={String(k.sessions)} />
      <Kpi icon="cart" tone="brand" label="Carts started" value={String(k.carts)} />
      <Kpi icon="box" tone="leaf" label="Orders" value={String(k.orders)} />
      <Kpi icon="trend" tone="amber" label="Conversion" value={k.conversion} />
    </Kpis>
  );
}

