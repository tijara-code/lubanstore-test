/**
 * OVERVIEW — "Everything that needs your attention."
 *
 *   the warnings     the health check's warnings in words, dismissed by code on the server
 *                    (v408/v411); a missing key cannot be dismissed
 *   the KPI tiles    Orders ("N this week · ▲ x%"), Revenue settled (expected · net), Delivered,
 *                    Cancelled or failed ("x% of all orders") — the server's figures (GET
 *                    /overview, shared/kpi definitions over every order not in the trash)
 *   orders over time live orders per Muscat day, 7 / 30 / 90 days (30 by default)
 *   best sellers     the year's live orders, by quantity, valued in OMR (each line's share of
 *                    its order)
 *   latest orders    the six newest; a click opens the order on the Orders tab
 */
import { useState } from "preact/hooks";
import type { OrderListRow, OrdersAnswer, Warning } from "../../../shared/admin/api";
import * as KPI from "../../../shared/kpi";
import { navigate } from "../../app/route";
import { dismissWarnings, usePanelUi } from "../../app/panel";
import { listOrders } from "../../data/endpoints";
import { useOverview } from "../../data/hooks";
import { invalidate, useQuery } from "../../data/query";
import { Card, CardHead, Empty, Icon, Kpi, Kpis, LineChart, Pill, Seg, toast, type ChartRow } from "../../kit";
import { dayLabel, dtt, money } from "../../lib/format";
import { itemEn, lineName, orderTotal } from "../../lib/order";
import { explain, STATUS } from "../../lib/words";

/* ---------------- the warnings ---------------- */

const WARN: Record<string, string> = {
  thawani_uat_in_production: "Thawani in test mode on production. Set THAWANI_MODE=live.",
  omniful_hook_unsigned: "OMNIFUL_HOOK_SECRET not set. Empower status hook is closed.",
  thawani_webhook_secret_missing: "THAWANI_WEBHOOK_SECRET not set. Thawani webhooks are refused.",
  admin_password_missing: "ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) is not set.",
  admin_user_missing: "ADMIN_USER is not set.",
  session_secret_missing: "SESSION_SECRET is missing or shorter than 32 characters.",
  site_url_missing: "SITE_URL is not set: links in messages may point to the wrong site.",
  fake_services_in_production: "SERVICES_MODE=fake on production: payments and fulfilment are not real.",
};

export function warningText(w: Pick<Warning, "kind" | "what">): string {
  if (w.kind === "stale") return "Scheduled job not running on time: " + w.what + " (check its schedule and last run).";
  const px = /^pixel_failures:(\w+)$/.exec(w.what);
  if (px) return "Events to " + px[1] + " are failing (see Analytics › Tracking health).";
  const ig = /^env_value_ignored:(\w+)$/.exec(w.what);
  if (ig) return ig[1] + " has a value the server does not know, so it is treated as not set. Check it against docs/ENV.md.";
  return WARN[w.what] || w.what.replace(/_/g, " ");
}

/** The lines of the box: one per setting, the late jobs together on one. */
export function warningLines(list: Array<Pick<Warning, "kind" | "what">>): string[] {
  const late = list.filter((w) => w.kind === "stale").map((w) => w.what);
  const out = list.filter((w) => w.kind !== "stale").map(warningText);
  if (late.length === 1) out.push(warningText({ kind: "stale", what: late[0]! }));
  else if (late.length) out.push("Scheduled jobs not running on time: " + late.join(", ") + " (check their schedules and last runs).");
  return out;
}

export function Warnings({ warnings }: { warnings: Warning[] }) {
  const ui = usePanelUi();
  const shown = warnings.filter((w) => !(w.dismissible && ui.dismissed.indexOf(w.code) > -1));
  if (!shown.length) return null;
  const missing = shown.filter((w) => !w.dismissible);
  const can = shown.filter((w) => w.dismissible);
  const title = missing.length
    ? missing.length + (missing.length > 1 ? " settings need fixing" : " setting needs fixing") + " on the server"
    : shown.length + " warning" + (shown.length > 1 ? "s" : "") + " from the health check";
  return (
    <div class="stale" id="envBox" role="region" aria-label="Warnings" data-codes={shown.map((w) => w.code).join(" ")}>
      <Icon name="alert" />
      <div>
        <b>{title}</b>
        <ul>
          {warningLines(shown).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      {can.length ? (
        <button
          class="stale-x"
          type="button"
          aria-label="Dismiss these warnings"
          title="Dismiss until something changes"
          onClick={() =>
            dismissWarnings(can.map((w) => w.code)).then(
              () => invalidate("overview"),
              (e) => toast("Hidden for now. The dismissal could not be saved: " + explain(e)),
            )
          }
        >
          <Icon name="x" />
        </button>
      ) : null}
    </div>
  );
}

/* ---------------- the year's orders (chart, best sellers) ---------------- */

const YEAR_PAGES = 10;
const PAGE = 500;

/** Every order of the last year, not binned, newest first (500 a call, at most 5,000). */
async function yearOrders(now: number): Promise<{ rows: OrderListRow[]; capped: boolean }> {
  const from = KPI.shiftDay(KPI.todayMuscat(now), -364);
  const rows: OrderListRow[] = [];
  for (let p = 0; p < YEAR_PAGES; p++) {
    const a = (await listOrders({ from, limit: PAGE, offset: p * PAGE })) as OrdersAnswer;
    rows.push(...a.orders);
    if (rows.length >= a.total || !a.orders.length) return { rows, capped: false };
  }
  return { rows, capped: true };
}

export interface Seller {
  key: string;
  name: string;
  qty: number;
  omr: number;
}

/** The best sellers: live orders' lines by quantity, each valued at its share of the order's OMR. */
export function bestSellers(list: readonly OrderListRow[], n = 6): Seller[] {
  const map: Record<string, Seller> = {};
  for (const o of list) {
    if (!KPI.isLive(o as unknown as Record<string, unknown>)) continue;
    const rate = Number(o.total) > 0 ? (Number(o.omr) || 0) / Number(o.total) : 0;
    for (const i of o.items || []) {
      const k = String(i.itemId || lineName(i));
      const s = (map[k] = map[k] || { key: k, name: itemEn(i) || lineName(i), qty: 0, omr: 0 });
      s.qty += Number(i.qty) || 0;
      s.omr += (Number(i.price) || 0) * (Number(i.qty) || 0) * rate;
    }
  }
  return Object.values(map)
    .sort((a, b) => b.qty - a.qty || b.omr - a.omr)
    .slice(0, n)
    .map((s) => ({ ...s, omr: Math.round(s.omr * 1000) / 1000 }));
}

/** Live orders per Muscat day over the last `days` days, oldest first. */
export function chartRows(list: readonly OrderListRow[], days: number, now: number): ChartRow[] {
  const by = KPI.byDay(list as unknown as Array<Record<string, unknown>>, KPI.window.days(days, now));
  return Object.keys(by)
    .sort()
    .map((d) => ({ label: dayLabel(d), n: by[d]! }));
}

/* ---------------- the page ---------------- */

export function Overview() {
  const q = useOverview();
  const [days, setDays] = useState(30);
  const year = useQuery("overview:year", () => yearOrders(Date.now()));
  const latest = useQuery("orders:latest", async () => ((await listOrders({ limit: 6 })) as OrdersAnswer).orders);
  const o = q.data;

  const k = o?.orders.all;
  const week = o?.orders.week;
  const d = o?.orders.delta ?? 0;

  // 7 and 30 days from the server's own count; 90 from the year's orders
  let rows: ChartRow[] | null = null;
  if (days <= 30 && o) {
    const by = o.orders.byDay;
    rows = Object.keys(by)
      .sort()
      .slice(-days)
      .map((day) => ({ label: dayLabel(day), n: by[day]! }));
  } else if (year.data) rows = chartRows(year.data.rows, days, Date.now());

  const top = year.data ? bestSellers(year.data.rows) : null;

  return (
    <>
      <div class="overview-head">
        <span class="eyebrow">Store snapshot</span>
        <h2>Everything that needs your attention.</h2>
      </div>

      {o ? <Warnings warnings={o.warnings} /> : null}

      {k && week ? (
        <Kpis label="Key figures">
          <Kpi icon="box" tone="blue" label="Orders" value={String(k.orders)} delta={week.orders + " this week · " + (d >= 0 ? "▲ " : "▼ ") + Math.abs(d) + "%"} up={d >= 0} />
          <Kpi
            dark
            icon="coin"
            tone="brand"
            label="Revenue settled"
            value={money(k.settled, "OMR")}
            delta={[k.expected ? money(k.expected, "OMR") + " expected" : "", k.net !== k.settled ? "net " + money(k.net, "OMR") : ""].filter(Boolean).join(" · ")}
          />
          <Kpi icon="check" tone="leaf" label="Delivered" value={String(k.delivered)} />
          <Kpi icon="x" tone="red" label="Cancelled or failed" value={String(k.cancelled)} delta={k.total ? k.cancelledPct + "% of all orders" : ""} up={false} />
        </Kpis>
      ) : (
        <div class="kpis">
          <p class="empty" style="grid-column:1/-1">{q.error ? "Could not read the figures: " + explain(q.error) : "Loading…"}</p>
        </div>
      )}

      <div class="grid-3">
        <Card>
          <CardHead title="Orders over time">
            <Seg
              label="Range"
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: "7d" },
                { value: 30, label: "30d" },
                { value: 90, label: "90d" },
              ]}
            />
          </CardHead>
          <div class="chart" id="chart">
            {rows ? <LineChart rows={rows} unit="orders" /> : <p class="chart-empty">{year.error ? explain(year.error) : "Loading…"}</p>}
          </div>
        </Card>

        <Card>
          <CardHead title="Best sellers">{year.data?.capped ? <span class="stamp">Newest 5,000 orders</span> : <span class="stamp">Last 12 months</span>}</CardHead>
          <div id="topBox">
            {top ? (
              top.length ? (
                top.map((r, i) => (
                  <div class="mini" key={r.key}>
                    <span class="rank-i hi">{i + 1}</span>
                    <div class="grow">
                      <b dir="auto">{r.name}</b>
                      <span>{r.qty} sold</span>
                    </div>
                    <span class="val">{money(r.omr, "OMR")}</span>
                  </div>
                ))
              ) : (
                <Empty>No sales yet.</Empty>
              )
            ) : (
              <Empty>{year.error ? explain(year.error) : "Loading…"}</Empty>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Latest orders">
          <button class="btn sm primary" type="button" data-goto="orders" onClick={() => navigate("orders")}>
            View all
          </button>
        </CardHead>
        <div id="lastBox">
          {latest.data ? (
            latest.data.length ? (
              latest.data.map((r) => (
                <button type="button" class="mini" key={r.id} onClick={() => navigate("orders", { q: r.id, open: r.id })} aria-label={"Open order " + r.id}>
                  <span class="rank-i">
                    <Icon name={r.pay === "card" ? "card" : "cash"} />
                  </span>
                  <div class="grow">
                    <b dir="auto">{r.name || "—"}</b>
                    <span>
                      {r.id} · {dtt(r.createdAt)}
                    </span>
                  </div>
                  <span class="val">{money(orderTotal(r), r.cur)}</span>
                  <Pill tone={r.status}>{STATUS[r.status] || r.status}</Pill>
                </button>
              ))
            ) : (
              <Empty>No orders yet.</Empty>
            )
          ) : (
            <Empty>{latest.error ? explain(latest.error) : "Loading…"}</Empty>
          )}
        </div>
      </Card>
    </>
  );
}
