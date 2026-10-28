/**
 * Two pickers ported from the original panel:
 *
 *   <MultiSelect>  a button that opens a searchable list of ticks with Done (the Orders tab's
 *                  "Order status"). Applied on Done or when the box closes by an outside
 *                  click; Escape closes without applying and gives focus back.
 *   <DateRange>    THE calendar: a range picked on a two-month grid, with the usual spans as
 *                  presets ("Last 7 days" is kept as its name and resolved as of now, so a list
 *                  left open over midnight moves with the clock). Days are MUSCAT days.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { shiftDay, todayMuscat } from "../../shared/kpi";
import { Icon } from "./Icon";

function useOutside(ref: { current: HTMLElement | null }, open: boolean, onOutside: () => void) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const path = e.composedPath ? e.composedPath() : [];
      if (ref.current && path.indexOf(ref.current) < 0) cb.current();
    };
    document.addEventListener("click", h, true);
    return () => document.removeEventListener("click", h, true);
  }, [open]);
}

/* ---------------- multi-select ---------------- */

export function MultiSelect({ label, options, value, onChange, searchLabel = "Search" }: { label: string; options: Array<{ value: string; label: string }>; value: string[]; onChange: (v: string[]) => void; searchLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const qRef = useRef<HTMLInputElement>(null);

  const close = (apply: boolean) => {
    if (!open) return;
    setOpen(false);
    if (apply && draft.join() !== value.join()) onChange(options.map((o) => o.value).filter((v) => draft.indexOf(v) > -1));
  };
  useOutside(box, open, () => close(true));
  useEffect(() => {
    if (open) qRef.current?.focus();
  }, [open]);

  const shown = options.filter((o) => !q.trim() || o.label.toLowerCase().indexOf(q.trim().toLowerCase()) > -1);
  const picked = options.filter((o) => value.indexOf(o.value) > -1);
  const text = !picked.length ? label : picked.length === 1 ? picked[0]!.label : picked.length + " statuses";

  return (
    <div
      class="msel"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          btn.current?.focus();
        }
      }}
    >
      <button
        ref={btn}
        type="button"
        class={"pick msel-btn" + (picked.length ? " on" : "")}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label + (picked.length ? ": " + picked.map((p) => p.label).join(", ") : "")}
        onClick={() => {
          if (open) close(true);
          else {
            setDraft(value);
            setQ("");
            setOpen(true);
          }
        }}
      >
        {text}
      </button>
      {open ? (
        <div class="msel-pop" role="dialog" aria-label={label}>
          <div class="msel-q">
            <Icon name="search" />
            <input ref={qRef} type="search" placeholder="Search here" aria-label={searchLabel} value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
          </div>
          <div class="msel-list" role="group" aria-label={label}>
            {shown.length ? (
              shown.map((o) => (
                <label class="msel-row" key={o.value}>
                  <input
                    type="checkbox"
                    checked={draft.indexOf(o.value) > -1}
                    onChange={(e) => {
                      const on = (e.currentTarget as HTMLInputElement).checked;
                      setDraft((d) => (on ? [...d.filter((x) => x !== o.value), o.value] : d.filter((x) => x !== o.value)));
                    }}
                  />
                  <span>{o.label}</span>
                </label>
              ))
            ) : (
              <p class="empty">Nothing matches.</p>
            )}
          </div>
          <button
            type="button"
            class="btn sm primary msel-done"
            onClick={() => {
              close(true);
              btn.current?.focus();
            }}
          >
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- the calendar ---------------- */

export interface Range {
  /** a preset's name ("all", "today", "7" …) or "" for picked days */
  pre: string;
  from: string;
  to: string;
}

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const PRESETS: Array<[string, string]> = [
  ["all", "All time"],
  ["today", "Today"],
  ["yday", "Yesterday"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["month", "This month"],
  ["lmonth", "Last month"],
];

function addMonths(m: string, n: number): string {
  let y = +m.slice(0, 4);
  let mo = +m.slice(5, 7) - 1 + n;
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  return y + "-" + (mo < 9 ? "0" : "") + (mo + 1);
}
export function niceDay(day: string, withYear: boolean): string {
  if (!day) return "";
  return +day.slice(8, 10) + " " + MON3[+day.slice(5, 7) - 1] + (withYear ? " " + day.slice(0, 4) : "");
}

/** A preset as days, as of `now` (Muscat). */
export function presetSpan(pre: string, now: number): { from: string; to: string } {
  const t = todayMuscat(now);
  if (pre === "today") return { from: t, to: t };
  if (pre === "yday") {
    const y = shiftDay(t, -1);
    return { from: y, to: y };
  }
  if (pre === "7" || pre === "30" || pre === "90") return { from: shiftDay(t, -(+pre - 1)), to: t };
  if (pre === "month") return { from: t.slice(0, 7) + "-01", to: t };
  if (pre === "lmonth") {
    const lm = addMonths(t.slice(0, 7), -1);
    return { from: lm + "-01", to: shiftDay(t.slice(0, 7) + "-01", -1) };
  }
  return { from: "", to: "" };
}

export function resolveRange(r: Range, now: number): { from: string; to: string } {
  return r.pre ? presetSpan(r.pre, now) : { from: r.from, to: r.to };
}

export function rangeLabel(r: Range, empty = "All time"): string {
  if (r.pre && r.pre !== "all") {
    const p = PRESETS.find((x) => x[0] === r.pre);
    if (p) return p[1];
  }
  if (r.pre === "all" || (!r.from && !r.to)) return empty;
  if (r.from && r.to && r.from !== r.to) return niceDay(r.from, r.from.slice(0, 4) !== r.to.slice(0, 4)) + " – " + niceDay(r.to, true);
  return niceDay(r.from || r.to, true);
}

export function DateRange({ value, onChange, now = Date.now(), small, future, presets = true, empty = "All time", label = "Date range" }: { value: Range; onChange: (r: Range) => void; now?: number; small?: boolean; future?: boolean; presets?: boolean; empty?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ pre: string; from: string; to: string; hover: string }>({ pre: "", from: "", to: "", hover: "" });
  const [view, setView] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const today = todayMuscat(now);
  const cur = resolveRange(value, now);
  const pop = useRef<HTMLDivElement>(null);
  useOutside(box, open, () => setOpen(false));
  /* opens toward the side with room: moved left by its overhang, never past the page's
     own left edge (a phone pins it to the screen in CSS instead) */
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el || getComputedStyle(el).position === "fixed") return;
    el.style.left = "0px";
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    if (!vw || r.right <= vw - 12) return;
    const main = document.querySelector(".main");
    const floor = main ? main.getBoundingClientRect().left + 8 : 8;
    el.style.left = -Math.min(r.right - (vw - 12), Math.max(0, r.left - floor)) + "px";
  }, [open]);

  const commit = (r: Range) => {
    setOpen(false);
    onChange(r);
    btn.current?.focus();
  };
  const show = () => {
    setDraft({ pre: value.pre, from: cur.from, to: cur.to, hover: "" });
    setView(addMonths((cur.to || cur.from || today).slice(0, 7), future && !cur.to ? 0 : -1));
    setOpen(true);
  };

  const month = (m: string, side: "left" | "right") => {
    const y = +m.slice(0, 4);
    const mo = +m.slice(5, 7) - 1;
    const first = new Date(Date.UTC(y, mo, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const a = draft.from;
    const b = draft.to || draft.hover || "";
    const lo = a && b ? (a < b ? a : b) : a;
    const hi = a && b ? (a < b ? b : a) : a;
    const cells = [];
    for (let s = 0; s < first; s++) cells.push(<span key={"s" + s} />);
    for (let d = 1; d <= days; d++) {
      const key = m + "-" + (d < 10 ? "0" : "") + d;
      const cls = [key === today && "now", lo && hi && key >= lo && key <= hi && "in", key === lo && "lo", key === hi && "hi"].filter(Boolean).join(" ");
      cells.push(
        <button
          key={key}
          type="button"
          class={cls || undefined}
          disabled={!future && key > today}
          aria-label={niceDay(key, true)}
          aria-pressed={key === lo || key === hi ? true : undefined}
          onMouseEnter={() => draft.from && !draft.to && setDraft((x) => ({ ...x, hover: key }))}
          onClick={() => {
            if (!draft.from || draft.to) setDraft({ pre: "", from: key, to: "", hover: "" });
            else commit({ pre: "", from: draft.from < key ? draft.from : key, to: draft.from < key ? key : draft.from });
          }}
        >
          {d}
        </button>,
      );
    }
    return (
      <div class={"drp-mon " + side} key={side}>
        <div class="drp-head">
          {side !== "right" ? (
            <button type="button" class="drp-nav" aria-label="Previous month" onClick={() => setView(addMonths(view, -1))}>
              ‹
            </button>
          ) : (
            <i />
          )}
          <b>
            {MON[mo]} {y}
          </b>
          <button type="button" class={"drp-nav" + (side === "left" ? " mob" : "")} aria-label="Next month" onClick={() => setView(addMonths(view, 1))}>
            ›
          </button>
        </div>
        <div class="drp-dow" aria-hidden="true">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div class="drp-days">{cells}</div>
      </div>
    );
  };

  const sum = draft.from
    ? niceDay(draft.from, true) + (draft.to && draft.to !== draft.from ? " → " + niceDay(draft.to, true) : draft.to ? "" : " → pick an end day")
    : "Pick a start day";
  const set = !!(cur.from || cur.to);

  return (
    <div
      class="drp"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          btn.current?.focus();
        }
      }}
    >
      <button ref={btn} type="button" class={"pick drp-btn" + (small ? " sm" : "") + (set ? " set" : "")} aria-haspopup="dialog" aria-expanded={open} aria-label={label + ": " + rangeLabel(value, empty)} onClick={() => (open ? setOpen(false) : show())}>
        <Icon name="cal" />
        <span class="drp-label">{rangeLabel(value, empty)}</span>
      </button>
      {open ? (
        <div ref={pop} class={"drp-pop" + (presets ? "" : " bare")} role="dialog" aria-label={label}>
          {presets ? (
            <div class="drp-presets">
              {PRESETS.map(([k, l]) => (
                <button key={k} type="button" aria-pressed={draft.pre === k} onClick={() => commit({ pre: k, from: "", to: "" })}>
                  {l}
                </button>
              ))}
            </div>
          ) : null}
          <div class="drp-main">
            <div class="drp-months">
              {month(view, "left")}
              {month(addMonths(view, 1), "right")}
            </div>
            <div class="drp-foot">
              <span class="drp-sum">{sum}</span>
              <button type="button" class="btn sm ghost" onClick={() => commit({ pre: presets ? "all" : "", from: "", to: "" })}>
                Clear
              </button>
              <button type="button" class="btn sm primary" disabled={!draft.from} onClick={() => draft.from && commit({ pre: "", from: draft.from, to: draft.to || draft.from })}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
