/**
 * The Analytics tab's smaller cards: the ranks (a bar per row), Busy hours, Source / Medium and
 * Ad links. Each takes the summary (or null while it loads, with the panel's word for why).
 */
import { useState } from "preact/hooks";
import { AD_LINK_TEMPLATES, LINK_MEDIUMS, LINK_SOURCES, utmLink, utmWord } from "../../../shared/attribution";
import type { StatsSummary } from "../../data/insights";
import { Btn, copyText, Fold, Seg, toast } from "../../kit";
import { money } from "../../lib/format";
import { busyNote, busyValues, DOW, DOW_LONG, hourWord, busyNum, muscatClock, pct, rateWord, SM_NOTE, type RankRow } from "./stats";

/* ---------------- a rank ---------------- */

export function Rank({ rows, label, alt, empty }: { rows: RankRow[] | null; label?: Record<string, string>; alt?: boolean; empty: string | null }) {
  if (!rows) return <p class="empty">{empty}</p>;
  if (!rows.length) return <p class="empty">No data yet.</p>;
  const max = rows[0]!.n || 1;
  return (
    <div class="rank">
      {rows.map((r) => (
        <div class="rank-row" key={r.key}>
          <span class="rank-k" dir="auto">
            {label ? label[r.key] || r.key : r.key}
          </span>
          <span class={"rank-bar" + (alt ? " alt" : "")} aria-hidden="true">
            <i style={{ width: pct(r.n, max) + "%" }} />
          </span>
          <b class="rank-n">{r.n}</b>
        </div>
      ))}
    </div>
  );
}

/* ---------------- busy hours (v408) ---------------- */

const AXIS = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"];

/**
 * BUSY HOURS — Google Maps' "Popular times" for the shop: a typical day of the chosen weekday
 * (today's first), hour by hour in Muscat time, visitors or live orders, from the range and the
 * filters above. The hour now is red; the busiest stands out.
 */
export function Busy({ d, empty, now = Date.now() }: { d: StatsSummary | null; empty: string | null; now?: number }) {
  const clock = muscatClock(now);
  const [day, setDay] = useState<number>(clock.dow);
  const [what, setWhat] = useState<"visits" | "orders">("visits");
  const b = d ? d.busy : null;
  const v = busyValues(b, what, day);
  const max = Math.max(...v.vals);
  const unit = what === "orders" ? "orders" : "visitors";
  const on = day < 0 ? "a typical day" : "a typical " + DOW_LONG[day];
  const hereNow = day < 0 || day === clock.dow;
  const note = b ? busyNote(v.vals, v.days, day, unit) : null;
  return (
    <section class="card" id="busyCard" aria-label="Busy hours">
      <div class="card-head filters">
        <h2>Busy hours</h2>
        <span class="stamp">{b && v.days ? "Average of " + v.days + " " + (day < 0 ? "day" : DOW_LONG[day]) + (v.days === 1 ? "" : "s") + " · Muscat time" : ""}</span>
        <Seg
          label="Count"
          value={what}
          onChange={setWhat}
          options={[
            { value: "visits", label: "Visitors" },
            { value: "orders", label: "Orders" },
          ]}
        />
      </div>
      <div class="busy-days" role="group" aria-label="Day of the week">
        {[-1, 0, 1, 2, 3, 4, 5, 6].map((i) => (
          <button key={i} type="button" aria-pressed={i === day} class={i === clock.dow ? "today" : undefined} title={i === clock.dow ? "Today" : undefined} onClick={() => setDay(i)}>
            {i < 0 ? "Every day" : DOW[i]}
          </button>
        ))}
      </div>
      {b ? (
        <>
          <div class="busy-bars" role="img" aria-label={"Busy hours, " + unit + " on " + on + ", Muscat time"}>
            {v.vals.map((x, h) => {
              const height = max > 0 ? Math.max(2, Math.round((x / max) * 100)) : 2;
              const cls = [x === 0 ? "zero" : "", max > 0 && x === max ? "peak" : "", hereNow && h === clock.hour ? "now" : ""].filter(Boolean).join(" ");
              const tip = hourWord(h) + "–" + hourWord((h + 1) % 24) + " · " + busyNum(x) + " " + unit + " on " + on + (hereNow && h === clock.hour ? " · now" : "");
              return <i key={h} class={cls || undefined} style={{ height: height + "%" }} title={tip} data-hour={h} />;
            })}
          </div>
          <div class="busy-axis" aria-hidden="true">
            {AXIS.map((a) => (
              <span key={a}>{a}</span>
            ))}
          </div>
          <p class="note busy-note">{note ? note.text : ""}</p>
        </>
      ) : (
        <p class="empty">{empty}</p>
      )}
    </section>
  );
}

/* ---------------- source / medium (v302) ---------------- */

/**
 * SOURCE / MEDIUM — one row per source / medium (or per campaign): sessions from their
 * session_start, orders from the order's attribution, revenue and conversion over LIVE orders.
 */
export function SourceMedium({ d, empty }: { d: StatsSummary | null; empty: string | null }) {
  const [by, setBy] = useState<"sm" | "camp">("sm");
  const sm = d ? d.sourceMedium : null;
  const rows = sm ? (by === "camp" ? sm.campaigns : sm.rows) || [] : [];
  return (
    <section class="card flush" id="smCard" aria-label="Source / Medium">
      <div class="card-head filters">
        <h2>Source / Medium</h2>
        <span class="stamp">{sm && sm.sessionsFrom ? "sessions since " + sm.sessionsFrom : ""}</span>
        <Seg
          label="Group by"
          value={by}
          onChange={setBy}
          options={[
            { value: "sm", label: "Source / Medium" },
            { value: "camp", label: "Campaign" },
          ]}
        />
      </div>
      <div class="tablewrap">
        <table class="tbl sm-tbl">
          <thead>
            <tr>
              <th>{by === "camp" ? "Source / Medium / Campaign" : "Source / Medium"}</th>
              <th class="num">Sessions</th>
              <th class="num">Orders</th>
              <th class="num hide-sm">Revenue</th>
              <th class="num">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {!sm ? (
              <tr>
                <td colSpan={5} class="empty">
                  {empty}
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={5} class="empty">
                  {by === "camp" ? "No tagged campaigns in this window." : "Nothing in this window."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const key = r.source + " / " + r.medium;
                const note = by === "camp" ? "" : SM_NOTE[key] || "";
                return (
                  <tr key={r.key}>
                    <td>
                      <span class="sm-k" dir="auto">
                        {key}
                        {r.campaign ? <span class="sm-c"> / {r.campaign}</span> : null}
                      </span>
                      {note ? <em class="sub">{note}</em> : null}
                    </td>
                    <td class="num">{r.sessions || 0}</td>
                    <td class="num">
                      {r.live}
                      {r.n > r.live ? <em class="sub">of {r.n}</em> : null}
                    </td>
                    <td class="num hide-sm">{money(r.omr, "OMR")}</td>
                    <td class="num">{rateWord(r.rate)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- ad links (v302) ---------------- */

const copy = (text: string, done: string) =>
  copyText(text).then(
    () => toast(done, true),
    () => toast("Copy not available"),
  );

const MEDIUM_WORD: Record<string, string> = {
  social: "social (bio, story, post)",
  message: "message (WhatsApp, broadcast)",
  influencer: "influencer",
  email: "email",
  paid_social: "paid_social",
  cpc: "cpc",
};

/**
 * AD LINKS — the tagging standard as the line each platform takes in its ad's URL parameters
 * (the platform fills the names in itself), and a builder for links that are not ads.
 */
export function AdLinks() {
  const [page, setPage] = useState("/");
  const [source, setSource] = useState<string>(LINK_SOURCES[0]);
  const [medium, setMedium] = useState<string>(LINK_MEDIUMS[0]);
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const ok = !!utmWord(campaign);
  const link = ok ? utmLink({ origin: location.origin, page, source, medium, campaign, content }) : "";
  return (
    <Fold title="Ad links" stamp="one standard for every link">
      <p class="hint">
        Paste each line into the ad's <b>URL parameters</b> (bulk edit a campaign). Names fill in automatically. Use lower case and <b>_</b>.
      </p>
      <div class="utm-tpls">
        {AD_LINK_TEMPLATES.map((t) => (
          <div class="utm-tpl" key={t.platform}>
            <div class="utm-k">
              <b>{t.platform}</b>
              <span>{t.where}</span>
            </div>
            <code dir="ltr">{t.line}</code>
            <Btn sm onClick={() => copy(t.line, t.platform + " line copied")} label={"Copy the " + t.platform + " line"}>
              Copy
            </Btn>
          </div>
        ))}
      </div>
      <h3 class="utm-h">A link that is not an ad</h3>
      <div class="utm-build">
        <label>
          <span>Page</span>
          <select class="pick sm" value={page} onChange={(e) => setPage((e.currentTarget as HTMLSelectElement).value)}>
            <option value="/">Store, Arabic</option>
            <option value="/en/">Store, English</option>
          </select>
        </label>
        <label>
          <span>Source</span>
          <select class="pick sm" value={source} onChange={(e) => setSource((e.currentTarget as HTMLSelectElement).value)}>
            {LINK_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Medium</span>
          <select class="pick sm" value={medium} onChange={(e) => setMedium((e.currentTarget as HTMLSelectElement).value)}>
            {LINK_MEDIUMS.map((m) => (
              <option key={m} value={m}>
                {MEDIUM_WORD[m] || m}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Campaign</span>
          <input type="text" value={campaign} placeholder="national_day_2026" autocomplete="off" spellcheck={false} onInput={(e) => setCampaign((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>
          <span>
            Content <em>optional</em>
          </span>
          <input type="text" value={content} placeholder="bio_link" autocomplete="off" spellcheck={false} onInput={(e) => setContent((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="utm-out">
        <code dir="ltr" class={ok ? undefined : "muted"} aria-live="polite">
          {ok ? link : "Name the campaign to make the link."}
        </code>
        <Btn sm kind="primary" disabled={!ok} onClick={() => copy(link, "Link copied")}>
          Copy link
        </Btn>
      </div>
    </Fold>
  );
}

