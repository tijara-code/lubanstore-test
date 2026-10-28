/**
 * CHARTS — small hand-drawn SVG, no chart library (the CSP stays tight and nothing third-party
 * loads in the panel). Ported from the original's lineChart / barChart:
 *
 *   <LineChart rows={[{ label, n }]} unit="orders" />   a shape over time
 *   <BarChart  rows={[{ label, n }]} unit="OMR" />      a quantity per day (a day with nothing
 *                                                        in it still answers a hover)
 *
 * The svg has a viewBox and no fixed width, so it scales to its card; strokes do not thicken.
 * The y axis ends on a round number; a count gets whole-number gridlines. The x labels are
 * counted back from the last day (today is always labelled) and kept inside the frame.
 */
import type { ComponentChildren } from "preact";

export interface ChartRow {
  label: string;
  n: number;
}

const CH = { W: 620, H: 210, PL: 38, PR: 12, PT: 14, PB: 28 };
const r1 = (n: number) => Math.round(n * 10) / 10;
const trim = (n: number) => (n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(Math.round(n * 10) / 10));

/** 0–1 → 1, 7 → 7, 23 → 25, 470 → 500 (the original's rounding): always ≥ 1, so a chart of zeroes still has an axis. */
export function niceMax(v: number): number {
  const x = Math.max(1, Math.ceil(Number(v) || 0));
  const mag = Math.pow(10, Math.floor(Math.log(x) / Math.LN10));
  const step = mag / 2 || 1;
  return Math.ceil(x / step) * step;
}

/** The top of a count's axis: a multiple of four, so the four gridlines land on integers. */
export function countTop(rows: ChartRow[]): number {
  const peak = rows.reduce((m, r) => Math.max(m, Number(r.n) || 0), 0);
  let top = niceMax(peak);
  if (rows.every((r) => (Number(r.n) || 0) % 1 === 0)) top = Math.max(4, Math.ceil(top / 4) * 4);
  return top;
}

function frame(rows: ChartRow[], top: number) {
  const iw = CH.W - CH.PL - CH.PR;
  const ih = CH.H - CH.PT - CH.PB;
  const y = (v: number) => CH.PT + ih - (Math.min(v, top) / top) * ih;
  const grid = [0, 1, 2, 3, 4].map((s) => {
    const v = (top * s) / 4;
    const gy = r1(y(v));
    return (
      <g key={"g" + s}>
        <line class="grid-l" x1={CH.PL} y1={gy} x2={CH.W - CH.PR} y2={gy} />
        <text class="axis-t" x={CH.PL - 8} y={gy + 3.5} text-anchor="end">
          {trim(v)}
        </text>
      </g>
    );
  });
  const last = rows.length - 1;
  const longest = rows.reduce((m, r) => Math.max(m, String(r.label || "").length), 0);
  const need = longest * 5.8 + 12;
  const step = iw / Math.max(1, rows.length);
  const every = Math.max(1, Math.ceil(need / step));
  const half = (longest * 5.8) / 2;
  const label = (i: number, cx: number) => {
    if ((last - i) % every !== 0) return null;
    const x = Math.max(half + 2, Math.min(CH.W - half - 2, cx));
    return (
      <text key={"x" + i} class="axis-t" x={r1(x)} y={CH.H - 9} text-anchor="middle">
        {rows[i]!.label}
      </text>
    );
  };
  return { iw, ih, y, grid, label, floor: CH.PT + ih };
}

function Svg({ what, children }: { what: string; children: ComponentChildren }) {
  return (
    <svg viewBox={`0 0 ${CH.W} ${CH.H}`} role="img" preserveAspectRatio="none" aria-label={what}>
      {children}
    </svg>
  );
}

export function LineChart({ rows, unit = "values" }: { rows: ChartRow[]; unit?: string }) {
  if (!rows.length) return <p class="chart-empty">No data for this range yet.</p>;
  const top = countTop(rows);
  const f = frame(rows, top);
  const x = (i: number) => (rows.length === 1 ? CH.PL + f.iw / 2 : CH.PL + (i / (rows.length - 1)) * f.iw);
  const pts = rows.map((r, i) => [x(i), f.y(Number(r.n) || 0)] as const);
  const d = pts.map((p, i) => (i ? "L" : "M") + r1(p[0]) + " " + r1(p[1])).join(" ");
  return (
    <Svg what={unit + " over time"}>
      {f.grid}
      <path class="line" d={d} />
      {rows.map((r, i) => {
        const lastPt = i === rows.length - 1;
        if (rows.length > 32 && !lastPt) return null;
        return (
          <circle key={"d" + i} class={"dot" + (lastPt ? " dot-hi" : "")} cx={r1(pts[i]![0])} cy={r1(pts[i]![1])} r={lastPt ? 4 : 3.2}>
            <title>{r.label + ": " + (Number(r.n) || 0) + " " + unit}</title>
          </circle>
        );
      })}
      {rows.map((_, i) => f.label(i, x(i)))}
    </Svg>
  );
}

export function BarChart({ rows, unit = "values" }: { rows: ChartRow[]; unit?: string }) {
  if (!rows.length) return <p class="chart-empty">No data for this range yet.</p>;
  const peak = rows.reduce((m, r) => Math.max(m, Number(r.n) || 0), 0);
  const top = niceMax(peak);
  const f = frame(rows, top);
  const slot = f.iw / rows.length;
  const mid = (i: number) => CH.PL + slot * (i + 0.5);
  const bw = Math.max(3, Math.min(24, slot * 0.44));
  return (
    <Svg what={unit + " per day"}>
      {f.grid}
      {rows.map((r, i) => {
        const n = Number(r.n) || 0;
        const ty = f.y(n);
        const h = f.floor - ty;
        const left = r1(mid(i) - bw / 2);
        const right = r1(mid(i) + bw / 2);
        const rad = Math.min(bw / 2, h);
        const d =
          h <= 0
            ? ""
            : `M${left} ${r1(f.floor)} L${left} ${r1(ty + rad)} Q${left} ${r1(ty)} ${r1(left + rad)} ${r1(ty)} L${r1(right - rad)} ${r1(ty)} Q${right} ${r1(ty)} ${right} ${r1(ty + rad)} L${right} ${r1(f.floor)} Z`;
        return (
          <g key={"b" + i}>
            {d ? <path class="bar" d={d} /> : null}
            <rect class="bar-hit" x={r1(mid(i) - slot / 2)} y={CH.PT} width={r1(slot)} height={r1(f.ih)}>
              <title>{r.label + ": " + n + " " + unit}</title>
            </rect>
          </g>
        );
      })}
      {rows.map((_, i) => f.label(i, mid(i)))}
    </Svg>
  );
}
