/**
 * The foot of the Analytics tab, read together with the change log ("something broke and
 * something changed on the same afternoon"):
 *
 *   Tracking health (v331)   per platform: wired or not, the last send that landed, TODAY's
 *                            failures (Muscat day, v334), the last error, the match fields the
 *                            last Purchase carried (names only) — from GET /health
 *   Errors and crashes       script errors on shoppers' phones and server failures, grouped by
 *                            message (the same error forty times is one line) with the orders
 *                            it touched, where, which browsers, when last; a row opens its
 *                            newest detail. Window (today / 7 / 30 days) and side (page,
 *                            server). CSV: every raw row of the window, oldest first, with the
 *                            stack and the full user agent (GET /analytics/errors.csv), the
 *                            window and side as they are when it is pressed.
 */
import { useState } from "preact/hooks";
import { health, logsCsvUrl, logsList, type LogGroup, type PxRecord } from "../../data/insights";
import { useQuery } from "../../data/query";
import { Icon, Pill, Select } from "../../kit";
import { dtt } from "../../lib/format";
import { explain } from "../../lib/words";

/* ---------------- tracking health ---------------- */

const PLATFORMS: Array<["meta" | "snap" | "ga4", string]> = [
  ["meta", "Meta"],
  ["snap", "Snapchat"],
  ["ga4", "GA4"],
];

export function wiredWord(p: "meta" | "snap" | "ga4", px: { pixel?: boolean; capi?: boolean; id?: boolean; mp?: boolean } | undefined): string {
  if (!px) return "—";
  if (p === "ga4") return px.id ? (px.mp ? "gtag + server purchase" : "gtag only") : "off";
  return px.pixel ? (px.capi ? "pixel + CAPI" : "pixel only") : "off";
}

export function Tracking() {
  const q = useQuery("analytics:health", () => health());
  const h = q.data;
  const bad = h && h.tracking ? PLATFORMS.filter(([k]) => (h.tracking![k]?.failedToday || 0) > 0).length : 0;
  return (
    <section class="card flush" id="pxCard" aria-label="Tracking health">
      <div class="card-head">
        <h2>Tracking health</h2>
        <span class="stamp">{h ? (bad ? bad + " platform" + (bad > 1 ? "s" : "") + " with failures today" : "no failures today") : ""}</span>
      </div>
      <div class="tablewrap">
        <table class="tbl px-tbl">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Wired</th>
              <th>Last sent</th>
              <th class="num">Failed today</th>
              <th class="hide-sm">Last error</th>
              <th class="hide-sm">Last Purchase carried</th>
            </tr>
          </thead>
          <tbody>
            {h ? (
              PLATFORMS.map(([k, name]) => {
                const s: PxRecord | null = h.tracking ? h.tracking[k] : null;
                const failed = s ? s.failedToday || 0 : 0;
                return (
                  <tr key={k}>
                    <td>
                      <b>{name}</b>
                    </td>
                    <td>{wiredWord(k, h.pixels ? h.pixels[k] : undefined)}</td>
                    <td>
                      {s && s.lastOkAt ? (
                        <>
                          {dtt(s.lastOkAt)} {s.lastEvent ? <small>{s.lastEvent}</small> : null}
                        </>
                      ) : (
                        <span class="muted">—</span>
                      )}
                    </td>
                    <td class="num">{failed ? <Pill tone="red">{failed}</Pill> : "0"}</td>
                    <td class="hide-sm">
                      <small>{s && s.lastError ? s.lastError : ""}</small>
                    </td>
                    <td class="hide-sm">
                      <small>{s && s.purchase && s.purchase.fields ? s.purchase.fields.join(", ") : ""}</small>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} class="empty">
                  {q.error ? "Could not read the tracking health: " + explain(q.error) : "Loading…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- errors and crashes ---------------- */

const SIDES = [
  { value: "", label: "Page and server" },
  { value: "browser", label: "On the page" },
  { value: "server", label: "In the functions" },
];
const DAYS = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

/** the three biggest, "×n" when more than once */
const top = (list: string[]) => list.slice(0, 3).join(", ") + (list.length > 3 ? " …" : "");

export function Errors() {
  const [days, setDays] = useState("7");
  const [side, setSide] = useState<"" | "server" | "browser">("");
  const [open, setOpen] = useState("");
  // keyed by the window and side: never another window's rows under this one's heading (v209)
  const q = useQuery("analytics:errors?days=" + days + "&side=" + side, () => logsList(Number(days), side));
  const d = q.data;
  const groups: LogGroup[] = d ? d.groups : [];
  const client = d ? d.rows.filter((r) => r.side === "browser").length : 0;
  const n = d ? d.rows.length : 0;
  const dayWord = days === "1" ? "day" : "days";
  return (
    <section class="card flush" id="logsCard" aria-label="Errors and crashes">
      <div class="card-head filters">
        <h2>Errors and crashes</h2>
        <span class="stamp">{d ? (n ? n + (d.capped ? "+" : "") + " in " + days + " " + dayWord + " · " + client + " on the page · " + (n - client) + " in the functions" : "Nothing logged in " + days + " " + dayWord) : ""}</span>
        <Select sm label="Side" value={side} onChange={(x) => (setSide(x as "" | "server" | "browser"), setOpen(""))} options={SIDES} />
        <Select sm label="Window" value={days} onChange={(x) => (setDays(x), setOpen(""))} options={DAYS} />
        <a class="btn sm" href={logsCsvUrl(Number(days), side)} download={"errors-" + days + "d.csv"} aria-label="Export every error in this window as CSV">
          <Icon name="download" />
          <span>CSV</span>
        </a>
      </div>
      <div class="tablewrap">
        <table class="tbl logs-tbl">
          <thead>
            <tr>
              <th>Message</th>
              <th class="num">Times</th>
              <th class="hide-sm">Where</th>
              <th class="hide-sm">Browsers</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {!d ? (
              <tr>
                <td colSpan={5} class="empty">
                  {q.error ? "Could not load the logs: " + explain(q.error) : "Loading…"}
                </td>
              </tr>
            ) : !groups.length ? (
              <tr>
                <td colSpan={5} class="empty">
                  Nothing to show. That is the good outcome.
                </td>
              </tr>
            ) : (
              groups.map((g) => {
                const rows = d.rows.filter((r) => r.side + "|" + r.kind + "|" + r.message === g.key);
                const places = [...new Set(rows.map((r) => r.path || "").filter(Boolean))];
                const newest = rows[0];
                const isOpen = open === g.key;
                return [
                  <tr key={g.key} class={"row" + (isOpen ? " open-row" : "")} data-log={g.key} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : g.key)}>
                    <td class="log-msg">
                      <Pill tone={g.side === "server" ? "red" : "amber"}>{g.side === "server" ? g.kind || "server" : g.kind || "page"}</Pill> <span dir="auto">{g.message}</span>
                      {g.orderIds.length ? <small class="log-orders">{top(g.orderIds)}</small> : null}
                    </td>
                    <td class="num">{g.n}</td>
                    <td class="hide-sm">{top(places) || "—"}</td>
                    <td class="hide-sm">{top(g.browsers) || (g.side === "server" ? "server" : "—")}</td>
                    <td class="num">{dtt(g.last)}</td>
                  </tr>,
                  isOpen ? (
                    <tr key={g.key + ":d"} class="detail">
                      <td colSpan={5}>
                        <pre class="logpre" dir="ltr">
                          {(newest && newest.detail) || "(no detail)"}
                        </pre>
                      </td>
                    </tr>
                  ) : null,
                ];
              })
            )}
          </tbody>
        </table>
      </div>
      {d && d.capped ? <p class="hint logs-note">The newest {d.cap} rows only: the CSV has the whole window.</p> : null}
    </section>
  );
}
