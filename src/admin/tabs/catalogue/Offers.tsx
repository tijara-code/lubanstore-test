/**
 * THE OFFERS — three folding cards, each with its state in the heading so "is it showing, and
 * for how long" is answered without opening it:
 *
 *   Small bundle offer   the set (offer): switch, words AR + EN, window (hours or days, what
 *                        happens when it closes, Reset), schedule (Muscat days), markets, "sold
 *                        only in this bundle", free delivery with the set (switch, length, renew,
 *                        start stamped by the server, Reset, markets)
 *   Large bundle offer   two or three large boxes (tiers): switch, countdown (length, renew,
 *                        Reset), the clock on the page, markets; prices are on each market card
 *   Free delivery offer  per market: taking part, free over (0 = every order), days (empty = no
 *                        end), the start stamped by the server, Restart / Run again
 *
 * A Reset or a Restart is a request the server carries out at publish (anchorReset,
 * freeShipReset, restart) — the start is always the server's clock, never typed here.
 */
import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import type { FreeShipRow } from "../../../shared/catalogue/types";
import { Btn, DateRange, Icon, Pill, Switch, toast, type Range } from "../../kit";
import { Box, MarketTicks, NumBox, Pick, TextBox, Tick } from "./fields";
import type { Edit } from "./Markets";
import { anchorText, convertLen, fsStamp, fsWords, hoursOf, lenShown, muscatDayOf, offerStamp, tiersState, type Draft } from "./model";

export function FoldCard({ title, stamp, tone, children, open: initial = false, id, lead }: { title: string; stamp: ComponentChildren; tone?: string; children: ComponentChildren; open?: boolean; id?: string; lead?: ComponentChildren }) {
  const [open, setOpen] = useState(initial);
  const body = useId();
  return (
    <section class={"card fold" + (open ? " open" : "")} id={id}>
      <div class="card-head">
        <button type="button" class="fold-btn" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
          <Icon name="chev" class="fold-chev" />
          <h2>{title}</h2>
        </button>
        <span class={"stamp" + (tone ? " " + tone : "")}>{stamp}</span>
      </div>
      {lead ? <div class="fold-lead">{lead}</div> : null}
      {/* kept in the page while folded: nothing in it is lost by folding (test-admin-batch) */}
      <div id={body} hidden={!open} class="fold-body">
        {children}
      </div>
    </section>
  );
}

const codesOf = (d: Draft) => (d.countries || []).map((c) => c.code);

/** A window's length: the number in the chosen unit, and the unit; flipping the unit converts the number. */
function Window({ label, hours, unit, onChange, title }: { label: string; hours: unknown; unit: unknown; onChange: (hours: number, unit: "hours" | "days") => void; title?: string }) {
  const u = unit === "days" ? "days" : "hours";
  const shown = lenShown(hours, u);
  return (
    <>
      <NumBox label={label} value={shown} onValue={(v) => onChange(hoursOf(v, u), u)} rule={{ int: true, min: 1, max: 100000 }} width="narrow" title={title} />
      <Pick
        label="Counted in"
        value={u}
        options={[
          ["hours", "Hours"],
          ["days", "Days"],
        ]}
        onChange={(to) => {
          const n = convertLen(shown, to);
          onChange(to === "days" ? n * 24 : n, to as "hours" | "days");
        }}
      />
    </>
  );
}

/* ---------------- the small bundle ---------------- */

export function SmallBundle({ d, edit, now }: { d: Draft; edit: Edit; now: number }) {
  const o = d.offer || {};
  const eo = (fn: (o: NonNullable<Draft["offer"]>) => void) => edit((x) => fn((x.offer = x.offer || {})));
  const st = offerStamp(o, d, now);
  const codes = codesOf(d);
  const range: Range = { pre: "", from: muscatDayOf(o.startsAt), to: muscatDayOf(o.endsAt) };
  const fsLen = Number(o.freeShipHours) > 0 ? (o.freeShipUnit === "hours" ? Number(o.freeShipHours) : Math.max(1, Math.round(Number(o.freeShipHours) / 24))) : null;
  const fsUnit = o.freeShipUnit === "hours" ? "hours" : "days";
  return (
    <FoldCard title="Small bundle offer" stamp={st.text} tone={st.tone} id="offerCard">
      <div class="cty-sec">
        <h4>The offer</h4>
        <div class="item-row">
          <Tick label="Offer" text="On" checked={o.active !== false} onChange={(on) => eo((x) => (x.active = on))} />
          <Tick label="Small box" text="Sold only in this bundle" checked={o.only !== false} onChange={(on) => eo((x) => (x.only = on))} title="No single small box on the page, in the basket or at the till; while the bundle is off, the small size leaves the page" />
          <TextBox label="Name" value={o.name} onValue={(v) => eo((x) => (x.name = v))} width="wide" />
          <TextBox label="Note" value={o.note} onValue={(v) => eo((x) => (x.note = v))} width="wide" />
          <TextBox label="Badge" value={o.badge} onValue={(v) => eo((x) => (x.badge = v))} />
          <TextBox label="Term" value={o.term} onValue={(v) => eo((x) => (x.term = v))} title="The offer's short term (e.g. عرض محدود)" />
        </div>
        <div class="item-row en-row">
          <TextBox label="Name · EN" value={o.name_en} onValue={(v) => eo((x) => (x.name_en = v))} width="wide" en />
          <TextBox label="Note · EN" value={o.note_en} onValue={(v) => eo((x) => (x.note_en = v))} width="wide" en />
          <TextBox label="Badge · EN" value={o.badge_en} onValue={(v) => eo((x) => (x.badge_en = v))} en />
          <TextBox label="Term · EN" value={o.term_en} onValue={(v) => eo((x) => (x.term_en = v))} en />
        </div>
        <p class="hint sml">English (the /en/ store): empty falls back to the Arabic; a cleared Arabic badge hides the English one.</p>
      </div>

      <div class="cty-sec">
        <h4>Window</h4>
        <div class="item-row">
          <Window
            label="Window"
            hours={o.hours}
            unit={o.unit}
            title="Window length. On a one-shot offer, changing it restarts from save."
            onChange={(h, u) =>
              eo((x) => {
                x.hours = h;
                x.unit = u;
              })
            }
          />
          <Pick
            label="When it closes"
            value={o.renew === "once" ? "once" : "auto"}
            options={[
              ["auto", "Start the next one"],
              ["once", "End the offer"],
            ]}
            onChange={(v) => eo((x) => (x.renew = v))}
          />
          <TextBox
            label={o.renew === "once" ? "Started" : "Counted from"}
            value={o.anchorReset ? "Now, when you publish" : anchorText(o.anchor) || "1 Jan 2026 (fixed)"}
            onValue={() => {}}
            readOnly
            title="Window start. Reset sets it to the moment you publish."
          />
          <div class="field-b act">
            <span class="cap" aria-hidden="true">
              {" "}
            </span>
            <Btn
              sm
              title="Start the window again from now"
              aria-label="Reset the bundle's window"
              onClick={() => {
                eo((x) => (x.anchorReset = true));
                toast("Window will restart from now when you save", true);
              }}
            >
              Reset
            </Btn>
          </div>
        </div>
      </div>

      <div class="cty-sec">
        <h4>Schedule</h4>
        <div class="item-row">
          <Box label="Runs (Muscat days)" width="wide">
            <DateRange
              value={range}
              presets={false}
              future
              empty="No limit"
              label="The bundle's schedule"
              now={now}
              onChange={(r) =>
                eo((x) => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(r.from)) x.startsAt = r.from + "T00:00:00+04:00";
                  else delete x.startsAt;
                  const to = r.to || r.from;
                  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) x.endsAt = to + "T23:59:59+04:00";
                  else delete x.endsAt;
                })
              }
            />
          </Box>
          {o.startsAt || o.endsAt ? (
            <div class="field-b act">
              <span class="cap" aria-hidden="true">
                {" "}
              </span>
              <Btn
                sm
                kind="ghost"
                onClick={() =>
                  eo((x) => {
                    delete x.startsAt;
                    delete x.endsAt;
                  })
                }
              >
                Clear
              </Btn>
            </div>
          ) : null}
        </div>
        <p class="note">Starts at 00:00 on the first day and ends at 23:59 on the last. Leave it empty and the bundle runs whenever it is switched on.</p>
      </div>

      <div class="cty-sec">
        <h4>Markets</h4>
        <div class="item-row">
          <MarketTicks label="Offered in" codes={codes} value={o.countries || []} onChange={(v) => eo((x) => (x.countries = v))} title="Unticked markets do not show or sell the bundle. All ticked = everywhere." />
        </div>
      </div>

      <div class="cty-sec">
        <h4>Free delivery with the set</h4>
        <div class="item-row">
          <Tick label="Switch" text="On: free delivery with this set, whatever the total" checked={o.freeShip === true} onChange={(on) => eo((x) => (x.freeShip = on))} />
          <NumBox
            label="For"
            value={fsLen}
            rule={{ int: true, min: 1, max: 100000, blank: true }}
            placeholder="no end"
            width="narrow"
            title="How long the free delivery runs from when it is published. Empty: no end."
            onValue={(v) =>
              eo((x) => {
                if (v && v > 0) x.freeShipHours = fsUnit === "days" ? v * 24 : v;
                else delete x.freeShipHours;
                x.freeShipUnit = fsUnit;
              })
            }
          />
          <Pick
            label="Counted in"
            value={fsUnit}
            options={[
              ["days", "Days"],
              ["hours", "Hours"],
            ]}
            onChange={(u) =>
              eo((x) => {
                x.freeShipUnit = u;
                // the length stays the same time: the box's number converts (3 days ⇄ 72 hours)
              })
            }
          />
          <Pick
            label="When it closes"
            value={o.freeShipRenew === "auto" ? "auto" : "once"}
            options={[
              ["once", "End free delivery"],
              ["auto", "Start the next one"],
            ]}
            onChange={(v) => eo((x) => (x.freeShipRenew = v))}
          />
          <TextBox
            label="Started"
            value={o.freeShipReset ? "When you publish" : o.freeShipAnchor ? anchorText(o.freeShipAnchor) : o.freeShip === true && Number(o.freeShipHours) > 0 ? "When you publish" : ""}
            onValue={() => {}}
            readOnly
            title="Stamped by the server when it is published"
          />
          <div class="field-b act">
            <span class="cap" aria-hidden="true">
              {" "}
            </span>
            <Btn
              sm
              aria-label="Reset the set's free delivery"
              title="Start the free-delivery window again from now, when you publish"
              onClick={() => {
                eo((x) => (x.freeShipReset = true));
                toast("The free-delivery window will start again when you publish", true);
              }}
            >
              Reset
            </Btn>
          </div>
        </div>
        <div class="item-row">
          <MarketTicks label="Ships free in" codes={codes} value={o.freeShipIn || []} onChange={(v) => eo((x) => (x.freeShipIn = v))} title="Markets where a basket with the set ships free when the switch is on. All ticked = everywhere." />
        </div>
        <p class="note">Applies only in the markets ticked, only while the switch is on, and (with a length set) only for that long from the publish. None ticked switches it off.</p>
      </div>
    </FoldCard>
  );
}

/* ---------------- the large-box offers (duo / trio) ---------------- */

export function LargeBundle({ d, edit, now }: { d: Draft; edit: Edit; now: number }) {
  const t = d.tiers || {};
  const et = (fn: (t: NonNullable<Draft["tiers"]>) => void) => edit((x) => fn((x.tiers = x.tiers || { sizeId: "large" })));
  const codes = codesOf(d);
  const priced = (d.countries || [])
    .map((c) => {
      const n = (k: string) => Number(((c.prices || {})[k] || { now: 0 }).now) || 0;
      return c.code + " " + (n("duo") || "—") + " · " + (n("trio") || "—");
    })
    .join("  ·  ");
  return (
    <FoldCard title="Large bundle offer" stamp={tiersState(t, now)} id="tiersCard">
      <p class="hint">2 or 3 large boxes, any scents, with a countdown. Prices on each market's card; no price = single box only.</p>
      <div class="cty-sec">
        <div class="item-row">
          <Tick label="On" text="Offers on" checked={t.active !== false} onChange={(on) => et((x) => (x.active = on))} />
        </div>
      </div>
      <div class="cty-sec">
        <h4>Countdown</h4>
        <div class="item-row">
          <Window
            label="Window"
            hours={t.hours}
            unit={t.unit}
            title="How long the offers run from start."
            onChange={(h, u) =>
              et((x) => {
                x.hours = h;
                x.unit = u;
              })
            }
          />
          <Pick
            label="When it closes"
            value={t.renew === "auto" ? "auto" : "once"}
            options={[
              ["once", "End the offers"],
              ["auto", "Start the next one"],
            ]}
            onChange={(v) => et((x) => (x.renew = v))}
          />
          <TextBox label="Started" value={t.anchorReset ? "Now, when you publish" : anchorText(t.anchor) || "When you publish"} onValue={() => {}} readOnly />
          <div class="field-b act">
            <span class="cap" aria-hidden="true">
              {" "}
            </span>
            <Btn
              sm
              aria-label="Reset the large bundle's countdown"
              title="Start the countdown again from now"
              onClick={() => {
                et((x) => (x.anchorReset = true));
                toast("The countdown will start again from now when you publish", true);
              }}
            >
              Reset
            </Btn>
          </div>
        </div>
        <div class="item-row">
          <Tick label="On the page" text="Show the countdown on the page" checked={t.clock !== false} onChange={(on) => et((x) => (x.clock = on))} />
        </div>
        <p class="note">The countdown restarts on Reset or any change to it. Unticked: the offers still end, no clock shown.</p>
      </div>
      <div class="cty-sec">
        <h4>Markets</h4>
        <div class="item-row">
          <MarketTicks label="Offered in" codes={codes} value={t.countries || []} onChange={(v) => et((x) => (x.countries = v))} />
        </div>
        <p class="note">Prices now (2 boxes · 3 boxes): {priced}</p>
      </div>
    </FoldCard>
  );
}

/* ---------------- free delivery for a time, per market ---------------- */

export function FreeDelivery({ d, edit, now }: { d: Draft; edit: Edit; now: number }) {
  const fs = d.freeShip || {};
  const on = fs.active !== false;
  const rows = fs.countries || {};
  const er = (code: string, fn: (r: FreeShipRow) => void) =>
    edit((x) => {
      const f = (x.freeShip = x.freeShip || { active: true, countries: {} });
      f.countries = f.countries || {};
      fn((f.countries[code] = f.countries[code] || { on: false }));
    });
  const sameDays = () => {
    const taking = (d.countries || []).filter((c) => rows[c.code] && rows[c.code]!.on);
    const src = taking.find((c) => rows[c.code]!.days != null && rows[c.code]!.days !== "");
    if (!src) return toast("Give one market taking part a number of days first");
    const days = rows[src.code]!.days;
    const others = taking.filter((c) => c !== src);
    edit((x) => {
      for (const c of others) x.freeShip!.countries![c.code]!.days = days;
    });
    toast(others.length ? days + " days for " + (others.length + 1) + " markets. Save & publish to apply." : "Only one market is taking part", !!others.length);
  };
  return (
    <FoldCard title="Free delivery offer" stamp={fsStamp(d, now)} tone={on && /^live/.test(fsStamp(d, now)) ? "ok" : ""} id="fsCard">
      <div class="fs-top">
        <Switch
          checked={on}
          onChange={(v) =>
            edit((x) => {
              x.freeShip = x.freeShip || { countries: {} };
              x.freeShip.active = v;
            })
          }
        >
          {on ? "Offer on" : "Offer off"}
        </Switch>
        <span class="fs-hint">Starts when you publish · ends at midnight (Muscat) on the last day · edits keep the countdown · Restart resets it</span>
        <Btn sm onClick={sameDays} title="Give every market taking part the days of the first one">
          Same days for all
        </Btn>
      </div>
      <div class="fs-grid" role="table" aria-label="Free delivery per market">
        <div class="fs-row fs-headrow" role="row">
          <span role="columnheader">Market</span>
          <span role="columnheader">Taking part</span>
          <span role="columnheader" title="0 means free delivery on every order">
            Free over
          </span>
          <span role="columnheader">Days</span>
          <span role="columnheader">Now</span>
        </div>
        {(d.countries || []).map((c) => {
          const r = rows[c.code] || {};
          const w = fsWords(r, now);
          const usual = Number(c.freeOver) || 0;
          const days = r.days == null || r.days === "" ? null : Number(r.days);
          return (
            <div class={"fs-row" + (r.on ? " is-on" : "")} role="row" key={c.code} data-fs={c.code}>
              <span class="fs-mk" role="cell">
                <b>{c.code}</b>
                <em dir="auto">{c.name || ""}</em>
              </span>
              <span role="cell">
                <Switch checked={!!r.on} onChange={(v) => er(c.code, (x) => (x.on = v))}>
                  <span class="sr-only">{c.code} taking part: </span>
                  {r.on ? "Yes" : "No"}
                </Switch>
              </span>
              <span role="cell" class="fs-over">
                <NumBox
                  label={"Free over (" + c.code + ")"}
                  value={r.over == null ? "" : r.over}
                  onValue={(v) =>
                    er(c.code, (x) => {
                      if (v === null) delete x.over;
                      else x.over = v;
                    })
                  }
                  rule={{ min: 0, max: 1_000_000, dec: 3, blank: true }}
                  placeholder="0 = every order"
                  suffix={c.cur || ""}
                />
                <small>usually {usual > 0 ? usual + " " + (c.cur || "") : "no threshold"}</small>
              </span>
              <span role="cell" class="fs-days">
                <span class="stepper">
                  <button type="button" aria-label={"One day fewer (" + c.code + ")"} onClick={() => er(c.code, (x) => {
                    const n = Math.round(Number(x.days) || 0) - 1;
                    if (n < 1) delete x.days;
                    else x.days = n;
                  })}>
                    −
                  </button>
                  <NumBox
                    bare
                    label={"Days (" + c.code + ")"}
                    value={days === null ? "" : days}
                    onValue={(v) =>
                      er(c.code, (x) => {
                        if (v === null) delete x.days;
                        else x.days = v;
                      })
                    }
                    rule={{ int: true, min: 1, max: 365, blank: true }}
                    placeholder="∞"
                  />
                  <button type="button" aria-label={"One day more (" + c.code + ")"} onClick={() => er(c.code, (x) => (x.days = Math.min(365, Math.round(Number(x.days) || 0) + 1)))}>
                    +
                  </button>
                </span>
                <small>days</small>
              </span>
              <span role="cell" class="fs-now">
                <Pill tone={"fs-" + w.st}>{w.pill}</Pill>
                {w.sub ? <small>{w.sub}</small> : null}
                {r.restart ? (
                  <Btn sm kind="ghost" class="xs" disabled>
                    Restarts on publish
                  </Btn>
                ) : w.st === "ended" || w.st === "live" ? (
                  <Btn
                    sm
                    class="xs"
                    title={w.st === "live" ? "Start the countdown again from the moment you publish" : undefined}
                    aria-label={(w.st === "ended" ? "Run again" : "Restart") + " in " + c.code}
                    onClick={() =>
                      er(c.code, (x) => {
                        x.restart = true;
                        delete x.from;
                      })
                    }
                  >
                    {w.st === "ended" ? "Run again" : "Restart"}
                  </Btn>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      <p class="note">
        While <b>Live</b>, free delivery from this amount (0 = all orders), with a countdown bar. Empty days = no end.
      </p>
    </FoldCard>
  );
}
