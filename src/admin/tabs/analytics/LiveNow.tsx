/**
 * LIVE NOW (v338, v446) — who did something on the site lately, where from, and the furthest
 * step each has reached on the way to an order: landed → viewing a box → in the cart → at
 * checkout → ordered. Its own window, apart from the range below: the last hour (the default),
 * three, six, or today (since Muscat's midnight). Asked again every 15 s, and only while the
 * Analytics tab is open (this card is mounted) and the browser tab is in view.
 *
 *   the step chips   the five steps' counts and their share; a chip shows only that step
 *   the map          the Gulf or the world (the outlines load once, lazily, from
 *                    /admin/live-map.json: Natural Earth at 10 units a degree); one pin per
 *                    place, sized by its visitors, coloured by the furthest step (one blue, light
 *                    to dark); a visitor with no city is pinned to their country's middle
 *   the list         newest first: place, how long ago, the step and the finer word, the source
 *
 * Tooltips are drawn as text, never markup. No session id reaches the panel.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { liveVisitors, type LiveAnswer, type LiveVisitor } from "../../data/insights";
import { useQuery } from "../../data/query";
import { Seg } from "../../kit";
import {
  createSeq, liveAge, liveLine, LIVE_COLOR, LIVE_EVERY, LIVE_STEPS, LIVE_VIEWS, LIVE_WINDOWS, livePlace, liveSpan, pinGroups, pinSize, pinXY, regionName,
  type MapCountry, type PinGroup,
} from "./stats";

export const MAP_URL = "/admin/live-map.json";
const MAX_ROWS = 60;

let mapRead: Promise<MapCountry[]> | null = null;
/** The outlines, read once (an unreadable file draws no land, and the pins still place by city). */
export function loadMap(): Promise<MapCountry[]> {
  if (!mapRead) {
    mapRead = fetch(MAP_URL, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { c: [] }))
      .then((m: { c?: MapCountry[] }) => (Array.isArray(m.c) ? m.c : []))
      .catch(() => [] as MapCountry[]);
  }
  return mapRead;
}
/** tests: forget the outlines */
export function forgetMap(): void {
  mapRead = null;
}

export const liveSeq = createSeq();

interface LiveRead {
  seq: number;
  /** the window it was asked for */
  min: string;
  a: LiveAnswer;
  /** when it came back (the "Updated" stamp) */
  got: number;
}

export function LiveNow({ markets }: { markets: string[] }) {
  const [min, setMin] = useState("60");
  const [view, setView] = useState<"gulf" | "world">("gulf");
  const [only, setOnly] = useState(-1);
  const [map, setMap] = useState<MapCountry[] | null>(null);
  const [tip, setTip] = useState<string | null>(null);

  const q = useQuery<LiveRead>("analytics:live?" + min, async () => {
    const seq = liveSeq.next();
    const a = await liveVisitors(min === "today" ? "today" : Number(min));
    return { seq, min, a, got: Date.now() };
  });

  /* the outlines, once the tab is open */
  useEffect(() => {
    let live = true;
    void loadMap().then((m) => live && setMap(m));
    return () => {
      live = false;
    };
  }, []);

  /* every 15 s while the page is in view; back in view after a while: at once */
  const refetch = q.refetch;
  const got = useRef(0);
  got.current = q.data ? q.data.got : 0;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      timer = setTimeout(() => {
        void refetch("auto").finally(arm);
      }, LIVE_EVERY);
    };
    const onVis = () => {
      if (document.hidden) {
        clearTimeout(timer);
        setTip(null);
        return;
      }
      if (Date.now() - got.current >= LIVE_EVERY) void refetch("auto").finally(arm);
      else arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [min, refetch]);

  const read = q.data && q.data.min === min ? q.data : null;
  const d = read ? read.a : null;
  const stale = !!q.error;
  const now = d ? Date.parse(d.at) || Date.now() : Date.now();
  const all: LiveVisitor[] = d ? d.visitors || [] : [];
  const shown = only < 0 ? all : all.filter((v) => v.step === only);
  const steps = d ? d.steps || [0, 0, 0, 0, 0] : [0, 0, 0, 0, 0];
  const vb = LIVE_VIEWS[view];
  const outlines = map || [];
  const mk = new Set(markets);
  const { groups, unplaced } = pinGroups(all, outlines, now);
  let off = 0;
  const pins: Array<{ g: PinGroup; x: number; y: number }> = [];
  for (const g of groups) {
    const xy = pinXY(g.ll, vb);
    if (!xy) off += g.n;
    else pins.push({ g, ...xy });
  }
  const tipped = tip ? pins.find((p) => p.g.key === tip) : null;

  const notes: string[] = [];
  if (d && d.geo === false) notes.push("Pinned by country: the events carry no city yet.");
  if (d && d.capped) notes.push("Showing the 300 most recent visitors.");

  return (
    <section class={"card live" + (stale ? " is-stale" : "")} id="liveCard" aria-label="Live now">
      <div class="card-head filters">
        <h2>
          <span class="live-dot" aria-hidden="true" />
          Live now
        </h2>
        <span class="live-n" aria-live="polite">
          {d ? all.length + (all.length === 1 ? " visitor" : " visitors") : "–"}
        </span>
        <div class="seg" role="group" aria-label="Active in the last">
          {LIVE_WINDOWS.map((w) => (
            <button key={w.value} type="button" aria-pressed={w.value === min} title={w.title} data-live-min={w.value} onClick={() => (setMin(w.value), setTip(null))}>
              {w.label}
            </button>
          ))}
        </div>
        <Seg
          label="Map view"
          value={view}
          onChange={(x) => (setView(x), setTip(null))}
          options={[
            { value: "gulf", label: "Gulf" },
            { value: "world", label: "World" },
          ]}
        />
        <span class="stamp spacer">{stale ? "Could not refresh. Trying again shortly." : read ? "Updated " + new Date(read.got).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</span>
      </div>

      <div class={"live-steps" + (only > -1 ? " filtered" : "")} role="group" aria-label="Journey step (tap to show only that step)">
        {LIVE_STEPS.map((s, i) => {
          const n = steps[i] || 0;
          const pc = all.length ? Math.round((n * 100) / all.length) + "%" : "";
          return (
            <button key={i} class="live-step" type="button" data-live-step={i} aria-pressed={only === i} onClick={() => setOnly(only === i ? -1 : i)}>
              <b>{n}</b>
              <span>
                <i style={{ background: LIVE_COLOR[i] }} />
                {s[0]}
              </span>
              <em>{pc ? pc + " · " + s[1] : s[1]}</em>
            </button>
          );
        })}
      </div>

      <div class="live-body">
        <div class="live-map" data-view={view}>
          <svg viewBox={vb.join(" ")} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
            {outlines.map((c, i) => (
              <path key={c.a + i} class={mk.has(c.a) ? "mkt" : undefined} d={c.d} />
            ))}
          </svg>
          <div class={"live-pins" + (only > -1 ? " filtered" : "")}>
            {pins.map(({ g, x, y }) => {
              const size = pinSize(g.n);
              const dim = only > -1 && !g.steps[only];
              const label = g.name + ": " + g.n + (g.n === 1 ? " visitor" : " visitors") + ", furthest " + LIVE_STEPS[g.best]![0].toLowerCase();
              const style = { left: x.toFixed(2) + "%", top: y.toFixed(2) + "%", width: size + "px", height: size + "px", background: LIVE_COLOR[g.best], "--pin": LIVE_COLOR[g.best] };
              return (
                <button
                  key={g.key}
                  type="button"
                  class={"live-pin" + (g.best === 0 ? " light" : "") + (g.fresh ? " now" : "") + (dim ? " dim" : "")}
                  data-live-pin={g.key}
                  aria-label={label}
                  style={style}
                  onMouseEnter={() => setTip(g.key)}
                  onFocus={() => setTip(g.key)}
                  onClick={() => setTip(g.key)}
                  onMouseLeave={() => setTip(null)}
                  onBlur={() => setTip(null)}
                >
                  {g.n > 1 ? g.n : ""}
                </button>
              );
            })}
          </div>
          {tipped ? <LiveTip g={tipped.g} x={tipped.x} y={tipped.y} /> : null}
          {off && view !== "world" ? (
            <p class="live-off">
              {off + (off === 1 ? " visitor" : " visitors") + " outside this view"} ·{" "}
              <button type="button" onClick={() => setView("world")}>
                Show world
              </button>
            </p>
          ) : unplaced > 0 && map ? (
            <p class="live-off">{unplaced + (unplaced === 1 ? " visitor" : " visitors") + " with no known place"}</p>
          ) : null}
        </div>

        <div class="live-list" aria-label="Visitors" role="list">
          {!d ? (
            <p class="live-empty">{stale ? "Could not read who is on the site." : "Loading…"}</p>
          ) : !shown.length ? (
            <p class="live-empty">{all.length ? "Nobody at this step right now." : d.today ? "No one on the site today." : "No one on the site in the last " + liveSpan(d.minutes) + "."}</p>
          ) : (
            <>
              {shown.slice(0, MAX_ROWS).map((v) => {
                const p = livePlace(v, outlines);
                const place = p ? p.name : (v.city ? v.city + ", " : "") + regionName(v.country);
                const age = now - Date.parse(v.last);
                return (
                  <div key={v.k} class={"live-row" + (age < 60e3 ? " hot" : "")} role="listitem">
                    <i style={{ background: LIVE_COLOR[v.step] }} title={LIVE_STEPS[v.step]?.[0]} />
                    <span class="w">{place}</span>
                    <span class="t">{liveAge(age)}</span>
                    <span class="d">
                      {liveLine(v)}
                      {v.src ? <em> · {v.src}</em> : null}
                    </span>
                  </div>
                );
              })}
              {shown.length > MAX_ROWS ? <p class="live-more">and {shown.length - MAX_ROWS} more</p> : null}
            </>
          )}
        </div>
      </div>
      {notes.length ? <p class="note">{notes.join(" ")}</p> : null}
    </section>
  );
}

/** The pin's tooltip: its place, how many, and how many at each step — as text. */
function LiveTip({ g, x, y }: { g: PinGroup; x: number; y: number }) {
  return (
    <div class={"live-tip" + (y < 30 ? " below" : "") + (x < 20 ? " left" : x > 80 ? " right" : "")} role="tooltip" style={{ left: x + "%", top: y + "%" }}>
      <strong>{g.name + (g.country ? " (country)" : "")}</strong>
      <div>{g.n + (g.n === 1 ? " visitor" : " visitors")}</div>
      {g.steps.map((n, i) =>
        n ? (
          <div class="tip-row" key={i}>
            <i style={{ background: LIVE_COLOR[i] }} />
            <b>{n}</b>
            <span>{LIVE_STEPS[i]![0]}</span>
          </div>
        ) : null,
      )}
    </div>
  );
}
